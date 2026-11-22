// Loop deck drag and drop (loop deck P4): library rows and cells dropped on cells, module stems as sources. DOM stand-in and fake fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere } from './helpers/pages_mock.mjs';
import { TYP_QUELLE, TYP_ZELLE } from '../public/loopdeck/drag.js';

const HTML = '<body><div id="meldung"></div><section id="platz-loops"><div class="loopdeck" data-deck="1"></div></section><section id="platz-loops2"><div class="loopdeck" data-deck="2"></div></section></body>';
const ruhe = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok)); };
const zelle = (n, extra = {}) => ({ id: `z${n}`, name: `cell ${n}`, farbe: n, art: 'loop', sha256: `sha${n}`, beats: 8, bpm: 128, gain_db: 0, frames: 1000, ...extra });
const lauf0 = () => ({ zelle: null, verwaist: false, ab_beat: 0, versatz_beats: 0, wartend: null, zuletzt: null });
const spur = (g, nr, lauf = lauf0()) => ({ spur_id: `s${g}${nr}`, nr, name: `L${g}.${nr}`, fader_db: 0, mute: false, filter: 0, zellen: [zelle(1), null, zelle(3), null, null, null, null, null], lauf });
const deck = (g) => ({ gruppe_id: `g${g}`, platz: g, raster: '1', spuren: [1, 2, 3, 4].map((n) => spur(g, n, g === 1 && n === 1 ? { ...lauf0(), zelle: 1 } : lauf0())) });

async function start(extra = {}) {
  const a = installiere({ html: HTML, antworten: { 'GET /loopdeck/stand': () => ({ j: { decks: { 1: deck(1), 2: deck(2) }, beat: 16, bpm: 120 } }), ...extra } });
  const m = await import('../public/loopdeck/view.js');
  m.zuruecksetzen(); m.zeigeLoopdecks(); await ruhe();
  return { a, m };
}
const posts = (a) => a.anrufe.filter((c) => c.methode === 'POST');
const zk = (n, s, z) => document.querySelector(`.loopdeck[data-deck="${n}"]`).querySelectorAll('.ld-spur')[s - 1].querySelectorAll('.zelle')[z - 1];
// a drag event with a transfer that remembers what was set
const transfer = (daten = {}) => {
  const d = { ...daten };
  return { types: Object.keys(d), setData: (t, v) => { d[t] = v; }, getData: (t) => d[t] ?? '', effectAllowed: '', dropEffect: '' };
};
const ablegen = async (ziel, daten) => { ziel.dispatch('drop', { dataTransfer: transfer(daten) }); await ruhe(); };
const stand = (a) => a.anrufe.filter((c) => c.url === '/loopdeck/stand').length;

test('only filled cells are draggable, playing ones included; the drag carries deck, track and cell', async () => {
  await start();
  assert.equal(zk(1, 1, 1).getAttribute('draggable'), 'true');   // track 1 cell 1 is playing
  assert.equal(zk(1, 1, 2).getAttribute('draggable'), 'false');
  const t = transfer();
  zk(2, 3, 3).dispatch('dragstart', { dataTransfer: t });
  assert.deepEqual(JSON.parse(t.getData(TYP_ZELLE)), { deck: 2, spur: 3, zelle: 3 });
  const leer = transfer(); let verhindert = false;
  zk(2, 3, 2).dispatch('dragstart', { dataTransfer: leer, preventDefault: () => { verhindert = true; } });
  assert.equal(verhindert, true);
  assert.equal(leer.getData(TYP_ZELLE), '');
});

test('a cell dropped on another cell of the other deck posts bewegen with both coordinates, then reads the stand', async () => {
  const { a } = await start({ 'POST /loopdeck/bewegen': { j: { ok: true } } });
  const s0 = stand(a);
  await ablegen(zk(2, 4, 5), { [TYP_ZELLE]: JSON.stringify({ deck: 1, spur: 1, zelle: 1 }) });
  assert.deepEqual(posts(a), [{ url: '/loopdeck/bewegen', methode: 'POST', koerper: { von: { deck: 1, spur: 1, zelle: 1 }, nach: { deck: 2, spur: 4, zelle: 5 } } }]);
  assert.equal(stand(a), s0 + 1);
  assert.match(document.querySelector('#meldung').textContent, /Moved to LOOP 2, track 4, cell 5/);
});

test('a drop on the cell the drag started from does nothing and posts nothing', async () => {
  const { a } = await start({ 'POST /loopdeck/bewegen': { j: { ok: true } } });
  const s0 = stand(a);
  await ablegen(zk(1, 2, 3), { [TYP_ZELLE]: JSON.stringify({ deck: 1, spur: 2, zelle: 3 }) });
  assert.equal(posts(a).length, 0);
  assert.equal(stand(a), s0);
});

test('a refused move changes nothing on the page: no stand read, the reason shows', async () => {
  const { a } = await start({ 'POST /loopdeck/bewegen': { code: 409, j: { ok: false, grund: 'zelle_laedt' } } });
  const s0 = stand(a);
  await ablegen(zk(1, 4, 4), { [TYP_ZELLE]: JSON.stringify({ deck: 1, spur: 1, zelle: 1 }) });
  assert.equal(posts(a).length, 1);
  assert.equal(stand(a), s0);
  assert.equal(zk(1, 1, 1).classList.contains('spielt'), true);   // the dragged cell is still there
  assert.match(document.querySelector('#meldung').textContent, /That cell is still loading\./);
});

test('a library row dropped on a cell posts laden with that target and the source', async () => {
  const { a } = await start({ 'POST /loopdeck/laden': { j: { ok: true, spur: 2, zelle: 6, zelle_id: 'x' } } });
  await ablegen(zk(1, 2, 6), { [TYP_QUELLE]: JSON.stringify({ sha: 'abc' }) });
  assert.deepEqual(posts(a), [{ url: '/loopdeck/laden', methode: 'POST', koerper: { deck: 1, spur: 2, zelle: 6, quelle: { sha: 'abc' } } }]);
  assert.match(document.querySelector('#meldung').textContent, /Loaded into LOOP 1, track 2, cell 6/);
});

test('dragover accepts only our drags and lights the target; a foreign or malformed drop is ignored', async () => {
  const { a } = await start();
  let angenommen = 0;
  zk(1, 2, 2).dispatch('dragover', { dataTransfer: transfer({ 'text/plain': 'x' }), preventDefault: () => { angenommen++; } });
  assert.equal(angenommen, 0);
  zk(1, 2, 2).dispatch('dragover', { dataTransfer: transfer({ [TYP_QUELLE]: '{}' }), preventDefault: () => { angenommen++; } });
  assert.equal(angenommen, 1);
  assert.ok(zk(1, 2, 2).classList.contains('ablage'));
  zk(1, 2, 2).dispatch('dragleave');
  assert.equal(zk(1, 2, 2).classList.contains('ablage'), false);
  await ablegen(zk(1, 2, 2), { 'text/plain': 'x' });
  await ablegen(zk(1, 2, 2), { [TYP_QUELLE]: 'not json' });
  await ablegen(zk(1, 2, 2), { [TYP_ZELLE]: JSON.stringify({ deck: 1, spur: 0, zelle: 'a' }) });
  assert.equal(posts(a).length, 0);
});

test('module stem entries carry { modul, stem } and the main loop { modul }; the buttons load into a loop deck', async () => {
  const { modulZeilen, bindeModule } = await import('../public/module_library.js');
  const html = modulZeilen([{ id: 'm1', titel: 'Song', kuenstler: '', tonart: '', datum: '', set: '', stems: true, stem_namen: ['Drums', 'Bass', 'Other', 'Vocals', 'Guitar', 'Piano'] }]);
  const quellen = [...html.matchAll(/class="modul-ziehen"[^>]*data-modul-quelle="([^"]*)"/g)].map((x) => JSON.parse(x[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')));
  assert.deepEqual(quellen[0], { modul: 'm1' });
  assert.deepEqual(quellen.slice(1).map((q) => q.stem), ['Drums', 'Bass', 'Other', 'Vocals', 'Guitar', 'Piano']);
  assert.ok(quellen.slice(1).every((q) => q.modul === 'm1'));
  assert.equal([...html.matchAll(/data-modul-laden="1"/g)].length, 7);
  assert.equal([...html.matchAll(/data-modul-laden="2"/g)].length, 7);
  const lose = modulZeilen([{ id: 'm2', titel: 'Loop only', stems: false }]);
  assert.equal([...lose.matchAll(/class="modul-ziehen"/g)].length, 1);
  // the click on a button and the dragstart on a label, through the tab's handlers
  const el = () => { const e = { innerHTML: '', value: '', ereignisse: {}, addEventListener: (n, f) => { e.ereignisse[n] = f; }, kinder: {}, querySelector: (s) => e.kinder[s] }; return e; };
  const reiter = el(), tabelle = el(), suche = el(), liste = el();
  tabelle.kinder['[data-modul-suche]'] = suche; tabelle.kinder['[data-modul-liste]'] = liste;
  const geladen = [];
  bindeModule({ reiter, tabelle, ruf: async () => ({ code: 200, j: { module: [] } }), laden: (n, q) => geladen.push([n, q]) });
  const knopf = { dataset: { modulLaden: '2', modulQuelle: JSON.stringify({ modul: 'm1', stem: 'Bass' }) } };
  liste.ereignisse.click({ target: { closest: (s) => (s === '[data-modul-laden]' ? knopf : null) } });
  assert.deepEqual(geladen, [[2, { modul: 'm1', stem: 'Bass' }]]);
  const t = transfer();
  liste.ereignisse.dragstart({ target: { closest: () => ({ dataset: { modulQuelle: JSON.stringify({ modul: 'm1', stem: 'Drums' }) } }) }, dataTransfer: t });
  assert.deepEqual(JSON.parse(t.getData(TYP_QUELLE)), { modul: 'm1', stem: 'Drums' });
});

test('a loop row of the library is a drag source for { sha }; a row that cannot load is not', async () => {
  installiere({ html: HTML, antworten: {} });
  const { stoebernZeile } = await import('../public/browse_table.js');
  const t0 = transfer();
  const ok = stoebernZeile({ typ: 'loop', sha: 'f'.repeat(64), name: 'x', pfad_da: true, import_grund: null }, 0);
  assert.equal(ok.getAttribute('draggable'), 'true');
  ok.dispatch('dragstart', { dataTransfer: t0 });
  assert.deepEqual(JSON.parse(t0.getData(TYP_QUELLE)), { sha: 'f'.repeat(64) });
  const nein = stoebernZeile({ typ: 'loop', sha: 'e'.repeat(64), name: 'y', pfad_da: true, nur_live: true }, 1);
  assert.equal(nein.getAttribute('draggable'), null);
  assert.equal(stoebernZeile({ typ: 'track', sha: 'd'.repeat(64), material_id: 'm', pfad_da: true }, 2).getAttribute('draggable'), null);
});

test('a row of the LOOPS tab is a drag source for { loop: name }; a row that cannot load is not', async () => {
  const { El } = await import('./helpers/pages_mock.mjs');
  if (!('cells' in El.prototype)) Object.defineProperty(El.prototype, 'cells', { get() { return this.elemente; }, configurable: true });
  installiere({ html: '<body><div id="meldung"></div><table><tbody id="loopliste"></tbody></table></body>',
    antworten: { 'GET /loops': { j: [{ name: 'drums-a', beats: 8, quelle: 'q', erstellt: '2026-11-20' }, { name: 'broken', beats: 8, ladbar: false, grund: 'audio missing' }] } } });
  const r = await import('../public/loop_rec_view.js');
  await r.ladeLoops(); await ruhe();
  const zeilen = document.querySelectorAll('#loopliste tr');
  assert.equal(zeilen.length, 2);
  assert.equal(zeilen[0].getAttribute('draggable'), 'true');
  const t = transfer();
  zeilen[0].dispatch('dragstart', { dataTransfer: t });
  assert.deepEqual(JSON.parse(t.getData(TYP_QUELLE)), { loop: 'drums-a' });
  assert.equal(zeilen[1].getAttribute('draggable'), null);
});
