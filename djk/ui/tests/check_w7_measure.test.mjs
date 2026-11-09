// Calibration of the null-test arithmetic of check/acceptance_w7.mjs (check/w7_measure.mjs) on synthetic data:
// every check passes on good input, every negative control trips.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SPUREN } from '../project/model.ts';
import { PAN_MITTE_DB, mergeRegler } from '../project/merge.ts';
import { neuesProjekt } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { nullDifferenz, nullOk, NULL_TOR_DB, pegelVerhaeltnisDb, versatz, anfangUndRest, reglerSolo, standSchluessel } from '../check/w7_measure.mjs';

const N = 48000;
const sinus = (amp = 0.5, hz = 440, n = N) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / 48000));
const rauschen = (n = N, amp = 0.5) => { let s = 12345; return Float32Array.from({ length: n },
  () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return amp * (s / 0x3fffffff - 1); }); };

test('null difference: identical signals give -Infinity and pass the gate', () => {
  const a = sinus();
  const r = nullDifferenz(a, Float32Array.from(a));
  assert.equal(r.spitze_db, -Infinity);
  assert.ok(nullOk(r));
});

test('negative control: +0.01 dB is above -90 (peak 0.5 * (10^(0.01/20) - 1) = -64.8 dBFS)', () => {
  const a = sinus(), g = 10 ** (0.01 / 20);
  const r = nullDifferenz(a, a.map((x) => x * g));
  assert.ok(r.spitze_db > NULL_TOR_DB && Math.abs(r.spitze_db + 64.8) < 0.3, String(r.spitze_db));
  assert.ok(!nullOk(r));
});

test('negative control: one sample shifted noise is above -90, and versatz() finds the shift', () => {
  const a = rauschen(), b = new Float32Array(a.length); b.set(a.subarray(0, a.length - 1), 1);
  assert.ok(!nullOk(nullDifferenz(a, b)));
  assert.equal(versatz(a, b, { maxLag: 8 }), -1, 'B is A delayed by one sample: lag -1');
  assert.equal(versatz(a, Float32Array.from(a), { maxLag: 8 }), 0, 'negative control: no shift');
});

test('negative control: pan compensation missing (-3.0103 dB) is above -90; the level ratio shows -3.01 dB', () => {
  const a = sinus(), g = 10 ** (-PAN_MITTE_DB / 20);
  const b = a.map((x) => x * g);
  assert.ok(!nullOk(nullDifferenz(a, b)));
  assert.ok(Math.abs(pegelVerhaeltnisDb(a, b) + 3.0103) < 1e-3);
  assert.ok(Math.abs(pegelVerhaeltnisDb(a, Float32Array.from(a))) < 1e-9, 'identical: 0 dB');
  const d = nullDifferenz(a, b);      // difference peak against the peak of A: 1 - 10^(-3.0103/20) = 0.293 -> about -10.7 dB
  assert.ok(Math.abs(d.spitze_db - (20 * Math.log10(0.5) + 20 * Math.log10(0.2929))) < 0.2, String(d.spitze_db));
});

test('B = silence: the difference peak equals the peak of A; different lengths: ok false', () => {
  const a = sinus(), r = nullDifferenz(a, new Float32Array(a.length));
  assert.ok(Math.abs(r.spitze_db - 20 * Math.log10(0.5)) < 1e-3);
  assert.equal(nullDifferenz(a, a.subarray(1)).ok, false);
  assert.ok(!nullOk(nullDifferenz(a, a.subarray(1))));
});

test('B = A + float noise 1e-8 stays below -90 (the gate tolerates float rounding)', () => {
  const a = sinus(), r = rauschen(N, 1e-8);
  assert.ok(nullOk(nullDifferenz(a, a.map((x, i) => x + r[i]))));
});

test('start and rest are separated: a defect in the first 2000 samples shows in anfang_db only', () => {
  const a = sinus(), b = Float32Array.from(a);
  for (let i = 0; i < 100; i++) b[i] += 0.1;
  const r = anfangUndRest(a, b);
  assert.ok(r.anfang_db > -30 && r.rest_db === -Infinity, JSON.stringify(r));
  assert.equal(anfangUndRest(a, a.subarray(1)).ok, false);
});

test('reglerSolo equals mergeRegler of the server code (independent implementations, same file)', () => {
  let p = neuesProjekt('T');
  const lauf = (b) => { p = fuehreListeAus(p, b, { quelle: 'andreas' }).projekt; };
  lauf(['A', 'B', 'C'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  lauf([{ befehl: 'gruppenspur_neu', name: 'G', mitglieder: ['s1', 's2'] }, { befehl: 'spur_aendern', spur_id: 's1', fader_db: -4.5, pan: -0.6 },
    { befehl: 'spur_aendern', spur_id: 's3', solo: true }, { befehl: 'gruppenspur_aendern', gruppe_id: 'g1', fader_db: -3 }, { befehl: 'master_aendern',
      fader_db: -2 }]);
  assert.deepEqual(reglerSolo(p, ['s1', 's2']), mergeRegler(p, ['s1', 's2']));
  assert.equal(Object.keys(reglerSolo(p, ['s1'])).filter((k) => /^spur\/\d+\/mute$/.test(k)).length, MAX_SPUREN);
  assert.notDeepEqual(reglerSolo(p, ['s1', 's2']), reglerSolo(p, ['s1']), 'negative control: another set gives another file');
});

test('standSchluessel differs after a change (undo comparison is sensitive)', () => {
  let p = neuesProjekt('T');
  p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'audio', name: 'A' }], { quelle: 'andreas' }).projekt;
  const k = standSchluessel(p);
  const q = fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: 's1', mute: true }], { quelle: 'andreas' }).projekt;
  assert.notEqual(standSchluessel(q), k);
  assert.equal(standSchluessel(structuredClone(p)), k);
});
