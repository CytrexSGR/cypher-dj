// Sampler C: one slice, or a run of neighbouring slices, of a cut played as a tone. This part is pure: names (C-D1), note names (C-F6), the generated device
// graph and panel (C-D3), as plain objects (the store part writes them as JSON).
//
//   note.hz -> transponiere (Tune, +-1 st) -> smp.hz        smp = sampler, pitch mode on ONE region [a, b) of the cut audio `smp-<cut id>.f32`
//   note.trig -> smp.trig, note.gate -> smp.gate, env = adsr (gate, trig, Attack/Decay/Release in ms through x 0.001, Sustain)
//   gain = note.vel * 1.27 * Level * env    (vel arrives as vel/127, so velocity 100 at Level 1 is unity)
//   smp.l/r -> svf low-pass (Cutoff, Reso) -> x gain -> out
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GRAPH_NAME, graphenOrdner } from '../graphs.ts';
import { geraetName } from './device.ts';
import { SCHNITT_ID, SchnittFehler, liesSchnitt, samplerOrdner, type Ordner, type Schnitt } from './schnitt.ts';
import { erkenneGrundton, grundVorschlag, type Erkannt } from './tone_hoehe.ts';
import { pruefeBkSchreiben } from './bk_schutz.ts';

/** A cut id of at most this many characters goes into the graph name as it is. */
export const TON_KURZ_MAX = 25;

/** `ton-<k>-<n>`, `n` 1..99; `k` is the cut id, or (longer than TON_KURZ_MAX) its first 20 characters without a trailing `-`, then `-` and its last 4 characters.
 *  At most 4 + 25 + 1 + 2 = 32 characters, the limit of a graph name. */
export function tonGraphName(schnittId: string, n: number): string {
  const k = schnittId.length <= TON_KURZ_MAX ? schnittId : `${schnittId.slice(0, 20).replace(/-+$/, '')}-${schnittId.slice(-4)}`;
  return `ton-${k}-${n}`;
}

/** The `k` part of `tonGraphName` for a cut id. */
export const tonKurz = (schnittId: string): string => tonGraphName(schnittId, 1).slice(4, -2);

/** Frequency of a MIDI note (69 = 440 Hz). */
export const noteHz = (note: number): number => 440 * 2 ** ((note - 69) / 12);

const NAMEN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Note name the way the piano roll shows it: 60 = C3. */
export const notenName = (n: number): string => `${NAMEN[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 2}`;

/** What the device is made of. `grund` is a MIDI note 16..95; the graph gets `noteHz(grund)` (the block takes 20..2000 Hz). `a`, `b` are frames of the cut audio. */
export type TonDaten = { graph: string; schnitt_id: string; name: string; a: number; b: number; grund: number };

const KNOEPFE = [
  { nr: 1, id: 'tun', name: 'Tune', min: -1, max: 1, log: 0, vorgabe: 0.5, format: 'raw', unit: 'st' },
  { nr: 2, id: 'atk', name: 'Attack', min: 0.5, max: 2000, log: 1, vorgabe: 0.0836, format: 'ms' },
  { nr: 3, id: 'dec', name: 'Decay', min: 1, max: 4000, log: 1, vorgabe: 0.5, format: 'ms' },
  { nr: 4, id: 'sus', name: 'Sustain', min: 0, max: 1, log: 0, vorgabe: 1, format: 'percent' },
  { nr: 5, id: 'rel', name: 'Release', min: 1, max: 8000, log: 1, vorgabe: 0.6347, format: 'ms' },
  { nr: 6, id: 'cut', name: 'Cutoff', min: 40, max: 20000, log: 1, vorgabe: 1, format: 'hz' },
  { nr: 7, id: 'res', name: 'Reso', min: 0, max: 1, log: 0, vorgabe: 0, format: 'percent' },
  { nr: 8, id: 'lvl', name: 'Level', min: 0, max: 2, log: 0, mitte: 1, vorgabe: 0.5, format: 'raw', unit: 'x' },
] as const;

/** The device graph of a tone (8 voices). */
export function tonGraph(t: TonDaten): Record<string, unknown> {
  const knoten: Record<string, unknown>[] = [
    { id: 'note', art: 'note' },
    { id: 'tr', art: 'transponiere' },
    { id: 'smp', art: 'sampler', datei: `${geraetName(t.schnitt_id)}.f32`, grund: noteHz(t.grund), grenzen: [t.a, t.b], noten_wahl: 0, schleife: 0 },
    ...KNOEPFE.map((k) => ({ id: k.id, art: 'regler', nr: k.nr, min: k.min, max: k.max, log: k.log, vorgabe: k.vorgabe, ...('mitte' in k ? { mitte: k.mitte } : {}) })),
    { id: 'env', art: 'adsr', a: 0.001, d: 0.063, s: 1, r: 0.3 },   // the engine requires a value for a, d, s, r; the edges from the knobs win
    { id: 'a_s', art: 'mul', b: 0.001 }, { id: 'd_s', art: 'mul', b: 0.001 }, { id: 'r_s', art: 'mul', b: 0.001 },
    { id: 'vel', art: 'mul', b: 1.27 },
    { id: 'g1', art: 'mul' },
    { id: 'gain', art: 'mul' },
    ...['l', 'r'].flatMap((z) => [{ id: `lp_${z}`, art: 'svf', pole: 2 }, { id: `amp_${z}`, art: 'mul' }]),
    { id: 'aus', art: 'ausgang' },
  ];
  const kanten: { von: string; nach: string }[] = [
    { von: 'note.hz', nach: 'tr.hz' }, { von: 'tun.aus', nach: 'tr.st' }, { von: 'tr.aus', nach: 'smp.hz' },
    { von: 'note.trig', nach: 'smp.trig' }, { von: 'note.gate', nach: 'smp.gate' },
    { von: 'note.gate', nach: 'env.gate' }, { von: 'note.trig', nach: 'env.trig' },
    { von: 'atk.aus', nach: 'a_s.a' }, { von: 'a_s.aus', nach: 'env.a' },
    { von: 'dec.aus', nach: 'd_s.a' }, { von: 'd_s.aus', nach: 'env.d' },
    { von: 'rel.aus', nach: 'r_s.a' }, { von: 'r_s.aus', nach: 'env.r' },
    { von: 'sus.aus', nach: 'env.s' },
    { von: 'note.vel', nach: 'vel.a' }, { von: 'vel.aus', nach: 'g1.a' }, { von: 'lvl.aus', nach: 'g1.b' },
    { von: 'g1.aus', nach: 'gain.a' }, { von: 'env.aus', nach: 'gain.b' },
  ];
  for (const z of ['l', 'r']) {
    kanten.push({ von: `smp.${z}`, nach: `lp_${z}.x` }, { von: 'cut.aus', nach: `lp_${z}.cutoff` }, { von: 'res.aus', nach: `lp_${z}.reso` },
      { von: `lp_${z}.tp`, nach: `amp_${z}.a` }, { von: 'gain.aus', nach: `amp_${z}.b` }, { von: `amp_${z}.aus`, nach: `aus.${z}` });
  }
  return { format: 'baukasten/2', name: t.graph, stimmen: 8, regler_namen: Object.fromEntries(KNOEPFE.map((k) => [String(k.nr), k.name])), knoten, kanten };
}

/** The panel of a tone (cypherdj-panel/2): one section TONE with the eight knobs k1..k8. The title carries the tone name, cut to the 40 characters a title may have.
 *  Root and region are only in the graph, so a root change rewrites the graph, not the panel. */
export function tonPanel(t: TonDaten): Record<string, unknown> {
  const kopf = 'Tone · ';
  const titel = `${kopf}${t.name}`.length <= 40 ? `${kopf}${t.name}` : `${kopf}${t.name.slice(0, 40 - kopf.length - 1).trimEnd()}…`;
  return {
    format: 'cypherdj-panel/2',
    geraet: { art: 'bk', graph: t.graph },
    title: titel,
    sections: [{
      id: 'tone', title: 'TONE', cols: 4,
      controls: KNOEPFE.map((k) => ({ id: `c${k.nr}`, type: 'knob', label: k.name, bind: { param: `k${k.nr}` }, format: k.format, ...('unit' in k ? { unit: k.unit } : {}), default: k.vorgabe })),
    }],
  };
}

// ---- the store (C-D2) ----
//   <store>/<cut id>/ton-<n>.json         the tone itself, written last: a tone exists only with this file
//   <graph folder>/ton-<k>-<n>.json       the generated device (tonGraph), made first by a hard link so that the name is reserved
//   <graph folder>/panels/ton-<k>-<n>.json its panel
// Refusals (SchnittFehler) leave every folder as it was; a write that fails midway removes what was written.

export type Ton = {
  schema: 1; graph: string; schnitt_id: string; nr: number; name: string; scheiben: [number, number]; a: number; b: number; grund: number;
  grund_quelle: 'erkannt' | 'tonart' | 'vorgabe' | 'hand'; erkannt: Erkannt; erstellt: string;
};

const NAME_MAX = 60;
const NR_MAX = 99;
const GRUND_MIN = 16, GRUND_MAX = 95;   // MIDI notes of the block's `grund` range 20..2000 Hz
const arg = (text: string): SchnittFehler => new SchnittFehler(400, 'argument_ungueltig', text);
const json = (x: unknown): string => `${JSON.stringify(x, null, 2)}\n`;
const tmpName = (datei: string): string => `${datei}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;

const einsFile = (datei: string, inhalt: string): void => {
  pruefeBkSchreiben(datei);
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  const tmp = tmpName(datei);
  try { fs.writeFileSync(tmp, inhalt); fs.renameSync(tmp, datei); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
};
/** Writes `datei` only when it does not exist (temp file plus hard link, which fails with EEXIST): false when the name is taken. */
const neuFile = (datei: string, inhalt: string): boolean => {
  pruefeBkSchreiben(datei);
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  const tmp = tmpName(datei);
  try { fs.writeFileSync(tmp, inhalt); fs.linkSync(tmp, datei); return true; } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw e;
  } finally { fs.rmSync(tmp, { force: true }); }
};

const speicher = (o: Ordner): string => o.ordner ?? samplerOrdner();
const bkOrdner = (o: Ordner): string => o.bk ?? graphenOrdner();
const dateien = (t: { graph: string; schnitt_id: string; nr: number }, o: Ordner): { graph: string; panel: string; ton: string } => ({
  graph: path.join(bkOrdner(o), `${t.graph}.json`), panel: path.join(bkOrdner(o), 'panels', `${t.graph}.json`), ton: path.join(speicher(o), t.schnitt_id, `ton-${t.nr}.json`),
});
const datenVon = (t: Ton): TonDaten => ({ graph: t.graph, schnitt_id: t.schnitt_id, name: t.name, a: t.a, b: t.b, grund: t.grund });
const grundOk = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= GRUND_MIN && n <= GRUND_MAX;
const entferne = (...pfade: string[]): void => { for (const p of pfade) { try { fs.rmSync(p, { force: true }); } catch { /* the original error is the one to report */ } } };

/** The frames [a, b) of the cut audio `smp-<id>.f32` (stereo float32, interleaved), read directly. */
function leseRegion(id: string, a: number, b: number, o: Ordner): Float32Array {
  const datei = path.join(bkOrdner(o), 'samples', `${geraetName(id)}.f32`);
  let fd: number;
  try { fd = fs.openSync(datei, 'r'); } catch { throw new SchnittFehler(404, 'schnitt_unbekannt', `the audio of cut ${id} is missing`); }
  try {
    const buf = Buffer.alloc((b - a) * 8);
    const gelesen = fs.readSync(fd, buf, 0, buf.length, a * 8);
    if (gelesen < buf.length) throw new SchnittFehler(404, 'schnitt_unbekannt', `the audio of cut ${id} is shorter than its slice table`);
    return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  } finally { fs.closeSync(fd); }
}

const scheibenNummer = ([von, bis]: [number, number]): string => (von === bis ? `${von + 1}` : `${von + 1}-${bis + 1}`);
/** The name a tone gets when the caller gives none: the cut name and the slice numbers (people count from 1). */
const standardName = (schnittName: string, scheiben: [number, number]): string => {
  const nummer = scheibenNummer(scheiben);
  return `${schnittName.slice(0, NAME_MAX - 3 - nummer.length).trimEnd()} · ${nummer}`;
};

/** The tone as the cut stands now. A tone keeps the frames `a`..`b` it was made from, so its sound never changes; the slice numbers of its text and of a default
 *  name follow the bounds of the cut as it is now (marker edits and CUT AGAIN renumber the slices). When `a` and `b` are no bounds of the cut any more, the
 *  numbers stay as they were stored and `tonText` says so. A name the caller gave is kept. */
export function tonNachSchnitt(t: Ton, s: Schnitt | null | undefined): Ton {
  const j = scheibenJetzt(t, s);
  if (j === null || (j[0] === t.scheiben[0] && j[1] === t.scheiben[1])) return t;
  const eigen = s !== null && s !== undefined && t.name !== standardName(s.name, t.scheiben);
  return { ...t, scheiben: j, name: eigen || s === null || s === undefined ? t.name : standardName(s.name, j) };
}
/** The slices (0-based, first and last) whose bounds are exactly `a` and `b` in the cut; null when there is no such run (or no cut). */
function scheibenJetzt(t: Ton, s: Schnitt | null | undefined): [number, number] | null {
  if (!s) return null;
  const von = s.grenzen.indexOf(t.a), ende = s.grenzen.indexOf(t.b);
  return von >= 0 && ende > von ? [von, ende - 1] : null;
}

/** Makes a tone of the slices `von`..`bis` (0-based, neighbours, default `bis` = `von`) of a cut: reads the region, detects the pitch, writes graph, panel and tone
 *  file. The root `grund` (MIDI note 16..95) is taken as given (`grund_quelle` 'hand') or proposed from the detection, the key of the cut or the default C3.
 *  Reason codes: schnitt_unbekannt 404, argument_ungueltig 400, toene_voll 409. */
export function legeTon(a: { schnitt_id: string; von: number; bis?: number; grund?: number; name?: string }, o: Ordner = {}): Ton {
  const s = liesSchnitt(a.schnitt_id, o);
  if (!s) throw new SchnittFehler(404, 'schnitt_unbekannt', `cut ${String(a.schnitt_id)} does not exist`);
  const n = s.grenzen.length - 1;
  const von = a.von, bis = a.bis ?? a.von;
  if (typeof von !== 'number' || !Number.isInteger(von) || von < 0 || von >= n) throw arg(`von: a slice number 0..${n - 1} expected`);
  if (typeof bis !== 'number' || !Number.isInteger(bis) || bis < von || bis >= n) throw arg(`bis: a slice number ${von}..${n - 1} expected`);
  if (a.grund !== undefined && !grundOk(a.grund)) throw arg(`grund: a MIDI note, a whole number ${GRUND_MIN}..${GRUND_MAX}, expected`);
  if (a.name !== undefined && (typeof a.name !== 'string' || a.name.trim() === '' || a.name.trim().length > NAME_MAX)) throw arg(`name: a text of 1..${NAME_MAX} characters expected`);
  const fa = s.grenzen[von], fb = s.grenzen[bis + 1];
  const erkannt = erkenneGrundton(leseRegion(s.id, fa, fb, o), 0, fb - fa);
  const vorschlag = a.grund !== undefined ? { note: a.grund, quelle: 'hand' as const } : grundVorschlag(erkannt, s.tonart);
  const name = a.name?.trim() ?? standardName(s.name, [von, bis]);
  const store = speicher(o), bk = bkOrdner(o);
  let t: Ton | null = null;
  for (let nr = 1; nr <= NR_MAX && t === null; nr++) {
    const graph = tonGraphName(s.id, nr);
    if (!GRAPH_NAME.test(graph) || fs.existsSync(path.join(store, s.id, `ton-${nr}.json`)) || fs.existsSync(path.join(bk, `${graph}.json`))) continue;
    const kandidat: Ton = { schema: 1, graph, schnitt_id: s.id, nr, name, scheiben: [von, bis], a: fa, b: fb, grund: vorschlag.note, grund_quelle: vorschlag.quelle, erkannt,
      erstellt: new Date().toISOString() };
    const f = dateien(kandidat, o);
    if (!neuFile(f.graph, json(tonGraph(datenVon(kandidat))))) continue;   // the name was taken meanwhile: the next number
    try {
      einsFile(f.panel, json(tonPanel(datenVon(kandidat))));
      einsFile(f.ton, json(kandidat));
    } catch (e) { entferne(f.graph, f.panel, f.ton); throw e; }
    t = kandidat;
  }
  if (t === null) throw new SchnittFehler(409, 'toene_voll', `cut ${s.id} already has ${NR_MAX} tones`);
  return t;
}

/** One tone by cut id and number; null when it is unknown or its file is unreadable or not a tone of that cut. */
export function liesTon(schnittId: string, nr: number, o: Ordner = {}): Ton | null {
  if (typeof schnittId !== 'string' || !SCHNITT_ID.test(schnittId) || !Number.isInteger(nr) || nr < 1 || nr > NR_MAX) return null;
  try {
    const t = JSON.parse(fs.readFileSync(path.join(speicher(o), schnittId, `ton-${nr}.json`), 'utf8')) as Ton;
    return t !== null && typeof t === 'object' && t.schema === 1 && t.schnitt_id === schnittId && t.nr === nr && t.graph === tonGraphName(schnittId, nr) ? t : null;
  } catch { return null; }
}

/** The tone whose device graph is `graph` (`ton-<k>-<n>`); the cut is the folder named `k` or one whose id shortens to `k`. null when none claims that graph. */
export function liesTonVonGraph(graph: string, o: Ordner = {}): Ton | null {
  const m = typeof graph === 'string' ? /^ton-(.+)-(\d{1,2})$/.exec(graph) : null;
  if (!m) return null;
  let namen: string[] = [];
  try { namen = fs.readdirSync(speicher(o)); } catch { return null; }
  for (const id of namen.sort()) {
    if (!SCHNITT_ID.test(id) || tonKurz(id) !== m[1]) continue;
    const t = liesTon(id, Number(m[2]), o);
    if (t && t.graph === graph) return t;
  }
  return null;
}

/** Every readable tone of a cut, by number. */
export function listeToene(schnittId: string, o: Ordner = {}): Ton[] {
  if (typeof schnittId !== 'string' || !SCHNITT_ID.test(schnittId)) return [];
  let namen: string[] = [];
  try { namen = fs.readdirSync(path.join(speicher(o), schnittId)); } catch { return []; }
  const aus: Ton[] = [];
  for (const n of namen) {
    const m = /^ton-(\d{1,2})\.json$/.exec(n);
    const t = m ? liesTon(schnittId, Number(m[1]), o) : null;
    if (t) aus.push(t);
  }
  return aus.sort((x, y) => x.nr - y.nr);
}

/** A new root for a tone: rewrites the graph (only `grund` changes) and then the tone file (`grund_quelle` 'hand'). The panel stays. 404 ton_unbekannt,
 *  400 argument_ungueltig (not a whole number 16..95). Returns the new tone. */
export function setzeGrund(graph: string, note: number, o: Ordner = {}): Ton {
  if (!grundOk(note)) throw arg(`grund: a MIDI note, a whole number ${GRUND_MIN}..${GRUND_MAX}, expected`);
  const alt = liesTonVonGraph(graph, o);
  if (!alt) throw new SchnittFehler(404, 'ton_unbekannt', `tone ${String(graph)} does not exist`);
  const neu: Ton = { ...alt, grund: note, grund_quelle: 'hand' };
  const f = dateien(neu, o);
  einsFile(f.graph, json(tonGraph(datenVon(neu))));
  try { einsFile(f.ton, json(neu)); } catch (e) {
    try { einsFile(f.graph, json(tonGraph(datenVon(alt)))); } catch { /* the original error is the one to report */ }
    throw e;
  }
  return neu;
}

/** Removes graph, panel and tone file of one tone (the tone file last). 404 ton_unbekannt. Whether a track still plays it is the caller's check. */
export function loescheTon(graph: string, o: Ordner = {}): void {
  const t = liesTonVonGraph(graph, o);
  if (!t) throw new SchnittFehler(404, 'ton_unbekannt', `tone ${String(graph)} does not exist`);
  const f = dateien(t, o);
  fs.rmSync(f.graph, { force: true });
  fs.rmSync(f.panel, { force: true });
  fs.rmSync(f.ton, { force: true });
}

/** Removes every tone of a cut (graph, panel and tone file each); returns the graph names removed. */
export function loescheToeneVon(schnittId: string, o: Ordner = {}): string[] {
  const aus: string[] = [];
  for (const t of listeToene(schnittId, o)) { loescheTon(t.graph, o); aus.push(t.graph); }
  return aus;
}

const QUELLE_TEXT = { erkannt: 'from detection', vorgabe: 'default', hand: 'set by hand' } as const;
/** The tone as one line (C-D10). `tonart` is the key of the cut, shown when the root came from it. */
export function tonText(t: Ton, tonart?: string, schnitt?: Schnitt | null): string {
  const quelle = t.grund_quelle === 'tonart' ? `from the key${tonart ? ` ${tonart}` : ''}` : QUELLE_TEXT[t.grund_quelle];
  const jetzt = tonNachSchnitt(t, schnitt);
  const ort = schnitt && scheibenJetzt(t, schnitt) === null ? `frames ${t.a}-${t.b} (no slice bounds of the cut any more)` : `slices ${scheibenNummer(jetzt.scheiben)}`;
  return `tone ${t.graph} "${jetzt.name}"  cut ${t.schnitt_id}  ${ort}  root ${notenName(t.grund)} (note ${t.grund}, ${quelle})`
    + `  detected ${t.erkannt.note === null ? 'none' : notenName(t.erkannt.note)}  confidence ${t.erkannt.konfidenz.toFixed(2)}`;
}

/** The category text of a tone graph in the device list: `Tone · <name> · root <note>`, 'Tone from a cut' when no tone claims the graph. */
export function tonKategorieText(graph: string, o: Ordner = {}): string {
  const t = liesTonVonGraph(graph, o);
  const text = t ? `Tone · ${t.name} · root ${notenName(t.grund)}` : '';
  return text !== '' && text.length <= 90 ? text : 'Tone from a cut';
}
