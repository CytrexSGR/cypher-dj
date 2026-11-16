// Workbench SOUND helpers (stage 1 had a SOUND column here: its tiles are the cards of dock.js, its device area is the big view of window.js).
// What stays is the plumbing that several of them share:
//   - the panel source (ctx.panelQuelle): the graph list and the panel of a Baukasten effect, fetched once and kept;
//   - the floating faces of the native inserts and their stream readings (ctx.insertFaceOeffnen);
//   - the instrument exchange of a track (ctx.instrumentWechsel(spurId, anker): the menu of CHANGE);
//   - the sound host div[data-w="klang"] with the cut strip of a sampler track (schnitt_streifen.js, schnitt_tone.js) and the kit dialog (schnitt_kit.js).
//     The host is hidden and sits in the workbench root; the big view of an instrument track moves it into its window (window.js).
// UI texts English.
import { wechselBefehle } from '../seq_field.js';
import { instrumentMenue } from './tracks.js';
import { oeffneMenue } from '../production/context_menu.js';
import {
  ARTEN, MAX_PLAETZE, straenge, neuerInsertBefehl, bkZahl, insGrAufnehmen, insPegelAufnehmen,
} from '../production/inserts.js';
import { bindeInsertFace } from '../production/insert_face.js';
import { bindeSchnittStreifen } from './schnitt_streifen.js';
import { bindeSchnittTon } from './schnitt_tone.js';

export const KLANG_TEXT = { wechsel: '\u21c4 CHANGE', wechselTitel: 'Change the instrument of this track; the notes stay' };

export function bindeKlang(ctx) {
  const { st, $ } = ctx;
  const host = $('klang');
  host.innerHTML = '<div class="w-schnitt" data-w="schnitt" hidden></div>';
  ctx.klangHost = host;
  const gr = {}, pegel = {};   // the readings of /e/ins_gr and /e/stufe_pegel, read by an open device face
  const faces = bindeInsertFace(ctx, () => gr, () => pegel);
  ctx.insertFaceOeffnen = (strang, insert) => faces.oeffne(strang, insert);   // the dock and the big view open the floating faces of the native stages
  ctx.panelQuelle ??= neuePanelQuelle(ctx);
  ctx.beimEreignis.push((a, f) => {
    if (a === '/e/ins_gr') insGrAufnehmen(gr, f, performance.now());
    else if (a === '/e/stufe_pegel') insPegelAufnehmen(pegel, f, performance.now());
  });
  const spurVon = (id) => (st.projekt?.spuren ?? []).find((s) => s.id === id && s.art === 'instrument') ?? null;

  // Instrument exchange (the SEQ deck's wechselBefehle): the notes of the pattern clip stay; knob lanes the new device does not have go after a question.
  ctx.instrumentWechsel = async (spurId, anker) => {
    const spur = spurVon(spurId); if (!spur) return;
    const r = anker.getBoundingClientRect();
    const [g, kits] = await Promise.all([ctx.holeGet('/graphen'), ctx.holeGet('/proj/kits')]);
    const alt = spur.geraet;
    const punkte = instrumentMenue(g?.j?.graphen, kits?.j?.kits, alt?.art === 'intern' && alt.name === 'bk' ? alt.graph : undefined, (e) => tausche(spur.id, e));
    (ctx.oeffneMenue ?? oeffneMenue)(punkte, r.left, r.bottom);
  };
  async function tausche(id, eintrag) {
    const spur = spurVon(id); if (!spur) return;
    const clip = (spur.clips ?? []).find((c) => c.art === 'midi') ?? null;
    const w = wechselBefehle(spur, clip, eintrag.geraet, ctx.info?.(spur) ?? null);
    if (w.meldung) { ctx.melde(w.meldung, true); return; }
    if (!w.befehle.length) return;
    if (w.frage && !(await ctx.frage(w.frage))) return;
    await ctx.aendere(`Instrument ${spur.name}: ${eintrag.text}`, w.befehle);
  }
  bindeSchnittStreifen(ctx, $('schnitt'));   // sampler A1 task 8: the strip of a sampler cut (shown for a slice track only)
  bindeSchnittTon(ctx, $('schnitt'));        // sampler C task 5: TO TONE on the strip, the ROOT box of a tone track (after the strip: it resets schnittAktionen)
}

// ---- the panel of an effect ----------------------------------------------------------------------------------------------------------------------

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

const KACHEL_TEXT = { komp: 'COMPRESSOR', eq: 'EQ', saett: 'SATURATION', lim: 'LIMITER', utility: 'UTILITY' };
/** The tile of one insert stage: { titel: 'EFFECT', text, an }. */
export function effektKachel(insert) {
  const text = insert.art === 'bk' ? String(insert.graph ?? 'EFFECT') : insert.art === 'host' ? String(insert.plugin?.name ?? 'PLUGIN') : KACHEL_TEXT[insert.art] ?? String(insert.art).toUpperCase();
  return { titel: 'EFFECT', text, an: insert.an !== false };
}

const PLUS_ARTEN = [['komp', 'Compressor'], ['eq', 'EQ'], ['saett', 'Saturator'], ['lim', 'Limiter']];
export const PLUS_VOLL_TEXT = `The strip holds ${MAX_PLAETZE} stages`;
/** The entries of the "+" menu: [{text, befehl | null, grund?}]; befehl is null (with the reason) when the strip is full or the pool of that kind is empty. */
export function plusEintraege(p, strangId, graphen) {
  const strang = straenge(p).find((s) => s.id === strangId);
  const voll = !strang || strang.inserts.length >= MAX_PLAETZE;
  const eintrag = (text, art, graph) => {
    const b = voll ? null : neuerInsertBefehl(p, strangId, art);
    if (!b) return { text, befehl: null, grund: voll ? PLUS_VOLL_TEXT : ARTEN[art].voll };
    return { text, befehl: art === 'bk' ? { ...b, graph } : b };
  };
  return [
    ...PLUS_ARTEN.map(([art, text]) => eintrag(text, art)),
    ...(graphen ?? []).filter((g) => g?.art === 'effekt' && typeof g.name === 'string').map((g) => eintrag(g.name, 'bk', g.name)),
  ];
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
