// Workbench helpers for sends, effects and the small rotary control (the MIX view of stage 1 is gone: its cards live in dock.js, its big view in window.js).
// Nothing here is a model of its own. An FX slot is a return of the project (return_neu / return_aendern / return_loeschen: the Cypher Hall of the
// return, or a Baukasten effect graph on its insert chain), a send knob is send_setzen, a rack stage is an insert of the return's strip. PRODUCTION shows
// the same returns and sends in its mixer; both views edit one project.
// Pure helpers (tested in tests/werkbank_mix.test.mjs). The knob, the send taper and the stage lists live in ../dock/.
import { MAX_RETURNS } from '../production/limits.js';
import { frei, ARTEN } from '../production/inserts.js';
import { DOCK_TEXT } from '../dock/dock.js';

export const MIX_TEXT = {
  master: 'MASTER', neu: DOCK_TEXT.neuEffekt, voll: `The rack holds ${MAX_RETURNS} effects`,
  weg: DOCK_TEXT.wegFrage,
};
const BUCHSTABEN = 'ABCDEFGH';

/** The channel strips of the instrument tracks, by track number, with the letters of the track list. */
export function mixZuege(p) {
  return (p?.spuren ?? []).filter((s) => s.art === 'instrument').sort((a, b) => a.nr - b.nr)
    .map((s, i) => ({ id: s.id, nr: s.nr, buchstabe: i < BUCHSTABEN.length ? BUCHSTABEN[i] : String(s.nr), name: s.name, farbe: s.farbe ?? '' }));
}

// The quick entries of "+ EFFECT". A graph entry makes an effect return (Hall off, the graph as its first stage); `werte` sets a mix knob to fully wet,
// because a return adds to the dry track.
const SCHNELL = [
  { text: 'Hall', name: 'Hall' },
  { text: 'Echo (tempo delay)', name: 'Echo', graph: 'fx-delay-sync' },
  { text: 'Phaser', name: 'Phaser', graph: 'fx-phaser', werte: { k3: 1 } },
  { text: 'Flanger', name: 'Flanger', graph: 'fx-flanger' },
  { text: 'Spring reverb', name: 'Spring', graph: 'fx-federhall' },
];
const fxName = (graph) => { const t = String(graph).replace(/^fx-/, '').replace(/-/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };
/** The entries of "+ EFFECT": [{gruppe: true, text} | {text, befehl | null, grund?}]. befehl is null with the reason when the rack is full or (for a
 *  graph) no Baukasten effect stage is free in the project. */
export function fxMenue(p, graphen) {
  const voll = (p?.returns?.length ?? 0) >= MAX_RETURNS, bkFrei = frei(p, 'bk') > 0;
  const effekte = (graphen ?? []).filter((g) => g?.art === 'effekt' && typeof g.name === 'string').map((g) => g.name);
  const eintrag = (text, name, graph, werte) => {
    if (voll) return { text, befehl: null, grund: MIX_TEXT.voll };
    if (graph && !bkFrei) return { text, befehl: null, grund: ARTEN.bk.voll };
    return { text, befehl: { befehl: 'return_neu', name, ...(graph ? { effekt: { graph, ...(werte ? { werte } : {}) } } : {}) } };
  };
  const schnell = SCHNELL.filter((e) => !e.graph || effekte.includes(e.graph));
  const rest = effekte.filter((g) => !SCHNELL.some((e) => e.graph === g));
  return [
    ...schnell.map((e) => eintrag(e.text, e.name, e.graph, e.werte)),
    ...(rest.length ? [{ gruppe: true, text: 'All effects' }] : []),
    ...rest.map((g) => eintrag(g, fxName(g), g)),
  ];
}
