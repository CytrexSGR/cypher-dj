// Cypher Space: the user's own impulse response. A copy of the `fx-space` graph (name `space-<6 hex>`) whose convolution node `raum` reads a file written here
// (`space-ir-<8 hex>.f32`, raw stereo float32 at 48 kHz in `<graph folder>/samples`), and a panel copy that names the file. The route is areas/sampler/space_ir_routes.ts;
// the page swaps the stage to the copy (production). Orphans: the files are small (2 s stereo f32 = 768 KB); a later sweep of copies nothing uses belongs in
// sampler/waisen.ts, not here.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { graphenOrdner } from '../graphs.ts';
import { pfadeVon } from '../devices_parameter.ts';
import { pruefeBkSchreiben } from './bk_schutz.ts';
import { ersterTon, STILLE_SCHWELLE } from './file.ts';
import { SchnittFehler } from './schnitt.ts';

export const IR_NAME = /^space-[0-9a-f]{6}$/;
const SR = 48000;
/** The longest impulse response the node `raum` holds (`laenge_max` 2000 ms). */
export const IR_FRAMES_MAX = 2 * SR;
/** Fewer frames than this after the leading silence is cut are no room. */
export const IR_FRAMES_MIN = 64;
const AUSBLENDEN = Math.round(0.05 * SR);
/** The sum of squares per side of every shipped impulse response (and of a loaded one). */
export const IR_ENERGIE = 0.5;
export const IR_TITEL_MAX = 30;
const BASIS = 'fx-space';

type Graph = Record<string, unknown> & { knoten?: Record<string, unknown>[] };

/** Pure. Stereo interleaved float32 (48 kHz) to the impulse response: leading samples below STILLE_SCHWELLE dropped, cut to 2 s with a 50 ms cosine fade out when
 *  longer, each side scaled to a sum of squares of 0.5 (a side without energy copies the other). Throws SchnittFehler 422 `ir_zu_kurz` below 64 frames and
 *  `format_falsch` for silence. */
export function bereiteIrVor(roh: Float32Array): Float32Array {
  const start = ersterTon(roh);
  if (start < 0) throw new SchnittFehler(422, 'format_falsch', `the file is silent throughout (nothing above ${Math.round(20 * Math.log10(STILLE_SCHWELLE))} dBFS)`);
  const frames = Math.min((roh.length >> 1) - start, IR_FRAMES_MAX);
  if (frames < IR_FRAMES_MIN) throw new SchnittFehler(422, 'ir_zu_kurz', `only ${frames} frames after the leading silence: an impulse response needs at least ${IR_FRAMES_MIN}`);
  const aus = roh.slice(start * 2, (start + frames) * 2);
  if ((roh.length >> 1) - start > IR_FRAMES_MAX) {                       // cut off: fade the last 50 ms
    for (let i = 0; i < AUSBLENDEN; i++) {
      const g = 0.5 * (1 + Math.cos(Math.PI * (i + 1) / AUSBLENDEN)), f = frames - AUSBLENDEN + i;
      aus[2 * f] *= g; aus[2 * f + 1] *= g;
    }
  }
  const e = [0, 0];
  for (let i = 0; i < frames; i++) { e[0] += aus[2 * i] ** 2; e[1] += aus[2 * i + 1] ** 2; }
  if (e[0] <= 0 && e[1] <= 0) throw new SchnittFehler(422, 'format_falsch', 'the file is silent throughout');
  if (e[0] <= 1e-12) { for (let i = 0; i < frames; i++) aus[2 * i] = aus[2 * i + 1]; e[0] = e[1]; }
  else if (e[1] <= 1e-12) { for (let i = 0; i < frames; i++) aus[2 * i + 1] = aus[2 * i]; e[1] = e[0]; }
  const g = [Math.sqrt(IR_ENERGIE / e[0]), Math.sqrt(IR_ENERGIE / e[1])];
  for (let i = 0; i < frames; i++) { aus[2 * i] *= g[0]; aus[2 * i + 1] *= g[1]; }
  return aus;
}

/** Pure. The room label of a copy: "Room: " and the file title cut to 30 characters (a title of nothing is "file"). */
export const raumText = (titel: string): string => `Room: ${titel.trim().slice(0, IR_TITEL_MAX).trim() || 'file'}`;

/** Pure. A copy of the `fx-space` graph `basis` with `name` set and the `datei` of its node `raum` replaced. Throws when the base has no such node. */
export function spaceGraph(basis: object, datei: string, name: string): Record<string, unknown> {
  const g = JSON.parse(JSON.stringify(basis)) as Graph;
  const k = Array.isArray(g.knoten) ? g.knoten.find((x) => x.id === 'raum' && x.art === 'faltung') : undefined;
  if (!k) throw new Error('the base graph has no convolution node `raum`');
  k.datei = datei;
  g.name = name;
  return g;
}

/** Pure. The panel copy: `geraet.graph` = name, the title "Cypher Space" and the first text label (the room label) replaced by `Room: <titel>`. */
export function spacePanel(basis: object, name: string, titel: string): Record<string, unknown> {
  const p = JSON.parse(JSON.stringify(basis)) as { geraet?: Record<string, unknown>; sections?: { controls?: Record<string, unknown>[] }[]; title?: string };
  p.geraet = { ...(p.geraet ?? {}), art: 'bk', graph: name };
  p.title = 'Cypher Space';
  const l = (p.sections ?? []).flatMap((s) => s.controls ?? []).find((c) => c.type === 'label');
  if (l) l.text = raumText(titel);
  return p as Record<string, unknown>;
}

const jsonText = (x: unknown): string => `${JSON.stringify(x, null, 2)}\n`;
function schreibeDatei(datei: string, inhalt: Buffer | string): void {
  pruefeBkSchreiben(datei);
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  const tmp = `${datei}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, inhalt); fs.renameSync(tmp, datei); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
}
const lies = (kandidaten: string[]): Record<string, unknown> | null => {
  for (const p of kandidaten) {
    try { const x = JSON.parse(fs.readFileSync(p, 'utf8')); if (x && typeof x === 'object' && !Array.isArray(x)) return x as Record<string, unknown>; } catch { /* next */ }
  }
  return null;
};

/** A free copy name `space-<6 hex>` (no graph file of that name yet). */
export function neuerSpaceName(bk: string = graphenOrdner()): string {
  for (;;) {
    const n = `space-${crypto.randomBytes(3).toString('hex')}`;
    if (!fs.existsSync(path.join(bk, `${n}.json`))) return n;
  }
}

/** Writes the impulse response as a new file `space-ir-<8 hex>.f32` into `<bk>/samples`; returns the file name. */
export function schreibeIr(daten: Float32Array, bk: string = graphenOrdner()): string {
  for (;;) {
    const n = `space-ir-${crypto.randomBytes(4).toString('hex')}.f32`;
    const pfad = path.join(bk, 'samples', n);
    if (fs.existsSync(pfad)) continue;
    schreibeDatei(pfad, Buffer.from(daten.buffer, daten.byteOffset, daten.byteLength));
    return n;
  }
}

/** Writes graph and panel of the copy `name` (from the `fx-space` graph and panel of the graph folder or the repo). Returns what undoes it (graph and panel only). */
export function schreibeSpace(name: string, datei: string, titel: string, bk: string = graphenOrdner()): () => void {
  const basis = lies([path.join(bk, `${BASIS}.json`), path.join(pfadeVon().beispiele, `${BASIS}.json`)]);
  if (!basis) throw new Error(`the graph ${BASIS} cannot be read`);
  const panelBasis = lies([path.join(bk, 'panels', `${BASIS}.json`), path.join(pfadeVon().paneele, `${BASIS}.json`)]);
  const graph = path.join(bk, `${name}.json`), panel = path.join(bk, 'panels', `${name}.json`);
  const g = spaceGraph(basis, datei, name);
  schreibeDatei(graph, jsonText(g));
  try { if (panelBasis) schreibeDatei(panel, jsonText(spacePanel(panelBasis, name, titel))); } catch (e) { fs.rmSync(graph, { force: true }); throw e; }
  return () => { fs.rmSync(graph, { force: true }); fs.rmSync(panel, { force: true }); };
}
