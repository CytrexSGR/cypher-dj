// Calibration of check/a2_measure.mjs, the arithmetic of the automation slice 2 target acceptance: the instrument is checked before it judges the core.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SR } from '../check/a1_measure.mjs';
import { panGesetz, panLinear, amplituden, amplitudeF, dbVon, einsatzStereo, kanaele, schwerpunkt, kleinsterSchritt } from '../check/a2_measure.mjs';

const sinus = (n, f, amp = 0.3) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * f * i / SR));
const summe = (a, b) => a.map((x, i) => x + b[i]);

test('pan law: constant power, -3.01 dB in the middle, hard left and right', () => {
  assert.ok(Math.abs(panGesetz(0).l - Math.SQRT1_2) < 1e-12 && Math.abs(panGesetz(0).r - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(panGesetz(-1).l - 1) < 1e-12 && Math.abs(panGesetz(-1).r) < 1e-12);
  assert.ok(Math.abs(panGesetz(1).r - 1) < 1e-12 && Math.abs(panGesetz(1).l) < 1e-12);
  for (const p of [-0.5, 0.3, 0.9]) assert.ok(Math.abs(panGesetz(p).l ** 2 + panGesetz(p).r ** 2 - 1) < 1e-12);
});

test('pan law against the linear law (negative control): 3 dB apart in the middle, so a mutated core cannot pass 0.1 dB', () => {
  const d = dbVon(panGesetz(0).l, panLinear(0).l);
  assert.ok(Math.abs(d - 3.01) < 0.01, String(d));
});

test('amplituden: two sines at once are separated exactly; a missing sine reads as nothing', () => {
  const l = summe(sinus(20000, 440, 0.3), sinus(20000, 660, 0.1));
  const [a, b] = amplituden(l, 10000, 2400, [440, 660]);
  assert.ok(Math.abs(a - 0.3) < 1e-4 && Math.abs(b - 0.1) < 1e-4, `${a} ${b}`);
  const c = amplituden(l, 10000, 1200, [440, 660]);
  assert.ok(Math.abs(c[0] - 0.3) < 1e-3 && Math.abs(c[1] - 0.1) < 1e-3, `${c}`);
  assert.ok(amplitudeF(sinus(20000, 440), 10000, 2400, 660) < 1e-3);
});

test('amplituden: a 3 dB step of one tone is read as 3 dB, the other tone does not move', () => {
  const g = Math.pow(10, -3 / 20);
  const a = sinus(40000, 440), b = sinus(40000, 660);
  const l = Float32Array.from(a, (x, i) => (i < 20000 ? x : x * g) + b[i]);
  const vor = amplituden(l, 10000, 2400, [440, 660]), nach = amplituden(l, 30000, 2400, [440, 660]);
  assert.ok(Math.abs(dbVon(nach[0], vor[0]) + 3) < 0.01 && Math.abs(dbVon(nach[1], vor[1])) < 0.01);
});

test('einsatzStereo and kanaele', () => {
  const st = new Float32Array(2000);
  st[2 * 300 + 1] = 0.5;
  const { l, r } = kanaele(st);
  assert.equal(l.length, 1000);
  assert.equal(einsatzStereo(l, r), 300);
  assert.equal(einsatzStereo(new Float32Array(10), new Float32Array(10)), -1);
});

test('schwerpunkt: a pure sine sits at its frequency, a brighter signal has a higher centroid (negative control: a flat series is not monotonic)', () => {
  const rein = schwerpunkt(sinus(20000, 1000), 1000);
  assert.ok(Math.abs(rein - 1000) < 20, String(rein));
  const hell = schwerpunkt(summe(sinus(20000, 1000), sinus(20000, 4000, 0.3)), 1000);
  assert.ok(hell > rein * 1.5, `${rein} ${hell}`);
  assert.ok(kleinsterSchritt([1000, 1100, 1250, 1400], 1) > 0);
  assert.ok(kleinsterSchritt([1000, 1100, 1090, 1400], 1) < 0);
  assert.ok(kleinsterSchritt([1000, 1000, 1000], 1) <= 0, 'a flat series must not count as rising');
  assert.ok(kleinsterSchritt([1400, 1250, 1100, 1000], -1) > 0);
});
