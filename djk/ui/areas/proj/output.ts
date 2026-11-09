// D1 S3: Bereich proj-ausgabe mit POST /proj/freeze und POST /proj/export (Spec 3.4, 2.5, 2.9, 6.2, 6.14, 6.20, 6.23, 6.25, 6.32, 6.33, 6.34, R9).
// Dockt wie jeder Bereich nur über den BereichKontext an (Spec 2.10) und über den ProjZugang der S2-Integration (area.ts: offenes Projekt,
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
// 1.10 Slice 2 (E2): POST /proj/export nimmt abgriff (produktion | set, Vorgabe produktion) und schickt immer ausdrücklich --abgriff an den Render; die Antwort
// nennt abgriff, ueber_decke und limiter_db_max. Sagt der Render einen anderen Abgriff, ist es ein render_fehler (render.ts leseRenderAntwort, P11).
// Lautheit je Spur (Paket 1.18, E-b, POST /proj/lautheit): derselbe Anfang (Bereich, Wirt-Freeze, Export-Wiedergabe), dann ein Render je belegter Spur
// ohne Neustart-Zustand des Kerns (--ohne-zustand): die Regler kommen allein aus einer Datei, in der alle anderen Spuren stumm stehen, dazu ein Render
// aller Spuren für die Summe. Die WAVs liegen in einem temporären Ordner und gehen im finally weg.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import type { Bereich, BereichKontext } from '../../http/router.ts';
import { json, koerper } from '../../http/transport.ts';
import { grundText } from '../../http/reasons.ts';
import { instanz, renderProgramm, wirtOrdnerVorgabe } from '../../paths.ts';
import { wirtStand } from './host.ts';
import {
  KENNUNG_MAX, alleInserts, MAX_SPUREN, SAMPLERATE, kanonisch, spurSicht, sucheSpur,
  wirtSlots, type Clip, type Freeze, type Gruppe, type Projekt, type Return, type Spur } from '../../project/model.ts';
import { istModulation } from '../../project/envelope.ts';
import type { Meta } from '../../project/history.ts';
import { aendereStand, StandFehler } from '../../project/state.ts';
import {
  brauchtFreeze, freezeBereich, freezeDateiName, FreezeFehler, FREEZE_MAX_BEATS, FREEZE_NACHLAUF_BEATS, istWirt, klingendeNoten,
  pruefeFreezeDatei, setzeFreeze,
} from '../../project/freeze.ts';
import {
  reglerAusProjekt, routingRegler, rendere, RenderFehler, schluesselPlan, schluesselReturns, type Abgriff, type Pfad, type RenderAntwort, type SchluesselPlan,
} from '../../project/render.ts';
import { messeLautheit, type Lautheit } from '../../project/loudness.ts';
import {
  baueMergeProjekt, MergeFehler, mergePlan, mergeRegler, mergeWiedergabe, pruefeMergeNochGleich,
} from '../../project/merge.ts';
import {
  baueResampleProjekt, pruefeResampleNochGleich, ResampleFehler, resamplePlan, wirtSpurenImStrang, type ResamplePlan,
} from '../../project/resample.ts';
import { schreibeWavAusF32Stueckweise } from '../../project/recording.ts';
import { baueBounceProjekt, bouncePlan, bounceRegler, bounceWiedergabe, pruefeBounceNochGleich, type BounceArt } from '../../project/bounce.ts';
import type { AusgabeLauf, ProjZugang } from './area.ts';
import { grundCode } from './mapping.ts';
import { ProjFehler } from './session.ts';

export type { ProjZugang };
type ProjOffen = NonNullable<ReturnType<ProjZugang['offen']>>;
// Was S3 vom ProjZugang der S2-Integration braucht (area.ts; Plan S3 „vorausgesetzte Schnittstellen“, nach S2int berichtigt)
export const ZUGANG_METHODEN = ['offen', 'arbeitsordner', 'haken', 'uebernimm', 'schreibeWiedergabe', 'naechsteNummer', 'tempoAnMaster',
  'sperreLaden', 'ausgabeLauf', 'beendeVorhoeren'] as const;

export interface AusgabeOptionen {
  zugabeMs?: number;              // Frist eines Freeze über seine Dauer hinaus (Vorgabe 5000, K3-Plan: Länge plus 5 s)
  stilleMs?: number;              // so lange ohne jede Meldung des Kerns während eines Freeze heißt: Kern verloren (Vorgabe 2000)
  render?: () => string[];        // Programm des Renders (Vorgabe [pfade.renderProgramm()], Tests: das Doppel)
  instanz?: () => string;         // Instanz für den Render (Vorgabe pfade.instanz())
  jetzt?: () => Date;             // Uhr für den Dateinamen (Vorgabe new Date())
  ffmpeg?: string[];              // ffmpeg für die Lautheit (Vorgabe ['ffmpeg'])
  wirtOrdner?: () => string;      // Ordner der Wirt-Status-Dateien (Vorgabe pfade.wirtOrdnerVorgabe(), der Server gibt seinen mit)
  zeitlimitMs?: number;           // Test-Haken: Zeitlimit des Merge-Renders (Vorgabe 4 · Dauer + 60 s)
}

const STATUS: Record<string, number> = {
  argument_ungueltig: 400, export_bereich: 400, spur_unbekannt: 400, keine_wirtspur: 400, spur_leer: 400, zu_gross: 400,
  kein_projekt: 409, ki_gestoppt: 409, beschaeftigt: 409, transport_laeuft: 409, nicht_geladen: 409, kein_kernstand: 409, deck_laeuft: 409,
  audio_fehlt: 409, veraltet: 409, wirt_fehlt: 409, wirt_fehler: 409, wirt_spiegel_fehler: 409,
  merge_leer: 409, merge_gruppen: 409, merge_teil_solo: 409, merge_sends: 409, merge_inserts: 409, merge_freeze_noetig: 409, merge_andreas_spur: 409,
  merge_keine_spur_frei: 409,
  resample_leer: 409, resample_fehler: 502,                                  // 1.10 slice 7 (T6)
  freeze_fehler: 502, render_fehler: 502,
  bounce_nur_audio: 409, bounce_ziel_art: 409, takes_voll: 409, ersetzen_loop: 409, gruppe_unbekannt: 400,   // 1.14 slice 4 (spec D12)
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
  if (e instanceof AusgabeFehler || e instanceof FreezeFehler || e instanceof MergeFehler || e instanceof ResampleFehler) {
    return { code: STATUS[e.grund] ?? 409, body: mit(e.grund, e.text) };
  }
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

// 1.10 slice 7: the refusal (/q 6) or abort (/q 7) reasons of the core's tap /k/arr/abgriff as an answer (the reasons are those of net_arr_tap.cpp
// and Arrangement::abgriff: ki_gestoppt, nicht_geladen, ueberlappung, tempo_rampe, zu_gross, ausserhalb_bereich, spur_bereich, abbruch, ki_stopp)
function abgriffAbgelehnt(grund: string): never {
  if (grund === 'ki_gestoppt' || grund === 'ki_stopp') return fehl('ki_gestoppt', 'Stop Cypher is set');
  if (grund === 'nicht_geladen') return fehl('nicht_geladen', 'the core has not loaded the current arrangement');
  if (grund === 'ueberlappung') return fehl('transport_laeuft', 'the core is playing, freezing or already tapping; stop the transport first');
  if (grund === 'tempo_rampe') return fehl('beschaeftigt', 'the core is still ramping the tempo; a resample waits until the ramp is done');
  if (grund === 'zu_gross') return fehl('zu_gross', 'the core accepts at most 256 beats for a resample');
  if (grund === 'abbruch') {
    return fehl('resample_fehler', 'the core aborted the resample (transport start or stop, loading, hand key or a tempo ramp); nothing was saved');
  }
  return fehl('resample_fehler', `the core refused the resample (${grund || 'no reason given'}); nothing was saved`);
}

// Peak of a finished tap file (float32 L/R interleaved) in dBFS, read in a stream; -200 for an all-zero file
export async function spitzeDbVonF32(datei: string): Promise<number> {
  let spitze = 0, rest: Buffer = Buffer.alloc(0);
  for await (const teil of fs.createReadStream(datei)) {
    const b = rest.length ? Buffer.concat([rest, teil as Buffer]) : teil as Buffer;
    const n = b.length - (b.length % 4);
    for (let i = 0; i < n; i += 4) { const x = Math.abs(b.readFloatLE(i)); if (x > spitze) spitze = x; }
    rest = b.subarray(n);
  }
  return spitze > 0 ? 20 * Math.log10(spitze) : -200;
}

export { wirtLebt } from './host.ts';

export const EXPORT_MAX_BEATS = 1024;

// sha256 über die ganze Datei, im Strom (Vorbild freeze.ts pruefeFreezeDatei)
export async function sha256Datei(datei: string): Promise<string> {
  const h = crypto.createHash('sha256');
  for await (const teil of fs.createReadStream(datei)) h.update(teil as Buffer);
  return h.digest('hex');
}

// Export-Wiedergabe: Wirt-Spuren ohne Freeze sind hier stumm (sonst wären sie vorher eingefroren worden) und fehlen, denn der Render lehnt jede
// Wirt-Spur ab (K3, Rückgabe 5).
// Slice 2 (E10), as a pure function: the export view of `p` without the lanes of every track but `s` (its own stay), or null when no other track has a
// lane (the shared export playback is already right then). 1.12 slice 5 (D9): the modulation envelopes of other tracks' clips become relative lanes, so
// they count as lanes here and are stripped too (gain and transpose envelopes are the clip's own sound and stay).
const modulierend = (c: Clip): boolean => (c.huellkurven ?? []).some((h) => istModulation(h.ziel));
// 1.10 T9: `behalte` = the tracks of the key plan (schluesselPlan): they run for a key, so their lanes stay too, or the key would differ from the mix.
export function ohneFremdeLanen(p: Projekt, s: Spur, behalte: readonly Spur[] = []): Projekt | null {
  const bleibt = (x: Spur): boolean => x.id === s.id || behalte.some((b) => b.id === x.id);
  if (!p.spuren.some((x) => !bleibt(x) && (x.automation?.length || x.clips.some(modulierend)))) return null;
  const q = exportSicht(p);
  for (const x of q.spuren) {
    if (bleibt(x)) continue;
    delete x.automation;
    x.clips = x.clips.map((c) => {
      if (!modulierend(c)) return c;
      const rest = (c.huellkurven ?? []).filter((h) => !istModulation(h.ziel));
      const ohne = { ...c };
      delete ohne.huellkurven;
      return rest.length ? { ...ohne, huellkurven: rest } : ohne;
    });
  }
  return q;
}
export function exportSicht(p: Projekt): Projekt {
  const q = structuredClone(p);
  q.spuren = q.spuren.filter((s) => !(istWirt(s) && !s.freeze));
  return q;
}

// Audio-Clips im Bereich [von, bis), die noch nicht dekodiert sind: der Übersetzer ließe sie weg (Spec 2.8),
// der Export klänge anders. Stumme Clips lässt der Übersetzer ohnehin weg (D12), sie fehlen nicht.
export function fehlendesAudio(p: Projekt, von: number, bis: number): string[] {
  const aus: string[] = [];
  for (const s of p.spuren) for (const c of s.clips) {
    if (c.art === 'audio' && !c.stumm && c.dekodiert !== 'fertig' && c.start_beat < bis && c.start_beat + c.laenge_beats > von) aus.push(c.id);
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

// 1.10 Slice 2 (E2): abgriff = wo der Render den Ton abgriff (produktion: PM-Ausgang vor dem Set-Limiter, set: Ring hinter dem Limiter), ueber_decke =
// die Sample-Spitze des Exports liegt über der Limiter-Decke (P10), limiter_db_max = größte Absenkung des Set-Limiters während des Renders
// (positive dB, 0 = griff nie ein).
export type ExportAntwort = Pick<RenderAntwort, 'frames' | 'spitze_db' | 'regler_quelle'>
  & { datei: string; abgriff: Abgriff; ueber_decke: boolean; limiter_db_max: number; dj_schluessel?: true } & Lautheit;
// 1.10 slice 5 (plan E7): a stage keyed by a DJ input (deck/1..4, erz/1) hears nothing in an export (no deck plays in the render): the answer says so,
// only when it is true
export const hatDjSchluessel = (p: Projekt): boolean => alleInserts(p).some((x) => x.insert.key?.quelle === 'deck' || x.insert.key?.quelle === 'erz');

// Paket 1.18, E-b. Unter dieser Spitze (dBFS) gilt ein Render als Stille: die Lautheit ist null, nicht der Gate-Boden −70 von ffmpeg.
export const STILLE_DB = -90;
const STUMM_GRENZE = -120;          // INTERFACES §1.2: jeder Fader-Wert ≤ −120 dB ist stumm
const RUHE_WARTE_MS = 3000;   // longest wait for the core's report "stopped" between two freezes of one export (1.9 U3)
const OHNE_LAUTHEIT: Lautheit = { lufs_i: null, lra: null, true_peak_dbtp: null };
// S3-Fix G2: ffmpeg (ebur128) meldet −70.0 LUFS, wenn kein Block das absolute Gate −70 passiert: das ist der Boden, keine Messung. Eine solche leise,
// aber nicht stille Spur (Spitze über STILLE_DB) bekommt lufs_i null und lra null (LRA 0 wäre erfunden), den gemessenen True Peak und unter_messgrenze true.
const GATE_BODEN_LUFS = -70;
export function untermessgrenze(l: Lautheit): { l: Lautheit; unter: boolean } {
  if (l.lufs_i === null || l.lufs_i > GATE_BODEN_LUFS) return { l, unter: false };
  return { l: { lufs_i: null, lra: null, true_peak_dbtp: l.true_peak_dbtp }, unter: true };
}
export interface SpurLautheit extends Lautheit { spur_id: string; nr: number; name: string; spitze_db: number; stumm: boolean; unter_messgrenze: boolean }
// 1.10 T10 (AK24): the entry of a group (its members, the group strip, its target chain and the returns they feed)
// or of a return (as the mix feeds it, wet only)
export type GruppenLautheit = Lautheit & { nr: number; name: string; spitze_db: number; stumm: boolean; unter_messgrenze: boolean }
  & ({ gruppe_id: string; return_id?: never } | { return_id: string; gruppe_id?: never });
export interface LautheitAntwort {
  von_beat: number; bis_beat: number;
  spuren: SpurLautheit[];
  summe: Lautheit & { spitze_db: number; unter_messgrenze: boolean; regler_quelle: RenderAntwort['regler_quelle'] };
  gruppen: GruppenLautheit[];
  returns: GruppenLautheit[];
}

// Paket 1.13 Slice 7 (D1): Antwort von POST /proj/zusammenfuehren. hinweis quellen_laenger: Inhalt einer Quelle liegt außerhalb von von..bis (D8).
export interface ZusammenfuehrAntwort {
  rev: number; projekt: Projekt; spur_id: string; quellen: string[]; datei: string; frames: number;
  lanes_verworfen: number; hinweis?: 'quellen_laenger';
}

// Package 1.14 slice 4 (spec R10): answer of POST /proj/bounce. spur_id = the track that received the clip; take_id = the lane "Before bounce" (an_ort);
// lanes_verworfen and hinweis as the merge (neue_spur only).
export interface BounceAntwort {
  art: BounceArt; rev: number; projekt: Projekt; spur_id: string; clip_id: string; datei: string; frames: number; quellen: string[];
  take_id?: string; lanes_verworfen?: number; hinweis?: 'quellen_laenger';
}

// 1.10 slice 7: the answer is always narrow (no projekt, spec 6.31): the new track, its clip, the WAV and what was tapped
export interface ResampleAntwort {
  rev: number; spur_id: string; clip_id: string; datei: string; frames: number; quelle: string; punkt: 'pre' | 'post'; von_beat: number; bis_beat: number;
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
// Does the mix silence this track from the project's own state (mute, fader off, a solo elsewhere)? 1.10: a group solo counts, a member of a solo group sounds.
export function stummImMix(p: Projekt, s: Spur): boolean {
  const gruppen = p.gruppen ?? [];
  const solo = p.spuren.some((x) => x.solo) || gruppen.some((g) => g.solo);
  const gruppenSolo = !!s.ausgang && gruppen.some((g) => g.id === s.ausgang!.id && g.solo);
  return s.mute || s.fader_db <= STUMM_GRENZE || (solo && !s.solo && !gruppenSolo);
}

// the controls of the key sources of a plan (see reglerEinzeln): the tracks follow the project's own state, the key groups take fader, pan and mute from it
function schluesselRegler(p: Projekt, sl: SchluesselPlan, r: Record<string, number>): void {
  for (const t of sl.spuren) spurGrund(p, t, r);
  const solo = p.spuren.some((x) => x.solo) || (p.gruppen ?? []).some((x) => x.solo);
  for (const g of sl.gruppen) {
    const mitSolo = g.solo || p.spuren.some((m) => m.solo && m.ausgang?.id === g.id);
    r[`grp/${g.nr}/fader`] = g.fader_db; r[`grp/${g.nr}/pan`] = g.pan; r[`grp/${g.nr}/mute`] = g.mute || (solo && !mitSolo) ? 1 : 0;
  }
}
const hatLane = (t: Spur): boolean => (t.automation ?? []).some((l) => l.ziel === 'fader' || l.ziel === 'mute' || l.ziel === 'solo');
// a track that runs in an isolated render: the base value of its mute is the project's own state, except for a track with a fader/mute/solo lane (the lane can
// un-mute it, E10: then the track's own mute only)
function spurGrund(p: Projekt, t: Spur, r: Record<string, number>): void {
  r[`spur/${t.nr}/mute`] = (hatLane(t) ? t.mute : stummImMix(p, t)) ? 1 : 0; r[`spur/${t.nr}/fader`] = t.fader_db; r[`spur/${t.nr}/pan`] = t.pan;
}

// 1.10 T10: does the mix silence this group from the project's own state (mute, fader off, a solo elsewhere)? A solo on one of its members keeps it sounding.
export function gruppeStummImMix(p: Projekt, g: Gruppe): boolean {
  const solo = p.spuren.some((x) => x.solo) || (p.gruppen ?? []).some((x) => x.solo);
  const mitSolo = g.solo || p.spuren.some((m) => m.solo && m.ausgang?.id === g.id);
  return g.mute || g.fader_db <= STUMM_GRENZE || (solo && !mitSolo);
}
// 1.10 T10: does the mix silence this return (mute, fader off, a solo on another return)? A solo on a track or group does not silence a return (P7).
export function returnStummImMix(p: Projekt, x: Return): boolean {
  return x.mute || x.fader_db <= STUMM_GRENZE || ((p.returns ?? []).some((y) => y.solo) && !x.solo);
}
// 1.10 T10: the members of a group, the strips of its entry
export const mitgliederVon = (p: Projekt, g: Gruppe): Spur[] => p.spuren.filter((m) => m.ausgang?.id === g.id);
// 1.10 T10 (AK24): the controls for the render of ONE group: its members run as the mix has them (mute, fader, pan; the project's solo decides through
// stummImMix), every other track is muted, the group strip with its fader, balance and fade, the master, the returns the members and the group feed, and
// the key sources of the stages on that path (schluesselPlan of the whole path). The same mechanics as a track entry with several tracks.
export function reglerGruppe(g: Gruppe, p: Projekt): Record<string, number> {
  const r: Record<string, number> = {};
  for (let n = 1; n <= MAX_SPUREN; n++) { r[`spur/${n}/mute`] = 1; r[`spur/${n}/solo`] = 0; }
  // a return solo elsewhere does not act in a group entry: routingRegler sets solo 0 (the T9 convention of the isolated renders)
  const pfad: Pfad = { spuren: mitgliederVon(p, g), gruppe: g };
  const sl = schluesselPlan(p, pfad);
  for (const t of pfad.spuren) spurGrund(p, t, r);
  schluesselRegler(p, { ...sl, gruppen: [...sl.gruppen, g] }, r);   // the group strip itself: fader, pan and the mix's mute (mute, a solo elsewhere)
  if ((p.master?.fader_db ?? 0) !== 0) r['pm/fader'] = p.master.fader_db;
  Object.assign(r, routingRegler(p, { nur: pfad, schluessel: sl }));
  return r;
}
// 1.10 T10 (AK24): the controls for the render of ONE return as the mix feeds it: the controls of the project (tracks, groups, master, solo),
// every other return muted, except the key returns of the stages on the path (schluesselReturns): they keep the project's mute and run through the
// mask. The render runs with --trocken-aus, so only the wet part is left.
export function reglerReturn(x: Return, p: Projekt): Record<string, number> {
  const r = reglerAusProjekt(p);
  const schl = new Set(schluesselReturns(p, x).map((y) => y.id));
  for (const y of p.returns ?? []) if (y.id !== x.id && !schl.has(y.id)) r[`ret/${y.nr}/mute`] = 1;
  return r;
}

export function reglerEinzeln(s: Spur, p?: Projekt): Record<string, number> {
  const r: Record<string, number> = {};
  for (let n = 1; n <= MAX_SPUREN; n++) {
    r[`spur/${n}/mute`] = n === s.nr ? (s.mute ? 1 : 0) : 1;
    r[`spur/${n}/solo`] = 0;
  }
  r[`spur/${s.nr}/fader`] = s.fader_db;
  r[`spur/${s.nr}/pan`] = s.pan;
  if (p) {   // 1.10: Ziel-Kette der Spur (Gruppe, PM); andere Gruppen tragen keine klingende Spur und bleiben auf der Vorgabe
    const g = s.ausgang ? (p.gruppen ?? []).find((x) => x.id === s.ausgang!.id) : undefined;
    if (g) { r[`grp/${g.nr}/fader`] = g.fader_db; r[`grp/${g.nr}/pan`] = g.pan; r[`grp/${g.nr}/mute`] = g.mute ? 1 : 0; }
    if ((p.master?.fader_db ?? 0) !== 0) r['pm/fader'] = p.master.fader_db;
    // 1.10 T9 (AK24): the key sources of the stages on the path run (the render-only mask silences them): their state is the project's own, so a
    // source the PROJECT mutes stays muted and its key stays silent, as in the sum. A key group takes its fader, pan and mute from the project too.
    const sl = schluesselPlan(p, s);
    schluesselRegler(p, sl, r);
    Object.assign(r, routingRegler(p, { nur: s, schluessel: sl }));   // 1.10 slice 3: the track's sends and the returns it feeds (spec 5.10)
  }
  return r;
}

const LAUF_TEXT: Record<AusgabeLauf['art'], string> = { freeze: 'a freeze', export: 'an export', lautheit: 'a loudness measurement', merge: 'a merge',
  bounce: 'a bounce', resample: 'a resample' };

// Ende eines Freeze aus Sicht des Wartenden: /e/freeze (status, frames), ein neuer Kern, Stille, Frist (1.10 slice 7: ebenso /e/abgriff)
type FreezeEnde = { art: 'e_freeze'; status: number; frames: number } | { art: 'e_abgriff'; status: number; frames: number }
  | { art: 'neustart' } | { art: 'stille' } | { art: 'frist' } | { art: 'geschlossen' };

export class Ausgabe {
  private readonly ctx: BereichKontext;
  private readonly zugang: ProjZugang;
  private readonly opt: AusgabeOptionen;
  private lauf: AusgabeLauf | null = null;
  private schritte: Schritt[] = [];                                     // was der laufende Lauf schon gespeichert hat (R1)
  private datei: string | null = null;                                  // die WAV des laufenden Exports, sobald sie steht (R1)
  private abgriffDatei: string | null = null;                           // tap file of this run (arbeitsordner), until the WAV is made (slice 7)
  private freezeDatei: string | null = null;                            // Freeze-Datei dieses Durchlaufs, bis sie im Projekt steht (R4, F1)
  // 1.9 T12: end of the last freeze of this server (Date.now()), for the wait for the core's stop report
  private eigenFreezeEnde = 0;
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
    if (adresse === '/e/abgriff') {                                      // 1.10 slice 7: the end of a resample's tap
      const k = `a:${Number(f.art)}:${Number(f.nr)}:${Number(f.kennung)}`;
      const w = this.wartend.get(k);
      if (w) { this.wartend.delete(k); w({ art: 'e_abgriff', status: Number(f.status), frames: Number(f.frames) }); }
      return;
    }
    if (adresse === '/q') {
      const id = Number(f.id), st = Number(f.status);
      if (this.abbruch.has(id) && (st === 6 || st === 7)) this.abbruch.set(id, String(f.grund ?? ''));
      return;
    }
    if (adresse === '/k/willkommen') { this.generation = Number(f.generation); return; }
    // Spec 6.32: ein neuer Kern (andere Generation, wie state.ts) beendet jeden Freeze; der Kern-Stand ist unbekannt, bis er sich meldet
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
  private pruefeFrei(): void {
    // 1.8 T9 (AK26): a recording holds the lock from before its start until its take is placed; freeze, export, loudness, merge and bounce wait for it
    // (checked before the transport state, so the refusal names the recording, not the transport)
    if (this.zugang.aufnahmeAktiv?.()) fehl('beschaeftigt', 'a recording is running; this waits until it is done');
    if (this.lauf) fehl('beschaeftigt', `${LAUF_TEXT[this.lauf.art]} is running`);
  }
  private belege(l: AusgabeLauf): void {
    if (this.geschlossen) fehl('beschaeftigt', 'the server is shutting down');
    this.pruefeFrei();
    this.lauf = l;
    this.schritte = []; this.datei = null;
    this.zugang.ausgabeLauf(l);
  }
  // Fix-Runde S3 R1: jeder Fehler eines Laufs. Ein unerwarteter (Antwort 500 intern) geht ins Log wie in proj (area.ts alsAntwort); hat der
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

  // Die Produktions-Wirte (djk-instrumente --arr1, --arr2) schreiben /dev/shm/cypherdj[-i]/wirt-arr<s>.json (host.py: name, pid, bereit, fehler, …). Fehlt der
  // Wirt eines Slots, spielt im Kern keine Surge für diesen Slot, und der Freeze wäre eine leere Datei ohne Fehlermeldung (Erhebung 2026-10-20). Darum lehnt
  // der Freeze vorher ab. Die Datei allein genügt nicht (S3-Fix W2): host.py und djk-stop löschen sie nie, sie bleibt mit bereit:true und toter pid
  // liegen (wirtLebt()). 1.9 (E3): je Slot; lebt der Wirt, zählt kein fehler-Eintrag; ist er tot, nennt ein fataler Eintrag den Grund (wirt_fehler).
  private pruefeWirt(slots: number[]): void {
    const ordner = (this.opt.wirtOrdner ?? (() => wirtOrdnerVorgabe()))();
    for (const slot of slots) {
      const u = wirtStand(ordner, slot);
      if (u.lebt) continue;
      if (u.fatal !== null) {
        fehl('wirt_fehler', `the Surge host for slot ${slot} stopped with an error (${u.fatal}); fix it and start it with djk-instrumente --arr${slot}`);
      }
      fehl('wirt_fehlt', `the Surge host for production slot ${slot} is not running; start it with djk-instrumente --arr${slot}`);
    }
  }

  // 1.9 U3 (acceptance run u3-abnahme-2, W2c): after a freeze of our own, the report "stopped" (status 0, new arrangement number) follows the
  // /e/freeze event by a moment. With two Surge tracks the export started the second freeze on the stale report "freeze running" and refused
  // transport_laeuft after the first track was already frozen. Bounded wait for the report; a transport that really runs is still refused by
  // the checks of the freeze itself, after at most this wait.
  // 1.9 T12: the same wait for a freeze, export or bounce that starts right after a freeze of this server (two proj_freeze calls in a row hit the stale
  // report). Only when our own freeze ended less than RUHE_WARTE_MS ago: a transport that nobody froze for is refused at once, without a wait.
  private async warteNachEigenemFreeze(): Promise<void> {
    if (this.arr !== null && this.arr.status !== 0 && Date.now() - this.eigenFreezeEnde < RUHE_WARTE_MS) await this.warteRuhe();
  }

  private async warteRuhe(): Promise<void> {
    const bis = Date.now() + RUHE_WARTE_MS;
    while (Date.now() < bis) {
      const nr = this.zugang.offen()?.projekt.wiedergabe_rev;
      if (this.arr !== null && this.arr.status === 0 && this.arr.nr === nr) return;
      await new Promise((r) => setTimeout(r, 10));
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
    await this.warteNachEigenemFreeze();
    if (this.arr.status !== 0) fehl('transport_laeuft', 'stop the transport first');
    this.pruefeWirt([...wirtSlots(vorher)].sort());
    // 1.9 U5 (O28): the host plays the project's Surge parameter map before the core freezes
    const spiegel = await this.zugang.wirtSpiegel?.();
    if (spiegel && spiegel.length > 0) {
      fehl('wirt_spiegel_fehler', `the Surge host did not take the parameter map (${spiegel.join('; ')}); the frozen sound would differ from the project`);
    }
    const frei = this.zugang.sperreLaden();                             // wirft 409 beschaeftigt, solange ein Öffnen oder Anlegen läuft (6.32)
    try {
      await this.zugang.beendeVorhoeren();                             // 1.14 (R8): the freeze needs the main playback loaded (nicht_geladen)
      await this.zugang.tempoAnMaster();                                 // das eingefrorene Audio ist in Sekunden fest: Master = Projekttempo
      const r = await this.friereEin(spurId, b);
      return await this.setze(spurId, r.freeze, `Freeze ${name}`, r.sicht);
    } catch (e) {
      this.verwirfFreezeDatei();
      throw e;
    } finally { this.freezeDatei = null; this.eigenFreezeEnde = Date.now(); frei(); }
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
    return this.warteAuf(`${spur}:${kennung}`, fristMs);
  }
  private warteAuf(k: string, fristMs: number): { versprechen: Promise<FreezeEnde>; weg: () => void } {
    const stilleMs = this.opt.stilleMs ?? 2000;
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

  // Default range of export and loudness without von_beat/bis_beat: the loop bracket when it is on, otherwise the whole song from beat 0 to the end
  // of the last clip on any track (2026-11-06; before, the bracket was used even when off, so a fresh project always exported beats 0..32).
  songBereich(): { von: number; bis: number } {
    const p = this.offen().projekt;
    if (p.loop.an) return { von: p.loop.von_beat, bis: p.loop.bis_beat };
    let bis = 0;
    for (const s of p.spuren) for (const c of s.clips) bis = Math.max(bis, c.start_beat + c.laenge_beats);
    return { von: 0, bis };
  }

  // Prüfungen von Export und Lautheit: nur von_beat und bis_beat, Bereich 1 bis EXPORT_MAX_BEATS Beats ab Beat 0 (default: songBereich), kein anderer
  // Lauf, kein Transport, kein Audio in Vorbereitung.
  // nurSpuren (Merge, P6): audio_fehlt zählt nur diese Spuren (Standard: alle)
  private pruefeBereich(d: Record<string, unknown>, erlaubt: readonly string[] = ['von_beat', 'bis_beat'], nurSpuren?: string[]):
    { von: number; bis: number } {
    for (const k of Object.keys(d)) if (!erlaubt.includes(k)) fehl('argument_ungueltig', `unknown field ${k}`);
    for (const k of ['von_beat', 'bis_beat']) {
      if (d[k] !== undefined && (typeof d[k] !== 'number' || !Number.isFinite(d[k]))) fehl('argument_ungueltig', `${k}: a number is required`);
    }
    this.pruefeSchreiben();
    const o = this.offen();
    const vorgabe = this.songBereich();
    const von = (d.von_beat as number | undefined) ?? vorgabe.von, bis = (d.bis_beat as number | undefined) ?? vorgabe.bis;
    if (!(von >= 0) || !(bis - von >= 1) || bis - von > EXPORT_MAX_BEATS) {
      fehl('export_bereich', `beat ${von} to ${bis}: the export starts at beat 0 or later and is 1 to ${EXPORT_MAX_BEATS} beats long`);
    }
    this.pruefeFrei();                                                   // ein laufender Freeze meldet Status 3: beschaeftigt, nicht transport_laeuft
    if (this.arr && this.arr.status !== 0) fehl('transport_laeuft', 'stop the transport first');
    const fehlt = fehlendesAudio(nurSpuren ? { ...o.projekt, spuren: o.projekt.spuren.filter((s) => nurSpuren.includes(s.id)) } : o.projekt, von, bis);
    if (fehlt.length) fehl('audio_fehlt', `audio clip ${fehlt.join(', ')} is still being prepared; try again in a moment`);
    return { von, bis };
  }

  // Spec 2.5: Wirt-Spuren vorher einfrieren, eine nach der anderen (mit Sperre wie /proj/freeze, Spec 6.23, 6.33), dann die Export-Wiedergabe schreiben
  // (nie geladen; der Aufrufer löscht die Datei). was: für die Meldung „new notes … during the <was>“.
  private async friereEinUndSchreibe(was: string): Promise<{ jetzt: ProjOffen; p: Projekt; w: { nr: number; datei: string } }> {
    // 1.9 (E3): the hosts of every slot that must be frozen are checked before the first freeze, so a dead second host does not leave the first track frozen
    this.pruefeWirt([...new Set(this.offen().projekt.spuren.filter(brauchtFreeze).flatMap(wirtSlots))].sort());
    let erster = true;
    for (const id of this.offen().projekt.spuren.map((s) => s.id)) {
      const s = sucheSpur(this.offen().projekt, id);
      if (!s || !brauchtFreeze(s)) continue;
      if (!erster) await this.warteRuhe();                              // 1.9 U3: the second freeze must not start on the stale report of the first one
      erster = false;
      await this.friereEinUndSetze(id, s.name);
    }
    const jetzt = this.offen();
    const p = jetzt.projekt;
    const offen = p.spuren.filter(brauchtFreeze).map((s) => s.name);
    if (offen.length) fehl('veraltet', `new notes on ${offen.join(', ')} during the ${was}; nothing was written`);
    return { jetzt, p, w: this.zugang.schreibeWiedergabe(exportSicht(p)) };
  }

  async exportiere(d: Record<string, unknown>): Promise<ExportAntwort> {
    await this.warteNachEigenemFreeze();                                 // 1.9 T12
    const { von, bis } = this.pruefeBereich(d, ['von_beat', 'bis_beat', 'abgriff']);
    if (d.abgriff !== undefined && d.abgriff !== 'produktion' && d.abgriff !== 'set') fehl('argument_ungueltig', 'abgriff: production or set expected');
    // 1.10: Vorgabe des Servers ist der Produktions-Abgriff (der Render selbst nimmt ohne Angabe den Ring, P11)
    const abgriff: Abgriff = d.abgriff === 'set' ? 'set' : 'produktion';
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
            zeitlimitMs: Math.ceil(4 * dauerMs) + 60_000, abbruch: this.renderAbbruch.signal, abgriff });
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
      const antwort: ExportAntwort = { datei: ziel, frames: r.frames, spitze_db: r.spitze_db, regler_quelle: r.regler_quelle, abgriff,
        ueber_decke: r.ueber_decke ?? false, limiter_db_max: r.limiter_db_max ?? 0,
        ...(hatDjSchluessel(p) ? { dj_schluessel: true as const } : {}), ...lautheit };
      this.ctx.log({ typ: 'proj_export', slug: jetzt.slug, nr: w.nr, von_beat: von, bis_beat: bis, ...antwort });
      return antwort;
    } catch (e) { throw this.nachFehler(e); } finally { this.gib(); }
  }

  // Slice 2 (E10): the playback for the single render of `s`: the export view without the lanes of all other tracks, the own ones stay. null if no
  // other track has a lane (the shared export playback is already right then). The caller deletes the file after the render.
  // 1.10 T10: `behalte` = the other tracks that run in this render (the members of a group entry and the key sources of its path).
  private schreibeOhneFremdeLanes(p: Projekt, s: Spur, behalte: readonly Spur[] = schluesselPlan(p, s).spuren): { nr: number; datei: string } | null {
    const q = ohneFremdeLanen(p, s, behalte);
    return q ? this.zugang.schreibeWiedergabe(q) : null;
  }

  // Paket 1.18, E-b (POST /proj/lautheit): Lautheit je belegter Spur und als Summe, offline, auf Anfrage. Gleicher Anfang wie der Export (Bereich, Wirt-
  // Spuren einfrieren, Export-Wiedergabe). Ein Render je Spur mit --ohne-zustand und einer Regler-Datei, in der alle anderen Spuren stumm stehen
  // (Fader und Pan der Spur aus dem Projekt, Master wie ein frisch gestarteter Kern, der Limiter bleibt), dazu ein Render aller Spuren für die Summe
  // mit den Reglern des Projekts. Eine Spur mit Mute, Fader aus oder (bei irgendeinem Solo im Projekt) ohne Solo wird nicht gerendert (stumm: true). Unter
  // STILLE_DB Spitze sind die Zahlen null; liegt die Lautheit auf dem Gate-Boden von ffmpeg, ist lufs_i null und unter_messgrenze true (S3-Fix G2).
  async lautheit(d: Record<string, unknown>): Promise<LautheitAntwort> {
    await this.warteNachEigenemFreeze();                                 // 1.9 T12
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
        const render = async (name: string, regler: Record<string, number>, nrW = w.nr, nurSchluessel: string[] = [], trockenAus = false):
          Promise<{ r: RenderAntwort; l: Lautheit; unter: boolean }> => {
          const datei = path.join(dir, `${name}.json`), aus = path.join(dir, `${name}.wav`);
          fs.writeFileSync(datei, JSON.stringify(regler));
          const r = await rendere({ programm: (this.opt.render ?? (() => [renderProgramm()]))(), nr: nrW, von_beat: von, bis_beat: bis, bpm: p.tempo_bpm,
            aus, arbeitsordner: this.zugang.arbeitsordner(), spurRegler: datei, ohneZustand: true, instanz: (this.opt.instanz ?? instanz)(),
            // 1.10: alle am PM, damit die Summe dem Standard-Export gleicht (AK24)
            zeitlimitMs: Math.ceil(4 * dauerMs) + 60_000, abbruch: this.renderAbbruch!.signal, abgriff: 'produktion', nurSchluessel, trockenAus });
          return { r, ...(r.spitze_db <= STILLE_DB ? { l: OHNE_LAUTHEIT, unter: false } : untermessgrenze(await messeLautheit(aus, this.opt.ffmpeg))) };
        };
        const spuren: SpurLautheit[] = [];
        // S3-Fix G3: mit irgendeinem Solo im Projekt klingt im Mix nur, was Solo trägt; 1.10 wie der Mischer (arr_output.cpp Schritt 1):
        // auch ein Gruppen-Solo zählt, und ein Mitglied einer Solo-Gruppe klingt
        for (const s of belegteSpuren(p, von, bis)) {
          const kopf = { spur_id: s.id, nr: s.nr, name: s.name };
          // E10: the base values decide only for a track without a fader/mute/solo lane (a lane can un-mute it)
          const grundStumm = stummImMix(p, s);
          if (grundStumm && !(s.automation ?? []).some((l) => l.ziel === 'fader' || l.ziel === 'mute' || l.ziel === 'solo')) {
            spuren.push({ ...kopf, ...OHNE_LAUTHEIT, spitze_db: -200, stumm: true, unter_messgrenze: false });
            continue;
          }
          // E10: isolation. A lane of another track would override its base mute = 1 in the single render, so this render gets a playback without
          // the lanes of the other tracks (only written when there are some), deleted right after (BEHALTE 5 would push out the loaded playback).
          const einzel = this.schreibeOhneFremdeLanes(p, s);
          let res: { r: RenderAntwort; l: Lautheit; unter: boolean };
          try {
            res = await render(`spur-${s.nr}`, reglerEinzeln(s, p), einzel?.nr, schluesselPlan(p, s).ids);
          } finally { if (einzel) fs.rmSync(einzel.datei, { force: true }); }
          const { r, l, unter } = res;
          spuren.push({ ...kopf, ...l, spitze_db: r.spitze_db, stumm: r.spitze_db <= STILLE_DB, unter_messgrenze: unter });
        }
        const sum = await render('summe', reglerAusProjekt(p));
        // 1.10 T10 (AK24): one entry per group with members and one per return. A group runs its members, its strip, its target chain and the returns
        // they feed (the mechanics of a track entry with several tracks); a return runs the mix with --trocken-aus, so only its wet part is measured.
        // What the mix silences is not rendered.
        const gruppen: GruppenLautheit[] = [], returns: GruppenLautheit[] = [];
        for (const g of p.gruppen ?? []) {
          const mit = mitgliederVon(p, g);
          if (!mit.length) continue;
          const kopf = { gruppe_id: g.id, nr: g.nr, name: g.name };
          if (gruppeStummImMix(p, g) || mit.every((m) => stummImMix(p, m) && !hatLane(m))) {
            gruppen.push({ ...kopf, ...OHNE_LAUTHEIT, spitze_db: -200, stumm: true, unter_messgrenze: false });
            continue;
          }
          const sl = schluesselPlan(p, { spuren: mit, gruppe: g });
          const einzel = this.schreibeOhneFremdeLanes(p, mit[0], [...mit.slice(1), ...sl.spuren]);
          let res: { r: RenderAntwort; l: Lautheit; unter: boolean };
          try {
            res = await render(`gruppe-${g.nr}`, reglerGruppe(g, p), einzel?.nr, sl.ids);
          } finally { if (einzel) fs.rmSync(einzel.datei, { force: true }); }
          gruppen.push({ ...kopf, ...res.l, spitze_db: res.r.spitze_db, stumm: res.r.spitze_db <= STILLE_DB, unter_messgrenze: res.unter });
        }
        const speist = (x: Return): boolean =>
          [...p.spuren, ...(p.gruppen ?? [])].some((t) => (t.sends ?? []).some((sd) => sd.id === x.id && sd.db > STUMM_GRENZE));
        for (const x of p.returns ?? []) {
          const kopf = { return_id: x.id, nr: x.nr, name: x.name };
          if (returnStummImMix(p, x) || !speist(x)) {
            returns.push({ ...kopf, ...OHNE_LAUTHEIT, spitze_db: -200, stumm: true, unter_messgrenze: false });
            continue;
          }
          const res = await render(`return-${x.nr}`, reglerReturn(x, p), w.nr, schluesselReturns(p, x).map((y) => `ret/${y.nr}`), true);
          returns.push({ ...kopf, ...res.l, spitze_db: res.r.spitze_db, stumm: res.r.spitze_db <= STILLE_DB, unter_messgrenze: res.unter });
        }
        const antwort: LautheitAntwort = { von_beat: von, bis_beat: bis, spuren,
          summe: { ...sum.l, spitze_db: sum.r.spitze_db, unter_messgrenze: sum.unter, regler_quelle: sum.r.regler_quelle }, gruppen, returns };
        this.ctx.log({ typ: 'proj_lautheit', slug: jetzt.slug, nr: w.nr, von_beat: von, bis_beat: bis, spuren: spuren.length });
        return antwort;
      } finally {
        this.renderAbbruch = null;
        fs.rmSync(w.datei, { force: true });                             // die Export-Wiedergabe verdrängt sonst die geladene (BEHALTE 5)
        if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
      }
    } catch (e) { throw this.nachFehler(e); } finally { this.gib(); }
  }
  // Paket 1.13 Slice 7 (POST /proj/zusammenfuehren, D1 bis D13): die gewählten Spuren in EINEM Render ohne Neustart-Zustand (Regler allein aus der Datei,
  // Gruppen und PM neutral), die WAV als Quelle ohne Katalog auf eine neue Spur direkt unter der tiefsten Quelle, die Quellen stumm: EIN aendereStand,
  // ein Undo. Keine Sperre über die Render-Dauer (wie Export und Lautheit), kein Einfrieren (D7), nach dem Render eine frische Prüfung (D12).
  async zusammenfuehre(d: Record<string, unknown>): Promise<ZusammenfuehrAntwort> {
    const quelle = this.ctx.quelle();                                          // vor dem ersten await (Muster stems.ts:224)
    for (const k of ['von_beat', 'bis_beat']) if (typeof d[k] !== 'number') fehl('argument_ungueltig', `${k}: a number is required`);
    const ids = Array.isArray(d.spur_ids) ? d.spur_ids.filter((x): x is string => typeof x === 'string') : [];
    await this.warteNachEigenemFreeze();                                 // 1.9 T12
    const { von, bis } = this.pruefeBereich(d, ['spur_ids', 'von_beat', 'bis_beat'], ids);
    const o0 = this.offen();
    const z = mergePlan(o0.projekt, d, quelle);                                // wirft MergeFehler
    const belegt = new Set(belegteSpuren(o0.projekt, von, bis).map((s) => s.id));
    if (!z.spurIds.some((id) => belegt.has(id))) fehl('merge_leer', 'none of the tracks plays in this range');
    this.belege({ art: 'merge' });
    let ziel: string | null = null, teil: string | null = null, regler: string | null = null;
    let wiedergabe: { nr: number; datei: string } | null = null;
    try {
      const ordner = path.join(o0.ordner, 'merge');
      fs.mkdirSync(ordner, { recursive: true });
      const kennung = this.zugang.naechsteNummer();
      ziel = path.join(ordner, `merge-${kennung}.wav`);
      teil = `${ziel}.${process.pid}.teil`; regler = path.join(ordner, `.regler-${process.pid}.json`);
      wiedergabe = this.zugang.schreibeWiedergabe(mergeWiedergabe(o0.projekt, z.spurIds));
      fs.writeFileSync(regler, JSON.stringify(mergeRegler(o0.projekt, z.spurIds)));
      this.renderAbbruch = new AbortController();
      if (this.geschlossen) this.renderAbbruch.abort();
      const dauerMs = (bis - von) * 60_000 / o0.projekt.tempo_bpm;
      const r = await rendere({ programm: (this.opt.render ?? (() => [renderProgramm()]))(), nr: wiedergabe.nr, von_beat: von, bis_beat: bis,
        bpm: o0.projekt.tempo_bpm, aus: teil, arbeitsordner: this.zugang.arbeitsordner(), spurRegler: regler, ohneZustand: true,
        instanz: (this.opt.instanz ?? instanz)(), zeitlimitMs: this.opt.zeitlimitMs ?? Math.ceil(4 * dauerMs) + 60_000,
        abbruch: this.renderAbbruch.signal, abgriff: 'produktion' });
      if (r.spitze_db <= STILLE_DB) fehl('merge_leer', 'the tracks render to silence in this range');
      fs.linkSync(teil, ziel);                                                 // nie ersetzen (P4)
      const sha256 = await sha256Datei(ziel);                                  // im Strom, der Event-Loop bleibt frei
      // frisch, danach kein await mehr bis aendereStand (Muster stems.ts:148)
      const o = this.offen();
      if (o.slug !== o0.slug) fehl('veraltet', 'the project was closed or replaced during the merge; nothing was saved');
      const alt = pruefeMergeNochGleich(o.projekt, z);
      if (alt === 'merge_keine_spur_frei') fehl('merge_keine_spur_frei', 'all 32 tracks are used');
      if (alt !== null) fehl('veraltet', 'the tracks changed during the merge; nothing was saved');
      if (quelle === 'cypher' && this.ctx.kiGestoppt()) fehl('ki_gestoppt', 'Stop Cypher is set; the result was discarded');
      const neu = baueMergeProjekt(o.projekt, z, { sha256, pfad: ziel }, quelle);
      const meta: Meta = { quelle, label: `Merge ${z.name.slice('Merge: '.length)}`.slice(0, 80) };
      const w = aendereStand(o.verlauf, o.projekt, neu.projekt, meta, this.zugang.haken());
      this.schritte.push({ rev: w.projekt.rev, label: meta.label });          // ab hier gehört die WAV dem Projekt (nie mehr löschen)
      const behalte = ziel; ziel = null;
      await this.zugang.uebernimm(w, meta);
      const jetzt = this.offen();
      this.ctx.log({ typ: 'proj_zusammenfuehren', slug: jetzt.slug, nr: wiedergabe.nr, von_beat: von, bis_beat: bis, spuren: z.spurIds.length,
        datei: behalte, regler_quelle: r.regler_quelle });
      return { rev: jetzt.projekt.rev, projekt: jetzt.projekt, spur_id: neu.spurId, quellen: z.spurIds, datei: behalte, frames: r.frames,
        lanes_verworfen: neu.lanesVerworfen,
        ...(z.ausserhalb ? { hinweis: 'quellen_laenger' as const } : {}) };
    } catch (e) {
      // the render text speaks of an export; for a merge nothing was saved yet, say so (Task 3)
      if (e instanceof RenderFehler && !this.schritte.length) Object.assign(e, { text: `${e.text}; nothing was changed` });
      throw this.nachFehler(e);
    } finally {
      this.renderAbbruch = null;
      if (wiedergabe) fs.rmSync(wiedergabe.datei, { force: true });            // verdrängt sonst die geladene (BEHALTE 5)
      for (const f of [teil, regler, ziel]) if (f) fs.rmSync(f, { force: true });   // ziel nur, wenn nie gespeichert (oben auf null gesetzt)
      try { fs.rmdirSync(path.join(o0.ordner, 'merge')); } catch { /* nicht leer oder weg */ }
      this.gib();
    }
  }

  // Package 1.14 slice 4 (POST /proj/bounce, spec R1 to R11, D13 to D15): the structure of zusammenfuehre(). Guards in the order of R4, one render
  // without the core's restart state and without the load lock, a fresh check after it, then ONE aendereStand. an_ort ends an audition before the
  // render and again after uebernimm (one may have started during the render), without holding sperreLaden (D15).
  async bounce(d: Record<string, unknown>): Promise<BounceAntwort> {
    const quelle = this.ctx.quelle();                                          // before the first await
    this.pruefeSchreiben();                                                    // ki_gestoppt
    const o0 = this.offen();                                                   // kein_projekt
    this.pruefeFrei();                                                         // beschaeftigt
    await this.warteNachEigenemFreeze();
    if (this.arr && this.arr.status !== 0) fehl('transport_laeuft', 'stop the transport first');
    const z = bouncePlan(o0.projekt, d, quelle);                               // argument_ungueltig, export_bereich and the plan refusals (MergeFehler)
    this.pruefeBereich({ von_beat: z.von, bis_beat: z.bis }, ['von_beat', 'bis_beat'], z.spurIds);   // audio_fehlt of the sources only
    const belegt = new Set(belegteSpuren(o0.projekt, z.von, z.bis).map((s) => s.id));
    if (!z.spurIds.some((id) => belegt.has(id))) fehl('merge_leer', 'none of the tracks plays in this range');
    this.belege({ art: 'bounce' });
    let ziel: string | null = null, teil: string | null = null, regler: string | null = null;
    let wiedergabe: { nr: number; datei: string } | null = null;
    const ordner = path.join(o0.ordner, 'bounce');
    try {
      if (z.art === 'an_ort') await this.zugang.beendeVorhoeren();            // D15: the main lane is what plays afterwards
      fs.mkdirSync(ordner, { recursive: true });
      const kennung = this.zugang.naechsteNummer();
      ziel = path.join(ordner, `bounce-${kennung}.wav`);
      teil = `${ziel}.${process.pid}.teil`; regler = path.join(ordner, `.regler-${process.pid}.json`);
      wiedergabe = this.zugang.schreibeWiedergabe(bounceWiedergabe(o0.projekt, z));
      fs.writeFileSync(regler, JSON.stringify(bounceRegler(o0.projekt, z)));
      this.renderAbbruch = new AbortController();
      if (this.geschlossen) this.renderAbbruch.abort();
      const dauerMs = (z.bis - z.von) * 60_000 / o0.projekt.tempo_bpm;
      const r = await rendere({ programm: (this.opt.render ?? (() => [renderProgramm()]))(), nr: wiedergabe.nr, von_beat: z.von, bis_beat: z.bis,
        bpm: o0.projekt.tempo_bpm, aus: teil, arbeitsordner: this.zugang.arbeitsordner(), spurRegler: regler, ohneZustand: true,
        instanz: (this.opt.instanz ?? instanz)(), zeitlimitMs: this.opt.zeitlimitMs ?? Math.ceil(4 * dauerMs) + 60_000,
        abbruch: this.renderAbbruch.signal, abgriff: 'produktion' });
      if (r.spitze_db <= STILLE_DB) fehl('merge_leer', 'the tracks render to silence in this range');
      fs.linkSync(teil, ziel);                                                 // never replace (D14)
      const sha256 = await sha256Datei(ziel);
      // fresh, no await from here until aendereStand (R6)
      const o = this.offen();
      if (o.slug !== o0.slug) fehl('veraltet', 'the project was closed or replaced during the bounce; nothing was saved');
      const alt = pruefeBounceNochGleich(o.projekt, z);
      if (alt === 'veraltet') fehl('veraltet', 'the tracks changed during the bounce; nothing was saved');
      if (alt !== null) fehl(alt, 'the project changed during the bounce; nothing was saved');
      if (quelle === 'cypher' && this.ctx.kiGestoppt()) fehl('ki_gestoppt', 'Stop Cypher is set; the result was discarded');
      const neu = baueBounceProjekt(o.projekt, z, { sha256, pfad: ziel });
      const meta: Meta = { quelle, label: neu.label };
      const w = aendereStand(o.verlauf, o.projekt, neu.projekt, meta, this.zugang.haken());
      this.schritte.push({ rev: w.projekt.rev, label: meta.label });          // from here the WAV belongs to the project (never removed again)
      const behalte = ziel; ziel = null;
      await this.zugang.uebernimm(w, meta);
      if (z.art === 'an_ort') await this.zugang.beendeVorhoeren();            // D15: an audition started during the render
      const jetzt = this.offen();
      this.ctx.log({ typ: 'proj_bounce', art: z.art, slug: jetzt.slug, nr: wiedergabe.nr, von_beat: z.von, bis_beat: z.bis, spuren: z.spurIds.length,
        datei: behalte, regler_quelle: r.regler_quelle });
      return { art: z.art, rev: jetzt.projekt.rev, projekt: jetzt.projekt, spur_id: neu.spurId, clip_id: neu.clipId, datei: behalte, frames: r.frames,
        quellen: z.spurIds, ...(neu.takeId ? { take_id: neu.takeId } : {}),
        ...(z.art === 'neue_spur' ? { lanes_verworfen: neu.lanesVerworfen ?? 0 } : {}),
        ...(z.merge?.ausserhalb ? { hinweis: 'quellen_laenger' as const } : {}) };
    } catch (e) {
      if (e instanceof RenderFehler && !this.schritte.length) Object.assign(e, { text: `${e.text}; nothing was changed` });
      throw this.nachFehler(e);
    } finally {
      this.renderAbbruch = null;
      if (wiedergabe) fs.rmSync(wiedergabe.datei, { force: true });            // would push out the loaded playback (BEHALTE 5)
      for (const f of [teil, regler, ziel]) if (f) fs.rmSync(f, { force: true });   // ziel only when never saved (set to null above)
      try { fs.rmdirSync(ordner); } catch { /* not empty or gone */ }
      this.gib();
    }
  }

  // 1.10 slice 7 (T6, POST /proj/resample, spec 5.7, plan D6 to D10): a strip (track, group, return or the production master) played once in real
  // time through the core tap /k/arr/abgriff, its file made a WAV, the WAV a new audio track: ONE undo step "Resample <name>". The run is a sibling
  // of the freeze (belege, sperreLaden, beendeVorhoeren, tempoAnMaster, wait for the end event with the freeze's deadline and silence handling).
  // Checks in the order ki_gestoppt, kein_projekt, beschaeftigt (also a recording), the plan (arguments, strip, range, free track slot), the
  // core state; Surge tracks that sound in the range are not frozen but need their host (D10, before the run). A silent file is refused
  // resample_leer and both files are removed. After the run the tempo and the strip must be unchanged (veraltet).
  async resample(d: Record<string, unknown>): Promise<ResampleAntwort> {
    const quelle = this.ctx.quelle();                                          // before the first await
    this.pruefeSchreiben();
    const o0 = this.offen();
    this.pruefeFrei();
    const z = resamplePlan(o0.projekt, d, this.songBereich());                 // wirft ResampleFehler
    if (this.arr === null) fehl('kein_kernstand', 'the core has not reported its arrangement state yet');
    if (this.arr.status !== 0) fehl('transport_laeuft', 'stop the transport first');
    this.belege({ art: 'resample', strang_id: z.strangId });
    let ziel: string | null = null;
    const ordner = path.join(o0.ordner, 'resample');
    try {
      this.pruefeWirt([...new Set(wirtSpurenImStrang(o0.projekt, z).flatMap(wirtSlots))].sort());
      const spiegel = await this.zugang.wirtSpiegel?.();                       // O28 as in the freeze: the host plays the project's parameter map
      if (spiegel && spiegel.length > 0) {
        fehl('wirt_spiegel_fehler', `the Surge host did not take the parameter map (${spiegel.join('; ')}); the resampled sound would differ from the project`);
      }
      const frei = this.zugang.sperreLaden();                                  // 409 beschaeftigt while a project is being opened or created
      try {
        await this.zugang.beendeVorhoeren();
        await this.zugang.tempoAnMaster();                                     // the WAV is fixed in seconds: master = project tempo
        const t = await this.tappe(z);
        const quellDatei = path.join(this.zugang.arbeitsordner(), t.datei);
        const spitze = await spitzeDbVonF32(quellDatei);
        if (spitze <= STILLE_DB) {
          fehl('resample_leer', `${z.name} is silent in beat ${z.von} to ${z.bis} (muted, empty or its Surge host is not playing); no track was made`);
        }
        ziel = path.join(ordner, `resample-${t.kennung}.wav`);
        const w = await schreibeWavAusF32Stueckweise(quellDatei, ziel);        // D9: the path of the 1.8 take; the clip source is the WAV with its sha256
        // fresh, no await from here until aendereStand
        const o = this.offen();
        if (o.slug !== o0.slug) fehl('veraltet', 'the project was closed or replaced during the resample; nothing was saved');
        const alt = pruefeResampleNochGleich(o.projekt, z);
        if (alt === 'merge_keine_spur_frei') fehl('merge_keine_spur_frei', 'all 32 tracks are used');
        if (alt !== null) fehl('veraltet', 'the tempo or the strip changed during the resample; nothing was saved');
        if (quelle === 'cypher' && this.ctx.kiGestoppt()) fehl('ki_gestoppt', 'Stop Cypher is set; the result was discarded');
        const neu = baueResampleProjekt(o.projekt, z, { sha256: w.sha256, pfad: ziel }, quelle);
        const meta: Meta = { quelle, label: `Resample ${z.name}`.slice(0, 80) };
        const wirkung = aendereStand(o.verlauf, o.projekt, neu.projekt, meta, this.zugang.haken());
        this.schritte.push({ rev: wirkung.projekt.rev, label: meta.label });   // from here the WAV belongs to the project (never removed again)
        const behalte = ziel; ziel = null;
        await this.zugang.uebernimm(wirkung, meta);
        const jetzt = this.offen();
        const spur = sucheSpur(jetzt.projekt, neu.spurId);
        this.ctx.log({ typ: 'proj_resample', slug: jetzt.slug, strang_id: z.strangId, punkt: z.punkt, von_beat: z.von, bis_beat: z.bis, datei: behalte,
          frames: w.frames, spitze_db: spitze });
        return { rev: jetzt.projekt.rev, spur_id: neu.spurId, clip_id: spur?.clips[0]?.id ?? '', datei: behalte, frames: w.frames, quelle: z.strangId,
          punkt: z.punkt, von_beat: z.von, bis_beat: z.bis };
      } finally { frei(); }
    } catch (e) { throw this.nachFehler(e); } finally {
      this.verwirfAbgriffDatei();
      if (ziel) fs.rmSync(ziel, { force: true });                              // only when never saved (set to null above)
      try { fs.rmdirSync(ordner); } catch { /* not empty or gone */ }
      this.gib();
    }
  }

  // The tap run in the core (/k/arr/abgriff, T5): sends, waits for /e/abgriff with the deadline and silence handling of the freeze, checks the file size.
  private async tappe(z: ResamplePlan): Promise<{ datei: string; kennung: number; frames: number }> {
    const o = this.offen();
    if (this.arr === null || this.arr.nr !== o.projekt.wiedergabe_rev) {
      fehl('nicht_geladen', `the core plays arrangement ${this.arr?.nr ?? '-'}, the project is at ${o.projekt.wiedergabe_rev}`);
    }
    if (this.arr.status !== 0) fehl('transport_laeuft', 'stop the transport first');
    const kennung = this.zugang.naechsteNummer();                              // one counter of the instance (spec 6.25), never twice
    if (!Number.isInteger(kennung) || kennung < 0 || kennung > KENNUNG_MAX) fehl('zu_gross', `file ids of this instance are used up (${kennung})`);
    const fristMs = Math.ceil((z.bis - z.von + 4) * 60_000 / o.projekt.tempo_bpm) + (this.opt.zugabeMs ?? 5000);
    const ende = this.warteAuf(`a:${z.art}:${z.nr}:${kennung}`, fristMs);      // before sending: /e/abgriff must not pass by
    let id = -1;
    try {
      id = this.ctx.sende('/k/arr/abgriff', { quelle: this.ctx.quelle(), art: z.art, nr: z.nr, punkt: z.punkt === 'pre' ? 0 : 1, von_beat: z.von,
        bis_beat: z.bis, kennung });
      this.abbruch.set(id, '');
      const q = await this.ctx.warteQuittung(id);
      if (q === null) fehl('kein_kernstand', 'no answer from the core to /k/arr/abgriff');
      if (q.status === 6 || q.status === 7) abgriffAbgelehnt(q.grund);
      const e = await ende.versprechen;
      if (e.art === 'neustart') fehl('resample_fehler', 'the core restarted during the resample; nothing was saved');
      if (e.art === 'geschlossen') fehl('resample_fehler', 'the server is shutting down; the resample was abandoned and nothing was saved');
      if (e.art === 'stille') fehl('resample_fehler', `no message from the core for ${this.opt.stilleMs ?? 2000} ms (core lost?); nothing was saved`);
      if (e.art === 'frist') fehl('resample_fehler', `no /e/abgriff within ${fristMs} ms; nothing was saved`);
      if (e.art !== 'e_abgriff') return fehl('resample_fehler', 'unexpected end of the resample; nothing was saved');
      if (e.status !== 0) {
        const g = this.abbruch.get(id) ?? '';
        if (g) abgriffAbgelehnt(g);
        fehl('resample_fehler', e.status === 1 ? 'the core aborted the resample; nothing was saved' : 'the core did not write the tap file; nothing was saved');
      }
      const datei = `abgriff-${z.art}-${z.nr}-${kennung}.f32`;
      this.abgriffDatei = datei;                                               // /e/abgriff 0: the core wrote it for this run
      let groesse = -1;
      try { groesse = (await fs.promises.stat(path.join(this.zugang.arbeitsordner(), datei))).size; } catch { /* missing */ }
      if (!Number.isInteger(e.frames) || e.frames < 1 || groesse !== e.frames * 8) {
        fehl('resample_fehler', `the tap file has ${groesse} bytes, expected ${e.frames} frames x 8; nothing was saved`);
      }
      return { datei, kennung, frames: e.frames };
    } finally {
      ende.weg();
      this.abbruch.delete(id);
    }
  }

  // the tap file of this run is only the way to the WAV: removed in every outcome, but only one this run wrote (/e/abgriff 0)
  private verwirfAbgriffDatei(): void {
    const name = this.abgriffDatei;
    this.abgriffDatei = null;
    if (name === null) return;
    try { fs.rmSync(path.join(this.zugang.arbeitsordner(), name), { force: true }); } catch (e) {
      this.ctx.log({ typ: 'proj_resample_waise', datei: name, fehler: (e as Error).message });
    }
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
      throw new Error(`proj-ausgabe: der ProjZugang der S2-Integration hat kein ${m}() (areas/proj/area.ts)`);
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
      { methode: 'POST', pfad: '/proj/zusammenfuehren', schutz: 'fremdePost', handler: antworte(async (d, kurz) => {
        const x = await a.zusammenfuehre(d);
        if (!kurz) return x;
        const { projekt: _projekt, ...schmal } = x;                              // Spec 6.31: schmal ohne projekt
        return schmal;
      }) },
      { methode: 'POST', pfad: '/proj/resample', schutz: 'fremdePost', handler: antworte((d) => a.resample(d)) },
      { methode: 'POST', pfad: '/proj/bounce', schutz: 'fremdePost', handler: antworte(async (d, kurz) => {
        const x = await a.bounce(d);
        if (!kurz) return x;
        const { projekt: _projekt, ...schmal } = x;                              // R1: short answer without projekt
        return schmal;
      }) },
    ],
    ereignis: (adresse, felder) => a.ereignis(adresse, felder),
  };
}
