// What a graph knob is called: the knob name of the graph loaded on its channel (graphs.ts regler_namen). Shared by the learn Bereich (the name
// a controller display shows) and the register (readable targets in the Controllers window).
import type { BereichKontext } from '../../http/router.ts';
import { findeGraph } from '../../graphs.ts';

/** The knob name of `pfad` (<kanal>/bk/<n>) from the graph loaded on that channel; null for any other path or when no graph or name is known. */
export function knopfName(ctx: Pick<BereichKontext, 'baukasten'>, pfad: string): string | null {
  const m = /^(.+)\/bk\/(\d+)$/.exec(pfad);
  if (!m) return null;
  let graph = '';
  try { graph = ctx.baukasten?.geladen()[m[1]] ?? ''; } catch { /* no graph known */ }
  return (graph ? findeGraph(graph)?.regler_namen?.[m[2]] : undefined) || null;
}

/** What a learned target is called on a controller display: "<channel> <knob name>" for a graph knob with a name, else the path. */
export function beschriftung(ctx: Pick<BereichKontext, 'baukasten'>, pfad: string): string {
  const n = knopfName(ctx, pfad);
  const m = /^(.+)\/bk\/\d+$/.exec(pfad);
  return n && m ? `${m[1]} ${n}` : pfad;
}
