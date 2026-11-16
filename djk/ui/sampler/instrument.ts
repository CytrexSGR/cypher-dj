// Sample player stage 2, strand S: instruments from folders. A folder of multisamples (note, velocity layer and take in the file names) becomes
//   <graph folder>/samples/ins-<id>.f32     the pack: every sample behind each other (stereo float32 48 kHz), never rewritten in place
//   <graph folder>/ins-<id>.json            the generated device (16 voices, the sampler block in zone mode)
//   <graph folder>/panels/ins-<id>.json     its panel
//   <store>/instrumente/<id>/instrument.json  the instrument itself, written last: an instrument exists only with this file
// Zone table of the sampler node (contract of strand R, 12 numbers per zone): a, b, grund, lo, hi, vlo, vhi, gain (linear), pan, loop_a, loop_b, art.
// Stage 2b: a zone may carry a sustain loop (loop_a, loop_b in pack frames) and release zones (art 1, from the sibling folder Rel / Release / Releases) follow the
// played zones in the same pack. With release zones the graph has knob 10 `Rel smp` and the output is  amp + smp.rl/rr x Rel smp x velocity curve  (behind the
// envelope gain: the release samples are not shaped by the envelope).
//
//   note.hz -> transponiere (Tune, +-1 st) -> smp.hz        smp = sampler in zone mode, `vel` from note.vel, one pack file
//   note.trig -> smp.trig, note.gate -> smp.gate, env = adsr (gate, trig, Attack/Decay/Release in ms through x 0.001, Sustain)
//   velocity curve = 1 - Velocity + Velocity * vel          (0: the key velocity does not scale the level, 1: fully; the layer choice is the zones' job)
//   gain = env x Level x velocity curve
//   smp.l/r -> svf low-pass (Cutoff, Reso) -> x gain -> out
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { GRAPH_NAME, graphenOrdner } from '../graphs.ts';
import { dekodiereDateiAsync, ersterTon, loeseAuf, probeDateiAsync, versteckt, AUDIO_ENDUNG, wurzelEcht, istGesperrt } from './file.ts';
import { analysiereDateien, baueZonenTabelle, MIN_NOTEN, noteVon, ordnerAlsInstrumentKurz, ZONEN_MAX, type Analyse, type ZoneLese } from './instrument_names.ts';
import { liesSchleife, schleifeImPack } from './schleifen.ts';
import { SchnittFehler, samplerOrdner, type Ordner } from './schnitt.ts';
import { erkenneGrundton, TON_SCHWELLE } from './tone_hoehe.ts';

const SR = 48000;
/** 2 GiB: `MAX_PACK_FRAMEN` of the engine (268 435 456 frames of 8 bytes). */
export const PACK_MAX_BYTES = 268_435_456 * 8;
export const INSTRUMENT_NAME_MAX = 60;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,27}$/;
const PROBEN = 5;
const PROBE_S = 1.5;
const MIN_FRAMES = 4;

export const instrumentName = (id: string): string => `ins-${id}`;

export type InstrumentZone = { datei: string; a: number; b: number; grund: number; lo: number; hi: number; vlo: number; vhi: number; gain_db: number; pan: number; lage?: string; rr?: number;
  /** Sustain loop in pack frames (stage 2b), inside [a, b). */ loop?: [number, number];
  /** `'release'`: a release sample (art 1), played when the key is let go (stage 2b). */ art?: 'release' };
/** The stored instrument; fields this code does not know are kept when the file is rewritten. */
export type Instrument = {
  schema: 1; id: string; name: string; quelle: { wurzel: string; ordner: string }; erstellt: string; frames: number; zonen: InstrumentZone[];
  [feld: string]: unknown;
};

const arg = (text: string): SchnittFehler => new SchnittFehler(400, 'argument_ungueltig', text);
const json = (x: unknown): string => `${JSON.stringify(x, null, 2)}\n`;
const tmpName = (datei: string): string => `${datei}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
const einsFile = (datei: string, inhalt: string): void => {
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  const tmp = tmpName(datei);
  try { fs.writeFileSync(tmp, inhalt); fs.renameSync(tmp, datei); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
};

const speicher = (o: Ordner): string => path.join(o.ordner ?? samplerOrdner(), 'instrumente');
const bkOrdner = (o: Ordner): string => o.bk ?? graphenOrdner();
const dateienVon = (id: string, o: Ordner): { eintrag: string; ordner: string; pack: string; graph: string; panel: string } => ({
  ordner: path.join(speicher(o), id), eintrag: path.join(speicher(o), id, 'instrument.json'),
  pack: path.join(bkOrdner(o), 'samples', `${instrumentName(id)}.f32`), graph: path.join(bkOrdner(o), `${instrumentName(id)}.json`), panel: path.join(bkOrdner(o), 'panels', `${instrumentName(id)}.json`),
});

// ---- device graph and panel ----

const KNOEPFE = [
  { nr: 1, id: 'tun', name: 'Tune', min: -1, max: 1, log: 0, vorgabe: 0.5, format: 'raw', unit: 'st' },
  { nr: 2, id: 'atk', name: 'Attack', min: 0.5, max: 2000, log: 1, vorgabe: 0.0836, format: 'ms' },
  { nr: 3, id: 'dec', name: 'Decay', min: 1, max: 4000, log: 1, vorgabe: 0.5, format: 'ms' },
  { nr: 4, id: 'sus', name: 'Sustain', min: 0, max: 1, log: 0, vorgabe: 1, format: 'percent' },
  { nr: 5, id: 'rel', name: 'Release', min: 1, max: 8000, log: 1, vorgabe: 0.6347, format: 'ms' },
  { nr: 6, id: 'cut', name: 'Cutoff', min: 40, max: 20000, log: 1, vorgabe: 1, format: 'hz' },
  { nr: 7, id: 'res', name: 'Reso', min: 0, max: 1, log: 0, vorgabe: 0, format: 'percent' },
  { nr: 8, id: 'lvl', name: 'Level', min: 0, max: 2, log: 0, mitte: 1, vorgabe: 0.5, format: 'raw', unit: 'x' },
  { nr: 9, id: 'vlc', name: 'Velocity', min: 0, max: 1, log: 0, vorgabe: 0.5, format: 'percent' },
] as const;
/** Knob 10, only on an instrument with release zones: the level of the release samples. */
const REL_KNOPF = { nr: 10, id: 'rls', name: 'Rel smp', min: 0, max: 2, log: 0, mitte: 1, vorgabe: 0.5, format: 'raw', unit: 'x' } as const;
const hatRelease = (zonen: Pick<InstrumentZone, 'art'>[]): boolean => zonen.some((z) => z.art === 'release');
const knoepfeVon = (zonen: Pick<InstrumentZone, 'art'>[]): readonly (typeof KNOEPFE[number] | typeof REL_KNOPF)[] => (hatRelease(zonen) ? [...KNOEPFE, REL_KNOPF] : KNOEPFE);
/** The six knobs on the front of the panel: Attack, Release, Cutoff, Reso, Velocity, Level. */
const FRONT = ['k2', 'k5', 'k6', 'k7', 'k9', 'k8'];

const zahl6 = (x: number): number => Math.round(x * 1e6) / 1e6;
/** The flat `zonen` array of the sampler node: 12 numbers per zone, `gain` linear. */
export function zonenFlach(zonen: InstrumentZone[]): number[] {
  return zonen.flatMap((z) => [z.a, z.b, z.grund, z.lo, z.hi, z.vlo, z.vhi, zahl6(10 ** (z.gain_db / 20)), z.pan, z.loop?.[0] ?? 0, z.loop?.[1] ?? 0, z.art === 'release' ? 1 : 0]);
}

/** The device graph of an instrument (16 voices). */
export function instrumentGraph(i: { id: string; zonen: InstrumentZone[] }): Record<string, unknown> {
  const knoepfe = knoepfeVon(i.zonen), mitRel = hatRelease(i.zonen);
  const knoten: Record<string, unknown>[] = [
    { id: 'note', art: 'note' },
    { id: 'tr', art: 'transponiere' },
    { id: 'smp', art: 'sampler', datei: `${instrumentName(i.id)}.f32`, zonen: zonenFlach(i.zonen) },
    ...knoepfe.map((k) => ({ id: k.id, art: 'regler', nr: k.nr, min: k.min, max: k.max, log: k.log, vorgabe: k.vorgabe, ...('mitte' in k ? { mitte: k.mitte } : {}) })),
    { id: 'env', art: 'adsr', a: 0.001, d: 0.063, s: 1, r: 0.3 },   // the engine requires a value for a, d, s, r; the edges from the knobs win
    { id: 'a_s', art: 'mul', b: 0.001 }, { id: 'd_s', art: 'mul', b: 0.001 }, { id: 'r_s', art: 'mul', b: 0.001 },
    { id: 'vm1', art: 'add', b: -1 },          // vel - 1
    { id: 'vm2', art: 'mul' },                 // Velocity * (vel - 1)
    { id: 'vkurve', art: 'add', b: 1 },        // 1 - Velocity + Velocity * vel
    { id: 'g1', art: 'mul' },
    { id: 'gain', art: 'mul' },
    ...['l', 'r'].flatMap((z) => [{ id: `lp_${z}`, art: 'svf', pole: 2 }, { id: `amp_${z}`, art: 'mul' }]),
    ...(mitRel ? [{ id: 'rg', art: 'mul' }, ...['l', 'r'].flatMap((z) => [{ id: `rm_${z}`, art: 'mul' }, { id: `sum_${z}`, art: 'add' }])] : []),
    { id: 'aus', art: 'ausgang' },
  ];
  const kanten: { von: string; nach: string }[] = [
    { von: 'note.hz', nach: 'tr.hz' }, { von: 'tun.aus', nach: 'tr.st' }, { von: 'tr.aus', nach: 'smp.hz' },
    { von: 'note.trig', nach: 'smp.trig' }, { von: 'note.gate', nach: 'smp.gate' }, { von: 'note.vel', nach: 'smp.vel' },
    { von: 'note.gate', nach: 'env.gate' }, { von: 'note.trig', nach: 'env.trig' },
    { von: 'atk.aus', nach: 'a_s.a' }, { von: 'a_s.aus', nach: 'env.a' },
    { von: 'dec.aus', nach: 'd_s.a' }, { von: 'd_s.aus', nach: 'env.d' },
    { von: 'rel.aus', nach: 'r_s.a' }, { von: 'r_s.aus', nach: 'env.r' },
    { von: 'sus.aus', nach: 'env.s' },
    { von: 'note.vel', nach: 'vm1.a' }, { von: 'vm1.aus', nach: 'vm2.a' }, { von: 'vlc.aus', nach: 'vm2.b' }, { von: 'vm2.aus', nach: 'vkurve.a' },
    { von: 'lvl.aus', nach: 'g1.a' }, { von: 'vkurve.aus', nach: 'g1.b' },
    { von: 'g1.aus', nach: 'gain.a' }, { von: 'env.aus', nach: 'gain.b' },
  ];
  for (const z of ['l', 'r']) {
    kanten.push({ von: `smp.${z}`, nach: `lp_${z}.x` }, { von: 'cut.aus', nach: `lp_${z}.cutoff` }, { von: 'res.aus', nach: `lp_${z}.reso` },
      { von: `lp_${z}.tp`, nach: `amp_${z}.a` }, { von: 'gain.aus', nach: `amp_${z}.b` });
    if (!mitRel) { kanten.push({ von: `amp_${z}.aus`, nach: `aus.${z}` }); continue; }
    kanten.push({ von: `smp.r${z}`, nach: `rm_${z}.a` }, { von: 'rg.aus', nach: `rm_${z}.b` },
      { von: `amp_${z}.aus`, nach: `sum_${z}.a` }, { von: `rm_${z}.aus`, nach: `sum_${z}.b` }, { von: `sum_${z}.aus`, nach: `aus.${z}` });
  }
  if (mitRel) kanten.push({ von: 'rls.aus', nach: 'rg.a' }, { von: 'vkurve.aus', nach: 'rg.b' });
  return { format: 'baukasten/2', name: instrumentName(i.id), stimmen: 16, regler_namen: Object.fromEntries(knoepfe.map((k) => [String(k.nr), k.name])), knoten, kanten };
}

/** The panel of an instrument (cypherdj-panel/2): one section with the nine knobs k1..k9 (k10 with release zones) and the six `front` knobs (seven with release zones). */
export function instrumentPanel(i: { id: string; name: string; zonen?: InstrumentZone[] }): Record<string, unknown> {
  const knoepfe = knoepfeVon(i.zonen ?? []);
  const kopf = 'Instrument · ';
  const titel = `${kopf}${i.name}`.length <= 40 ? `${kopf}${i.name}` : `${kopf}${i.name.slice(0, 40 - kopf.length - 1).trimEnd()}…`;
  return {
    format: 'cypherdj-panel/2',
    geraet: { art: 'bk', graph: instrumentName(i.id) },
    title: titel,
    front: hatRelease(i.zonen ?? []) ? [...FRONT, 'k10'] : FRONT,
    sections: [{
      id: 'instrument', title: 'INSTRUMENT', cols: 3,
      controls: knoepfe.map((k) => ({ id: `c${k.nr}`, type: 'knob', label: k.name, bind: { param: `k${k.nr}` }, format: k.format, ...('unit' in k ? { unit: k.unit } : {}), default: k.vorgabe })),
    }],
  };
}

// ---- the store ----

/** One instrument by id; null when the id is not valid, the instrument is unknown or its file is unreadable or not an instrument. */
export function liesInstrument(id: string, o: Ordner = {}): Instrument | null {
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  try {
    const i = JSON.parse(fs.readFileSync(dateienVon(id, o).eintrag, 'utf8')) as Instrument;
    return i !== null && typeof i === 'object' && i.schema === 1 && i.id === id && Array.isArray(i.zonen) ? i : null;
  } catch { return null; }
}

/** Writes the entry of an instrument; fields of the file on disk that `i` does not name (written by a later version or by hand) are kept. */
export function speichereInstrument(i: Instrument, o: Ordner = {}): void {
  let alt: Record<string, unknown> = {};
  try { const x = JSON.parse(fs.readFileSync(dateienVon(i.id, o).eintrag, 'utf8')); if (x !== null && typeof x === 'object' && !Array.isArray(x)) alt = x; } catch { /* a new entry */ }
  einsFile(dateienVon(i.id, o).eintrag, json({ ...alt, ...i }));
}

/** `zonen` and `noten` count the zones played by the key; `schleifen` (zones with a loop) and `release` (release zones) are there only when above zero; `bytes` is the whole pack. */
export type InstrumentZeile = { id: string; name: string; noten: number; zonen: number; bytes: number; erstellt: string; schleifen?: number; release?: number };
const gespielt = (zonen: InstrumentZone[]): InstrumentZone[] => zonen.filter((z) => z.art !== 'release');
export function zeileVon(i: Instrument): InstrumentZeile {
  const spiel = gespielt(i.zonen), schleifen = spiel.filter((z) => z.loop !== undefined).length, release = i.zonen.length - spiel.length;
  return { id: i.id, name: i.name, noten: new Set(spiel.map((z) => z.lo)).size, zonen: spiel.length, bytes: i.frames * 8, erstellt: i.erstellt,
    ...(schleifen > 0 ? { schleifen } : {}), ...(release > 0 ? { release } : {}) };
}

/** Every readable instrument, newest first. */
export function listeInstrumente(o: Ordner = {}): Instrument[] {
  let namen: string[] = [];
  try { namen = fs.readdirSync(speicher(o)); } catch { return []; }
  const aus: Instrument[] = [];
  for (const n of namen) { const i = liesInstrument(n, o); if (i) aus.push(i); }
  return aus.sort((x, y) => (x.erstellt < y.erstellt ? 1 : x.erstellt > y.erstellt ? -1 : x.id < y.id ? -1 : 1));
}

/** Removes pack, graph, panel and the entry (the entry last). 404 `instrument_unbekannt`. Whether a track still plays it is the caller's check. */
export function loescheInstrument(id: string, o: Ordner = {}): void {
  if (!liesInstrument(id, o)) throw new SchnittFehler(404, 'instrument_unbekannt', `instrument ${String(id)} does not exist`);
  const f = dateienVon(id, o);
  for (const p of [f.pack, f.graph, f.panel]) fs.rmSync(p, { force: true });
  fs.rmSync(f.ordner, { recursive: true, force: true });
}

/** The key in the middle of the key range of the instrument (what the one note of a new track plays). */
export const mitteVon = (i: Pick<Instrument, 'zonen'>): number => {
  const spiel = gespielt(i.zonen);
  const lo = Math.min(...spiel.map((z) => z.lo)), hi = Math.max(...spiel.map((z) => z.hi));
  return Math.round((lo + hi) / 2);
};

const MIB = (b: number): string => `${(b / 1048576).toFixed(1)} MiB`;
/** The instrument as one line. */
export function instrumentText(i: Instrument): string {
  const z = zeileVon(i), lagen = new Set(gespielt(i.zonen).map((x) => `${x.vlo}-${x.vhi}`)).size;
  const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;
  return `instrument ${instrumentName(i.id)} "${i.name}"  ${z.noten} notes  ${lagen} velocity ranges  ${z.zonen} zones  ${MIB(z.bytes)}`
    + `${z.schleifen ? `  ${plural(z.schleifen, 'looped zone')}` : ''}${z.release ? `  ${plural(z.release, 'release zone')}` : ''}`;
}

/** The category text of an instrument graph in the device list. */
export function instrumentKategorieText(graph: string, o: Ordner = {}): string {
  const i = liesInstrument(graph.slice(4), o);
  const text = i ? `Instrument · ${i.name}` : '';
  return text !== '' && text.length <= 90 ? text : 'Instrument from a folder';
}

// ---- reading a folder ----

/** The audio files directly in a folder of a root (`rel` is relative to the root), without hidden entries and protected packs, in name order. */
export function dateienImOrdner(wurzel: string, ordner: string, o: Ordner = {}): { name: string; rel: string }[] {
  const voll = loeseAuf(wurzel, ordner, o);
  if (!fs.statSync(voll).isDirectory()) throw new SchnittFehler(404, 'quelle_unbekannt', `${ordner} is not a folder`);
  const rel0 = ordner.split(/[\\/]/).filter((s) => s !== '' && s !== '.').join('/');
  const aus: { name: string; rel: string }[] = [];
  for (const e of fs.readdirSync(voll, { withFileTypes: true })) {
    if (versteckt(e.name) || !AUDIO_ENDUNG.test(e.name)) continue;
    const p = path.join(voll, e.name);
    let st: fs.Stats;
    try { st = fs.statSync(p); } catch { continue; }
    if (!st.isFile() || istGesperrt(p)) continue;
    aus.push({ name: e.name, rel: rel0 === '' ? e.name : `${rel0}/${e.name}` });
  }
  return aus.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The octave convention from pitch detections: `proben` are the names of files (note as read, octave number) and the pitch detected in them as a fractional MIDI
 *  note with its confidence. The convention (C4 = 60 -> 1, C3 = 60 -> 2) whose notes lie nearer to the detected pitches wins; nothing usable or a tie: C4 = 60. */
export function entscheideVersatz(proben: { klasse: number; oktave: number; midi: number | null; konfidenz: number }[]): 1 | 2 {
  let s1 = 0, s2 = 0, n = 0;
  for (const p of proben) {
    if (p.midi === null || !(p.konfidenz >= TON_SCHWELLE)) continue;
    s1 += Math.abs(p.midi - noteVon(p.klasse, p.oktave, 1));
    s2 += Math.abs(p.midi - noteVon(p.klasse, p.oktave, 2));
    n++;
  }
  return n > 0 && s2 < s1 ? 2 : 1;
}

const REL_NAME = /^(rel|release|releases)$/i;
const segmente = (rel: string): string[] => rel.split(/[\\/]/).filter((x) => x !== '' && x !== '.');
/** The sibling folder (same parent) of a folder that is named Rel, Release or Releases in any case, as a path relative to the root; null when there is none
 *  (a folder at the top of its root has no sibling). */
export function releaseOrdnerVon(wurzel: string, ordnerRel: string, o: Ordner = {}): string | null {
  const teile = segmente(ordnerRel);
  if (teile.length === 0) return null;
  const eltern = teile.slice(0, -1);
  let namen: fs.Dirent[] = [];
  try { namen = fs.readdirSync(loeseAuf(wurzel, eltern.join('/'), o), { withFileTypes: true }); } catch { return null; }
  const treffer = namen.filter((e) => REL_NAME.test(e.name) && e.name !== teile.at(-1) && (e.isDirectory() || e.isSymbolicLink()) && !versteckt(e.name)).map((e) => e.name).sort();
  for (const n of treffer) {
    const rel = [...eltern, n].join('/');
    try { if (fs.statSync(loeseAuf(wurzel, rel, o)).isDirectory()) return rel; } catch { /* a link out of the root or a broken link: not a folder to read */ }
  }
  return null;
}

/** Folders with more files than this are not looked at for loop points (headers are read synchronously). */
export const SCHLEIFEN_PRUEFUNG_MAX = 400;

/** The `instrument` field of a folder listing: what `ordnerAlsInstrumentKurz` says, plus `release` (the files of the sibling release folder when it reads as
 *  release samples) and `schleifen` (files of the folder with loop points, headers only, only up to 400 files). Null when the folder is no instrument. */
export function ordnerInstrumentFeld(wurzel: string, ordnerRel: string, dateien: { name: string; rel: string }[], o: Ordner = {}): (ReturnType<typeof ordnerAlsInstrumentKurz> & { release?: number; schleifen?: number }) | null {
  const kurz = ordnerAlsInstrumentKurz(dateien);
  if (!kurz) return null;
  const aus: NonNullable<typeof kurz> & { release?: number; schleifen?: number } = { ...kurz };
  try {
    const relOrdner = releaseOrdnerVon(wurzel, ordnerRel, o);
    if (relOrdner !== null) { const n = analysiereDateien(dateienImOrdner(wurzel, relOrdner, o)).dateien; if (n > 0) aus.release = n; }
  } catch { /* an unreadable sibling folder is no release folder */ }
  const audio = dateien.filter((d) => AUDIO_ENDUNG.test(d.name));
  if (audio.length <= SCHLEIFEN_PRUEFUNG_MAX) {
    let n = 0;
    for (const d of audio) { try { if (liesSchleife(loeseAuf(wurzel, d.rel, o)) !== null) n++; } catch { /* not readable: no loop */ } }
    if (n > 0) aus.schleifen = n;
  }
  return aus;
}

const slug = (name: string): string => {
  const s = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 22).replace(/-+$/, '');
  return s === '' ? 'instrument' : s;
};

// ---- progress ----

const lauf0 = { laeuft: false, name: '', fertig: 0, von: 0 };
let lauf = { ...lauf0 };
/** The progress of the build in progress: `{laeuft, name, fertig, von}` (files written of files to write). */
export const instrumentLauf = (): { laeuft: boolean; name: string; fertig: number; von: number } => ({ ...lauf });

export type Gebaut = { instrument: Instrument; varianten: string[] };

/** Builds an instrument from the audio files directly in a folder of a root. Refusals (SchnittFehler) and failures leave every folder as it was.
 *  Reason codes: laeuft_schon 409, quelle_unbekannt 404, kein_instrument 422, zu_viele_zonen 422, pack_zu_gross 422, format_falsch 422, argument_ungueltig 400. */
export async function baueInstrument(a: { wurzel: string; ordner: string; name?: string; release?: boolean }, o: Ordner = {}): Promise<Gebaut> {
  if (lauf.laeuft) throw new SchnittFehler(409, 'laeuft_schon', `the instrument "${lauf.name}" is being built: ${lauf.fertig} of ${lauf.von}`);
  if (a.release !== undefined && typeof a.release !== 'boolean') throw arg('release: true or false expected');
  if (a.name !== undefined && (typeof a.name !== 'string' || a.name.trim() === '' || a.name.trim().length > INSTRUMENT_NAME_MAX)) throw arg(`name: a text of 1..${INSTRUMENT_NAME_MAX} characters expected`);
  lauf = { laeuft: true, name: a.name?.trim() ?? '', fertig: 0, von: 0 };   // set before the first await: a second request sees it
  const aufraeumen: string[] = [];
  try {
    const ordnerRel = typeof a.ordner === 'string' ? a.ordner : '';
    const dateien = dateienImOrdner(a.wurzel, ordnerRel, o);
    const analyse = analysiereDateien(dateien);
    if (analyse.noten < MIN_NOTEN) {
      throw new SchnittFehler(422, 'kein_instrument', `the folder has ${analyse.noten} different note${analyse.noten === 1 ? '' : 's'} in the names of its ${dateien.length} audio file${dateien.length === 1 ? '' : 's'}; an instrument needs at least ${MIN_NOTEN}`);
    }
    const basis = ordnerRel.split(/[\\/]/).filter((s) => s !== '' && s !== '.').pop() ?? a.wurzel;
    const name = (a.name?.trim() ?? basis).slice(0, INSTRUMENT_NAME_MAX).trim();
    lauf.name = name;
    // octave convention by pitch detection on up to five files of different notes, spread over the range
    wurzelEcht(a.wurzel, o);
    const proben = await erkenneProben(analyse, (rel) => loeseAuf(a.wurzel, rel, o));
    const versatz = entscheideVersatz(proben);
    const gespielt0 = baueZonenTabelle(analyse, versatz);
    if (gespielt0.length < 1 || new Set(gespielt0.map((z) => z.grund)).size < MIN_NOTEN) throw new SchnittFehler(422, 'kein_instrument', `fewer than ${MIN_NOTEN} notes are inside the MIDI range 0..127`);
    // release samples (stage 2b): the sibling folder Rel / Release / Releases, the same octave convention, behind the played zones in the same pack
    let relTabelle: ZoneLese[] = [];
    if (a.release !== false) {
      const relOrdner = releaseOrdnerVon(a.wurzel, ordnerRel, o);
      if (relOrdner !== null) relTabelle = baueZonenTabelle(analysiereDateien(dateienImOrdner(a.wurzel, relOrdner, o)), versatz);
    }
    const tabelle = [...gespielt0, ...relTabelle];
    const nSpiel = gespielt0.length;
    const zonenMax = o.zonenMax ?? ZONEN_MAX;
    if (tabelle.length > zonenMax) throw new SchnittFehler(422, 'zu_viele_zonen', `the folder makes ${tabelle.length} zones${relTabelle.length > 0 ? ` (${relTabelle.length} of them release samples)` : ''}; an instrument holds at most ${zonenMax}`);
    lauf.von = tabelle.length;
    const pfade = tabelle.map((z) => loeseAuf(a.wurzel, z.rel, o));   // realpath inside the root: a symlink out of it is refused
    // the size the pack would have (upper bound: leading silence is not counted off), refused before anything is written
    const grenze = o.packMaxBytes ?? PACK_MAX_BYTES;
    const sonden = await Promise.all(pfade.map((p) => probeDateiAsync(p)));
    const schaetz = sonden.reduce((s, x) => s + Math.ceil(x.dauer * SR) * 8, 0);
    if (schaetz > grenze) throw new SchnittFehler(422, 'pack_zu_gross', `the pack would be about ${MIB(schaetz)}; the limit is ${MIB(grenze)}`);
    // reserve the id
    fs.mkdirSync(speicher(o), { recursive: true });
    let id = '';
    for (let versuch = 0; ; versuch++) {   // mkdir without `recursive` fails when the folder exists: that reserves the id
      id = `${slug(name)}-${crypto.randomBytes(2).toString('hex')}`;
      if (!GRAPH_NAME.test(instrumentName(id))) throw new SchnittFehler(500, 'intern', `the graph name ${instrumentName(id)} is not valid`);
      try { fs.mkdirSync(path.join(speicher(o), id)); break; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || versuch >= 20) throw e; }
    }
    const f = dateienVon(id, o);
    const tmp = tmpName(f.pack);
    aufraeumen.push(tmp, f.pack, f.graph, f.panel, f.ordner);
    fs.mkdirSync(path.dirname(f.pack), { recursive: true });
    const zonen: InstrumentZone[] = [];
    let frames = 0;
    const fd = await fsp.open(tmp, 'wx');
    try {
      const vor = 4;   // decoded ahead; the decoding itself never runs more than four ffmpeg at a time
      const laeufe = new Map<number, Promise<Float32Array>>();
      const starte = (k: number): void => { if (k < tabelle.length && !laeufe.has(k)) { const p = dekodiereDateiAsync(pfade[k], 600, sonden[k].kanaele); p.catch(() => undefined); laeufe.set(k, p); } };
      for (let k = 0; k < tabelle.length; k++) {
        for (let j = 0; j < vor; j++) starte(k + j);
        const roh = await laeufe.get(k)!;
        laeufe.delete(k);
        const z: ZoneLese = tabelle[k];
        const release = k >= nSpiel;
        const start = ersterTon(roh);
        const n = start < 0 ? 0 : roh.length / 2 - start;
        if (start < 0) throw new SchnittFehler(422, 'format_falsch', `${z.rel} is silent throughout`);
        if (n < MIN_FRAMES) throw new SchnittFehler(422, 'format_falsch', `${z.rel} is shorter than ${MIN_FRAMES} frames`);
        if ((frames + n) * 8 > grenze) throw new SchnittFehler(422, 'pack_zu_gross', `the pack would be larger than ${MIB(grenze)}`);
        const bytes = Buffer.from(roh.buffer, roh.byteOffset + start * 8, n * 8);
        await fd.write(bytes, 0, bytes.length, frames * 8);
        const loop = release ? null : schleifeImPack(liesSchleife(pfade[k]), { a: frames, b: frames + n, abgeschnitten: start });
        zonen.push({ datei: z.rel, a: frames, b: frames + n, grund: z.grund, lo: z.lo, hi: z.hi, vlo: z.vlo, vhi: z.vhi, gain_db: 0, pan: 0, ...(z.lage !== undefined ? { lage: z.lage } : {}), ...(z.rr !== undefined ? { rr: z.rr } : {}),
          ...(loop ? { loop } : {}), ...(release ? { art: 'release' as const } : {}) });
        frames += n;
        lauf.fertig = k + 1;
      }
    } finally { await fd.close(); }
    fs.renameSync(tmp, f.pack);
    const i: Instrument = { schema: 1, id, name, quelle: { wurzel: a.wurzel, ordner: ordnerRel.split(/[\\/]/).filter((s) => s !== '' && s !== '.').join('/') }, erstellt: new Date().toISOString(), frames, zonen,
      konvention: versatz === 1 ? 'C4=60' : 'C3=60', ...(analyse.varianten.length > 0 ? { varianten: analyse.varianten } : {}) };
    einsFile(f.graph, json(instrumentGraph(i)));
    einsFile(f.panel, json(instrumentPanel(i)));
    einsFile(f.eintrag, json(i));
    aufraeumen.length = 0;
    return { instrument: i, varianten: analyse.varianten };
  } catch (e) {
    for (const p of aufraeumen) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* the original error is the one to report */ } }
    try { fs.rmdirSync(speicher(o)); } catch { /* not empty or not there */ }
    throw e;
  } finally { lauf = { ...lauf0 }; }
}

type Probe = { klasse: number; oktave: number; midi: number | null; konfidenz: number };

/** Pitch detection on up to five files of different notes, spread over the range (the first 1.5 s of each, leading silence cut off). */
async function erkenneProben(a: Analyse, pfadVon: (rel: string) => string): Promise<Probe[]> {
  const e = a.eintraege;
  const schluessel = (x: { klasse: number | null; oktave: number | null }): number => x.klasse! + 12 * x.oktave!;
  const gesehen = new Set<number>(), wahl: typeof e = [];
  for (let k = 0; k < PROBEN; k++) {
    const x = e[Math.round(k * (e.length - 1) / (PROBEN - 1))];
    if (x && !gesehen.has(schluessel(x))) { gesehen.add(schluessel(x)); wahl.push(x); }
  }
  return Promise.all(wahl.map(async (x): Promise<Probe> => {
    const roh = await dekodiereDateiAsync(pfadVon(x.rel), PROBE_S);
    const start = Math.max(0, ersterTon(roh));
    const er = erkenneGrundton(roh, start, roh.length / 2);
    return { klasse: x.klasse!, oktave: x.oktave!, midi: er.hz === null ? null : 69 + 12 * Math.log2(er.hz / 440), konfidenz: er.konfidenz };
  }));
}
