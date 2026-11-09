// node --test tests/arr_arm.test.mjs: /k/arr/arm and /e/auto_punkt in the stand-in (INTERFACES 4.11, 5.13; 1.12 slice 3 task 7).
// Like the core: only the source andreas arms (nur_andreas for every other), spur 0 only disarms (format with an 1), the mode 0..2, the state lives in the stand-in only.
// The hook K.arrPunkt(spur, ziel, beat, wert) reports a point as the core does: only for an armed track and only while the transport plays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahre } from '../sequences_fast.mjs';
import { neuerKern } from '../module.mjs';
import { kodiere } from '../osc.mjs';
import { arbeitsbestand, sende, erwarte, q } from './help.mjs';

const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));
const cfg = { arbeitsbestand: arbeitsbestand() };
const arm = (id, spur, an, modus, quelle = 'andreas') => ['/k/arr/arm', 'hsiii', id, quelle, spur, an, modus];

function kern(mutationen = []) {
  const log = [];
  const K = neuerKern({ cfg, mutationen, sende: (m) => { if (m.ports.includes(1)) log.push(m); } });
  K.empfange(kodiere('/k/hallo', 'sii', ['t', 1, 1]), { port: 1 });
  const bis = (s) => { while (K.jetzt <= s) K.block(); };
  const cmd = (adr, typen, werte) => K.empfange(kodiere(adr, typen, werte), { port: 1 });
  return { K, log, bis, cmd };
}
const grund = (log, id) => log.filter((m) => m.adresse === '/q' && m.werte[0] === BigInt(id)).map((m) => `${m.werte[2]}${m.werte[5] ? '/' + m.werte[5] : ''}`);

test('arr_arm: andreas arms and disarms (q 1, 3), the state is per track, spur 0 with an 0 disarms all', () => {
  const r = fahre([
    sende(0, arm(10, 3, 1, 2)),
    erwarte(2000, q(10, 'andreas', 1)),
    erwarte(2000, q(10, 'andreas', 3)),
    sende(2000, arm(11, 0, 0, 0)),
    erwarte(4000, q(11, 'andreas', 3)),
  ], { cfg });
  gruen(r);
});

test('arr_arm: refusals format and nur_andreas, nothing is armed by them; andreas works (negative control)', () => {
  const { K, log, bis, cmd } = kern();
  const cases = [[10n, 33, 1, 0, 'andreas'], [11n, 1, 2, 0, 'andreas'], [12n, 1, 1, 3, 'andreas'], [13n, 0, 1, 1, 'andreas'], [14n, -1, 1, 1, 'andreas']];
  for (const [id, sp, an, mo, qu] of cases) cmd('/k/arr/arm', 'hsiii', [id, qu, sp, an, mo]);
  cmd('/k/arr/arm', 'hsiii', [20n, 'cypher', 1, 1, 1]);
  cmd('/k/arr/arm', 'hsiii', [21n, 'cypher', 1, 0, 1]);
  cmd('/k/arr/arm', 'hsiii', [22n, 'leitstand', 1, 1, 1]);
  bis(3000);
  for (const id of [10, 11, 12, 13, 14]) assert.deepEqual(grund(log, id), ['6/format'], `command ${id}`);
  for (const id of [20, 21, 22]) assert.deepEqual(grund(log, id), ['6/nur_andreas'], `command ${id}`);
  assert.equal(K.arr.arm.size, 0);
  cmd('/k/arr/arm', 'hsiii', [30n, 'andreas', 1, 1, 1]);
  bis(6000);
  assert.deepEqual(grund(log, 30), ['1', '3']);
  assert.equal(K.arr.arm.get(1), 1);
});

test('arr_arm: the arm is kept by a mode change and dropped by spur 0 / an 0 (several tracks)', () => {
  const { K, bis, cmd } = kern();
  cmd('/k/arr/arm', 'hsiii', [1n, 'andreas', 1, 1, 0]);
  cmd('/k/arr/arm', 'hsiii', [2n, 'andreas', 2, 1, 2]);
  cmd('/k/arr/arm', 'hsiii', [3n, 'andreas', 1, 1, 1]);   // the mode is sent again
  bis(3000);
  assert.deepEqual([...K.arr.arm.entries()], [[1, 1], [2, 2]]);
  cmd('/k/arr/arm', 'hsiii', [4n, 'andreas', 0, 0, 0]);
  bis(6000);
  assert.equal(K.arr.arm.size, 0);
});

test('arr_arm: /e/auto_punkt only for an armed track and only while the transport plays', () => {
  const { K, log, bis, cmd } = kern();
  const punkte = () => log.filter((m) => m.adresse === '/e/auto_punkt').map((m) => `${m.werte[0]}@${m.werte[1]}=${m.werte[2]}`);
  cmd('/k/arr/arm', 'hsiii', [1n, 'andreas', 2, 1, 1]);
  bis(1000);
  cmd('/k/arr/laden', 'hsi', [2n, 'andreas', 1]);
  bis(2000);
  assert.equal(K.arrPunkt(2, 'fader', 1.5, -3), false);   // armed, but stopped
  cmd('/k/arr/start', 'hsdi', [3n, 'andreas', 0.0, 0]);
  bis(30000);
  assert.equal(K.arr.status, 2);
  assert.equal(K.arrPunkt(1, 'fader', 1.5, -3), false);   // playing, but track 1 is not armed
  assert.equal(K.arrPunkt(2, 'volume', 1.5, -3), false);   // not a field of the contract
  assert.equal(K.arrPunkt(2, 'pan', 2.25, -0.5), true);
  bis(32000);
  assert.deepEqual(punkte(), ['spur/2/pan@2.25=-0.5']);
  cmd('/k/arr/arm', 'hsiii', [4n, 'andreas', 2, 0, 1]);
  bis(34000);
  assert.equal(K.arrPunkt(2, 'pan', 3.0, 0.1), false);    // disarmed again
  assert.equal(punkte().length, 1);
});

test('arr_arm: the mutation arr_arm_cypher lets cypher arm (the refusal test goes red under it)', () => {
  const { K, log, bis, cmd } = kern(['arr_arm_cypher']);
  cmd('/k/arr/arm', 'hsiii', [20n, 'cypher', 1, 1, 1]);
  bis(3000);
  assert.deepEqual(grund(log, 20), ['1', '3']);
  assert.equal(K.arr.arm.size, 1);
});

// ---- /e/auto_punkt as the contract text says (INTERFACES 5.13): rate window, trailing value, held point at the stop, disarm ----
function spielend(mutationen = []) {
  const k = kern(mutationen);
  k.cmd('/k/arr/arm', 'hsiii', [1n, 'andreas', 2, 1, 1]);
  k.bis(1000);
  k.cmd('/k/arr/laden', 'hsi', [2n, 'andreas', 1]);
  k.bis(2000);
  k.cmd('/k/arr/start', 'hsdi', [3n, 'andreas', 0.0, 0]);
  k.bis(30000);
  assert.equal(k.K.arr.status, 2);
  k.punkte = (von = 0) => k.log.filter((m) => m.adresse === '/e/auto_punkt').slice(von);
  k.blocks = (n) => { for (let i = 0; i < n; i++) k.K.block(); };
  return k;
}

test('arr_arm: rate cap, at most one point per 960 samples and regulator (contract: "at most 50 Hz per regulator")', () => {
  const k = spielend();
  const n0 = k.punkte().length;
  for (let i = 0; i < 40; i++) { assert.equal(k.K.arrPunkt(2, 'fader', 1 + i * 0.01, -i), true); k.blocks(1); }
  k.blocks(8);
  const p = k.punkte(n0);
  assert.ok(p.length >= 9 && p.length <= 12, `${p.length} points for 40 grips in 40 blocks of 256 samples`);
  for (let i = 1; i < p.length; i++) assert.ok(p[i].s - p[i - 1].s >= 960, `spacing ${p[i].s - p[i - 1].s}`);
  // another regulator of the same track has its own window
  const m = k.punkte().length;
  k.K.arrPunkt(2, 'fader', 9, -9);
  k.K.arrPunkt(2, 'pan', 9, 0.5);
  k.blocks(1);
  assert.deepEqual(k.punkte(m).map((x) => x.werte[0]), ['spur/2/fader', 'spur/2/pan']);
});

test('arr_arm: mutation arr_punkt_ohne_drossel sends every grip (the rate test goes red under it)', () => {
  const k = spielend(['arr_punkt_ohne_drossel']);
  const n0 = k.punkte().length;
  for (let i = 0; i < 40; i++) { k.K.arrPunkt(2, 'fader', 1 + i * 0.01, -i); k.blocks(1); }
  assert.equal(k.punkte(n0).length, 40);
});

test('arr_arm: trailing value, a point inside the window is held, the newest replaces it and keeps its own beat and value', () => {
  const k = spielend();
  k.blocks(8);
  const n0 = k.punkte().length;
  k.K.arrPunkt(2, 'fader', 1.0, -1);   // window free: sent at the end of the block
  k.blocks(1);
  k.K.arrPunkt(2, 'fader', 1.1, -2);   // inside the window: held
  k.blocks(1);
  k.K.arrPunkt(2, 'fader', 1.2, -3);   // replaces the held one
  k.blocks(1);
  assert.equal(k.punkte(n0).length, 1, 'only the first point so far');
  k.blocks(8);
  const p = k.punkte(n0).map((m) => [m.werte[0], m.werte[1], m.werte[2]]);
  assert.deepEqual(p, [['spur/2/fader', 1.0, -1], ['spur/2/fader', 1.2, -3]]);   // the last value of the gesture arrives, once
});

test('arr_arm: a point still held at the stop is sent after the stopped /zustand/arr; nothing is accepted afterwards', () => {
  const k = spielend();
  k.blocks(8);
  const n0 = k.log.length;
  k.K.arrPunkt(2, 'fader', 1.0, -1);
  k.blocks(1);
  k.K.arrPunkt(2, 'fader', 1.1, -2);   // held
  k.cmd('/k/arr/stopp', 'hsi', [9n, 'andreas', 0]);
  k.blocks(2);
  const nach = k.log.slice(n0);
  const iSteht = nach.findIndex((m) => m.adresse === '/zustand/arr' && m.werte[1] === 0);
  const iPunkt = nach.map((m, i) => (m.adresse === '/e/auto_punkt' ? i : -1)).filter((i) => i >= 0);
  assert.ok(iSteht >= 0, 'the stopped state went out');
  assert.equal(iPunkt.length, 2);
  assert.ok(iPunkt[1] > iSteht, 'the held point comes after the stopped state');
  assert.equal(nach[iPunkt[1]].werte[2], -2);
  assert.equal(k.K.arrPunkt(2, 'fader', 2.0, -5), false, 'stopped: no new point');
  k.blocks(8);
  assert.equal(k.log.slice(n0).filter((m) => m.adresse === '/e/auto_punkt').length, 2);
});

test('arr_arm: a disarm drops the held point but keeps the window; a quick re-arm cannot send inside 960 samples', () => {
  const k = spielend();
  k.blocks(8);
  const n0 = k.punkte().length;
  k.K.arrPunkt(2, 'fader', 1.0, -1);
  k.blocks(1);                          // sent, the window opens
  k.K.arrPunkt(2, 'fader', 1.1, -2);    // held
  k.cmd('/k/arr/arm', 'hsiii', [20n, 'andreas', 2, 0, 1]);
  k.cmd('/k/arr/arm', 'hsiii', [21n, 'andreas', 2, 1, 1]);   // disarm and re-arm in a row
  k.blocks(1);
  k.K.arrPunkt(2, 'fader', 1.2, -3);    // a new grip, inside the old window
  k.blocks(1);
  assert.equal(k.punkte(n0).length, 1, 'nothing inside the window, the stale held point is gone');
  k.blocks(8);
  const p = k.punkte(n0);
  assert.equal(p.length, 2);
  assert.equal(p[1].werte[2], -3, 'the new grip, not the dropped one');
  assert.ok(p[1].s - p[0].s >= 960, `spacing ${p[1].s - p[0].s}`);
  // disarmed for good: nothing at all
  k.cmd('/k/arr/arm', 'hsiii', [22n, 'andreas', 2, 0, 1]);
  k.blocks(1);
  assert.equal(k.K.arrPunkt(2, 'fader', 3, -9), false);
});

test('arr_arm: the range is checked before the source (cypher with spur 99 gets format)', () => {
  const { log, bis, cmd } = kern();
  cmd('/k/arr/arm', 'hsiii', [40n, 'cypher', 99, 1, 1]);
  bis(3000);
  assert.deepEqual(grund(log, 40), ['6/format']);
});
