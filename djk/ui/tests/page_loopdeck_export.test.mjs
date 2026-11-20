// Track decks export their running loop into the loop deck (loop deck P5), with the DOM stand-in and a fake fetch. Never touches a studio port.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installiere } from './helpers/pages_mock.mjs';
import { APP_DATEIEN } from './helpers/app_source.mjs';

const ROW = '<label class="nachbox">LOOP →</label><button data-nachdeck hidden>L1</button><button data-nachspur="1">1</button><button data-nachspur="2">2</button><button data-nachspur="3">3</button><button data-nachspur="4">4</button>';
const deckHtml = (n) => `<section class="deck" data-deck="${n}"><div data-muell></div><div data-sync></div><div data-pads></div><div data-loops></div><div data-ueber></div><div data-lauf></div><div data-gridwert></div><div data-gridfix></div><div data-gridset></div>${ROW}</section>`;
const HTML = `<body><div id="meldung"></div>${deckHtml(1)}${deckHtml(3)}<section id="platz-loops"><div class="loopdeck" data-deck="1"></div></section><section id="platz-loops2"><div class="loopdeck" data-deck="2"></div></section></body>`;
const ruhe = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok)); };
const zelle = (n) => ({ id: `z${n}`, name: `cell ${n}`, farbe: n, art: 'loop', sha256: `sha${n}`, beats: 8, bpm: 128, gain_db: 0, frames: 1000 });
const lauf0 = () => ({ zelle: null, verwaist: false, ab_beat: 0, versatz_beats: 0, wartend: null, zuletzt: null });
const spur = (g, nr) => ({ spur_id: `s${g}${nr}`, nr, name: `L${g}.${nr}`, fader_db: 0, mute: false, filter: 0, zellen: [zelle(1), null, null, null, null, null, null, null], lauf: lauf0() });
const deck = (g) => ({ gruppe_id: `g${g}`, platz: g, raster: '1', spuren: [1, 2, 3, 4].map((n) => spur(g, n)) });
const posts = (a) => a.anrufe.filter((c) => c.methode === 'POST');
const sektion = (n) => document.querySelector(`.deck[data-deck="${n}"]`);
const taste = (n, s) => sektion(n).querySelector(`[data-nachspur="${s}"]`);
const wahl = (n) => sektion(n).querySelector('[data-nachdeck]');
const zk = (n, s, z) => document.querySelector(`.loopdeck[data-deck="${n}"]`).querySelectorAll('.ld-spur')[s - 1].querySelectorAll('.ld-zelle')[z - 1];

async function start({ decks = { 1: deck(1), 2: deck(2) }, laden = () => ({ j: { ok: true, spur: 2, zelle: 3, zelle_id: 'x' } }), loop = true } = {}) {
  const a = installiere({ html: HTML, antworten: { 'GET /loopdeck/stand': () => ({ j: { decks, beat: 16, bpm: 120 } }), 'POST /loopdeck/laden': laden } });
  const ld = await import('../public/loopdeck/view.js');
  const sz = await import('../public/page_state.js');
  const g = await import('../public/deck_griffe.js');
  const la = await import('../public/live_view.js');
  ld.zuruecksetzen();
  for (const n of [1, 3]) { sz.deckAnsicht[n] = {}; g.bindeDeckBedienung(n, sektion(n)); }
  sz.zustand.decks[1] = loop ? { status: 3, beats_bis_ende: null } : { status: 1, beats_bis_ende: 100 };
  ld.zeigeLoopdecks(); await ruhe();
  la.zeigeExport(1);
  return { a, ld, la, sz };
}

test('the four buttons post /loopdeck/laden with the track deck as source and no cell', async () => {
  const { a } = await start();
  for (const s of [1, 2, 3, 4]) { taste(1, s).click(); await ruhe(); assert.deepEqual(posts(a).at(-1), { url: '/loopdeck/laden', methode: 'POST', koerper: { deck: 1, spur: s, quelle: { von_deck: 1 } } }); }
  taste(3, 1).click(); await ruhe();   // deck 3 has no loop: nothing is sent
  assert.equal(posts(a).length, 4);
});

test('a selected cell in the clicked track of the target deck is sent along; another track is not', async () => {
  const { a } = await start();
  zk(2, 2, 4).click(); await ruhe();   // selects the empty cell 4 of track 2 in deck 2
  assert.equal(wahl(1).textContent, 'LOOP 2');
  taste(1, 2).click(); await ruhe();
  assert.deepEqual(posts(a).at(-1).koerper, { deck: 2, spur: 2, zelle: 4, quelle: { von_deck: 1 } });
  assert.match(document.querySelector('#meldung').textContent, /Loop exported to LOOP 2 track 2, cell 3/);
  zk(2, 2, 4).click(); await ruhe();
  taste(1, 3).click(); await ruhe();
  assert.deepEqual(posts(a).at(-1).koerper, { deck: 2, spur: 3, quelle: { von_deck: 1 } });
});

test('the toggle switches the target deck and is hidden while only one loop deck exists', async () => {
  const { a, ld, la } = await start();
  assert.equal(wahl(1).hidden, false); assert.equal(wahl(1).textContent, 'LOOP 1');
  wahl(1).click(); await ruhe();
  assert.equal(wahl(1).textContent, 'LOOP 2');
  taste(1, 1).click(); await ruhe();
  assert.equal(posts(a).at(-1).koerper.deck, 2);
  wahl(1).click(); await ruhe();
  assert.equal(wahl(1).textContent, 'LOOP 1');
  const e = await start({ decks: { 1: null, 2: deck(2) } });
  assert.equal(wahl(1).hidden, true);
  assert.equal(wahl(1).textContent, 'LOOP 2', 'the only deck is the target');
  taste(1, 1).click(); await ruhe();
  assert.equal(posts(e.a).at(-1).koerper.deck, 2);
  assert.ok(ld && la);
});

test('EXPORT posts without spur; it and the row are off, with a title, while no loop runs', async () => {
  const { a, la } = await start();
  const ex = document.querySelector('[data-exportloop="1"]') ?? null;
  const knopf = ex ?? (() => { throw new Error('no export button built'); })();
  assert.equal(knopf.disabled, false);
  knopf.click(); await ruhe();
  assert.deepEqual(posts(a).at(-1), { url: '/loopdeck/laden', methode: 'POST', koerper: { deck: 1, quelle: { von_deck: 1 } } });
  const aus = await start({ loop: false });
  aus.la.zeigeExport(1);
  assert.equal(document.querySelector('[data-exportloop="1"]').disabled, true);
  assert.match(document.querySelector('[data-exportloop="1"]').title, /running loop/);
  assert.equal(taste(1, 1).disabled, true); assert.match(taste(1, 1).title, /running loop/);
  assert.ok(la && aus);
});

test('a 409 shows the refusal text of the server', async () => {
  for (const [grund, text] of [['deck_voll', 'the loop deck has no empty cell'], ['quelle_unbekannt', 'no active loop on that deck'], ['audio_budget', 'audio budget exceeded'], ['zu_lang', 'cell audio is over 60 s']]) {
    const { a } = await start({ laden: () => ({ code: 409, j: { ok: false, grund, text } }) });
    taste(1, 1).click(); await ruhe();
    assert.equal(posts(a).length, 1);
    assert.match(document.querySelector('#meldung').textContent, new RegExp(text));
  }
});

test('no page source calls /modul/export or the old export helpers any more', () => {
  const quelle = [...APP_DATEIEN, 'live_module.js', 'browse_table.js'].map((n) => fs.readFileSync(new URL(`../public/${n}`, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(quelle, /\/modul\/export|exportiereInSlot|exportiere\(|data-nachbox|exportKnopf/);
  assert.doesNotMatch(fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), /data-nachbox/);
});
