// The DJ mixer's middle column and the look of the mixer knobs (2026-11-14). Kept out of app.js, which is already far too long.

const SVG = 'http://www.w3.org/2000/svg';

// The value arc of a knob (viewBox 0 0 60 60, radius 24, 270 degrees from bottom left).
export function bogenPfad(x) {
  const w0 = -135, w = w0 + 270 * x;
  const p = (g) => [30 + 24 * Math.sin((g * Math.PI) / 180), 30 - 24 * Math.cos((g * Math.PI) / 180)];
  const [x0, y0] = p(w0), [x1, y1] = p(w);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A 24 24 0 ${w - w0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

// The knobs take the look of the device panels (panel.css .fp-knopf; Andreas: "das aussehen im remix der knöpfe und schieber wirkt besser"):
// a dark track under the value arc, a separate cap and a short pointer on the cap. Done once per knob on its first drawing, so every knob of the
// page (strips, master, headphones, beat FX) changes without touching the markup.
export function veredleKnopf(el) {
  if (el.dataset.fp) return;
  el.dataset.fp = '1';
  const svg = el.querySelector('svg'), ring = el.querySelector('.ring'), bogen = el.querySelector('.bogen'), zeiger = el.querySelector('.zeiger');
  if (!svg || !ring || !bogen || !zeiger) return;
  const spur = document.createElementNS(SVG, 'path');
  spur.setAttribute('class', 'spur');
  spur.setAttribute('d', bogenPfad(1));
  svg.insertBefore(spur, bogen);
  svg.append(ring, zeiger);   // the cap lies over the arcs, the pointer over the cap
  ring.setAttribute('r', '18');
  zeiger.setAttribute('y1', '22'); zeiger.setAttribute('y2', '14');
}

// DJ view (Andreas: master strip back in the middle, FX1 and 2 below it, headphones not lost in the header corner): the beat FX units, COLOR and the REMIX unit move
// into the middle column under the master, the headphone knobs into the master strip; the other views keep them in the header. Only the nodes move
// (append), so their listeners and state stay.
export function ordneMitte(ansicht, $ = (s) => document.querySelector(s)) {
  const dj = ansicht === 'dj', fx = $('#fx'), mitte = $('#fxmitte'), km = $('.kopfmix'), master = $('#mischer .mitte'), kopf = $('#kopf');
  if (!fx || !mitte || !km || !kopf) return;
  for (const id of ['#fx-1', '#fx-2', '#colorfx', '#remix-einheit']) { const e = $(id); if (e) (dj ? mitte : fx).append(e); }
  // Missing master strip: it must not stop the other views' part (found 2026-11-22: the header FX row stayed empty because this function returned early).
  if (dj) { if (master) master.append(km); } else kopf.insertBefore(km, fx);
}

// COLOR PARAMETER as a knob (Andreas 2026-11-14: "sollte auch drehknopf sein"). The range input stays as the value carrier the page already reads
// and sends (bindeColor listens to its input event); it is hidden and a knob drawn like the others stands in for it. Drag vertically (220 px for the
// whole way, Shift fine), wheel, double click back to 0.5. Returns a redraw function for values that come from the core.
export function colorKnopf(input) {
  if (!input || input.dataset?.knopf || typeof input.after !== 'function') return () => {};   // (the minimal test DOM has no after(): the input stays)
  input.dataset.knopf = '1';
  const k = document.createElement('div');
  k.className = 'knopf colorknopf';
  k.setAttribute('role', 'slider'); k.tabIndex = 0; k.setAttribute('aria-label', input.getAttribute('aria-label') || 'Parameter');
  k.innerHTML = '<svg viewBox="0 0 60 60"><circle class="ring" cx="30" cy="30" r="24"/><path class="bogen"/><line class="zeiger" x1="30" y1="30" x2="30" y2="10"/></svg>';
  input.hidden = true;
  input.after(k);
  veredleKnopf(k);
  const zeichne = () => {
    const x = Math.max(0, Math.min(1, Number(input.value)));
    k.querySelector('.zeiger').setAttribute('transform', `rotate(${-135 + 270 * x} 30 30)`);
    k.querySelector('.bogen').setAttribute('d', x > 0.001 ? bogenPfad(x) : '');
    k.setAttribute('aria-valuenow', x.toFixed(2));
  };
  const setze = (x) => {
    input.value = String(Math.round(Math.max(0, Math.min(1, x)) * 100) / 100);
    zeichne();
    input.dispatchEvent(new Event('input'));
  };
  let start = null;
  k.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    k.setPointerCapture(e.pointerId); k.classList.add('gegriffen');
    start = { y: e.clientY, x: Number(input.value) };
  });
  k.addEventListener('pointermove', (e) => { if (start) setze(start.x + ((start.y - e.clientY) / 220) * (e.shiftKey ? 0.2 : 1)); });
  const los = () => { start = null; k.classList.remove('gegriffen'); };
  k.addEventListener('pointerup', los); k.addEventListener('pointercancel', los);
  k.addEventListener('wheel', (e) => { e.preventDefault(); setze(Number(input.value) + (e.deltaY < 0 ? 0.02 : -0.02)); }, { passive: false });
  k.addEventListener('dblclick', () => setze(0.5));
  k.addEventListener('keydown', (e) => {
    const d = { ArrowUp: 0.02, ArrowRight: 0.02, ArrowDown: -0.02, ArrowLeft: -0.02 }[e.key];
    if (d) { e.preventDefault(); setze(Number(input.value) + d); }
  });
  zeichne();
  return zeichne;
}
