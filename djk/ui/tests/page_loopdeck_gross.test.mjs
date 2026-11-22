// Loop deck pop-up: an overlay above the DJ view that shows one loop deck large (columns, scene column, clip editor, devices). DOM stand-in,
// fake fetch, fake event stream; never touches a studio port. `removeEventListener` is a no-op on the stand-in, so the leak checks use a counting document.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

const HTML = '<body><div id="meldung"></div><section id="platz-loops"><div class="loopdeck" data-deck="1"></div></section><section id="platz-loops2"><div class="loopdeck" data-deck="2"></div></section></body>';
const ruhe = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok)); };
const lauf0 = () => ({ zelle: null, verwaist: false, ab_beat: 0, versatz_beats: 0, wartend: null, zuletzt: null });
const zelle = (n) => ({ id: `z${n}`, name: `cell ${n}`, farbe: n, art: 'loop', sha256: `sha${n}`, beats: 8, bpm: 128, gain_db: 0, frames: 1000 });
const zellen = () => [zelle(1), null, zelle(3), null, null, null, null, null];
const ldSpur = (nr) => ({ spur_id: `s${nr}`, nr, name: `L1.${nr}`, fader_db: 0, mute: false, filter: 0, zellen: zellen(), lauf: lauf0() });
const ldStand = () => ({ decks: { 1: { gruppe_id: 'g1', platz: 1, raster: 'takt', spuren: [1, 2, 3, 4].map(ldSpur) }, 2: null }, beat: 16, bpm: 120 });
const sSpalte = (nr, deck = 1) => ({ spur_id: `s${nr}`, kurz: `C${nr}`, name: `Loop ${deck}.${nr}`, art: 'audio', deck, spur: nr, zellen: zellen(), lauf: lauf0() });
const sStand = () => ({ raster: 'takt', szenen: Array.from({ length: 8 }, () => ({})), beat: 17.5, bpm: 128,
  container: [{ buchstabe: 'A', typ: 'loops', name: 'Loop deck 1', spalten: [1, 2, 3, 4].map((n) => sSpalte(n)) }], geparkt: [] });

const posts = (url) => attrappe.anrufe.filter((c) => c.url === url && c.methode === 'POST');
const sicht = () => document.body.querySelectorAll('.ldg-overlay');
const deckKnoten = (n = 1) => document.querySelector(`.loopdeck[data-deck="${n}"]`);

// A document that counts what is added and removed, and calls the keydown listeners itself.
function zaehlDokument() {
  const liste = new Set();
  return { liste, addEventListener: (art, f) => { if (art === 'keydown') liste.add(f); }, removeEventListener: (art, f) => { if (art === 'keydown') liste.delete(f); },
    taste: (key, ziel = document.body) => { for (const f of [...liste]) f({ key, target: ziel, preventDefault() {}, stopPropagation() {} }); } };
}

async function start(extra = {}) {
  const a = installiere({ html: HTML, antworten: {
    'GET /loopdeck/stand': () => ({ j: ldStand() }), 'GET /session/stand': () => ({ j: sStand() }),
    'POST /session/start': { j: { ok: true } }, 'POST /session/stopp': { j: { ok: true } }, 'POST /loopdeck/szene': { j: { ok: true } },
    'POST /loopdeck/raster': { j: { ok: true } }, 'POST /loopdeck/stopp': { j: { ok: true } }, ...extra } });
  const place = await import('../public/loopdeck/view.js');
  const gm = await import('../public/loopdeck/gross.js');
  place.zuruecksetzen();
  place.zeigeLoopdecks();
  await ruhe();
  const dok = zaehlDokument();
  const gross = gm.bindeLoopdeckGross({ dokument: dok, aendere: async () => true, spurAendern() {}, projekt: () => null, holeJson: async () => ({ status: 0, j: null }), beatVon: () => null });
  place.setzeGrossHaken((nr, anker) => gross.oeffne(nr, anker));
  return { a, place, gross, dok };
}
const knopf = (n = 1) => deckKnoten(n).querySelector('.ld-gross');

test('the place head has a ⤢ button with the title; a click opens the pop-up for that deck', async () => {
  await start();
  const b = knopf();
  assert.equal(b.textContent, '⤢');
  assert.equal(b.title, 'Open the loop deck large: cells, strips and the clip editor');
  assert.equal(sicht().length, 0);
  b.click(); await ruhe();
  assert.equal(sicht().length, 1);
  assert.equal(document.body.querySelector('.ldg-panel').getAttribute('aria-label'), 'Loop deck 1');
});

test('a double click on the deck name opens it too', async () => {
  await start();
  deckKnoten().querySelector('.ld-deckname').dispatch('dblclick'); await ruhe();
  assert.equal(sicht().length, 1);
});

test('Esc closes, focus returns to the button; the x button closes the same way', async () => {
  const { dok } = await start();
  const b = knopf();
  b.click(); await ruhe();
  dok.taste('Escape');
  assert.equal(sicht().length, 0);
  assert.equal(attrappe.aktiv, b, 'focus is back on the button');
  assert.equal(attrappe.fokusAufrufe.at(-1).opt?.preventScroll, true);
  b.click(); await ruhe();
  document.body.querySelector('.ldg-zu').click();
  assert.equal(sicht().length, 0);
  assert.equal(attrappe.aktiv, b);
});

test('content: head, four voll columns of eight cells with a now-playing strip, eight scene buttons, CLIP and DEVICES tabs', async () => {
  await start();
  knopf().click(); await ruhe();
  const w = document.body.querySelector('.ldg-overlay');
  assert.equal(w.querySelector('.ldg-kopf .bu').textContent, 'A');
  assert.equal(w.querySelector('.ldg-kopf .art').textContent, 'LOOPS');
  assert.equal(w.querySelector('.ldg-kopf .gn').textContent, 'Loop deck 1');
  assert.deepEqual(w.querySelectorAll('.ldg-kopf .ld-r').map((b) => b.textContent), ['1/4', '1/2', '1', 'BAR', '4']);
  assert.ok(w.querySelector('.ld-r[data-raster="takt"]').classList.contains('an'), 'the grid comes from the place');
  assert.equal(w.querySelector('[data-stopp-alle]').textContent, 'STOP ALL');
  const spalten = w.querySelectorAll('.spalte[data-variante="voll"]');
  assert.equal(spalten.length, 4);
  for (const s of spalten) { assert.equal(s.querySelectorAll('.zelle').length, 8); assert.equal(s.querySelectorAll('.jetzt').length, 1); }
  assert.equal(w.querySelectorAll('.ldg-szenen .ld-szene').length, 8);
  assert.deepEqual(w.querySelectorAll('.dtab').map((b) => b.textContent), ['CLIP', 'DEVICES']);
  assert.ok(w.querySelector('#session-unten'), 'the bottom area keeps the id the dock and editor styles use');
});

test('starting a cell posts what SESSION posted; a column STOP too', async () => {
  await start();
  knopf().click(); await ruhe();
  const w = document.body.querySelector('.ldg-overlay');
  w.querySelectorAll('.spalte')[1].querySelector('.zelle[data-zelle="3"] .go').click(); await ruhe();
  assert.deepEqual(posts('/session/start').at(-1).koerper, { spur_id: 's2', zelle: 3 });
  w.querySelectorAll('.spalte')[3].querySelector('.stopp').click(); await ruhe();
  assert.deepEqual(posts('/session/stopp').at(-1).koerper, { spur_id: 's4' });
});

test('a scene button posts /loopdeck/szene with deck and row', async () => {
  await start();
  knopf().click(); await ruhe();
  document.body.querySelectorAll('.ldg-szenen .ld-szene')[4].click(); await ruhe();
  assert.deepEqual(posts('/loopdeck/szene').at(-1).koerper, { deck: 1, zeile: 5 });
});

test('the head grid select and STOP ALL post for this deck', async () => {
  await start();
  knopf().click(); await ruhe();
  document.body.querySelector('.ldg-kopf .ld-r[data-raster="1"]').click(); await ruhe();
  assert.deepEqual(posts('/loopdeck/raster').at(-1).koerper, { deck: 1, raster: '1' });
  document.body.querySelector('.ldg-kopf [data-stopp-alle]').click(); await ruhe();
  assert.deepEqual(posts('/loopdeck/stopp').at(-1).koerper, { deck: 1 });
});

test('selecting a filled cell shows it in the CLIP editor', async () => {
  await start();
  knopf().click(); await ruhe();
  const w = document.body.querySelector('.ldg-overlay');
  assert.equal(w.querySelectorAll('.pr-titel').length, 0);
  w.querySelectorAll('.spalte')[2].querySelectorAll('.zelle')[0].dispatch('click'); await ruhe();
  assert.equal(w.querySelector('.pr-titel').textContent, 'C3 · cell 1');
});

test('open and close twice leaves no listener and no node behind', async () => {
  const { dok } = await start();
  const vor = dok.liste.size;
  for (let i = 0; i < 2; i++) {
    knopf().click(); await ruhe();
    assert.equal(dok.liste.size, vor + 1, 'one key listener while open');
    assert.equal(sicht().length, 1);
    dok.taste('Escape'); await ruhe();
    assert.equal(dok.liste.size, vor, 'closed: the listener is gone');
    assert.equal(sicht().length, 0);
  }
  assert.equal(document.body.querySelectorAll('.ldg-panel').length, 0);
});

test('a second open of another deck replaces the first: one pop-up at a time', async () => {
  const { gross } = await start();
  knopf(1).click(); await ruhe();
  gross.oeffne(2, knopf(2)); await ruhe();
  assert.equal(sicht().length, 1);
  assert.equal(document.body.querySelector('.ldg-panel').getAttribute('aria-label'), 'Loop deck 2');
});

test('a session event updates the open column in place', async () => {
  const { gross } = await start();
  knopf().click(); await ruhe();
  const w = document.body.querySelector('.ldg-overlay');
  const vor = w.querySelectorAll('.spalte')[0];
  gross.ereignis('session', { spur_id: 's1', lauf: { ...lauf0(), zelle: 1, ab_beat: 16 } }); await ruhe();
  assert.equal(w.querySelectorAll('.spalte')[0], vor, 'same node');
  assert.ok(w.querySelectorAll('.spalte')[0].querySelectorAll('.zelle')[0].classList.contains('spielt'));
});

test('the place keeps working while the pop-up is open', async () => {
  const { a } = await start();
  knopf().click(); await ruhe();
  const vor = posts('/loopdeck/szene').length;
  deckKnoten().querySelectorAll('.ld-szene')[1].click(); await ruhe();
  assert.equal(posts('/loopdeck/szene').length, vor + 1);
  assert.deepEqual(posts('/loopdeck/szene').at(-1).koerper, { deck: 1, zeile: 2 });
  assert.equal(sicht().length, 1, 'the pop-up is still there');
  assert.ok(a);
});
