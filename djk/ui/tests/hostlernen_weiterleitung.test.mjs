// Host learn: forwarding of /e/hand on mapped slot rows to the instrument host (fake host, no sockets).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weiterleitung, normVonAnzeige } from '../areas/hostlernen/weiterleitung.ts';
import { anzeigeWert } from '../devices_parameter.ts';

const CUTOFF = { name: 'a_filter1_cutoff', label: 'Cutoff', min: -60, max: 70, log: false, vorgabe: 0.5, punkte: [-60, -20, 10, 40, 70] };
const still = () => new Promise((r) => setTimeout(r, 15));

function aufbau({ geladen = {}, ziele, antwort } = {}) {
  const befehle = [], log = [];
  const frei = [];   // pending host answers, resolved by the test (a slow host)
  const host = { art: () => 'lv2', setzeRegler: async () => true,
    ruf: (gruppe, b) => { befehle.push([gruppe, b]); return antwort ? antwort(b) : new Promise((ok) => frei.push(() => ok({ ok: true }))); } };
  const zz = ziele ?? { 'erz/2/bk/1': { gruppe: 'bass', art: 'surge', name: 'a_filter1_cutoff' }, 'erz/3/bk/4': { gruppe: 'melodie', art: 'rb338', name: 'Cutoff' } };
  const w = new Weiterleitung({ host: () => host, ziele: () => zz, geladen: () => geladen, surgeParameter: (n) => (n === CUTOFF.name ? CUTOFF : undefined), log: (z) => log.push(z) });
  return { w, befehle, log, frei };
}
const hand = (pfad, wert) => ['/e/hand', { pfad, wert }];

test('a hand event on a mapped Surge slot sends one fahre with von and bis in display units, dauer 0.05', async () => {
  const x = aufbau({ antwort: async () => ({ ok: true }) });
  x.w.merke('erz/2/bk/1', -20);
  x.w.ereignis(...hand('erz/2/bk/1', 0.75));
  await still();
  assert.equal(x.befehle.length, 1);
  assert.deepEqual(x.befehle[0], ['bass', { befehl: 'fahre', name: 'a_filter1_cutoff', bis: anzeigeWert(CUTOFF, 0.75), von: -20, dauer: 0.05, spur: 'klang-bass', form: 'linear' }]);
  assert.equal(anzeigeWert(CUTOFF, 0.75), 40);
  x.w.ereignis(...hand('erz/2/bk/1', 1));
  await still();
  assert.equal(x.befehle[1][1].von, 40, 'von is the value sent last');
  assert.equal(x.befehle[1][1].bis, 70);
});

test('without a known value von is the target itself (von is never left out)', async () => {
  const x = aufbau({ antwort: async () => ({ ok: true }) });
  x.w.ereignis(...hand('erz/2/bk/1', 0.5));
  await still();
  assert.equal(x.befehle[0][1].von, x.befehle[0][1].bis);
  assert.ok('von' in x.befehle[0][1]);
});

test('RB-338 and VST3 slots send param with the normalised value', async () => {
  const x = aufbau({ antwort: async () => ({ ok: true }) });
  x.w.ereignis(...hand('erz/3/bk/4', 0.3));
  await still();
  assert.deepEqual(x.befehle, [['melodie', { befehl: 'param', name: 'Cutoff', wert: 0.3 }]]);
});

test('no forwarding while a graph is loaded on the channel, none for unmapped slots, other addresses or other channels', async () => {
  const x = aufbau({ geladen: { 'erz/2': 'bass-sub' }, antwort: async () => ({ ok: true }) });
  x.w.ereignis(...hand('erz/2/bk/1', 0.5));   // graph on erz/2
  x.w.ereignis(...hand('erz/2/bk/9', 0.5));   // not mapped
  x.w.ereignis('/e/regler', { pfad: 'erz/3/bk/4', wert: 0.5 });
  x.w.ereignis(...hand('erz/5/bk/4', 0.5));
  x.w.ereignis('/e/hand', { pfad: 'erz/3/bk/4', wert: 'x' });
  await still();
  assert.deepEqual(x.befehle, []);
  x.w.ereignis(...hand('erz/3/bk/4', 0.5));   // erz/3 has no graph
  await still();
  assert.equal(x.befehle.length, 1);
});

test('a burst of 100 events costs the first and the last value: one command in flight per parameter, the latest value wins', async () => {
  const x = aufbau();
  for (let i = 1; i <= 100; i++) x.w.ereignis(...hand('erz/2/bk/1', i / 100));
  assert.equal(x.befehle.length, 1, 'only the first goes out while it is in flight');
  x.frei.shift()();
  await still();
  assert.equal(x.befehle.length, 2, 'then the latest value');
  assert.equal(x.befehle[1][1].bis, 70);
  assert.equal(x.befehle[1][1].von, anzeigeWert(CUTOFF, 0.01));
  x.frei.shift()();
  await still();
  assert.equal(x.befehle.length, 2, 'nothing more is waiting');
  x.w.ereignis(...hand('erz/2/bk/1', 0.2));   // idle again: goes out at once
  assert.equal(x.befehle.length, 3);
});

test('parameters are independent, and a refused or failing host only logs and does not stop the following moves', async () => {
  const x = aufbau();
  x.w.ereignis(...hand('erz/2/bk/1', 0.5));
  x.w.ereignis(...hand('erz/3/bk/4', 0.5));
  assert.equal(x.befehle.length, 2, 'one in flight per parameter');
  const y = aufbau({ antwort: async (b) => (b.befehl === 'fahre' ? { ok: false, fehler: 'boom' } : (() => { throw new Error('socket'); })()) });
  y.w.ereignis(...hand('erz/2/bk/1', 0.5));
  y.w.ereignis(...hand('erz/3/bk/4', 0.5));
  await still();
  assert.equal(y.log.length, 2);
  y.w.ereignis(...hand('erz/2/bk/1', 0.6));
  await still();
  assert.equal(y.befehle.length, 3);
});

test('normVonAnzeige inverts anzeigeWert over the punkte curve and the linear range', () => {
  for (const n of [0, 0.1, 0.25, 0.5, 0.8, 1]) assert.ok(Math.abs(normVonAnzeige(CUTOFF, anzeigeWert(CUTOFF, n)) - n) < 1e-9, String(n));
  assert.equal(normVonAnzeige(CUTOFF, -100), 0);
  assert.equal(normVonAnzeige(CUTOFF, 100), 1);
  assert.equal(normVonAnzeige({ min: 0, max: 10 }, 5), 0.5);
  assert.equal(normVonAnzeige({ min: 3, max: 3 }, 3), 0);
});
