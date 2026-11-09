// Calibration of check/a5_measure.mjs (the instrument of the 1.12 slice 5 target acceptance): every function is run on a synthetic signal with a known
// answer, and every negative control must turn the measurement red (a wrong gain, a wrong pitch, a wrong silence is not read as right).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SR } from '../check/a1_measure.mjs';
import { pegelDb, grundfrequenz, rmsDbfs, halbtoene } from '../check/a5_measure.mjs';

const sinus = (f, amp, n) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * f * i / SR));
const saege = (f, amp, n) => Float32Array.from({ length: n }, (_, i) => amp * (2 * ((f * i / SR) % 1) - 1));

test('pegelDb: reads the gain in dB against the reference, constant power: only the sum of both channels counts', () => {
  const ref = 0.3, n = 4800;
  for (const dB of [0, -6, -12, -30]) {
    const g = 10 ** (dB / 20);
    assert.ok(Math.abs(pegelDb(sinus(440, ref * g, n), sinus(440, ref * g, n), 2400, 960, ref * Math.SQRT2, 440) - dB) < 0.01, `${dB} dB (both channels)`);
  }
  // pan to the left: all in L, same total power
  assert.ok(Math.abs(pegelDb(sinus(440, ref, n), new Float32Array(n), 2400, 960, ref, 440)) < 0.01, 'one channel carries all');
  // negative control: a 0.5 dB error is visible with the limit of the acceptance (0.05 dB)
  const falsch = pegelDb(sinus(440, ref * 10 ** (-0.5 / 20), n), new Float32Array(n), 2400, 960, ref, 440);
  assert.ok(Math.abs(falsch) > 0.05 * 5, `0.5 dB off reads ${falsch.toFixed(3)} dB`);
});

test('grundfrequenz: sawtooth at 110 and 164.81 Hz within 0.3 %, the interval of 7 semitones within 0.05 semitone; no octave error; silence gives 0', () => {
  const n = 12000;
  const f1 = grundfrequenz(saege(110, 0.5, n + 2000), 1000, n), f2 = grundfrequenz(saege(110 * 2 ** (7 / 12), 0.5, n + 2000), 1000, n);
  assert.ok(Math.abs(f1 / 110 - 1) < 0.003, `110 Hz read as ${f1.toFixed(2)}`);
  assert.ok(Math.abs(f2 / 164.8136 - 1) < 0.003, `164.81 Hz read as ${f2.toFixed(2)}`);
  assert.ok(Math.abs(halbtoene(f1, f2) - 7) < 0.05, `interval ${halbtoene(f1, f2).toFixed(3)}`);
  // a tone with a strong second harmonic (the octave is not read)
  const harm = Float32Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * 110 * i / SR) + 0.8 * Math.sin(2 * Math.PI * 220 * i / SR));
  assert.ok(Math.abs(grundfrequenz(harm, 0, n) / 110 - 1) < 0.003, 'fundamental, not the octave');
  assert.equal(grundfrequenz(new Float32Array(n), 0, n), 0, 'silence');
  // negative control: a pitch one semitone off is not read as 7 semitones
  const f3 = grundfrequenz(saege(110 * 2 ** (8 / 12), 0.5, n + 2000), 1000, n);
  assert.ok(Math.abs(halbtoene(f1, f3) - 7) > 0.5, `8 semitones reads ${halbtoene(f1, f3).toFixed(2)}`);
});

test('rmsDbfs: a sine of amplitude a has 20 log10(a / sqrt 2) dBFS, exact silence is -Infinity, a hanging tone is far above a silent tail', () => {
  assert.ok(Math.abs(rmsDbfs(sinus(440, 0.5, 4800), 0, 4800) - (20 * Math.log10(0.5 / Math.SQRT2))) < 0.01);
  assert.equal(rmsDbfs(new Float32Array(100), 0, 100), -Infinity);
  const x = new Float32Array(9600); x.set(sinus(110, 0.3, 4800), 0);
  assert.ok(rmsDbfs(x, 0, 4800) - rmsDbfs(x, 4800, 9600) > 100 || rmsDbfs(x, 4800, 9600) === -Infinity, 'tail silent, head loud');
  const haengt = sinus(110, 0.3, 9600);
  assert.ok(rmsDbfs(haengt, 4800, 9600) > -30, 'negative control: a tone that hangs on is loud in the tail');
});
