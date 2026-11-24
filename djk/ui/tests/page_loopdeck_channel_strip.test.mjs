// Loop deck lane strip row: HI MID LOW, COLOR, HALL, DLY knobs and the keys 1 2 3, STRIP toggle. Stubbed requests, DOM stand-in, no studio port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere } from './helpers/pages_mock.mjs';
import { KERN, kernAusX, kernZuX } from '../public/curves.js';

const HTML = '<body><div id="meldung"></div><section id="platz-loops"><div class="loopdeck" data-deck="1"></div></section><section id="platz-loops2"><div class="loopdeck" data-deck="2"></div></section></body>';
const ruhe = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok)); };
const lauf0 = () => ({ zelle: null, verwaist: false, ab_beat: 0, versatz_beats: 0, wartend: null, zuletzt: null });
const spur = (nr, extra = {}) => ({ spur_id: `s${nr}`, nr, name: `L1.${nr}`, fader_db: 0, mute: false, filter: 0, zellen: [null, null, null, null, null, null, null, null], lauf: lauf0(),
  eq: { tief: 0, mitte: 0, hoch: 0 }, kill: { tief: false, mitte: false, hoch: false }, send: { hall: -200, delay: -200 }, fx: { 1: false, 2: false, 3: false }, effekt: null, ...extra });
const deck1 = (extra = {}) => ({ gruppe_id: 'g1', platz: 1, raster: '1', spuren: [1, 2, 3, 4].map((n) => spur(n, n === 1 ? extra : {})) });

async function start(extra = {}, antworten = {}, nachInstall = () => {}) {
  const stand = { decks: { 1: deck1(extra), 2: null }, beat: 16, bpm: 120 };
  const a = installiere({ html: HTML, antworten: { 'GET /loopdeck/stand': () => ({ j: stand }), 'POST /loopdeck/neu': { j: { ok: true } }, 'POST /loopdeck/spur': { j: { ok: true } }, ...antworten } });
  nachInstall();
  const m = await import('../public/loopdeck/view.js');
  m.zuruecksetzen();
  m.zeigeLoopdecks();
  await ruhe();
  return { a, m };
}
const posts = (a) => a.anrufe.filter((c) => c.methode === 'POST');
const deck = (n = 1) => document.querySelector(`.loopdeck[data-deck="${n}"]`);
const strip = (s = 1) => deck().querySelectorAll('.ld-spur')[s - 1].querySelector('.ld-strip');
const mini = (band, s = 1) => strip(s).querySelectorAll('.ld-einheit')[['hoch', 'mitte', 'tief'].indexOf(band)];
const farbe = (s = 1) => strip(s).querySelector('.ld-color');
const sendKnopf = (art, s = 1) => deck().querySelectorAll('.ld-spur')[s - 1].querySelector(`.ld-send[data-send="${art}"] .ld-mini`);
const fxTaste = (u, s = 1) => strip(s).querySelector(`.ld-fxtaste[data-einheit="${u}"]`);

test('each lane strip has HI MID LOW, COLOR, HALL, DLY knobs in that order and the keys 1 2 3; no kill keys, no effect chip', async () => {
  const { m: m0 } = await start();
  for (let s = 1; s <= 4; s++) {
    assert.deepEqual(strip(s).querySelectorAll('.ld-einheit').map((e) => e.querySelector('.ld-sendname').textContent), ['HI', 'MID', 'LOW', 'FILTER', 'HALL', 'DLY']);
    assert.equal(strip(s).querySelectorAll('.ld-mini').length, 6);
    assert.deepEqual(strip(s).querySelectorAll('.ld-fxtaste').map((b) => b.textContent), ['1', '2', '3']);
    assert.equal(strip(s).querySelectorAll('.ld-band').length, 0);
    assert.equal(deck().querySelectorAll('.ld-fx').length, 0);
  }
  const taste = deck().querySelector('.ld-strip-taste');
  assert.equal(taste.textContent, 'STRIP');
  assert.equal(deck().classList.contains('mit-strip'), m0.STRIP_VORGABE);   // the default is the constant (collapsed at the measured place)
});

test('dragging MID posts the dB of the EQ law; double click posts 0', async () => {
  const { a } = await start();
  const k = mini('mitte').querySelector('.ld-mini');
  k.dispatch('pointerdown', { clientY: 150, pointerId: 1 }); k.dispatch('pointermove', { clientY: 120 }); k.dispatch('pointerup'); await ruhe();
  const db = posts(a).at(-1).koerper.eq.mitte;
  const erwartet = Math.round(kernAusX(KERN.eq, kernZuX(KERN.eq, 0) + 30 / 150) * 100) / 100;
  assert.deepEqual(posts(a).at(-1), { url: '/loopdeck/spur', methode: 'POST', koerper: { deck: 1, spur: 1, eq: { mitte: erwartet } } });
  assert.ok(db > 0 && db <= 6);
  k.dispatch('dblclick'); await ruhe();
  assert.deepEqual(posts(a).at(-1).koerper, { deck: 1, spur: 1, eq: { mitte: 0 } });
});

test('dragging a knob all the way down is -200 dB (the band off end of the law)', async () => {
  const { a } = await start();
  const k = mini('hoch', 2).querySelector('.ld-mini');
  k.dispatch('pointerdown', { clientY: 0, pointerId: 1 }); k.dispatch('pointermove', { clientY: 400 }); k.dispatch('pointerup'); await ruhe();
  assert.deepEqual(posts(a).at(-1).koerper, { deck: 1, spur: 2, eq: { hoch: -200 } });
});

test('a band whose kill is on shows its knob fully left; turning it sends the eq value and kill off together', async () => {
  const { a } = await start({ eq: { tief: 0, mitte: 0, hoch: -6 }, kill: { tief: false, mitte: false, hoch: true } });
  const hi = mini('hoch').querySelector('.ld-mini');
  assert.equal(hi.getAttribute('aria-valuenow'), '-200.00');
  assert.equal(mini('mitte').querySelector('.ld-mini').getAttribute('aria-valuenow'), '0.00');
  hi.dispatch('pointerdown', { clientY: 150, pointerId: 1 }); hi.dispatch('pointermove', { clientY: 120 }); hi.dispatch('pointerup'); await ruhe();
  const k = posts(a).at(-1).koerper;
  assert.deepEqual(Object.keys(k), ['deck', 'spur', 'eq', 'kill']);
  assert.ok(k.eq.hoch > -200); assert.deepEqual(k.kill, { hoch: false });
  assert.ok(k.eq.hoch !== undefined);
});

test('COLOR writes the lane filter and a double click goes back to the centre', async () => {
  const { a } = await start();
  const k = farbe().querySelector('.ld-mini');
  k.dispatch('pointerdown', { clientY: 150, pointerId: 1 }); k.dispatch('pointermove', { clientY: 120 }); k.dispatch('pointerup'); await ruhe();
  const f = posts(a).at(-1).koerper;
  assert.deepEqual(Object.keys(f), ['deck', 'spur', 'filter']); assert.ok(f.filter > 0 && f.filter <= 1);
  k.dispatch('dblclick'); await ruhe();
  assert.deepEqual(posts(a).at(-1).koerper, { deck: 1, spur: 1, filter: 0 });
});

test('COLOR exists once per lane: the foot has no COLOR knob, the STRIP row keeps it', async () => {
  await start();
  for (let s = 1; s <= 4; s++) {
    const fuss = deck().querySelectorAll('.ld-spur')[s - 1].querySelector('.ld-fuss');
    assert.equal(fuss.querySelectorAll('.ld-mini, .knopf').length, 0, `lane ${s}: no knob in the foot`);
    assert.ok(fuss.querySelector('.ld-mute') && fuss.querySelector('.ld-fader'), `lane ${s}: M and fader stay`);
    assert.equal(deck().querySelectorAll('.ld-spur')[s - 1].querySelectorAll('.ld-color').length, 1, `lane ${s}: one COLOR`);
  }
});

test('the COLOR label names the art of the main mixer and follows a change of color/art', async () => {
  await start();
  const { zustand } = await import('../public/page_state.js');
  const { zeigeColor } = await import('../public/color_view.js');
  assert.equal(farbe().querySelector('.ld-sendname').textContent, 'FILTER');   // art 0
  for (const [art, name] of [[1, 'SPACE'], [2, 'DUB ECHO'], [3, 'SWEEP'], [4, 'NOISE'], [5, 'CRUSH'], [0, 'FILTER']]) {
    zustand.regler = { ...(zustand.regler ?? {}), 'color/art': art };
    zeigeColor();
    for (let s = 1; s <= 4; s++) assert.equal(farbe(s).querySelector('.ld-sendname').textContent, name, `lane ${s}, art ${art}`);
  }
});

test('keys 1 2 3 are lit from the stand and a click posts fx for that unit only; a refusal rolls back', async () => {
  const { a } = await start({ fx: { 1: false, 2: true, 3: false } });
  assert.ok(!fxTaste('1').classList.contains('an')); assert.ok(fxTaste('2').classList.contains('an')); assert.ok(!fxTaste('3').classList.contains('an'));
  fxTaste('3').click(); await ruhe();
  assert.deepEqual(posts(a).at(-1).koerper, { deck: 1, spur: 1, fx: { 3: true } });
  assert.ok(fxTaste('3').classList.contains('an'));
  fxTaste('2').click(); await ruhe();
  assert.deepEqual(posts(a).at(-1).koerper, { deck: 1, spur: 1, fx: { 2: false } });
  assert.ok(!fxTaste('2').classList.contains('an'));
  a.antworten['POST /loopdeck/spur'] = { code: 400, j: { ok: false, grund: 'form', text: 'no' } };
  fxTaste('1').click(); await ruhe();
  assert.ok(!fxTaste('1').classList.contains('an'));   // rolled back
});

test('a stand without fx draws all three keys dark', async () => {
  await start({ fx: undefined });
  for (const u of ['1', '2', '3']) assert.ok(!fxTaste(u).classList.contains('an'));
});

test('STRIP toggles the class and stores the state; a throwing localStorage does not break the view', async () => {
  await start();
  const taste = deck().querySelector('.ld-strip-taste');
  const vorher = deck().classList.contains('mit-strip');
  taste.click();
  assert.equal(deck().classList.contains('mit-strip'), !vorher);
  assert.equal(globalThis.localStorage.getItem('loopdeck.strip.1'), vorher ? '0' : '1');
  const kaputt = () => { globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }; };
  await start({}, {}, kaputt);   // a rebuild with a throwing storage still renders and toggles
  assert.equal(deck().querySelectorAll('.ld-strip').length, 4);
  const t2 = deck().querySelector('.ld-strip-taste'), v2 = deck().classList.contains('mit-strip');
  t2.click();
  assert.equal(deck().classList.contains('mit-strip'), !v2);
});

// ---------- sends ----------
test('HALL drag sends the send in dB (at most 0); double click on DLY turns the send off', async () => {
  const { a } = await start();
  const h = sendKnopf('hall');
  h.dispatch('pointerdown', { clientY: 150, pointerId: 1 }); h.dispatch('pointermove', { clientY: 0 }); h.dispatch('pointerup'); await ruhe();
  assert.deepEqual(posts(a).at(-1), { url: '/loopdeck/spur', methode: 'POST', koerper: { deck: 1, spur: 1, send: { hall: 0 } } });
  const d = sendKnopf('delay');
  d.dispatch('pointerdown', { clientY: 150, pointerId: 1 }); d.dispatch('pointermove', { clientY: 120 }); d.dispatch('pointerup'); await ruhe();
  const db = posts(a).at(-1).koerper.send.delay;
  assert.ok(db < 0 && db > -200, `delay send ${db}`);
  d.dispatch('dblclick'); await ruhe();
  assert.deepEqual(posts(a).at(-1).koerper, { deck: 1, spur: 1, send: { delay: -200 } });
});

test('a stand with sends draws the knobs at the stored dB', async () => {
  await start({ send: { hall: -6, delay: -200 } });
  assert.equal(sendKnopf('hall').getAttribute('aria-valuenow'), '-6.00');
  assert.equal(sendKnopf('delay').getAttribute('aria-valuenow'), '-200.00');
});
