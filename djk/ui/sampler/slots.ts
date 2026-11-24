// Tracker task 21: slot banks of the `amiga` device. A bank is a generated graph `amiga-<6 hex>`: a copy of the `amiga` graph whose `paula` node carries
// the named field `plaetze` (1..32 entries, see the block `paula`). The sample data of a slot is a raw stereo float32 file `smp-p<8 hex>.f32` in the sample
// folder of the graphs (`<graph folder>/samples`), in the AMIGA FORM: a low rate and 8 bit values. This part holds the pure bank graph, the conversion
// into the Amiga form and the file store; the routes are in areas/sampler/platz_routen.ts.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { graphenOrdner } from '../graphs.ts';
import { pfadeVon } from '../devices_parameter.ts';
import { sichereWerksProben } from './werksproben.ts';
import { pruefeBkSchreiben } from './bk_schutz.ts';

export const PLATZ_MAX = 32;
export const PLATZ_NAME_MAX = 22;
export const RATE_MIN = 4000;
export const RATE_MAX = 48000;
/** The default target rate of a loaded file: 3546895 Hz (PAL Paula clock) / 214 (the ProTracker period of the note C-2), also the default of the RATE knob. */
export const RATE_VORGABE = 16574;
/** Middle C (MIDI 60): the note that plays a slot file at its original pitch. */
export const GRUND_VORGABE = 261.6256;
export const GRUND_MIN = 20;
export const GRUND_MAX = 2000;
export const FEIN_MIN = -8;
export const FEIN_MAX = 7;
/** The silent file an empty slot points at (32 frames). */
export const LEER_DATEI = 'amiga-leer.f32';
export const BANK_NAME = /^amiga-[0-9a-f]{6}$/;
const QUELLRATE = 48000;

export type PlatzDaten = {
  datei: string; name?: string; grund: number; rate: number; schleife?: number; s_von?: number; s_laenge?: number; pegel?: number; fein?: number;
};
type Graph = Record<string, unknown> & { knoten?: Record<string, unknown>[] };

/** One entry as the graph stores it: defaults (loop off, start 0, length 0, level 1, finetune 0) and an absent name are left out. */
export function platzEintrag(p: PlatzDaten): PlatzDaten {
  return {
    datei: p.datei,
    ...(p.name !== undefined && p.name !== '' ? { name: p.name } : {}),
    grund: p.grund, rate: p.rate,
    ...(p.schleife === 1 ? { schleife: 1 } : {}),
    ...(p.s_von ? { s_von: p.s_von } : {}),
    ...(p.s_laenge ? { s_laenge: p.s_laenge } : {}),
    ...(p.pegel !== undefined && p.pegel !== 1 ? { pegel: p.pegel } : {}),
    ...(p.fein ? { fein: p.fein } : {}),
  };
}

/** The empty slot: the silent file, no name. */
export const leerPlatz = (): PlatzDaten => ({ datei: LEER_DATEI, grund: GRUND_VORGABE, rate: RATE_VORGABE });
export const istLeer = (p: PlatzDaten): boolean => p.datei === LEER_DATEI;

/** Pure. A copy of `basis` (the `amiga` graph or another bank) with the `paula` node's `plaetze` replaced by `plaetze` (1..32 entries); `name` (when given) is the
 *  name of the copy. Throws an Error when the base has no `paula` node or the list has not 1..32 entries. The base is not changed. */
export function bankGraph(basis: object, plaetze: PlatzDaten[], name?: string): Record<string, unknown> {
  if (!Array.isArray(plaetze) || plaetze.length < 1 || plaetze.length > PLATZ_MAX) throw new Error(`a bank holds 1..${PLATZ_MAX} slots`);
  const g = JSON.parse(JSON.stringify(basis)) as Graph;
  const k = Array.isArray(g.knoten) ? g.knoten.find((x) => x.art === 'paula') : undefined;
  if (!k) throw new Error('the base graph has no paula node');
  k.plaetze = plaetze.map(platzEintrag);
  if (name !== undefined) g.name = name;
  return g;
}

/** Pure. The slots a graph's `paula` node holds (a copy); [] when it has none. */
export function plaetzeVon(graph: object): PlatzDaten[] {
  const k = Array.isArray((graph as Graph).knoten) ? (graph as Graph).knoten!.find((x) => x.art === 'paula') : undefined;
  return Array.isArray(k?.plaetze) ? (JSON.parse(JSON.stringify(k!.plaetze)) as PlatzDaten[]) : [];
}

// ---- conversion into the Amiga form ----

/** 8 bit: k = round(x * 128) clamped to -128..127, value k / 128. */
export const acht = (x: number): number => Math.max(-128, Math.min(127, Math.round(x * 128))) / 128;

const NULLSTELLEN = 12;   // zero crossings of the sinc on each side of a kernel
const GRENZ = 0.45;       // cut-off at 0.45 of the target rate (transition up to the target Nyquist)

/** Pure. Stereo float32 at 48 kHz to stereo float32 at `rate` (< 48000): a windowed-sinc low-pass (Blackman window, 12 zero crossings per side, cut-off 0.45 times
 *  the target rate, gain 1 at DC) evaluated only at the output instants, so that nothing above the target Nyquist folds back. `frames` = round(frames * rate / 48000). */
export function tiefpassUmrechnen(x: Float32Array, rate: number): Float32Array {
  const nEin = x.length >> 1;
  if (rate >= QUELLRATE) return x.slice();
  const nAus = Math.max(1, Math.round(nEin * rate / QUELLRATE));
  const w = 2 * GRENZ * rate / QUELLRATE;        // cut-off relative to the source rate (full scale 1 = the source sample rate)
  const halb = NULLSTELLEN / w;                  // half width of the kernel in source samples
  const aus = new Float32Array(nAus * 2);
  const schritt = QUELLRATE / rate;
  for (let i = 0; i < nAus; i++) {
    const t = i * schritt;
    const j0 = Math.ceil(t - halb), j1 = Math.floor(t + halb);
    let summe = 0, l = 0, r = 0;
    for (let j = j0; j <= j1; j++) {
      const d = j - t, u = d / halb;
      const sinc = d === 0 ? 1 : Math.sin(Math.PI * w * d) / (Math.PI * w * d);
      const k = w * sinc * (0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u));
      summe += k;
      if (j >= 0 && j < nEin) { l += x[2 * j] * k; r += x[2 * j + 1] * k; }
    }
    aus[2 * i] = l / summe; aus[2 * i + 1] = r / summe;
  }
  return aus;
}

/** Pure. The file as an Amiga slot: low-passed down to `rate`, then 8 bit. Returns the data (stereo float32 at `rate`, every value a multiple of 1/128) and
 *  its frame count. */
export function wandleAmiga(x: Float32Array, rate: number): { daten: Float32Array; frames: number } {
  const t = tiefpassUmrechnen(x, rate);
  for (let i = 0; i < t.length; i++) t[i] = acht(t[i]);
  return { daten: t, frames: t.length >> 1 };
}

// ---- the store ----

const einsFile = (datei: string, inhalt: Buffer | string): void => {
  pruefeBkSchreiben(datei);
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  const tmp = `${datei}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, inhalt); fs.renameSync(tmp, datei); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
};
const jsonText = (x: unknown): string => `${JSON.stringify(x, null, 2)}\n`;
const dateiVon = (daten: Float32Array): Buffer => Buffer.from(daten.buffer, daten.byteOffset, daten.byteLength);

export const samplesOrdner = (bk: string = graphenOrdner()): string => path.join(bk, 'samples');
export const graphDatei = (name: string, bk: string = graphenOrdner()): string => path.join(bk, `${name}.json`);

/** The graph `name` as the engine reads it (graph folder); a missing `amiga` falls back to the one in the repo (djk/instruments/modular_dsp/demos). null when unreadable. */
export function leseGraphDatei(name: string, bk: string = graphenOrdner()): Record<string, unknown> | null {
  for (const p of [graphDatei(name, bk), path.join(pfadeVon().beispiele, `${name}.json`)]) {
    try { const g = JSON.parse(fs.readFileSync(p, 'utf8')); if (g && typeof g === 'object' && !Array.isArray(g)) return g as Record<string, unknown>; } catch { /* next */ }
  }
  return null;
}

/** The panel of the base graph with the graph name replaced, or null when there is none. */
function panelFuer(basis: string, neu: string, bk: string): Record<string, unknown> | null {
  for (const p of [path.join(bk, 'panels', `${basis}.json`), path.join(pfadeVon().paneele, `${basis}.json`)]) {
    try {
      const x = JSON.parse(fs.readFileSync(p, 'utf8')) as { geraet?: Record<string, unknown> };
      return { ...x, geraet: { ...(x.geraet ?? {}), art: 'bk', graph: neu } };
    } catch { /* next */ }
  }
  return null;
}

/** Frames of a sample file of the sample folder (stereo float32: 8 bytes each); 0 when it is missing. */
export function frameZahl(datei: string, bk: string = graphenOrdner()): number {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(datei)) return 0;
  try { return Math.floor(fs.statSync(path.join(samplesOrdner(bk), datei)).size / 8); } catch { return 0; }
}

/** A free bank name `amiga-<6 hex>` (no graph file of that name yet). */
export function neuerBankName(bk: string = graphenOrdner()): string {
  for (;;) {
    const n = `amiga-${crypto.randomBytes(3).toString('hex')}`;
    if (!fs.existsSync(graphDatei(n, bk))) return n;
  }
}

/** Writes stereo float32 data as a new slot file `smp-p<8 hex>.f32` into the sample folder (the name is free); returns the file name. */
export function schreibeSample(daten: Float32Array, bk: string = graphenOrdner()): string {
  for (;;) {
    const n = `smp-p${crypto.randomBytes(4).toString('hex')}.f32`;
    const pfad = path.join(samplesOrdner(bk), n);
    if (fs.existsSync(pfad)) continue;
    einsFile(pfad, dateiVon(daten));
    return n;
  }
}

/** Makes sure the silent file of empty slots exists. */
export function sichereLeerDatei(bk: string = graphenOrdner()): void {
  const pfad = path.join(samplesOrdner(bk), LEER_DATEI);
  if (!fs.existsSync(pfad)) einsFile(pfad, Buffer.alloc(32 * 8));
}

/** Writes graph and panel of a NEW bank `name` made from the base graph `basis` with `plaetze`. Returns what to undo it with. */
export function schreibeNeueBank(name: string, basis: string, plaetze: PlatzDaten[], bk: string = graphenOrdner()): () => void {
  sichereWerksProben(samplesOrdner(bk));                                  // no `amiga` graph translates without the factory files
  const b = leseGraphDatei(basis, bk);
  if (!b) throw new Error(`the graph ${basis} cannot be read`);
  const g = bankGraph(b, plaetze, name), p = panelFuer(basis, name, bk);
  const graph = graphDatei(name, bk), panel = path.join(bk, 'panels', `${name}.json`);
  einsFile(graph, jsonText(g));
  try { if (p) einsFile(panel, jsonText(p)); } catch (e) { fs.rmSync(graph, { force: true }); throw e; }
  return () => { fs.rmSync(graph, { force: true }); fs.rmSync(panel, { force: true }); };
}

/** Removes sample files again (a refusal after they were written). */
export function entferneSamples(dateien: string[], bk: string = graphenOrdner()): void {
  for (const d of dateien) if (/^smp-p[0-9a-f]{8}\.f32$/.test(d)) fs.rmSync(path.join(samplesOrdner(bk), d), { force: true });
}

// ---- the bank of a MOD import (tracker task 26) ----

/** One sample of a module as the parser hands it over (project/mod_import.ts): stereo float32 already in the Amiga form (8 bit values, the module's rate). */
export interface BankSample {
  nr: number; name?: string; daten: Float32Array; rate: number; grund: number; schleife: 0 | 1; s_von: number; s_laenge: number; pegel: number; fein: number;
}

/** Writes the samples of a module as slot files (as they are: they are in the Amiga form already, nothing is converted again) and ONE new bank graph
 *  `amiga-<6 hex>` made from the `amiga` graph; slot `nr` holds sample `nr`, the slots between hold the silent file, and a module without samples gets one
 *  empty slot. All or nothing: a failing step removes what was written before and throws. Returns the bank name and `zurueck`, which removes the bank graph, its
 *  panel and the sample files again (a refusal after the bank was made). The silent file is shared by every bank and stays. */
export function legeBank(samples: BankSample[], bk: string = graphenOrdner()): { name: string; zurueck: () => void } {
  const dateien: string[] = [];
  let weg: (() => void) | undefined;
  const raeume = (): void => { try { weg?.(); } catch { /* the original error is the one to report */ } entferneSamples(dateien, bk); };
  try {
    const hoechste = samples.reduce((m, s) => Math.max(m, s.nr), 0);
    if (hoechste > PLATZ_MAX || samples.some((s) => !Number.isInteger(s.nr) || s.nr < 1)) throw new Error(`a sample number is outside 1..${PLATZ_MAX}`);
    const plaetze: PlatzDaten[] = Array.from({ length: Math.max(1, hoechste) }, leerPlatz);
    for (const s of samples) {
      const datei = schreibeSample(s.daten, bk);
      dateien.push(datei);
      plaetze[s.nr - 1] = platzEintrag({ datei, ...(s.name !== undefined ? { name: s.name.slice(0, PLATZ_NAME_MAX).trim() } : {}), grund: s.grund, rate: s.rate,
        schleife: s.schleife, s_von: s.s_von, s_laenge: s.s_laenge, pegel: s.pegel, fein: s.fein });
    }
    if (plaetze.some(istLeer)) sichereLeerDatei(bk);
    const name = neuerBankName(bk);
    weg = schreibeNeueBank(name, 'amiga', plaetze, bk);
    return { name, zurueck: raeume };
  } catch (e) { raeume(); throw e; }
}
