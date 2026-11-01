// Calibration of pruef/a1_messen.mjs, the arithmetic of the automation slice 1 target acceptance: the instrument is checked before it judges the core.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SR, FREQ, einsatzRel, amplitude, amplitudeDb, einsatz, linie, schrittMax, verstaerkungsSpur, blendeBreite } from '../pruef/a1_messen.mjs';

const sinus = (n, gain = () => 1, amp = 0.3, f = FREQ) => Float32Array.from({ length: n }, (_, i) => amp * gain(i) * Math.sin(2 * Math.PI * f * i / SR));

test('amplitude: exact for a steady sine, for window lengths that are not whole periods', () => {
  const l = sinus(20000);
  for (const n of [109, 480, 1200, 1777]) assert.ok(Math.abs(amplitude(l, 10000, n) - 0.3) < 1e-4, `n ${n}: ${amplitude(l, 10000, n)}`);
});

test('amplitude: a 3 dB step is read as 3 dB (negative control: the instrument sees a level change)', () => {
  const g = Math.pow(10, -3 / 20), l = sinus(30000, (i) => (i < 15000 ? 1 : g));
  assert.ok(Math.abs(amplitudeDb(l, 7000, 1200, 0.3)) < 0.001);
  assert.ok(Math.abs(amplitudeDb(l, 22000, 1200, 0.3) + 3) < 0.001);
});

test('amplitude: a sine at another frequency does not read as the reference (negative control)', () => {
  assert.ok(amplitude(sinus(20000, () => 1, 0.3, 880), 10000, 1200) < 0.01);
});

test('amplitude: a ramp of 3 dB per second is read at the window centre within 0.01 dB', () => {
  const l = sinus(96000, (i) => Math.pow(10, -3 * (i / SR) / 20));
  const soll = (f) => -3 * f / SR;
  for (const f of [20000, 48000, 70000]) assert.ok(Math.abs(amplitudeDb(l, f, 1200, 0.3) - soll(f)) < 0.01, `frame ${f}`);
});

test('einsatz and linie', () => {
  assert.equal(einsatz(sinus(1000).map((x, i) => (i < 500 ? 0 : x))), 500);
  const p = [{ beat: 0, wert: 0 }, { beat: 8, wert: -12 }, { beat: 8, wert: -3 }, { beat: 16, wert: -19 }];
  assert.equal(linie(p, 4), -6);
  assert.equal(linie(p, 8), -3);
  assert.equal(linie(p, 12), -11);
  assert.equal(linie(p, 99), -19);
});

test('schrittMax: finds a 1 dB step, sees none in a smooth ramp', () => {
  const glatt = sinus(96000, (i) => Math.pow(10, -3 * (i / SR) / 20));
  assert.ok(schrittMax(glatt, 4800, 90000, 480, 0.3) < 0.05);
  const g = Math.pow(10, -1 / 20), stufe = sinus(96000, (i) => (i < 48000 ? 1 : g));
  assert.ok(Math.abs(schrittMax(stufe, 4800, 90000, 480, 0.3) - 1) < 0.05);
});

test('blendeBreite: a linear blend of 480 frames is measured as 480 (+-15), a half-length blend as 240, a hard step as near zero', () => {
  const g0 = 0.178, g1 = 1;
  const blende = (n, mitte) => sinus(40000, (i) => (i < mitte - n / 2 ? g0 : i >= mitte + n / 2 ? g1 : g0 + (g1 - g0) * (i - (mitte - n / 2)) / n));
  // the window of 109 frames stretches a short blend a little (measured: 480 -> 491, 240 -> 261); the acceptance limit is 10 ms +-2 ms = 480 +-96 frames
  for (const [n, soll, tol] of [[480, 480, 15], [240, 240, 25], [960, 960, 20]]) {
    const spur = verstaerkungsSpur(blende(n, 20000), 5000, 38000, 48, 109, 0.3);
    const b = blendeBreite(spur, g0, g1);
    assert.ok(b && Math.abs(b.frames - soll) <= tol, `${n}: ${b?.frames}`);
    assert.ok(Math.abs(b.mitte - 20000) <= 30, `centre ${b.mitte}`);
  }
  const hart = blendeBreite(verstaerkungsSpur(blende(2, 20000), 5000, 38000, 48, 109, 0.3), g0, g1);
  assert.ok(hart === null || hart.frames < 150, `hard step measured as ${hart?.frames}`);
});

test('einsatzRel: the same sample for a loud and a quiet sine (the absolute threshold of einsatz is several samples late for the quiet one)', () => {
  const laut = sinus(5000, () => 1, 0.3), leise = sinus(5000, () => 1, 0.03);
  assert.equal(einsatzRel(laut), einsatzRel(leise));
  assert.ok(einsatz(leise) - einsatz(laut) >= 5, `absolute threshold: ${einsatz(laut)} against ${einsatz(leise)}`);
});
