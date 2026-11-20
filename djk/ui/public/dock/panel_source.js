// The panel source of a view: the graph list and the panel of a Baukasten effect, fetched once and kept.
import { bkZahl } from '../production/inserts.js';

/** The panel of a Baukasten effect that has no sidecar: sections of eight knobs (`KNOBS 1–8`, `KNOBS 9–16`, ...), bkZahl(reglerNamen) knobs, param k<n>. */
export function ersatzPanel(graph, reglerNamen, regler) {
  const n = bkZahl(reglerNamen), sections = [];
  for (let a = 1; a <= n; a += 8) {
    const b = Math.min(a + 7, n), controls = [];
    for (let k = a; k <= b; k++) {
      const v = regler?.[k]?.vorgabe;
      controls.push({ id: `k${k}`, type: 'knob', label: String(reglerNamen?.[k] || `K${k}`).slice(0, 24), bind: { param: `k${k}` }, default: typeof v === 'number' ? v : 0.5 });
    }
    sections.push({ id: `s${sections.length + 1}`, title: `KNOBS ${a}–${b}`, cols: Math.min(4, controls.length), controls });
  }
  return { format: 'cypherdj-panel/2', geraet: { art: 'bk', graph }, title: graph, akzent: 'orange', sections };
}

/** The graph list and the panel of a Baukasten effect, fetched once and kept: {graphen(neu?) -> Promise<list>, bekannt() -> list | null, panelVon(graph) ->
 *  Promise<{panel, regler}>}. A graph without a sidecar gets ersatzPanel. One instance per view (ctx.panelQuelle): the insert chain of a track and the FX
 *  rack of the MIX region (mix.js) share it. */
export function neuePanelQuelle(ctx) {
  let graphen = null;
  const cache = new Map();   // graph -> {panel, regler}
  // neu: read the list again (a menu that opens shows graphs built since the page was loaded)
  async function hole(neu = false) {
    if (graphen && !neu) return graphen;
    const r = await ctx.holeGet('/graphen');
    const l = r.status === 200 && Array.isArray(r.j?.graphen) ? r.j.graphen.filter((g) => g && typeof g.name === 'string') : [];
    if (r.status === 200) graphen = l;
    return r.status === 200 ? l : graphen ?? l;
  }
  async function panelVon(graph) {
    if (cache.has(graph)) return cache.get(graph);
    const r = await ctx.holeGet(`/graphen/panel?name=${encodeURIComponent(graph)}`);
    const regler = r.j?.regler ?? {};
    let aus = r.status === 200 && r.j?.panel ? { panel: r.j.panel, regler } : null;
    if (!aus) { const g = (await hole()).find((x) => x.name === graph); aus = { panel: ersatzPanel(graph, g?.regler_namen, regler), regler }; }
    if (r.status === 200) cache.set(graph, aus);
    return aus;
  }
  return { graphen: hole, bekannt: () => graphen, panelVon };
}
