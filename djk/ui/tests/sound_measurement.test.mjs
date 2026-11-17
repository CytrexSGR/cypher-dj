import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fft, rasterVon, StreifenAnalysator } from '../project/sound_measurement.ts';

const RATE = 48000;
function prng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 * 2 - 1; }; }
// interleaved stereo from per-channel generators f(i)
function stereo(frames, fl, fr) {
  const a = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) { a[2 * i] = fl(i); a[2 * i + 1] = fr(i); }
  return a;
}
const sine = (hz, amp) => (i) => amp * Math.sin(2 * Math.PI * hz * i / RATE);
function messen(a, block = a.length) {
  const an = new StreifenAnalysator(a.length / 2);
  for (let o = 0; o < a.length; o += block) an.schiebe(a.subarray(o, Math.min(a.length, o + block)));
  return an.ende();
}
const noise = (seed, amp = 0.3) => { const r = prng(seed); return () => amp * r(); };

test('fft of a unit impulse is flat and of a bin-centred cosine has one bin', () => {
  const re = new Float64Array(16), im = new Float64Array(16);
  re[0] = 1; fft(re, im);
  for (let k = 0; k < 16; k++) { assert.ok(Math.abs(re[k] - 1) < 1e-12); assert.ok(Math.abs(im[k]) < 1e-12); }
  const r2 = new Float64Array(16), i2 = new Float64Array(16);
  for (let n = 0; n < 16; n++) r2[n] = Math.cos(2 * Math.PI * 3 * n / 16);
  fft(r2, i2);
  for (let k = 0; k < 16; k++) {
    const m = Math.hypot(r2[k], i2[k]);
    if (k === 3 || k === 13) assert.ok(Math.abs(m - 8) < 1e-9); else assert.ok(m < 1e-9);
  }
});

test('rasterVon: short, normal and very long ranges', () => {
  assert.equal(rasterVon(6000).spalten, 1);
  assert.equal(rasterVon(8192).spalten, 1);
  assert.deepEqual(rasterVon(354462), { hop: 2048, spalten: 170 });
  const l = rasterVon(49152000);
  assert.ok(l.spalten <= 2048 && l.spalten >= 2040 && l.hop > 2048);
});

test('a 1 kHz sine at -6.02 dBFS reads -6.02 dB in its band', () => {
  const t = messen(stereo(2 * RATE, sine(1000, 0.5), sine(1000, 0.5)));
  const n = 67; // k = 14
  assert.ok(Math.abs(t.spektrum.mittel_db[n] - -6.02) < 0.3, String(t.spektrum.mittel_db[n]));
  assert.ok(Math.abs(t.spektrum.max_db[n] - -6.02) < 0.3);
  for (const o of [63, 71]) assert.ok(t.spektrum.mittel_db[o] < t.spektrum.mittel_db[n] - 30);
  const z = Buffer.from(t.zeitbild.daten, 'base64');
  assert.equal(z.length, t.zeitbild.spalten * 120);
  assert.ok(Math.abs(z[n] - 238) <= 2, String(z[n]));
  assert.equal(t.spalten * 30, t.spaltenTerz.length);
});

test('a full-scale sine: peak 0, rms -3.01, crest 3.01', () => {
  const t = messen(stereo(RATE, sine(997, 1), sine(997, 1)));
  assert.ok(Math.abs(t.spitze_db) < 0.05);
  assert.ok(Math.abs(t.rms_db - -3.01) < 0.05);
  assert.ok(Math.abs(t.crest_db - 3.01) < 0.05);
});

test('mono noise correlates 1 and has no width', () => {
  const g = noise(1);
  const m = new Float32Array(RATE); for (let i = 0; i < RATE; i++) m[i] = g();
  const t = messen(stereo(RATE, (i) => m[i], (i) => m[i]));
  assert.ok(t.stereo.korrelation >= 0.999);
  assert.equal(t.stereo.breite_db, -200);
  for (const b of t.stereo.baender) assert.ok(b.korrelation >= 0.99);
});

test('L = -R correlates -1', () => {
  const m = new Float32Array(RATE); const g = noise(2); for (let i = 0; i < RATE; i++) m[i] = g();
  const t = messen(stereo(RATE, (i) => m[i], (i) => -m[i]));
  assert.ok(t.stereo.korrelation <= -0.999);
  assert.ok(t.stereo.korrelation_min <= -0.999);
});

test('independent noise correlates near 0 and has 0 dB width', () => {
  const t = messen(stereo(2 * RATE, noise(3), noise(4)));
  assert.ok(Math.abs(t.stereo.korrelation) < 0.05);
  assert.ok(Math.abs(t.stereo.breite_db) < 0.5);
});

test('korrelation_min finds the cancelling half', () => {
  const m = new Float32Array(2 * RATE); const g = noise(5); for (let i = 0; i < m.length; i++) m[i] = g();
  const t = messen(stereo(2 * RATE, (i) => m[i], (i) => (i < RATE ? m[i] : -m[i])));
  assert.ok(t.stereo.korrelation_min <= -0.99);
  assert.ok(Math.abs(t.stereo.korrelation) < 0.1);
});

test('silence is stumm with the floor everywhere', () => {
  const t = messen(new Float32Array(RATE * 2));
  assert.equal(t.stumm, true);
  assert.equal(t.stereo.korrelation, 0);
  assert.equal(t.stereo.korrelation_min, 0);
  assert.equal(t.stereo.breite_db, -200);
  assert.ok(t.spektrum.mittel_db.every((v) => v === -200));
  assert.ok(t.spektrum.max_db.every((v) => v === -200));
  assert.ok(Buffer.from(t.zeitbild.daten, 'base64').every((v) => v === 0));
});

test('a range shorter than one window gives one column', () => {
  const t = messen(stereo(4800, sine(1000, 0.5), sine(1000, 0.5)));
  assert.equal(t.spalten, 1);
  const mx = Math.max(...t.spektrum.mittel_db);
  assert.equal(t.spektrum.mittel_db[67], mx);
  assert.ok(mx > -20);
  assert.equal(t.stereo.korrelation_min, t.stereo.korrelation);
});

test('0.3 s (one beat at 200 BPM) is longer than one window: four columns, whole-range correlation', () => {
  const t = messen(stereo(14400, sine(1000, 0.5), sine(1000, 0.5)));
  assert.equal(t.spalten, 4);
  assert.equal(t.stereo.korrelation_min, t.stereo.korrelation);
});

test('feeding in blocks gives the same result as one block', () => {
  const a = stereo(RATE, noise(6), sine(300, 0.4));
  assert.deepEqual(messen(a, 999 * 2), messen(a));
});

test('pegel_db: power of L plus R per stereo band', () => {
  const mono = messen(stereo(RATE, sine(60, 0.5), sine(60, 0.5)));
  assert.ok(Math.abs(mono.stereo.baender[0].pegel_db - -6.02) < 0.5, String(mono.stereo.baender[0].pegel_db));
  assert.ok(mono.stereo.baender[2].pegel_db < -60);
  const anti = messen(stereo(RATE, sine(60, 0.25), (i) => -sine(60, 0.25)(i)));
  assert.ok(Math.abs(anti.stereo.baender[0].pegel_db - -12.04) < 0.5, String(anti.stereo.baender[0].pegel_db));
  const still = messen(new Float32Array(RATE));
  assert.ok(still.stereo.baender.every((b) => b.pegel_db === -200 && b.korrelation === 0));
});

// The 1/12 bands are band integrals, not line levels: below about 250 Hz the main lobe of the Hann window is wider than the band.
test('a full-scale 55 Hz sine reads about -5.5 dB in its 1/12 band, -0.5 dB in its 1/3 octave band, and the band powers add up to 0 dB', async () => {
  const { terzVon } = await import('../project/sound_contract.ts');
  const t = messen(stereo(RATE * 2, sine(55, 1), sine(55, 1)));
  const n = 17;   // k = round(12 log2(55 / 440)) = -36, band index k + 53
  assert.ok(Math.abs(t.spektrum.hz[n] - 55) < 1, `band ${n} is ${t.spektrum.hz[n]} Hz`);
  assert.ok(Math.abs(t.spektrum.mittel_db[n] - -5.5) <= 0.3, `${t.spektrum.mittel_db[n]} dB`);
  const summe = 10 * Math.log10(t.spektrum.mittel_db.reduce((s, d) => s + 10 ** (d / 10), 0));
  assert.ok(Math.abs(summe) <= 0.1, `sum of the bands ${summe} dB`);
  const terz = terzVon(t.spektrum.mittel_db);
  assert.ok(Math.abs(Math.max(...terz) - -0.5) <= 0.3, `1/3 octave ${Math.max(...terz)} dB`);
  assert.ok(Math.abs(t.spitze_db) < 0.01);
});

test('the lowest stereo band counts only bins from 20 Hz', () => {
  const dc = messen(stereo(RATE, () => 0.5, () => 0.5));   // pure DC: nothing above 20 Hz
  assert.ok(dc.stereo.baender[0].pegel_db <= -100, `${dc.stereo.baender[0].pegel_db}`);
  const b = messen(stereo(RATE, sine(60, 0.5), sine(60, 0.5)));
  assert.ok(b.stereo.baender[0].pegel_db > -20 && b.stereo.baender[0].korrelation > 0.99);
});
