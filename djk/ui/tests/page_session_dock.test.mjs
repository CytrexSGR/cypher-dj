// SESSION as a host of the shared dock (session view S1, lane V, V8): the TRACKS row of the DEVICES tab, built by session/dock_host.js on the dock of dock/.
// The host is mounted on the DOM stand-in with a fake view context; no fetch leaves the process, no studio port.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere } from './helpers/pages_mock.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const GRAPHEN = [{ name: 'fx-delay-sync', art: 'effekt' }, { name: 'fx-remix', art: 'effekt' }, { name: 'bass-banddrive', art: 'instrument' }];
const PLUGINS = [{ id: 'p1', name: 'Fine EQ', art: 'effekt', status: 'bereit' }];
const antworten = () => ({ 'GET /graphen': { j: { graphen: GRAPHEN } }, 'GET /plugins': { j: { plugins: PLUGINS } }, 'GET /graphen/panel': { j: {} }, 'GET /geraete/panel': { j: {} } });
installiere({ antworten: antworten() });
const { montiereSessionDock } = await import('../public/session/dock_host.js');
const { plusEintraege } = await import('../public/dock/plus.js');
const { KERN, kernZuX } = await import('../public/curves.js');

const ruhe = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok)); };
const ins = (id, art, extra = {}) => ({ id, art, slot: 1, an: true, werte: {}, ...extra });
const loopSpur = (id, nr, extra = {}) => ({ id, nr, name: `Loop ${nr}`, art: 'audio', farbe: '#3b8fe0', fader_db: 0, clips: [], zellen: [], filter: 0, eq: { tief: 0, mitte: 0, hoch: 0 }, ...extra });
const spalten = () => [1, 2].flatMap((deck) => [1, 2, 3, 4].map((n) => ({ spur_id: `${deck === 1 ? 'a' : 'b'}${n}`, kurz: `${deck === 1 ? 'C' : 'D'}${n}`, name: `Loop ${deck}.${n}`, deck, spur: n })));
const projekt = (extra = {}) => ({ name: 'live', live: true, rev: 5, master: { fader_db: 0, inserts: [] }, gruppen: [], returns: [],
  spuren: spalten().map((c, i) => loopSpur(c.spur_id, i + 1, c.spur_id === 'a1' ? { inserts: [ins('k1', 'komp'), ins('i2', 'bk', { graph: 'fx-delay-sync', slot: 2 })] } : {})), ...extra });

function baue(p = projekt(), opt = {}) {
  installiere({ antworten: antworten() });
  const dockEl = document.createElement('div');
  const t = { geschrieben: [], fenster: [], menues: [], meldungen: [], gewaehlt: null, projekt: p };
  t.ctx = { dockEl, projekt: () => t.projekt, spalten: () => opt.spalten ?? spalten(),
    aendere: async (label, befehle) => { t.geschrieben.push({ label, befehle }); return true; },
    melde: (x, f) => t.meldungen.push([x, f]), holeJson: async () => ({ status: 200, j: {} }),
    spaltenWahl: { lies: () => t.gewaehlt, setze: (id) => { t.gewaehlt = id; t.d.wahl(); } },
    oeffneFenster: (ziel) => { t.fenster.push(ziel); return null; }, oeffneMenue: (punkte) => t.menues.push(punkte) };
  t.d = montiereSessionDock(t.ctx);
  t.d.projekt(p, true);
  t.dockEl = dockEl;
  t.alle = (w) => dockEl.querySelectorAll(`[data-w="${w}"]`);
  return t;
}
const knopf = (karte, param) => karte.querySelectorAll('[data-w="karte-knopf"]').find((k) => k.getAttribute('data-param') === param);

test('one TRACKS card per column of the grid, labelled C1..D4 from the stand, in grid order', async () => {
  const t = baue(); await ruhe();
  const karten = t.alle('karte-spur');
  assert.deepEqual(karten.map((k) => k.getAttribute('data-spur-id')), ['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'b4']);
  assert.deepEqual(karten.map((k) => k.querySelector('.w-buchstabe').textContent), ['C1', 'C2', 'C3', 'C4', 'D1', 'D2', 'D3', 'D4']);
  assert.equal(t.dockEl.querySelector('.w-dock-etikett').textContent, 'TRACKS');
});

test('a column whose track is not in the project has no card; the order is the one of the grid', async () => {
  const p = projekt(); p.spuren = p.spuren.filter((s) => s.id !== 'a2');
  const t = baue(p, { spalten: spalten().reverse() }); await ruhe();
  assert.deepEqual(t.alle('karte-spur').map((k) => k.getAttribute('data-spur-id')), ['b4', 'b3', 'b2', 'b1', 'a4', 'a3', 'a1']);
});

test('the chips are the stages of the track in signal order, then FILTER and the isolator', async () => {
  const t = baue(); await ruhe();
  const a1 = t.alle('karte-spur')[0];
  assert.deepEqual(a1.querySelectorAll('[data-w="karte-teil"]').map((c) => [c.getAttribute('data-teil'), c.textContent]), [['k1', 'COMPRESSOR'], ['i2', 'fx-delay-sync']]);
  assert.deepEqual(a1.querySelectorAll('[data-w="karte-knopf"]').map((k) => k.getAttribute('data-param')), ['filter', 'eq.tief', 'eq.mitte', 'eq.hoch']);
  assert.deepEqual(a1.querySelectorAll('[data-w="karte-knopf"] .w-dreh-name').map((n) => n.textContent), ['FILTER', 'LO', 'MID', 'HI']);
});

test('+ INSERT offers what the PRODUCTION host offers: own effects, VST3 and LV2 plugins', async () => {
  const t = baue(); await ruhe();
  t.alle('karte-spur')[0].querySelector('[data-w="karte-plus"]').click(); await ruhe();
  assert.equal(t.menues.length, 1);
  const erwartet = plusEintraege(t.projekt, 'a1', GRAPHEN, { util: true, zaehler: true, plugins: PLUGINS, duck: [] });
  const texte = t.menues[0].map((x) => x.text);
  assert.deepEqual(texte.slice(0, erwartet.length), erwartet.map((x) => x.text));
  assert.ok(texte.includes('Duck by Kick'), 'the same options as PRODUCTION: Duck by Kick too');
  assert.ok(t.menues[0].some((x) => /^fx-delay-sync/.test(x.text)) && t.menues[0].some((x) => /^Fine EQ/.test(x.text)));
});

test('a chip opens the stage window of the page; OPEN ↗ opens the instrument window of the track target', async () => {
  const p = projekt(); p.spuren.push({ id: 'g1', nr: 9, name: 'Lead', art: 'instrument', farbe: '#e0a33e', fader_db: 0, clips: [], geraet: { art: 'intern', name: 'bk', graph: 'bass-banddrive', parameter: {} } });
  const sp = [...spalten(), { spur_id: 'g1', kurz: 'D9', name: 'Lead' }];
  const t = baue(p, { spalten: sp }); await ruhe();
  t.alle('karte-spur')[0].querySelector('[data-w="karte-teil"]').click();
  assert.deepEqual(t.fenster, ['ins:k1']);
  const g1 = t.alle('karte-spur').find((k) => k.getAttribute('data-spur-id') === 'g1');
  g1.querySelector('[data-w="karte-auf"]').click();
  assert.deepEqual(t.fenster.at(-1), 'g1');
});

test('a front knob writes through aendere, one request and so one undo step per change; the project is not touched by the card', async () => {
  const t = baue(); await ruhe();
  const a1 = t.alle('karte-spur')[0];
  knopf(a1, 'filter').dispatch('keydown', { key: 'ArrowUp' }); await ruhe();
  assert.equal(t.geschrieben.length, 1);
  assert.deepEqual(t.geschrieben[0].befehle, [{ befehl: 'spur_aendern', spur_id: 'a1', filter: 0.04 }]);
  assert.match(t.geschrieben[0].label, /Filter/);
  knopf(a1, 'eq.mitte').dispatch('keydown', { key: 'ArrowUp' }); await ruhe();
  assert.equal(t.geschrieben.length, 2);
  const b = t.geschrieben[1].befehle[0];
  assert.equal(b.befehl, 'spur_aendern'); assert.equal(b.spur_id, 'a1'); assert.deepEqual(Object.keys(b.eq), ['mitte']);
  assert.ok(Math.abs(b.eq.mitte - (-26 + (kernZuX(KERN.eq, 0) + 0.02) * 32)) < 0.01, `mitte ${b.eq.mitte}`);
});

test('a knob shows the value of the project: FILTER and the isolator follow a change', async () => {
  const t = baue(); await ruhe();
  const p = projekt(); p.spuren.find((s) => s.id === 'a1').filter = 0.5; p.spuren.find((s) => s.id === 'a1').eq = { tief: -200, mitte: 0, hoch: 0 };
  t.projekt = p; t.d.projekt(p); await ruhe();
  const a1 = t.alle('karte-spur')[0];
  assert.equal(knopf(a1, 'filter').querySelector('.w-dreh-wert').textContent, '0.50');
  assert.equal(knopf(a1, 'eq.tief').querySelector('.w-dreh-wert').textContent, 'kill');
});

test('the host draws no markup of its own: no class="knopf" in session/dock_host.js, the cards come from dock/karten.js', () => {
  const q = fs.readFileSync(path.join(PUBLIC, 'session/dock_host.js'), 'utf8');
  assert.doesNotMatch(q, /class="knopf"/);
  assert.doesNotMatch(q, /createElement|innerHTML/);
  assert.match(q, /from '\.\.\/dock\/dock\.js'/);
  assert.match(fs.readFileSync(path.join(PUBLIC, 'dock/dock.js'), 'utf8'), /from '\.\/karten\.js'/);
});

// V9: the EFFECTS row and the MASTER card of the SESSION dock
const decksProjekt = () => projekt({
  returns: [
    { id: 'r1', name: 'Hall', farbe: '#7a5ad0', fader_db: 0, inserts: [ins('rh', 'hall')] },
    { id: 'r2', name: 'L1 HALL', farbe: '#5a7ad0', fader_db: 0, inserts: [ins('lh', 'hall')], loopdeck: { platz: 1, art: 'hall' } },
    { id: 'r3', name: 'L2 DLY', farbe: '#5a7ad0', fader_db: 0, inserts: [ins('ld', 'bk', { graph: 'fx-delay-sync' })], loopdeck: { platz: 2, art: 'dly' } },
  ],
});

test('the EFFECTS row lists every return of the live project; deck HALL and DLY name their deck in FROM', async () => {
  const t = baue(decksProjekt()); await ruhe();
  const karten = t.alle('karte-fx');
  assert.deepEqual(karten.map((k) => k.getAttribute('data-return-id')), ['r1', 'r2', 'r3']);
  const von = karten.map((k) => k.querySelector('[data-w="karte-von"]').textContent);
  assert.match(von[1], /L1/); assert.match(von[2], /L2/);
  assert.deepEqual(t.dockEl.querySelectorAll('.w-dock-etikett').map((e) => e.textContent), ['TRACKS', 'EFFECTS']);
});

test('+ LOAD EFFECT offers what PRODUCTION offers (fxMenue of werkbank/mix.js)', async () => {
  const t = baue(decksProjekt()); await ruhe();
  const laden = t.alle('fx-laden')[0];
  assert.ok(laden, 'the + LOAD EFFECT card is there');
  laden.click(); await ruhe();
  assert.equal(t.menues.length, 1);
  const { fxMenue } = await import('../public/werkbank/mix.js');
  assert.deepEqual(t.menues[0].map((x) => x.text), fxMenue(t.projekt, GRAPHEN).map((x) => x.text));
});

test('the MASTER card stands at the right end of the EFFECTS row, after + LOAD EFFECT', async () => {
  const t = baue(decksProjekt()); await ruhe();
  const fx = t.alle('dock-fx')[0];
  const kinder = fx.children.map((c) => c.getAttribute('data-w'));
  assert.equal(kinder.at(-1), 'karte-master', `children: ${kinder}`);
  assert.ok(kinder.indexOf('fx-laden') < kinder.indexOf('karte-master'));
});
