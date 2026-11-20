// The small rotary control of the dock cards and the send knobs, with the send taper helpers and the fader readout.
// Shared by the views (STUDIO, PRODUCTION): no view state, nothing from the view folders.
import { posVonDb, dbVonPos } from '../production/fader_curve.js';

// A send knob travels 0..1 on the fader taper; the lowest twentieth is off (the page treats -60 dB and below as off everywhere).
export const sendPos = (db) => posVonDb(db);
export const sendDb = (pos) => { const db = dbVonPos(Math.min(1, Math.max(0, pos))); return db <= -60 ? -200 : db; };
export const sendText = (db) => (db <= -60 ? 'off' : `${db > 0 ? '+' : ''}${db.toFixed(1)}`);

export const FADER_MIN = -60;   // the same threshold as the PRODUCTION track head
export const faderText = (db) => (db <= FADER_MIN ? '-inf' : `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`);

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
