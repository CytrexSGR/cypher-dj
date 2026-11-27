// node --test tests/arr_stift.test.mjs: /k/arr/stift in the stand-in (INTERFACES 4.11; Kraken patch field task 1).
// Like the core: spur 1..128 (spur_bereich), satz 0..1, zeile 0..15, spalte 0..15, wert finite in -1..1 (ausserhalb_bereich), acknowledged 1 and 3;
// cypher in the AI stop is refused ki_gestoppt before any range check; a refused pin is not recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neuerKern } from '../module.mjs';
import { kodiere } from '../osc.mjs';
import { arbeitsbestand } from './help.mjs';

const cfg = { arbeitsbestand: arbeitsbestand() };
function kern() {
  const log = [];
  const K = neuerKern({ cfg, mutationen: [], sende: (m) => { if (m.ports.includes(1)) log.push(m); } });
  K.empfange(kodiere('/k/hallo', 'sii', ['t', 1, 1]), { port: 1 });
  const bis = (s) => { while (K.jetzt <= s) K.block(); };
  const cmd = (adr, typen, werte) => K.empfange(kodiere(adr, typen, werte), { port: 1 });
  const stift = (id, quelle, spur, satz, zeile, spalte, wert) => cmd('/k/arr/stift', 'hsiiiif', [BigInt(id), quelle, spur, satz, zeile, spalte, wert]);
  return { K, log, bis, stift, cmd };
}
const grund = (log, id) => log.filter((m) => m.adresse === '/q' && m.werte[0] === BigInt(id)).map((m) => `${m.werte[2]}${m.werte[5] ? '/' + m.werte[5] : ''}`);

test('arr_stift: a valid pin is acknowledged 1, 3 and recorded; the edges of every range are accepted', () => {
  const { K, log, bis, stift } = kern();
  stift(1, 'andreas', 1, 0, 0, 0, 0.5);
  stift(2, 'andreas', 128, 1, 15, 15, -1);
  stift(3, 'cypher', 5, 1, 3, 7, 0);
  bis(4000);
  for (const id of [1, 2, 3]) assert.deepEqual(grund(log, id), ['1', '3'], `command ${id}`);
  assert.deepEqual(K.arr.stifte, [
    { spur: 1, satz: 0, zeile: 0, spalte: 0, wert: 0.5 },
    { spur: 128, satz: 1, zeile: 15, spalte: 15, wert: -1 },
    { spur: 5, satz: 1, zeile: 3, spalte: 7, wert: 0 },
  ]);
  assert.equal(K.arr.status, 0, 'the transport stood');
});

test('arr_stift: spur outside 1..128 is spur_bereich', () => {
  const { K, log, bis, stift } = kern();
  stift(10, 'andreas', 0, 0, 0, 0, 0.5);
  stift(11, 'andreas', 129, 0, 0, 0, 0.5);
  stift(12, 'andreas', -1, 0, 0, 0, 0.5);
  bis(4000);
  for (const id of [10, 11, 12]) assert.deepEqual(grund(log, id), ['6/spur_bereich'], `command ${id}`);
  assert.deepEqual(K.arr.stifte, []);
});

test('arr_stift: satz, zeile, spalte or wert out of range (also NaN, inf) is ausserhalb_bereich; the spur check comes first', () => {
  const { K, log, bis, stift } = kern();
  stift(20, 'andreas', 1, 2, 0, 0, 0.5);
  stift(21, 'andreas', 1, -1, 0, 0, 0.5);
  stift(22, 'andreas', 1, 0, 16, 0, 0.5);
  stift(23, 'andreas', 1, 0, -1, 0, 0.5);
  stift(24, 'andreas', 1, 0, 0, 16, 0.5);
  stift(25, 'andreas', 1, 0, 0, -1, 0.5);
  stift(26, 'andreas', 1, 0, 0, 0, 1.5);
  stift(27, 'andreas', 1, 0, 0, 0, -1.5);
  stift(28, 'andreas', 1, 0, 0, 0, NaN);
  stift(29, 'andreas', 1, 0, 0, 0, Infinity);
  stift(30, 'andreas', 0, 9, 99, 99, 9);
  bis(4000);
  for (let id = 20; id <= 29; id++) assert.deepEqual(grund(log, id), ['6/ausserhalb_bereich'], `command ${id}`);
  assert.deepEqual(grund(log, 30), ['6/spur_bereich']);
  assert.deepEqual(K.arr.stifte, []);
});

test('arr_stift: cypher in the AI stop is refused ki_gestoppt before any range check, andreas still sets pins', () => {
  const { K, log, bis, stift, cmd } = kern();
  cmd('/k/ki/stopp', 'hs', [100n, 'andreas']);
  bis(2000);
  stift(40, 'cypher', 1, 0, 0, 0, 0.5);
  stift(41, 'cypher', 99, 9, 99, 99, 9);
  stift(42, 'andreas', 1, 0, 0, 0, 0.5);
  bis(6000);
  assert.deepEqual(grund(log, 40), ['6/ki_gestoppt']);
  assert.deepEqual(grund(log, 41), ['6/ki_gestoppt']);
  assert.deepEqual(grund(log, 42), ['1', '3']);
  assert.deepEqual(K.arr.stifte, [{ spur: 1, satz: 0, zeile: 0, spalte: 0, wert: 0.5 }]);
});
