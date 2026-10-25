// Befehle der Projekt-API (Spec 3.4, Abschnitt „Befehle in aendern") als reine Funktionen: Projekt → {projekt, vor, zurueck,
// betrifft_wiedergabe, regler_aenderungen}. Kein Server, kein Kern, keine Datei. Eine Ablehnung ist ein BefehlFehler mit `grund`.
// Ein Befehl ist ein flaches Objekt {befehl: '<name>', ...argumente}; unbekannte Argumente werden abgelehnt (kein stilles Schlucken).
// Die Patches entstehen aus dem Vergleich der Stände vor und nach dem Befehl (patch.ts), nicht von Hand je Befehl; `zurueck` ist der
// Vergleich in der Gegenrichtung (neu → alt), nicht ein Klon samt Umkehr.
// Mixer- und Kopfbefehle (Fader, Pan, Mute, Solo, Name, Farbe, Tempo, Loop, Metronom) laufen auf einem flachen Entwurf: nur die
// berührte Spur wird flach kopiert, Clips und Noten werden geteilt, es gibt weder Volltiefen-Klon noch Wiedergabe-Vergleich. Das ist
// die Bewegung, die der Verlauf zusammenfasst (Spec 6.5); `{voll: true}` erzwingt den allgemeinen Weg (Test: beide ergeben dasselbe).
// `rev` und `wiedergabe_rev` fasst kein Befehl an: sie zählt der Verlauf (verlauf.ts).
import {
  FADER_MAX, FADER_MIN, GAIN_MAX, GAIN_MIN, GRUPPE_MAX, INTERNE_EINGAENGE, LOOP_MIN, MAX_ARM_AUDIO, MAX_BEAT, MAX_CLIPS,
  MAX_GRUPPEN, MAX_NOTEN, MAX_SPUREN,
  RB_PARAMETER, SPUR_FARBEN,
  TEMPO_MAX, TEMPO_MIN, WIRT_SLOTS,
  istObjekt, kanonisch, neueId, neueNotenId, notenNummer, notenZaehler,
  pruefeFehler, spurSicht, sucheClip, sucheSpur, wiedergabeSicht, warpPruefung, type AudioClip, type Clip, type Gruppe, type Herkunft, type Geraet,
  type MidiClip, type Note, type Projekt, type Spur, type Warp,
  type DekodiertZustand,
} from './modell.ts';
import { unterschied, type Patch } from './patch.ts';
import { MAX_WARP_PUNKTE, zaehleAusgerollt, zaehleWarpMarker } from './wiedergabe.ts';

export class BefehlFehler extends Error {
  readonly grund: string;
  readonly detail: string;
  index?: number;                                  // Stelle in einer Befehlsliste (fuehreListeAus)
  constructor(grund: string, detail = '') { super(detail ? `${grund}: ${detail}` : grund); this.grund = grund; this.detail = detail; }
}
const ab = (grund: string, detail?: string): never => { throw new BefehlFehler(grund, detail); };

export interface ReglerAenderung { pfad: string; wert: number }
export interface BefehlErgebnis { projekt: Projekt; vor: Patch; zurueck: Patch; betrifft_wiedergabe: boolean; regler_aenderungen: ReglerAenderung[] }
export type Befehl = { befehl: string; [k: string]: unknown };

// --- Argumente --------------------------------------------------------------------------------------------------------
type Args = Record<string, any>;                   // eslint-disable-line @typescript-eslint/no-explicit-any
function erlaube(a: Args, ...namen: string[]): void {
  for (const k of Object.keys(a)) if (k !== 'befehl' && !namen.includes(k)) ab('argument_unbekannt', k);
}
const zahlOk = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
function zahl(a: Args, k: string, min: number, max: number, o: { opt?: boolean; ganz?: boolean; offenUnten?: boolean } = {}): number | undefined {
  const x = a[k];
  if (x === undefined) { if (o.opt) return undefined; return ab('argument_ungueltig', `${k}: fehlt`); }
  if (!zahlOk(x) || x > max || (o.offenUnten ? x <= min : x < min) || (o.ganz && !Number.isInteger(x))) {
    return ab('argument_ungueltig', `${k}: ${o.ganz ? 'ganze ' : ''}Zahl ${o.offenUnten ? '>' : '≥'} ${min} und ≤ ${max} erwartet`);
  }
  return x;
}
function flagge(a: Args, k: string, opt = false): boolean | undefined {
  const x = a[k];
  if (x === undefined && opt) return undefined;
  return typeof x === 'boolean' ? x : ab('argument_ungueltig', `${k}: true oder false erwartet`);
}
function text(a: Args, k: string, max: number, opt = true): string | undefined {
  const x = a[k];
  if (x === undefined && opt) return undefined;
  return typeof x === 'string' && x.trim().length >= 1 && x.length <= max ? x : ab('argument_ungueltig', `${k}: Text mit 1 bis ${max} Zeichen erwartet`);
}
// Paket 1.18, E-c (Review S2): der Gruppenname trägt keine Leerzeichen am Rand, sonst wären ' bass' und 'bass' zwei Gruppen; wie modell.ts beim Laden
function gruppeArg(a: Args, opt = true): string | undefined {
  const g = text(a, 'gruppe', GRUPPE_MAX, opt);
  return g !== undefined && g.trim() !== g ? ab('argument_ungueltig', 'gruppe: ohne Leerzeichen am Rand') : g;
}
function idArg(a: Args, k: string): string {
  const x = a[k];
  return typeof x === 'string' && x ? x : ab('argument_ungueltig', `${k}: ID erwartet`);
}
const spurVon = (p: Projekt, id: string): Spur => sucheSpur(p, id) ?? ab('spur_unbekannt', id);
const gruppeVon = (p: Projekt, id: string): Gruppe => (p.gruppen ?? []).find((g) => g.id === id) ?? ab('gruppe_unbekannt', id);
const FARBE_OK = /^#[0-9a-fA-F]{6}$/;
const GRUPPE_LEICHT = ['name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'gefaltet'];   // Felder von gruppenspur_aendern
const clipVon = (p: Projekt, id: string): { spur: Spur; clip: Clip } => sucheClip(p, id) ?? ab('clip_unbekannt', id);
const midiVon = (clip: Clip, id: string): MidiClip => (clip.art === 'midi' ? clip : ab('clip_nicht_midi', id));
const runde9 = (x: number): number => Math.round(x * 1e9) / 1e9;
const SHA = /^[0-9a-f]{64}$/;
const NOTEN_ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const NOTEN_NR_GRENZE = 2 ** 31;                   // Spec 6.32 (Wortlaut von 6.31 berichtigt): ausdrückliche Noten-IDs n<k> mit k < 2^31
const WIRT_SLOT_LISTE = Array.from({ length: WIRT_SLOTS }, (_, i) => i + 1);
const SLOT_TEXT = 'D1 has one Surge slot';
// Spec 6.28, 6.31: Slot 2 ist frei, aber ohne Wirt (der Kern behält nur die Ports); einen Slot 3 gibt es nicht
const SLOT2_TEXT = 'D1 has one Surge slot (slot 2 has no host)';
const SLOT_UNGUELTIG_TEXT = 'geraet.slot: 1 expected (Surge slots are 1 and 2, D1 has one Surge slot)';

// --- Warp (Paket 1.13) -------------------------------------------------------------------------------------------------------------
// Das Warp-Argument eines Befehls: fehlt, null oder 'aus' heißt ohne Warp (null); ein Objekt wird wie im Modell geprüft (Grund und Text von
// warpPruefung). 'auto' löst nicht dieser Baustein, sondern der Server aus dem Katalog (sitzung.ts loeseQuellenAuf); ein 'auto', das bis
// hierher kommt, hatte keinen Katalog.
function warpArg(x: unknown): Warp | null {
  if (x === undefined || x === null || x === 'aus') return null;
  if (x === 'auto') return ab('argument_ungueltig', "warp 'auto' braucht den Katalog des Servers (Tempo-Angaben der Library)");
  const f = warpPruefung(x);
  if (f) return ab(f.grund, f.text);
  return structuredClone(x) as Warp;
}
const WARP_FELDER = ['an', 'modus', 'transpose_st', 'detune_ct'] as const;

// --- Geräte -----------------------------------------------------------------------------------------------------------
// `eigene`: die Spur, deren Gerät geändert wird. Ohne `slot` behält sie ihren eigenen Wirt-Slot (Spec 6.8), sonst gilt der erste freie.
// Spec 6.28: in D1 läuft genau ein Wirt (arr1), es gibt nur Slot 1 (WIRT_SLOTS); eine zweite Surge-Spur ist slot_belegt, auch mit slot 2.
function baueGeraet(p: Projekt, g: unknown, eigene?: string): Geraet {
  if (!istObjekt(g)) return ab('argument_ungueltig', 'geraet: Objekt erwartet');
  const belegt = new Set(p.spuren.filter((s) => s.id !== eigene && s.geraet?.art === 'wirt').map((s) => (s.geraet as { slot: number }).slot));
  const eigenerGeraet = eigene === undefined ? undefined : sucheSpur(p, eigene)?.geraet;
  if (g.art === 'intern') {
    erlaube(g, 'art', 'name', 'parameter');
    if (g.name !== undefined && g.name !== 'rb338') ab('argument_ungueltig', 'geraet.name: intern kennt nur rb338');
    const parameter: Record<string, number> = {};
    if (g.parameter !== undefined) {
      if (!istObjekt(g.parameter)) ab('argument_ungueltig', 'geraet.parameter: Objekt erwartet');
      for (const [k, v] of Object.entries(g.parameter as Record<string, unknown>)) {
        if (!RB_PARAMETER.includes(k)) ab('argument_unbekannt', `geraet.parameter.${k} (erlaubt: ${RB_PARAMETER.join(', ')})`);
        if (!zahlOk(v) || v < 0 || v > 1) ab('argument_ungueltig', `geraet.parameter.${k}: Zahl 0..1 erwartet`);
        parameter[k] = v as number;
      }
    }
    return { art: 'intern', name: 'rb338', parameter };
  }
  if (g.art === 'wirt') {
    erlaube(g, 'art', 'name', 'slot');
    if (g.name !== undefined && g.name !== 'surge') ab('argument_ungueltig', 'geraet.name: wirt kennt nur surge');
    let slot: number;
    if (g.slot === undefined) {
      const frei = eigenerGeraet?.art === 'wirt' ? eigenerGeraet.slot : WIRT_SLOT_LISTE.find((s) => !belegt.has(s));
      if (frei === undefined) return ab('slot_belegt', SLOT_TEXT);
      slot = frei;
    } else {
      if (g.slot !== 1 && g.slot !== 2) return ab('argument_ungueltig', SLOT_UNGUELTIG_TEXT);
      if (g.slot > WIRT_SLOTS) return ab('slot_belegt', SLOT2_TEXT);
      if (belegt.has(g.slot)) return ab('slot_belegt', SLOT_TEXT);
      slot = g.slot;
    }
    return { art: 'wirt', name: 'surge', slot };
  }
  return ab('argument_ungueltig', 'geraet.art: intern oder wirt erwartet');
}

// --- Noten ------------------------------------------------------------------------------------------------------------
function notenFelder(n: Args, wo: string, teil: boolean): Partial<Note> {
  const ausgabe: Partial<Note> = {};
  const f = (k: 'beat' | 'laenge' | 'ton' | 'vel', min: number, max: number, o: { ganz?: boolean; offenUnten?: boolean }): void => {
    if (n[k] === undefined) { if (!teil) ab('argument_ungueltig', `${wo}.${k}: fehlt`); return; }
    if (!zahlOk(n[k]) || n[k] > max || (o.offenUnten ? n[k] <= min : n[k] < min) || (o.ganz && !Number.isInteger(n[k]))) {
      ab('argument_ungueltig', `${wo}.${k}: ungültig`);
    }
    ausgabe[k] = n[k];
  };
  f('beat', 0, MAX_BEAT, {}); f('laenge', 0, MAX_BEAT, { offenUnten: true }); f('ton', 0, 127, { ganz: true }); f('vel', 1, 127, { ganz: true });
  return ausgabe;
}
function listeArg(a: Args, k: string): unknown[] {
  return Array.isArray(a[k]) && a[k].length >= 1 && a[k].length <= 65536 ? a[k] : ab('argument_ungueltig', `${k}: nicht leere Liste erwartet`);
}
// Linear in der Zahl der Noten: der Zähler wird einmal gelesen und danach hochgezählt, die Kollisionsprüfung läuft über ein Set.
// Spec 6.28/6.30: der Zähler gehört dem Projekt (einer für alle Clips). Eine ausdrücklich mitgegebene ID n<k> unter dem Zähler war schon einmal
// vergeben und ist id_belegt, auch wenn die Note inzwischen gelöscht ist; eine darüber hebt den Zähler. Eigene IDs (z. B. „kick“) zählen nicht.
// Spec 6.32 (Wortlaut von 6.31 berichtigt): unter dem Projekt-Zähler bleibt es bei id_belegt (6.30); ab 2^31 oder bei falscher Form gilt
// argument_ungueltig, damit eine ausdrückliche ID den Zähler nie über die Grenze des Modells hebt (vorher: n<MAX_SAFE-1> angenommen, danach
// scheiterte jede automatische Note an projekt_ungueltig).
function fuegeNotenEin(p: Projekt, clip: MidiClip, roh: unknown[]): void {
  const vorhanden = new Set(clip.noten.map((n) => n.id));
  let naechste = notenZaehler(p);
  roh.forEach((r, i) => {
    if (!istObjekt(r)) ab('argument_ungueltig', `noten[${i}]: Objekt erwartet`);
    erlaube(r as Args, 'id', 'beat', 'laenge', 'ton', 'vel');
    const f = notenFelder(r as Args, `noten[${i}]`, false) as Omit<Note, 'id'>;
    let id = (r as Args).id as string | undefined;
    if (id !== undefined && (typeof id !== 'string' || !NOTEN_ID.test(id))) ab('argument_ungueltig', `noten[${i}].id: ungültig`);
    if (id !== undefined) {
      const k = notenNummer(id);
      if (k !== null && k >= NOTEN_NR_GRENZE) ab('argument_ungueltig', `noten[${i}].id: Nummer unter 2^31 erwartet`);
      if (vorhanden.has(id) || (k !== null && k < naechste)) ab('id_belegt', id);
      if (k !== null) naechste = k + 1;
    } else {
      do { id = `n${naechste}`; naechste += 1; } while (vorhanden.has(id));
    }
    vorhanden.add(id);
    clip.noten.push({ id, beat: f.beat, laenge: f.laenge, ton: f.ton, vel: f.vel });
  });
  p.naechste_noten_id = naechste;
}

// --- Einzelne Befehle (verändern den Entwurf `p`) ---------------------------------------------------------------------
const MIXER = ['fader_db', 'pan', 'mute', 'solo'] as const;
// ctx.quelle: wer den Befehl gibt (der Verlauf reicht meta.quelle durch); spur_neu schreibt sie als von in die Spur (Spec 6.22)
interface Kontext { quelle: Herkunft }
const PRO_BEFEHL: Record<string, (p: Projekt, a: Args, ctx: Kontext) => void> = {
  spur_neu(p, a, ctx) {
    erlaube(a, 'art', 'name', 'geraet', 'gruppe');
    const art = a.art;
    if (art !== 'audio' && art !== 'instrument') ab('argument_ungueltig', 'art: audio oder instrument erwartet');
    if (art === 'audio' && a.geraet !== undefined) ab('argument_ungueltig', 'geraet: nur für Instrument-Spuren');
    if (p.spuren.length >= MAX_SPUREN) ab('spur_bereich', `alle ${MAX_SPUREN} Spuren belegt`);
    const nr = Array.from({ length: MAX_SPUREN }, (_, i) => i + 1).find((n) => !p.spuren.some((s) => s.nr === n)) ?? ab('spur_bereich', 'keine freie Nummer');
    const geraet = art === 'instrument' ? baueGeraet(p, a.geraet ?? { art: 'intern' }) : undefined;
    const name = text(a, 'name', 80) ?? (art === 'audio' ? `Audio ${nr}` : geraet!.art === 'intern' ? 'RB-338' : 'Surge');
    const gruppe = gruppeArg(a);
    const spur: Spur = { id: neueId(p, 'spur'), von: ctx.quelle, ...(gruppe !== undefined ? { gruppe } : {}), nr, name,
      farbe: SPUR_FARBEN[(nr - 1) % SPUR_FARBEN.length], art,
      ...(geraet ? { geraet } : {}), ...(geraet?.art === 'wirt' ? { freeze: null } : {}),
      fader_db: 0, pan: 0, mute: false, solo: false, clips: [] };
    p.spuren.push(spur);
  },

  spur_aendern(p, a) {
    if (a.von !== undefined) ab('argument_ungueltig', 'von: unveränderlich (Spec 6.22), die Herkunft einer Spur ändert kein Befehl');
    erlaube(a, 'spur_id', 'name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'geraet', 'gruppe', 'arm', 'eingang');
    const s = spurVon(p, idArg(a, 'spur_id'));
    if (['name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'geraet', 'gruppe', 'arm', 'eingang'].every((k) => a[k] === undefined)) {
      ab('argument_ungueltig', 'keine Änderung angegeben');
    }
    const name = text(a, 'name', 80);
    const gruppe = a.gruppe === null ? null : gruppeArg(a);       // null nimmt die Spur aus ihrer Gruppe
    if (a.farbe !== undefined && (typeof a.farbe !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(a.farbe))) ab('argument_ungueltig', 'farbe: #rrggbb erwartet');
    const fader = zahl(a, 'fader_db', FADER_MIN, FADER_MAX, { opt: true }), pan = zahl(a, 'pan', -1, 1, { opt: true });
    const mute = flagge(a, 'mute', true), solo = flagge(a, 'solo', true);
    if (a.geraet !== undefined && s.art !== 'instrument') ab('argument_ungueltig', 'geraet: nur für Instrument-Spuren');
    const geraet = a.geraet !== undefined ? baueGeraet(p, a.geraet, s.id) : undefined;
    if (a.arm !== undefined || a.eingang !== undefined) {   // 1.8: kein Regler, kein Neuladen (wiedergabeSicht kennt das Feld nicht)
      if (s.art !== 'audio') ab('argument_ungueltig', 'arm/eingang: nur für Audio-Spuren');
      if (a.arm !== undefined && typeof a.arm !== 'boolean') ab('argument_ungueltig', 'arm: true oder false erwartet');
      const alt = s.aufnahme ?? { scharf: false, eingang: null };
      let eingang = alt.eingang;
      if (a.eingang === null) eingang = null;
      else if (a.eingang !== undefined) {
        const e = a.eingang as { art?: unknown; name?: unknown };
        if (typeof e !== 'object' || e.art !== 'intern' || !(INTERNE_EINGAENGE as readonly unknown[]).includes(e.name)) {
          ab('eingang_fehlt', 'eingang: {art: intern, name: erz/1|erz/2|erz/3} oder null');
        }
        eingang = { art: 'intern', name: e.name as (typeof INTERNE_EINGAENGE)[number] };
      }
      const scharf = a.arm ?? alt.scharf;
      if (scharf && eingang === null) ab('kein_eingang', 'arm braucht einen Eingang');
      if (scharf && !alt.scharf && p.spuren.filter((x) => x !== s && x.aufnahme?.scharf).length >= MAX_ARM_AUDIO) {
        ab('zu_viele_scharf', `höchstens ${MAX_ARM_AUDIO} scharfe Audio-Spuren`);
      }
      if (scharf || eingang !== null) s.aufnahme = { scharf, eingang }; else delete s.aufnahme;
    }
    if (name !== undefined) s.name = name;
    if (gruppe === null) delete s.gruppe; else if (gruppe !== undefined) s.gruppe = gruppe;
    if (a.farbe !== undefined) s.farbe = a.farbe;
    if (fader !== undefined) s.fader_db = fader;
    if (pan !== undefined) s.pan = pan;
    if (mute !== undefined) s.mute = mute;
    if (solo !== undefined) s.solo = solo;
    if (geraet && kanonisch(geraet) !== kanonisch(s.geraet)) {
      s.geraet = geraet;
      if (geraet.art === 'wirt') s.freeze = null; else delete s.freeze;
    }
  },

  // Paket 1.18, E-c: die gewählte Spur laut (mute false), alle anderen Spuren derselben Gruppe stumm (mute true); Spuren außerhalb der Gruppe
  // bleiben unberührt. Ein Befehl, also ein Undo-Schritt. Die Spur muss zur Gruppe gehören (sonst argument_ungueltig).
  variante_waehlen(p, a) {
    erlaube(a, 'gruppe', 'spur_id');
    const gruppe = gruppeArg(a, false) as string;
    const gewaehlt = spurVon(p, idArg(a, 'spur_id'));
    if (gewaehlt.gruppe !== gruppe) ab('argument_ungueltig', `spur_id: ${gewaehlt.id} gehört nicht zur Gruppe ${gruppe}`);
    for (const s of p.spuren) if (s.gruppe === gruppe) s.mute = s !== gewaehlt;
  },

  spur_loeschen(p, a) {
    erlaube(a, 'spur_id');
    const s = spurVon(p, idArg(a, 'spur_id'));
    p.spuren.splice(p.spuren.indexOf(s), 1);
  },

  spur_verschieben(p, a) {
    erlaube(a, 'spur_id', 'index');
    const s = spurVon(p, idArg(a, 'spur_id'));
    if (!Number.isInteger(a.index)) ab('argument_ungueltig', 'index: ganze Zahl erwartet');
    if (a.index < 0 || a.index >= p.spuren.length) ab('index_bereich', `${a.index} (0..${p.spuren.length - 1})`);
    p.spuren.splice(p.spuren.indexOf(s), 1);
    p.spuren.splice(a.index, 0, s);
  },

  clip_neu(p, a) {
    erlaube(a, 'spur_id', 'art', 'start_beat', 'laenge_beats', 'loop_beats', 'sha256', 'name', 'pfad_hinweis', 'noten', 'warp');
    const s = spurVon(p, idArg(a, 'spur_id'));
    if (a.art !== 'audio' && a.art !== 'midi') ab('argument_ungueltig', 'art: audio oder midi erwartet');
    if (a.art !== (s.art === 'audio' ? 'audio' : 'midi')) ab('art_passt_nicht', `${a.art}-Clip auf ${s.art}-Spur`);
    const start = zahl(a, 'start_beat', 0, MAX_BEAT)!, laenge = zahl(a, 'laenge_beats', 0, MAX_BEAT, { offenUnten: true })!;
    // Spec 6.17: loop_beats 1/16 ≤ x ≤ laenge_beats; null oder fehlend = kein Loop (das Feld bleibt dann weg)
    const loop = a.loop_beats === undefined || a.loop_beats === null ? null : zahl(a, 'loop_beats', LOOP_MIN, MAX_BEAT)!;
    if (loop !== null && loop > laenge + 1e-9) ab('argument_ungueltig', `loop_beats: höchstens laenge_beats (${laenge})`);
    const id = neueId(p, 'clip');
    if (a.art === 'audio') {
      if (a.noten !== undefined) ab('argument_ungueltig', 'noten: nur für MIDI-Clips');
      const warp = warpArg(a.warp);
      if (typeof a.sha256 !== 'string' || !SHA.test(a.sha256)) ab('sha_ungueltig', 'sha256: 64 Hex-Zeichen (klein) aus dem Katalog erwartet');
      const hinweis = a.pfad_hinweis === undefined ? ''
        : (typeof a.pfad_hinweis === 'string' && a.pfad_hinweis.length <= 4096 ? a.pfad_hinweis : ab('argument_ungueltig', 'pfad_hinweis: Text erwartet'));
      const vonPfad = hinweis.split('/').pop()?.replace(/\.[^.]*$/, '').slice(0, 80);
      s.clips.push({ id, art: 'audio', name: text(a, 'name', 80) ?? (vonPfad || 'Audio'), start_beat: start, laenge_beats: laenge,
        quelle: { sha256: a.sha256, pfad_hinweis: hinweis }, dekodiert: 'nein', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0,
        ...(loop === null ? {} : { loop_beats: loop }), ...(warp === null ? {} : { warp }) });
    } else {
      if (a.warp !== undefined) ab('feld_nur_audio', 'warp');
      if (a.sha256 !== undefined || a.pfad_hinweis !== undefined) ab('argument_ungueltig', 'sha256/pfad_hinweis: nur für Audio-Clips');
      const clip: MidiClip = { id, art: 'midi', name: text(a, 'name', 80) ?? 'MIDI', start_beat: start, laenge_beats: laenge,
        ...(loop === null ? {} : { loop_beats: loop }), noten: [] };
      if (a.noten !== undefined) fuegeNotenEin(p, clip, listeArg(a, 'noten'));
      s.clips.push(clip);
    }
  },

  clip_aendern(p, a) {
    erlaube(a, 'clip_id', 'start_beat', 'laenge_beats', 'loop_beats', 'offset_s', 'gain_db', 'fade_ein_beats', 'fade_aus_beats', 'spur_id', 'name',
      'versatz_beats');
    const { spur, clip } = clipVon(p, idArg(a, 'clip_id'));
    const felder = ['start_beat', 'laenge_beats', 'loop_beats', 'offset_s', 'gain_db', 'fade_ein_beats', 'fade_aus_beats', 'spur_id', 'name',
      'versatz_beats'];
    if (felder.every((k) => a[k] === undefined)) ab('argument_ungueltig', 'keine Änderung angegeben');
    for (const k of ['offset_s', 'gain_db', 'fade_ein_beats', 'fade_aus_beats', 'versatz_beats']) {
      if (a[k] !== undefined && clip.art !== 'audio') ab('feld_nur_audio', k);
    }
    const versatz = zahl(a, 'versatz_beats', -MAX_BEAT, MAX_BEAT, { opt: true });
    const start = zahl(a, 'start_beat', 0, MAX_BEAT, { opt: true }), laenge = zahl(a, 'laenge_beats', 0, MAX_BEAT, { opt: true, offenUnten: true });
    const offset = zahl(a, 'offset_s', 0, 1e7, { opt: true }), gain = zahl(a, 'gain_db', GAIN_MIN, GAIN_MAX, { opt: true });
    const ein = zahl(a, 'fade_ein_beats', 0, MAX_BEAT, { opt: true }), aus = zahl(a, 'fade_aus_beats', 0, MAX_BEAT, { opt: true });
    const name = text(a, 'name', 80);
    const loop = a.loop_beats === undefined || a.loop_beats === null ? a.loop_beats as null | undefined : zahl(a, 'loop_beats', LOOP_MIN, MAX_BEAT)!;
    let ziel: Spur | undefined;
    if (a.spur_id !== undefined) {
      ziel = spurVon(p, idArg(a, 'spur_id'));
      if (clip.art !== (ziel.art === 'audio' ? 'audio' : 'midi')) ab('art_passt_nicht', `${clip.art}-Clip auf ${ziel.art}-Spur`);
    }
    if (start !== undefined) clip.start_beat = start;
    if (laenge !== undefined) clip.laenge_beats = laenge;
    // Spec 6.17: loop_beats ≤ laenge_beats. Ausdrücklich zu lang ist ein Fehler; eine kürzere Länge zieht den Loop mit.
    if (loop !== undefined) {
      if (loop !== null && loop > clip.laenge_beats + 1e-9) ab('argument_ungueltig', `loop_beats: höchstens laenge_beats (${clip.laenge_beats})`);
      clip.loop_beats = loop;
    } else if (clip.loop_beats != null && clip.loop_beats > clip.laenge_beats) clip.loop_beats = clip.laenge_beats;
    if (name !== undefined) clip.name = name;
    if (clip.art === 'audio') {
      // Paket 1.13: bei Warp an liest der Clip nicht über offset_s, sondern über versatz_beats (Beats, tempounabhängig)
      if (offset !== undefined && clip.warp?.an) ab('offset_bei_warp', 'der Clip ist gewarpt: den Inhalt verschiebt versatz_beats');
      if (versatz !== undefined && !clip.warp) ab('kein_warp', clip.id);
      const fv = versatz !== undefined && clip.warp ? warpPruefung({ ...clip.warp, versatz_beats: versatz }) : null;
      if (fv) ab(fv.grund, fv.text);
      if (offset !== undefined) clip.offset_s = offset;
      if (versatz !== undefined && clip.warp) clip.warp = { ...clip.warp, versatz_beats: versatz };
      if (gain !== undefined) clip.gain_db = gain;
      if (ein !== undefined) clip.fade_ein_beats = ein;
      if (aus !== undefined) clip.fade_aus_beats = aus;
      if (clip.fade_ein_beats + clip.fade_aus_beats > clip.laenge_beats + 1e-9) {
        ab('fade_zu_lang', `${clip.fade_ein_beats} + ${clip.fade_aus_beats} > ${clip.laenge_beats}`);
      }
    }
    if (ziel && ziel !== spur) { spur.clips.splice(spur.clips.indexOf(clip), 1); ziel.clips.push(clip); }
  },

  clip_teilen(p, a) {
    erlaube(a, 'clip_id', 'beat');
    const { spur, clip } = clipVon(p, idArg(a, 'clip_id'));
    if (clip.loop_beats != null) ab('argument_ungueltig', 'Loop-Clip: erst den Loop ausschalten (loop_beats null), dann teilen (Spec 6.17)');
    const beat = zahl(a, 'beat', -MAX_BEAT, MAX_BEAT)!;
    const rel = beat - clip.start_beat, rest = clip.start_beat + clip.laenge_beats - beat;
    if (!(rel > 0 && rest > 0)) ab('beat_ausserhalb', `${beat} liegt nicht im Inneren von ${clip.start_beat}..${clip.start_beat + clip.laenge_beats}`);
    const id = neueId(p, 'clip');
    let zweiter: Clip;
    if (clip.art === 'audio') {
      const zw: AudioClip = { ...structuredClone(clip), id, start_beat: beat, laenge_beats: rest,
        offset_s: runde9(clip.offset_s + rel * 60 / p.tempo_bpm), fade_ein_beats: 0, fade_aus_beats: Math.min(clip.fade_aus_beats, rest) };
      // Paket 1.13: der zweite Teil beginnt rel Beats weiter im Inhalt, exakt in Beats und unabhängig vom Tempo
      if (zw.warp) zw.warp = { ...zw.warp, versatz_beats: runde9(zw.warp.versatz_beats + rel) };
      zweiter = zw;
      clip.fade_ein_beats = Math.min(clip.fade_ein_beats, rel); clip.fade_aus_beats = 0;
    } else {
      const erste: Note[] = [], zweite: Note[] = [], quer: Note[] = [];
      for (const n of clip.noten) {
        if (n.beat + n.laenge <= rel) erste.push(n);
        else if (n.beat >= rel) zweite.push({ ...n, beat: runde9(n.beat - rel) });
        else { erste.push({ ...n, laenge: runde9(rel - n.beat) }); quer.push({ ...n, beat: 0, laenge: runde9(n.beat + n.laenge - rel) }); }
      }
      zweiter = { ...structuredClone(clip), id, start_beat: beat, laenge_beats: rest, noten: zweite };
      for (const q of quer) { q.id = neueNotenId(p); zweiter.noten.push(q); }
      clip.noten = erste;
    }
    clip.laenge_beats = rel;
    spur.clips.splice(spur.clips.indexOf(clip) + 1, 0, zweiter);
  },

  // Paket 1.13: Warp eines Audio-Clips. Entweder das ganze Objekt (`warp`, null oder 'aus' entfernt es) oder einzelne Felder des vorhandenen Warps.
  warp_setzen(p, a) {
    erlaube(a, 'clip_id', 'warp', ...WARP_FELDER);
    const gefunden = clipVon(p, idArg(a, 'clip_id')).clip;
    const clip = gefunden.art === 'audio' ? gefunden : ab('feld_nur_audio', 'warp');
    const einzeln = WARP_FELDER.filter((k) => a[k] !== undefined);
    if (a.warp !== undefined) {
      if (einzeln.length) ab('argument_ungueltig', `warp: entweder das ganze Objekt oder einzelne Felder (${einzeln.join(', ')})`);
      const w = warpArg(a.warp);
      if (w === null) delete clip.warp; else clip.warp = w;
      return;
    }
    if (!einzeln.length) ab('argument_ungueltig', 'keine Änderung angegeben');
    const alt = clip.warp ?? ab('kein_warp', clip.id);
    const neu: Warp = structuredClone(alt);
    if (a.an !== undefined) neu.an = flagge(a, 'an')!;
    if (a.modus !== undefined) neu.modus = a.modus;
    if (a.transpose_st !== undefined) neu.transpose_st = a.transpose_st;
    if (a.detune_ct !== undefined) neu.detune_ct = a.detune_ct;
    const f = warpPruefung(neu);
    if (f) ab(f.grund, f.text);
    clip.warp = neu;
  },

  // Paket 1.13: Auto-Warp aus den Tempo-Angaben der Library löst der Server auf (sitzung.ts loeseQuellenAuf schreibt den Befehl in warp_setzen
  // um); ohne Katalog bleibt nur diese Ablehnung
  warp_auto(p, a) {
    erlaube(a, 'clip_id');
    if (clipVon(p, idArg(a, 'clip_id')).clip.art !== 'audio') ab('feld_nur_audio', 'warp');
    ab('argument_ungueltig', 'warp_auto braucht den Katalog des Servers (Tempo-Angaben der Library)');
  },

  clip_duplizieren(p, a) {
    erlaube(a, 'clip_id', 'ziel_beat');
    const { spur, clip } = clipVon(p, idArg(a, 'clip_id'));
    const ziel = zahl(a, 'ziel_beat', 0, MAX_BEAT, { opt: true }) ?? clip.start_beat + clip.laenge_beats;
    const kopie = { ...structuredClone(clip), id: neueId(p, 'clip'), start_beat: ziel };
    spur.clips.splice(spur.clips.indexOf(clip) + 1, 0, kopie);
  },

  clip_loeschen(p, a) {
    erlaube(a, 'clip_id');
    const { spur, clip } = clipVon(p, idArg(a, 'clip_id'));
    spur.clips.splice(spur.clips.indexOf(clip), 1);
  },

  noten_neu(p, a) {
    erlaube(a, 'clip_id', 'noten');
    const id = idArg(a, 'clip_id');
    const clip = midiVon(clipVon(p, id).clip, id);
    const roh = listeArg(a, 'noten');
    const neu = new Set<string>();
    for (const r of roh) if (istObjekt(r) && typeof r.id === 'string') { if (neu.has(r.id)) ab('id_belegt', r.id); neu.add(r.id); }
    fuegeNotenEin(p, clip, roh);
  },

  noten_aendern(p, a) {
    erlaube(a, 'clip_id', 'noten');
    const id = idArg(a, 'clip_id');
    const clip = midiVon(clipVon(p, id).clip, id);
    const roh = listeArg(a, 'noten');
    const nachId = new Map(clip.noten.map((n, k) => [n.id, k] as const));  // linear statt find je Note (S2-Integration Slice 1)
    const aenderungen = roh.map((r, i) => {
      if (!istObjekt(r)) return ab('argument_ungueltig', `noten[${i}]: Objekt erwartet`);
      erlaube(r as Args, 'id', 'beat', 'laenge', 'ton', 'vel');
      if (typeof r.id !== 'string') ab('argument_ungueltig', `noten[${i}].id: ID erwartet`);
      const f = notenFelder(r as Args, `noten[${i}]`, true);
      if (Object.keys(f).length === 0) ab('argument_ungueltig', `noten[${i}]: keine Änderung angegeben`);
      const k = nachId.get(r.id as string) ?? ab('noten_unbekannt', String(r.id));
      return { k, f };
    });
    // Spec 6.31 (Leistung): eine geänderte Note ist ein neues Objekt, die alte bleibt unberührt (der Notenweg teilt ungeänderte Noten mit dem Stand davor)
    for (const { k, f } of aenderungen) clip.noten[k] = { ...clip.noten[k], ...f };
  },

  noten_loeschen(p, a) {
    erlaube(a, 'clip_id', 'ids');
    const id = idArg(a, 'clip_id');
    const clip = midiVon(clipVon(p, id).clip, id);
    const ids = listeArg(a, 'ids');
    const da = new Set(clip.noten.map((x) => x.id)), weg = new Set<string>();   // linear statt some/includes je Note (S2-Integration Slice 1)
    for (const n of ids) { if (typeof n !== 'string' || !da.has(n)) ab('noten_unbekannt', String(n)); weg.add(n as string); }
    clip.noten = clip.noten.filter((n) => !weg.has(n.id));
  },

  // 1.10 Slice 1 (P4): Gruppen-Spuren. Die Namen vermeiden das Feld `gruppe` der Varianten (Paket 1.18, E-c).
  gruppenspur_neu(p, a) {
    erlaube(a, 'name', 'farbe', 'mitglieder');
    const gl = (p.gruppen ??= []);
    if (gl.length >= MAX_GRUPPEN) ab('routing_grenze', `all ${MAX_GRUPPEN} groups are used`);
    const nr = Array.from({ length: MAX_GRUPPEN }, (_, i) => i + 1).find((n) => !gl.some((g) => g.nr === n)) ?? ab('routing_grenze', 'no free group number');
    if (a.farbe !== undefined && (typeof a.farbe !== 'string' || !FARBE_OK.test(a.farbe))) ab('argument_ungueltig', 'farbe: #rrggbb erwartet');
    let mitglieder: Spur[] = [];
    if (a.mitglieder !== undefined) {
      if (!Array.isArray(a.mitglieder) || a.mitglieder.length < 1 || a.mitglieder.length > MAX_SPUREN) {
        ab('argument_ungueltig', 'mitglieder: nicht leere Liste von Spur-IDs erwartet');
      }
      const ids = new Set<string>();
      mitglieder = a.mitglieder.map((x: unknown) => {
        if (typeof x !== 'string' || ids.has(x)) return ab('argument_ungueltig', 'mitglieder: Spur-IDs ohne Doppelte erwartet');
        ids.add(x);
        return spurVon(p, x);
      });
    }
    const g: Gruppe = { id: neueId(p, 'gruppe'), nr, name: text(a, 'name', 80) ?? `Group ${nr}`, farbe: a.farbe ?? SPUR_FARBEN[(nr - 1) % SPUR_FARBEN.length],
      fader_db: 0, pan: 0, mute: false, solo: false, gefaltet: false };
    gl.push(g);
    for (const s of mitglieder) s.ausgang = { art: 'gruppe', id: g.id };
  },

  gruppenspur_aendern(p, a) {
    erlaube(a, 'gruppe_id', 'name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'gefaltet');
    const g = gruppeVon(p, idArg(a, 'gruppe_id'));
    if (GRUPPE_LEICHT.every((k) => a[k] === undefined)) ab('argument_ungueltig', 'keine Änderung angegeben');
    const name = text(a, 'name', 80);
    if (a.farbe !== undefined && (typeof a.farbe !== 'string' || !FARBE_OK.test(a.farbe))) ab('argument_ungueltig', 'farbe: #rrggbb erwartet');
    const fader = zahl(a, 'fader_db', FADER_MIN, FADER_MAX, { opt: true }), pan = zahl(a, 'pan', -1, 1, { opt: true });
    const mute = flagge(a, 'mute', true), solo = flagge(a, 'solo', true), gefaltet = flagge(a, 'gefaltet', true);
    if (name !== undefined) g.name = name;
    if (a.farbe !== undefined) g.farbe = a.farbe;
    if (fader !== undefined) g.fader_db = fader;
    if (pan !== undefined) g.pan = pan;
    if (mute !== undefined) g.mute = mute;
    if (solo !== undefined) g.solo = solo;
    if (gefaltet !== undefined) g.gefaltet = gefaltet;
  },

  gruppenspur_loeschen(p, a) {   // Mitglieder wechseln auf master (derselbe Schritt), nie verwaiste Ziele
    erlaube(a, 'gruppe_id');
    const gl = (p.gruppen ??= []);
    const g = gruppeVon(p, idArg(a, 'gruppe_id'));
    for (const s of p.spuren) if (s.ausgang?.id === g.id) delete s.ausgang;
    gl.splice(gl.indexOf(g), 1);
  },

  // strang_id: eine Spur- oder Gruppen-ID. Spuren dürfen in eine Gruppe (Tiefe 1); eine Gruppe kann nur auf master zeigen:
  // in sich selbst ist routing_zyklus, in eine andere routing_grenze.
  ziel_setzen(p, a) {
    erlaube(a, 'strang_id', 'ausgang');
    const id = idArg(a, 'strang_id');
    const z = a.ausgang;
    let gid: string | null;
    if (z === 'master' || (istObjekt(z) && z.art === 'master')) gid = null;
    else if (istObjekt(z) && z.art === 'gruppe' && typeof z.id === 'string') gid = z.id;
    else return ab('argument_ungueltig', "ausgang: 'master' oder {art: 'gruppe', id} erwartet");
    if (gid !== null && !(p.gruppen ?? []).some((g) => g.id === gid)) ab('ziel_unbekannt', gid);
    const spur = sucheSpur(p, id);
    if (spur) {
      if (gid === null) delete spur.ausgang; else spur.ausgang = { art: 'gruppe', id: gid };
      return;
    }
    const grp = (p.gruppen ?? []).find((g) => g.id === id);
    if (!grp) return ab('spur_unbekannt', id);
    if (gid === null) return;
    return gid === grp.id ? ab('routing_zyklus', `group ${id} cannot feed itself`) : ab('routing_grenze', 'groups do not nest (depth 1)');
  },

  master_aendern(p, a) {
    erlaube(a, 'fader_db');
    (p.master ??= { fader_db: 0 }).fader_db = zahl(a, 'fader_db', FADER_MIN, FADER_MAX)!;
  },

  tempo_setzen(p, a) {
    erlaube(a, 'bpm');
    if (!zahlOk(a.bpm)) ab('argument_ungueltig', 'bpm: Zahl erwartet');
    if (a.bpm < TEMPO_MIN || a.bpm > TEMPO_MAX) ab('tempo_bereich', `${a.bpm} (${TEMPO_MIN}..${TEMPO_MAX})`);
    p.tempo_bpm = a.bpm;
  },

  loop_setzen(p, a) {
    erlaube(a, 'an', 'von_beat', 'bis_beat');
    const an = flagge(a, 'an')!, von = zahl(a, 'von_beat', 0, MAX_BEAT)!, bis = zahl(a, 'bis_beat', 0, MAX_BEAT)!;
    if (bis - von < 1) ab('loop_bereich', `bis_beat − von_beat muss mindestens 1 sein (${von}..${bis})`);
    p.loop = { an, von_beat: von, bis_beat: bis };
  },

  metronom_setzen(p, a) {
    erlaube(a, 'an', 'pegel_db', 'ziel');
    if (['an', 'pegel_db', 'ziel'].every((k) => a[k] === undefined)) ab('argument_ungueltig', 'keine Änderung angegeben');
    const an = flagge(a, 'an', true), pegel = zahl(a, 'pegel_db', -60, 0, { opt: true });
    if (a.ziel !== undefined && a.ziel !== 'master' && a.ziel !== 'cue') ab('argument_ungueltig', 'ziel: master oder cue erwartet');
    if (an !== undefined) p.metronom.an = an;
    if (pegel !== undefined) p.metronom.pegel_db = pegel;
    if (a.ziel !== undefined) p.metronom.ziel = a.ziel;
  },
};
export const BEFEHL_NAMEN: readonly string[] = Object.keys(PRO_BEFEHL);

// Ein eingefrorener Wirt-Spur-Klang gilt nur zu genau den Noten, dem Gerät und dem Tempo, mit denen er entstanden ist
// (Spec 3.3: Noten oder Gerät; Tempo ergänzt, weil das Audio in Sekunden fest ist und die Noten in Beats wandern).
// `Vorher` hält nur, was dafür nötig ist: Tempo und die Klang-Sicht der eingefrorenen Spuren. Ohne Freeze im Projekt kostet das nichts.
interface Vorher { tempo: number; sichten: Map<string, string> }
function merkeFreezes(p: Projekt): Vorher | null {
  const frozen = p.spuren.filter((s) => s.freeze);
  return frozen.length === 0 ? null : { tempo: p.tempo_bpm, sichten: new Map(frozen.map((s) => [s.id, kanonisch(spurSicht(s, false))])) };
}
function verwerfeFreezes(vorher: Vorher, neu: Projekt): void {
  for (const s of neu.spuren) {
    if (!s.freeze) continue;
    const alt = vorher.sichten.get(s.id);
    if (alt === undefined || vorher.tempo !== neu.tempo_bpm || alt !== kanonisch(spurSicht(s, false))) s.freeze = null;
  }
}

function pruefeBefehl(b: unknown): asserts b is Befehl {
  if (!istObjekt(b) || typeof b.befehl !== 'string' || !Object.hasOwn(PRO_BEFEHL, b.befehl)) {
    ab('befehl_unbekannt', istObjekt(b) && typeof b.befehl === 'string' ? b.befehl : 'kein Befehl');
  }
}
function wendeAn(entwurf: Projekt, b: unknown, ctx: Kontext): void {
  pruefeBefehl(b);
  const vorher = merkeFreezes(entwurf);
  PRO_BEFEHL[b.befehl](entwurf, b as Args, ctx);
  if (vorher) verwerfeFreezes(vorher, entwurf);
}

const KURZ = { fader_db: 'fader', pan: 'pan', mute: 'mute', solo: 'solo' } as const;
// Welche Regler (spur/<nr>/…) müssen auf welchen Wert? Mute und Solo als 0/1.
function reglerAenderungen(alt: Projekt, neu: Projekt): ReglerAenderung[] {
  const werte = (s: Spur): Record<(typeof MIXER)[number], number> => ({ fader_db: s.fader_db, pan: s.pan, mute: s.mute ? 1 : 0, solo: s.solo ? 1 : 0 });
  const aus: ReglerAenderung[] = [];
  for (const s of neu.spuren) {
    const a = alt.spuren.find((x) => x.id === s.id && x.nr === s.nr);
    const w = werte(s), v = a ? werte(a) : null;
    for (const k of MIXER) if (!v || v[k] !== w[k]) aus.push({ pfad: `spur/${s.nr}/${KURZ[k]}`, wert: w[k] });
  }
  for (const a of alt.spuren) {
    if (neu.spuren.some((s) => s.nr === a.nr)) continue;                      // die Nummer lebt weiter (ggf. mit neuer Spur): oben erledigt
    for (const k of MIXER) aus.push({ pfad: `spur/${a.nr}/${KURZ[k]}`, wert: 0 });
  }
  // 1.10: Gruppen-Regler grp/<nr>/* und pm/fader; eine gelöschte oder neue Gruppe setzt den Slot auf die Vorgabe (alles 0) beziehungsweise auf ihre Werte
  const gw = (g: Gruppe): Record<(typeof MIXER)[number], number> => ({ fader_db: g.fader_db, pan: g.pan, mute: g.mute ? 1 : 0, solo: g.solo ? 1 : 0 });
  const altG = alt.gruppen ?? [], neuG = neu.gruppen ?? [];
  for (const g of neuG) {
    const a = altG.find((x) => x.id === g.id && x.nr === g.nr);
    const w = gw(g), v = a ? gw(a) : null;
    for (const k of MIXER) if (!v || v[k] !== w[k]) aus.push({ pfad: `grp/${g.nr}/${KURZ[k]}`, wert: w[k] });
  }
  for (const a of altG) {
    if (neuG.some((g) => g.nr === a.nr)) continue;
    for (const k of MIXER) aus.push({ pfad: `grp/${a.nr}/${KURZ[k]}`, wert: 0 });
  }
  if ((alt.master?.fader_db ?? 0) !== (neu.master?.fader_db ?? 0)) aus.push({ pfad: 'pm/fader', wert: neu.master?.fader_db ?? 0 });
  return aus;
}

// Gleich wie kanonisch(a) === kanonisch(b), ohne beide Seiten zu sortieren und zu serialisieren: Identisches ist gleich (geteilte Noten des
// Notenwegs kosten nichts), Objekte vergleichen ihre Schlüssel ohne Reihenfolge (undefined zählt wie in JSON als fehlend), Arrays der Reihe nach;
// alles andere (Zahlen, Text, null) über kanonisch selbst, damit -0, NaN und Co. genau wie dort ausgehen. Spec 6.31 (Leistung).
export function gleicheSicht(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!gleicheSicht(a[i], b[i])) return false;
    return true;
  }
  if (istObjekt(a) && istObjekt(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined), kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => b[k] !== undefined && gleicheSicht(a[k], b[k]));
  }
  if (istObjekt(a) || istObjekt(b)) return false;
  return kanonisch(a) === kanonisch(b);
}

// Was ein Stand dem Kern sagt: Wiedergabe neu nötig? Welche Regler müssen auf welchen Wert?
export function vergleiche(alt: Projekt, neu: Projekt): { betrifft_wiedergabe: boolean; regler_aenderungen: ReglerAenderung[] } {
  return { betrifft_wiedergabe: !gleicheSicht(wiedergabeSicht(alt), wiedergabeSicht(neu)), regler_aenderungen: reglerAenderungen(alt, neu) };
}

// --- Schneller Weg für Mixer- und Kopfbefehle --------------------------------------------------------------------------
const SPUR_LEICHT = ['name', 'farbe', 'fader_db', 'pan', 'mute', 'solo'];
function istLeicht(projekt: Projekt, b: unknown): boolean {
  if (!istObjekt(b) || typeof b.befehl !== 'string') return false;
  switch (b.befehl) {
    // ein Gerätewechsel berührt Freeze, Slots und Klang; gruppe kann neu entstehen, und leichterUnterschied sieht nur Schlüssel, die schon da sind
    case 'spur_aendern': return b.geraet === undefined && b.gruppe === undefined && b.arm === undefined && b.eingang === undefined;
    case 'loop_setzen': case 'metronom_setzen': return true;
    case 'gruppenspur_aendern': case 'master_aendern': return true;
    case 'tempo_setzen': return !projekt.spuren.some((s) => s.freeze);        // Tempo verwirft Freezes und ändert deren Länge in Beats
    default: return false;
  }
}

// Unterschied zweier Stände, soweit ihn leichte Befehle erzeugen können (Tempo, Loop, Metronom, flache Spur-Felder), in der Schlüsselfolge
// von `von` (dieselbe Reihenfolge wie `unterschied`, damit beide Wege dieselben Patches ergeben).
function leichterUnterschied(von: Projekt, nach: Projekt): Patch {
  const aus: Patch = [];
  const flach = (a: object, b: object, pfad: string, felder?: readonly string[]): void => {
    for (const k of Object.keys(a)) {
      if (felder && !felder.includes(k)) continue;
      const x = (a as Record<string, unknown>)[k], y = (b as Record<string, unknown>)[k];
      if (x !== y && !(Number.isNaN(x) && Number.isNaN(y))) aus.push({ op: 'replace', pfad: `${pfad}/${k}`, wert: y });
    }
  };
  for (const k of Object.keys(von)) {
    if (k === 'tempo_bpm') flach({ tempo_bpm: von.tempo_bpm }, { tempo_bpm: nach.tempo_bpm }, '');
    else if (k === 'loop' || k === 'metronom') flach(von[k], nach[k], `/${k}`);
    else if (k === 'spuren') von.spuren.forEach((s, i) => { if (s !== nach.spuren[i]) flach(s, nach.spuren[i], `/spuren/${s.id}`, SPUR_LEICHT); });
    else if (k === 'gruppen') von.gruppen.forEach((g, i) => { if (g !== nach.gruppen[i]) flach(g, nach.gruppen[i], `/gruppen/${g.id}`, GRUPPE_LEICHT); });
    else if (k === 'master') flach(von.master, nach.master, '/master');
  }
  return aus;
}

function fuehreLeichtAus(projekt: Projekt, befehle: unknown[]): BefehlErgebnis {
  const entwurf: Projekt = { ...projekt, loop: { ...projekt.loop }, metronom: { ...projekt.metronom }, spuren: [...projekt.spuren],
    ...(projekt.gruppen ? { gruppen: [...projekt.gruppen], master: { ...projekt.master } } : {}) };
  const kopiert = new Set<string>();
  befehle.forEach((b, i) => {
    try {
      const a = b as Args;
      if (a.befehl === 'spur_aendern' && typeof a.spur_id === 'string' && !kopiert.has(a.spur_id)) {
        const k = entwurf.spuren.findIndex((s) => s.id === a.spur_id);
        if (k >= 0) { entwurf.spuren[k] = { ...entwurf.spuren[k] }; kopiert.add(a.spur_id); }
      }
      if (a.befehl === 'gruppenspur_aendern' && typeof a.gruppe_id === 'string' && !kopiert.has(a.gruppe_id)) {
        const k = (entwurf.gruppen ?? []).findIndex((g) => g.id === a.gruppe_id);
        if (k >= 0) { entwurf.gruppen[k] = { ...entwurf.gruppen[k] }; kopiert.add(a.gruppe_id); }
      }
      PRO_BEFEHL[a.befehl](entwurf, a, { quelle: 'andreas' });          // nur Befehle ohne Herkunft (istLeicht)
    } catch (e) { if (e instanceof BefehlFehler) e.index = i; throw e; }
  });
  return { projekt: entwurf, vor: leichterUnterschied(projekt, entwurf), zurueck: leichterUnterschied(entwurf, projekt),
    betrifft_wiedergabe: false, regler_aenderungen: reglerAenderungen(projekt, entwurf) };
}

// --- Notenweg (Spec 6.31, Leistung) ----------------------------------------------------------------------------------
// Eine Liste nur aus noten_neu, noten_aendern und noten_loeschen berührt nur die genannten Clips. Statt das ganze Projekt tief zu kopieren,
// bekommen nur ihre Spuren und Clips eine flache Kopie samt eigener Notenliste; alle anderen Spuren, Clips und Noten werden geteilt. Die Befehle
// verändern dabei keine geteilte Note (noten_aendern setzt ein neues Objekt, noten_neu hängt an die eigene Liste, noten_loeschen filtert), und
// unterschied/vergleiche sehen Geteiltes über die Identität. Ergebnis wie der volle Weg (Test: beide Wege, das Ausgangsprojekt bleibt gleich).
const NOTEN_BEFEHLE: ReadonlySet<unknown> = new Set(['noten_neu', 'noten_aendern', 'noten_loeschen']);
function notenEntwurf(projekt: Projekt, befehle: unknown[]): Projekt | null {
  const clips = new Set<string>();
  for (const b of befehle) {
    if (!istObjekt(b) || !NOTEN_BEFEHLE.has(b.befehl) || typeof b.clip_id !== 'string') return null;
    clips.add(b.clip_id);
  }
  return { ...projekt, loop: { ...projekt.loop }, metronom: { ...projekt.metronom },
    spuren: projekt.spuren.map((s) => (s.clips.some((c) => clips.has(c.id))
      ? { ...s, clips: s.clips.map((c) => (clips.has(c.id) && c.art === 'midi' ? { ...c, noten: [...c.noten] } : c)) } : s)) };
}

// Mehrere Befehle nacheinander (spätere sehen frühere); ein Gesamt-Patch von `projekt` zum Ergebnis. Eine Ablehnung verwirft alle.
// o.quelle: Herkunft für spur_neu (Spec 6.22), ohne Angabe andreas. o.voll: immer der allgemeine Weg (tiefe Kopie), für den Vergleich in Tests.
export function fuehreListeAus(projekt: Projekt, befehle: unknown[], o: { voll?: boolean; quelle?: Herkunft } = {}): BefehlErgebnis {
  if (!Array.isArray(befehle) || befehle.length === 0) ab('argument_ungueltig', 'befehle: nicht leere Liste erwartet');
  if (!o.voll && befehle.every((b) => istLeicht(projekt, b))) return fuehreLeichtAus(projekt, befehle);
  const entwurf = (o.voll ? null : notenEntwurf(projekt, befehle)) ?? structuredClone(projekt);
  befehle.forEach((b, i) => {
    try { wendeAn(entwurf, b, { quelle: o.quelle ?? 'andreas' }); } catch (e) { if (e instanceof BefehlFehler) e.index = i; throw e; }
  });
  const fehler = pruefeFehler(entwurf);
  if (fehler !== null) ab('projekt_ungueltig', fehler);
  const g = zaehleAusgerollt(entwurf);                                         // Spec 6.17: die Grenzen gelten nach dem Ausrollen
  // Spec 6.34: englisch (der Text kam bisher deutsch an die Seite, die bei zu_gross den Text der Antwort zeigt)
  if (g.clips > MAX_CLIPS || g.noten > MAX_NOTEN) {
    ab('zu_gross', `after unrolling loops ${g.clips} clips, ${g.noten} notes (at most ${MAX_CLIPS}, ${MAX_NOTEN})`);
  }
  const marker = zaehleWarpMarker(entwurf);                                    // Paket 1.13: Warp-Marker aller Kopien, Grenze wie im Kern
  if (marker > MAX_WARP_PUNKTE) ab('zu_gross', `after unrolling loops ${marker} warp markers (at most ${MAX_WARP_PUNKTE})`);
  return { projekt: entwurf, vor: unterschied(projekt, entwurf), zurueck: unterschied(entwurf, projekt), ...vergleiche(projekt, entwurf) };
}
export const fuehreAus = (projekt: Projekt, befehl: unknown): BefehlErgebnis => fuehreListeAus(projekt, [befehl]);

// Abgleich der Audio-Clips mit dem Dekodier-Cache (Spec 2.8: Zustand je Clip). Kein Befehl und kein Undo-Eintrag: der Zustand ist
// abgeleitet und steht nie in einem Patch (Spec 6.6). Ändert sich etwas, steigt rev um 1; ändert sich nichts, kommt dasselbe Objekt zurück.
export function gleicheDekodiertAb(p: Projekt, zustandVon: (sha256: string) => DekodiertZustand): Projekt {
  let anders = false;
  for (const s of p.spuren) for (const c of s.clips) if (c.art === 'audio' && zustandVon(c.quelle.sha256) !== c.dekodiert) anders = true;
  if (!anders) return p;
  const q = structuredClone(p);
  setzeDekodiert(q, zustandVon);
  q.rev += 1;
  return q;
}
// Setzt den Zustand aller Audio-Clips in `p` selbst (ohne rev). Nach Undo/Redo und beim Nachziehen aus dem Log ruft der Verlauf das über
// den Haken `dekodiert`, weil Patches den echten Zustand nicht tragen.
export function setzeDekodiert(p: Projekt, zustandVon: (sha256: string) => DekodiertZustand): void {
  for (const s of p.spuren) for (const c of s.clips) if (c.art === 'audio') c.dekodiert = zustandVon(c.quelle.sha256);
}
