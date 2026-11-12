// INSTRUMENTS area: one tab per instrument channel, below it the graph picker and the front panel (or the sliders) of the chosen one.
// Pure markup here; app.js supplies the knob binding (bindeBkKnobs), the picker fill (zeigeGraphWahl) and the loaded graphs (graphVon).
import { htmlText } from './effects.js';
import { geraeteknopfHtml } from './panel_kopf.js';

const LABEL = { 'erz/2': 'I2', 'erz/3': 'I3', 'erz/5': 'I5', 'erz/6': 'I6', 'erz/7': 'I7', 'pad/1': 'P1', 'pad/2': 'P2' };
/** Whether a learn path (<channel>/bk/<n>) belongs to channel k. */
export const lernPfadVon = (pfad, k) => typeof pfad === 'string' && pfad.startsWith(`${k}/bk/`);
export const instrumentLabel = (k) => LABEL[k] ?? k;

/** The body classes of the device page (the INSTRUMENTS element enlarged as a fixed layer): none while closed. PRODUCTION adds its own class because the narrow
 *  production browser hides the children of a collapsed library (panel.css lifts that for the open page). */
export function geraeteseiteKlasse(an, produktion) {
  return an ? (produktion ? ['geraeteseite', 'geraeteseite-produktion'] : ['geraeteseite']) : [];
}

/** kanaele = instrument channels in order, gewaehlt = chosen channel, geladen = channel -> loaded graph name, hosts = channel -> host name shown while no graph is loaded (erz/2, erz/3). */
export function instrumentReiterHtml(kanaele, gewaehlt, geladen = {}, hosts = {}, geraeteseite = false) {
  const tabs = kanaele.map((k) => {
    const an = k === gewaehlt;
    return `<button type="button" role="tab" class="${an ? 'an' : ''}" data-instrument="${htmlText(k)}" aria-selected="${an}">${htmlText(instrumentLabel(k))} · ${geladen[k] ? htmlText(geladen[k]) : hosts[k] ? htmlText(hosts[k]) : 'empty'}</button>`;
  }).join('');
  // while the device page is open the strip carries its closer: the page has an exit whatever the body shows (no plate, sliders, empty channel, host text)
  return `<div class="instrument-reiter" role="tablist" aria-label="Instrument channels">${tabs}${geraeteseite ? geraeteknopfHtml(true) : ''}</div>`
    + `<div class="instrument-koerper" data-kanal="${htmlText(gewaehlt)}"><div class="graphplatz" data-graphplatz="${htmlText(gewaehlt)}"></div><div class="bkliste"></div></div>`;
}

/** ctx = { kanaele, graphVon, hostNameVon?(k), bindeKnobs(d, k), zeigeGraphWahl(), beiWechsel?(alt, neu), wurzel?, dokument?, speicher? }. Returns { baue, neuBauen, aktualisiere, gewaehlt, waehle }.
 *  neuBauen() rebuilds at once, or after pointerup when a pointer is down inside the area (no teardown under a pointer capture). */
export function bindeInstrumente(ctx) {
  const wurzel = ctx.wurzel ?? document.querySelector('#instrumente');
  const dok = ctx.dokument ?? document;
  const speicher = ctx.speicher === undefined ? (() => { try { return localStorage; } catch { return null; } })() : ctx.speicher;
  let gewaehlt = ctx.kanaele[0];
  try { const s = speicher?.getItem('djk-instrument'); if (s && ctx.kanaele.includes(s)) gewaehlt = s; } catch { /* without storage: first channel */ }
  let gedrueckt = false, offen = false;
  const geladen = () => Object.fromEntries(ctx.kanaele.map((k) => [k, ctx.graphVon(k)?.name]).filter(([, n]) => n));
  function baue() {
    wurzel.innerHTML = instrumentReiterHtml(ctx.kanaele, gewaehlt, geladen(), Object.fromEntries(ctx.kanaele.map((k) => [k, ctx.hostNameVon?.(k)]).filter(([, n]) => n)), !!ctx.geraeteseite?.());
    const d = wurzel.querySelector('.instrument-koerper');
    if (d) ctx.bindeKnobs(d, gewaehlt);
    ctx.zeigeGraphWahl();
  }
  function neuBauen() { if (gedrueckt) offen = true; else baue(); }
  function waehle(k) {
    if (!ctx.kanaele.includes(k)) return;
    const alt = gewaehlt;
    gewaehlt = k;
    if (alt !== k) ctx.beiWechsel?.(alt, k);
    try { speicher?.setItem('djk-instrument', k); } catch { /* without storage: only now */ }
    neuBauen();
  }
  // Only a gesture that starts inside the knob area (.bkliste) is guarded. A native select popup swallows its pointerup, so a press on a picker must never set
  // the flag. A select's change also releases it. blur/focusout do not: the flag is knob-only now, and a knob drag that starts while a select still has focus
  // fires focusout right after its pointerdown.
  const frei = () => { gedrueckt = false; if (offen) { offen = false; baue(); } };
  wurzel.addEventListener('pointerdown', (e) => { if (e?.target?.closest?.('.bkliste')) gedrueckt = true; });
  dok.addEventListener('pointerup', frei);
  dok.addEventListener('pointercancel', frei);
  wurzel.addEventListener('change', (e) => { if (e?.target?.closest?.('select')) frei(); });
  wurzel.addEventListener('click', (e) => { const t = e.target.closest?.('[data-instrument]'); if (t) waehle(t.dataset.instrument); });
  return { baue, neuBauen, waehle, gewaehlt: () => gewaehlt, aktualisiere: () => wurzel.querySelector('.bkliste')?._fp?.aktualisiere() };
}
