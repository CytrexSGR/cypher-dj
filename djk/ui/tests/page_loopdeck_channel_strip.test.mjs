// Loop deck channel strip row (channel strip PZ1): LO MID HI knobs with kill, STRIP toggle. Stubbed requests, DOM stand-in, no studio port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere } from './helpers/pages_mock.mjs';
import { KERN, kernAusX, kernZuX } from '../public/curves.js';

const HTML = '<body><div id="meldung"></div><section id="platz-loops"><div class="loopdeck" data-deck="1"></div></section><section id="platz-loops2"><div class="loopdeck" data-deck="2"></div></section></body>';
const ruhe = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok)); };
const lauf0 = () => ({ zelle: null, verwaist: false, ab_beat: 0, versatz_beats: 0, wartend: null, zuletzt: null });
const spur = (nr, extra = {}) => ({ spur_id: `s${nr}`, nr, name: `L1.${nr}`, fader_db: 0, mute: false, filter: 0, zellen: [null, null, null, null, null, null, null, null], lauf: lauf0(),
  eq: { tief: 0, mitte: 0, hoch: 0 }, kill: { tief: false, mitte: false, hoch: false }, send: { hall: -200, delay: -200 }, effekt: null, ...extra });
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
const mini = (band, s = 1) => strip(s).querySelectorAll('.ld-einheit')[['tief', 'mitte', 'hoch'].indexOf(band)];

test('each track has a strip with LO, MID and HI; the deck has a STRIP button', async () => {
  const { m: m0 } = await start();
  for (let s = 1; s <= 4; s++) {
    assert.deepEqual(strip(s).querySelectorAll('.ld-band').map((b) => b.textContent), ['LO', 'MID', 'HI']);
    assert.equal(strip(s).querySelectorAll('.ld-mini').length, 5);   // LO MID HI, HALL, DLY (PZ2)
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

test('dragging a knob all the way down is -200 dB (the kill end of the law)', async () => {
  const { a } = await start();
  const k = mini('hoch', 2).querySelector('.ld-mini');
  k.dispatch('pointerdown', { clientY: 0, pointerId: 1 }); k.dispatch('pointermove', { clientY: 400 }); k.dispatch('pointerup'); await ruhe();
  assert.deepEqual(posts(a).at(-1).koerper, { deck: 1, spur: 2, eq: { hoch: -200 } });
});

test('the LO label toggles the kill and draws it; a refusal rolls back', async () => {
  const { a } = await start();
  const lo = mini('tief').querySelector('.ld-band');
  lo.click(); await ruhe();
  assert.deepEqual(posts(a).at(-1).koerper, { deck: 1, spur: 1, kill: { tief: true } });
  assert.ok(lo.classList.contains('kill')); assert.ok(mini('tief').querySelector('.ld-mini').classList.contains('kill'));
  lo.click(); await ruhe();
  assert.deepEqual(posts(a).at(-1).koerper, { deck: 1, spur: 1, kill: { tief: false } });
  assert.ok(!lo.classList.contains('kill'));
  a.antworten['POST /loopdeck/spur'] = { code: 400, j: { ok: false, grund: 'form', text: 'no' } };
  lo.click(); await ruhe();
  assert.ok(!lo.classList.contains('kill'));   // rolled back
});

test('a stand with kill on HI draws it killed with the knob at the stored value', async () => {
  await start({ eq: { tief: 0, mitte: 0, hoch: -6 }, kill: { tief: false, mitte: false, hoch: true } });
  const hi = mini('hoch');
  assert.ok(hi.querySelector('.ld-band').classList.contains('kill')); assert.ok(hi.querySelector('.ld-mini').classList.contains('kill'));
  assert.equal(hi.querySelector('.ld-mini').getAttribute('aria-valuenow'), '-6.00');
  assert.ok(!mini('tief').querySelector('.ld-band').classList.contains('kill'));
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

// ---------- PZ2: sends, effect chip, device window ----------
const GRAPHEN = { graphen: [{ name: 'fx-remix', kurz: 'REMIX', latenz: 0 }, { name: 'fx-crunch', kurz: 'CRUNCH', latenz: 46 }] };
const EFFEKTE = { 'GET /loopdeck/effekte': { j: GRAPHEN } };
const chip = (s = 1) => deck().querySelectorAll('.ld-spur')[s - 1].querySelector('.ld-fx');
const sendKnopf = (art, s = 1) => deck().querySelectorAll('.ld-spur')[s - 1].querySelector(`.ld-send[data-send="${art}"] .ld-mini`);
const fxMenue = () => deck().querySelector('.ld-fxmenue');
const fxWahl = (text) => fxMenue().querySelectorAll('.ld-fxwahl, .ld-fxeintrag').find((b) => b.textContent === text);

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

test('chip shows + without an effect; its click opens the choice with the graphs; picking CRUNCH posts the graph', async () => {
  const { a } = await start({}, { ...EFFEKTE, 'POST /loopdeck/effekt': { j: { ok: true, effekt: { id: 'i9', graph: 'fx-crunch', an: true } } } });
  assert.equal(chip().textContent, '+');
  assert.ok(fxMenue().hidden);
  chip().click(); await ruhe();
  assert.ok(!fxMenue().hidden);
  assert.deepEqual(fxMenue().querySelectorAll('.ld-fxwahl').map((b) => b.textContent), ['REMIX', 'CRUNCH']);
  assert.equal(fxWahl('On'), undefined); assert.equal(fxWahl('Remove'), undefined);   // nothing set: no on/off, no remove
  fxWahl('CRUNCH').click(); await ruhe();
  assert.deepEqual(posts(a).at(-1), { url: '/loopdeck/effekt', methode: 'POST', koerper: { deck: 1, spur: 1, graph: 'fx-crunch' } });
  assert.equal(chip().textContent, 'CRUNCH');
  assert.ok(fxMenue().hidden);
  assert.equal(a.anrufe.filter((c) => c.url === '/loopdeck/effekte').length, 1);   // fetched once
});

test('a set chip shows the short name, dim when off; Off posts an:false, Remove posts graph empty', async () => {
  const { a } = await start({ effekt: { id: 'i9', graph: 'fx-remix', an: false } }, { ...EFFEKTE, 'POST /loopdeck/effekt': (k) => ({ j: { ok: true, effekt: k.graph === '' ? null : { id: 'i9', graph: 'fx-remix', an: k.an ?? true } } }) });
  assert.equal(chip().textContent, 'REMIX');
  assert.ok(chip().classList.contains('aus'));
  chip().click(); await ruhe();
  fxWahl('On').click(); await ruhe();
  assert.deepEqual(posts(a).at(-1).koerper, { deck: 1, spur: 1, an: true });
  assert.ok(!chip().classList.contains('aus'));
  chip().click(); await ruhe();
  assert.equal(fxWahl('On'), undefined); assert.ok(fxWahl('Off'));
  fxWahl('Off').click(); await ruhe();
  assert.deepEqual(posts(a).at(-1).koerper, { deck: 1, spur: 1, an: false });
  assert.ok(chip().classList.contains('aus'));
  chip().click(); await ruhe();
  fxWahl('Remove').click(); await ruhe();
  assert.deepEqual(posts(a).at(-1).koerper, { deck: 1, spur: 1, graph: '' });
  assert.equal(chip().textContent, '+');
});

test('set chip, choice open, second click on the chip opens the device window of the stage', async () => {
  await start({ effekt: { id: 'i9', graph: 'fx-remix', an: true } }, EFFEKTE);
  const offen = [];
  globalThis.open = (...x) => { offen.push(x); return { focus() {} }; };   // window is globalThis in the stand-in
  chip().click(); await ruhe();
  assert.ok(!fxMenue().hidden); assert.equal(offen.length, 0);
  chip().click(); await ruhe();
  assert.ok(fxMenue().hidden);
  assert.equal(offen.length, 1);
  assert.equal(offen[0][0], '/#geraet=ins%3Ai9');
  delete globalThis.open;
});

test('a refusal kein_platz shows its text and leaves the chip +', async () => {
  const { a } = await start({}, { ...EFFEKTE, 'POST /loopdeck/effekt': { code: 409, j: { ok: false, grund: 'kein_platz', text: 'All 8 effect stages are in use.' } } });
  chip().click(); await ruhe();
  fxWahl('REMIX').click(); await ruhe();
  assert.equal(chip().textContent, '+');
  assert.equal(document.querySelector('#meldung').textContent, 'Loop deck: All 8 effect stages are in use.');
  assert.ok(posts(a).some((c) => c.url === '/loopdeck/effekt'));
});
