// Note editor contract (plan A, task A1; spec docs/superpowers/specs/2026-11-25-note-editor-design.md N3 to N7).
// The text of the contract is djk/contract/notes.md, the schemas are djk/contract/schemas/audio_noten, noten_kurve, noten_kurve_roh,
// noten_auftrag and noten_zeile (.schema.json). This file is server side: it imports node:crypto for the render key, so the page does
// not import it (the page gets its own copy of the few constants it needs). It holds types, constants, hand-written checks (no schema
// library at run time) and the render key. The checks must agree with the schemas on every file of djk/contract/cases/noten/, and
// with cases/noten/gruende.json on the reason code of every bad file; djk/ui/tests/notes_contract.test.mjs and
// djk/contract/tests/test_notes_contract.py keep them equal.
import crypto from 'node:crypto';

export const NOTEN_SR = 48000;
export const NOTEN_HOP = 256;
export const KURVE_FORMAT = 'cdj-noten-kurve/1';
export const ROH_FORMAT = 'cdj-noten-kurve-roh/1';
export const AUFTRAG_FORMAT = 'cdj-noten-auftrag/1';
export const SCHLUESSEL_FORMAT = 'cdj-noten-render/1';
// One place each (an algorithm change that changes its output bumps its number; a change of the monophonic check bumps the segmenter)
export const DETEKTOR_VERSION = 'pyin-1';
export const NETZ_VERSION = 'netz-1';
export const SEGMENTIERER_VERSION = 'noten_hmm-1';
export const MASCHINE_VERSION = 'teilton-2';
export const ZIEL_FELDER = ['a', 'e', 'ton', 'vib', 'drift', 'formant', 'gain_db'] as const;
export const TON_SPANNE = 24;   // semitones around qton
export const TON_TOLERANZ = 1e-4;   // targets are rounded to 1e-4 while qton has no decimals rule, so 24 itself is inside
export const MAX_AUDIO_NOTEN = 4096;
export const MONO_ANTEIL_MAX = 0.30;
export const NOTEN_FEHLER = ['argument', 'datei_fehlt', 'datei_kaputt', 'format', 'kurve_passt_nicht', 'noten_ungueltig',
  'nicht_unterstuetzt', 'vorher_passt_nicht', 'schreiben', 'nicht_gebaut'] as const;
export const FORTSCHRITT_NAMEN = ['laden', 'tonhoehe', 'noten', 'pruefen', 'rendern', 'schreiben'] as const;

export type NotenFehler = (typeof NOTEN_FEHLER)[number];
export type ZielFeld = (typeof ZIEL_FELDER)[number];

/** A note of the clip: qa, qe, a, e in source seconds; qton and ton float MIDI; p level 0..1; targets only when they differ from the detected value */
export type AudioNote = { id: string; qa: number; qe: number; qton: number; p: number; a?: number; e?: number; ton?: number; vib?: number; drift?: number;
  formant?: number; gain_db?: number };
export type AudioNotenFeld = { kurve: string; liste: AudioNote[] };
/** A detected note of the sidecar (no id, no targets) */
export type ErkannteNote = { qa: number; qe: number; qton: number; p: number };
export type NotenMono = { geprueft_frames: number; anteil: number; mehrstimmig: boolean; hrr_db_schwelle: number; periode_schwelle: number };
export type NotenKurve = { format: typeof KURVE_FORMAT; quelle: string; frames: number; sr: typeof NOTEN_SR; hop: typeof NOTEN_HOP; detektor: 'pyin' | 'netz';
  kurve: string; f0_ct: number[]; konf: number[]; noten: ErkannteNote[]; stimmhaft_anteil: number; mono?: NotenMono };
export type NotenKurveRoh = { format: typeof ROH_FORMAT; frames: number; sr: typeof NOTEN_SR; hop: typeof NOTEN_HOP; detektor: 'netz'; detektor_version: string;
  f0_ct: number[]; konf: number[] };
export type RenderAuftrag = { format: typeof AUFTRAG_FORMAT; kurve: string; liste: AudioNote[] };
/** The one stdout line of `cypherdj-noten` */
export type NotenZeile =
  | { status: 'ok'; programm: 'cypherdj-noten'; vertrag: 1; detektor: string; segmentierer: string; maschine: string }
  | { status: 'ok'; datei: string; noten: number; stimmhaft: number; sekunden: number }
  | { status: 'ok'; mehrstimmig: boolean; anteil: number; sekunden: number }
  | { status: 'ok'; datei: string; bereiche: [number, number][]; sekunden: number }
  | { status: 'fehler'; fehler: NotenFehler; text: string };
/** The JSON after `@@fortschritt ` on stderr */
export type NotenFortschritt = { stufe: number; von: number; name: (typeof FORTSCHRITT_NAMEN)[number]; prozent: number; teil?: string };
export type Befund = { grund: string; text: string };

const KURVE_MUSTER = /^[a-z0-9_]+-[0-9]+\.[a-z0-9_]+-[0-9]+$/;
const ID_MUSTER = /^t[1-9][0-9]{0,5}$/;
const SHA_MUSTER = /^[0-9a-f]{64}$/;

const istObjekt = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const istZahl = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const istGanz = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const imBereich = (x: unknown, von: number, bis: number): x is number => istZahl(x) && x >= von && x <= bis;
const nachkommaOk = (x: number, stellen: number): boolean => Math.abs(Math.round(x * 10 ** stellen) - x * 10 ** stellen) < 1e-6;

/** Number of analysis frames of a source of `frames` stereo frames: frame i is centred at sample i * 256 */
export function frameZahl(frames: number): number { return Math.floor(frames / NOTEN_HOP) + 1; }
/** Sidecar file name `<sha>.<curve id>.json` */
export function kurveDatei(sha: string, kurve: string): string { return `${sha}.${kurve}.json`; }
/** True when at least one note carries a target value (a list without targets renders nothing) */
export function hatZiele(liste: AudioNote[]): boolean { return liste.some((n) => ZIEL_FELDER.some((f) => n[f] !== undefined)); }
/** Seconds to 1e-6 */
export function rundeS(x: number): number { return Math.round(x * 1e6) / 1e6; }
/** Pitch, factors, dB to 1e-4 */
export function rundeTon(x: number): number { return Math.round(x * 1e4) / 1e4; }
/** A target pitch is allowed: inside 0..127 and at most 24 semitones (plus 1e-4 for the rounding of targets) from the detected pitch */
export function tonImSpann(ton: number, qton: number): boolean { return ton >= 0 && ton <= 127 && Math.abs(ton - qton) <= TON_SPANNE + TON_TOLERANZ; }

/** Canonical text of a note list for the render key: one array per note, absent targets as null, id and p left out */
export function kanonischeListe(liste: AudioNote[]): string {
  const s = (x: number | undefined): number | null => (x === undefined ? null : rundeS(x));
  const t = (x: number | undefined): number | null => (x === undefined ? null : rundeTon(x));
  return JSON.stringify(liste.map((n) => [s(n.qa), s(n.qe), t(n.qton), s(n.a), s(n.e), t(n.ton), t(n.vib), t(n.drift), t(n.formant), t(n.gain_db)]));
}

/** sha256 (64 lowercase hex) of the render inputs; the curve id is part of it because the same notes on another curve render differently */
export function renderSchluessel(quelleSha: string, kurve: string, maschine: string, liste: AudioNote[]): string {
  const text = `${SCHLUESSEL_FORMAT}\n${quelleSha}\n${kurve}\n${maschine}\n${kanonischeListe(liste)}`;
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// ---- note lists -------------------------------------------------------------------------------------------------------------

// form: the schema refuses it; bereich: `ton` outside 0..127 (also refused by the schema, but the clip field names it noten_ton_grenze);
// regel: a rule that compares values; grenze: `ton` beyond the span of 24 semitones (a rule)
type Fehler = { art: 'form' | 'bereich' | 'regel' | 'grenze'; text: string };
const form = (text: string): Fehler => ({ art: 'form', text });
const regel = (text: string): Fehler => ({ art: 'regel', text });
const bereich = (text: string): Fehler => ({ art: 'bereich', text });
const grenze = (text: string): Fehler => ({ art: 'grenze', text });

function nurFelder(o: Record<string, unknown>, erlaubt: readonly string[], pflicht: readonly string[], wo: string): string | null {
  for (const k of pflicht) if (!(k in o)) return `${wo}: missing field ${k}`;
  for (const k of Object.keys(o)) if (!erlaubt.includes(k)) return `${wo}: unknown field ${k}`;
  return null;
}

/** Shape and range of one note (the part JSON Schema can say); mitZiel false for a detected note of a sidecar */
function noteForm(n: unknown, wo: string, mitZiel: boolean): Fehler | null {
  if (!istObjekt(n)) return form(`${wo}: must be an object`);
  const basis = mitZiel ? ['id', 'qa', 'qe', 'qton', 'p'] : ['qa', 'qe', 'qton', 'p'];
  const f = nurFelder(n, mitZiel ? [...basis, ...ZIEL_FELDER] : basis, basis, wo);
  if (f) return form(f);
  if (mitZiel && (typeof n.id !== 'string' || !ID_MUSTER.test(n.id))) return form(`${wo}.id: id must match ^t[1-9][0-9]{0,5}$`);
  if (!istZahl(n.qa) || n.qa < 0) return form(`${wo}.qa: must be a number >= 0`);
  if (!istZahl(n.qe) || n.qe <= 0) return form(`${wo}.qe: must be a number > 0`);
  if (!imBereich(n.qton, 0, 127)) return form(`${wo}.qton: must be a number in 0..127`);
  if (!imBereich(n.p, 0, 1)) return form(`${wo}.p: must be a number in 0..1`);
  if (!mitZiel) return null;
  if (n.a !== undefined && (!istZahl(n.a) || n.a < 0)) return form(`${wo}.a: must be a number >= 0`);
  if (n.e !== undefined && (!istZahl(n.e) || n.e <= 0)) return form(`${wo}.e: must be a number > 0`);
  if (n.ton !== undefined) {
    if (!istZahl(n.ton)) return form(`${wo}.ton: must be a number`);
    if (n.ton < 0 || n.ton > 127) return bereich(`${wo}.ton: ${n.ton} is outside the limit 0..127`);
  }
  const faktor: [string, number, number, number][] = [['vib', 0, 4, 1], ['drift', 0, 4, 1], ['formant', -12, 12, 0], ['gain_db', -48, 12, 0]];
  for (const [k, von, bis, vorgabe] of faktor) {
    if (n[k] === undefined) continue;
    if (!imBereich(n[k], von, bis)) return form(`${wo}.${k}: must be a number in ${von}..${bis}`);
    if (n[k] === vorgabe) return form(`${wo}.${k}: ${vorgabe} is the default and is not stored`);
  }
  return null;
}

/** Rules that compare values, shape already checked. Fixed order, each rule across the whole list before the next one: duplicate ids,
 *  duration, targets against detected values (per note: ton equal, ton span, a equal, e equal, effective end), order, overlap, and
 *  (sidecar only) the end of the last note inside the source. */
function noteRegeln(liste: Record<string, number | string | undefined>[], wo: string, mitZiel: boolean, endeMax?: number): Fehler | null {
  const num = liste as Record<string, number>[];
  if (mitZiel) {
    const gesehen = new Set<unknown>();
    for (const [i, n] of liste.entries()) {
      if (gesehen.has(n.id)) return regel(`${wo}[${i}].id: duplicate id ${n.id}`);
      gesehen.add(n.id);
    }
  }
  for (const [i, n] of num.entries()) {
    if (n.qe <= n.qa + 0.01) return regel(`${wo}[${i}]: duration must be greater than 0.01 s (qe > qa + 0.01)`);
  }
  if (mitZiel) {
    for (const [i, n] of num.entries()) {
      const w = `${wo}[${i}]`;
      if (n.ton !== undefined) {
        if (n.ton === n.qton) return regel(`${w}.ton: equals qton, a target that equals the detected value is not stored`);
        if (!tonImSpann(n.ton, n.qton)) return grenze(`${w}.ton: ${n.ton} is more than ${TON_SPANNE} semitones from qton ${n.qton} (limit)`);
      }
      if (n.a !== undefined && n.a === n.qa) return regel(`${w}.a: equals qa, a target that equals the detected value is not stored`);
      if (n.e !== undefined && n.e === n.qe) return regel(`${w}.e: equals qe, a target that equals the detected value is not stored`);
      if ((n.e ?? n.qe) <= (n.a ?? n.qa)) return regel(`${w}: e must be greater than a (qe and qa count where a target is absent)`);
    }
  }
  for (let i = 1; i < num.length; i++) {
    if (num[i].qa < num[i - 1].qa) return regel(`${wo}[${i}]: notes must be in order of qa (qa ${num[i].qa} comes before ${num[i - 1].qa})`);
  }
  for (let i = 1; i < num.length; i++) {
    if (num[i - 1].qe > num[i].qa) return regel(`${wo}[${i}]: notes overlap (qe ${num[i - 1].qe} is after the next qa ${num[i].qa})`);
  }
  if (endeMax !== undefined) {
    for (const [i, n] of num.entries()) {
      if (n.qe > endeMax) return regel(`${wo}[${i}]: note ends after the end of the source (qe ${n.qe}, at most ${endeMax})`);
    }
  }
  return null;
}

/** Shape, then rules of a whole list; null = valid */
function listeFehler(liste: unknown, wo: string, mitZiel: boolean, endeMax?: number): Fehler | null {
  if (!Array.isArray(liste)) return form(`${wo}: must be an array`);
  if (liste.length > MAX_AUDIO_NOTEN) return form(`${wo}: at most ${MAX_AUDIO_NOTEN} notes`);
  for (const [i, n] of liste.entries()) {
    const f = noteForm(n, `${wo}[${i}]`, mitZiel);
    if (f) return f;
  }
  return noteRegeln(liste as Record<string, number | string | undefined>[], wo, mitZiel, endeMax);
}

const kurveFormFehler = (x: unknown, wo: string): string | null =>
  (typeof x === 'string' && KURVE_MUSTER.test(x) ? null : `${wo}: kurve must be <detector version>.<segmenter version>, for example pyin-1.noten_hmm-1`);

/** Shape and range check of the clip field `audio_noten`; grund is `noten_ton_grenze` (ton outside 0..127 or beyond the span) or `argument_ungueltig` */
export function audioNotenPruefung(x: unknown): Befund | null {
  if (!istObjekt(x)) return { grund: 'argument_ungueltig', text: 'audio_noten must be an object { kurve, liste }' };
  const f = nurFelder(x, ['kurve', 'liste'], ['kurve', 'liste'], 'audio_noten');
  if (f) return { grund: 'argument_ungueltig', text: f };
  const k = kurveFormFehler(x.kurve, 'kurve');
  if (k) return { grund: 'argument_ungueltig', text: k };
  const l = listeFehler(x.liste, 'liste', true);
  if (!l) return null;
  return { grund: l.art === 'grenze' || l.art === 'bereich' ? 'noten_ton_grenze' : 'argument_ungueltig', text: l.text };
}

/**
 * Error code of a failed list inside a file: what the schema refuses (the ton range included) is `format`, a broken list rule (the span included) is
 * `noten_ungueltig`
 */
const dateiBefund = (f: Fehler): Befund => ({ grund: f.art === 'form' || f.art === 'bereich' ? 'format' : 'noten_ungueltig', text: f.text });
const formBefund = (text: string): Befund => ({ grund: 'format', text });

// ---- curves -----------------------------------------------------------------------------------------------------------------

function felderFehler(o: Record<string, unknown>, wo: string): string | null {
  const f0 = o.f0_ct; const konf = o.konf;
  if (!Array.isArray(f0)) return `${wo}.f0_ct: must be an array`;
  if (!Array.isArray(konf)) return `${wo}.konf: must be an array`;
  for (const [i, v] of f0.entries()) if (!(v === 0 || imBereich(v, 1500, 11000))) return `${wo}.f0_ct[${i}]: must be 0 or in 1500..11000`;
  for (const [i, v] of konf.entries()) if (!imBereich(v, 0, 1)) return `${wo}.konf[${i}]: must be a number in 0..1`;
  return null;
}

function laengeFehler(o: Record<string, unknown>): string | null {
  const n = frameZahl(o.frames as number);
  const f0 = o.f0_ct as number[]; const konf = o.konf as number[];
  if (f0.length !== n) return `length of f0_ct is ${f0.length}, expected ${n} (floor(frames / ${NOTEN_HOP}) + 1)`;
  if (konf.length !== n) return `length of konf is ${konf.length}, expected ${n} (floor(frames / ${NOTEN_HOP}) + 1)`;
  const i = f0.findIndex((v) => !nachkommaOk(v, 2));
  if (i >= 0) return `f0_ct[${i}]: at most two decimals`;
  const j = konf.findIndex((v) => !nachkommaOk(v, 3));
  if (j >= 0) return `konf[${j}]: at most three decimals`;
  return null;
}

function kopfFehler(o: Record<string, unknown>, format: string): string | null {
  if (o.format !== format) return `format: must be ${format}`;
  if (!istGanz(o.frames) || o.frames < 0) return 'frames: must be an integer >= 0';
  if (o.sr !== NOTEN_SR) return `sr: must be ${NOTEN_SR}`;
  if (o.hop !== NOTEN_HOP) return `hop: must be ${NOTEN_HOP}`;
  return null;
}

/** Sidecar `<sha>.<kurve>.json`; grund `format` (shape, lengths) or `noten_ungueltig` (list rules of the detected notes) */
export function kurvePruefung(x: unknown): Befund | null {
  if (!istObjekt(x)) return formBefund('curve must be an object');
  const pflicht = ['format', 'quelle', 'frames', 'sr', 'hop', 'detektor', 'kurve', 'f0_ct', 'konf', 'noten', 'stimmhaft_anteil'];
  const f = nurFelder(x, [...pflicht, 'mono'], pflicht, 'curve') ?? kopfFehler(x, KURVE_FORMAT);
  if (f) return formBefund(f);
  if (typeof x.quelle !== 'string' || !SHA_MUSTER.test(x.quelle)) return formBefund('quelle: must be 64 lowercase hex digits');
  if (x.detektor !== 'pyin' && x.detektor !== 'netz') return formBefund('detektor: must be pyin or netz');
  const k = kurveFormFehler(x.kurve, 'kurve');
  if (k) return formBefund(k);
  if (!(x.kurve as string).startsWith(`${x.detektor}-`)) return formBefund(`kurve: must start with the version of the detector ${x.detektor}`);
  const a = felderFehler(x, 'curve');
  if (a) return formBefund(a);
  if (!imBereich(x.stimmhaft_anteil, 0, 1)) return formBefund('stimmhaft_anteil: must be a number in 0..1');
  if (x.mono !== undefined) {
    const m = x.mono;
    if (!istObjekt(m)) return formBefund('mono: must be an object');
    const mf = nurFelder(m, ['geprueft_frames', 'anteil', 'mehrstimmig', 'hrr_db_schwelle', 'periode_schwelle'],
      ['geprueft_frames', 'anteil', 'mehrstimmig', 'hrr_db_schwelle', 'periode_schwelle'], 'mono');
    if (mf) return formBefund(mf);
    if (!istGanz(m.geprueft_frames) || m.geprueft_frames < 0) return formBefund('mono.geprueft_frames: must be an integer >= 0');
    if (!imBereich(m.anteil, 0, 1)) return formBefund('mono.anteil: must be a number in 0..1');
    if (typeof m.mehrstimmig !== 'boolean') return formBefund('mono.mehrstimmig: must be a boolean');
    if (!istZahl(m.hrr_db_schwelle) || !istZahl(m.periode_schwelle)) return formBefund('mono thresholds: must be numbers');
    if (m.mehrstimmig !== (m.anteil > MONO_ANTEIL_MAX))
      return formBefund(`mono.mehrstimmig: must be ${m.anteil > MONO_ANTEIL_MAX} for anteil ${m.anteil} (true only above ${MONO_ANTEIL_MAX})`);
    if (m.geprueft_frames === 0 && m.anteil !== 0) return formBefund('mono.geprueft_frames: 0 checked frames means anteil 0 and mehrstimmig false');
  }
  const l = listeFehler(x.noten, 'noten', false, (x.frames as number + NOTEN_HOP) / NOTEN_SR + 1e-6);
  if (l && l.art === 'form') return dateiBefund(l);
  const laenge = laengeFehler(x);
  if (laenge) return formBefund(laenge);
  return l ? dateiBefund(l) : null;
}

/** External curve of the network path (input of `segment`) */
export function rohPruefung(x: unknown): Befund | null {
  if (!istObjekt(x)) return formBefund('curve must be an object');
  const pflicht = ['format', 'frames', 'sr', 'hop', 'detektor', 'detektor_version', 'f0_ct', 'konf'];
  const f = nurFelder(x, pflicht, pflicht, 'curve') ?? kopfFehler(x, ROH_FORMAT);
  if (f) return formBefund(f);
  if (x.detektor !== 'netz') return formBefund('detektor: must be netz');
  if (typeof x.detektor_version !== 'string' || !/^netz-[0-9]+$/.test(x.detektor_version)) return formBefund('detektor_version: must be netz-<n>');
  const a = felderFehler(x, 'curve');
  if (a) return formBefund(a);
  const laenge = laengeFehler(x);
  return laenge ? formBefund(laenge) : null;
}

/** Render order: the curve id and the whole note list of the clip; grund `format` or `noten_ungueltig` */
export function auftragPruefung(x: unknown): Befund | null {
  if (!istObjekt(x)) return formBefund('order must be an object');
  const f = nurFelder(x, ['format', 'kurve', 'liste'], ['format', 'kurve', 'liste'], 'order');
  if (f) return formBefund(f);
  if (x.format !== AUFTRAG_FORMAT) return formBefund(`format: must be ${AUFTRAG_FORMAT}`);
  const k = kurveFormFehler(x.kurve, 'kurve');
  if (k) return formBefund(k);
  const l = listeFehler(x.liste, 'liste', true);
  return l ? dateiBefund(l) : null;
}

// ---- lines ------------------------------------------------------------------------------------------------------------------

function sekundenFehler(o: Record<string, unknown>): string | null {
  return istZahl(o.sekunden) && o.sekunden >= 0 ? null : 'sekunden: must be a number >= 0';
}

function zeilenFehler(o: Record<string, unknown>): string | null {
  if (o.status === 'fehler') {
    const f = nurFelder(o, ['status', 'fehler', 'text'], ['status', 'fehler', 'text'], 'line');
    if (f) return f;
    if (!(NOTEN_FEHLER as readonly unknown[]).includes(o.fehler)) return 'fehler: unknown error code';
    return typeof o.text === 'string' && o.text.length > 0 ? null : 'text: must be a non-empty string';
  }
  if (o.status !== 'ok') return 'status: must be ok or fehler';
  if ('programm' in o) {
    const f = nurFelder(o, ['status', 'programm', 'vertrag', 'detektor', 'segmentierer', 'maschine'], ['status', 'programm', 'vertrag', 'detektor',
      'segmentierer', 'maschine'], 'line');
    if (f) return f;
    if (o.programm !== 'cypherdj-noten' || o.vertrag !== 1) return 'programm or vertrag: wrong value';
    const ok = typeof o.detektor === 'string' && /^pyin-[0-9]+$/.test(o.detektor) && typeof o.segmentierer === 'string'
      && /^noten_hmm-[0-9]+$/.test(o.segmentierer)
      && typeof o.maschine === 'string' && /^teilton-[0-9]+$/.test(o.maschine);
    return ok ? null : 'detektor, segmentierer or maschine: not a version string';
  }
  if ('bereiche' in o) {
    const f = nurFelder(o, ['status', 'datei', 'bereiche', 'sekunden'], ['status', 'datei', 'bereiche', 'sekunden'], 'line');
    if (f) return f;
    if (typeof o.datei !== 'string' || o.datei.length === 0) return 'datei: must be a non-empty string';
    if (!Array.isArray(o.bereiche)) return 'bereiche: must be an array';
    for (const b of o.bereiche) {
      if (!Array.isArray(b) || b.length !== 2 || !istGanz(b[0]) || !istGanz(b[1])
        || b[0] < 0) return 'bereiche: each entry must be [s0, s1] with integers >= 0';
      if (b[0] >= b[1]) return 'bereiche: s0 must be less than s1 (half open range)';
    }
    return sekundenFehler(o);
  }
  if ('mehrstimmig' in o) {
    const f = nurFelder(o, ['status', 'mehrstimmig', 'anteil', 'sekunden'], ['status', 'mehrstimmig', 'anteil', 'sekunden'], 'line');
    if (f) return f;
    if (typeof o.mehrstimmig !== 'boolean') return 'mehrstimmig: must be a boolean';
    if (!imBereich(o.anteil, 0, 1)) return 'anteil: must be a number in 0..1';
    return sekundenFehler(o);
  }
  const f = nurFelder(o, ['status', 'datei', 'noten', 'stimmhaft', 'sekunden'], ['status', 'datei', 'noten', 'stimmhaft', 'sekunden'], 'line');
  if (f) return f;
  if (typeof o.datei !== 'string' || o.datei.length === 0) return 'datei: must be a non-empty string';
  if (!istGanz(o.noten) || o.noten < 0 || o.noten > MAX_AUDIO_NOTEN) return `noten: must be an integer in 0..${MAX_AUDIO_NOTEN}`;
  if (!imBereich(o.stimmhaft, 0, 1)) return 'stimmhaft: must be a number in 0..1';
  return sekundenFehler(o);
}

/** One stdout line of `cypherdj-noten`, as the raw text or as the parsed object; every line ends with one LF and the text is accepted
 *  with or without that one trailing LF; grund is always `format` */
export function zeilePruefung(x: unknown): Befund | null {
  let o = x;
  if (typeof x === 'string') {
    const text = x.endsWith('\n') ? x.slice(0, -1) : x;
    if (/[\r\n]/.test(text)) return formBefund('line: must be exactly one line');
    try { o = JSON.parse(text); } catch { return formBefund('line: not valid JSON'); }
  }
  if (!istObjekt(o)) return formBefund('line: must be a JSON object');
  const f = zeilenFehler(o);
  return f ? formBefund(f) : null;
}

/** The JSON of a progress line (after `@@fortschritt `); `teil` is the optional text liesFortschrittsZeichen reads */
export function fortschrittPruefung(x: unknown): Befund | null {
  if (!istObjekt(x)) return formBefund('progress: must be a JSON object');
  const f = nurFelder(x, ['stufe', 'von', 'name', 'prozent', 'teil'], ['stufe', 'von', 'name', 'prozent'], 'progress');
  if (f) return formBefund(f);
  if (!istGanz(x.stufe) || x.stufe < 1) return formBefund('stufe: must be an integer >= 1');
  if (!istGanz(x.von) || x.von < 1) return formBefund('von: must be an integer >= 1');
  if (x.stufe > x.von) return formBefund('stufe: must not be greater than von');
  if (!(FORTSCHRITT_NAMEN as readonly unknown[]).includes(x.name)) return formBefund('name: unknown stage name');
  if (!imBereich(x.prozent, 0, 100)) return formBefund('prozent: must be a number in 0..100');
  if (x.teil !== undefined && typeof x.teil !== 'string') return formBefund('teil: must be a string');
  return null;
}

/** The curve and the source disagree (checked where the source is known: the server and the core): kurve_passt_nicht; sr and hop are fixed by the schema */
export function kurvePasstZurQuelle(kurve: { frames: number }, quelleFrames: number): Befund | null {
  return kurve.frames === quelleFrames ? null
    : { grund: 'kurve_passt_nicht', text: `the curve has ${kurve.frames} frames, the source has ${quelleFrames}` };
}

/** The curve id of a render order must equal the sidecar's: kurve_passt_nicht */
export function auftragPasstZurKurve(auftrag: { kurve: string }, kurve: { kurve: string }): Befund | null {
  return auftrag.kurve === kurve.kurve ? null
    : { grund: 'kurve_passt_nicht', text: `the order is for curve ${auftrag.kurve}, the sidecar holds ${kurve.kurve}` };
}
