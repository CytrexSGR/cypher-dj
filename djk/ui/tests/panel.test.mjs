// Front panels: validation against the graph (graphs.ts), the pure helpers of public/panel.js, and the renderer driven through a tiny
// fake DOM (drag, shift, wheel, keys, double click, the guard against incoming values). Also: every shipped panel binds only knobs its graph defines.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reglerBereiche, pruefePanel, normalisierePanel, ladePanel, panelOrdner, listeGraphen } from '../graphs.ts';
import { hebelWeg, hebelBereich, feldZone, steuerungen, parameterVon, bereichVon, vorgaben, vorgabeK, wertText, tastenSchritt, bogenPfad, knobWinkel, baueFrontplatte } from '../public/panel.js';
import { skaliere, formatiereWert } from '../public/panel_skala.js';
import { parameterTabelle, pruefeGeraete, ladeRegister, pfadeVon } from '../devices_parameter.ts';
import { OHNE_DOKU } from './support/devices_doku.mjs';

const GRAPH = {
  format: 'baukasten/2', name: 'g', stimmen: 1, regler_namen: { 1: 'Cutoff' },
  knoten: [{ id: 'ein', art: 'eingang' }, { id: 'a', art: 'regler', nr: 1, min: 450, max: 7200, log: 1 }, { id: 'b', art: 'regler', nr: 2, min: 0, max: 3000 },
    { id: 'c', art: 'regler', nr: 3, min: 0, max: 1 }, { id: 'aus', art: 'ausgang' }],
  kanten: [],
};
const BEREICHE = reglerBereiche(GRAPH);
const PANEL = {
  format: 'baukasten-panel/1', graph: 'g', title: 'G',
  sections: [{ id: 's1', title: 'FILTER', cols: 3, controls: [
    { id: 'cut', type: 'knob', label: 'Cutoff', bind: { regler: 1 }, format: 'hz', default: 0.5 },
    { id: 'dep', type: 'fader', label: 'Depth', bind: { regler: 2 }, format: 'hz', default: 0.25, orientation: 'horizontal' },
    { id: 'typ', type: 'selector', label: 'Type', bind: { regler: 3 }, options: ['LP', 'BP', 'HP', 'NT'], default: 2 },
    { id: 'rd', type: 'value', of: 'cut', label: 'Fc' }, { id: 'lb', type: 'label', text: 'hello' }, { id: 'sp', type: 'spacer' },
  ] }],
};
const fehler = (p, o = {}) => pruefePanel({ ...PANEL, ...o, ...(p ? { sections: p } : {}) }, 'g', BEREICHE);
const mitControls = (controls) => [{ id: 's1', controls }];

test('regler ranges are read from the graph nodes; nodes the engine would refuse are left out', () => {
  assert.deepEqual(BEREICHE, { 1: { min: 450, max: 7200, log: true, vorgabe: 0.5 }, 2: { min: 0, max: 3000, log: false, vorgabe: 0.5 }, 3: { min: 0, max: 1, log: false, vorgabe: 0.5 } });
  const g = { knoten: [{ art: 'regler', nr: 1, min: 0, max: 5, log: 1 }, { art: 'regler', nr: 65, min: 0, max: 1 }, { art: 'regler', nr: 2, min: 'x', max: 1 },
    { art: 'regler', nr: 3, min: 1, max: 2 }, { art: 'regler', nr: 3, min: 5, max: 6 }, { art: 'svf', nr: 4 }] };
  assert.deepEqual(reglerBereiche(g), { 3: { min: 1, max: 2, log: false, vorgabe: 0.5 } }, 'log with min 0, nr 65, a bad number and a non-regler are dropped; first node per number wins');
  assert.deepEqual(reglerBereiche(null), {});
  // 64 knobs: nr 9, 32, 33 and 64 are read, nr 0 and 65 are not
  const h = { knoten: [9, 32, 33, 64, 0, 65, 1.5].map((nr) => ({ art: 'regler', nr, min: 0, max: 1 })) };
  assert.deepEqual(Object.keys(reglerBereiche(h)).sort(), ['32', '33', '64', '9']);
});

test('validation: a good panel passes (positive control)', () => {
  assert.deepEqual(pruefePanel(PANEL, 'g', BEREICHE), []);
});

test('validation: a knob the graph does not define is refused with the number and what exists', () => {
  const f = fehler(mitControls([{ id: 'x', type: 'knob', bind: { regler: 4 } }]));
  assert.equal(f.length, 1);
  assert.equal(f[0], 'control "x": parameter k4 is not defined by the device');
  assert.match(fehler(mitControls([{ id: 'x', type: 'xy', bind: { x: { regler: 1 }, y: { regler: 7 } } }]))[0], /parameter k7 is not defined/);
  assert.equal(fehler(mitControls([{ id: 'x', type: 'knob', bind: { regler: 33 } }]))[0], 'control "x": parameter k33 is not defined by the device');
  assert.equal(fehler(mitControls([{ id: 'x', type: 'knob', bind: { regler: 0 } }]))[0], 'control "x": parameter k0 is not defined by the device');
  assert.match(fehler(mitControls([{ id: 'x', type: 'knob', bind: { regler: 'a' } }]))[0], /bind\.param must be a parameter name/);
});

test('32 knobs: a panel may bind knob 9 and 32 when the graph defines them; the same binds are refused when it does not', () => {
  const b = { ...BEREICHE, ...Object.fromEntries([9, 10, 31, 32].map((n) => [n, { min: 0, max: 1, log: false }])) };
  const c = [{ id: 'a', type: 'knob', bind: { regler: 9 } }, { id: 'b', type: 'fader', bind: { regler: 32 } },
    { id: 'c', type: 'xy', bind: { x: { regler: 10 }, y: { regler: 31 } } }];
  assert.deepEqual(pruefePanel({ ...PANEL, sections: mitControls(c) }, 'g', b), []);
  assert.match(pruefePanel({ ...PANEL, sections: mitControls(c) }, 'g', BEREICHE)[0], /parameter k9 is not defined by the device/);
});

test('64 knobs: a panel may bind knob 33 and 64 when the graph defines them, never 65 (the graph cannot define it)', () => {
  const b = { ...BEREICHE, ...Object.fromEntries([33, 48, 64].map((n) => [n, { min: 0, max: 1, log: false }])) };
  const c = [{ id: 'a', type: 'knob', bind: { regler: 33 } }, { id: 'b', type: 'fader', bind: { regler: 64 } }, { id: 'c', type: 'knob', bind: { regler: 48 } }];
  assert.deepEqual(pruefePanel({ ...PANEL, sections: mitControls(c) }, 'g', b), []);
  assert.match(pruefePanel({ ...PANEL, sections: mitControls(c) }, 'g', BEREICHE)[0], /parameter k33 is not defined by the device/);
  // a knob 65 node is not read by reglerBereiche, so the bind is refused even when the graph file has such a node
  const g = { knoten: [{ art: 'regler', nr: 65, min: 0, max: 1 }, { art: 'regler', nr: 64, min: 0, max: 1 }] };
  assert.deepEqual(Object.keys(reglerBereiche(g)), ['64']);
  assert.match(pruefePanel({ ...PANEL, sections: mitControls([{ id: 'x', type: 'knob', bind: { regler: 65 } }]) }, 'g', reglerBereiche(g))[0], /parameter k65 is not defined by the device/);
});

test('validation: every other rule has its message', () => {
  const einzel = (c) => fehler(mitControls([c])).join('|');
  assert.match(pruefePanel('x', 'g', BEREICHE)[0], /not a JSON object/);
  assert.match(fehler(null, { format: 'x/9' })[0], /format must be "baukasten-panel\/1" or "cypherdj-panel\/2"/);
  assert.match(fehler(null, { graph: 'other' })[0], /belongs to "g"/);
  assert.match(fehler([]).join(), /sections must be a non-empty list/);
  assert.match(einzel({ id: 'Bad Id', type: 'knob', bind: { regler: 1 } }), /id must match/);
  assert.match(fehler(mitControls([{ id: 'a', type: 'knob', bind: { regler: 1 } }, { id: 'a', type: 'knob', bind: { regler: 2 } }])).join(), /id used twice/);
  assert.match(fehler(mitControls([{ id: 'a', type: 'knob', bind: { regler: 1 } }, { id: 'b', type: 'fader', bind: { regler: 1 } }])).join(), /parameter k1 is already bound by control "a"/);
  assert.match(einzel({ id: 'a', type: 'dial' }), /type must be one of/);
  assert.match(einzel({ id: 'a', type: 'knob' }), /bind is missing/);
  assert.match(einzel({ id: 'a', type: 'knob', bind: {} }), /bind\.param must be/);
  assert.match(einzel({ id: 'a', type: 'knob', bind: { regler: 1 }, default: 2 }), /within 0\.\.1/);
  assert.match(einzel({ id: 'a', type: 'knob', bind: { regler: 1 }, format: 'furlongs' }), /format must be one of/);
  assert.match(einzel({ id: 'a', type: 'selector', bind: { regler: 1 }, options: ['one'] }), /options must be 2\.\.8/);
  assert.match(einzel({ id: 'a', type: 'selector', bind: { regler: 1 }, options: ['a', 'b'], default: 2 }), /option index 0\.\.1/);
  assert.match(einzel({ id: 'a', type: 'switch', bind: { regler: 1 }, default: 0.5 }), /0 or 1/);
  assert.match(einzel({ id: 'a', type: 'xy', bind: { x: { regler: 1 } } }), /needs x and y/);
  assert.match(einzel({ id: 'a', type: 'value', of: 'nope' }), /does not name a control with a value/);
  assert.match(fehler(mitControls([{ id: 'a', type: 'xy', bind: { x: { regler: 1 }, y: { regler: 2 } } }, { id: 'v', type: 'value', of: 'a' }])).join(), /needs \.x or \.y/);
  assert.match(fehler(mitControls([{ id: 'a', type: 'knob', bind: { regler: 1 } }, { id: 'v', type: 'value', of: 'a.x' }])).join(), /takes no axis/);
  assert.match(einzel({ id: 'a', type: 'label' }), /text must be/);
  assert.match(einzel({ id: 'a', type: 'spacer', span: 99 }), /span must be/);
  assert.match(fehler([{ id: 's1', cols: 12, controls: [{ id: 'a', type: 'spacer' }] }]).join(), /cols must be/);
  assert.match(fehler(null, { title: 'x'.repeat(41) })[0], /title must be/);
});

test('sidecar loading: panels/<name>.json next to the graph, refused ones are named, a missing one is no error, the folder scan ignores the subfolder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-'));
  fs.writeFileSync(path.join(dir, 'g.json'), JSON.stringify(GRAPH));
  assert.deepEqual(ladePanel('g', dir), { name: 'g', art: 'effekt', regler: BEREICHE, panel: null, fehler: [] }, 'no sidecar: no panel, no error');
  fs.mkdirSync(panelOrdner(dir));
  fs.writeFileSync(path.join(panelOrdner(dir), 'g.json'), JSON.stringify(PANEL));
  assert.deepEqual(ladePanel('g', dir).panel, normalisierePanel(PANEL), 'the answer carries the panel read as v2');
  assert.equal(ladePanel('g', dir).panel.format, 'cypherdj-panel/2');
  assert.deepEqual(listeGraphen(dir), { graphen: [{ name: 'g', art: 'effekt', regler_namen: { 1: 'Cutoff' } }], uebersprungen: [] }, 'the folder scan does not see panels/');
  fs.writeFileSync(path.join(panelOrdner(dir), 'g.json'), JSON.stringify({ ...PANEL, sections: mitControls([{ id: 'x', type: 'knob', bind: { regler: 5 } }]) }));
  const r = ladePanel('g', dir);
  assert.equal(r.panel, null);
  assert.match(r.fehler[0], /parameter k5 is not defined by the device/);
  fs.writeFileSync(path.join(panelOrdner(dir), 'g.json'), '{ broken');
  assert.deepEqual(ladePanel('g', dir).fehler, ['the panel file is not valid JSON']);
  assert.equal(ladePanel('nope', dir), null);
  assert.equal(ladePanel('../g', dir), null, 'a path is no graph name');
});

test('normalisierePanel: v1 becomes v2 (geraet bk, binds by param), v2 and unknown formats pass unchanged', () => {
  const n = normalisierePanel({ ...PANEL, sections: mitControls([{ id: 'a', type: 'knob', bind: { regler: 2 } }, { id: 'p', type: 'xy', bind: { x: { regler: 1 }, y: { regler: 3 } } }]) });
  assert.equal(n.format, 'cypherdj-panel/2');
  assert.deepEqual(n.geraet, { art: 'bk', graph: 'g' });
  assert.equal('graph' in n, false);
  assert.deepEqual(n.sections[0].controls.map((c) => c.bind), [{ param: 'k2' }, { x: { param: 'k1' }, y: { param: 'k3' } }]);
  assert.deepEqual(normalisierePanel(n), n, 'idempotent');
  const v2 = { format: 'cypherdj-panel/2', geraet: { art: 'bk', graph: 'g' }, sections: [] };
  assert.equal(normalisierePanel(v2), v2);
  const fremd = { format: 'x/9', graph: 'g' };
  assert.equal(normalisierePanel(fremd), fremd);
  assert.equal(normalisierePanel('x'), 'x');
  assert.deepEqual(pruefePanel(n, 'g', BEREICHE), [], 'a normalised panel validates');
});

test('v2 panel on synth-mono: k58 (the free number) is refused with the exact text', () => {
  const wurzel = path.join(import.meta.dirname, '..', '..', 'instruments', 'modular_dsp');
  const graph = JSON.parse(fs.readFileSync(path.join(wurzel, 'demos', 'synth-mono.json'), 'utf8'));
  const p = { format: 'cypherdj-panel/2', geraet: { art: 'bk', graph: 'synth-mono' }, sections: [{ id: 's', controls: [{ id: 'x', type: 'knob', bind: { param: 'k58' } }] }] };
  assert.deepEqual(pruefePanel(p, 'synth-mono', reglerBereiche(graph)), ['control "x": parameter k58 is not defined by the device']);
});

test('v2 panel: unknown parameter is named exactly; geraet is checked', () => {
  const v2 = (controls, geraet = { art: 'bk', graph: 'g' }) => ({ format: 'cypherdj-panel/2', geraet, sections: mitControls(controls) });
  assert.deepEqual(pruefePanel(v2([{ id: 'x', type: 'knob', bind: { param: 'k33' } }]), 'g', BEREICHE), ['control "x": parameter k33 is not defined by the device']);
  assert.deepEqual(pruefePanel(v2([{ id: 'x', type: 'knob', bind: { param: 'k1' } }]), 'g', BEREICHE), []);
  assert.match(pruefePanel(v2([{ id: 'x', type: 'knob', bind: { param: 'k1' } }], { art: 'bk', graph: 'h' }), 'g', BEREICHE)[0], /belongs to "g"/);
  assert.match(pruefePanel(v2([{ id: 'x', type: 'knob', bind: { param: 'k1' } }], { art: 'vst', graph: 'g' }), 'g', BEREICHE)[0], /geraet\.art must be "bk"/);
});

test('shipped panels: every file in modular_dsp/paneele binds only knobs its graph (beispiele/) defines', () => {
  const wurzel = path.join(import.meta.dirname, '..', '..', 'instruments', 'modular_dsp');
  const dateien = fs.readdirSync(path.join(wurzel, 'paneele')).filter((d) => d.endsWith('.json') && fs.existsSync(path.join(wurzel, 'demos', d)));   // bk panels; rb338/surge have no graph
  assert.ok(dateien.length >= 2, 'positive control: the shipped panels are there');
  for (const d of dateien) {
    const name = d.slice(0, -5);
    const graph = JSON.parse(fs.readFileSync(path.join(wurzel, 'demos', `${name}.json`), 'utf8'));
    const panel = JSON.parse(fs.readFileSync(path.join(wurzel, 'paneele', d), 'utf8'));
    assert.deepEqual(pruefePanel(panel, name, reglerBereiche(graph)), [], d);
    const n = normalisierePanel(panel);
    assert.equal(n.geraet.art, 'bk', d);
    assert.deepEqual(pruefePanel(n, name, reglerBereiche(graph)), [], `${d} normalised`);
    for (const c of steuerungen(n)) for (const pa of parameterVon(c)) assert.match(pa, /^k\d+$/, `${d}: ${c.id}`);
    assert.ok(steuerungen(normalisierePanel(panel)).some((c) => parameterVon(c).length), `${d}: it binds something`);
  }
  // negative control: the check would catch a drifted panel
  const drift = JSON.parse(fs.readFileSync(path.join(wurzel, 'paneele', dateien[0]), 'utf8'));
  const gebunden = drift.sections.flatMap((s) => s.controls).find((c) => c.type === 'knob');   // a note or a drawing binds nothing; take the first knob
  gebunden.bind = { param: 'k33' };
  assert.ok(pruefePanel(drift, dateien[0].slice(0, -5), reglerBereiche(JSON.parse(fs.readFileSync(path.join(wurzel, 'demos', dateien[0]), 'utf8')))).length > 0);
});

test('pure helpers: defaults, value text, keys, arc geometry', () => {
  assert.deepEqual(vorgaben(normalisierePanel(PANEL)), { k1: 0.5, k2: 0.25, k3: 2 / 3 });
  assert.deepEqual(vorgaben({ sections: [{ controls: [{ type: 'xy', bind: { x: { param: 'k1' }, y: { param: 'k2' } }, default: { x: 0.7 } }, { type: 'knob', bind: { param: 'k3' } }] }] }),
    { k1: 0.7, k2: 0.5 }, 'an xy default fills the missing axis with 0.5; a knob without default pushes nothing');
  assert.deepEqual(bereichVon(BEREICHE, 'k1'), BEREICHE[1]);
  assert.equal(bereichVon(BEREICHE, 'k9'), undefined);
  assert.equal(bereichVon(BEREICHE, 'cutoff'), undefined, 'a name that is no k<n> has no range here');
  assert.equal(vorgabeK({ type: 'knob' }), 0.5);
  assert.equal(vorgabeK({ type: 'switch', default: 0 }), 0);
  assert.equal(wertText({ type: 'knob', format: 'hz' }, 'k1', 0.5, BEREICHE), '1.80 kHz');
  assert.equal(wertText({ type: 'knob', format: 'hz' }, 'k1', 0.5, BEREICHE), formatiereWert(skaliere(0.5, BEREICHE[1]), 'hz'));
  assert.equal(wertText({ type: 'knob' }, 'k5', 0.25, BEREICHE), '25 %', 'no range known: percent of travel');
  assert.equal(wertText({ type: 'selector', options: ['LP', 'BP', 'HP'] }, 'k3', 0.5, BEREICHE), 'BP');
  assert.equal(wertText({ type: 'switch' }, 'k3', 1, BEREICHE), 'ON');
  assert.deepEqual(tastenSchritt('ArrowUp', false), { schritt: 0.01 });
  assert.deepEqual(tastenSchritt('ArrowLeft', true), { schritt: -0.001 });
  assert.deepEqual(tastenSchritt('PageUp', false), { schritt: 0.1 });
  assert.deepEqual(tastenSchritt('End'), { auf: 1 });
  assert.equal(tastenSchritt('a'), null);
  assert.equal(bogenPfad(32, 32, 26, 135, 135), '', 'an empty arc draws nothing');
  assert.match(bogenPfad(32, 32, 26, 135, 405), /^M[\d.]+ [\d.]+A26 26 0 1 1 /, 'the full sweep is a large arc, clockwise');
  assert.match(bogenPfad(32, 32, 26, 135, 200), /A26 26 0 0 1 /);
  assert.equal(knobWinkel(0), 135);
  assert.equal(knobWinkel(1), 405);
});

// ---- a tiny fake DOM, enough for panel.js ----
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
function baue(panel = PANEL, vorrat = {}) {
  const gesetzt = [], host = new K('div');
  const adapter = { get: (nr) => vorrat[nr], set: (nr, v) => { gesetzt.push([nr, v]); vorrat.__letzter = [nr, v]; } };
  const fp = baueFrontplatte(host, { panel: normalisierePanel(panel), regler: BEREICHE, adapter, dokument: DOK });
  const zelle = (id) => host.alles().find((e) => e.dataset?.id === id);
  return { fp, host, gesetzt, vorrat, zelle };
}
const nah = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('renderer: sections, titles, controls and the first readout (defaults, scaled with the unit)', () => {
  const { host, zelle } = baue();
  assert.equal(host.finde('fp-sektion').length, 1);
  assert.equal(host.finde('fp-sektionstitel')[0].textContent, 'FILTER');
  assert.deepEqual(host.finde('fp-zelle').map((z) => z.dataset.typ), ['knob', 'fader', 'selector', 'value', 'label', 'spacer']);
  assert.equal(host.finde('fp-gitter')[0].style.vars['--spalten'], '3');
  assert.equal(zelle('cut').finde('fp-wert')[0].textContent, '1.80 kHz');
  assert.equal(zelle('rd').finde('fp-wert')[0].textContent, '1.80 kHz', 'the value control follows its knob');
  assert.equal(zelle('dep').finde('fp-wert')[0].textContent, '750 Hz');
  assert.equal(zelle('typ').finde('fp-option').filter((b) => b.klassen.has('an'))[0].textContent, 'HP');
  assert.equal(zelle('cut').finde('fp-knopf')[0].attr.role, 'slider');
});

test('knob: vertical drag turns it (160 px for the full range), shift is five times finer, the value moves while dragging', () => {
  const { host, gesetzt, zelle } = baue();
  const knopf = zelle('cut').finde('fp-knopf')[0];
  knopf.feuere('pointerdown', { clientX: 10, clientY: 100 });
  knopf.feuere('pointermove', { clientX: 10, clientY: 60 });            // 40 px up
  nah(gesetzt.at(-1)[1], 0.75);
  assert.equal(gesetzt.at(-1)[0], 'k1');
  assert.equal(zelle('cut').finde('fp-wert')[0].textContent, formatiereWert(skaliere(0.75, BEREICHE[1]), 'hz'));
  assert.equal(zelle('rd').finde('fp-wert')[0].textContent, zelle('cut').finde('fp-wert')[0].textContent);
  knopf.feuere('pointermove', { clientX: 10, clientY: 20, shiftKey: true });   // 40 px more, fine
  nah(gesetzt.at(-1)[1], 0.75 + 40 / 800);
  knopf.feuere('pointermove', { clientX: 10, clientY: -500 });           // far past the end
  assert.equal(gesetzt.at(-1)[1], 1);
  knopf.feuere('pointermove', { clientX: 10, clientY: -460 });           // 40 px back: the overshoot counts as travel, so the knob stays at the end
  assert.equal(gesetzt.at(-1)[1], 1);
  knopf.feuere('pointerup');
  assert.ok(host.finde('fp-bogen')[0].attr.d.startsWith('M'), 'the value arc is drawn');
});

test('knob: double click returns to the panel default, wheel and arrow keys step, Home/End jump, touch pointer without button works', () => {
  const { gesetzt, zelle } = baue(PANEL, { k1: 0.9 });
  const knopf = zelle('cut').finde('fp-knopf')[0];
  knopf.feuere('dblclick');
  assert.equal(gesetzt.at(-1)[1], 0.5);
  knopf.feuere('wheel', { deltaY: -100 });
  nah(gesetzt.at(-1)[1], 0.51);
  knopf.feuere('wheel', { deltaY: 100, shiftKey: true });
  nah(gesetzt.at(-1)[1], 0.509);
  knopf.feuere('keydown', { key: 'ArrowDown' });
  nah(gesetzt.at(-1)[1], 0.499);
  knopf.feuere('keydown', { key: 'End' });
  assert.equal(gesetzt.at(-1)[1], 1);
  knopf.feuere('keydown', { key: 'Home' });
  assert.equal(gesetzt.at(-1)[1], 0);
  const n = gesetzt.length;
  knopf.feuere('keydown', { key: 'Tab' });
  assert.equal(gesetzt.length, n, 'other keys do nothing');
  knopf.feuere('pointerdown', { button: undefined, clientX: 0, clientY: 50 });   // a touch has no button
  knopf.feuere('pointermove', { clientX: 0, clientY: 10 });
  assert.ok(gesetzt.length > n);
});

test('guard: incoming values do not fight a control that is dragged or was just moved; later they are taken', () => {
  const echte = Date.now;
  let t = 1_000_000;
  Date.now = () => t;
  try {
    const { fp, gesetzt, vorrat, zelle } = baue(PANEL, {});
    const knopf = zelle('cut').finde('fp-knopf')[0];
    knopf.feuere('pointerdown', { clientX: 0, clientY: 100 });
    knopf.feuere('pointermove', { clientX: 0, clientY: 60 });
    vorrat.k1 = 0.1; vorrat.k2 = 0.9;
    t += 5000;
    fp.aktualisiere();
    nah(fp.werte().k1, 0.75);                       // still dragged: the echo of the core is ignored however late
    nah(fp.werte().k2, 0.9);                        // other knobs follow
    knopf.feuere('pointerup');
    fp.aktualisiere();
    nah(fp.werte().k1, 0.75);                       // just released: the echo of our own value is still on its way
    t += 500;
    fp.aktualisiere();
    nah(fp.werte().k1, 0.1);                        // later the core's value wins again (automation, Cypher)
    assert.equal(zelle('cut').finde('fp-wert')[0].textContent, formatiereWert(skaliere(0.1, BEREICHE[1]), 'hz'));
    assert.equal(gesetzt.filter(([nr]) => nr === 'k2').length, 0, 'pulling values in never writes back');
  } finally { Date.now = echte; }
});

test('fader jumps to a press on the groove, switch toggles, selector sets i/(n-1)', () => {
  const panel = { ...PANEL, sections: mitControls([
    { id: 'f', type: 'fader', bind: { regler: 2 }, orientation: 'horizontal' }, { id: 'w', type: 'switch', label: 'Sync', bind: { regler: 3 }, default: 1 },
    { id: 'sel', type: 'selector', bind: { regler: 1 }, options: ['a', 'b', 'c', 'd'] }]) };
  const { gesetzt, zelle } = baue(panel);
  const bahn = zelle('f').finde('fp-bahn')[0];
  bahn.feuere('pointerdown', { clientX: 50, clientY: 5 });              // bar is 200 px wide in the fake: 25 %
  nah(gesetzt.at(-1)[1], 0.25);
  assert.equal(zelle('f').klassen.has('waagrecht'), true);
  const schalter = zelle('w').finde('fp-schalter')[0];
  assert.equal(schalter.attr['aria-checked'], 'true');
  schalter.feuere('click');
  assert.deepEqual(gesetzt.at(-1), ['k3', 0]);
  assert.equal(schalter.attr['aria-checked'], 'false');
  zelle('sel').finde('fp-option')[2].feuere('click');
  nah(gesetzt.at(-1)[1], 2 / 3);
  assert.equal(gesetzt.at(-1)[0], 'k1');
  assert.equal(zelle('sel').finde('fp-option')[2].attr['aria-checked'], 'true');
});

test('xy: a press sets both axes from the pointer position, shift moves relatively, arrows step one axis, double click goes to the default', () => {
  const panel = { ...PANEL, sections: mitControls([{ id: 'p', type: 'xy', bind: { x: { regler: 1 }, y: { regler: 2 } }, default: { x: 0.7, y: 0.25 }, xformat: 'hz', yformat: 'hz' },
    { id: 'vx', type: 'value', of: 'p.x' }, { id: 'vy', type: 'value', of: 'p.y' }]) };
  const { fp, gesetzt, zelle } = baue(panel);
  nah(fp.werte().k1, 0.7);
  const feld = zelle('p').finde('fp-xy')[0];
  feld.feuere('pointerdown', { clientX: 50, clientY: 25 });             // 200 x 100 box: x 0.25, y 0.75 (up is more)
  nah(fp.werte().k1, 0.25); nah(fp.werte().k2, 0.75);
  assert.equal(feld.style.vars['--x'], '0.25');
  feld.feuere('pointermove', { clientX: 60, clientY: 25, shiftKey: true });
  nah(fp.werte().k1, 0.25 + 10 / 1000);
  feld.feuere('pointerup');
  feld.feuere('keydown', { key: 'ArrowUp' });
  nah(fp.werte().k2, 0.76);
  feld.feuere('keydown', { key: 'ArrowRight' });
  nah(fp.werte().k1, 0.25 + 10 / 1000 + 0.01);
  assert.equal(zelle('vx').finde('fp-wert')[0].textContent, formatiereWert(skaliere(fp.werte().k1, BEREICHE[1]), undefined, undefined));
  feld.feuere('dblclick');
  nah(fp.werte().k1, 0.7); nah(fp.werte().k2, 0.25);
  assert.ok(gesetzt.some(([nr]) => nr === 'k2'));
});

// ---- lever and touchpad ----
const HEBEL = { id: 'lv', type: 'lever', label: 'Gate', bind: { param: 'k1' }, zones: ['long', 'mid', 'short'] };
const FELD = { id: 'tp', type: 'touchpad', label: 'Pad', bind: { x: { param: 'k2' }, touch: { param: 'k3' } }, zones: ['1/8', '1/4', '1/2', '1/1', '2/1'] };

test('lever and touchpad validation: good ones pass; missing bind, equal parameters and bad zones are refused', () => {
  const einzel = (c) => fehler(mitControls([c])).join('|');
  assert.deepEqual(fehler(mitControls([HEBEL, FELD])), []);
  assert.deepEqual(fehler(mitControls([{ ...HEBEL, zones: undefined }, { ...FELD, zones: undefined }])), [], 'zones are optional');
  assert.match(einzel({ id: 'a', type: 'lever' }), /bind is missing/);
  assert.match(einzel({ id: 'a', type: 'lever', bind: {} }), /bind\.param must be a parameter name/);
  assert.match(einzel({ id: 'a', type: 'touchpad', bind: { x: { param: 'k1' } } }), /needs x and touch/);
  assert.match(einzel({ id: 'a', type: 'touchpad', bind: { x: { param: 'k1' }, touch: { param: 'k1' } } }), /already bound/);
  assert.match(einzel({ ...HEBEL, zones: [] }), /zones must be 1\.\.8 texts/);
  assert.match(einzel({ ...HEBEL, zones: ['much too long'] }), /zones must be 1\.\.8 texts of 1\.\.8/);
  assert.match(einzel({ ...FELD, zones: [1, 2] }), /zones must be/);
  assert.match(einzel({ ...FELD, zones: Array(9).fill('a') }), /zones must be/);
  assert.match(einzel({ id: 'a', type: 'knob', bind: { param: 'k1' }, zones: ['a'] }), /zones is only for lever and touchpad/);
  assert.match(einzel({ ...HEBEL, default: 0.5 }), /takes no default/);
  assert.match(fehler(mitControls([HEBEL, { id: 'b', type: 'knob', bind: { param: 'k1' } }])).join(), /already bound/, 'a lever parameter counts as bound');
  assert.match(fehler(mitControls([FELD, { id: 'v', type: 'value', of: 'tp.y' }])).join(), /may only name \.x/);
});

test('lever and touchpad: parameterVon, vorgabeK and vorgaben', () => {
  assert.deepEqual(parameterVon(HEBEL), ['k1']);
  assert.deepEqual(parameterVon(FELD), ['k2', 'k3'], '[x, touch]');
  assert.equal(vorgabeK(HEBEL), 0.5);
  assert.equal(vorgabeK({ ...HEBEL, default: 0.9 }), 0.5, 'a lever always rests in the middle');
  assert.deepEqual(vorgaben({ sections: [{ controls: [HEBEL] }] }), {}, 'a lever states no default');
  assert.deepEqual(vorgaben({ sections: [{ controls: [FELD] }] }), { k2: 0.5, k3: 0 });
  assert.deepEqual(vorgaben({ sections: [{ controls: [{ ...FELD, default: { x: 0.9 } }] }] }), { k2: 0.9, k3: 0 });
  assert.deepEqual(normalisierePanel({ ...PANEL, sections: [{ id: 's', controls: [FELD] }] }).sections[0].controls[0].bind, FELD.bind, 'v2 panels pass unchanged');
});

test('lever geometry: the limits are 5 %, 37 % and 68 % of the travel', () => {
  assert.equal(hebelWeg(0.5), 0); assert.equal(hebelWeg(1), 1); assert.equal(hebelWeg(0.2), 0);
  assert.deepEqual([0, 0.049, 0.05, 0.369, 0.37, 0.679, 0.68, 1].map(hebelBereich), [-1, -1, 0, 0, 1, 1, 2, 2]);
  assert.deepEqual([0, 0.19, 0.2, 0.99, 1].map((x) => feldZone(x, 5)), [0, 0, 1, 4, 4]);
});

test('lever: pulling is proportional to the travel, release springs back to 0.5 and ends the gesture, the zone lights while pulled', () => {
  const panel = { ...PANEL, sections: mitControls([HEBEL]) };
  const { gesetzt, zelle, fp } = baue(panel);
  const bahn = zelle('lv').finde('fp-hebel')[0];
  assert.equal(zelle('lv').finde('fp-wert')[0].textContent, 'rest');
  bahn.feuere('pointerdown', { clientX: 10, clientY: 10 });
  bahn.feuere('pointermove', { clientX: 10, clientY: 10 + 50 });         // the fake travel is 100 px high: half the way
  assert.deepEqual(gesetzt.at(-1), ['k1', 0.75]);
  assert.equal(zelle('lv').finde('fp-hebelzone').filter((x) => x.klassen.has('an')).map((x) => x.textContent).join(), 'mid');   // 50 % is in section 2
  assert.equal(zelle('lv').finde('fp-wert')[0].textContent, 'mid');
  bahn.feuere('pointermove', { clientX: 10, clientY: 500 });
  assert.deepEqual(gesetzt.at(-1), ['k1', 1], 'clamped at the full travel');
  assert.equal(zelle('lv').finde('fp-hebelzone').filter((x) => x.klassen.has('an')).map((x) => x.textContent).join(), 'short');
  bahn.feuere('pointermove', { clientX: 10, clientY: 10 - 40 });
  assert.deepEqual(gesetzt.at(-1), ['k1', 0.5], 'above the grab point: rest');
  bahn.feuere('pointermove', { clientX: 10, clientY: 10 + 20 });
  bahn.feuere('pointerup');
  assert.deepEqual(gesetzt.at(-1), ['k1', 0.5]);
  nah(fp.werte().k1, 0.5);
  assert.equal(zelle('lv').finde('fp-hebelzone').filter((x) => x.klassen.has('an')).length, 0);
});

test('lever: pointercancel and lostpointercapture spring back too; space holds it fully pulled; learn mode and a block do not move it', () => {
  const panel = { ...PANEL, sections: mitControls([HEBEL]) };
  const enden = [], host = new K('div'), gesetzt = [];
  let gesperrt = false;
  const adapter = { get: () => undefined, set: (nr, v) => gesetzt.push([nr, v]), ende: () => enden.push(gesetzt.length), gesperrt: () => gesperrt };
  baueFrontplatte(host, { panel: normalisierePanel(panel), regler: BEREICHE, adapter, dokument: DOK });
  const bahn = host.finde('fp-hebel')[0];
  for (const t of ['pointercancel', 'lostpointercapture']) {
    bahn.feuere('pointerdown', { clientY: 0 }); bahn.feuere('pointermove', { clientY: 80 });
    assert.deepEqual(gesetzt.at(-1), ['k1', 0.9]);
    bahn.feuere(t);
    assert.deepEqual(gesetzt.at(-1), ['k1', 0.5], t);
  }
  assert.equal(enden.length, 2, 'each release ends the gesture once (the second event of a pair finds no gesture)');
  bahn.feuere('keydown', { key: ' ' });
  assert.deepEqual(gesetzt.at(-1), ['k1', 1]);
  bahn.feuere('keydown', { key: ' ' });   // key repeat: nothing new
  const n = gesetzt.length;
  bahn.feuere('keydown', { key: ' ' });
  assert.equal(gesetzt.length, n);
  bahn.feuere('keyup', { key: ' ' });
  assert.deepEqual(gesetzt.at(-1), ['k1', 0.5]);
  assert.equal(enden.length, 3);
  gesperrt = true;
  const m = gesetzt.length;
  bahn.feuere('pointerdown', { clientY: 0 }); bahn.feuere('pointermove', { clientY: 80 });
  assert.equal(gesetzt.length, m, 'a blocked parameter does not move');
});

test('touchpad: a press sets x first, then touch; moving follows x; release clears touch and keeps x', () => {
  const panel = { ...PANEL, sections: mitControls([FELD]) };
  const { gesetzt, zelle, fp } = baue(panel);
  const feld = zelle('tp').finde('fp-feld')[0];
  assert.equal(zelle('tp').finde('fp-feldzone').length, 5);
  assert.equal(zelle('tp').finde('fp-feldzone').filter((x) => x.klassen.has('an')).length, 0, 'nothing lights untouched');
  nah(fp.werte().k2, 0.5); nah(fp.werte().k3, 0);
  feld.feuere('pointerdown', { clientX: 30, clientY: 5 });          // 200 px wide: x 0.15, zone 0
  assert.deepEqual(gesetzt.slice(0, 2), [['k2', 0.15], ['k3', 1]], 'x first, then touch');
  assert.equal(zelle('tp').finde('fp-feldzone')[0].klassen.has('an'), true);
  feld.feuere('pointermove', { clientX: 190, clientY: 5 });
  nah(fp.werte().k2, 0.95);
  assert.equal(zelle('tp').finde('fp-feldzone')[4].klassen.has('an'), true);
  assert.equal(zelle('tp').finde('fp-feldzone')[0].klassen.has('an'), false);
  feld.feuere('pointerup');
  assert.deepEqual(gesetzt.at(-1), ['k3', 0]);
  nah(fp.werte().k2, 0.95); nah(fp.werte().k3, 0);
  assert.equal(zelle('tp').finde('fp-feldzone').filter((x) => x.klassen.has('an')).length, 0);
  feld.feuere('pointerdown', { clientX: 100 }); feld.feuere('pointercancel');
  nah(fp.werte().k3, 0);
});

test('touchpad: arrows step by zone, space holds touch, a touchpad without zones is one field; learn takes x', () => {
  const panel = { ...PANEL, sections: mitControls([FELD, { id: 'ganz', type: 'touchpad', bind: { x: { param: 'k1' }, touch: { param: 'k4' } } }]) };
  const { gesetzt, zelle, fp } = baue(panel, { k2: 0.1 });
  const feld = zelle('tp').finde('fp-feld')[0];
  feld.feuere('keydown', { key: 'ArrowRight' });
  nah(fp.werte().k2, 0.3);
  feld.feuere('keydown', { key: 'ArrowLeft' }); feld.feuere('keydown', { key: 'ArrowLeft' });
  nah(fp.werte().k2, 0.1);
  feld.feuere('keydown', { key: ' ' });
  assert.deepEqual(gesetzt.at(-1), ['k3', 1]);
  feld.feuere('keyup', { key: ' ' });
  assert.deepEqual(gesetzt.at(-1), ['k3', 0]);
  const ganz = zelle('ganz');
  assert.equal(ganz.finde('fp-feldzone').length, 0);
  ganz.finde('fp-feld')[0].feuere('pointerdown', { clientX: 150 });
  assert.deepEqual(gesetzt.slice(-2), [['k1', 0.75], ['k4', 1]]);
  const g = [];
  const host = new K('div');
  baueFrontplatte(host, { panel: normalisierePanel({ ...PANEL, sections: mitControls([FELD]) }), regler: BEREICHE, adapter: { get: () => undefined, set() {}, lernPfad: (p) => `x/${p}` }, dokument: DOK, lernen: { an: true }, beiLernen: (p) => g.push(p) });
  const f2 = host.finde('fp-zelle')[0];
  f2.feuere('pointerdown', { clientX: 1, clientY: 1 }); f2.feuere('pointerup');
  assert.deepEqual(g, ['x/k2']);
});

// ---- MIDI learn on panel controls (Task 4) ----
function baueLernen(lernen, extra = {}, panel = PANEL) {
  const gelernt = [], vergessen = [], kopfInfo = [], gesetzt = [], host = new K('div');
  const adapter = { get: () => undefined, set: (nr, v) => gesetzt.push([nr, v]), ...('lernPfad' in extra ? (extra.lernPfad ? { lernPfad: extra.lernPfad } : {}) : { lernPfad: (p) => `erz/6/bk/${p.slice(1)}` }) };
  const fp = baueFrontplatte(host, { panel: normalisierePanel(panel), regler: BEREICHE, adapter, dokument: DOK, lernen,
    beiLernen: (p) => gelernt.push(p), beiVergessen: (p) => vergessen.push(p), kopf: (_e, info) => kopfInfo.push(info) });
  const zelle = (id) => host.alles().find((e) => e.dataset?.id === id);
  return { fp, host, gelernt, vergessen, kopfInfo, gesetzt, zelle };
}
const AUS = () => ({ an: false, wartet: null, gelernt: new Set() });

test('learn: with learn mode on, a click on the Cutoff knob arms learning for its path and leaves the value alone', () => {
  const { fp, zelle, gelernt, gesetzt } = baueLernen({ ...AUS(), an: true });
  const dreh = zelle('cut').finde('fp-knopf')[0];
  const vorher = fp.werte().k1;
  dreh.feuere('pointerdown', { clientX: 5, clientY: 50 });
  dreh.feuere('pointerup', { clientX: 5, clientY: 50 });
  assert.deepEqual(gelernt, ['erz/6/bk/1']);
  assert.equal(fp.werte().k1, vorher);
  assert.equal(gesetzt.length, 0, 'adapter.set is not called');
  dreh.feuere('wheel', { deltaY: -1 }); dreh.feuere('keydown', { key: 'ArrowUp' }); dreh.feuere('dblclick');
  assert.equal(gesetzt.length, 0, 'wheel, keys and double click do nothing while learning either');
});

test('learn: a drag in learn mode is no click (moved: nothing is armed, nothing moves)', () => {
  const { zelle, gelernt, gesetzt } = baueLernen({ ...AUS(), an: true });
  const dreh = zelle('cut').finde('fp-knopf')[0];
  dreh.feuere('pointerdown', { clientX: 5, clientY: 50 });
  dreh.feuere('pointermove', { clientX: 5, clientY: 10 });
  dreh.feuere('pointerup', { clientX: 5, clientY: 10 });
  assert.deepEqual(gelernt, []);
  assert.equal(gesetzt.length, 0);
});

test('learn: with learn mode off a drag still turns the knob and nothing is armed', () => {
  const { fp, zelle, gelernt } = baueLernen(AUS());
  const dreh = zelle('cut').finde('fp-knopf')[0];
  const vorher = fp.werte().k1;
  dreh.feuere('pointerdown', { clientX: 5, clientY: 50 });
  dreh.feuere('pointermove', { clientX: 5, clientY: 10 });
  dreh.feuere('pointerup', { clientX: 5, clientY: 10 });
  assert.ok(fp.werte().k1 > vorher);
  assert.deepEqual(gelernt, []);
});

test('learn: right click on a control forgets its assignment and suppresses the menu; off in normal mode', () => {
  const { zelle, vergessen } = baueLernen({ ...AUS(), an: true });
  const dreh = zelle('cut').finde('fp-knopf')[0];
  let verhindert = false;
  dreh.feuere('contextmenu', { preventDefault() { verhindert = true; } });
  assert.deepEqual(vergessen, ['erz/6/bk/1']);
  assert.ok(verhindert);
  const b = baueLernen(AUS());
  let v2 = false;
  b.zelle('cut').finde('fp-knopf')[0].feuere('contextmenu', { preventDefault() { v2 = true; } });
  assert.deepEqual(b.vergessen, []);
  assert.equal(v2, false, 'the browser menu stays outside learn mode');
});

test('learn: switch and selector controls are learnable too (the click does not toggle them)', () => {
  const panel = { ...PANEL, sections: mitControls([{ id: 'sw', type: 'switch', bind: { regler: 2 } }, { id: 'ty', type: 'selector', bind: { regler: 3 }, options: ['A', 'B'] }]) };
  const { zelle, gelernt, gesetzt } = baueLernen({ ...AUS(), an: true }, {}, panel);
  const sw = zelle('sw').finde('fp-schalter')[0];
  sw.feuere('pointerdown'); sw.feuere('pointerup'); sw.feuere('click');
  const gr = zelle('ty').finde('fp-wahl')[0];
  gr.feuere('pointerdown'); gr.feuere('pointerup');
  zelle('ty').finde('fp-option')[1].feuere('click');
  assert.deepEqual(gelernt, ['erz/6/bk/2', 'erz/6/bk/3']);
  assert.equal(gesetzt.length, 0);
});

test('learn: xy learns the x parameter (a MIDI controller drives one value; the y axis is learned on a separate control if wanted)', () => {
  const panel = { ...PANEL, sections: mitControls([{ id: 'p', type: 'xy', bind: { x: { regler: 2 }, y: { regler: 1 } } }]) };
  const { zelle, gelernt, vergessen, gesetzt } = baueLernen({ ...AUS(), an: true }, {}, panel);
  const feld = zelle('p').finde('fp-xy')[0];
  feld.feuere('pointerdown', { clientX: 50, clientY: 25 }); feld.feuere('pointerup', { clientX: 50, clientY: 25 });
  feld.feuere('contextmenu');
  assert.deepEqual(gelernt, ['erz/6/bk/2']);
  assert.deepEqual(vergessen, ['erz/6/bk/2']);
  assert.equal(gesetzt.length, 0);
});

test('learn: markers follow the stand: fp-gelernt for assigned paths, fp-wartet for the armed one; setzeLernen re-marks without rebuilding', () => {
  const { fp, zelle, host } = baueLernen({ an: true, wartet: 'erz/6/bk/2', gelernt: new Set(['erz/6/bk/1', 'erz/6/bk/2']) });
  const platte = host.finde('frontplatte')[0];
  assert.ok(zelle('cut').classList.contains('fp-gelernt'));
  assert.ok(!zelle('cut').classList.contains('fp-wartet'));
  assert.ok(zelle('dep').classList.contains('fp-wartet'));
  assert.ok(!zelle('typ').classList.contains('fp-gelernt'));
  assert.ok(platte.classList.contains('fp-lernmodus'));
  fp.setzeLernen({ an: false, wartet: null, gelernt: new Set(['erz/6/bk/3']) });
  assert.ok(!zelle('cut').classList.contains('fp-gelernt'));
  assert.ok(!zelle('dep').classList.contains('fp-wartet'));
  assert.ok(zelle('typ').classList.contains('fp-gelernt'));
  assert.ok(!platte.classList.contains('fp-lernmodus'));
  assert.equal(host.finde('frontplatte')[0], platte, 'same DOM, not rebuilt');
});

test('learn: the header hears whether learning is possible; an adapter without lernPfad offers no LEARN', () => {
  assert.equal(baueLernen(AUS()).kopfInfo[0].lernen, true);
  assert.equal(baueLernen(AUS(), { lernPfad: null }).kopfInfo[0].lernen, false);
  const o = baueLernen({ ...AUS(), an: true }, { lernPfad: null });
  const dreh = o.zelle('cut').finde('fp-knopf')[0];
  dreh.feuere('pointerdown'); dreh.feuere('pointerup');
  assert.deepEqual(o.gelernt, [], 'no path, nothing to arm');
});

test('learn: the whole cell is the target: a click on the cell itself (label area) arms learning; learn off: nothing', () => {
  const { zelle, gelernt, vergessen } = baueLernen({ ...AUS(), an: true });
  const z = zelle('cut');
  z.feuere('pointerdown', { clientX: 5, clientY: 50 }); z.feuere('pointerup', { clientX: 5, clientY: 50 });
  assert.deepEqual(gelernt, ['erz/6/bk/1']);
  z.feuere('contextmenu');
  assert.deepEqual(vergessen, ['erz/6/bk/1']);
  const b = baueLernen(AUS());
  b.zelle('cut').feuere('pointerdown'); b.zelle('cut').feuere('pointerup');
  assert.deepEqual(b.gelernt, []);
  const k = baueLernen({ ...AUS(), an: true });   // the knob element still learns exactly once (bubbles to the cell)
  const dreh = k.zelle('cut').finde('fp-knopf')[0];
  dreh.feuere('pointerdown', { clientX: 5, clientY: 50 }); dreh.feuere('pointerup', { clientX: 5, clientY: 50 });
  assert.deepEqual(k.gelernt, ['erz/6/bk/1']);
});

test('device register: every shipped panel is v2, valid against the parameter table, its accent is the register accent; pruefeGeraete finds a missing panel', { skip: OHNE_DOKU }, () => {
  const P = pfadeVon();
  const reg = ladeRegister();
  assert.ok(reg.length >= 10, 'positive control: the register lists the devices');
  const dateien = fs.readdirSync(P.paneele).filter((d) => d.endsWith('.json'));
  for (const d of dateien) {
    const name = d.slice(0, -5);
    const e = reg.find((x) => x.name === name);
    assert.ok(e, `${d} is listed in geraete.json`);
    const panel = JSON.parse(fs.readFileSync(path.join(P.paneele, d), 'utf8'));
    assert.equal(panel.format, 'cypherdj-panel/2', d);
    assert.equal(panel.akzent, e.akzent, `${d}: accent is the register's`);
    const geraet = e.art === 'bk' ? { art: 'bk', graph: name } : { art: e.art };
    assert.deepEqual(panel.geraet, geraet, d);
    const regler = e.art === 'bk' ? reglerBereiche(JSON.parse(fs.readFileSync(path.join(P.beispiele, `${name}.json`), 'utf8'))) : {};
    assert.deepEqual(pruefePanel(panel, name, regler, parameterTabelle(geraet).map((p) => p.name)), [], d);
  }
  assert.deepEqual(reg.map((e) => e.name).filter((n) => !dateien.includes(`${n}.json`)), [], 'every register entry has a panel file');
  assert.deepEqual(pruefeGeraete(), []);
  // negative controls on a copy: a missing panel, a wrong accent
  const kopie = fs.mkdtempSync(path.join(os.tmpdir(), 'geraete-'));
  const Q = pfadeVon(kopie);
  fs.mkdirSync(Q.bk, { recursive: true });
  for (const sub of ['demos', 'paneele']) fs.cpSync(path.join(P.bk, sub), path.join(Q.bk, sub), { recursive: true });
  fs.copyFileSync(P.register, Q.register);
  fs.cpSync(P.doku, Q.doku, { recursive: true });
  fs.mkdirSync(path.dirname(Q.surge), { recursive: true }); fs.copyFileSync(P.surge, Q.surge);
  assert.deepEqual(pruefeGeraete(kopie), []);
  fs.rmSync(path.join(Q.paneele, 'rb338.json'));
  assert.deepEqual(pruefeGeraete(kopie), ['rb338: no panel']);
  fs.copyFileSync(path.join(P.paneele, 'rb338.json'), path.join(Q.paneele, 'rb338.json'));
  const bunt = JSON.parse(fs.readFileSync(path.join(Q.paneele, 'surge.json'), 'utf8')); bunt.akzent = 'rot';
  fs.writeFileSync(path.join(Q.paneele, 'surge.json'), JSON.stringify(bunt));
  assert.match(pruefeGeraete(kopie)[0], /surge: panel akzent rot differs from the register \(gruen\)/);
  fs.writeFileSync(path.join(Q.paneele, 'surge.json'), JSON.stringify({ ...bunt, akzent: 'gruen' }));
  const mono = JSON.parse(fs.readFileSync(path.join(Q.paneele, 'synth-mono.json'), 'utf8'));
  fs.writeFileSync(path.join(Q.paneele, 'synth-mono.json'), JSON.stringify({ ...mono, geraet: { art: 'rb338' } }));
  const abweichung = pruefeGeraete(kopie);
  assert.ok(abweichung.some((z) => /^synth-mono: panel geraet is \{"art":"rb338"\} but the register says \{"art":"bk","graph":"synth-mono"\}/.test(z)), abweichung.join('\n'));
  fs.writeFileSync(path.join(Q.paneele, 'synth-mono.json'), JSON.stringify({ ...mono, geraet: { art: 'bk', graph: 'synth-poly' } }));
  assert.ok(pruefeGeraete(kopie).some((z) => /^synth-mono: panel geraet is/.test(z)), 'a bk panel of another graph is reported');
  fs.writeFileSync(path.join(Q.paneele, 'synth-mono.json'), JSON.stringify(mono));
  fs.writeFileSync(Q.surge, JSON.stringify({ parameter: { nur_einer: { carla: 'One', punkte: [0, 1] } } }));
  assert.ok(pruefeGeraete(kopie).some((z) => /^surge: panel: .*is not defined by the device/.test(z)), 'the surge table is read from the given root');
  fs.rmSync(kopie, { recursive: true, force: true });
});

test('pruefePanel: akzent is one of the seven tokens; rb338 binds are checked against the parameter table', () => {
  const rb = (controls, extra = {}) => ({ format: 'cypherdj-panel/2', geraet: { art: 'rb338' }, sections: [{ id: 's', controls }], ...extra });
  const namen = parameterTabelle({ art: 'rb338' }).map((p) => p.name);
  assert.deepEqual(pruefePanel(rb([{ id: 'c', type: 'knob', bind: { param: 'cutoff' } }], { akzent: 'gelb' }), 'x', {}, namen), []);
  assert.match(pruefePanel(rb([{ id: 'c', type: 'knob', bind: { param: 'cutoff' } }], { akzent: '#ff0' }), 'x', {}, namen)[0], /akzent must be one of/);
  assert.equal(pruefePanel(rb([{ id: 'c', type: 'knob', bind: { param: 'nope' } }]), 'x', {}, namen)[0], 'control "c": parameter nope is not defined by the device');
});

// ---- touch: one gesture per pointer id (task 10) ----
const MULTI = { ...PANEL, sections: [{ id: 's1', cols: 3, controls: [
  { id: 'cut', type: 'knob', label: 'Cutoff', bind: { regler: 1 }, format: 'hz', default: 0.5 },
  { id: 'dep', type: 'knob', label: 'Depth', bind: { regler: 2 }, format: 'hz', default: 0.25 },
  { id: 'lev', type: 'fader', label: 'Level', bind: { regler: 3 }, default: 0.4 },
] }] };
const touch = (id, extra = {}) => ({ pointerId: id, pointerType: 'touch', button: undefined, ...extra });

test('touch: two fingers on two knobs move both at once, each ends on its own pointer up', () => {
  const { gesetzt, zelle, host } = baue(MULTI, {});
  let enden = 0;
  const a = zelle('cut').finde('fp-knopf')[0], b = zelle('dep').finde('fp-knopf')[0];
  a.feuere('pointerdown', touch(1, { clientX: 10, clientY: 100 }));
  b.feuere('pointerdown', touch(2, { clientX: 90, clientY: 100 }));
  a.feuere('pointermove', touch(1, { clientX: 10, clientY: 60 }));       // finger 1: 40 px up
  b.feuere('pointermove', touch(2, { clientX: 90, clientY: 80 }));       // finger 2: 20 px up
  a.feuere('pointermove', touch(1, { clientX: 10, clientY: 20 }));       // and 40 px more
  const letzter = (nr) => gesetzt.filter(([n]) => n === nr).at(-1)[1];
  nah(letzter('k1'), 0.5 + 80 / 160);
  nah(letzter('k2'), 0.25 + 20 / 160);
  a.feuere('pointerup', touch(1));
  b.feuere('pointermove', touch(2, { clientX: 90, clientY: 60 }));       // finger 2 still turns after finger 1 left
  nah(letzter('k2'), 0.25 + 40 / 160);
  b.feuere('pointerup', touch(2));
  assert.ok(host && enden === 0);
});

test('touch: a second finger on the same knob starts no gesture (it rests, so the first finger turns finer); its moves and its lifting do not touch the first', () => {
  const { gesetzt, zelle } = baue(MULTI, {});
  const a = zelle('cut').finde('fp-knopf')[0];
  a.feuere('pointerdown', touch(1, { clientX: 0, clientY: 100 }));
  a.feuere('pointerdown', touch(2, { clientX: 50, clientY: 100 }));      // second finger on the same knob: no new gesture
  a.feuere('pointermove', touch(2, { clientX: 50, clientY: 0 }));        // its moves do not turn the knob
  assert.equal(gesetzt.length, 0);
  a.feuere('pointermove', touch(1, { clientX: 0, clientY: 60 }));
  nah(gesetzt.at(-1)[1], 0.5 + 40 / 800, 'the second finger rests on the plate: fine');
  a.feuere('pointerup', touch(2));                                       // lifting it does not end finger 1's gesture, and the ratio is normal again
  a.feuere('pointermove', touch(1, { clientX: 0, clientY: 20 }));
  nah(gesetzt.at(-1)[1], 0.5 + 40 / 800 + 0.25);
  a.feuere('pointerup', touch(1));
});

test('touch: a second finger resting on the background makes the moving finger five times finer; lifting it restores the normal ratio', () => {
  const { gesetzt, zelle, host } = baue(MULTI, {});
  const a = zelle('cut').finde('fp-knopf')[0];
  a.feuere('pointerdown', touch(1, { clientX: 0, clientY: 100 }));
  a.feuere('pointermove', touch(1, { clientX: 0, clientY: 60 }));
  nah(gesetzt.at(-1)[1], 0.75);
  host.feuere('pointerdown', touch(2, { target: host }));                // resting finger on the plate background
  a.feuere('pointermove', touch(1, { clientX: 0, clientY: 20 }));        // 40 px at one fifth: 0.05
  nah(gesetzt.at(-1)[1], 0.75 + 40 / 800);
  host.feuere('pointerup', touch(2, { target: host }));
  a.feuere('pointermove', touch(1, { clientX: 0, clientY: -20 }));       // 40 px at full ratio: 0.25
  nah(gesetzt.at(-1)[1], 1, '0.8 + 0.25 clamps at the end');
  a.feuere('pointerup', touch(1));
  // a finger that lands on another control is a gesture of its own, not a resting finger
  const b = zelle('dep').finde('fp-knopf')[0];
  b.feuere('pointerdown', touch(1, { clientX: 0, clientY: 100 }));
  a.feuere('pointerdown', touch(3, { clientX: 0, clientY: 100 }));
  b.feuere('pointermove', touch(1, { clientX: 0, clientY: 60 }));
  nah(gesetzt.filter(([nr]) => nr === 'k2').at(-1)[1], 0.25 + 0.25, 'full ratio: a finger on a control does not slow the other');
  b.feuere('pointerup', touch(1)); a.feuere('pointerup', touch(3));
});

test('touch: double tap returns to the default, a slow second tap or a drag does not; works for fader and knob', () => {
  const echte = Date.now;
  let t = 2_000_000;
  Date.now = () => t;
  try {
    const { gesetzt, zelle } = baue(MULTI, { k1: 0.9, k3: 0.9 });
    const a = zelle('cut').finde('fp-knopf')[0];
    const tipp = (el, id) => { el.feuere('pointerdown', touch(id, { clientX: 5, clientY: 50 })); t += 60; el.feuere('pointerup', touch(id, { clientX: 5, clientY: 50 })); };
    tipp(a, 1); t += 120; tipp(a, 1);
    assert.equal(gesetzt.at(-1)[1], 0.5, 'double tap on a knob: default');
    const n = gesetzt.length;
    tipp(a, 1); t += 600; tipp(a, 1);
    assert.equal(gesetzt.length, n, 'two slow taps are no double tap');
    a.feuere('pointerdown', touch(1, { clientX: 0, clientY: 100 }));
    a.feuere('pointermove', touch(1, { clientX: 0, clientY: 60 }));
    t += 50; a.feuere('pointerup', touch(1, { clientX: 0, clientY: 60 }));
    t += 100; a.feuere('pointerdown', touch(1, { clientX: 0, clientY: 60 }));
    t += 50; a.feuere('pointerup', touch(1, { clientX: 0, clientY: 60 }));
    assert.notEqual(gesetzt.at(-1)[1], 0.5, 'a drag followed by a tap is no double tap');
    const f = zelle('lev').finde('fp-bahn')[0];
    f.feuere('pointerdown', touch(2, { clientX: 5, clientY: 50 })); t += 60; f.feuere('pointerup', touch(2, { clientX: 5, clientY: 50 }));
    t += 120;
    f.feuere('pointerdown', touch(2, { clientX: 5, clientY: 50 })); t += 60; f.feuere('pointerup', touch(2, { clientX: 5, clientY: 50 }));
    nah(gesetzt.filter(([nr]) => nr === 'k3').at(-1)[1], 0.4);
  } finally { Date.now = echte; }
});

test('touch: zerstoere takes the background listeners off the host (the plate is rebuilt on the same host)', () => {
  const { fp, host } = baue(MULTI, {});
  const vorher = Object.values(host.ev).flat().length;
  assert.ok(vorher > 0, 'the plate listens on its host');
  host.removeEventListener = (t, f) => { host.ev[t] = (host.ev[t] ?? []).filter((x) => x !== f); };
  fp.zerstoere();
  assert.equal(Object.values(host.ev).flat().length, 0);
});

// A resting finger must not stay "down" forever when its end is lost (cancel, lost capture, tab hidden, app switch)
function mitDok() {
  const ev = {};
  const dok = { ...DOK, addEventListener: (t, f) => { (ev[t] ??= []).push(f); }, removeEventListener: (t, f) => { ev[t] = (ev[t] ?? []).filter((x) => x !== f); }, hidden: false };
  const gesetzt = [], host = new K('div');
  const fp = baueFrontplatte(host, { panel: normalisierePanel(MULTI), regler: BEREICHE, adapter: { get: () => undefined, set: (nr, v) => { gesetzt.push([nr, v]); } }, dokument: dok });
  return { fp, host, gesetzt, ev, dok, knopf: () => host.alles().find((e) => e.dataset?.id === 'cut').finde('fp-knopf')[0] };
}
const stufe = (m) => { const { host, gesetzt, knopf } = m; const a = knopf(); const n0 = gesetzt.length; a.feuere('pointerdown', touch(1, { clientX: 0, clientY: 100 })); a.feuere('pointermove', touch(1, { clientX: 0, clientY: 60 })); a.feuere('pointerup', touch(1)); void host; return gesetzt.at(-1)[1] - (n0 ? gesetzt[n0 - 1][1] : 0.5); };

test('touch: a resting finger is forgotten on pointercancel, lostpointercapture, visibilitychange, blur and after a timeout; a moving one stays', () => {
  const echte = Date.now;
  let t = 3_000_000;
  Date.now = () => t;
  try {
    const rest = (m, id = 7) => m.host.feuere('pointerdown', touch(id, { target: m.host }));
    // baseline: a resting finger makes a 40 px drag 0.05 (fine); a normal drag 0.25
    let m = mitDok();
    rest(m); nah(stufe(m), 0.05);
    m = mitDok(); nah(stufe(m), 0.25);
    m = mitDok(); rest(m); m.host.feuere('pointercancel', touch(7, { target: m.host })); nah(stufe(m), 0.25);
    m = mitDok(); rest(m); m.host.feuere('lostpointercapture', touch(7, { target: m.host })); nah(stufe(m), 0.25);
    m = mitDok(); rest(m); m.dok.hidden = true; for (const f of m.ev.visibilitychange ?? []) f({}); nah(stufe(m), 0.25);
    m = mitDok(); rest(m); for (const f of m.ev.blur ?? []) f({}); nah(stufe(m), 0.25);
    m = mitDok(); rest(m); t += 31_000; nah(stufe(m), 0.25);   // nothing heard from it for 31 s
    m = mitDok(); rest(m); t += 20_000; m.host.feuere('pointermove', touch(7, { target: m.host })); t += 20_000; nah(stufe(m), 0.05);   // a finger that still moves is alive
    m = mitDok(); rest(m); m.fp.zerstoere(); assert.equal((m.ev.visibilitychange ?? []).length, 0, 'zerstoere takes the document listeners off');
  } finally { Date.now = echte; }
});
