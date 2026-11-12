// Panel format extensions: layout rows, pages, scales, glyph options, display types (Task 1 of the surfaces plan).
import test from 'node:test';
import assert from 'node:assert/strict';
import { reglerBereiche, pruefePanel } from '../graphs.ts';
import { GLYPHEN } from '../public/panel_glyphen.js';
import { formatiereWert } from '../public/panel_skala.js';

const GRAPH = { knoten: [1, 2, 3, 4, 5, 6, 7, 8].map((nr) => ({ art: 'regler', nr, min: 0, max: 1 })) };
const B = reglerBereiche(GRAPH);
const K = (id, n, extra = {}) => ({ id, type: 'knob', label: id, bind: { param: `k${n}` }, format: 'percent', ...extra });
const basis = (over = {}) => ({
  format: 'cypherdj-panel/2', geraet: { art: 'bk', graph: 'g' }, title: 'G',
  sections: [
    { id: 'osc', controls: [K('a', 1), { id: 'wave', type: 'selector', label: 'Wave', bind: { param: 'k2' }, options: ['Saw', 'Tri', 'Sine'], default: 0 }] },
    { id: 'env', controls: [K('att', 3), K('dec', 4), K('sus', 5), K('rel', 6)] },
    { id: 'flt', controls: [K('cut', 7), { id: 'typ', type: 'selector', label: 'Type', bind: { param: 'k8' }, options: ['LP', 'HP'], default: 0 }] },
  ],
  ...over,
});
const pruefe = (p) => pruefePanel(p, 'g', B);

test('a v2 panel with layout rows and pages over existing ids passes (positive control)', () => {
  const p = basis({ layout: { rows: [['osc', 'env'], ['flt']] }, pages: [{ id: 'main', title: 'Main' }, { id: 'mod', title: 'Mod' }] });
  p.sections[1].page = 'mod';
  assert.deepEqual(pruefe(p), []);
});

test('layout: unknown and duplicate section ids are reported', () => {
  assert.deepEqual(pruefe(basis({ layout: { rows: [['osc', 'x']] } })), ['layout: unknown section "x"']);
  assert.deepEqual(pruefe(basis({ layout: { rows: [['osc'], ['osc', 'env']] } })), ['layout: section "osc" named twice']);
  assert.ok(pruefe(basis({ layout: { rows: 'osc' } })).length >= 1);
});

test('pages: a section page naming an unknown page is reported', () => {
  const p = basis({ pages: [{ id: 'main', title: 'Main' }] });
  p.sections[0].page = 'nope';
  assert.deepEqual(pruefe(p), ['section "osc": page "nope" is not in pages']);
  const q = basis(); q.sections[0].page = 'main';
  assert.equal(pruefe(q).length, 1, 'page without pages is reported too');
});

test('scale: ticks outside 2..21 and bad labels are reported, valid ones pass', () => {
  const ok = basis(); ok.sections[0].controls[0].scale = { ticks: 11 };
  assert.deepEqual(pruefe(ok), []);
  for (const ticks of [1, 22, 2.5, 'x']) {
    const p = basis(); p.sections[0].controls[0].scale = { ticks };
    assert.equal(pruefe(p).length, 1, `ticks ${ticks}`);
    assert.match(pruefe(p)[0], /scale\.ticks must be an integer 2\.\.21/);
  }
  const p = basis(); p.sections[0].controls[0].scale = { labels: ['a', 'b'] };
  assert.deepEqual(pruefe(p), []);
  p.sections[0].controls[0].scale = { labels: [1, 2] };
  assert.equal(pruefe(p).length, 1);
});

test('glyphs: wrong length and unknown ids are reported; null entries and shared glyphs pass', () => {
  assert.equal(GLYPHEN.length, 13);
  const g = (glyphs) => { const p = basis(); p.sections[0].controls[1].glyphs = glyphs; return pruefe(p); };
  assert.deepEqual(g(['saw', 'tri', 'sine']), []);
  assert.deepEqual(g(['saw', null, 'saw']), []);
  assert.equal(g(['saw', 'tri']).length, 1);
  assert.deepEqual(g(['saw', 'wobble', 'sine']), ['control "wave": unknown glyph "wobble"']);
});

test('display types pass, bind nothing and are not counted as bindings', () => {
  const p = basis();
  p.sections[1].controls.push(
    { id: 'hue', type: 'huelle', of: { a: 'att', d: 'dec', s: 'sus', r: 'rel' } },
    { id: 'hue2', type: 'huelle', of: { a: 0.002, d: 'dec', s: 'sus', r: 'rel' } },
    { id: 'lf', type: 'lfoform', of: { form: 'wave' }, formen: ['saw', 'tri', 'sine'] },
    { id: 'lf1', type: 'lfoform', formen: ['sine'] },
    { id: 'fk', type: 'filterkurve', of: { cutoff: 'cut', reso: 'att', typ: 'typ' }, typen: [{ art: 'lp', pole: 4 }, { art: 'hp', pole: 2 }] },
    { id: 'sp', type: 'spektrum' });
  assert.deepEqual(pruefe(p), []);
  // a display never binds: a bind on it does not claim k1 a second time
  const q = basis(); q.sections[0].controls.push({ id: 'h', type: 'huelle', of: { a: 'att', d: 'dec', s: 'sus', r: 'rel' }, bind: { param: 'k1' } });
  assert.deepEqual(pruefe(q), []);
});

test('display types: missing ids, wrong lengths, bad forms are reported', () => {
  const add = (c) => { const p = basis(); p.sections[1].controls.push(c); return pruefe(p); };
  assert.match(add({ id: 'h', type: 'huelle', of: { a: 'att', d: 'gone', s: 'sus', r: 'rel' } })[0], /of\.d "gone" does not name a control/);
  assert.match(add({ id: 'h', type: 'huelle', of: { a: 'att', d: 'dec', s: 'sus' } })[0], /of\.r is missing/);
  assert.match(add({ id: 'h', type: 'huelle', of: { a: 'att', d: 'dec', s: 'sus', r: 'wave' } })[0], /does not name a knob or fader/);
  assert.match(add({ id: 'h', type: 'huelle', of: { a: 'att', d: 'dec', s: 1.5, r: 'rel' } })[0], /of\.s 1\.5 is out of range \(0 to 1\)/);
  assert.deepEqual(add({ id: 'h', type: 'huelle', of: { a: 0.002, d: 'dec', s: 0.7, r: 3 } }), []);   // a fixed sustain level inside 0..1, fixed seconds above 1
  assert.match(add({ id: 'h', type: 'huelle', of: { a: -1, d: 'dec', s: 'sus', r: 'rel' } })[0], /of\.a -1 is out of range/);
  assert.match(add({ id: 'l', type: 'lfoform', of: { form: 'wave' }, formen: ['saw', 'tri'] })[0], /formen has 2 entries but "wave" has 3 options/);
  assert.match(add({ id: 'l', type: 'lfoform', formen: ['saw', 'tri'] })[0], /formen needs one entry without of\.form/);
  assert.match(add({ id: 'l', type: 'lfoform', formen: ['wobble'] })[0], /unknown glyph "wobble"/);
  assert.match(add({ id: 'f', type: 'filterkurve', of: { cutoff: 'cut', reso: 'att', typ: 'typ' }, typen: [{ art: 'lp', pole: 4 }] })[0], /typen has 1 entries but "typ" has 2 options/);
  assert.match(add({ id: 'f', type: 'filterkurve', of: { cutoff: 'cut', reso: 'att' }, typen: [{ art: 'xx', pole: 3 }] })[0], /typen entries need art lp, bp or hp and pole 2 or 4/);
  assert.match(add({ id: 'f', type: 'filterkurve', of: { cutoff: 'cut' }, typen: [{ art: 'lp', pole: 4 }] })[0], /of\.reso is missing/);
});

test('einheitlos is accepted and prints nothing extra in the readout', () => {
  const p = basis(); p.sections[0].controls[0].einheitlos = true;
  assert.deepEqual(pruefe(p), []);
  assert.equal(formatiereWert(0.5, 'raw', undefined), '0.50');
});
