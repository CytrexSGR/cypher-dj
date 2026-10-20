// D1 S3: Bereich proj-ausgabe mit POST /proj/freeze und POST /proj/export (Spec 3.4, 2.5, 2.9, 6.2, 6.14, 6.20, 6.23, 6.25, 6.32, 6.33, 6.34, R9).
// Dockt wie jeder Bereich nur über den BereichKontext an (Spec 2.10) und über den ProjZugang der S2-Integration (bereich.ts: offenes Projekt,
// Verlauf, Wiedergabe, Zähler, Tempo, Freeze-Sperre, ausgabe_lauf). Der Haken `ereignis` liest /zustand/arr (Transport, geladene Wiedergabe),
// /e/freeze (Ende eines Freeze), /q (Grund eines Abbruchs) und /e/neustart (ein neuer Kern beendet jeden Freeze); jede Meldung des Kerns zählt
// als Lebenszeichen (Kern verloren: Stille). Ein Lauf zur Zeit: ein zweiter Freeze oder Export während eines laufenden antwortet 409 beschaeftigt.
// Fehlerform wie die übrigen Projekt-Routen: {fehler: <grund>, text} mit englischem text (Spec 6.34), dazu detail, wenn ein Baustein eine
// (deutsche) Prüfmeldung hat. Hat ein Lauf schon etwas gespeichert (Freeze als eigener Undo-Schritt) und scheitert danach, nennt die Antwort das in
// text und schritte, nie „nothing was changed“; unerwartete Fehler (500 intern) gehen ins Log wie in proj (Fix-Runde S3 R1).
// Sperre (Spec 6.23, 6.32, 6.33): ein Freeze hält sperreLaden() von VOR tempoAnMaster() bis nach uebernimm() und gibt sie in jedem Ausgang frei
// (finally). Unter der Sperre lehnt die S2-Integration jede wiedergabewirksame Änderung, Öffnen, Anlegen, Transport-Start und POST /tempo mit
// 409 beschaeftigt ab; was uebernimm() laden müsste, holt sie nach der Freigabe nach.
// Export (Spec 2.5, 6.20, R9): nötige Wirt-Spuren erst einfrieren (je Spur wie /proj/freeze, mit Sperre), dann eine eigene Export-Wiedergabe aus dem
// einen Zähler (nie geladen, danach gelöscht), cypherdj-render mit nice 19 und den Spur-Reglern aus project.json als Datei, WAV unter
// <projektordner>/export/ (nie ersetzt), Lautheit per ffmpeg. Die Antwort ist schmal (kein Projekt, Spec 6.31): datei, frames, spitze_db,
// regler_quelle, lufs_i, lra, true_peak_dbtp, bei Fehlschlag der Messung loudness_fehler.
// Lautheit je Spur (Paket 1.18, E-b, POST /proj/lautheit): derselbe Anfang (Bereich, Wirt-Freeze, Export-Wiedergabe), dann ein Render je belegter Spur
// ohne Neustart-Zustand des Kerns (--ohne-zustand): die Regler kommen allein aus einer Datei, in der alle anderen Spuren stumm stehen, dazu ein Render
// aller Spuren für die Summe. Die WAVs liegen in einem temporären Ordner und gehen im finally weg.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import type { Bereich, BereichKontext } from '../../http/router.ts';
import { json, koerper } from '../../http/transport.ts';
import { grundText } from '../../http/gruende.ts';
import { instanz, renderProgramm, wirtOrdnerVorgabe } from '../../pfade.ts';
import { KENNUNG_MAX, SAMPLERATE, kanonisch, spurSicht, sucheSpur, type Freeze, type Projekt, type Spur } from '../../projekt/modell.ts';
import type { Meta } from '../../projekt/verlauf.ts';
import { aendereStand, StandFehler } from '../../projekt/stand.ts';
import {
  brauchtFreeze, freezeBereich, freezeDateiName, FreezeFehler, FREEZE_MAX_BEATS, FREEZE_NACHLAUF_BEATS, istWirt, klingendeNoten,
  pruefeFreezeDatei, setzeFreeze,
} from '../../projekt/freeze.ts';
import { reglerAusProjekt, rendere, RenderFehler, type RenderAntwort } from '../../projekt/render.ts';
import { messeLautheit, type Lautheit } from '../../projekt/lautheit.ts';
import type { AusgabeLauf, ProjZugang } from './bereich.ts';
import { grundCode } from './abbildung.ts';
import { ProjFehler } from './sitzung.ts';

export type { ProjZugang };
type ProjOffen = NonNullable<ReturnType<ProjZugang['offen']>>;
// Was S3 vom ProjZugang der S2-Integration braucht (bereich.ts; Plan S3 „vorausgesetzte Schnittstellen“, nach S2int berichtigt)
export const ZUGANG_METHODEN = ['offen', 'arbeitsordner', 'haken', 'uebernimm', 'schreibeWiedergabe', 'naechsteNummer', 'tempoAnMaster',
  'sperreLaden', 'ausgabeLauf'] as const;

export interface AusgabeOptionen {
  zugabeMs?: number;              // Frist eines Freeze über seine Dauer hinaus (Vorgabe 5000, K3-Plan: Länge plus 5 s)
  stilleMs?: number;              // so lange ohne jede Meldung des Kerns während eines Freeze heißt: Kern verloren (Vorgabe 2000)
  render?: () => string[];        // Programm des Renders (Vorgabe [pfade.renderProgramm()], Tests: das Doppel)
  instanz?: () => string;         // Instanz für den Render (Vorgabe pfade.instanz())
  jetzt?: () => Date;             // Uhr für den Dateinamen (Vorgabe new Date())
  ffmpeg?: string[];              // ffmpeg für die Lautheit (Vorgabe ['ffmpeg'])
  wirtOrdner?: () => string;      // Ordner der Wirt-Status-Dateien (Vorgabe pfade.wirtOrdnerVorgabe(), der Server gibt seinen mit)
}

const STATUS: Record<string, number> = {
  argument_ungueltig: 400, export_bereich: 400, spur_unbekannt: 400, keine_wirtspur: 400, spur_leer: 400, zu_gross: 400,
  kein_projekt: 409, ki_gestoppt: 409, beschaeftigt: 409, transport_laeuft: 409, nicht_geladen: 409, kein_kernstand: 409, deck_laeuft: 409,
  audio_fehlt: 409, veraltet: 409, wirt_fehlt: 409,
  freeze_fehler: 502, render_fehler: 502,
};

// text: englisch (Spec 6.34)
export class AusgabeFehler extends Error {
  readonly grund: string;
  readonly text: string;
  constructor(grund: string, text = '') { super(text ? `${grund}: ${text}` : grund); this.grund = grund; this.text = text; }
}
// Typangabe am Namen: nur so wertet TypeScript einen Aufruf als Ende des Pfads und verengt danach (this.arr, q, e ohne Non-Null-Assertion)
const fehl: (grund: string, text?: string) => never = (grund, text = '') => { throw new AusgabeFehler(grund, text); };

// Ein Schritt, den dieser Lauf schon gespeichert hat (Freeze als eigener Undo-Schritt), und die WAV, wenn sie schon steht
export interface Schritt { rev: number; label: string }
// Fix-Runde S3 R1: ein Fehler, nachdem der Lauf schon etwas gespeichert hat. Die Antwort sagt das (nie „nothing was changed“) und nennt die Schritte.
export class LaufFehler extends Error {
  readonly ursache: unknown;
  readonly schritte: Schritt[];
  readonly art: AusgabeLauf['art'];
  readonly datei: string | null;
  constructor(ursache: unknown, schritte: Schritt[], art: AusgabeLauf['art'], datei: string | null) {
    super(`nach ${schritte.map((x) => x.label).join(', ')}: ${(ursache as Error)?.message ?? String(ursache)}`);
    this.ursache = ursache; this.schritte = schritte; this.art = art; this.datei = datei;
  }
  // englisch (Spec 6.34): was gespeichert ist, und beim Export, ob eine Datei steht
  stand(): string {
    const n = this.schritte.map((x) => `${x.label} (rev ${x.rev})`);
    const was = this.schritte.length === 1
      ? `${this.schritte[0].label} was saved as its own undo step (rev ${this.schritte[0].rev})`
      : `${n.slice(0, -1).join(', ')} and ${n.at(-1)} were saved as their own undo steps`;
    if (this.art !== 'export') return was;
    return `${was}; ${this.datei ? `the export file ${path.basename(this.datei)} was written` : 'no export file was written'}`;
  }
}

// Jeder Fehler als HTTP-Antwort {code, body: {fehler, text, detail?}}; text ist immer englisch: der eigene Text des Fehlers, wenn er einen
// englischen trägt (AusgabeFehler, FreezeFehler, StandFehler, ProjFehler mit extra.text), sonst der Rückfall aus http/gruende.ts. Deutsche
// Meldungen der S2-Bausteine (BefehlFehler, VerlaufFehler) gehen als detail mit.
export function alsAntwort(e: unknown): { code: number; body: { fehler: string; text: string; detail?: string; schritte?: Schritt[] } } {
  const mit = (fehler: string, text: string, detail = ''): { fehler: string; text: string; detail?: string } =>
    (detail ? { fehler, text: text || grundText(fehler), detail } : { fehler, text: text || grundText(fehler) });
  if (e instanceof LaufFehler) {
    const x = alsAntwort(e.ursache);
    // intern: der Rückfall-Text sagt „nothing was changed“, das stimmt hier nicht
    const text = x.body.fehler === 'intern' ? `internal server error; ${e.stand()}` : `${x.body.text}; ${e.stand()}`;
    return { code: x.code, body: { ...x.body, text, schritte: e.schritte } };
  }
  if (e instanceof AusgabeFehler || e instanceof FreezeFehler) return { code: STATUS[e.grund] ?? 409, body: mit(e.grund, e.text) };
  if (e instanceof StandFehler) return { code: STATUS[e.grund] ?? 409, body: mit(e.grund, e.text, e.detail) };
  if (e instanceof RenderFehler) return { code: STATUS[e.grund], body: mit(e.grund, e.text, e.message) };
  if (e instanceof ProjFehler) return { code: e.code, body: mit(e.fehler, typeof e.extra.text === 'string' ? e.extra.text : '') };
  const x = e as { grund?: unknown; fehler?: unknown; code?: unknown; message?: unknown } | null;
  if (typeof x?.grund === 'string') return { code: STATUS[x.grund] ?? grundCode(x.grund), body: mit(x.grund, '', String(x.message ?? '')) };
  if (typeof x?.fehler === 'string' && typeof x?.code === 'number') return { code: x.code, body: mit(x.fehler, '', String(x.message ?? '')) };
  return { code: 500, body: mit('intern', '', String(x?.message ?? e)) };
}

// Kern-Gründe einer Ablehnung (/q 6) oder eines Abbruchs (/q 7) des Freeze als Antwort
function freezeAbgelehnt(grund: string): never {
  if (grund === 'ki_gestoppt' || grund === 'ki_stopp') return fehl('ki_gestoppt', 'Stop Cypher is set');
  if (grund === 'nicht_geladen') return fehl('nicht_geladen', 'the core has not loaded the current arrangement');
  if (grund === 'ueberlappung') return fehl('transport_laeuft', 'the core is playing or already freezing; stop the transport first');
  // Spec 6.33: eine offene Tempo-Rampe (gleich aus welcher Quelle) lässt den Kern ablehnen; nichts ist geschehen, später noch einmal
  if (grund === 'tempo_rampe') return fehl('beschaeftigt', 'the core is still ramping the tempo; a freeze waits until the ramp is done');
  if (grund === 'abbruch') {
    return fehl('freeze_fehler', 'the core aborted the freeze (transport start or stop, loading, hand key or a tempo ramp); nothing was saved');
  }
  return fehl('freeze_fehler', `the core refused the freeze (${grund || 'no reason given'})`);
}

// S3-Fix W2: gilt die Status-Datei eines Wirts (wirt.py schreibt {name, pid, bereit, fehler, sock, klang, art, fahrbar}) noch? Ja nur, wenn bereit
// true ist, pid eine ganze Zahl > 0 ist, /proc/<pid> lebt und der Prozess wirt.py ausführt (ein Argument der Befehlszeile heißt wirt.py: so fängt es eine
// wiederverwendete pid ab). Jeder Lese- oder Formatfehler heißt: nein.
export function wirtLebt(datei: string): boolean {
  try {
    const st = JSON.parse(fs.readFileSync(datei, 'utf8')) as { bereit?: unknown; pid?: unknown } | null;
    if (st?.bereit !== true || typeof st.pid !== 'number' || !Number.isInteger(st.pid) || st.pid <= 0) return false;
    return fs.readFileSync(`/proc/${st.pid}/cmdline`, 'utf8').split('\0').some((a) => path.basename(a) === 'wirt.py');
  } catch { return false; }
}

export const EXPORT_MAX_BEATS = 1024;

// Export-Wiedergabe: Wirt-Spuren ohne Freeze sind hier stumm (sonst wären sie vorher eingefroren worden) und fehlen, denn der Render lehnt jede
// Wirt-Spur ab (K3, Rückgabe 5).
export function exportSicht(p: Projekt): Projekt {
  const q = structuredClone(p);
  q.spuren = q.spuren.filter((s) => !(istWirt(s) && !s.freeze));
  return q;
}

// Audio-Clips im Bereich [von, bis), die noch nicht dekodiert sind: der Übersetzer ließe sie weg (Spec 2.8), der Export klänge anders.
export function fehlendesAudio(p: Projekt, von: number, bis: number): string[] {
  const aus: string[] = [];
  for (const s of p.spuren) for (const c of s.clips) {
    if (c.art === 'audio' && c.dekodiert !== 'fertig' && c.start_beat < bis && c.start_beat + c.laenge_beats > von) aus.push(c.id);
  }
  return aus;
}

const zwei = (n: number): string => String(n).padStart(2, '0');
// <projektordner>/export/<slug>-<JJJJMMTT-hhmmss>.wav (Ortszeit), bei Gleichstand -2, -3 …
export function exportZiel(ordner: string, slug: string, d: Date): string {
  const stempel = `${d.getFullYear()}${zwei(d.getMonth() + 1)}${zwei(d.getDate())}-${zwei(d.getHours())}${zwei(d.getMinutes())}${zwei(d.getSeconds())}`;
  let ziel = path.join(ordner, `${slug}-${stempel}.wav`);
  for (let n = 2; fs.existsSync(ziel); n++) ziel = path.join(ordner, `${slug}-${stempel}-${n}.wav`);
  return ziel;
}

// Spec 6.31: schmale Antwort für das Werkzeug proj_freeze (Abfrage ?antwort=kurz): rev, die Spur und ihr Freeze-Feld (null nach dem Verwerfen),
// nicht das ganze Projekt. Die Seite fragt ohne Abfrage und bekommt weiter {rev, projekt}.
export function kurzeFreezeAntwort(r: { rev: number; projekt: Projekt }, spurId: string): { rev: number; spur_id: string; freeze: Freeze | null } {
  return { rev: r.rev, spur_id: spurId, freeze: sucheSpur(r.projekt, spurId)?.freeze ?? null };
}

export type ExportAntwort = Pick<RenderAntwort, 'frames' | 'spitze_db' | 'regler_quelle'> & { datei: string } & Lautheit;

// Paket 1.18, E-b. Unter dieser Spitze (dBFS) gilt ein Render als Stille: die Lautheit ist null, nicht der Gate-Boden −70 von ffmpeg.
export const STILLE_DB = -90;
const STUMM_GRENZE = -120;          // SCHNITTSTELLEN §1.2: jeder Fader-Wert ≤ −120 dB ist stumm
const OHNE_LAUTHEIT: Lautheit = { lufs_i: null, lra: null, true_peak_dbtp: null };
// S3-Fix G2: ffmpeg (ebur128) meldet −70.0 LUFS, wenn kein Block das absolute Gate −70 passiert: das ist der Boden, keine Messung. Eine solche leise,
// aber nicht stille Spur (Spitze über STILLE_DB) bekommt lufs_i null und lra null (LRA 0 wäre erfunden), den gemessenen True Peak und unter_messgrenze true.
const GATE_BODEN_LUFS = -70;
export function untermessgrenze(l: Lautheit): { l: Lautheit; unter: boolean } {
  if (l.lufs_i === null || l.lufs_i > GATE_BODEN_LUFS) return { l, unter: false };
  return { l: { lufs_i: null, lra: null, true_peak_dbtp: l.true_peak_dbtp }, unter: true };
}
export interface SpurLautheit extends Lautheit { spur_id: string; nr: number; name: string; spitze_db: number; stumm: boolean; unter_messgrenze: boolean }
export interface LautheitAntwort {
  von_beat: number; bis_beat: number;
  spuren: SpurLautheit[];
  summe: Lautheit & { spitze_db: number; unter_messgrenze: boolean; regler_quelle: RenderAntwort['regler_quelle'] };
}

// Spuren, die im Bereich [von, bis) etwas spielen: ein Clip, der ihn berührt (MIDI-Clips mit Noten), oder ein Freeze, der ihn berührt. Eine Wirt-Spur
// ohne Freeze spielt nicht (exportSicht lässt sie weg).
export function belegteSpuren(p: Projekt, von: number, bis: number): Spur[] {
  return p.spuren.filter((s) => {
    if (s.freeze) {
      const f0 = s.freeze.von_beat ?? 0, f1 = f0 + (s.freeze.frames / SAMPLERATE) * (p.tempo_bpm / 60);
      return f0 < bis && f1 > von;
    }
    if (istWirt(s)) return false;
    return s.clips.some((c) => c.start_beat < bis && c.start_beat + c.laenge_beats > von && (c.art === 'audio' || c.noten.length > 0));
  });
}

// Spur-Regler für den Render EINER Spur (Datei --spur-regler): alle anderen Slots stumm, Solo überall aus, Fader und Pan der Spur aus dem Projekt,
// ihr Mute auch (eine stumme Spur rendert Stille). Pfade und Wertebereiche wie lies_spur_regler (render.cpp).
export function reglerEinzeln(s: Spur): Record<string, number> {
  const r: Record<string, number> = {};
  for (let n = 1; n <= 8; n++) {
    r[`spur/${n}/mute`] = n === s.nr ? (s.mute ? 1 : 0) : 1;
    r[`spur/${n}/solo`] = 0;
  }
  r[`spur/${s.nr}/fader`] = s.fader_db;
  r[`spur/${s.nr}/pan`] = s.pan;
  return r;
}

const LAUF_TEXT: Record<AusgabeLauf['art'], string> = { freeze: 'a freeze', export: 'an export', lautheit: 'a loudness measurement' };

// Ende eines Freeze aus Sicht des Wartenden: /e/freeze (status, frames), ein neuer Kern, Stille, Frist
type FreezeEnde = { art: 'e_freeze'; status: number; frames: number } | { art: 'neustart' } | { art: 'stille' } | { art: 'frist' } | { art: 'geschlossen' };

export class Ausgabe {
  private readonly ctx: BereichKontext;
  private readonly zugang: ProjZugang;
  private readonly opt: AusgabeOptionen;
  private lauf: AusgabeLauf | null = null;
  private schritte: Schritt[] = [];                                     // was der laufende Lauf schon gespeichert hat (R1)
  private datei: string | null = null;                                  // die WAV des laufenden Exports, sobald sie steht (R1)
  private freezeDatei: string | null = null;                            // Freeze-Datei dieses Durchlaufs, bis sie im Projekt steht (R4, F1)
  private geschlossen = false;                                          // Server endet (R7): kein neuer Lauf
  private renderAbbruch: AbortController | null = null;                 // laufender Export-Render, den schliesse() beendet (F4)
  private arr: { nr: number; status: number } | null = null;
  private generation: number | null = null;
  private letzteMeldungMs = Date.now();
  private readonly wartend = new Map<string, (e: FreezeEnde) => void>();
  private readonly abbruch = new Map<number, string>();

  constructor(ctx: BereichKontext, zugang: ProjZugang, opt: AusgabeOptionen = {}) { this.ctx = ctx; this.zugang = zugang; this.opt = opt; }

  // für Tests: läuft gerade etwas, wartet noch ein Freeze, merkt sich noch ein Befehl seinen Abbruchgrund?
  zustand(): { lauf: AusgabeLauf | null; wartend: number; abbruch: number } {
    return { lauf: this.lauf, wartend: this.wartend.size, abbruch: this.abbruch.size };
  }

  // Fix-Runde S3 R7: der Server endet (server.ts stoppe). Ein wartender Freeze endet sofort mit freeze_fehler (Uhr und Takt weg, die Sperre gibt sein
  // finally frei), statt den Stopp bis zur Stille-Grenze oder zur Frist zu halten; ein neuer Lauf wird abgelehnt.
  schliesse(): void {
    this.geschlossen = true;
    this.renderAbbruch?.abort();                                         // Fix-Runde 2 S3, F4: der Render ist eine eigene Gruppe, sonst lebt er weiter
    for (const [k, w] of [...this.wartend]) { this.wartend.delete(k); w({ art: 'geschlossen' }); }
  }

  ereignis(adresse: string, f: Record<string, unknown>): void {
    this.letzteMeldungMs = Date.now();                                   // jede Meldung ist ein Lebenszeichen des Kerns
    if (adresse === '/zustand/arr') { this.arr = { nr: Number(f.nr), status: Number(f.status) }; return; }
    if (adresse === '/e/freeze') {
      const k = `${Number(f.spur)}:${Number(f.kennung)}`;
      const w = this.wartend.get(k);
      if (w) { this.wartend.delete(k); w({ art: 'e_freeze', status: Number(f.status), frames: Number(f.frames) }); }
      return;
    }
    if (adresse === '/q') {
      const id = Number(f.id), st = Number(f.status);
      if (this.abbruch.has(id) && (st === 6 || st === 7)) this.abbruch.set(id, String(f.grund ?? ''));
      return;
    }
    if (adresse === '/k/willkommen') { this.generation = Number(f.generation); return; }
    // Spec 6.32: ein neuer Kern (andere Generation, wie lage.ts) beendet jeden Freeze; der Kern-Stand ist unbekannt, bis er sich meldet
    if (adresse === '/e/neustart') {
      const g = Number(f.generation), alt = this.generation;
      this.generation = g;
      if (g === alt) return;
      this.arr = null;
      for (const [k, w] of [...this.wartend]) { this.wartend.delete(k); w({ art: 'neustart' }); }
    }
  }

  private offen(): ProjOffen { return this.zugang.offen() ?? fehl('kein_projekt', 'no project is open'); }
  private pruefeSchreiben(): void { if (this.ctx.quelle() === 'cypher' && this.ctx.kiGestoppt()) fehl('ki_gestoppt', 'Stop Cypher is set'); }
  // S3-Fix G1: der Text nennt die Art des laufenden Laufs (Freeze, Export, Lautheitsmessung)
  private pruefeFrei(): void { if (this.lauf) fehl('beschaeftigt', `${LAUF_TEXT[this.lauf.art]} is running`); }
  private belege(l: AusgabeLauf): void {
    if (this.geschlossen) fehl('beschaeftigt', 'the server is shutting down');
    this.pruefeFrei();
    this.lauf = l;
    this.schritte = []; this.datei = null;
    this.zugang.ausgabeLauf(l);
  }
  // Fix-Runde S3 R1: jeder Fehler eines Laufs. Ein unerwarteter (Antwort 500 intern) geht ins Log wie in proj (bereich.ts alsAntwort); hat der
  // Lauf schon etwas gespeichert, trägt der Fehler das weiter (LaufFehler), damit die Antwort nicht „nothing was changed“ sagt.
  private nachFehler(e: unknown): unknown {
    const art = this.lauf?.art ?? 'export', schritte = [...this.schritte];
    if (alsAntwort(e).code === 500) {
      this.ctx.log({ typ: 'proj_fehler', bereich: 'proj-ausgabe', lauf: art, fehler: (e as Error)?.message ?? String(e), schritte, datei: this.datei });
    }
    return schritte.length || this.datei ? new LaufFehler(e, schritte, art, this.datei) : e;
  }
  private gib(): void { this.lauf = null; this.zugang.ausgabeLauf(null); }
  private sicht(p: Projekt, spurId: string): string | null {
    const s = sucheSpur(p, spurId);
    return s ? `${kanonisch(spurSicht(s, false))}@${p.tempo_bpm}` : null;
  }

  async freeze(d: Record<string, unknown>): Promise<{ rev: number; projekt: Projekt }> {
    for (const k of Object.keys(d)) if (k !== 'spur_id' && k !== 'an') fehl('argument_ungueltig', `unknown field ${k}`);
    const spurId = d.spur_id, an = d.an;
    if (typeof spurId !== 'string' || spurId === '') return fehl('argument_ungueltig', 'spur_id: a track id is required');
    if (typeof an !== 'boolean') return fehl('argument_ungueltig', 'an: true or false is required');
    this.pruefeSchreiben();
    const o = this.offen();
    const spur = sucheSpur(o.projekt, spurId) ?? fehl('spur_unbekannt', `there is no track ${spurId}`);
    if (!istWirt(spur)) fehl('keine_wirtspur', `${spur.name} is not a Surge track`);
    if (Boolean(spur.freeze) === an) return { rev: o.projekt.rev, projekt: o.projekt };   // schon so: kein Fehler, nichts geändert
    this.belege({ art: 'freeze', spur_id: spurId });
    try {
      if (!an) return await this.setze(spurId, null, `Unfreeze ${spur.name}`, null);
      return await this.friereEinUndSetze(spurId, spur.name);
    } catch (e) { throw this.nachFehler(e); } finally { this.gib(); }
  }

  // Der Produktions-Wirt arr1 (djk-instrumente --arr1) schreibt /dev/shm/cypherdj[-i]/wirt-arr1.json (wirt.py: name, pid, bereit, …). Fehlt der Wirt, spielt
  // im Kern keine Surge für Slot 1, und der Freeze wäre eine leere Datei ohne Fehlermeldung (Erhebung 2026-10-20). Darum lehnt der Freeze vorher ab.
  // Die Datei allein genügt nicht (S3-Fix W2): wirt.py und djk-stop löschen sie nie, sie bleibt mit bereit:true und toter pid liegen (wirtLebt()).
  private pruefeWirt(): void {
    const ordner = (this.opt.wirtOrdner ?? (() => wirtOrdnerVorgabe()))();
    if (!wirtLebt(path.join(ordner, 'wirt-arr1.json'))) {
      fehl('wirt_fehlt', 'the Surge host for the production slot (arr1) is not running; start it with djk-instrumente --arr1 and repeat');
    }
  }

  // Freeze an: Prüfungen, dann die Sperre (Spec 6.33: vor tempoAnMaster), Echtzeit-Durchlauf, Eintrag, Freigabe in jedem Ausgang
  private async friereEinUndSetze(spurId: string, name: string): Promise<{ rev: number; projekt: Projekt }> {
    const vorher = sucheSpur(this.offen().projekt, spurId) ?? fehl('spur_unbekannt', `there is no track ${spurId}`);
    const b = klingendeNoten(vorher) > 0 ? freezeBereich(vorher) : null;
    if (b === null) return fehl('spur_leer', `${vorher.name} has no notes that sound`);
    if (b.bis_beat - b.von_beat > FREEZE_MAX_BEATS) {
      fehl('zu_gross', `a freeze covers at most ${FREEZE_MAX_BEATS} beats (${vorher.name}: beat ${b.von_beat} to ${b.bis_beat})`);
    }
    if (this.arr === null) fehl('kein_kernstand', 'the core has not reported its arrangement state yet');
    if (this.arr.status !== 0) fehl('transport_laeuft', 'stop the transport first');
    this.pruefeWirt();
    const frei = this.zugang.sperreLaden();                             // wirft 409 beschaeftigt, solange ein Öffnen oder Anlegen läuft (6.32)
    try {
      await this.zugang.tempoAnMaster();                                 // das eingefrorene Audio ist in Sekunden fest: Master = Projekttempo
      const r = await this.friereEin(spurId, b);
      return await this.setze(spurId, r.freeze, `Freeze ${name}`, r.sicht);
    } catch (e) {
      this.verwirfFreezeDatei();
      throw e;
    } finally { this.freezeDatei = null; frei(); }
  }

  // Fix-Runde S3 R4: die Datei dieses Durchlaufs, die nie ins Projekt kam (veraltet, falsche Größe), bleibt nicht als Waise im Arbeitsordner. Nie
  // gelöscht wird eine Datei, auf die das Projekt oder ein Eintrag des Verlaufs (eine Undo-Stufe) zeigt. Fix-Runde 2 F1: nur eine Datei, die dieser
  // Durchlauf nachweislich selbst geschrieben hat (/e/freeze 0); bei /e/freeze 2 (es gab sie schon, K3 ersetzt nie), Abbruch, Frist, Stille,
  // Kern-Neustart und Server-Stopp ist freezeDatei null und nichts wird gelöscht. Grenze: schreibt ein Kern die Datei erst nach der Frist, bleibt sie.
  private verwirfFreezeDatei(): void {
    const name = this.freezeDatei;
    this.freezeDatei = null;
    if (name === null) return;
    const o = this.zugang.offen();
    if (!o) return;                                                      // RR1: ohne offenes Projekt nicht prüfbar, also bleibt die Datei
    if ((JSON.stringify(o.projekt).includes(name) || JSON.stringify(o.verlauf.eintraegeNach(-1)).includes(name))) return;
    try { fs.rmSync(path.join(this.zugang.arbeitsordner(), name), { force: true }); } catch (e) {
      this.ctx.log({ typ: 'proj_freeze_waise', datei: name, fehler: (e as Error).message });
    }
  }

  // Ein Echtzeit-Durchlauf im Kern (/k/arr/freeze, K3), Ergebnis: das Freeze-Feld (noch nicht im Projekt) und die Sicht der Spur zu Beginn.
  private async friereEin(spurId: string, b: { von_beat: number; bis_beat: number }): Promise<{ freeze: Freeze; sicht: string }> {
    const o = this.offen();
    const spur = sucheSpur(o.projekt, spurId) ?? fehl('veraltet', `track ${spurId} no longer exists`);
    const sicht = this.sicht(o.projekt, spurId) ?? fehl('veraltet', `track ${spurId} no longer exists`);
    if (this.arr === null || this.arr.nr !== o.projekt.wiedergabe_rev) {
      fehl('nicht_geladen', `the core plays arrangement ${this.arr?.nr ?? '-'}, the project is at ${o.projekt.wiedergabe_rev}`);
    }
    if (this.arr.status !== 0) fehl('transport_laeuft', 'stop the transport first');
    const arbeitsordner = this.zugang.arbeitsordner();
    const nr = spur.nr, kennung = this.zugang.naechsteNummer();         // Spec 6.25: aus dem einen Zähler der Instanz, nie zweimal
    if (!Number.isInteger(kennung) || kennung < 0 || kennung > KENNUNG_MAX) fehl('zu_gross', `freeze ids of this instance are used up (${kennung})`);
    const fristMs = Math.ceil((b.bis_beat - b.von_beat + FREEZE_NACHLAUF_BEATS + 4) * 60_000 / o.projekt.tempo_bpm) + (this.opt.zugabeMs ?? 5000);
    const ende = this.warteAufFreeze(nr, kennung, fristMs);             // vor dem Senden: /e/freeze darf nicht vorbeilaufen
    let id = -1;
    try {
      id = this.ctx.sende('/k/arr/freeze', { quelle: this.ctx.quelle(), spur: nr, von_beat: b.von_beat, bis_beat: b.bis_beat, kennung });
      this.abbruch.set(id, '');
      const q = await this.ctx.warteQuittung(id);
      if (q === null) fehl('kein_kernstand', 'no answer from the core to /k/arr/freeze');
      if (q.status === 6 || q.status === 7) freezeAbgelehnt(q.grund);
      const e = await ende.versprechen;
      if (e.art === 'neustart') fehl('freeze_fehler', 'the core restarted during the freeze; nothing was saved');
      if (e.art === 'geschlossen') fehl('freeze_fehler', 'the server is shutting down; the freeze was abandoned and nothing was saved');
      if (e.art === 'stille') fehl('freeze_fehler', `no message from the core for ${this.opt.stilleMs ?? 2000} ms (core lost?); nothing was saved`);
      if (e.art === 'frist') fehl('freeze_fehler', `no /e/freeze within ${fristMs} ms; nothing was saved`);
      if (e.status !== 0) {
        const g = this.abbruch.get(id) ?? '';
        if (g) freezeAbgelehnt(g);
        fehl('freeze_fehler', e.status === 1 ? 'the core aborted the freeze; nothing was saved' : 'the core did not write the freeze file; nothing was saved');
      }
      this.freezeDatei = freezeDateiName(nr, kennung);                   // /e/freeze 0: der Kern hat sie für diesen Lauf geschrieben (R4, F1)
      const sha256 = await pruefeFreezeDatei(arbeitsordner, nr, kennung, e.frames);
      return { freeze: { datei: freezeDateiName(nr, kennung), frames: e.frames, kennung, sha256, von_beat: b.von_beat }, sicht };
    } finally {
      ende.weg();
      this.abbruch.delete(id);
    }
  }

  // Wartet auf /e/freeze dieses Freeze, längstens die Frist; ein neuer Kern (ereignis) oder Stille (keine Meldung des Kerns) beendet früher
  private warteAufFreeze(spur: number, kennung: number, fristMs: number): { versprechen: Promise<FreezeEnde>; weg: () => void } {
    const k = `${spur}:${kennung}`, stilleMs = this.opt.stilleMs ?? 2000;
    let uhr: ReturnType<typeof setTimeout> | undefined, takt: ReturnType<typeof setInterval> | undefined;
    this.letzteMeldungMs = Date.now();                                   // die Stille zählt ab dem Senden
    const versprechen = new Promise<FreezeEnde>((ok) => {
      const ende = (e: FreezeEnde): void => { clearTimeout(uhr); clearInterval(takt); this.wartend.delete(k); ok(e); };
      this.wartend.set(k, ende);
      uhr = setTimeout(() => ende({ art: 'frist' }), fristMs);
      takt = setInterval(() => { if (Date.now() - this.letzteMeldungMs > stilleMs) ende({ art: 'stille' }); }, Math.min(250, Math.max(10, stilleMs / 4)));
    });
    return { versprechen, weg: () => { clearTimeout(uhr); clearInterval(takt); this.wartend.delete(k); } };
  }

  // Freeze setzen oder verwerfen als eine undo-fähige Änderung. `sicht`: die Spur muss noch so sein wie beim Start des Freeze.
  private async setze(spurId: string, freeze: Freeze | null, label: string, sicht: string | null): Promise<{ rev: number; projekt: Projekt }> {
    const o = this.offen();
    if (!sucheSpur(o.projekt, spurId)) fehl('veraltet', `track ${spurId} no longer exists`);
    if (sicht !== null && this.sicht(o.projekt, spurId) !== sicht) fehl('veraltet', 'notes, device or tempo changed during the freeze; nothing was saved');
    const meta: Meta = { quelle: this.ctx.quelle(), label };
    const w = aendereStand(o.verlauf, o.projekt, setzeFreeze(o.projekt, spurId, freeze), meta, this.zugang.haken());
    if (w.eintrag !== null) {
      if (freeze !== null) this.freezeDatei = null;                      // RR1: ab hier zeigt project.json auf die Datei, sie gehört dem Projekt
      this.schritte.push({ rev: w.projekt.rev, label });                 // gespeichert: ab hier stimmt „nothing was changed“ nicht mehr (R1)
      await this.zugang.uebernimm(w, meta);
    }
    const jetzt = this.offen();
    return { rev: jetzt.projekt.rev, projekt: jetzt.projekt };
  }

  // Prüfungen von Export und Lautheit: nur von_beat und bis_beat, Bereich 1 bis EXPORT_MAX_BEATS Beats ab Beat 0 (Vorgabe: Loop-Klammer), kein anderer
  // Lauf, kein Transport, kein Audio in Vorbereitung.
  private pruefeBereich(d: Record<string, unknown>): { von: number; bis: number } {
    for (const k of Object.keys(d)) if (k !== 'von_beat' && k !== 'bis_beat') fehl('argument_ungueltig', `unknown field ${k}`);
    for (const k of ['von_beat', 'bis_beat']) {
      if (d[k] !== undefined && (typeof d[k] !== 'number' || !Number.isFinite(d[k]))) fehl('argument_ungueltig', `${k}: a number is required`);
    }
    this.pruefeSchreiben();
    const o = this.offen();
    const von = (d.von_beat as number | undefined) ?? o.projekt.loop.von_beat, bis = (d.bis_beat as number | undefined) ?? o.projekt.loop.bis_beat;
    if (!(von >= 0) || !(bis - von >= 1) || bis - von > EXPORT_MAX_BEATS) {
      fehl('export_bereich', `beat ${von} to ${bis}: the export starts at beat 0 or later and is 1 to ${EXPORT_MAX_BEATS} beats long`);
    }
    this.pruefeFrei();                                                   // ein laufender Freeze meldet Status 3: beschaeftigt, nicht transport_laeuft
    if (this.arr && this.arr.status !== 0) fehl('transport_laeuft', 'stop the transport first');
    const fehlt = fehlendesAudio(o.projekt, von, bis);
    if (fehlt.length) fehl('audio_fehlt', `audio clip ${fehlt.join(', ')} is still being prepared; try again in a moment`);
    return { von, bis };
  }

  // Spec 2.5: Wirt-Spuren vorher einfrieren, eine nach der anderen (mit Sperre wie /proj/freeze, Spec 6.23, 6.33), dann die Export-Wiedergabe schreiben
  // (nie geladen; der Aufrufer löscht die Datei). was: für die Meldung „new notes … during the <was>“.
  private async friereEinUndSchreibe(was: string): Promise<{ jetzt: ProjOffen; p: Projekt; w: { nr: number; datei: string } }> {
    for (const id of this.offen().projekt.spuren.map((s) => s.id)) {
      const s = sucheSpur(this.offen().projekt, id);
      if (!s || !brauchtFreeze(s)) continue;
      await this.friereEinUndSetze(id, s.name);
    }
    const jetzt = this.offen();
    const p = jetzt.projekt;
    const offen = p.spuren.filter(brauchtFreeze).map((s) => s.name);
    if (offen.length) fehl('veraltet', `new notes on ${offen.join(', ')} during the ${was}; nothing was written`);
    return { jetzt, p, w: this.zugang.schreibeWiedergabe(exportSicht(p)) };
  }

  async exportiere(d: Record<string, unknown>): Promise<ExportAntwort> {
    const { von, bis } = this.pruefeBereich(d);
    this.belege({ art: 'export' });
    try {
      const { jetzt, p, w } = await this.friereEinUndSchreibe('export');
      const ordner = path.join(jetzt.ordner, 'export');
      let r: RenderAntwort, ziel: string;
      try {
        fs.mkdirSync(ordner, { recursive: true });
        ziel = exportZiel(ordner, jetzt.slug, (this.opt.jetzt ?? (() => new Date()))());
        const teil = `${ziel}.${process.pid}.teil`, regler = path.join(ordner, `.regler-${process.pid}.json`);
        const dauerMs = (bis - von) * 60_000 / p.tempo_bpm;
        try {                                                             // R4: auch eine halb geschriebene Regler-Datei geht im finally weg
          fs.writeFileSync(regler, JSON.stringify(reglerAusProjekt(p))); // Spec 6.20: immer als Datei mit
          this.renderAbbruch = new AbortController();
          if (this.geschlossen) this.renderAbbruch.abort();               // RR3: schliesse() kam während des Freeze, kein Render mehr
          r = await rendere({ programm: (this.opt.render ?? (() => [renderProgramm()]))(), nr: w.nr, von_beat: von, bis_beat: bis, bpm: p.tempo_bpm,
            aus: teil, arbeitsordner: this.zugang.arbeitsordner(), spurRegler: regler, instanz: (this.opt.instanz ?? instanz)(),
            zeitlimitMs: Math.ceil(4 * dauerMs) + 60_000, abbruch: this.renderAbbruch.signal });
          fs.linkSync(teil, ziel);                                        // nie ersetzen (wie der Render, Spec 6.25): link schlägt fehl, wenn es ziel gibt
          this.datei = ziel;
        } finally {
          this.renderAbbruch = null;
          fs.rmSync(teil, { force: true });
          fs.rmSync(regler, { force: true });
        }
      } finally {
        fs.rmSync(w.datei, { force: true });                             // die Export-Wiedergabe verdrängt sonst die geladene (BEHALTE 5)
      }
      const lautheit = await messeLautheit(ziel, this.opt.ffmpeg);
      const antwort: ExportAntwort = { datei: ziel, frames: r.frames, spitze_db: r.spitze_db, regler_quelle: r.regler_quelle, ...lautheit };
      this.ctx.log({ typ: 'proj_export', slug: jetzt.slug, nr: w.nr, von_beat: von, bis_beat: bis, ...antwort });
      return antwort;
    } catch (e) { throw this.nachFehler(e); } finally { this.gib(); }
  }

  // Paket 1.18, E-b (POST /proj/lautheit): Lautheit je belegter Spur und als Summe, offline, auf Anfrage. Gleicher Anfang wie der Export (Bereich, Wirt-
  // Spuren einfrieren, Export-Wiedergabe). Ein Render je Spur mit --ohne-zustand und einer Regler-Datei, in der alle anderen Spuren stumm stehen
  // (Fader und Pan der Spur aus dem Projekt, Master wie ein frisch gestarteter Kern, der Limiter bleibt), dazu ein Render aller Spuren für die Summe
  // mit den Reglern des Projekts. Eine Spur mit Mute, Fader aus oder (bei irgendeinem Solo im Projekt) ohne Solo wird nicht gerendert (stumm: true). Unter
  // STILLE_DB Spitze sind die Zahlen null; liegt die Lautheit auf dem Gate-Boden von ffmpeg, ist lufs_i null und unter_messgrenze true (S3-Fix G2).
  async lautheit(d: Record<string, unknown>): Promise<LautheitAntwort> {
    const { von, bis } = this.pruefeBereich(d);
    this.belege({ art: 'lautheit' });
    let tmp: string | null = null;
    try {
      const { jetzt, p, w } = await this.friereEinUndSchreibe('loudness measurement');
      try {
        const dir = tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-lautheit-'));
        const dauerMs = (bis - von) * 60_000 / p.tempo_bpm;
        this.renderAbbruch = new AbortController();
        if (this.geschlossen) this.renderAbbruch.abort();
        const render = async (name: string, regler: Record<string, number>): Promise<{ r: RenderAntwort; l: Lautheit; unter: boolean }> => {
          const datei = path.join(dir, `${name}.json`), aus = path.join(dir, `${name}.wav`);
          fs.writeFileSync(datei, JSON.stringify(regler));
          const r = await rendere({ programm: (this.opt.render ?? (() => [renderProgramm()]))(), nr: w.nr, von_beat: von, bis_beat: bis, bpm: p.tempo_bpm,
            aus, arbeitsordner: this.zugang.arbeitsordner(), spurRegler: datei, ohneZustand: true, instanz: (this.opt.instanz ?? instanz)(),
            zeitlimitMs: Math.ceil(4 * dauerMs) + 60_000, abbruch: this.renderAbbruch!.signal });
          return { r, ...(r.spitze_db <= STILLE_DB ? { l: OHNE_LAUTHEIT, unter: false } : untermessgrenze(await messeLautheit(aus, this.opt.ffmpeg))) };
        };
        const spuren: SpurLautheit[] = [];
        const solo = p.spuren.some((x) => x.solo);                        // S3-Fix G3: mit irgendeinem Solo im Projekt klingt im Mix nur, was Solo trägt
        for (const s of belegteSpuren(p, von, bis)) {
          const kopf = { spur_id: s.id, nr: s.nr, name: s.name };
          if (s.mute || s.fader_db <= STUMM_GRENZE || (solo && !s.solo)) {
            spuren.push({ ...kopf, ...OHNE_LAUTHEIT, spitze_db: -200, stumm: true, unter_messgrenze: false });
            continue;
          }
          const { r, l, unter } = await render(`spur-${s.nr}`, reglerEinzeln(s));
          spuren.push({ ...kopf, ...l, spitze_db: r.spitze_db, stumm: r.spitze_db <= STILLE_DB, unter_messgrenze: unter });
        }
        const sum = await render('summe', reglerAusProjekt(p));
        const antwort: LautheitAntwort = { von_beat: von, bis_beat: bis, spuren,
          summe: { ...sum.l, spitze_db: sum.r.spitze_db, unter_messgrenze: sum.unter, regler_quelle: sum.r.regler_quelle } };
        this.ctx.log({ typ: 'proj_lautheit', slug: jetzt.slug, nr: w.nr, von_beat: von, bis_beat: bis, spuren: spuren.length });
        return antwort;
      } finally {
        this.renderAbbruch = null;
        fs.rmSync(w.datei, { force: true });                             // die Export-Wiedergabe verdrängt sonst die geladene (BEHALTE 5)
        if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
      }
    } catch (e) { throw this.nachFehler(e); } finally { this.gib(); }
  }
}

async function leseKoerper(q: http.IncomingMessage): Promise<Record<string, unknown>> {
  try { return await koerper(q); } catch (e) {                         // RR2: http/transport.ts meldet deutsch, der text bleibt englisch (6.34)
    const m = (e as Error).message;
    throw new AusgabeFehler('argument_ungueltig', m === 'zu groß' ? 'unreadable request body (larger than 32 KiB)'
      : m === 'kein Objekt' ? 'unreadable request body (not a JSON object)' : 'unreadable request body (no valid JSON)');
  }
}

export function ausgabeBereich(ctx: BereichKontext, zugang: ProjZugang, opt: AusgabeOptionen = {}): Bereich & { ausgabe: Ausgabe } {
  for (const m of ZUGANG_METHODEN) {
    if (typeof (zugang as unknown as Record<string, unknown> | undefined)?.[m] !== 'function') {
      throw new Error(`proj-ausgabe: der ProjZugang der S2-Integration hat kein ${m}() (bereiche/proj/bereich.ts)`);
    }
  }
  const a = new Ausgabe(ctx, zugang, opt);
  type Handler = (q: http.IncomingMessage, r: http.ServerResponse) => Promise<void>;
  const antworte = (f: (d: Record<string, unknown>, kurz: boolean) => Promise<unknown>): Handler => async (q, r) => {
    const kurz = new URL(q.url ?? '/', 'http://seite').searchParams.get('antwort') === 'kurz';
    try { json(r, 200, await f(await leseKoerper(q), kurz)); } catch (e) { const x = alsAntwort(e); json(r, x.code, x.body); }
  };
  return {
    name: 'proj-ausgabe',
    ausgabe: a,
    routen: () => [
      { methode: 'POST', pfad: '/proj/freeze', schutz: 'fremdePost', handler: antworte(async (d, kurz) => {
        const x = await a.freeze(d);
        return kurz ? kurzeFreezeAntwort(x, d.spur_id as string) : x;
      }) },
      { methode: 'POST', pfad: '/proj/export', schutz: 'fremdePost', handler: antworte((d) => a.exportiere(d)) },
      { methode: 'POST', pfad: '/proj/lautheit', schutz: 'fremdePost', handler: antworte((d) => a.lautheit(d)) },
    ],
    ereignis: (adresse, felder) => a.ereignis(adresse, felder),
  };
}
