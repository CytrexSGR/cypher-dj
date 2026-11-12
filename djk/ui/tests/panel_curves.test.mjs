// Geometry of the envelope, LFO and filter drawings (Task 4 of the surfaces plan) and their rendering in the panel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { huellPunkte, lfoPunkte, filterPunkte, filterDb, cutoffX } from '../public/panel_curves.js';
import { normalisierePanel, reglerBereiche } from '../graphs.ts';
import { baueFrontplatte } from '../public/panel.js';

const nah = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

test('huellPunkte: ADSR shape', () => {
  const p = huellPunkte({ a: 0.1, d: 0.2, s: 0.5, r: 0.3 }, 200, 60);
  assert.deepEqual(p[0], [0, 60]);
  assert.ok(p.some(([, y]) => y === 0), 'attack peak at y 0');
  const peak = p.find(([, y]) => y === 0);
  const aus = p[p.length - 1];
  nah(aus[1], 60, 1); nah(aus[0], 200, 1);
  const plateau = p.filter(([, y]) => Math.abs(y - 30) < 0.01);
  assert.ok(plateau.length >= 2 && plateau[plateau.length - 1][0] - plateau[0][0] > 20, 'sustain plateau at y 30');
  // attack is a straight line, decay and release fall monotonically
  const ia = p.indexOf(peak);
  for (let i = ia + 1; i < p.length; i++) assert.ok(p[i][1] >= p[i - 1][1] - 1e-9, 'never rises after the peak');
  assert.ok(p.every(([x, y]) => x >= 0 && x <= 200 && y >= 0 && y <= 60));
});
test('huellPunkte: extremes stay inside, every stage at least 4 px', () => {
  const n = huellPunkte({ a: 0, d: 0.05, s: 1, r: 20 }, 200, 60);
  assert.ok(n.every(([x, y]) => x >= 0 && x <= 200.0001 && y >= 0 && y <= 60.0001));
  const peak = n.find(([, y]) => y === 0);
  assert.ok(peak[0] >= 4, `attack stage ${peak[0]} px`);
  const m = huellPunkte({ a: 0, d: 0, s: 0, r: 0 }, 200, 60);
  assert.ok(m.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && x <= 200.0001));
  const l = huellPunkte({ a: 20, d: 20, s: 0.3, r: 20 }, 200, 60);
  assert.ok(l.every(([x]) => x <= 200.0001));
});

test('lfoPunkte: five forms, 64 points inside the box', () => {
  for (const f of ['saw', 'tri', 'sine', 'square', 'sh', 'pulse', 'ramp', 'noise']) {
    const p = lfoPunkte(f, 100, 40);
    assert.equal(p.length, 64, f);
    assert.ok(p.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 40), f);
  }
  const s = lfoPunkte('sine', 100, 40);
  nah(s[0][1], 20, 0.5); assert.ok(Math.min(...s.map((q) => q[1])) < 1 && Math.max(...s.map((q) => q[1])) > 39);
  const sq = lfoPunkte('square', 100, 40);
  assert.ok(sq[5][1] < 5 && sq[60][1] > 35);
  assert.notDeepEqual(lfoPunkte('saw', 100, 40), lfoPunkte('ramp', 100, 40));
});

test('filterDb / filterPunkte: low-pass, high-pass, band-pass', () => {
  for (const pole of [2, 4]) {
    nah(filterDb({ cutoff: 1000, reso: 0, art: 'lp', pole }, 20), 0, 0.5, `lp${pole} at 20 Hz`);
    assert.ok(filterDb({ cutoff: 1000, reso: 0, art: 'lp', pole }, 10000) <= (pole === 2 ? -20 : -40), `lp${pole} at 10x`);
    assert.ok(filterDb({ cutoff: 1000, reso: 0.9, art: 'lp', pole }, 1000) > filterDb({ cutoff: 1000, reso: 0, art: 'lp', pole }, 1000) + 3, `reso lifts lp${pole}`);
    assert.ok(filterDb({ cutoff: 1000, reso: 0, art: 'hp', pole }, 100) < -20 * (pole / 2) + 1);
    nah(filterDb({ cutoff: 1000, reso: 0, art: 'hp', pole }, 20000), 0, 0.5, `hp${pole} high`);
    const bp = (f) => filterDb({ cutoff: 1000, reso: 0, art: 'bp', pole }, f);
    assert.ok(bp(1000) > bp(100) + 10 && bp(1000) > bp(10000) + 10, `bp${pole} peaks at cutoff`);
  }
  const p = filterPunkte({ cutoff: 1000, reso: 0.5, art: 'lp', pole: 4 }, 200, 60);
  assert.ok(p.length >= 64 && p.every(([x, y]) => x >= 0 && x <= 200 && y >= 0 && y <= 60));
  assert.ok(p[0][0] === 0 && p[p.length - 1][0] === 200);
  const hoch = filterPunkte({ cutoff: 8000, reso: 0.5, art: 'lp', pole: 4 }, 200, 60), tief = filterPunkte({ cutoff: 200, reso: 0.5, art: 'lp', pole: 4 }, 200, 60);
  assert.ok(hoch[60][1] < tief[60][1], 'higher cutoff keeps more at mid frequency');
});

// ---- rendering through baueFrontplatte (fake DOM) ----
class K {
  constructor(tag) {
    this.tag = tag; this.kinder = []; this.attr = {}; this.ev = {}; this.dataset = {}; this.textContent = ''; this.tabIndex = -1;
    this.style = { setProperty() {} };
    const klassen = new Set();
    this.classList = { add: (c) => klassen.add(c), remove: (c) => klassen.delete(c), toggle: (c, an) => (an ?? !klassen.has(c) ? klassen.add(c) : klassen.delete(c)), contains: (c) => klassen.has(c) };
    this.klassen = klassen;
  }
  setAttribute(k, v) { this.attr[k] = String(v); if (k === 'class') for (const c of String(v).split(' ')) this.classList.add(c); }
  getAttribute(k) { return this.attr[k]; }
  append(...k) { for (const x of k) if (x && typeof x === 'object') x.eltern = this; this.kinder.push(...k); }
  replaceChildren() { this.kinder = []; }
  addEventListener() {}
  setPointerCapture() {}
  finde(klasse, aus = []) { if (this.klassen.has(klasse)) aus.push(this); for (const k of this.kinder) k.finde(klasse, aus); return aus; }
  alles(aus = []) { aus.push(this); for (const k of this.kinder) k.alles(aus); return aus; }
}
const DOK = { createElement: (t) => new K(t), createElementNS: (_n, t) => new K(t) };
const GRAPH = { knoten: [
  { art: 'regler', nr: 1, min: 40, max: 12000, log: 1 }, { art: 'regler', nr: 2, min: 0, max: 1 },
  { art: 'regler', nr: 3, min: 0.03, max: 4, log: 1 }, { art: 'regler', nr: 4, min: 0, max: 1 }, { art: 'regler', nr: 5, min: 0.01, max: 3, log: 1 },
  { art: 'regler', nr: 6, min: 0, max: 1 },
] };
const kn = (id, n) => ({ id, type: 'knob', label: id, bind: { param: `k${n}` }, format: 'raw', unit: 'x' });
const panel = {
  format: 'cypherdj-panel/2', geraet: { art: 'bk', graph: 'g' }, title: 'G',
  sections: [{ id: 's', title: 'S', controls: [
    kn('cut', 1), kn('res', 2), kn('dec', 3), kn('sus', 4), kn('rel', 5),
    { id: 'form', type: 'selector', label: 'Shape', bind: { param: 'k6' }, options: ['Saw', 'Tri', 'Sine'], default: 0 },
    { id: 'hue', type: 'huelle', of: { a: 0.002, d: 'dec', s: 'sus', r: 'rel' } },
    { id: 'lf', type: 'lfoform', of: { form: 'form' }, formen: ['saw', 'tri', 'sine'] },
    { id: 'fk', type: 'filterkurve', of: { cutoff: 'cut', reso: 'res' }, typen: [{ art: 'lp', pole: 4 }] },
  ] }],
};
test('panel renders the three drawings and redraws when a bound control moves', () => {
  const host = new K('div'), stand = {};
  const fp = baueFrontplatte(host, { panel: normalisierePanel(panel), regler: reglerBereiche(GRAPH), adapter: { get: (n) => stand[n], set: (n, v) => { stand[n] = v; } }, dokument: DOK });
  const d = (id) => { const z = host.alles().find((e) => e.dataset?.id === id); return z.alles().filter((e) => e.tag === 'path' && e.attr.d).map((e) => e.attr.d).join('|'); };
  const vorher = { hue: d('hue'), lf: d('lf'), fk: d('fk') };
  for (const v of Object.values(vorher)) assert.match(v, /^M/);
  const fkZelle = host.alles().find((e) => e.dataset?.id === 'fk');
  assert.match(fkZelle.alles().map((e) => e.attr['aria-label'] ?? '').join(' '), /model/);
  stand.k1 = 0.2; stand.k3 = 0.9; stand.k6 = 1;
  fp.aktualisiere();
  assert.notEqual(d('hue'), vorher.hue, 'envelope redraws');
  assert.notEqual(d('lf'), vorher.lf, 'LFO shape follows the selector');
  assert.notEqual(d('fk'), vorher.fk, 'filter curve follows the cutoff');
});

test('cutoffX: NaN and out-of-range cutoffs clamp to the axis, never NaN', () => {
  assert.equal(cutoffX(NaN, 100), 0);
  assert.equal(cutoffX(undefined, 100), 0);
  assert.equal(cutoffX(1e9, 100), 100);
  assert.equal(cutoffX(0, 100), 0);
});
