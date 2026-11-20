// The + INSERT entries of the dock (pure): pool counts, utility, plugins, Duck by Kick, the full strip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere } from './helpers/pages_mock.mjs';

installiere();
const { plusEintraege, PLUS_VOLL_TEXT } = await import('../public/dock/plus.js');
const { ARTEN, HOST_ART, MAX_PLAETZE } = await import('../public/production/inserts.js');
const { MAX_HOST } = await import('../public/production/limits.js');
const { duckBefehl } = await import('../public/production/key_choice.js');

const ins = (id, art, slot, extra = {}) => ({ id, art, slot, an: true, werte: {}, ...extra });
const spur = (nr, inserts = []) => ({ id: `s${nr}`, nr, name: `T${nr}`, farbe: '#2fd6c3', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'g', parameter: {} }, clips: [], inserts });
const projekt = (spuren) => ({ name: 'M', rev: 1, spuren });
const GRAPHEN = [{ name: 'fx-delay-sync', art: 'effekt' }, { name: 'fx-plate', art: 'effekt' }, { name: 'bass-x', art: 'instrument' }];
const PLUGINS = [
  { id: 'p1', name: 'Fine EQ', art: 'effekt', status: 'bereit' },
  { id: 'p2', name: 'Broken', art: 'effekt', status: 'blockiert', grund: 'x', text: 'Needs a newer host' },
  { id: 'p3', name: 'Synth', art: 'instrument', status: 'bereit' },
];

test('plusEintraege with no options keeps the STUDIO list', () => {
  const e = plusEintraege(projekt([spur(1)]), 's1', GRAPHEN);
  assert.deepEqual(e.map((x) => x.text), ['Compressor', 'EQ', 'Saturator', 'Limiter', 'fx-delay-sync', 'fx-plate']);
  assert.deepEqual(e[1].befehl, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'eq' });
});

test('util and zaehler: Utility after Limiter and the used/max counts', () => {
  const p = projekt([spur(1, [ins('k1', 'komp', 1)])]);
  const e = plusEintraege(p, 's1', GRAPHEN, { util: true, zaehler: true });
  assert.deepEqual(e.slice(0, 5).map((x) => x.text), ['Compressor 1/12', 'EQ 0/8', 'Saturator 0/4', 'Limiter 0/2', 'Utility 0/8']);
  assert.deepEqual(e[4].befehl, { befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'utility' });
});

test('a full pool greys its entry with the pool text', () => {
  const eqs = Array.from({ length: 8 }, (_, i) => ins(`e${i}`, 'eq', i + 1));
  const p = projekt([spur(1, eqs.slice(0, 4)), spur(2, eqs.slice(4)), spur(3)]);
  const e = plusEintraege(p, 's3', GRAPHEN, { zaehler: true });
  const eq = e.find((x) => x.text === 'EQ 8/8');
  assert.equal(eq.befehl, null);
  assert.equal(eq.grund, ARTEN.eq.voll);
  assert.notEqual(e.find((x) => x.text === 'Compressor 0/12').befehl, null);
});

test('a strip with five stages greys every entry with the strip text', () => {
  const p = projekt([spur(1, Array.from({ length: MAX_PLAETZE }, (_, i) => ins(`e${i}`, 'eq', i + 1))), spur(2)]);
  const e = plusEintraege(p, 's1', GRAPHEN, { util: true, zaehler: true, plugins: PLUGINS, duck: [{ id: 's2', nr: 2, name: 'T2' }] });
  const eintraege = e.filter((x) => !x.gruppe);
  assert.ok(eintraege.length > 8);
  assert.ok(eintraege.every((x) => x.befehl === null && x.grund === PLUS_VOLL_TEXT));
});

test('plugins: effects only, the blocked one greyed with its reason', () => {
  const e = plusEintraege(projekt([spur(1)]), 's1', [], { zaehler: true, plugins: PLUGINS });
  const i = e.findIndex((x) => x.gruppe && x.text === 'Plugins');
  assert.ok(i >= 0);
  const pl = e.slice(i + 1);
  assert.deepEqual(pl.map((x) => x.text), [`Fine EQ 0/${MAX_HOST}`, `Broken 0/${MAX_HOST}`]);
  assert.deepEqual(pl[0].befehl, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'host', plugin_id: 'p1' });
  assert.equal(pl[1].befehl, null);
  assert.equal(pl[1].grund, 'Needs a newer host');
});

test('plugins: no group when the list is empty or only instruments', () => {
  const e = plusEintraege(projekt([spur(1)]), 's1', [], { plugins: [PLUGINS[2]] });
  assert.ok(!e.some((x) => x.gruppe));
});

test('four host stages in the project grey every plugin entry', () => {
  const hosts = Array.from({ length: MAX_HOST }, (_, i) => ins(`h${i}`, 'host', i + 1));
  const p = projekt([spur(1, hosts), spur(2)]);
  const e = plusEintraege(p, 's2', [], { zaehler: true, plugins: PLUGINS });
  const pl = e.slice(e.findIndex((x) => x.gruppe) + 1);
  assert.equal(pl.length, 2);
  assert.ok(pl.every((x) => x.befehl === null));
  assert.equal(pl[0].grund, HOST_ART.voll);
  assert.equal(pl[0].text, `Fine EQ ${MAX_HOST}/${MAX_HOST}`);
});

test('duck entries write duckBefehl with the label', () => {
  const e = plusEintraege(projekt([spur(1), spur(2)]), 's1', [], { duck: [{ id: 's2', nr: 2, name: 'Kick' }] });
  const i = e.findIndex((x) => x.gruppe && x.text === 'Duck by Kick');
  assert.ok(i >= 0);
  assert.equal(e[i + 1].text, 'Track 2 Kick');
  assert.deepEqual(e[i + 1].befehl, duckBefehl('s1', 's2'));
  assert.equal(e[i + 1].label, 'Duck T1 by Kick');
});
