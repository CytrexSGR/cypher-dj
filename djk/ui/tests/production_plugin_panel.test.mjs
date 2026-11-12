// Front panels task 12: the automatic panel of a host plugin, built on the page from the parameter list. Pure panel, the adapter over the list's send
// path (one POST .../param {werte: {<index>: 0..1}} per gesture) and the List toggle of oeffnePluginGeraet. Fake DOM, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { autoPanelAusListe, parameterAusListe, pluginAdapter, PANEL_MAX_REGLER } from '../public/production/plugin_panel.js';
import { oeffnePluginGeraet } from '../public/production/plugin_device.js';
import { baueFrontplatte, steuerungen } from '../public/panel.js';
import { pruefePanel } from '../graphs.ts';
import { alsListe } from '../public/production/plugin_parameter.js';

class K {
  constructor(tag) {
    this.tag = tag; this.kinder = []; this.attr = {}; this.ev = {}; this.dataset = {}; this.textContent = ''; this.tabIndex = -1;
    this.style = { setProperty() {} };
    const klassen = new Set();
    this.classList = { add: (c) => klassen.add(c), remove: (c) => klassen.delete(c), toggle: (c, an) => (an ?? !klassen.has(c) ? klassen.add(c) : klassen.delete(c)), contains: (c) => klassen.has(c) };
    this.klassen = klassen;
  }
  set className(v) { for (const c of String(v).split(' ')) this.classList.add(c); }
  setAttribute(k, v) { this.attr[k] = String(v); if (k === 'class') this.className = v; }
  append(...k) { for (const x of k) if (x && typeof x === 'object') x.eltern = this; this.kinder.push(...k); }
  replaceChildren(...k) { this.kinder = []; this.append(...k); }
  addEventListener(t, f) { (this.ev[t] ??= []).push(f); }
  setPointerCapture() {}
  focus() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 100 }; }
  feuere(t, e = {}) { const ev = { preventDefault() {}, pointerId: 1, button: 0, shiftKey: false, target: this, ...e }; for (const f of this.ev[t] ?? []) f(ev); return ev; }
  finde(klasse, aus = []) { if (this.klassen.has(klasse)) aus.push(this); for (const k of this.kinder) k.finde(klasse, aus); return aus; }
  alles(aus = []) { aus.push(this); for (const k of this.kinder) k.alles(aus); return aus; }
}
const DOK = { createElement: (t) => new K(t), createElementNS: (_n, t) => new K(t) };
const warte = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const wurzelNeu = () => ({ querySelector: () => null, createElement: (t) => new K(t), body: new K('body') });

const liste100 = Array.from({ length: 100 }, (_, i) => ({ index: i * 3 + 7, name: `Param ${i}`, wert: 0.25, min: 0, max: 1 }));

test('a 100-parameter list gives 64 controls in 8 sections of 8, a valid v2 panel bound by list index', () => {
  const p = autoPanelAusListe(liste100, 'Big Synth');
  assert.equal(PANEL_MAX_REGLER, 64);
  assert.equal(p.sections.length, 8);
  assert.ok(p.sections.every((s) => s.controls.length === 8));
  assert.deepEqual(p.geraet, { art: 'plugin', name: 'Big Synth' });
  const c = steuerungen(p);
  assert.equal(c.length, 64);
  assert.equal(c[0].bind.param, '7');
  assert.equal(c[63].bind.param, String(63 * 3 + 7));
  const fehler = pruefePanel(p, 'x', {}, c.map((x) => x.bind.param));
  assert.deepEqual(fehler, []);
});

test('stepped rows become selectors only when the list says so; unit and default are carried', () => {
  const p = autoPanelAusListe([{ index: 0, name: 'Wave', wert: 0.5, stufen: ['Saw', 'Sqr', 'Tri'] }, { index: 1, name: 'Voices', wert: 1, schritte: 4 },
    { index: 2, name: 'Cut', wert: 0.8, einheit: 'Hz' }, { index: 3, name: 'Many', wert: 0, schritte: 40 }], 'T');
  const [a, b, c, d] = steuerungen(p);
  assert.deepEqual([a.type, a.options, a.default], ['selector', ['Saw', 'Sqr', 'Tri'], 1]);
  assert.deepEqual([b.type, b.options.length, b.default], ['selector', 4, 3]);
  assert.deepEqual([c.type, c.unit, c.default], ['knob', 'Hz', 0.8]);
  assert.equal(d.type, 'knob');
});

test('readouts: the list range and unit when it has one, else percent', () => {
  const liste = [{ index: 1, name: 'A', wert: 0.5, min: 20, max: 2020, einheit: 'Hz' }, { index: 2, name: 'B', wert: 0.5 }];
  const host = new K('div');
  baueFrontplatte(host, { panel: autoPanelAusListe(liste, 'T'), parameter: parameterAusListe(liste), adapter: { get: () => 0.5, set() {} }, dokument: DOK });
  const texte = host.alles().map((e) => e.attr['aria-valuetext']).filter(Boolean);
  assert.equal(texte.length, 2);
  assert.match(texte[0], /Hz|k/);
  assert.match(texte[1], /50/);
  assert.match(texte[1], /%/);
});

test('a knob drag sends once at pointerup through the list route with the list index and the 0..1 value', async () => {
  const gesendet = [];
  const ctx = {
    holeGet: async () => ({ status: 200, j: { spur_id: 's1', parameter: liste100.slice(0, 10) } }),
    holeJson: async (w, k) => { gesendet.push([w, k]); return { status: 200, j: { ok: true, werte: k.werte } }; },
    melde() {}, antwortText: () => 'x',
  };
  const bau = { liste: () => assert.fail('list built'), platte: (h, o) => baueFrontplatte(h, { ...o, dokument: DOK }) };
  const el = oeffnePluginGeraet(ctx, { id: 's1', name: 'Lead' }, wurzelNeu(), bau);
  await warte();
  const knopf = el.alles().find((e) => e.dataset?.id === 'p13').finde('fp-knopf')[0];   // list index 13 = third row (7, 10, 13)
  knopf.feuere('pointerdown', { clientX: 10, clientY: 100 });
  for (let i = 1; i <= 5; i++) knopf.feuere('pointermove', { clientX: 10, clientY: 100 - i * 4 });
  assert.equal(gesendet.length, 0, 'moving only previews');
  knopf.feuere('pointerup');
  await warte();
  assert.equal(gesendet.length, 1);
  assert.equal(gesendet[0][0], '/proj/spur/s1/geraet/param');
  assert.deepEqual(Object.keys(gesendet[0][1].werte), ['13']);
  const v = gesendet[0][1].werte['13'];
  assert.ok(v > 0.25 && v <= 1, `got ${v}`);
});

test('the adapter throttles set() at a fixed 30 ms into one POST and shows the answer; a refused write reaches fehler', async () => {
  const gesendet = [], fehler = [];
  const a = pluginAdapter([{ index: 5, wert: 0.1 }], { sende: async (w) => { gesendet.push(w); return gesendet.length === 1 ? { status: 200, j: { werte: { 5: 0.4 } } } : { status: 409, j: {} }; }, fehler: (r) => fehler.push(r.status) });
  assert.equal(a.get('5'), 0.1);
  a.set('5', 0.3); a.set('5', 0.35);
  await warte(80);
  assert.deepEqual(gesendet, [{ 5: 0.35 }]);
  assert.equal(a.get('5'), 0.4);
  a.set('5', 0.9);
  await a.ende();
  assert.deepEqual(fehler, [409]);
});

test('List toggle: panel by default, "List" shows the list with the same routes, "Panel" returns', async () => {
  const gebaut = [];
  const ctx = { holeGet: async () => ({ status: 200, j: { parameter: liste100.slice(0, 3) } }), holeJson: async () => ({ status: 200, j: {} }), melde() {}, antwortText: () => '' };
  const bau = { liste: (h, o) => gebaut.push(['liste', o]), platte: (h, o) => { gebaut.push(['platte', o]); return {}; } };
  const el = oeffnePluginGeraet(ctx, { id: 's2', name: 'Pad' }, wurzelNeu(), bau);
  await warte();
  const knopf = el.finde('p-ins-liste')[0];
  assert.equal(knopf.textContent, 'List');
  assert.deepEqual(gebaut.map((g) => g[0]), ['platte']);
  knopf.feuere('click');
  await warte();
  assert.equal(knopf.textContent, 'Panel');
  assert.deepEqual(gebaut.map((g) => g[0]), ['platte', 'liste']);
  const l = await gebaut[1][1].holeListe();
  assert.equal(l.j.length, 3, 'the list gets the unwrapped array');
  knopf.feuere('click');
  await warte();
  assert.deepEqual(gebaut.map((g) => g[0]), ['platte', 'liste', 'platte']);
});

test('the shared list unwrap takes the real route answer {insert_id, parameter: [...]} and a bare array; an error answer passes through', () => {
  const l = [{ index: 1, name: 'Cut', wert: 0.5 }];
  assert.deepEqual(alsListe({ status: 200, j: { insert_id: 'i1', parameter: l } }).j, l);
  assert.deepEqual(alsListe({ status: 200, j: l }).j, l);
  const f = { status: 409, j: { fehler: 'x' } };
  assert.equal(alsListe(f), f);
  assert.deepEqual(alsListe({ status: 200, j: { insert_id: 'i1' } }).j, { insert_id: 'i1' }, 'no list in the answer: unchanged (the caller reports it)');
});

test('the adapter sends while the turn goes on (fixed interval, not restarted by each set), and ende() sends the rest at once', async () => {
  const geplant = [], gesendet = [];
  const zeitgeber = { setTimeout: (f, ms) => { geplant.push({ f, ms }); return geplant.length; }, clearTimeout: (id) => { geplant[id - 1].weg = true; } };
  const a = pluginAdapter([{ index: 5, wert: 0.1 }], { sende: async (w) => { gesendet.push(w); return { status: 200, j: {} }; }, fehler() {}, zeitgeber });
  a.set('5', 0.2); a.set('5', 0.3); a.set('5', 0.4);
  assert.equal(geplant.length, 1, 'one timer for the three sets: later sets do not restart it');
  assert.equal(geplant[0].ms, 30);
  await geplant[0].f();
  assert.deepEqual(gesendet, [{ 5: 0.4 }], 'the latest value goes out while the drag is still on');
  a.set('5', 0.5);
  assert.equal(geplant.length, 2, 'a new interval starts with the next set');
  a.set('5', 0.6);
  await a.ende();
  assert.deepEqual(gesendet, [{ 5: 0.4 }, { 5: 0.6 }]);
  assert.equal(geplant[1].weg, true, 'ende() cancels the pending timer');
});

test('a failed read leaves one line and a Retry in the area (409 host_fehlt, a thrown fetch); Retry reads again and builds the panel', async () => {
  let n = 0;
  const antworten = [{ status: 409, j: { fehler: 'host_fehlt' } }, 'wirf', { status: 200, j: { parameter: liste100.slice(0, 3) } }];
  const gemeldet = [];
  const ctx = { holeGet: async () => { const x = antworten[n++]; if (x === 'wirf') throw new Error('offline'); return x; }, holeJson: async () => ({ status: 200, j: {} }), melde: (t) => gemeldet.push(t), antwortText: () => 'refused' };
  const gebaut = [];
  const bau = { liste: () => {}, platte: (h, o) => { gebaut.push(o); return {}; } };
  const el = oeffnePluginGeraet(ctx, { id: 's3', name: 'Pad' }, wurzelNeu(), bau);
  await warte();
  const inhalt = el.finde('p-geraet-inhalt')[0];
  assert.equal(inhalt.kinder.length, 2, 'a line and a button');
  assert.match(inhalt.kinder[0].textContent, /could not be read: The plugin host is not ready/);
  inhalt.finde('p-geraet-neu')[0].feuere('click');
  await warte();
  assert.match(inhalt.kinder[0].textContent, /could not be read: offline/);
  inhalt.finde('p-geraet-neu')[0].feuere('click');
  await warte();
  assert.equal(gebaut.length, 1, 'the panel is built after the third read');
});
