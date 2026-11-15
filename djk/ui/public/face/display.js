// Device faces: the shared display helper. Axes, SVG paths, a meter and a drag helper for the drawn surface of a device (compressor curve, EQ response,
// Hall decay). Pure geometry first (achse, pfadVon), then thin DOM builders. Every face uses these; nothing is copied per device.
const SVG = 'http://www.w3.org/2000/svg';
const endlich = (x) => typeof x === 'number' && Number.isFinite(x);
const klemme = (x, a, b) => Math.min(b, Math.max(a, x));

/** An axis between the values `min` and `max` laid on `laenge` units. pos(w): value -> position, wert(p): position -> value; both clamp and are inverse to
 *  each other. `log` spaces the values logarithmically (min > 0), `umgekehrt` lets the axis run from `laenge` back to 0 (a vertical axis: larger is higher). */
export function achse({ min, max, log = false }, laenge, umgekehrt = false) {
  const f = log ? Math.log : (x) => x;
  const lo = f(min), spanne = f(max) - lo;
  const pos = (w) => {
    const t = spanne === 0 || !endlich(w) ? 0 : klemme((f(klemme(w, Math.min(min, max), Math.max(min, max))) - lo) / spanne, 0, 1);
    return (umgekehrt ? 1 - t : t) * laenge;
  };
  const wert = (p) => {
    const t0 = laenge === 0 || !endlich(p) ? 0 : klemme(p / laenge, 0, 1);
    const t = umgekehrt ? 1 - t0 : t0;
    return log ? Math.exp(lo + t * spanne) : min + t * (max - min);
  };
  return { pos, wert };
}

/** "M x,y L x,y ..." with one decimal. A point with a non-finite coordinate is skipped and the path restarts with M after it. */
export function pfadVon(punkte) {
  let s = '', neu = true;
  for (const p of punkte) {
    if (!Array.isArray(p) || !endlich(p[0]) || !endlich(p[1])) { neu = true; continue; }
    s += `${s ? ' ' : ''}${neu ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    neu = false;
  }
  return s;
}

const sv = (d, tag, klasse) => {
  const e = d.createElementNS ? d.createElementNS(SVG, tag) : d.createElement(tag);
  if (klasse) e.setAttribute('class', klasse);
  return e;
};
const zahlText = (w) => (Math.abs(w) < 1e-9 ? '0' : String(Math.round(w * 10) / 10).replace('-', '−'));

/** The drawing area of a face: an SVG of breite x hoehe user units with an inner plot (margin `rand` for the scale labels), grid lines with scale labels, the axis
 *  titles and builders for paths, lines, dots and text. The builders take VALUES of the two axes (not pixels) and clamp them into the plot; the text of a label
 *  too. `pfad(klasse, punkte, {flaeche})` closes the path down to the bottom edge when `flaeche` is set (a shaded region). `setzePfad(el, punkte, opt)` redraws a
 *  path that `pfad` made (an addition to the contract for the faces that redraw on every change). `randR` (right margin, default 12, room for a second scale) and
 *  `formatX` / `formatY` (the grid label text, default one decimal) are additions of the Hall face. */
export function baueAnzeige(host, { breite, hoehe, rand = 28, randR = 12, x, y, gitterX = [], gitterY = [], titelX = '', titelY = '', label = '', formatX = zahlText, formatY = zahlText }) {
  const d = host.ownerDocument ?? globalThis.document;
  const svg = sv(d, 'svg', 'fa-anzeige');
  svg.setAttribute('viewBox', `0 0 ${breite} ${hoehe}`);
  svg.setAttribute('role', 'img');
  if (label) svg.setAttribute('aria-label', label);
  const innen = { x0: rand, y0: 10, x1: breite - randR, y1: hoehe - rand };
  const ax = achse(x, innen.x1 - innen.x0), ay = achse(y, innen.y1 - innen.y0, true);
  const px = (w) => innen.x0 + ax.pos(w), py = (w) => innen.y0 + ay.pos(w);
  const wertX = (p) => ax.wert(p - innen.x0), wertY = (p) => ay.wert(p - innen.y0);
  const fl = sv(d, 'rect', 'fa-flaeche');
  fl.setAttribute('x', String(innen.x0)); fl.setAttribute('y', String(innen.y0));
  fl.setAttribute('width', String(innen.x1 - innen.x0)); fl.setAttribute('height', String(innen.y1 - innen.y0));
  svg.append(fl);
  const linie = (klasse, x1, y1, x2, y2) => {
    const l = sv(d, 'line', klasse);
    for (const [k, v] of [['x1', x1], ['y1', y1], ['x2', x2], ['y2', y2]]) l.setAttribute(k, v.toFixed(1));
    return l;
  };
  const beschrifte = (klasse, px0, py0, s, anker) => {
    const t = sv(d, 'text', klasse);
    t.setAttribute('x', px0.toFixed(1)); t.setAttribute('y', py0.toFixed(1)); t.setAttribute('text-anchor', anker);
    t.textContent = s;
    return t;
  };
  for (const gx of gitterX) { svg.append(linie('fa-gitter', px(gx), innen.y0, px(gx), innen.y1)); svg.append(beschrifte('fa-skala', px(gx), innen.y1 + 11, formatX(gx), 'middle')); }
  for (const gy of gitterY) { svg.append(linie('fa-gitter', innen.x0, py(gy), innen.x1, py(gy))); svg.append(beschrifte('fa-skala', innen.x0 - 4, py(gy) + 3, formatY(gy), 'end')); }
  if (titelX) svg.append(beschrifte('fa-titel', (innen.x0 + innen.x1) / 2, hoehe - 3, titelX, 'middle'));
  if (titelY) {
    const t = beschrifte('fa-titel', 9, (innen.y0 + innen.y1) / 2, titelY, 'middle');
    t.setAttribute('transform', `rotate(-90 9 ${((innen.y0 + innen.y1) / 2).toFixed(1)})`);
    svg.append(t);
  }
  host.append(svg);
  const pfadD = (punkte, flaeche) => {
    const p = punkte.map(([a, b]) => [px(a), py(b)]).filter((q) => endlich(q[0]) && endlich(q[1]));
    const s = pfadVon(punkte.map(([a, b]) => (endlich(a) && endlich(b) ? [px(a), py(b)] : [NaN, NaN])));
    if (!flaeche || !p.length) return s;
    return `${s} L${p[p.length - 1][0].toFixed(1)},${innen.y1.toFixed(1)} L${p[0][0].toFixed(1)},${innen.y1.toFixed(1)} Z`;
  };
  return {
    svg, innen, px, py, wertX, wertY,
    pfad(klasse, punkte, { flaeche = false } = {}) {
      const p = sv(d, 'path', klasse);
      p.setAttribute('d', pfadD(punkte, flaeche));
      svg.append(p);
      return p;
    },
    setzePfad(p, punkte, { flaeche = false } = {}) { p.setAttribute('d', pfadD(punkte, flaeche)); return p; },
    linieH(klasse, yw) { const l = linie(klasse, innen.x0, py(yw), innen.x1, py(yw)); svg.append(l); return l; },
    linieV(klasse, xw) { const l = linie(klasse, px(xw), innen.y0, px(xw), innen.y1); svg.append(l); return l; },
    punkt(klasse, xw, yw, r) {
      const c = sv(d, 'circle', klasse);
      c.setAttribute('cx', px(xw).toFixed(1)); c.setAttribute('cy', py(yw).toFixed(1)); c.setAttribute('r', String(r));
      svg.append(c);
      return c;
    },
    text(klasse, xw, yw, s, anker = 'start') { const t = beschrifte(klasse, px(xw), py(yw), s, anker); svg.append(t); return t; },
  };
}

/** A vertical meter: a track with a bar that hangs from the top (gain reduction) or stands on the bottom (`von: 'unten'`), a hold marker and the number below.
 *  setze(null) shows "–" and an empty bar and forgets the hold. The hold marker keeps a peak for 1500 ms and falls afterwards (half the scale per second); time
 *  comes in with setze, there is no timer in here. */
export const METER_HALTEN_MS = 1500;
export function baueMeter(host, { min, max, label, einheit = 'dB', halte = true, von = 'oben' }) {
  const d = host.ownerDocument ?? globalThis.document;
  const mk = (tag, klasse, text) => { const e = d.createElement(tag); e.setAttribute('class', klasse); if (text !== undefined) e.textContent = text; return e; };
  const wurzel = mk('div', 'fa-meter');
  wurzel.setAttribute('role', 'meter'); wurzel.setAttribute('aria-label', label);
  wurzel.setAttribute('aria-valuemin', String(min)); wurzel.setAttribute('aria-valuemax', String(max));
  const bahn = mk('div', 'fa-meter-bahn'), balken = mk('i', 'fa-meter-balken'), halt = mk('i', 'fa-meter-halt'), text = mk('output', 'fa-meter-text', '–');
  bahn.append(balken, halt);
  wurzel.append(bahn, text);
  host.append(wurzel);
  let spitze = null, spitzeT = 0;
  const bruch = (w) => klemme((w - min) / (max - min || 1), 0, 1);
  if (von === 'unten') wurzel.classList.add('fa-meter-unten');
  const zeigeHalt = (w) => {
    if (w === null) { halt.hidden = true; halt.dataset.wert = ''; return; }
    halt.hidden = false; halt.dataset.wert = String(w);
    halt.style.setProperty('--b', String(bruch(w)));
  };
  const hoehePx = (b) => `${(b * 100).toFixed(2)}%`;
  return {
    setze(wert, jetzt = globalThis.performance?.now?.() ?? Date.now()) {
      if (!endlich(wert)) {
        balken.style.height = '0%'; text.textContent = '–'; wurzel.removeAttribute('aria-valuenow'); wurzel.classList.remove('fa-meter-an');
        spitze = null; zeigeHalt(null);
        return;
      }
      const w = klemme(wert, min, max);
      balken.style.height = hoehePx(bruch(w));
      text.textContent = `${w.toFixed(1)} ${einheit}`;
      wurzel.setAttribute('aria-valuenow', w.toFixed(1)); wurzel.classList.add('fa-meter-an');
      if (!halte) return;
      // the held peak at this time: held for METER_HALTEN_MS, then falling; a reading above it is the new peak
      const fall = spitze === null ? null : spitze - ((max - min) / 2) * (Math.max(0, jetzt - spitzeT - METER_HALTEN_MS) / 1000);
      if (spitze === null || w >= fall) { spitze = w; spitzeT = jetzt; zeigeHalt(w); }
      else zeigeHalt(Math.max(min, fall));
    },
    zerstoere() { wurzel.remove?.(); },
  };
}

/** The input and output peak bars of a stage (T9): two thin meters that stand on the bottom, scale -60 to +6 dBFS, titles IN and OUT. `werte` is {ein, aus} in dBFS or null; a number
 *  below the scale (including the -200 of silence) or a non-number shows a dash and an empty bar. Returns {setze(werte|null, jetzt), zerstoere()}. */
export const PEGEL_ACHSE = { min: -60, max: 6 };
export const pegelAnzeigbar = (v) => endlich(v) && v >= PEGEL_ACHSE.min;
export function baueSpitzenBalken(host, { artikel = 'the stage' } = {}) {
  const d = host.ownerDocument ?? globalThis.document;
  const mk = (tag, klasse, text) => { const e = d.createElement(tag); e.setAttribute('class', klasse); if (text !== undefined) e.textContent = text; return e; };
  const spalte = (titel, label) => {
    const s = mk('div', 'fa-pegel-spalte'), t = mk('span', 'fa-komp-meter-titel', titel);
    s.append(t);
    host.append(s);
    return baueMeter(s, { min: PEGEL_ACHSE.min, max: PEGEL_ACHSE.max, label, einheit: 'dB', von: 'unten' });
  };
  const ein = spalte('IN', `Input peak level of ${artikel}`), aus = spalte('OUT', `Output peak level of ${artikel}`);
  return {
    setze(werte, jetzt) {
      ein.setze(pegelAnzeigbar(werte?.ein) ? werte.ein : null, jetzt);
      aus.setze(pegelAnzeigbar(werte?.aus) ? werte.aus : null, jetzt);
    },
    zerstoere() { ein.zerstoere(); aus.zerstoere(); },
  };
}

/** Pointer events with capture on `el`: beiStart(p), beiBewegt(p, dx, dy), beiEnde(). p = {x, y} in the user units of the SVG `el` sits in (dx, dy since the start). */
export function ziehbar(el, { beiStart = () => {}, beiBewegt = () => {}, beiEnde = () => {} } = {}) {
  let start = null;
  const svg = el.ownerSVGElement ?? el;
  const punkt = (e) => {
    const r = svg.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 1, height: 1 };
    const vb = svg.viewBox?.baseVal;
    const sx = vb && vb.width && r.width ? vb.width / r.width : 1, sy = vb && vb.height && r.height ? vb.height / r.height : 1;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  };
  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', (e) => {
    if (start || (e.button !== undefined && e.button !== 0)) return;
    e.preventDefault?.();
    try { el.setPointerCapture?.(e.pointerId); } catch { /* a synthetic pointer: the drag still works inside the element */ }
    start = { id: e.pointerId, p: punkt(e) };
    beiStart(start.p);
  });
  el.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const p = punkt(e);
    beiBewegt(p, p.x - start.p.x, p.y - start.p.y);
  });
  const ende = (e) => { if (!start || e.pointerId !== start.id) return; start = null; beiEnde(); };
  el.addEventListener('pointerup', ende);
  el.addEventListener('pointercancel', ende);
  el.addEventListener('lostpointercapture', ende);
}
