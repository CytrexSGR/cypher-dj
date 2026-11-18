// EFFECTS channel tabs: MASTER (one light: INSERT), one tab per channel (lights for INSERT, COMP and GATE), plus SENDS and BUS. Only the chosen channel strip is shown;
// the strips stay in the DOM with all their handlers, a class hides the rest. The chosen tab is per viewer (localStorage, try/catch).
import { GRAPH_KANAL_ART } from './effects.js';
// This module touches no page module (they need a browser to load): the page state arrives through bindeFxReiter, the channel list is the
// one of FX_KANAELE (effects_gemeinsam.js:16; a test pins that the ids are equal).
export const FX_REITER = [{ id: 'master', text: 'MASTER' }].concat([['deck/1', 'A'], ['deck/2', 'B'], ['erz/1', 'DRUMS'], ['erz/2', 'BASS'], ['erz/3', 'MELODY'], ['erz/5', 'I5'], ['erz/6', 'I6'], ['erz/7', 'I7'],
  ['pad/1', 'L1'], ['pad/2', 'L2']].map(([id, text]) => ({ id, text })), [{ id: 'sends', text: 'SENDS' }, { id: 'bus', text: 'BUS' }]);
const $ = (q) => document.querySelector(q), $$ = (q) => [...document.querySelectorAll(q)];
let quelle = { regler: () => undefined, graph: () => null };
export function bindeFxReiter(q) { quelle = q; }
export const FX_REITER_SCHLUESSEL = 'djk-fx-reiter';
export function reiterWahl(gespeichert, vorgabe = 'erz/1') {
  return FX_REITER.some((r) => r.id === gespeichert) ? gespeichert : vorgabe;
}
// the three lights of a channel from the live control values (`>= 0.5` is "on", as the strips treat it) and the graph picker
export function fxLichter(regler, graphGewaehlt, k) {
  if (k === 'master') return { insert: !!graphGewaehlt(k), comp: false, gate: false };   // the master has no COMP/GATE stage
  return { insert: !!graphGewaehlt(k), comp: (regler?.[`${k}/komp/an`] ?? 0) >= 0.5, gate: (regler?.[`${k}/gate/an`] ?? 0) >= 0.5 };
}
let aktiv = null;
function lade() {
  try { return localStorage.getItem(FX_REITER_SCHLUESSEL); } catch { return null; }
}
export const fxReiterAktiv = () => (aktiv ??= reiterWahl(lade()));
// builds the tab row as the first child of the strip row; `waehle(k)` is called for a channel tab (the detail of the expanded mode follows it)
export function baueFxReiterZeile(reihe, waehle) {
  const zeile = document.createElement('div');
  zeile.className = 'fxreiter';
  zeile.setAttribute('role', 'tablist');
  for (const r of FX_REITER) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'fxreiter-tab'; b.dataset.reiter = r.id; b.setAttribute('role', 'tab');
    const kanal = r.id !== 'sends' && r.id !== 'bus' && r.id !== 'master';
    const licht = (n, t) => `<i class="licht licht-${n}" title="${t}"></i>`;
    b.innerHTML = `<span>${r.text}</span>${r.id === 'master' ? licht('insert', 'Graph on the master insert') : kanal ? licht('insert', 'Graph on the insert') + licht('comp', 'Compressor') + licht('gate', 'Gate') : ''}`;
    b.addEventListener('click', () => {
      aktiv = r.id;
      try { localStorage.setItem(FX_REITER_SCHLUESSEL, r.id); } catch { /* without storage the choice lives for this page load */ }
      if (kanal) waehle(r.id); else zeigeFxReiter();
    });
    zeile.append(b);
  }
  reihe.prepend(zeile);
}
// shows only the chosen strip and refreshes the lights
export function zeigeFxReiter() {
  const a = fxReiterAktiv();
  for (const s of $$('#fxstreifen > .fxstreifen')) s.classList.toggle('fx-aus', s.dataset.kanal !== a);
  $('#fxstreifen > .sendrueck')?.classList.toggle('fx-aus', a !== 'sends');
  $('#fxstreifen > .buspanel')?.classList.toggle('fx-aus', a !== 'bus');
  $('#fxstreifen > .masterpanel')?.classList.toggle('fx-aus', a !== 'master');
  for (const b of $$('#fxstreifen > .fxreiter .fxreiter-tab')) {
    const k = b.dataset.reiter, an = k === a;
    b.classList.toggle('an', an); b.setAttribute('aria-selected', String(an));
    if (k === 'sends' || k === 'bus') continue;
    const l = fxLichter(quelle.regler(), quelle.graph, k);
    for (const n of ['insert', 'comp', 'gate']) b.querySelector(`.licht-${n}`)?.classList.toggle('an', l[n]);
  }
}
// a channel chosen from outside (a click on a strip, the stored choice at start) selects its tab
export function waehleFxReiter(k) {
  aktiv = reiterWahl(k, fxReiterAktiv());
  try { localStorage.setItem(FX_REITER_SCHLUESSEL, aktiv); } catch { /* see above */ }
  zeigeFxReiter();
}
// the sections of a channel strip in signal order: the insert graph (only where a graph can go), gate, compressor, utility
export const fxGlieder = (k) => [...(GRAPH_KANAL_ART[k] ? ['insert'] : []), 'gate', 'comp', 'util'];
