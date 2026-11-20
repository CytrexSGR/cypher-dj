// Device faces: the shared frame. One floating overlay (`.p-face`) per document, closed by its button, by Esc or by opening the same face again; a frame loop that
// exists only while a face with a `live` function is open and runs through a scheduler seam a test can count; and the knob plate of a face, built from a table
// of parameters in real units (baueReglerPlatte). A closed face costs nothing: no listener, no scheduled callback.
import { baueFrontplatte } from '../panel.js';
import { skaliere, entskaliere } from '../panel_skala.js';

const offene = new WeakMap();   // wurzel (document) -> {id, el, schliesse, aktualisiere}

/** The scheduler seam of the frame loop: the default is the browser's frame callback; a test passes a counting double. */
export const STANDARD_TAKT = { an: (fn) => globalThis.requestAnimationFrame(fn), aus: (h) => globalThis.cancelAnimationFrame(h) };

export const offenesFace = (wurzel = globalThis.document) => { const o = offene.get(wurzel); return o ? { id: o.id, el: o.el } : null; };
export function schliesseFace(wurzel = globalThis.document) { offene.get(wurzel)?.schliesse(); }

/** Opens the face `id` and returns {el, schliesse(), aktualisiere()}; null when the same id was open (it is closed now). Another face that is open closes first.
 *  bauen(inhalt, steuer) builds the face into `inhalt` and may put header controls into `steuer`; it returns {aktualisiere(), zerstoere?()}.
 *  live(jetzt) -> boolean runs once per frame while the face is open (only when given) and says whether something changed; the builder redraws inside it.
 *  an: {get(), set(b)} gives the header an ON/OFF button. untertitel (extra): a second line of the title bar, e.g. the strip.
 *  einbetten (an element): the face is drawn INTO that element as a plain block (class p-face-eingebettet), not as the floating overlay: no close button, no Esc
 *  (the stage and strip windows, which are the face). The builder, the ON/OFF button and the frame loop are the same. */
export function oeffneFace({ id, titel, untertitel = '', akzent, an, bauen, live, wurzel = globalThis.document, takt = STANDARD_TAKT, einbetten = null }) {
  const alt = offene.get(wurzel);
  if (alt) { const gleich = alt.id === id; alt.schliesse(); if (gleich) return null; }
  const d = wurzel;
  const mk = (tag, klasse, text) => { const e = d.createElement(tag); e.setAttribute('class', klasse); if (text !== undefined) e.textContent = text; return e; };
  const el = mk('div', einbetten ? 'p-face p-face-eingebettet' : 'p-face');
  el.dataset.face = id;
  el.setAttribute('role', einbetten ? 'group' : 'dialog');
  el.setAttribute('aria-label', `${titel}${untertitel ? ` ${untertitel}` : ''}`);
  if (akzent) el.dataset.akzent = akzent;
  const zu = mk('button', 'p-face-zu', '✕');
  zu.type = 'button'; zu.setAttribute('aria-label', `Close the ${titel.toLowerCase()} face`); zu.title = 'Close (Esc)';
  const kopf = mk('div', 'p-face-kopf');
  const name = mk('b', 'p-face-titel', titel);
  kopf.append(name);
  if (untertitel) kopf.append(mk('span', 'p-face-ort', untertitel));
  const steuer = mk('span', 'p-face-steuer');
  let anKnopf = null;
  if (an) {
    anKnopf = mk('button', 'p-face-an', 'ON');
    anKnopf.type = 'button';
    anKnopf.setAttribute('aria-label', `Bypass the ${titel.toLowerCase()}`);
    anKnopf.addEventListener('click', () => { an.set(!an.get()); zeigeAn(); });
    steuer.append(anKnopf);
  }
  kopf.append(steuer);
  const inhalt = mk('div', 'p-face-inhalt');
  if (einbetten) el.append(kopf, inhalt); else el.append(zu, kopf, inhalt);
  const zeigeAn = () => {
    if (!anKnopf) return;
    const on = an.get() !== false;
    anKnopf.setAttribute('aria-pressed', String(on));
    anKnopf.classList.toggle('an', on);
    anKnopf.textContent = on ? 'ON' : 'OFF';
  };
  zeigeAn();
  let offen = true, handle = null, baustein = null;
  const taste = (e) => {
    if (e.key !== 'Escape') return;
    // the face is the topmost overlay: one Esc closes it and goes no further, the next Esc reaches whatever lies below (the plug-in panel)
    e.stopImmediatePropagation?.();
    schliesse();
  };
  const schliesse = () => {
    if (!offen) return;
    offen = false;
    wurzel.removeEventListener('keydown', taste, true);
    if (handle !== null) { takt.aus(handle); handle = null; }
    try { baustein?.zerstoere?.(); } catch (e) { globalThis.console?.error?.('face zerstoere:', e); }
    baustein = null;
    el.remove();
    if (offene.get(wurzel)?.el === el) offene.delete(wurzel);
  };
  const aktualisiere = () => { if (!offen) return; zeigeAn(); baustein?.aktualisiere?.(); };
  zu.addEventListener('click', schliesse);
  if (!einbetten) wurzel.addEventListener('keydown', taste, true);
  const o = { id, el, schliesse, aktualisiere };
  offene.set(wurzel, o);
  (einbetten ?? wurzel.body ?? globalThis.document.body).append(el);
  try { baustein = bauen(inhalt, steuer); } catch (e) { schliesse(); throw e; }
  if (live) {
    const tick = (jetzt) => {
      handle = null;
      if (!offen) return;
      try { live(jetzt ?? globalThis.performance?.now?.() ?? Date.now()); } catch (e) { globalThis.console?.error?.('face live:', e); }
      if (offen) handle = takt.an(tick);
    };
    handle = takt.an(tick);
  }
  return o;
}

const klemmeBereich = (b) => ({ min: b.min, max: b.max, log: !!b.log });

/** A front plate from a table of parameters in REAL units. abschnitte: [{id, titel?, cols, steuer: [{param, typ: 'knob' | 'selector' | 'switch', label, optionen?}]}];
 *  parameter: {name: {name, label, min, max, log?, einheit, vorgabe}}; adapter: {get(param) -> real, set(param, real), gesperrt?(param), ende?()}. The knobs are
 *  baueFrontplatte's; this converts between the knob position and the real value with skaliere / entskaliere and gives the readouts the table. A selector or switch
 *  carries its option index as the real value (0..n-1; a switch 0 or 1). */
export function baueReglerPlatte(host, { titel = '', abschnitte, parameter, adapter, akzent, dokument }) {
  const art = (s) => parameter[s.param];
  const diskret = (s) => s.typ === 'selector' ? (s.optionen ?? []).length : s.typ === 'switch' ? 2 : 0;
  const bereich = (p) => klemmeBereich(parameter[p]);
  const steuerung = new Map();
  for (const a of abschnitte) for (const s of a.steuer) steuerung.set(s.param, s);
  const nachK = (p, w) => {
    const s = steuerung.get(p), n = diskret(s);
    if (n) return n <= 1 ? 0 : Math.min(1, Math.max(0, Math.round(w) / (n - 1)));
    return entskaliere(w, bereich(p));
  };
  const nachWert = (p, k) => {
    const s = steuerung.get(p), n = diskret(s);
    if (n) return Math.round(Math.min(1, Math.max(0, k)) * (n - 1));
    return skaliere(k, bereich(p));
  };
  const panel = {
    format: 'cypherdj-panel/2', title: titel, ...(akzent ? { akzent } : {}),
    sections: abschnitte.map((a) => ({
      id: a.id, ...(a.titel ? { title: a.titel } : {}), cols: a.cols,
      controls: a.steuer.map((s) => ({
        id: `c-${a.id}-${s.param}`.replace(/[^a-z0-9_-]/gi, '_'), type: s.typ, label: s.label, bind: { param: s.param },
        ...(s.typ === 'selector' ? { options: s.optionen } : {}),
        default: nachK(s.param, art(s).vorgabe),
      })),
    })),
  };
  const ableseTabelle = Object.fromEntries(Object.entries(parameter).map(([k, p]) => {
    const st = steuerung.get(k);
    return [k, { ...p, ...(st && diskret(st) ? { stufen: st.optionen ?? ['OFF', 'ON'] } : {}) }];
  }));
  const platteAdapter = {
    get: (p) => { const w = adapter.get(p); return typeof w === 'number' && Number.isFinite(w) ? nachK(p, w) : undefined; },
    set: (p, k) => adapter.set(p, nachWert(p, k)),
    ...(adapter.gesperrt ? { gesperrt: (p) => adapter.gesperrt(p) === true } : {}),
    ...(adapter.ende ? { ende: () => adapter.ende() } : {}),
  };
  const platte = baueFrontplatte(host, { panel, regler: {}, parameter: ableseTabelle, adapter: platteAdapter, ...(dokument ? { dokument } : {}) });
  // exposed for the tests of the conversion: the same two mappings the plate uses
  platte.nachK = nachK; platte.nachWert = nachWert;
  return platte;
}
