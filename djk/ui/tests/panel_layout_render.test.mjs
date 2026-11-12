// Renderer for the panel layout fields (Task 2 of the surfaces plan): module rows, dividers, pages, scale ticks, glyph options.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalisierePanel, reglerBereiche } from '../graphs.ts';
import { baueFrontplatte } from '../public/panel.js';
import { GLYPHEN_PFAD } from '../public/panel_glyphen.js';

// ---- a tiny fake DOM (file-local copy of the one in panel.test.mjs) ----
class K {
  constructor(tag) {
    this.tag = tag; this.kinder = []; this.attr = {}; this.ev = {}; this.dataset = {}; this.textContent = ''; this.tabIndex = -1;
    this.style = { vars: {}, setProperty: (k, v) => { this.style.vars[k] = v; } };
    const klassen = new Set();
    this.classList = { add: (c) => klassen.add(c), remove: (c) => klassen.delete(c), toggle: (c, an) => (an ?? !klassen.has(c) ? klassen.add(c) : klassen.delete(c)), contains: (c) => klassen.has(c) };
    this.klassen = klassen;
  }
  setAttribute(k, v) { this.attr[k] = String(v); if (k === 'class') for (const c of String(v).split(' ')) this.classList.add(c); }
  getAttribute(k) { return this.attr[k]; }
  append(...k) { for (const x of k) if (x && typeof x === 'object') x.eltern = this; this.kinder.push(...k); }
  replaceChildren() { this.kinder = []; }
  addEventListener(t, f) { (this.ev[t] ??= []).push(f); }
  setPointerCapture() {}
  focus() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 100 }; }
  feuere(t, e = {}) { const ev = { preventDefault() {}, pointerId: 1, button: 0, shiftKey: false, target: this, ...e }; for (const f of this.ev[t] ?? []) f(ev); if (this.eltern && !ev.stopped) this.eltern.feuereWeiter(t, ev); return ev; }
  feuereWeiter(t, ev) { for (const f of this.ev[t] ?? []) f(ev); if (this.eltern && !ev.stopped) this.eltern.feuereWeiter(t, ev); }
  finde(klasse, aus = []) { if (this.klassen.has(klasse)) aus.push(this); for (const k of this.kinder) k.finde(klasse, aus); return aus; }
  alles(aus = []) { aus.push(this); for (const k of this.kinder) k.alles(aus); return aus; }
}
const DOK = { createElement: (t) => new K(t), createElementNS: (_n, t) => new K(t) };
const GRAPH = { knoten: [1, 2, 3, 4, 5, 6].map((nr) => ({ art: 'regler', nr, min: 0, max: nr === 1 ? 1000 : 1, log: 0 })) };
const B = reglerBereiche(GRAPH);
const knob = (id, n, extra = {}) => ({ id, type: 'knob', label: id, bind: { param: `k${n}` }, format: n === 1 ? 'hz' : 'percent', default: 0.5, ...extra });
const panelMit = (over = {}) => ({
  format: 'cypherdj-panel/2', geraet: { art: 'bk', graph: 'g' }, title: 'G',
  sections: [
    { id: 'osc', title: 'OSC', controls: [knob('a', 1), { id: 'wave', type: 'selector', label: 'Wave', bind: { param: 'k2' }, options: ['Saw', 'Tri', 'Sine'], default: 0 }] },
    { id: 'flt', title: 'FILTER', controls: [knob('b', 3)] },
    { id: 'env', title: 'ENV', controls: [knob('c', 4)] },
  ],
  ...over,
});
function baue(panel, opt = {}) {
  const host = new K('div'), gesetzt = [];
  const fp = baueFrontplatte(host, { panel: normalisierePanel(panel), regler: B, adapter: { get: () => undefined, set: (n, v) => gesetzt.push([n, v]) }, dokument: DOK, ...opt });
  const zelle = (id) => host.alles().find((e) => e.dataset?.id === id);
  return { fp, host, gesetzt, zelle };
}
const sekIds = (host) => host.finde('fp-sektion').map((s) => s.dataset.sektion);

test('without layout and breit: no rows, no scale, sections in file order (as before)', () => {
  const { host } = baue(panelMit());
  assert.equal(host.finde('fp-reihe').length, 0);
  assert.equal(host.finde('fp-skala').length, 0);
  assert.equal(host.finde('fp-seiten').length, 0);
  assert.deepEqual(sekIds(host), ['osc', 'flt', 'env']);
});

test('layout rows: one .fp-reihe per row in order, modules in order, dividers from the second module on, leftovers in a last row', () => {
  const { host } = baue(panelMit({ layout: { rows: [['flt', 'osc']] } }));
  const reihen = host.finde('fp-reihe');
  assert.equal(reihen.length, 2, 'named row plus a last row for the unnamed section');
  assert.deepEqual(reihen[0].finde('fp-modul').map((m) => m.dataset.sektion), ['flt', 'osc']);
  assert.deepEqual(reihen[1].finde('fp-modul').map((m) => m.dataset.sektion), ['env']);
  const [m1, m2] = reihen[0].finde('fp-modul');
  assert.equal(m1.klassen.has('fp-teiler'), false);
  assert.equal(m2.klassen.has('fp-teiler'), true);
  assert.equal(reihen[1].finde('fp-modul')[0].klassen.has('fp-teiler'), false, 'first module of a row has no divider');
  assert.equal(m1.finde('fp-modultitel')[0].textContent, 'FILTER');
  assert.equal(host.finde('fp-modul').length, 3);
});

test('module width follows cols (grid track weight)', () => {
  const p = panelMit({ layout: { rows: [['osc', 'flt', 'env']] } });
  p.sections[0].cols = 3;
  const { host } = baue(p);
  assert.equal(host.finde('fp-modul')[0].style.vars['--spalten'], '3');
});

test('pages: tab bar with tablist role, a tab hides the other page, values stay, zeigeSeite does the same', () => {
  const p = panelMit({ layout: { rows: [['osc', 'flt'], ['env']] }, pages: [{ id: 'main', title: 'Main' }, { id: 'mod', title: 'Mod' }] });
  p.sections[2].page = 'mod';
  const { fp, host, zelle } = baue(p);
  const leiste = host.finde('fp-seiten')[0];
  assert.equal(leiste.attr.role, 'tablist');
  const tabs = leiste.kinder;
  assert.deepEqual(tabs.map((t) => t.textContent), ['Main', 'Mod']);
  const versteckt = (id) => host.finde('fp-modul').find((m) => m.dataset.sektion === id).klassen.has('fp-aus');
  assert.deepEqual(['osc', 'flt', 'env'].map(versteckt), [false, false, true], 'first page is the default');
  assert.equal(tabs[0].attr['aria-selected'], 'true');
  zelle('a').finde('fp-knopf')[0].feuere('keydown', { key: 'End' });
  tabs[1].feuere('click');
  assert.deepEqual(['osc', 'flt', 'env'].map(versteckt), [true, true, false]);
  assert.equal(tabs[1].attr['aria-selected'], 'true');
  assert.equal(host.finde('fp-reihe')[0].klassen.has('fp-aus'), true, 'a row without a visible module hides');
  fp.zeigeSeite('main');
  assert.deepEqual(['osc', 'flt', 'env'].map(versteckt), [false, false, true]);
  assert.equal(host.finde('fp-reihe')[0].klassen.has('fp-aus'), false);
  assert.equal(fp.werte().k1, 1, 'values survive a page change');
  assert.equal(zelle('a').finde('fp-wert')[0].textContent, '1.00 kHz');
});

test('breit: a knob without scale gets 11 ticks and the two end labels (formatted min and max)', () => {
  const { zelle } = baue(panelMit(), { breit: true });
  const skala = zelle('a').finde('fp-skala')[0];
  assert.equal(skala.finde('fp-tick').length, 11);
  assert.deepEqual(skala.finde('fp-skalatext').map((t) => t.textContent), ['0.00 Hz', '1.00 kHz']);
});

test('not breit: only a knob whose file asks has a scale; ticks count and labels follow the file', () => {
  const p = panelMit();
  p.sections[1].controls[0].scale = { ticks: 5 };
  p.sections[2].controls[0].scale = { labels: ["32'", "16'", "8'", "4'"] };
  const { zelle } = baue(p);
  assert.equal(zelle('a').finde('fp-skala').length, 0);
  assert.equal(zelle('b').finde('fp-skala')[0].finde('fp-tick').length, 5);
  assert.deepEqual(zelle('c').finde('fp-skala')[0].finde('fp-skalatext').map((t) => t.textContent), ["32'", "16'", "8'", "4'"]);
  assert.equal(zelle('c').finde('fp-skala')[0].finde('fp-tick').length, 4, 'one tick per label');
});

test('glyph options: SVG with the glyph path, aria-label and title = option text; null option stays text; readout shows the text', () => {
  const p = panelMit();
  p.sections[0].controls[1].glyphs = ['saw', null, 'sine'];
  const { zelle } = baue(p);
  const tasten = zelle('wave').finde('fp-option');
  const g = tasten[0].finde('fp-glyphe')[0];
  assert.equal(g.tag, 'svg');
  assert.equal(g.attr['aria-label'], 'Saw');
  assert.equal(g.kinder[0].attr.d, GLYPHEN_PFAD.saw);
  assert.equal(tasten[0].attr['aria-label'], 'Saw');
  assert.equal(tasten[0].attr.title, 'Saw');
  assert.equal(tasten[1].finde('fp-glyphe').length, 0);
  assert.equal(tasten[1].textContent, 'Tri');
  assert.equal(zelle('wave').finde('fp-wert')[0].textContent, 'Saw');
  tasten[2].feuere('click');
  assert.equal(zelle('wave').finde('fp-wert')[0].textContent, 'Sine');
  assert.equal(tasten[2].attr['aria-checked'], 'true');
});

test('huelle renders a drawing; the spectrum display is a placeholder without a feed and a live view with one (Task 6)', () => {
  const p = panelMit();
  p.sections[1].controls.push({ id: 'h', type: 'huelle', of: { a: 'a', d: 'b', s: 'c', r: 'c' } }, { id: 'sp', type: 'spektrum' });
  const { zelle } = baue(p);
  assert.equal(zelle('h').finde('fp-kurve').length, 1);
  assert.equal(zelle('sp').finde('fp-anzeige').length, 1);
  assert.equal(zelle('sp').finde('fp-anzeige')[0].kinder.length, 1);   // no feed (small area): a note, no canvas
  assert.equal(zelle('sp').alles().filter((x) => x.tag === 'canvas').length, 0);
  const reg = [];
  const live = baue(p, { beiSpektrum: (a) => reg.push(a) });
  assert.equal(reg.length, 1);
  assert.equal(live.zelle('sp').alles().filter((x) => x.tag === 'canvas').length, 1);
});
