// Workbench helpers for sends, effects and the small rotary control (the MIX view of stage 1 is gone: its cards live in dock.js, its big view in window.js).
// Nothing here is a model of its own. An FX slot is a return of the project (return_neu / return_aendern / return_loeschen: the Cypher Hall of the
// return, or a Baukasten effect graph on its insert chain), a send knob is send_setzen, a rack stage is an insert of the return's strip. PRODUCTION shows
// the same returns and sends in its mixer; both views edit one project.
// Pure helpers first (tested in tests/werkbank_mix.test.mjs), the knob widget below.
import { posVonDb, dbVonPos } from '../production/fader_curve.js';
import { MAX_RETURNS } from '../production/limits.js';
import { frei, ARTEN } from '../production/inserts.js';
import { effektKachel } from './sound.js';

export const MIX_TEXT = {
  master: 'MASTER', neu: '+ LOAD EFFECT', voll: `The rack holds ${MAX_RETURNS} effects`,
  weg: (name) => `Remove the effect ${name} from the rack? The sends into it go too (Undo brings both back).`,
};
const BUCHSTABEN = 'ABCDEFGH';

/** The channel strips of the instrument tracks, by track number, with the letters of the track list. */
export function mixZuege(p) {
  return (p?.spuren ?? []).filter((s) => s.art === 'instrument').sort((a, b) => a.nr - b.nr)
    .map((s, i) => ({ id: s.id, nr: s.nr, buchstabe: i < BUCHSTABEN.length ? BUCHSTABEN[i] : String(s.nr), name: s.name, farbe: s.farbe ?? '' }));
}

// A send knob travels 0..1 on the fader taper; the lowest twentieth is off (the page treats -60 dB and below as off everywhere).
export const sendPos = (db) => posVonDb(db);
export const sendDb = (pos) => { const db = dbVonPos(Math.min(1, Math.max(0, pos))); return db <= -60 ? -200 : db; };
export const sendText = (db) => (db <= -60 ? 'off' : `${db > 0 ? '+' : ''}${db.toFixed(1)}`);

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

/** The stages of a rack strip in chain order: the Hall first (shown while it is on, or while the return has no other stage), then the inserts.
 *  [{teil: 'hall' | <insert id>, text, an, art}] */
export function rackTeile(ret) {
  const inserts = ret?.inserts ?? [];
  const teile = [];
  if (ret?.hall?.an !== false || inserts.length === 0) teile.push({ teil: 'hall', text: 'HALL', an: ret?.hall?.an !== false, art: 'hall' });
  for (const i of inserts) { const k = effektKachel(i); teile.push({ teil: i.id, text: k.text, an: k.an, art: i.art }); }
  return teile;
}

/** The stages of the master strip: its inserts. [{teil: <insert id>, text, an, art}] */
export function masterTeile(p) {
  return (p?.master?.inserts ?? []).map((i) => { const k = effektKachel(i); return { teil: i.id, text: k.text, an: k.an, art: i.art }; });
}

// ---- the small rotary control ------------------------------------------------------------------------------------------------------------------
const mk = (tag, klasse, w, text) => {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (w) e.setAttribute('data-w', w);
  if (text !== undefined) e.textContent = text;
  return e;
};
export const WHEEL_MS = 300;   // a wheel gesture ends when the wheel has been quiet this long (the same as panel.js RAD_MS)

/** A rotary control: drag up/down (Shift = fine), wheel, arrow keys, double click = the default. The element carries `frisch()`, which pulls the value again
 *  (not while it is dragged or was just moved). opt: { w, name, titel, farbe, lies() -> 0..1 | null, setze(k), ende?() (end of a gesture: pointer up, wheel idle,
 *  key, double click), text(k), vorgabe (0..1, double click), klein? (a small knob with `nummer` inside, no readout), nummer? }. */
export function neuerDrehknopf({ w, name, titel, farbe, lies, setze, ende, text, vorgabe = 0, klein = false, nummer = '' }) {
  const e = mk('div', `w-dreh${klein ? ' klein' : ''}`, w);
  e.title = titel; e.tabIndex = 0; e.setAttribute('role', 'slider'); e.setAttribute('aria-label', titel);
  const rad = mk('span', 'w-dreh-rad'), wert = mk('span', 'w-dreh-wert'), nm = mk('span', 'w-dreh-name', null, name ?? '');
  if (farbe) e.style.setProperty('--farbe', farbe);
  if (klein) rad.textContent = String(nummer);
  e.append(rad);
  if (!klein) e.append(wert, nm);
  let k = 0, zieht = false, bewegt = false, zuletzt = 0, y0 = 0, k0 = 0, radUhr = null;
  const zeige = () => {
    rad.style.setProperty('--k', k.toFixed(4));
    wert.textContent = text(k); e.setAttribute('aria-valuetext', text(k)); e.classList.toggle('aus', k <= 0);
    if (klein) e.title = `${titel}: ${text(k)}`;
  };
  const fertig = () => { if (radUhr !== null) { clearTimeout(radUhr); radUhr = null; } ende?.(); };
  const stelle = (neu) => { k = Math.min(1, Math.max(0, neu)); zuletzt = Date.now(); zeige(); setze(k); };
  e.addEventListener('pointerdown', (ev) => { zieht = true; bewegt = false; y0 = ev.clientY ?? 0; k0 = k; e.setPointerCapture?.(ev.pointerId); ev.preventDefault?.(); });
  e.addEventListener('pointermove', (ev) => { if (zieht) { bewegt = true; stelle(k0 + (y0 - (ev.clientY ?? 0)) / (ev.shiftKey ? 600 : 150)); } });
  for (const a of ['pointerup', 'pointercancel']) e.addEventListener(a, () => { const war = zieht && bewegt; zieht = false; bewegt = false; if (war) fertig(); });
  e.addEventListener('wheel', (ev) => {
    ev.preventDefault?.(); stelle(k + (ev.deltaY < 0 ? 1 : -1) * (ev.shiftKey ? 0.005 : 0.02));
    if (ende) { if (radUhr !== null) clearTimeout(radUhr); radUhr = setTimeout(() => { radUhr = null; ende(); }, WHEEL_MS); radUhr?.unref?.(); }
  }, { passive: false });
  e.addEventListener('dblclick', () => { stelle(vorgabe); fertig(); });
  e.addEventListener('keydown', (ev) => {
    const r = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[ev.key];
    if (r) { ev.preventDefault?.(); ev.stopPropagation?.(); stelle(k + r * (ev.shiftKey ? 0.005 : 0.02)); fertig(); }
  });
  e.addEventListener('click', (ev) => ev.stopPropagation?.());
  e.frisch = () => { if (zieht || radUhr !== null || Date.now() - zuletzt < 400) return; const v = lies(); if (v === null || v === undefined) return; k = Math.min(1, Math.max(0, v)); zeige(); };
  return e;
}
