// Calibration of check/c14_measure.mjs, the arithmetic of the comping 1.14 target acceptance: the instrument is checked before it judges the core.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SR, schlagFrames, sinusQuelle, frequenzJeFenster, korrelation, nahtMaske, spitze, dbfs, stilleLauf, besterVersatz, bereich, wechselFrame,
  latenzMs, wandMs, verstaerkung, medianMax,
  ersterUnterschied,
} from '../check/c14_measure.mjs';

const F = [440, 660, 880];
// a signal that plays take k over [von, bis) (frames) and silence elsewhere
const stueck = (n, teile) => {
  const x = new Float32Array(n);
  for (const { von, bis, f } of teile) { const q = sinusQuelle(f, 0.3, 0.7); for (let i = von; i < bis; i++) x[i] = q(i); }
  return x;
};

test('frequency per window: names the take that sounds, and flips at the seam', () => {
  const x = stueck(SR, [{ von: 0, bis: 24000, f: 660 }, { von: 24000, bis: SR, f: 880 }]);
  const w = frequenzJeFenster(x, 0, SR, 2400, 2400, F);
  assert.equal(w[0].dom, 1);
  assert.equal(w[w.length - 1].dom, 2);
  assert.ok(w.every((e) => e.dom === (e.frame < 24000 ? 1 : 2)));
});
test('frequency per window: negative control, a wrong frequency list does not name the take', () => {
  const x = stueck(SR, [{ von: 0, bis: SR, f: 660 }]);
  assert.notEqual(frequenzJeFenster(x, 0, SR, 2400, 2400, [440, 880])[0].amps[0] / 0.3, 1);
  assert.ok(frequenzJeFenster(x, 0, SR, 2400, 2400, [440, 880]).every((e) => Math.max(...e.amps) < 0.1));
});
test('correlation: 1 for the same sine, near 0 for another one and for silence', () => {
  const x = stueck(SR, [{ von: 0, bis: SR, f: 660 }]);
  assert.ok(korrelation(x, 1000, 24000, 660) > 0.999);
  assert.ok(korrelation(x, 1000, 24000, 440) < 0.05);
  assert.equal(korrelation(new Float32Array(SR), 0, 24000, 660), 0);
});
test('correlation: a half-and-half mix of two takes lies between the bars (0.99 fails, 0.5 fails)', () => {
  const x = stueck(SR, [{ von: 0, bis: 12000, f: 660 }, { von: 12000, bis: 24000, f: 440 }]);
  const k = korrelation(x, 0, 24000, 660);
  assert.ok(k < 0.99 && k > 0.5, `${k}`);
});
test('seam mask: width 2 * (4 ms + 2) frames around each boundary, at 120 and at 127 BPM (non-integer beat)', () => {
  assert.equal(schlagFrames(120), 24000);
  assert.ok(Math.abs(schlagFrames(127) - 22677.165) < 1e-3);
  for (const bpm of [120, 127]) {
    const m = nahtMaske(SR * 20, bpm, [3, 5], 4, 2);
    const mitte = Math.round(3 * schlagFrames(bpm));
    assert.equal(m[mitte], 1); assert.equal(m[mitte - 193], 1); assert.equal(m[mitte - 195], 0);
    assert.equal(m[mitte + 193], 1); assert.equal(m[mitte + 195], 0);
    assert.equal(m.reduce((s, v) => s + v, 0), 2 * 2 * 194);
  }
});
test('seam mask: negative control, the 120 BPM mask misses the 127 BPM seam', () => {
  const m = nahtMaske(SR * 20, 120, [5], 4, 2);
  assert.equal(m[Math.round(5 * schlagFrames(127))], 0);
});
test('silence: peak and dBFS, exact zero is -Infinity, a faint sample is not', () => {
  const x = new Float32Array(1000);
  assert.equal(spitze(x, 0, 1000), 0); assert.equal(dbfs(0), -Infinity);
  x[500] = 1e-4;
  assert.ok(Math.abs(dbfs(spitze(x, 0, 1000)) + 80) < 1e-4);
  assert.equal(dbfs(spitze(x, 0, 400)), -Infinity);
});
test('silent run: finds the gap with its edges, ignores a short zero crossing, null when there is none', () => {
  const x = stueck(SR, [{ von: 0, bis: 20000, f: 660 }, { von: 30000, bis: SR, f: 880 }]);
  const l = stilleLauf(x, 0, SR);
  assert.ok(l && l.von >= 19990 && l.von <= 20010 && l.bis >= 29990 && l.bis <= 30010, JSON.stringify(l));
  assert.equal(stilleLauf(stueck(SR, [{ von: 0, bis: SR, f: 660 }]), 0, SR), null);
});
test('best offset: finds the source offset of a clip, a wrong gain or a wrong take leaves a large deviation', () => {
  const q = sinusQuelle(660, 0.3, 0.7), x = new Float32Array(10000);
  for (let i = 0; i < 10000; i++) x[i] = q(i + 1);
  const b = besterVersatz(x, q, 1, 100, 9900, null, bereich(-2, 2));
  assert.equal(b.delta, 1); assert.ok(b.maxAbw < 1e-6); assert.equal(b.frames, 9800);
  assert.ok(besterVersatz(x, q, 0.5, 100, 9900, null, [1]).maxAbw > 0.1);
  assert.ok(besterVersatz(x, sinusQuelle(880, 0.3, 0.7), 1, 100, 9900, null, [1]).maxAbw > 0.1);
});
test('best offset: masked frames are not compared (a click inside the mask does not count, outside it does)', () => {
  const q = sinusQuelle(660, 0.3, 0.7), x = new Float32Array(10000);
  for (let i = 0; i < 10000; i++) x[i] = q(i);
  x[5000] += 0.5;
  const maske = new Uint8Array(10000); maske.fill(1, 4990, 5010);
  assert.ok(besterVersatz(x, q, 1, 0, 10000, maske, [0]).maxAbw < 1e-6);
  assert.ok(besterVersatz(x, q, 1, 0, 10000, null, [0]).maxAbw > 0.4);
});
test('toggle instant: finds the frame where the new frequency takes over, -1 without a change', () => {
  const x = stueck(SR, [{ von: 0, bis: 30000, f: 440 }, { von: 30000, bis: SR, f: 660 }]);
  const w = wechselFrame(x, 0, SR, 440, 660);
  assert.ok(w >= 29800 && w <= 30600, `${w}`);
  assert.equal(wechselFrame(stueck(SR, [{ von: 0, bis: SR, f: 440 }]), 0, SR, 440, 660), -1);
  assert.equal(wechselFrame(stueck(SR, [{ von: 0, bis: SR, f: 660 }]), 0, SR, 440, 660), -1);
});
test('latency and median: arithmetic of the toggle series', () => {
  // a recording of 10 s ended at wall time 20000 ms: frame 240000 (5 s) is wall 15000 ms; a request sent at 14950 ms had 50 ms of latency
  assert.ok(Math.abs(wandMs(240000, 480000, 20000) - 15000) < 1e-9);
  assert.ok(Math.abs(latenzMs(240000, 480000, 20000, 14950) - 50) < 1e-9);
  const m = medianMax([10, 400, 30, 20, 40]);
  assert.deepEqual([m.median, m.max, m.min, m.n], [30, 400, 10, 5]);
  assert.equal(medianMax([1, 3, 2, 4]).median, 2.5);
});
test('gain: finds the level of a copy, 0 for a silent or an unrelated signal', () => {
  const q = sinusQuelle(660, 0.3, 0.7), x = new Float32Array(20000);
  for (let i = 0; i < 20000; i++) x[i] = 0.7071 * q(i);
  assert.ok(Math.abs(verstaerkung(x, q, 1000, 19000) - 0.7071) < 1e-5);
  assert.equal(verstaerkung(new Float32Array(20000), q, 0, 20000), 0);
  assert.ok(Math.abs(verstaerkung(x, sinusQuelle(880, 0.3, 0.7), 0, 20000)) < 0.01);
});
test('first difference: identical buffers give -1, a changed byte or a length difference is found', () => {
  const a = Buffer.from([1, 2, 3, 4]);
  assert.equal(ersterUnterschied(a, Buffer.from(a)), -1);
  assert.equal(ersterUnterschied(a, Buffer.from([1, 2, 9, 4])), 2);
  assert.equal(ersterUnterschied(a, Buffer.from([1, 2, 3])), 3);
});
