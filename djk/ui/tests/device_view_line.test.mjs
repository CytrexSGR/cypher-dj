// P2 (controller follow): the device panel of a Baukasten track follows its core row spur/<slot>/bk/<k> (zustand.regler, a controller moved it) without sending
// anything; a project value that arrives replaces the row value shown before it. The slot comes from the existing bkSlot rule of the page (bkSlotNr).
import test from 'node:test';
import assert from 'node:assert/strict';
import { bkSlotNr, bkZeilenPfad, spurAdapter, zeilenAbo, zeilenEcho, BK_LIVE_SLOTS } from '../public/production/device_view.js';

const bk = (id, nr, parameter = {}) => ({ id, nr, name: id, art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'synth-mono', parameter }, clips: [] });
const rb = (id, nr) => ({ id, nr, name: id, art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} }, clips: [] });
const TABELLE = [{ name: 'k3', min: 0, max: 1, log: false, vorgabe: 0.5 }];

test('bkSlotNr: the running number among the bk tracks by ascending nr, other devices do not count', () => {
  const spuren = [bk('s5', 5), rb('s2', 2), bk('s3', 3), bk('s9', 9)];
  assert.equal(bkSlotNr(spuren, 's3'), 1);
  assert.equal(bkSlotNr(spuren, 's5'), 2);
  assert.equal(bkSlotNr(spuren, 's9'), 3);
  assert.equal(bkSlotNr(spuren, 's2'), null);
  assert.equal(bkSlotNr(spuren, 'nope'), null);
  assert.equal(bkSlotNr(undefined, 's1'), null);
});

test('bkZeilenPfad: spur/<slot>/bk/<k> for k1..k64 of every bk track up to BK_LIVE_SLOTS (16), otherwise none', () => {
  const spuren = Array.from({ length: 17 }, (_, i) => bk(`s${i + 1}`, i + 1));
  assert.equal(bkZeilenPfad(spuren, 's2', 'k7'), 'spur/2/bk/7');
  assert.equal(bkZeilenPfad(spuren, 's1', 'k64'), 'spur/1/bk/64');
  assert.equal(bkZeilenPfad(spuren, 's1', 'k65'), null, 'beyond the knob rows');
  assert.equal(bkZeilenPfad(spuren, 's1', 'cutoff'), null);
  assert.equal(bkZeilenPfad(spuren, `s${BK_LIVE_SLOTS}`, 'k1'), `spur/${BK_LIVE_SLOTS}/bk/1`);
  assert.equal(bkZeilenPfad(spuren, 's9', 'k1'), 'spur/9/bk/1', 'the 9th bk track has a core row too');
  assert.equal(BK_LIVE_SLOTS, 16);
  assert.equal(bkZeilenPfad(spuren, 's17', 'k1'), null, 'a 17th bk track (the project refuses it) has no row');
  assert.equal(bkZeilenPfad(spuren, 'gone', 'k1'), null);
});

function aufbau(zeilen) {
  const spuren = [rb('s1', 1), bk('s2', 2, { k3: 0.2 })];
  const gesendet = [];
  const ctx = { st: { projekt: { spuren } }, aendere: async (l, b) => { gesendet.push(b); return true; }, aendereAus: async (f) => { gesendet.push(f(ctx.st.projekt)); return true; } };
  const ad = spurAdapter(ctx, spuren[1], TABELLE, { zeile: (pfad) => zeilen[pfad], entprellMs: 1 });
  return { ad, ctx, spuren, gesendet, projektWert: (v) => { spuren[1].geraet.parameter.k3 = v; } };
}

test('the knob shows the row value when a controller moved it, and sends nothing', () => {
  const zeilen = {};
  const { ad, gesendet } = aufbau(zeilen);
  assert.equal(ad.get('k3'), 0.2, 'no row value: the project value');
  zeilen['spur/1/bk/3'] = 0.7;   // s2 is the first bk track: slot 1
  assert.equal(ad.get('k3'), 0.7, 'the row moved: the knob follows');
  zeilen['spur/1/bk/3'] = 0.9;
  assert.equal(ad.get('k3'), 0.9);
  assert.deepEqual(gesendet, [], 'following a row sends nothing');
});

test('a project value that arrives wins over the row value shown before; a later row move wins again', () => {
  const zeilen = { 'spur/1/bk/3': 0.7 };
  const { ad, projektWert } = aufbau(zeilen);
  assert.equal(ad.get('k3'), 0.7);
  projektWert(0.4);                       // Cypher, undo or the write-back brings a project value
  assert.equal(ad.get('k3'), 0.4, 'the project value holds');
  assert.equal(ad.get('k3'), 0.4, 'and stays while nothing changes');
  zeilen['spur/1/bk/3'] = 0.55;
  assert.equal(ad.get('k3'), 0.55, 'the row moved after that');
});

test('own gesture: the shown value stays until its write was answered, the row does not push it around', () => {
  const zeilen = { 'spur/1/bk/3': 0.7 };
  const { ad } = aufbau(zeilen);
  ad.set('k3', 0.1);
  zeilen['spur/1/bk/3'] = 0.8;
  assert.equal(ad.get('k3'), 0.1, 'the gesture value shows while the knob is held');
});

test('a bk track beyond BK_LIVE_SLOTS, or any other device, has no row: the project value', () => {
  const zeilen = { [`spur/${BK_LIVE_SLOTS + 1}/bk/3`]: 0.9 };
  const spuren = Array.from({ length: BK_LIVE_SLOTS + 1 }, (_, i) => bk(`s${i + 1}`, i + 1, { k3: 0.2 }));
  const ctx = { st: { projekt: { spuren } }, aendere: async () => true };
  assert.equal(spurAdapter(ctx, spuren[BK_LIVE_SLOTS], TABELLE, { zeile: (p) => zeilen[p] }).get('k3'), 0.2);
  const rbSpur = rb('r', 20);
  assert.equal(spurAdapter({ st: { projekt: { spuren: [rbSpur] } } }, rbSpur, [{ name: 'cutoff', vorgabe: 0.3 }], { zeile: () => 0.99 }).get('cutoff'), 0.3);
});

test('zeilenEcho tells every subscriber, one that throws stops no other, the remover works', () => {
  const gesehen = [];
  const weg1 = zeilenAbo(() => { throw new Error('x'); });
  const weg2 = zeilenAbo((p) => gesehen.push(p));
  zeilenEcho('spur/1/bk/3');
  weg1(); weg2();
  zeilenEcho('spur/1/bk/4');
  assert.deepEqual(gesehen, ['spur/1/bk/3']);
});
