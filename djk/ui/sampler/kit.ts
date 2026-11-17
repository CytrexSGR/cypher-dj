// Sampler B: a drum kit from the selected slices of a cut. Reads the cut audio and writes <kit folder>/<name>/ with
//   <note>.f32   one sound per slice: the slice frames bit for bit, except for a 5 ms end fade (raw stereo float32 48 kHz)
//   kit.json     written last, by temp file plus rename: a kit exists only with this file (the picker lists a folder only with it)
// Same rules as the two other kit writers (loops/kit_write.mjs, loops/break_kit.py): the lock folder `.sperre` (5 s wait, a lock older than 10 s is
// abandoned), sound files first, kit.json last. This writer makes a NEW kit: the kit folder is made with mkdir without `recursive`, which fails when the
// name exists and so reserves it. Everything is validated before mkdir; a write that fails afterwards removes the folder again.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { graphenOrdner } from '../graphs.ts';
import { kitsOrdnerVorgabe } from '../paths.ts';
import { KIT_NAME } from '../project/model.ts';
import { geraetName } from './device.ts';
import { liesSchnitt, SchnittFehler, type Ordner, type Schnitt } from './schnitt.ts';

/** The first note of a kit made from slices (as in the kit `starter`); the k-th selected slice gets `ERSTE_NOTE + k`. */
export const ERSTE_NOTE = 36;
/** Kit limit: a sound of at most 10 s at 48 kHz (core/include/cypherdj/kit.h). */
export const KLANG_MAX_FRAMES = 480_000;
/** The end fade: the last 240 frames (5 ms), shorter for a slice of fewer than 480 frames. */
export const AUSBLENDE_FRAMES = 240;
/** Kit limit: 256 MiB of sound files per kit. */
const KIT_MAX_BYTES = 256 * 1024 * 1024;
const MESS_FRAMES = 4800;   // the proposal measures the first 100 ms
/** A bank name, as the add-on kit writer takes it (loops/kit_write.mjs). */
export const BANK = /^[a-z][a-z0-9_]{0,15}$/;
/** The banks the page offers; any value matching BANK is accepted. */
export const BANK_LISTE = ['bd', 'sd', 'hh', 'cp', 'perc'];
const NAME_MAX = 32;
const SLUG_MAX = 28;   // leaves room for "-2" .. "-999" within the 32 characters of a kit name

/** `kits` defaults to `kitsOrdnerVorgabe()` and is read at every call. */
export type KitOrdner = Ordner & { kits?: string };

const kitsOrdner = (o: KitOrdner): string => o.kits ?? kitsOrdnerVorgabe();
const arg = (text: string): SchnittFehler => new SchnittFehler(400, 'argument_ungueltig', text);

// --- proposal ---------------------------------------------------------------------------------------------------------------------------------------

export type Baender = { tief: number; mitte: number; hoch: number; spitze: number };

/** Energy shares of the first `min(n, 4800)` frames of the slice [von, bis) of interleaved stereo `daten`, on the mono mix (L+R)/2: low = one-pole low-pass
 *  at 200 Hz, mid = low-pass 5 kHz minus low-pass 200 Hz, high = the rest. The three shares sum to 1 (all 0 for silence). `spitze` is the peak over the
 *  whole slice and both channels. */
export function baender(daten: Float32Array, von: number, bis: number): Baender {
  const n = Math.min(bis - von, MESS_FRAMES);
  const c1 = 1 - Math.exp(-2 * Math.PI * 200 / 48000), c2 = 1 - Math.exp(-2 * Math.PI * 5000 / 48000);
  let y1 = 0, y2 = 0, eT = 0, eM = 0, eH = 0;
  for (let i = 0; i < n; i++) {
    const x = (daten[2 * (von + i)] + daten[2 * (von + i) + 1]) / 2;
    y1 += c1 * (x - y1);
    y2 += c2 * (x - y2);
    const m = y2 - y1, h = x - y2;
    eT += y1 * y1; eM += m * m; eH += h * h;
  }
  let spitze = 0;
  for (let i = 2 * von; i < 2 * bis; i++) { const a = Math.abs(daten[i]); if (a > spitze) spitze = a; }
  const s = eT + eM + eH;
  return s > 0 ? { tief: eT / s, mitte: eM / s, hoch: eH / s, spitze } : { tief: 0, mitte: 0, hoch: 0, spitze };
}

/** The proposed bank (a proposal only; the rule never says `cp`, which a snare cannot be told from by band balance). First match wins.
 *  A slice of a full mix is low-heavy whatever hits in it (the kick and the bass carry the energy: measured 0.6 to 0.95 low share on every slice of the
 *  library breaks), so a low-heavy slice is told apart by what lies above 5 kHz: a kick alone leaves under 0.3 % there, a hit layered on top 3 to 12 %.
 *  From 2 % on the slice is named after that hit: `hh` when the top is at least 0.3 of the mid share, else `sd`. */
export function bankVorschlag(b: Baender): 'bd' | 'sd' | 'hh' | 'perc' {
  if (b.spitze < 0.001) return 'perc';
  if (b.hoch >= 0.5) return 'hh';
  if (b.tief >= 0.5) return b.hoch < 0.02 ? 'bd' : b.hoch >= 0.3 * b.mitte ? 'hh' : 'sd';
  if (b.hoch >= 0.5) return 'hh';
  if (b.tief < 0.3 && b.mitte >= 0.3) return 'sd';
  return 'perc';
}

/** Banks in slice order to Strudel names: the numbers of a bank run 0, 1, 2 ... without gaps, so the live generator can reach every sound. */
export function nummeriere(banken: string[]): string[] {
  const zaehler = new Map<string, number>();
  return banken.map((b) => { const k = zaehler.get(b) ?? 0; zaehler.set(b, k + 1); return `${b}:${k}`; });
}

// --- kit name ----------------------------------------------------------------------------------------------------------------------------------------

const kitSlug = (name: string): string => {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, SLUG_MAX).replace(/-+$/, '');
  return s === '' ? 'kit' : s;
};

/** The first of `<slug>`, `<slug>-2`, `<slug>-3` ... for which the kit folder has no entry of that name (a folder without kit.json counts). `basis` is any
 *  text, usually the name of the cut. */
export function freierKitName(basis: string, o: KitOrdner = {}): string {
  const slug = kitSlug(typeof basis === 'string' ? basis : '');
  const wurzel = kitsOrdner(o);
  for (let k = 1; k <= 999; k++) {
    const name = k === 1 ? slug : `${slug}-${k}`;
    try { fs.lstatSync(path.join(wurzel, name)); } catch { return name; }
  }
  throw new SchnittFehler(409, 'kit_vorhanden', `no free kit name left for ${slug}`);
}

// --- the cut -----------------------------------------------------------------------------------------------------------------------------------------

export type KlangPlan = {
  scheibe: number; note: number; bank: string; name: string; frames: number; sekunden: number;
  baender: { tief: number; mitte: number; hoch: number }; zu_lang: boolean;
};

const holeSchnitt = (id: unknown, o: KitOrdner): Schnitt => {
  const s = liesSchnitt(id as string, o);
  if (!s) throw new SchnittFehler(404, 'schnitt_unbekannt', `cut ${String(id)} does not exist`);
  return s;
};

/** The cut audio as float32 (stereo, interleaved); a missing file is `schnitt_unbekannt`, a file shorter than the last bound `format_falsch`. */
function leseAudio(s: Schnitt, o: KitOrdner): Float32Array {
  const datei = path.join(o.bk ?? graphenOrdner(), 'samples', `${geraetName(s.id)}.f32`);
  let roh: Buffer;
  try { roh = fs.readFileSync(datei); } catch { throw new SchnittFehler(404, 'schnitt_unbekannt', `the audio of cut ${s.id} is missing`); }
  const frames = s.grenzen[s.grenzen.length - 1];
  if (roh.length < frames * 8) throw new SchnittFehler(422, 'format_falsch', `the audio of cut ${s.id} has ${roh.length} bytes, expected ${frames * 8}`);
  const daten = new Float32Array(roh.length / 4 | 0);
  new Uint8Array(daten.buffer).set(roh.subarray(0, daten.length * 4));
  return daten;
}

/** The slices as sorted unique 0-based indices, paired with the entries of `mit` (kept in step with the sort). */
function pruefeScheiben<T>(s: Schnitt, scheiben: unknown, mit?: T[]): { index: number; mit?: T }[] {
  const n = s.grenzen.length - 1;
  if (!Array.isArray(scheiben) || scheiben.length === 0) throw arg('scheiben: a non-empty list of slice indices expected');
  for (const i of scheiben) if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= n) throw arg(`scheiben: ${String(i)} is not a slice of the cut (0 to ${n - 1})`);
  const paare = (scheiben as number[]).map((index, k) => ({ index, mit: mit?.[k] })).sort((a, b) => a.index - b.index);
  for (let k = 1; k < paare.length; k++) if (paare[k].index === paare[k - 1].index) throw arg(`scheiben: slice ${paare[k].index} is listed twice`);
  if (ERSTE_NOTE + paare.length - 1 > 127) throw arg(`scheiben: ${paare.length} sounds would pass note 127 (at most ${128 - ERSTE_NOTE})`);
  return paare;
}

const text = (frames: number): string => (frames / 48000).toFixed(1);

/** The proposal for a selection: the kit name, and per slice (sorted) its note, the proposed bank and name, size and band shares. Reads only. A slice
 *  longer than 10 s is listed with `zu_lang` (the writer refuses it). */
export function kitVorschlag(id: string, scheiben: number[], o: KitOrdner = {}): { kit: string; klaenge: KlangPlan[] } {
  const s = holeSchnitt(id, o);
  const paare = pruefeScheiben(s, scheiben);
  const daten = leseAudio(s, o);
  const roh = paare.map((p) => {
    const von = s.grenzen[p.index], bis = s.grenzen[p.index + 1];
    const b = baender(daten, von, bis);
    return { p, frames: bis - von, b, bank: bankVorschlag(b) };
  });
  const namen = nummeriere(roh.map((r) => r.bank));
  return {
    kit: freierKitName(s.name, o),
    klaenge: roh.map((r, k) => ({
      scheibe: r.p.index, note: ERSTE_NOTE + k, bank: r.bank, name: namen[k], frames: r.frames, sekunden: Math.round(r.frames / 48000 * 100) / 100,
      baender: { tief: r.b.tief, mitte: r.b.mitte, hoch: r.b.hoch }, zu_lang: r.frames > KLANG_MAX_FRAMES,
    })),
  };
}

// --- writing -----------------------------------------------------------------------------------------------------------------------------------------

// The lock of loops/kit_write.mjs (mitSperre), copied: mkdir is atomic, a lock older than 10 s counts as abandoned. The original is not exported.
function mitSperre<T>(ordner: string, fn: () => T): T {
  const sperre = path.join(ordner, '.sperre');
  const bis = Date.now() + 5000;
  for (;;) {
    try { fs.mkdirSync(sperre); break; } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(sperre).mtimeMs > 10000) { fs.rmdirSync(sperre); continue; } } catch { continue; }
      if (Date.now() > bis) throw new SchnittFehler(409, 'kit_gesperrt', `kit folder ${ordner} is locked`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try { return fn(); } finally { fs.rmdirSync(sperre); }
}

const dateiSchreiben = (datei: string, inhalt: Buffer | string): void => {
  const tmp = `${datei}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, inhalt); fs.renameSync(tmp, datei); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
};

/** The sound of a slice: its frames, bit for bit, with the end fade (the last `a = min(240, floor(n / 2))` frames times (a - 1 - j) / a, so the last one is 0). */
function klangDaten(daten: Float32Array, von: number, bis: number): Buffer {
  const n = bis - von;
  const aus = new Float32Array(n * 2);
  aus.set(daten.subarray(2 * von, 2 * bis));
  const a = Math.min(AUSBLENDE_FRAMES, Math.floor(n / 2));
  for (let j = 0; j < a; j++) {
    const g = (a - 1 - j) / a, f = n - a + j;
    for (const i of [2 * f, 2 * f + 1]) { const w = aus[i] * g; aus[i] = w === 0 ? 0 : w; }   // 0, never -0
  }
  return Buffer.from(aus.buffer, aus.byteOffset, aus.byteLength);
}

/** Writes the kit. `banken` (one per entry of `scheiben`, as given) are the banks; absent, every bank is proposed. `kit` is the kit name; absent, the next free
 *  name from the cut name. An existing name is refused (`kit_vorhanden`, also a folder without kit.json). Every refusal comes before anything is written. */
export function legeKit(a: { id: string; scheiben: number[]; banken?: string[]; kit?: string }, o: KitOrdner = {}): {
  kit: string; klaenge: { scheibe: number; note: number; name: string; datei: string; frames: number }[];
} {
  const s = holeSchnitt(a.id, o);
  if (a.banken !== undefined && (!Array.isArray(a.banken) || !Array.isArray(a.scheiben) || a.banken.length !== a.scheiben.length)) {
    throw arg('banken: one bank per slice expected');
  }
  const paare = pruefeScheiben(s, a.scheiben, a.banken);
  if (a.banken !== undefined) {
    for (const p of paare) {
      const b = p.mit;
      if (typeof b === 'string' && b.includes(':')) throw arg('the number is given in slice order: write the bank only');
      if (typeof b !== 'string' || !BANK.test(b)) throw arg(`banken: ${JSON.stringify(b)} is not a bank name (a-z, 0-9 and _, starting with a letter, at most 16 characters)`);
    }
  }
  if (a.kit !== undefined && (typeof a.kit !== 'string' || !KIT_NAME.test(a.kit))) throw arg(`kit: a name of 1..${NAME_MAX} characters from a-z, 0-9, _ and - expected`);
  for (const p of paare) {
    const frames = s.grenzen[p.index + 1] - s.grenzen[p.index];
    if (frames > KLANG_MAX_FRAMES) {
      throw new SchnittFehler(400, 'klang_zu_lang', `slice ${p.index + 1} is ${text(frames)} s long; a kit sound is at most ${text(KLANG_MAX_FRAMES)} s: remove it from the selection`);
    }
  }
  const gesamt = paare.reduce((sum, p) => sum + (s.grenzen[p.index + 1] - s.grenzen[p.index]) * 8, 0);
  if (gesamt > KIT_MAX_BYTES) throw arg(`scheiben: the sounds are ${Math.ceil(gesamt / 1048576)} MiB, a kit holds at most 256 MiB`);
  const daten = leseAudio(s, o);
  const banken = a.banken !== undefined ? paare.map((p) => p.mit as string)
    : paare.map((p) => bankVorschlag(baender(daten, s.grenzen[p.index], s.grenzen[p.index + 1])));
  const namen = nummeriere(banken);
  const wurzel = kitsOrdner(o);
  const kit = a.kit ?? freierKitName(s.name, o);
  const ordner = path.join(wurzel, kit);
  fs.mkdirSync(wurzel, { recursive: true });
  try { fs.mkdirSync(ordner); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new SchnittFehler(409, 'kit_vorhanden', `a kit named ${kit} exists already; choose another name`);
    throw e;
  }
  const klaenge = paare.map((p, k) => ({
    scheibe: p.index, note: ERSTE_NOTE + k, name: namen[k], datei: `${ERSTE_NOTE + k}.f32`, frames: s.grenzen[p.index + 1] - s.grenzen[p.index],
  }));
  try {
    mitSperre(ordner, () => {
      for (const k of klaenge) dateiSchreiben(path.join(ordner, k.datei), klangDaten(daten, s.grenzen[k.scheibe], s.grenzen[k.scheibe + 1]));
      const j = { schema: 1, name: kit, klaenge: klaenge.map((k) => ({ note: k.note, name: k.name, datei: k.datei, frames: k.frames, quelle: `schnitt:${s.id}/${k.scheibe + 1}` })) };
      dateiSchreiben(path.join(ordner, 'kit.json'), JSON.stringify(j, null, 1));
    });
  } catch (e) {
    try { fs.rmSync(ordner, { recursive: true, force: true }); } catch { /* the original error is the one to report */ }
    throw e;
  }
  return { kit, klaenge, muster: kitMuster(s, klaenge) };
}

/** The hits of the kit where its slices sit in the cut, so that KIT TO TRACK plays at once (A, 2026-11-16: the new kit track was empty and silent).
 *  The positions are those of the slice track (spurBefehl): a grid cut on the exact grid, a hit or hand cut on the beat of its bound. One step long,
 *  as a drum hit of the grid; `beats` is the length of the cut, the loop of the new track. */
export function kitMuster(s: Schnitt, klaenge: { scheibe: number; note: number }[]): { beats: number; noten: { beat: number; laenge: number; ton: number; vel: number }[] } {
  const n = s.grenzen.length - 1;
  const start = (i: number): number => Math.round((s.methode === 'raster' ? i * s.beats / n : s.grenzen[i] * s.beats / s.frames) * 1e6) / 1e6;
  const noten = klaenge.map((k) => ({ beat: start(k.scheibe), laenge: 0.25, ton: k.note, vel: 100 })).sort((a, b) => a.beat - b.beat || a.ton - b.ton);
  return { beats: s.beats, noten };
}

// --- one sound into a copy ----------------------------------------------------------------------------------------------------------------------------

/** Kit limit: 92 sounds, notes 36 to 127 (the kit picker and the core ignore the rest). */
const KIT_MAX_KLAENGE = 128 - ERSTE_NOTE;
type KitKlang = { note: number; name: string; datei: string; frames: number; quelle?: string };

/** The sounds of a kit's kit.json (schema 1), each with its file present; anything else is `kit_fremd`. */
function liesKitKlaenge(kit: string, wurzel: string): KitKlang[] {
  const fremd = (grund: string): SchnittFehler => new SchnittFehler(409, 'kit_fremd', `kit ${kit} cannot be copied: ${grund}`);
  if (!KIT_NAME.test(kit)) throw fremd('not a kit name');
  let j: { schema?: unknown; klaenge?: unknown };
  try { j = JSON.parse(fs.readFileSync(path.join(wurzel, kit, 'kit.json'), 'utf8')); } catch { throw fremd('no readable kit.json'); }
  if (j === null || typeof j !== 'object' || j.schema !== 1 || !Array.isArray(j.klaenge)) throw fremd('kit.json is not of schema 1');
  const noten = new Set<number>();
  for (const k of j.klaenge as KitKlang[]) {
    if (k === null || typeof k !== 'object' || !Number.isInteger(k.note) || k.note < 0 || k.note > 127 || noten.has(k.note) || typeof k.name !== 'string'
      || typeof k.datei !== 'string' || k.datei !== path.basename(k.datei) || k.datei === 'kit.json' || !Number.isInteger(k.frames)) throw fremd('a sound entry is not valid');
    noten.add(k.note);
    if (!fs.statSync(path.join(wurzel, kit, k.datei), { throwIfNoEntry: false })?.isFile()) throw fremd(`${k.datei} is missing`);
  }
  return j.klaenge as KitKlang[];
}

/** A copy of the kit `a.kit` with the sound at note `a.ton` replaced (same name, new file `<ton>.f32`) or added (name: its proposed bank and the smallest free
 *  number of that bank). `a.daten` is stereo float32 48 kHz; it gets the 5 ms end fade and is at most 10 s (`klang_zu_lang`). The old kit is only read:
 *  the copy is a new folder `freierKitName(<kit>)`, every sound file copied, kit.json written last, and a failure removes the folder again. A full kit
 *  (92 sounds) takes no new note (`kit_voll`), a kit without a valid kit.json is `kit_fremd`. Every refusal comes before anything is written. */
export function kitMitKlang(a: { kit: string; ton: number; daten: Float32Array; quelle: string }, o: KitOrdner = {}): { kit: string; name: string; neu: boolean } {
  if (!Number.isInteger(a.ton) || a.ton < 0 || a.ton > 127) throw arg('ton: a MIDI note, a whole number from 0 to 127, expected');
  const frames = Math.floor(a.daten.length / 2);
  if (frames < 1) throw arg('daten: no audio');
  if (frames > KLANG_MAX_FRAMES) throw new SchnittFehler(400, 'klang_zu_lang', `the sound is ${text(frames)} s long; a kit sound is at most ${text(KLANG_MAX_FRAMES)} s`);
  const wurzel = kitsOrdner(o);
  const alt = liesKitKlaenge(a.kit, wurzel);
  const ersetzt = alt.find((k) => k.note === a.ton);
  if (!ersetzt && alt.length >= KIT_MAX_KLAENGE) throw new SchnittFehler(409, 'kit_voll', `kit ${a.kit} holds ${alt.length} sounds, the most a kit takes; replace one instead`);
  const datei = `${a.ton}.f32`;
  if (alt.some((k) => k.note !== a.ton && k.datei === datei)) throw new SchnittFehler(409, 'kit_fremd', `kit ${a.kit}: the file ${datei} belongs to another note`);
  let name = ersetzt?.name;
  if (name === undefined) {
    const bank = bankVorschlag(baender(a.daten, 0, frames));
    const belegt = new Set(alt.map((k) => k.name));
    let n = 0;
    while (belegt.has(`${bank}:${n}`)) n++;
    name = `${bank}:${n}`;
  }
  const bytes = alt.reduce((s, k) => s + (k.note === a.ton ? 0 : fs.statSync(path.join(wurzel, a.kit, k.datei)).size), 0) + frames * 8;
  if (bytes > KIT_MAX_BYTES) throw arg(`the kit would hold ${Math.ceil(bytes / 1048576)} MiB, a kit holds at most 256 MiB`);
  const neuName = freierKitName(a.kit, o);
  const ordner = path.join(wurzel, neuName);
  try { fs.mkdirSync(ordner); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new SchnittFehler(409, 'kit_vorhanden', `a kit named ${neuName} exists already; try again`);
    throw e;
  }
  const klang: KitKlang = { note: a.ton, name, datei, frames, quelle: a.quelle };
  const liste = (ersetzt ? alt.map((k) => (k.note === a.ton ? klang : k)) : [...alt, klang]).sort((x, y) => x.note - y.note);
  try {
    mitSperre(ordner, () => {
      for (const k of alt) if (k.note !== a.ton) dateiSchreiben(path.join(ordner, k.datei), fs.readFileSync(path.join(wurzel, a.kit, k.datei)));
      dateiSchreiben(path.join(ordner, datei), klangDaten(a.daten, 0, frames));
      dateiSchreiben(path.join(ordner, 'kit.json'), JSON.stringify({ schema: 1, name: neuName, klaenge: liste }, null, 1));
    });
  } catch (e) {
    try { fs.rmSync(ordner, { recursive: true, force: true }); } catch { /* the original error is the one to report */ }
    throw e;
  }
  return { kit: neuName, name, neu: !ersetzt };
}
