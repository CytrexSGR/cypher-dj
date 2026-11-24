// Sampler A1: the cut store. A cut is one audio (a library loop or the audio of a live module track) with a table of slice bounds. Making one writes
//   <graph folder>/samples/smp-<id>.f32   the cut audio (frame 0 = beat 1, stereo float32 48 kHz), never changed afterwards
//   <graph folder>/smp-<id>.json          the generated device (device.ts)
//   <graph folder>/panels/smp-<id>.json   its panel
//   <store>/<id>/schnitt.json             the cut itself, written last: a cut exists only with this file
// in this order, each by temp file plus rename; the cut folder is made first with mkdir, which also reserves the id. A write that fails midway removes
// what was written. Every limit is refused with a reason (SchnittFehler) before anything is written.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { ablageOrdner } from '../paths.ts';
import path from 'node:path';
import { graphenOrdner } from '../graphs.ts';
import { leseLoopQuelle, loopOrdnerVorgabe } from '../loops.ts';
import { liesModul, modulBasis, modulOrdner } from '../project/module_storage.ts';
import { findeAnschlaege, type Anschlag } from '../project/transients.ts';
import { geraetGraph, geraetName, geraetPanel } from './device.ts';
import { ladeDatei, ladeDateiPfad } from './file.ts';
import { leseWavF32 } from './wav.ts';
import { pruefeBkSchreiben } from './bk_schutz.ts';

/** `katalog`: `ref` is the 64 hex sha of a catalog row; made only by the routes `/sampler/datei/*`, which hand `Ordner.katalogPfad` in. */
export type Quelle = { art: 'loop' | 'modul' | 'datei' | 'katalog'; ref: string; stem?: string };
/** Quality of a marker (guete[i] belongs to grenzen[i]): `staerke` 0..1 is the strength of the hit near the marker (0: none), null on cuts of plan A1 that
 *  were never cut again; `raster_abstand_beats` is the signed distance to the nearest grid position, 0 when it is under RASTER_NAH_BEATS. */
export type Guete = { staerke: number | null; raster_abstand_beats: number };
export type Schnitt = {
  schema: 1; id: string; name: string; quelle: Quelle; bpm: number; beats: number; tonart?: string; frames: number;
  methode: 'raster' | 'anschlag' | 'hand' | 'ganz'; grenzen: number[]; guete: Guete[]; erstellt: string;
  /** The bounds as the method made them (written at every (re)cut, kept by marker edits), the hits used for `guete` and snapping (frames), the
   *  sensitivity of an `anschlag` cut, the time of the last change. All optional: cuts of plan A1 have none of them. */
  ursprung?: number[]; treffer?: number[]; empfindlichkeit?: number; geaendert?: string;
  /** The method that made `ursprung`, kept while marker edits make the cut `hand`; the bounds back on `ursprung` restore it. */
  ursprung_methode?: 'raster' | 'anschlag' | 'ganz';
};

export const SCHNITT_ID = /^[a-z0-9][a-z0-9-]{0,27}$/;
/** 60 s at 48 kHz; the same limit as the block `sampler` (D1). */
export const MAX_SCHNITT_FRAMES = 2_880_000;
export const RASTER_ZAHLEN = [4, 8, 16, 32, 64];
const NAME_MAX = 60;   // keeps "Slices of <name>" within the 90 characters of a category text
/** Sensitivity of hit detection 0..1 (E1); 0.5 is the production jump threshold of 5 dB. */
export const EMPFINDLICHKEIT_VORGABE = 0.5;
export const MAX_SCHEIBEN = 64;
/** A marker takes the strength of the hit within this distance (E3). */
export const MESS_FENSTER_S = 0.010;
/** A marker this close to a grid position (in beats) counts as on it. */
export const RASTER_NAH_BEATS = 0.01;
const RASTER_EINHEIT_BEATS = 0.25;   // 1/16 note
/** The grid unit a raster cut of `n` slices is measured against: 1/16, or its own slice length when that is finer (32 or 64 slices of a bar). */
export const rasterEinheit = (beats: number, n: number): number => Math.min(RASTER_EINHEIT_BEATS, beats / n);
const MIN_SCHEIBE = 4;               // frames
const ENDE_FRAMES = 4;               // a hit this close to 0 or to the end merges into that end
const STEMS = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'];

export function samplerOrdner(): string {
  return ablageOrdner('sampler');
}

/** Reason codes: quelle_unbekannt, zu_lang, kein_raster, format_falsch, argument_ungueltig, methode_unbekannt, schnitt_unbekannt, keine_anschlaege. `code` is the HTTP status. */
export class SchnittFehler extends Error {
  readonly code: number; readonly grund: string; readonly text: string;
  constructor(code: number, grund: string, text: string) { super(`${grund}: ${text}`); this.code = code; this.grund = grund; this.text = text; }
}
const arg = (text: string): SchnittFehler => new SchnittFehler(400, 'argument_ungueltig', text);

/** `tempo` (BPM of the open project) and `dateiMaxFrames` (a lower limit than 60 s, for tests) only matter for a source of the art `datei`. `packMaxBytes`
 *  (a lower limit than 2 GiB, for tests) only matters for the pack of an instrument. */
export type Ordner = { ordner?: string; bk?: string; loops?: string; module?: string; tempo?: number; dateiMaxFrames?: number; packMaxBytes?: number; zonenMax?: number;
  /** The file of a catalog sha (null: unknown); only the routes of the file part hand it in. */ katalogPfad?: (sha: string) => string | null };

export type QuellAudio = { daten: Float32Array; frames: number; bpm: number; beats: number; tonart?: string; name: string };

/** The audio of a source (D5), as the cut will hold it. A library loop is rotated so that frame 0 is its beat 1 (`versatz_frames`, "grid later by so many
 *  frames"); a module track is the WAV of its clip, its bpm follows from the frames and `herkunft.laenge_beats` (herkunft.bpm can differ from the audio). */
export function ladeQuellAudio(q: Quelle, o: Ordner = {}): QuellAudio {
  if (typeof q !== 'object' || q === null || typeof q.ref !== 'string') throw arg('quelle: {art, ref} expected');
  if (q.art === 'datei') return ladeDatei(q.ref, o);   // sample player: ref is `<root name>/<path>`
  if (q.art === 'katalog') {   // the catalog row was checked by the route; here only the file is loaded (the stored cut audio is the f32, ref is provenance)
    const pfad = o.katalogPfad?.(q.ref) ?? null;
    if (pfad === null) throw new SchnittFehler(404, 'quelle_unbekannt', `catalog file ${q.ref.slice(0, 16)} is unknown`);
    return ladeDateiPfad(pfad, o);
  }
  if (q.art === 'loop') {
    const l = leseLoopQuelle(o.loops ?? loopOrdnerVorgabe(''), q.ref);
    if (!l) throw new SchnittFehler(404, 'quelle_unbekannt', `library loop ${q.ref} does not exist or cannot be loaded`);
    const roh = fs.readFileSync(l.datei);
    if (roh.length !== l.frames * 8) throw new SchnittFehler(422, 'format_falsch', `loop.f32 of ${q.ref} has ${roh.length} bytes, expected ${l.frames * 8}`);
    const quelle = new Float32Array(l.frames * 2);
    new Uint8Array(quelle.buffer).set(roh);
    const start = l.versatz_frames < 0 ? l.frames + l.versatz_frames : l.versatz_frames;
    const daten = new Float32Array(l.frames * 2);
    daten.set(quelle.subarray(start * 2), 0);
    daten.set(quelle.subarray(0, start * 2), (l.frames - start) * 2);
    return { daten, frames: l.frames, bpm: 128, beats: l.beats, name: l.name };
  }
  if (q.art !== 'modul') throw arg(`quelle.art: loop, modul or datei expected`);
  if (q.stem !== undefined && !STEMS.includes(q.stem)) throw arg(`quelle.stem: ${STEMS.join(', ')} expected`);
  const basis = o.module ?? modulBasis();
  const m = liesModul(q.ref, basis);
  if (!m) throw new SchnittFehler(404, 'quelle_unbekannt', `module ${q.ref} does not exist`);
  const stemName = q.stem === undefined ? 'Loop' : `${q.stem[0].toUpperCase()}${q.stem.slice(1)}`;
  const spurName = q.stem === undefined ? 'Loop' : `${stemName} original`;
  const clip = m.spuren.find((s) => s.name === spurName)?.clips.find((c) => c.art === 'audio');
  if (!clip || clip.art !== 'audio') throw new SchnittFehler(404, 'quelle_unbekannt', `module ${q.ref} has no audio track ${spurName}`);
  const ordner = path.resolve(modulOrdner(q.ref, basis) ?? path.join(basis, q.ref));
  const datei = path.resolve(ordner, clip.quelle.pfad_hinweis);
  if (path.isAbsolute(clip.quelle.pfad_hinweis) || !datei.startsWith(`${ordner}${path.sep}`)) {
    throw new SchnittFehler(404, 'quelle_unbekannt', `module ${q.ref}: the audio path of ${spurName} leaves the module folder`);
  }
  const { daten, frames } = leseWavF32(datei, MAX_SCHNITT_FRAMES);
  const beats = m.herkunft?.laenge_beats;
  if (typeof beats !== 'number' || !Number.isFinite(beats) || beats <= 0 || beats > 64 || Math.abs(beats * 8 - Math.round(beats * 8)) > 1e-9) {
    throw new SchnittFehler(422, 'kein_raster', `module ${q.ref}: laenge_beats ${String(beats)} is missing or not a multiple of 0.125 up to 64`);
  }
  const bpm = beats * 2_880_000 / frames;
  if (!(bpm >= 40 && bpm <= 300)) throw new SchnittFehler(422, 'kein_raster', `module ${q.ref}: ${beats} beats in ${frames} frames is ${bpm.toFixed(2)} BPM, outside 40..300`);
  const titel = m.herkunft?.titel ?? m.gruppen[0].name;
  return { daten, frames, bpm, beats, ...(m.herkunft?.tonart ? { tonart: m.herkunft.tonart } : {}),
    name: `${titel} · ${q.stem === undefined ? 'Loop' : stemName}`.slice(0, NAME_MAX) };
}

/** Default grid count: the finest of 1/16, 1/8, 1/4, 1/2 and 1 note (0.25, 0.5, 1, 2, 4 beats) that divides the loop into at most 64 whole slices; a
 *  length that none divides (a multiple of 0.125 beat) falls back to 1/32 notes. */
export function standardZahl(beats: number): number {
  for (const einheit of [0.25, 0.5, 1, 2, 4, 0.125]) {
    const n = beats / einheit;
    if (Math.abs(n - Math.round(n)) < 1e-9 && n >= 1 && n <= 64) return Math.round(n);
  }
  throw new SchnittFehler(422, 'kein_raster', `no grid for ${beats} beats`);
}

type Audio = { frames: number; beats: number; daten: Float32Array };
type Methode = (a: Audio, opt: Record<string, unknown>) => { grenzen: number[]; guete: Guete[]; treffer: number[]; empfindlichkeit?: number };

/** Jump threshold in dB for a sensitivity (E1): 9 - 8 * e, so 0.5 is the production value 5 dB. */
export const sprungDbVon = (e: number): number => 9 - 8 * e;

const r3 = (x: number): number => Math.round(x * 1000) / 1000;
const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;

/** Quality of every marker (E3): `guete[i]` belongs to `grenzen[i]`. `staerke` is the strength of the hit nearest the marker within MESS_FENSTER_S, else 0.
 *  `raster_abstand_beats` is the signed distance from the marker to the nearest grid position (`einheit` beats, default a 1/16 note), 0 when under
 *  RASTER_NAH_BEATS. Nothing is moved by this. */
export function guete(a: { frames: number; beats: number }, grenzen: number[], treffer: Anschlag[], einheit = RASTER_EINHEIT_BEATS): Guete[] {
  const fenster = Math.round(MESS_FENSTER_S * 48000);
  return grenzen.slice(0, -1).map((g) => {
    let staerke = 0, best = Infinity;
    for (const t of treffer) {
      const dist = Math.abs(t.frame - g);
      if (dist <= fenster && dist < best) { best = dist; staerke = t.staerke; }
    }
    const beat = g * a.beats / a.frames;
    const abstand = beat - Math.round(beat / einheit) * einheit;
    return { staerke, raster_abstand_beats: Math.abs(abstand) < RASTER_NAH_BEATS ? 0 : r6(abstand) };
  });
}

/** The hits of the audio at a sensitivity (frames and strength). */
const trefferVon = (a: Audio, e: number): Anschlag[] => findeAnschlaege(a.daten, 48000, { sprungDb: sprungDbVon(e) });
const framesVon = (t: Anschlag[]): number[] => t.map((x) => x.frame);

/** Slicing methods by name (D14). `POST /sampler/schnitt` passes the unknown keys of its body as `opt`. */
export const SCHNITT_METHODEN: Record<string, Methode> = {
  raster(a, opt) {
    const n = opt.scheiben === undefined ? standardZahl(a.beats) : opt.scheiben;
    if (typeof n !== 'number' || !Number.isInteger(n) || (opt.scheiben !== undefined && !RASTER_ZAHLEN.includes(n))) {
      throw arg(`scheiben: one of ${RASTER_ZAHLEN.join(', ')} expected`);
    }
    const grenzen = Array.from({ length: n + 1 }, (_, k) => Math.round(k * a.frames / n));
    if (grenzen.some((g, i) => i > 0 && g - grenzen[i - 1] < MIN_SCHEIBE)) throw arg(`scheiben: ${n} slices of ${a.frames} frames would be shorter than ${MIN_SCHEIBE} frames`);
    const t = trefferVon(a, EMPFINDLICHKEIT_VORGABE);
    // the markers are the grid: a grid finer than 1/16 (32 or 64 slices of a bar) is measured against itself, so a grid marker has 0
    return { grenzen, guete: guete(a, grenzen, t, rasterEinheit(a.beats, n)), treffer: framesVon(t) };
  },
  /** Bounds at the hits (E2): [0, hits..., frames]; a hit within 4 frames of an end merges into it; more than 63 interior hits keep the 63 strongest. */
  anschlag(a, opt) {
    const e = opt.empfindlichkeit === undefined ? EMPFINDLICHKEIT_VORGABE : opt.empfindlichkeit;
    if (typeof e !== 'number' || !Number.isFinite(e) || e < 0 || e > 1) throw arg('empfindlichkeit: a number from 0 to 1 expected');
    const t = trefferVon(a, e);
    let innen = t.filter((x) => x.frame > ENDE_FRAMES && x.frame < a.frames - ENDE_FRAMES);
    if (innen.length === 0) throw new SchnittFehler(422, 'keine_anschlaege', `no hits found at sensitivity ${e.toFixed(2)}; cut by grid instead, or raise the sensitivity (HITS in the strip of a cut track, empfindlichkeit in the hand tool)`);
    if (innen.length > MAX_SCHEIBEN - 1) innen = [...innen].sort((p, q) => q.staerke - p.staerke || p.frame - q.frame).slice(0, MAX_SCHEIBEN - 1);
    const grenzen = [0, ...framesVon(innen).sort((p, q) => p - q), a.frames];
    return { grenzen, guete: guete(a, grenzen, t), treffer: framesVon(t), empfindlichkeit: e };
  },
  /** Bounds given by the caller (E4): integers, 2..65 entries, first 0, last `frames`, strictly rising, every slice at least 4 frames. */
  hand(a, opt) {
    const g = opt.grenzen;
    if (!Array.isArray(g) || g.length < 2 || g.length > MAX_SCHEIBEN + 1 || !g.every((x) => typeof x === 'number' && Number.isInteger(x))) {
      throw arg(`grenzen: 2..${MAX_SCHEIBEN + 1} integers expected`);
    }
    if (g[0] !== 0 || g[g.length - 1] !== a.frames) throw arg(`grenzen: must start with 0 and end with ${a.frames}`);
    if (g.some((x, i) => i > 0 && x - g[i - 1] < MIN_SCHEIBE)) throw arg(`grenzen: must rise, every slice at least ${MIN_SCHEIBE} frames`);
    const t = trefferVon(a, EMPFINDLICHKEIT_VORGABE);
    return { grenzen: [...g], guete: guete(a, g, t), treffer: framesVon(t) };
  },
  /** The whole audio as one slice (sample player: a file as a source). */
  ganz(a) {
    return { grenzen: [0, a.frames], guete: [{ staerke: 0, raster_abstand_beats: 0 }], treffer: [] };
  },
};

const einsFile = (datei: string, inhalt: Buffer | string): void => {
  pruefeBkSchreiben(datei);
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  const tmp = `${datei}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, inhalt); fs.renameSync(tmp, datei); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
};
const json = (x: unknown): string => `${JSON.stringify(x, null, 2)}\n`;

const slug = (name: string): string => {
  const s = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 23).replace(/-+$/, '');
  return s === '' ? 'cut' : s;
};
const dateien = (id: string, o: Ordner): { schnitt: string; audio: string; graph: string; panel: string } => {
  const bk = o.bk ?? graphenOrdner();
  return { schnitt: path.join(o.ordner ?? samplerOrdner(), id, 'schnitt.json'), audio: path.join(bk, 'samples', `${geraetName(id)}.f32`),
    graph: path.join(bk, `${geraetName(id)}.json`), panel: path.join(bk, 'panels', `${geraetName(id)}.json`) };
};

/** Makes a cut: source audio, slicing method (default `raster`), the four files. Refusals (SchnittFehler) leave every folder as it was. */
export function legeSchnitt(a: { quelle: Quelle; name?: string; methode?: string; optionen?: Record<string, unknown> }, o: Ordner = {}): Schnitt {
  const methode = a.methode ?? 'raster';
  if (typeof methode !== 'string' || !Object.hasOwn(SCHNITT_METHODEN, methode)) throw new SchnittFehler(400, 'methode_unbekannt', `method ${String(methode)} is not available`);
  if (a.name !== undefined && (typeof a.name !== 'string' || a.name.trim() === '' || a.name.length > NAME_MAX)) throw arg(`name: a text of 1..${NAME_MAX} characters expected`);
  const optionen = a.optionen ?? {};
  if (typeof optionen !== 'object' || optionen === null || Array.isArray(optionen)) throw arg('optionen: object expected');
  if (a.quelle?.art === 'katalog' && !o.katalogPfad) throw arg('quelle.art: loop, modul or datei expected');   // catalog sources come only from /sampler/datei/*
  const q = ladeQuellAudio(a.quelle, o);
  const m = SCHNITT_METHODEN[methode](q, optionen);
  const name = a.name?.trim() ?? q.name;
  const store = o.ordner ?? samplerOrdner();
  fs.mkdirSync(store, { recursive: true });
  let id = '';
  for (let versuch = 0; ; versuch++) {   // mkdir without `recursive` fails when the folder exists: that reserves the id
    id = `${slug(name)}-${crypto.randomBytes(2).toString('hex')}`;
    try { fs.mkdirSync(path.join(store, id)); break; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || versuch >= 20) throw e; }
  }
  const s: Schnitt = { schema: 1, id, name, quelle: { art: a.quelle.art, ref: a.quelle.ref, ...(a.quelle.stem !== undefined ? { stem: a.quelle.stem } : {}) },
    bpm: q.bpm, beats: q.beats, ...(q.tonart !== undefined ? { tonart: q.tonart } : {}), frames: q.frames, methode: methode as Schnitt['methode'], grenzen: m.grenzen, guete: m.guete,
    erstellt: new Date().toISOString() };
  s.ursprung = [...m.grenzen]; s.treffer = m.treffer;
  if (m.empfindlichkeit !== undefined) s.empfindlichkeit = m.empfindlichkeit;
  s.geaendert = s.erstellt;
  const f = dateien(id, o);
  try {
    einsFile(f.audio, Buffer.from(q.daten.buffer, q.daten.byteOffset, q.daten.byteLength));
    einsFile(f.graph, json(geraetGraph(s)));
    einsFile(f.panel, json(geraetPanel(s)));
    einsFile(f.schnitt, json(s));
  } catch (e) {
    for (const p of [f.audio, f.graph, f.panel, path.join(store, id)]) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* the original error is the one to report */ } }
    throw e;
  }
  return s;
}

/** The audio of a cut as it was written (frame 0 = beat 1, stereo float32). The audio of a cut never changes (A1 D4). */
export function ladeSchnittAudio(s: Schnitt, o: Ordner = {}): Float32Array {
  const datei = dateien(s.id, o).audio;
  let roh: Buffer;
  try { roh = fs.readFileSync(datei); } catch { throw new SchnittFehler(404, 'quelle_unbekannt', `the audio of cut ${s.id} is missing`); }
  if (roh.length !== s.frames * 8) throw new SchnittFehler(422, 'format_falsch', `the audio of cut ${s.id} has ${roh.length} bytes, expected ${s.frames * 8}`);
  const daten = new Float32Array(s.frames * 2);
  new Uint8Array(daten.buffer).set(roh);
  return daten;
}

/** The hits of a cut with their strength, at the sensitivity of the cut (the default for grid and hand cuts): the hits `guete` is measured against (E3). */
export function anschlaegeVon(s: Schnitt, o: Ordner = {}): Anschlag[] {
  return findeAnschlaege(ladeSchnittAudio(s, o), 48000, { sprungDb: sprungDbVon(s.empfindlichkeit ?? EMPFINDLICHKEIT_VORGABE) });
}

/** The bytes of graph, panel and cut file as they are now. The returned function writes them back (a file that did not exist is removed again), for a
 *  caller whose later step was refused. */
export function sichereSchnitt(id: string, o: Ordner = {}): () => void {
  const f = dateien(id, o);
  const stand = [f.graph, f.panel, f.schnitt].map((p) => { try { return { p, inhalt: fs.readFileSync(p) as Buffer | null }; } catch { return { p, inhalt: null as Buffer | null }; } });
  return () => { for (const { p, inhalt } of stand) { if (inhalt === null) fs.rmSync(p, { force: true }); else einsFile(p, inhalt); } };
}

/** Writes a changed cut in place (E5): graph, panel, then `schnitt.json`, each by temp file plus rename; sets `geaendert` (always later than the previous
 *  value). The audio is not touched. A failure writes the previous files back. */
export function schreibeGeaendert(s: Schnitt, o: Ordner = {}): void {
  const f = dateien(s.id, o);
  const zurueck = sichereSchnitt(s.id, o);
  let t = new Date().toISOString();
  if (s.geaendert !== undefined && t <= s.geaendert) t = new Date(Date.parse(s.geaendert) + 1).toISOString();
  s.geaendert = t;
  try {
    einsFile(f.graph, json(geraetGraph(s)));
    einsFile(f.panel, json(geraetPanel(s)));
    einsFile(f.schnitt, json(s));
  } catch (e) {
    try { zurueck(); } catch { /* the original error is the one to report */ }
    throw e;
  }
}

/** Cuts the audio of an existing cut again by `raster` or `anschlag`, in place (E5): the id, the audio and the pattern stay, the bounds, quality, `ursprung`,
 *  `treffer` and `empfindlichkeit` are new. Every refusal (SchnittFehler) comes before the first write. */
export function schneideNeu(id: string, a: { methode: 'raster' | 'anschlag'; optionen?: Record<string, unknown> }, o: Ordner = {}): Schnitt {
  const alt = liesSchnitt(id, o);
  if (!alt) throw new SchnittFehler(404, 'schnitt_unbekannt', `cut ${String(id)} does not exist`);
  if (a.methode !== 'raster' && a.methode !== 'anschlag') throw new SchnittFehler(400, 'methode_unbekannt', `method ${String(a.methode)} cannot cut again: raster or anschlag expected`);
  const optionen = a.optionen ?? {};
  if (typeof optionen !== 'object' || optionen === null || Array.isArray(optionen)) throw arg('optionen: object expected');
  const m = SCHNITT_METHODEN[a.methode]({ frames: alt.frames, beats: alt.beats, daten: ladeSchnittAudio(alt, o) }, optionen);
  const { empfindlichkeit: _weg, ursprung_methode: _um, ...rest } = alt;
  const s: Schnitt = { ...rest, methode: a.methode, grenzen: m.grenzen, guete: m.guete, ursprung: [...m.grenzen], treffer: m.treffer,
    ...(m.empfindlichkeit !== undefined ? { empfindlichkeit: m.empfindlichkeit } : {}) };
  schreibeGeaendert(s, o);
  return s;
}

/** One cut by id; null when the id is not valid, the cut is unknown or its file is unreadable or not a cut. */
export function liesSchnitt(id: string, o: Ordner = {}): Schnitt | null {
  if (typeof id !== 'string' || !SCHNITT_ID.test(id)) return null;
  try {
    const s = JSON.parse(fs.readFileSync(path.join(o.ordner ?? samplerOrdner(), id, 'schnitt.json'), 'utf8')) as Schnitt;
    return s !== null && typeof s === 'object' && s.schema === 1 && s.id === id && Array.isArray(s.grenzen) && Array.isArray(s.guete) ? s : null;
  } catch { return null; }
}

/** Every readable cut, newest first (`erstellt`, then id). */
export function listeSchnitte(o: Ordner = {}): Schnitt[] {
  let namen: string[] = [];
  try { namen = fs.readdirSync(o.ordner ?? samplerOrdner()); } catch { return []; }
  const aus: Schnitt[] = [];
  for (const n of namen) { const s = liesSchnitt(n, o); if (s) aus.push(s); }
  return aus.sort((x, y) => (x.erstellt < y.erstellt ? 1 : x.erstellt > y.erstellt ? -1 : x.id < y.id ? -1 : 1));
}

/** Removes the four files of a cut (the cut file last). Tracks that still play the device keep their graph name; they find the graph missing, as after any
 *  deleted graph. */
export function loescheSchnitt(id: string, o: Ordner = {}): void {
  const s = liesSchnitt(id, o);
  if (!s) throw new SchnittFehler(404, 'schnitt_unbekannt', `cut ${String(id)} does not exist`);
  const f = dateien(id, o);
  for (const p of [f.audio, f.graph, f.panel]) fs.rmSync(p, { force: true });
  fs.rmSync(path.join(o.ordner ?? samplerOrdner(), id), { recursive: true, force: true });
}
