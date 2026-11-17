import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StreifenAnalysator, ueberdeckung, hinweiseQuelle, hinweiseUeberdeckung, notenName } from '../project/sound_measurement.ts';
import { tonName } from '../public/production/pianoroll.js';

const RATE = 48000;
function prng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 * 2 - 1; }; }
function stereo(frames, fl, fr = fl) {
  const a = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) { a[2 * i] = fl(i); a[2 * i + 1] = fr(i); }
  return a;
}
const sine = (hz, amp, ph = 0) => (i) => amp * Math.sin(2 * Math.PI * hz * i / RATE + ph);
function messen(a) { const an = new StreifenAnalysator(a.length / 2); an.schiebe(a); return an.ende(); }
function messung(t, name, tp = null) {
  return {
    quelle: { art: 'spur', id: name.toLowerCase() }, name, stumm: t.stumm,
    lautheit: { lufs_i: null, lufs_s_max: null, lufs_m_max: null, lra: null, true_peak_dbtp: t.stumm ? null : tp,
      spitze_db: null, rms_db: null, crest_db: null },
    stereo: t.stereo, spektrum: t.spektrum, zeitbild: t.zeitbild,
  };
}
const SEK = 4 * RATE;
const kick = (i) => { const t = (i / RATE) % 0.46; return t < 0.2 ? 0.8 * Math.exp(-t / 0.2) * Math.sin(2 * Math.PI * 50 * i / RATE) : 0; };

test('kick and bass with overlapping fundamentals mask below 250 Hz', () => {
  const k = messen(stereo(SEK, kick)), b = messen(stereo(SEK, sine(55, 0.4)));
  const u = ueberdeckung(k, b);
  assert.ok(u.schwerpunkte.length >= 1);
  assert.ok(u.schwerpunkte[0].hz_von < 250);
  assert.ok(u.schwerpunkte[0].anteil >= 0.5);
  const h = hinweiseUeberdeckung(messung(k, 'Kick'), messung(b, 'Bass'), u);
  assert.equal(h.length, 1);
  assert.equal(h[0].art, 'ueberdeckung_tief');
  assert.ok(h[0].text.includes('Kick and Bass mask each other'), h[0].text);
});

test('a hi-hat against a bass does not mask', () => {
  const r = prng(7);
  const x = new Float32Array(SEK + 2); for (let i = 0; i < x.length; i++) x[i] = 0.3 * r();
  const hat = (i) => x[i + 2] - 2 * x[i + 1] + x[i];   // second difference: high-pass
  const k = messen(stereo(SEK, hat)), b = messen(stereo(SEK, sine(55, 0.4)));
  const u = ueberdeckung(k, b);
  assert.deepEqual(u.schwerpunkte, []);
  assert.deepEqual(hinweiseUeberdeckung(messung(k, 'Hat'), messung(b, 'Bass'), u), []);
});

test('a silent comparison gives no masking anteil', () => {
  const u = ueberdeckung(messen(stereo(SEK, sine(55, 0.4))), messen(new Float32Array(SEK * 2)));
  assert.equal(u.baender.length, 30);
  assert.ok(u.baender.every((b) => b.anteil === 0));
  assert.deepEqual(u.schwerpunkte, []);
});

test('schwerpunkte are at most three, highest first', () => {
  // four separated sine pairs; the fourth pair is the same level in only half of the time
  const freqs = [100, 300, 900, 2700];
  const sum = (amp) => (i) => freqs.reduce((s, f, n) => s + (n === 3 ? (i < SEK / 2 ? amp : amp * 0.001) : amp) * Math.sin(2 * Math.PI * f * i / RATE), 0);
  const q = messen(stereo(SEK, sum(0.1))), v = messen(stereo(SEK, (i) => sum(0.1)(i) * 1.0));
  const u = ueberdeckung(q, v);
  assert.equal(u.schwerpunkte.length, 3);
  for (let i = 1; i < 3; i++) assert.ok(u.schwerpunkte[i - 1].anteil >= u.schwerpunkte[i].anteil);
  assert.ok(u.baender.some((b) => b.anteil > 0 && b.hz > 2000));   // the weaker fourth pair exists but is cut off
});

test('bass that is not mono is named', () => {
  const T = RATE / 60;
  const w = messen(stereo(2 * RATE, sine(60, 0.5), (i) => 0.5 * Math.sin(2 * Math.PI * 60 * (i - T / 4) / RATE)));
  const h = hinweiseQuelle(messung(w, 'Pad'));
  assert.equal(h.filter((x) => x.art === 'bass_nicht_mono').length, 1);
  assert.ok(h.find((x) => x.art === 'bass_nicht_mono').text.startsWith('Pad: the bass below 120 Hz is not mono (correlation '));
  const m = messen(stereo(2 * RATE, sine(60, 0.5)));
  assert.equal(hinweiseQuelle(messung(m, 'Pad')).filter((x) => x.art === 'bass_nicht_mono').length, 0);
});

test('a bass in full antiphase (L = -R, -12 dBFS) is named although it cancels in mono', () => {
  const w = messen(stereo(2 * RATE, sine(60, 0.25), (i) => -sine(60, 0.25)(i)));
  const h = hinweiseQuelle(messung(w, 'Sub')).filter((x) => x.art === 'bass_nicht_mono');
  assert.equal(h.length, 1);
  assert.ok(h[0].text.includes('correlation -1.00'), h[0].text);
  // a silent-in-the-bass source does not get it even when its correlation is poor
  for (const f2 of [(i) => -sine(3000, 0.25)(i), sine(3000, 0.25, 1.3), sine(3000, 0.25, 0)]) {
    const hoch = messen(stereo(2 * RATE, sine(3000, 0.25), f2));
    assert.equal(hinweiseQuelle(messung(hoch, 'Hi')).filter((x) => x.art === 'bass_nicht_mono').length, 0);
  }
});

test('true peak above -1 dBTP is named, at -1.0 not', () => {
  const t = messen(stereo(RATE, sine(1000, 0.5)));
  const nurTp = (m) => hinweiseQuelle(m).filter((x) => x.art === 'true_peak');
  const h = nurTp(messung(t, 'Lead', -0.6));
  assert.equal(h.length, 1);
  assert.equal(h[0].art, 'true_peak');
  assert.equal(h[0].text, 'Lead: true peak -0.6 dBTP is above -1 dBTP');
  assert.deepEqual(nurTp(messung(t, 'Lead', -1.0)), []);
  assert.deepEqual(nurTp(messung(t, 'Lead', null)), []);
});

test('a resonance in noise is found with its note', () => {
  const rauschen = (seed) => { const r = prng(seed); return () => 0.1 * r(); };
  const n1 = rauschen(11), n2 = rauschen(12);
  const arr = new Float32Array(4 * RATE); for (let i = 0; i < arr.length; i++) arr[i] = n1();
  const arr2 = new Float32Array(4 * RATE); for (let i = 0; i < arr2.length; i++) arr2[i] = n2();
  const nur = messen(stereo(4 * RATE, (i) => arr[i], (i) => arr2[i]));
  assert.deepEqual(hinweiseQuelle(messung(nur, 'Pad')).filter((h) => h.art === 'resonanz'), []);
  const n = 87;   // band of 3 kHz
  const amp = 10 ** ((nur.spektrum.mittel_db[n] + 20) / 20);
  const mit = messen(stereo(4 * RATE, (i) => arr[i] + sine(3000, amp)(i), (i) => arr2[i] + sine(3000, amp)(i)));
  const h = hinweiseQuelle(messung(mit, 'Pad')).filter((x) => x.art === 'resonanz');
  assert.equal(h.length, 1, JSON.stringify(h));
  assert.ok(Math.abs(Math.log2(h[0].hz / 3000)) * 12 <= 1);
  assert.ok(h[0].text.includes(notenName(h[0].hz)));
  assert.ok(h[0].text.startsWith('Pad: narrow peak at 3.0 kHz (F#6), '), h[0].text);
  // more than three peaks: only the three largest
  const freqs = [200, 500, 1200, 3000, 7000];
  const viele = messen(stereo(4 * RATE, (i) => arr[i] + freqs.reduce((s, f) => s + sine(f, amp)(i), 0)));
  assert.equal(hinweiseQuelle(messung(viele, 'Pad')).filter((x) => x.art === 'resonanz').length, 3);
});

test('a stumm source has no hints', () => {
  const t = messen(new Float32Array(RATE * 2));
  assert.deepEqual(hinweiseQuelle(messung(t, 'Mute', -0.2)), []);
});

test('notenName follows the house convention', () => {
  assert.equal(notenName(440), tonName(69));
  assert.equal(notenName(440), 'A3');
  assert.equal(notenName(261.63), tonName(60));
  assert.equal(notenName(261.63), 'C3');
});
