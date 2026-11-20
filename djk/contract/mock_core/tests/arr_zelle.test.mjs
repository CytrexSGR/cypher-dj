// node --test tests/arr_zelle.test.mjs: /k/arr/zelle_start, /k/arr/zelle_stopp and /zustand/zelle in the stand-in (INTERFACES 4.11, 5.13; loop deck V0).
// A launch is pending until the mock clock passes ab_beat, then it takes effect (receipt 3); a newer command for the same track replaces the pending one (7 abbruch);
// ab_beat in the past: receipt 5 and an effect at once; refusals like the core (ki_gestoppt first, then spur_bereich, then ausserhalb_bereich). The stand-in knows no cells: no zelle_leer.
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
  const start = (id, quelle, spur, zelle, ab, versatz) => cmd('/k/arr/zelle_start', 'hssidd', [BigInt(id), quelle, spur, zelle, ab, versatz]);
  const stopp = (id, quelle, spur, ab) => cmd('/k/arr/zelle_stopp', 'hssd', [BigInt(id), quelle, spur, ab]);
  return { K, log, bis, start, stopp, cmd };
}
const grund = (log, id) => log.filter((m) => m.adresse === '/q' && m.werte[0] === BigInt(id)).map((m) => `${m.werte[2]}${m.werte[5] ? '/' + m.werte[5] : ''}`);
const zustand = (log, spur) => log.filter((m) => m.adresse === '/zustand/zelle' && m.werte[0] === spur).map((m) => ({ s: m.s, zelle: m.werte[1], verwaist: m.werte[2], ab_beat: m.werte[3], versatz_beats: m.werte[4], wartend: m.werte[5], wartend_ab: m.werte[6] }));
const letzter = (log, spur) => zustand(log, spur).at(-1);

test('arr_zelle: a start is accepted 1, takes effect 3 after ab_beat; /zustand/zelle shows zelle and ab_beat', () => {
  const { K, log, bis, start } = kern();
  bis(2000);
  const ab = K.uhr.beat(K.jetzt) + 8;   // 8 beats ahead
  start(1, 'andreas', 'loop/1', 3, ab, 1.5);
  bis(4000);
  assert.deepEqual(grund(log, 1), ['1'], 'pending');
  assert.deepEqual(letzter(log, 'loop/1').wartend, 3);
  assert.equal(letzter(log, 'loop/1').wartend_ab, ab);
  assert.equal(letzter(log, 'loop/1').zelle, 0);
  bis(Math.ceil(K.uhr.sample(ab)) + 2000);
  assert.deepEqual(grund(log, 1), ['1', '3']);
  const z = letzter(log, 'loop/1');
  assert.deepEqual([z.zelle, z.ab_beat, z.versatz_beats, z.wartend, z.wartend_ab, z.verwaist], [3, ab, 1.5, -1, 0, 0]);
  assert.deepEqual(K.arr.zellen.get('loop/1'), { zelle: 3, ab_beat: ab, versatz_beats: 1.5, wartend: -1, wartend_ab: 0 });
});

test('arr_zelle: a second start for the same track replaces the pending one (first 7/abbruch, second 1 then 3)', () => {
  const { K, log, bis, start } = kern();
  bis(2000);
  const ab = K.uhr.beat(K.jetzt) + 8;
  start(10, 'andreas', 'loop/1', 2, ab, 0);
  start(11, 'andreas', 'loop/1', 4, ab, 0.5);
  bis(Math.ceil(K.uhr.sample(ab)) + 2000);
  assert.deepEqual(grund(log, 10), ['1', '7/abbruch']);
  assert.deepEqual(grund(log, 11), ['1', '3']);
  assert.equal(K.arr.zellen.get('loop/1').zelle, 4);
  assert.equal(K.arr.zellenWarten.size, 0);
});

test('arr_zelle: stop after start: zelle 0 after its ab_beat, wartend 0 while pending', () => {
  const { K, log, bis, start, stopp } = kern();
  bis(2000);
  const ab1 = K.uhr.beat(K.jetzt) + 2;
  start(20, 'andreas', 'loop/1', 5, ab1, 0);
  bis(Math.ceil(K.uhr.sample(ab1)) + 2000);
  assert.equal(letzter(log, 'loop/1').zelle, 5);
  const ab2 = ab1 + 8;
  stopp(21, 'andreas', 'loop/1', ab2);
  bis(K.jetzt + 2000);
  assert.deepEqual(grund(log, 21), ['1']);
  const w = letzter(log, 'loop/1');
  assert.deepEqual([w.zelle, w.wartend, w.wartend_ab], [5, 0, ab2], 'still playing, a stop is pending');
  bis(Math.ceil(K.uhr.sample(ab2)) + 2000);
  assert.deepEqual(grund(log, 21), ['1', '3']);
  const z = letzter(log, 'loop/1');
  assert.deepEqual([z.zelle, z.wartend, z.wartend_ab, z.ab_beat], [0, -1, 0, ab2]);
});

test('arr_zelle: ab_beat in the past: receipt 5 and the effect at once', () => {
  const { K, log, bis, start, stopp } = kern();
  bis(48000);
  start(30, 'andreas', 'loop/1', 6, 0.5, 0.25);
  stopp(31, 'andreas', 'loop/2', 0);
  bis(K.jetzt + 2000);
  assert.deepEqual(grund(log, 30), ['1', '5', '3']);
  assert.deepEqual(grund(log, 31), ['1', '5', '3']);
  assert.deepEqual([letzter(log, 'loop/1').zelle, letzter(log, 'loop/1').wartend], [6, -1]);
  assert.equal(letzter(log, 'loop/2').zelle, 0);
});

test('arr_zelle: cypher under the KI stop is 6/ki_gestoppt before the range check; zelle 0 and 9, versatz -1: 6/ausserhalb_bereich; spur 6/spur_bereich first', () => {
  const { K, log, bis, start, stopp, cmd } = kern();
  start(40, 'andreas', 'loop/1', 0, 100, 0);
  start(41, 'andreas', 'loop/1', 9, 100, 0);
  start(42, 'andreas', 'loop/1', 1, 100, -1);
  start(43, 'andreas', 'loop/1', 1, NaN, 0);
  start(44, 'andreas', 'loop/1', 1, 100, Infinity);
  stopp(45, 'andreas', 'loop/1', NaN);
  start(46, 'andreas', '', 0, 100, -1);
  start(47, 'andreas', 'x'.repeat(33), 1, 100, 0);
  stopp(48, 'andreas', '', 100);
  bis(4000);
  for (const id of [40, 41, 42, 43, 44, 45]) assert.deepEqual(grund(log, id), ['6/ausserhalb_bereich'], `command ${id}`);
  for (const id of [46, 47, 48]) assert.deepEqual(grund(log, id), ['6/spur_bereich'], `command ${id}`);
  assert.equal(K.arr.zellen.size, 0, 'a refused command leaves no trace');
  cmd('/k/ki/stopp', 'hs', [100n, 'andreas']);
  bis(6000);
  start(50, 'cypher', 'loop/1', 9, 100, -1);
  stopp(51, 'cypher', '', NaN);
  start(52, 'andreas', 'loop/1', 1, 0, 0);
  bis(8000);
  assert.deepEqual(grund(log, 50), ['6/ki_gestoppt']);
  assert.deepEqual(grund(log, 51), ['6/ki_gestoppt']);
  assert.deepEqual(grund(log, 52), ['1', '5', '3']);
});

test('arr_zelle: /zustand/zelle repeats at 2 Hz while a track is in the map', () => {
  const { K, log, bis, start } = kern();
  bis(2000);
  const ab = K.uhr.beat(K.jetzt) + 1;
  start(60, 'andreas', 'loop/1', 1, ab, 0);
  bis(Math.ceil(K.uhr.sample(ab)) + 2000);
  const n0 = zustand(log, 'loop/1').length;
  const t0 = K.jetzt;
  bis(t0 + 5 * 24000);
  const neu = zustand(log, 'loop/1').slice(n0);
  assert.ok(neu.length >= 5 && neu.length <= 6, `5 s of mock time, 2 Hz per half second: ${neu.length}`);
  for (let i = 1; i < neu.length; i++) assert.ok(neu[i].s - neu[i - 1].s >= 23000 && neu[i].s - neu[i - 1].s <= 25000, `gap ${neu[i].s - neu[i - 1].s}`);
  assert.ok(neu.every((z) => z.zelle === 1 && z.wartend === -1));
});
