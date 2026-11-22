// Loop deck view on the page (loop deck P2), with the DOM stand-in, a fake fetch and a fake event stream. Never touches a studio port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

const HTML = '<body><div id="meldung"></div><section id="platz-loops"><div class="loopdeck" data-deck="1"></div></section><section id="platz-loops2"><div class="loopdeck" data-deck="2"></div></section></body>';
const ruhe = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok)); };
const zelle = (n, extra = {}) => ({ id: `z${n}`, name: `cell ${n}`, farbe: n, art: 'loop', sha256: `sha${n}`, beats: 8, bpm: 128, gain_db: 0, frames: 1000, ...extra });
const lauf0 = () => ({ zelle: null, verwaist: false, ab_beat: 0, versatz_beats: 0, wartend: null, zuletzt: null });
const spur = (nr) => ({ spur_id: `s${nr}`, nr, name: `L1.${nr}`, fader_db: 0, mute: false, filter: 0, zellen: [zelle(1), null, zelle(3), null, null, null, null, null], lauf: lauf0() });
const deck1 = () => ({ gruppe_id: 'g1', platz: 1, raster: '1', spuren: [1, 2, 3, 4].map(spur) });

async function start(stand = { decks: { 1: deck1(), 2: null }, beat: 16, bpm: 120 }, extra = {}) {
  const a = installiere({ html: HTML, antworten: { 'GET /loopdeck/stand': () => ({ j: stand }), 'POST /loopdeck/neu': { j: { ok: true, gruppe_id: 'g2' } }, ...extra } });
  const m = await import('../public/loopdeck/view.js');
  m.zuruecksetzen();
  m.zeigeLoopdecks();
  await ruhe();
  return { a, m };
}
const posts = (a) => a.anrufe.filter((c) => c.methode === 'POST');
const deck = (n = 1) => document.querySelector(`.loopdeck[data-deck="${n}"]`);
const zellKnoten = (n, spurNr, z) => deck(n).querySelectorAll('.ld-spur')[spurNr - 1].querySelectorAll('.zelle')[z - 1];

test('the view builds head, scene column and four tracks of eight cells', async () => {
  await start();
  const d = deck();
  assert.equal(d.querySelector('.ld-deckname').textContent, 'LOOP 1');
  assert.deepEqual(d.querySelectorAll('.ld-r').map((b) => b.textContent), ['1/4', '1/2', '1', 'BAR', '4']);
  assert.equal(d.querySelectorAll('.ld-szene').length, 8);
  assert.equal(d.querySelectorAll('.ld-spur').length, 4);
  assert.equal(d.querySelectorAll('.zelle').length, 32);
  assert.ok(zellKnoten(1, 1, 1).classList.contains('voll')); assert.ok(zellKnoten(1, 1, 2).classList.contains('leer'));
  assert.ok(d.querySelector('.ld-r[data-raster="1"]').classList.contains('an'));
  assert.equal(d.querySelector('.ld-neu').hidden, true);
});

test('the loop deck place renders four .spalte[data-variante=kompakt] with eight .zelle each and a .jetzt strip per column', async () => {
  await start();
  const spalten = deck().querySelectorAll('.spalte[data-variante="kompakt"]');
  assert.equal(spalten.length, 4);
  for (const sp of spalten) {
    assert.equal(sp.querySelectorAll('.zelle').length, 8);
    assert.equal(sp.querySelectorAll('.jetzt').length, 1);
  }
  assert.equal(deck().querySelectorAll('.ld-spur')[0].querySelector('.zug-slot .ld-strip') !== null, true, 'the strip row sits in the zug-slot');
});

test('a cell without beats keeps its play head: the length comes from frames and the clock tempo', async () => {
  const st = deck1(); st.spuren[0].zellen[0] = { ...zelle(1), beats: undefined, bpm: undefined, frames: 96000 };   // 2 s = 4 beats at 120 bpm
  st.spuren[0].lauf = { ...lauf0(), zelle: 1, ab_beat: 16 };
  const { m } = await start({ decks: { 1: st, 2: null }, beat: 18, bpm: 120 });
  m.zeichnePositionen(performance.now());
  const kopf = deck().querySelectorAll('.kopf-ph')[0];
  assert.equal(kopf.hidden, false);
  assert.ok(Math.abs(parseFloat(kopf.style.left) - 50) < 3, `head at ${kopf.style.left}`);
});

test('click on a filled cell posts start with deck, track and cell', async () => {
  const { a } = await start();
  zellKnoten(1, 2, 3).click();
  await ruhe();
  assert.deepEqual(posts(a).at(-1), { url: '/loopdeck/start', methode: 'POST', koerper: { deck: 1, spur: 2, zelle: 3 } });
});

test('click on an empty cell selects it as the load target, one per deck', async () => {
  const { a, m } = await start();
  zellKnoten(1, 1, 2).click(); await ruhe();
  assert.ok(zellKnoten(1, 1, 2).classList.contains('gewaehlt'));
  assert.deepEqual(m.zielVon(1), { spur: 1, zelle: 2 });
  zellKnoten(1, 3, 4).click(); await ruhe();
  assert.ok(!zellKnoten(1, 1, 2).classList.contains('gewaehlt')); assert.ok(zellKnoten(1, 3, 4).classList.contains('gewaehlt'));
  assert.equal(deck().querySelectorAll('.gewaehlt').length, 1);
  assert.equal(posts(a).filter((c) => c.url === '/loopdeck/start').length, 0);   // selecting does not launch
});

test('scene button posts szene with the row', async () => {
  const { a } = await start();
  deck().querySelectorAll('.ld-szene')[4].click(); await ruhe();
  assert.deepEqual(posts(a).at(-1).koerper, { deck: 1, zeile: 5 }); assert.equal(posts(a).at(-1).url, '/loopdeck/szene');
});

test('an SSE with wartend makes the cell blink, one with zelle lights it', async () => {
  await start();
  // stream.js hands the stream's events to loopdeckEreignis; the test calls that entry point
  const m = await import('../public/loopdeck/view.js');
  m.loopdeckEreignis('loopdeck', { deck: 1, spur: 1, lauf: { ...lauf0(), wartend: { zelle: 3, ab_beat: 20 } } });
  assert.ok(zellKnoten(1, 1, 3).classList.contains('wartet'));
  assert.ok(!zellKnoten(1, 2, 3).classList.contains('wartet'));   // only that track
  m.loopdeckEreignis('loopdeck', { deck: 1, spur: 1, lauf: { ...lauf0(), zelle: 3, ab_beat: 20 } });
  assert.ok(zellKnoten(1, 1, 3).classList.contains('spielt')); assert.ok(!zellKnoten(1, 1, 3).classList.contains('wartet'));
  assert.equal(deck().querySelectorAll('.ld-spur')[0].querySelector('.tname').textContent, 'cell 3');
});

test('an orphaned track shows playing with no cell lit', async () => {
  const { m } = await start();
  m.loopdeckEreignis('loopdeck', { deck: 1, spur: 4, lauf: { ...lauf0(), zelle: 1, verwaist: true } });
  const s = deck().querySelectorAll('.ld-spur')[3];
  assert.ok(s.classList.contains('spielt')); assert.ok(s.classList.contains('verwaist'));
  assert.equal(s.querySelectorAll('.spielt').length, 0);
});

test('the play head follows the beat clock', async () => {
  const { m } = await start();
  m.loopdeckEreignis('/uhr', { beat: 20, bpm: 120 });
  m.loopdeckEreignis('loopdeck', { deck: 1, spur: 1, lauf: { ...lauf0(), zelle: 1, ab_beat: 16 } });
  const kopf = deck().querySelectorAll('.kopf-ph')[0];
  const t0 = performance.now();
  m.zeichnePositionen(t0);   // 4 beats into an 8 beat cell, up to the few ms since the event
  assert.equal(kopf.hidden, false);
  assert.ok(Math.abs(parseFloat(kopf.style.left) - 50) < 2, `head at ${kopf.style.left}`);
});

test('foot row: stop, mute, volume and filter post their bodies', async () => {
  const { a } = await start();
  const s = deck().querySelectorAll('.ld-spur')[1];
  s.querySelector('.stopp').click(); await ruhe();
  assert.deepEqual(posts(a).at(-1), { url: '/loopdeck/stopp', methode: 'POST', koerper: { deck: 1, spur: 2 } });
  s.querySelector('.ld-mute').click(); await ruhe();
  assert.deepEqual(posts(a).at(-1), { url: '/loopdeck/spur', methode: 'POST', koerper: { deck: 1, spur: 2, mute: true } });
  assert.ok(s.querySelector('.ld-mute').classList.contains('an'));
  const f = s.querySelector('input.live-regler');
  f.value = '-6'; f.dispatch('input'); await ruhe();
  assert.deepEqual(posts(a).at(-1).koerper, { deck: 1, spur: 2, fader_db: -6 });
  const k = s.querySelector('.knopf');
  k.dispatch('pointerdown', { clientY: 150, pointerId: 1 }); k.dispatch('pointermove', { clientY: 0 }); k.dispatch('pointerup'); await ruhe();
  assert.deepEqual(posts(a).at(-1).koerper, { deck: 1, spur: 2, filter: 1 });
  k.dispatch('dblclick'); await ruhe();
  assert.deepEqual(posts(a).at(-1), { url: '/loopdeck/spur', methode: 'POST', koerper: { deck: 1, spur: 2, filter: 0 } });
});

test('head: STOP ALL and the grid selector post for the deck', async () => {
  const { a } = await start();
  deck().querySelector('.ld-stopall').click(); await ruhe();
  assert.deepEqual(posts(a).at(-1), { url: '/loopdeck/stopp', methode: 'POST', koerper: { deck: 1 } });
  deck().querySelectorAll('.ld-r')[3].click(); await ruhe();
  assert.deepEqual(posts(a).at(-1), { url: '/loopdeck/raster', methode: 'POST', koerper: { deck: 1, raster: 'takt' } });
  assert.ok(deck().querySelectorAll('.ld-r')[3].classList.contains('an'));
});

test('a proj event reads the stand again', async () => {
  const { a, m } = await start();
  const vorher = a.anrufe.filter((c) => c.url === '/loopdeck/stand').length;
  m.loopdeckEreignis('proj', { rev: 5 }); await ruhe();
  assert.equal(a.anrufe.filter((c) => c.url === '/loopdeck/stand').length, vorher + 1);
});

test('a deck that does not exist is created once (POST neu) while the live container is open, and the CREATE DECK button posts it again', async () => {
  const la = await import('../public/live_view.js');
  la.live.projekt = { live: true };   // without the open live container the page creates nothing by itself (page_loopdeck_befunde.test.mjs)
  const { a } = await start();
  assert.equal(posts(a).filter((c) => c.url === '/loopdeck/neu' && c.koerper.deck === 2).length, 1);   // place 2 shows, deck 2 is null
  assert.equal(posts(a).filter((c) => c.url === '/loopdeck/neu' && c.koerper.deck === 1).length, 0);
  assert.equal(deck(2).querySelector('.ld-neu').hidden, false);
  assert.ok(deck(2).querySelectorAll('.zelle').every((c) => c.classList.contains('leer')));   // the empty grid until the answer
  deck(2).querySelector('.ld-neu').click(); await ruhe();
  assert.equal(posts(a).filter((c) => c.url === '/loopdeck/neu' && c.koerper.deck === 2).length, 2);
  la.live.projekt = null;
});

test('a place that is not shown is neither read nor created', async () => {
  const a = installiere({ html: HTML.replace('<section id="platz-loops2">', '<section id="platz-loops2" class="platz-aus">'),
    antworten: { 'GET /loopdeck/stand': { j: { decks: { 1: deck1(), 2: null }, beat: 0, bpm: 120 } } } });
  const m = await import('../public/loopdeck/view.js');
  m.zuruecksetzen(); m.zeigeLoopdecks(); await ruhe();
  assert.equal(posts(a).length, 0);
});

test('a refusal is shown, not swallowed', async () => {
  const { a } = await start(undefined, { 'POST /loopdeck/start': { code: 409, j: { ok: false, grund: 'zelle_leer', text: 'cell is empty' } } });
  zellKnoten(1, 1, 1).click(); await ruhe();
  assert.match(document.querySelector('#meldung').textContent, /cell is empty/);
  assert.equal(document.querySelector('#meldung').className, 'fehler');
});

// ---- loop deck X1: a click in the waveform strip jumps to a slice ----
const streifen = (n = 1, spurNr = 1) => deck(n).querySelectorAll('.ld-spur')[spurNr - 1].querySelector('.jetzt');

test('a click in the strip posts sprung with the slice under the pointer (x = 0, w/8 - 1, w - 1)', async () => {
  const { a } = await start();
  const w = streifen().getBoundingClientRect().width;
  for (const [x, slice] of [[0, 1], [w / 8 - 1, 1], [w / 8, 2], [w - 1, 8]]) {
    streifen().dispatch('click', { clientX: x }); await ruhe();
    assert.deepEqual(posts(a).at(-1), { url: '/loopdeck/sprung', methode: 'POST', koerper: { deck: 1, spur: 1, slice } }, `x ${x}`);
  }
});

test('a click in the strip of a one-shot cell posts nothing; a refusal shows its text', async () => {
  const st = { decks: { 1: deck1(), 2: null }, beat: 16, bpm: 120 };
  st.decks[1].spuren[0].zellen[0] = zelle(1, { art: 'einmal' });
  st.decks[1].spuren[0].lauf = { ...lauf0(), zelle: 1 };
  const { a } = await start(st, { 'POST /loopdeck/sprung': { code: 409, j: { ok: false, grund: 'nichts_gespielt' } } });
  streifen().dispatch('click', { clientX: 10 }); await ruhe();
  assert.equal(posts(a).filter((c) => c.url === '/loopdeck/sprung').length, 0);
  streifen(1, 2).dispatch('click', { clientX: 10 }); await ruhe();
  assert.equal(posts(a).filter((c) => c.url === '/loopdeck/sprung').length, 1);
  assert.match(document.querySelector('#meldung').textContent, /Nothing played on that track yet/);
});

test('a click at 40 % of the strip of a playing loop sends /loopdeck/sprung { slice: 4 } (through beiWelleKlick)', async () => {
  const st = { decks: { 1: deck1(), 2: null }, beat: 16, bpm: 120 };
  st.decks[1].spuren[0].lauf = { ...lauf0(), zelle: 1, ab_beat: 16 };
  const { a } = await start(st);
  streifen().dispatch('click', { clientX: 40 }); await ruhe();
  assert.deepEqual(posts(a).at(-1), { url: '/loopdeck/sprung', methode: 'POST', koerper: { deck: 1, spur: 1, slice: 4 } });
  assert.equal(streifen().querySelectorAll('.marke').length, 7);
});
