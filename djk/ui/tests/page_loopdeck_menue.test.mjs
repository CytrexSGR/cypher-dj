// Loop deck cell menu and library buttons (loop deck P3), with the DOM stand-in and a fake fetch. Never touches a studio port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere } from './helpers/pages_mock.mjs';

const HTML = '<body><div id="meldung"></div><section id="platz-loops"><div class="loopdeck" data-deck="1"></div></section><section id="platz-loops2"><div class="loopdeck" data-deck="2"></div></section></body>';
const ruhe = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok)); };
const zelle = (n, extra = {}) => ({ id: `z${n}`, name: `cell ${n}`, farbe: n, art: 'loop', sha256: `sha${n}`, beats: 8, bpm: 128, gain_db: -3, frames: 1000, ...extra });
const lauf0 = () => ({ zelle: null, verwaist: false, ab_beat: 0, versatz_beats: 0, wartend: null, zuletzt: null });
const spur = (g, nr) => ({ spur_id: `s${g}${nr}`, nr, name: `L${g}.${nr}`, fader_db: 0, mute: false, filter: 0, zellen: [zelle(1), null, zelle(3, { art: 'einmal' }), null, null, null, null, null], lauf: lauf0() });
const deck = (g) => ({ gruppe_id: `g${g}`, platz: g, raster: '1', spuren: [1, 2, 3, 4].map((n) => spur(g, n)) });

async function start(extra = {}) {
  const a = installiere({ html: HTML, antworten: { 'GET /loopdeck/stand': () => ({ j: { decks: { 1: deck(1), 2: deck(2) }, beat: 16, bpm: 120 } }), ...extra } });
  const m = await import('../public/loopdeck/view.js');
  m.zuruecksetzen(); m.zeigeLoopdecks(); await ruhe();
  return { a, m };
}
const posts = (a) => a.anrufe.filter((c) => c.methode === 'POST');
const dk = (n = 1) => document.querySelector(`.loopdeck[data-deck="${n}"]`);
const zk = (n, s, z) => dk(n).querySelectorAll('.ld-spur')[s - 1].querySelectorAll('.ld-zelle')[z - 1];
const menue = (n = 1) => dk(n).querySelector('.ld-zellmenue');
const eintrag = (n, art) => menue(n).querySelector(`[data-eintrag="${art}"]`);

test('right click on a filled cell opens the menu with its values; an empty cell has none', async () => {
  const { a } = await start();
  assert.equal(menue().hidden, true);
  zk(1, 1, 2).dispatch('contextmenu'); await ruhe();
  assert.equal(menue().hidden, true);
  zk(1, 2, 1).dispatch('contextmenu'); await ruhe();
  assert.equal(menue().hidden, false);
  assert.equal(menue().querySelector('.ld-mtitel').textContent, 'cell 1');
  assert.equal(eintrag(1, 'name').querySelector('input').value, 'cell 1');
  assert.equal(eintrag(1, 'gain').querySelector('input').value, '-3');
  assert.equal(eintrag(1, 'beats').querySelector('input').value, '8');
  assert.equal(menue().querySelectorAll('.ld-farbe').length, 16);
  assert.ok(menue().querySelector('.ld-farbe[data-farbe="1"]').classList.contains('an'));
  assert.equal(posts(a).length, 0);   // opening sends nothing
});

test('the handle opens the menu, only on filled cells', async () => {
  await start();
  assert.equal(zk(1, 1, 1).querySelector('.ld-griff').hidden, false);
  assert.equal(zk(1, 1, 2).querySelector('.ld-griff').hidden, true);
  zk(1, 1, 1).querySelector('.ld-griff').click(); await ruhe();
  assert.equal(menue().hidden, false);
});

test('every entry posts /loopdeck/zelle with deck, track, cell and its field', async () => {
  const { a } = await start();
  const sende = async (oeffnen, tue, erwartet) => {
    oeffnen(); await ruhe();
    tue(); await ruhe();
    assert.deepEqual(posts(a).at(-1), { url: '/loopdeck/zelle', methode: 'POST', koerper: erwartet });
    assert.equal(menue().hidden, true);   // the menu closes after an entry
  };
  const auf = () => zk(1, 2, 1).dispatch('contextmenu');
  await sende(auf, () => { const f = eintrag(1, 'name').querySelector('input'); f.value = ' kick '; f.dispatch('change'); }, { deck: 1, spur: 2, zelle: 1, name: 'kick' });
  await sende(auf, () => menue().querySelector('.ld-farbe[data-farbe="11"]').click(), { deck: 1, spur: 2, zelle: 1, farbe: 11 });
  await sende(auf, () => eintrag(1, 'art').querySelector('[data-art="einmal"]').click(), { deck: 1, spur: 2, zelle: 1, art: 'einmal' });
  await sende(auf, () => { const f = eintrag(1, 'gain').querySelector('input'); f.value = '-4,5'; f.dispatch('change'); }, { deck: 1, spur: 2, zelle: 1, gain_db: -4.5 });
  await sende(auf, () => { const f = eintrag(1, 'beats').querySelector('input'); f.value = '16'; f.dispatch('change'); }, { deck: 1, spur: 2, zelle: 1, beats: 16 });
});

test('Clear sends leeren: true', async () => {
  const { a } = await start();
  zk(1, 4, 3).dispatch('contextmenu'); await ruhe();
  eintrag(1, 'leeren').click(); await ruhe();
  assert.deepEqual(posts(a).at(-1), { url: '/loopdeck/zelle', methode: 'POST', koerper: { deck: 1, spur: 4, zelle: 3, leeren: true } });
});

test('the length field is hidden for a one-shot; bad numbers send nothing', async () => {
  const { a } = await start();
  zk(1, 1, 3).dispatch('contextmenu'); await ruhe();   // cell 3 is a one-shot
  assert.equal(eintrag(1, 'beats').hidden, true);
  const g = eintrag(1, 'gain').querySelector('input'); g.value = 'abc'; g.dispatch('change'); await ruhe();
  assert.equal(posts(a).length, 0);
  assert.equal(menue().hidden, false);
});

test('a refusal shows its reason in the message line and keeps the menu closed', async () => {
  const { a } = await start({ 'POST /loopdeck/zelle': { code: 409, j: { ok: false, grund: 'ki_gestoppt', text: 'Cypher is stopped' } } });
  zk(1, 1, 1).dispatch('contextmenu'); await ruhe();
  eintrag(1, 'leeren').click(); await ruhe();
  assert.match(document.querySelector('#meldung').textContent, /Cypher is stopped/);
  assert.equal(document.querySelector('#meldung').className, 'fehler');
  assert.equal(posts(a).length, 1);
});

test('a successful change reads the stand again', async () => {
  const { a } = await start();
  const vorher = a.anrufe.filter((c) => c.url === '/loopdeck/stand').length;
  zk(1, 1, 1).dispatch('contextmenu'); await ruhe();
  eintrag(1, 'leeren').click(); await ruhe();
  assert.equal(a.anrufe.filter((c) => c.url === '/loopdeck/stand').length, vorher + 1);
});

test('exportZiel: the selected cell, else the deck of the last selection, else deck 1 without cell', async () => {
  const { m } = await start();
  assert.deepEqual(m.exportZiel(), { deck: 1, spur: null, zelle: null });
  zk(2, 3, 4).click(); await ruhe();
  assert.deepEqual(m.exportZiel(), { deck: 2, spur: 3, zelle: 4 });
  zk(1, 1, 2).click(); await ruhe();
  assert.deepEqual(m.exportZiel(), { deck: 1, spur: 1, zelle: 2 });
});

test('library load: with a selected target of that deck it sends the target, without none', async () => {
  const { a, m } = await start({ 'POST /loopdeck/laden': { j: { ok: true, spur: 3, zelle: 4, zelle_id: 'x' } } });
  zk(2, 3, 4).click(); await ruhe();
  assert.equal(await m.ladeInDeck(2, { sha: 'abc' }), true);
  assert.deepEqual(posts(a).at(-1), { url: '/loopdeck/laden', methode: 'POST', koerper: { deck: 2, spur: 3, zelle: 4, quelle: { sha: 'abc' } } });
  assert.equal(m.zielVon(2), null);   // the selection is used up
  zk(1, 1, 2).click(); await ruhe();
  await m.ladeInDeck(2, { sha: 'def' });   // deck 2 has no target now, the one in deck 1 is not used
  assert.deepEqual(posts(a).at(-1).koerper, { deck: 2, quelle: { sha: 'def' } });
  assert.deepEqual(m.zielVon(1), { spur: 1, zelle: 2 });
});

test('library load refused with 409 shows the reason and keeps the selection', async () => {
  const { m } = await start({ 'POST /loopdeck/laden': { code: 409, j: { ok: false, grund: 'deck_voll', text: 'no empty cell in loop deck 1' } } });
  zk(1, 1, 2).click(); await ruhe();
  assert.equal(await m.ladeInDeck(1, { sha: 'abc' }), false);
  assert.match(document.querySelector('#meldung').textContent, /no empty cell in loop deck 1/);
  assert.deepEqual(m.zielVon(1), { spur: 1, zelle: 2 });
});
