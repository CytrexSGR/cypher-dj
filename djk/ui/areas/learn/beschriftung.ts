// What a graph knob is called: the knob name of the graph loaded on its channel (graphs.ts regler_namen). Shared by the learn Bereich (the name
// a controller display shows) and the register (readable targets in the Controllers window).
// A knob of a Baukasten track of the open project, spur/<slot>/bk/<k>, is named by the graph of the slot's track (the n-th Baukasten track, bkSlot)
// and carries the track name.
import type { BereichKontext } from '../../http/router.ts';
import { findeGraph } from '../../graphs.ts';
import { bkSlot, type Spur } from '../../project/model.ts';

type Kontext = Pick<BereichKontext, 'baukasten' | 'projekt'>;
const SPUR_KNOPF = /^spur\/([1-9][0-9]*)\/bk\/(\d+)$/;

/** The Baukasten track of the open project that sits on `slot` (1 = the lowest track number among the tracks with the device bk), or null. */
export function spurVonSlot(ctx: Pick<BereichKontext, 'projekt'>, slot: number): Spur | null {
  let projekt = null;
  try { projekt = ctx.projekt?.() ?? null; } catch { /* no project known */ }
  return projekt?.spuren.find((s) => bkSlot(projekt, s.id) === slot) ?? null;
}

const graphKnopf = (graph: string, nr: string): string | null => (graph ? findeGraph(graph)?.regler_namen?.[nr] : undefined) || null;

/** The knob name and track name of a spur/<slot>/bk/<k> path, or null (not such a path, no project, no such slot, no graph or name). */
function spurKnopf(ctx: Kontext, pfad: string): { knopf: string; spur: string } | null {
  const m = SPUR_KNOPF.exec(pfad);
  if (!m) return null;
  const spur = spurVonSlot(ctx, Number(m[1]));
  const g = spur?.geraet;
  const knopf = spur && g?.art === 'intern' && g.name === 'bk' ? graphKnopf(g.graph, m[2]) : null;
  return spur && knopf ? { knopf, spur: spur.name } : null;
}

/** The graph name and knob number a Baukasten knob path points at (<channel>/bk/<n> via the graph loaded on the channel, spur/<slot>/bk/<k> via the slot's track), or null. */
export function graphUndKnopf(ctx: Kontext, pfad: string): { graph: string; knopf: string } | null {
  const sm = SPUR_KNOPF.exec(pfad);
  if (sm) {
    const g = spurVonSlot(ctx, Number(sm[1]))?.geraet;
    return g?.art === 'intern' && g.name === 'bk' && g.graph ? { graph: g.graph, knopf: sm[2] } : null;
  }
  const m = /^(.+)\/bk\/(\d+)$/.exec(pfad);
  if (!m) return null;
  let graph = '';
  try { graph = ctx.baukasten?.geladen()[m[1]] ?? ''; } catch { /* no graph known */ }
  return graph ? { graph, knopf: m[2] } : null;
}

/**
 * The knob name of `pfad` (<kanal>/bk/<n>) from the graph loaded on that channel; null for any other path or when no graph or name is known.
 * For spur/<slot>/bk/<k>: "<knob name> (<track name>)" from the project track on that slot.
 */
export function knopfName(ctx: Kontext, pfad: string): string | null {
  const s = spurKnopf(ctx, pfad);
  if (s) return `${s.knopf} (${s.spur})`;
  if (SPUR_KNOPF.test(pfad)) return null;
  const m = /^(.+)\/bk\/(\d+)$/.exec(pfad);
  if (!m) return null;
  let graph = '';
  try { graph = ctx.baukasten?.geladen()[m[1]] ?? ''; } catch { /* no graph known */ }
  return graphKnopf(graph, m[2]);
}

/** What a learned target is called on a controller display: "<channel> <knob name>" for a graph knob with a name ("<track name> <knob name>" for a track knob), else the path. */
export function beschriftung(ctx: Kontext, pfad: string): string {
  const s = spurKnopf(ctx, pfad);
  if (s) return `${s.spur} ${s.knopf}`;
  const n = knopfName(ctx, pfad);
  const m = /^(.+)\/bk\/\d+$/.exec(pfad);
  return n && m ? `${m[1]} ${n}` : pfad;
}
