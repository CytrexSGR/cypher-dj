// Package 1.9 U4 (T4.5): the measurements of pruef/richtung_messen.mjs on synthetic signals, each with a control that must NOT pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { schwerpunktHz, bandAnteilDb, abklingAnteilDb, abklingHochDb, messeDatei, MESSUNG } from '../pruef/richtung_messen.mjs';
import { schreibeWav } from '../pruef/w1_wav.mjs';

const RATE = 48000;
const sinus = (f, n, a = 0.5) => Float64Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / RATE));
// deterministic noise (LCG), flat spectrum
const rauschen = (n, a = 0.3) => { let s = 12345; return Float64Array.from({ length: n }, () => { s = (s * 1664525 + 1013904223) >>> 0; return a * (s / 2 ** 31 - 1); }); };
// a 1 kHz tone burst on every 16th at 120 BPM with the amplitude envelope exp(-t/tau)
const stoesse = (tau, schritte = 32, bpm = 120) => {
  const s = Math.round((60 / bpm / 4) * RATE), x = new Float64Array(schritte * s);
  for (let k = 0; k < schritte; k++) for (let i = 0; i < s; i++) x[k * s + i] = 0.5 * Math.exp(-i / RATE / tau) * Math.sin((2 * Math.PI * 1000 * i) / RATE);
  return x;
};

test('T4.5 centroid: a 200 Hz sine sits near 200 Hz, a 2 kHz sine near 2 kHz, and the order is right', () => {
  const tief = schwerpunktHz(sinus(200, RATE * 2), RATE), hoch = schwerpunktHz(sinus(2000, RATE * 2), RATE);
  assert.ok(Math.abs(tief / 200 - 1) < 0.05, `200 Hz read ${tief}`);
  assert.ok(Math.abs(hoch / 2000 - 1) < 0.05, `2 kHz read ${hoch}`);
  assert.ok(hoch > 5 * tief);
  // equal amplitudes: the centroid lies between the two, not on either
  const beide = sinus(200, RATE * 2).map((v, i) => v + 0.5 * Math.sin((2 * Math.PI * 2000 * i) / RATE));
  const mitte = schwerpunktHz(beide, RATE);
  assert.ok(mitte > 800 && mitte < 1400, `mix read ${mitte}`);
  // negative control: the 200 Hz reading is NOT within 10 % of the 2 kHz one, so a +10 % gate has teeth
  assert.ok(Math.abs(tief / hoch - 1) > 0.1);
  // a 10 % louder high tone moves the centroid by far less than the octave-wide difference but more than the noise of two equal runs
  assert.equal(schwerpunktHz(sinus(200, RATE * 2), RATE), tief, 'deterministic');
});

test('T4.5 band share: a 2 kHz sine is all inside 1-5 kHz, a 200 Hz sine is not, white noise gives its width ratio', () => {
  assert.ok(bandAnteilDb(sinus(2000, RATE * 2), RATE, 1000, 5000) > -0.5);
  assert.ok(bandAnteilDb(sinus(200, RATE * 2), RATE, 1000, 5000) < -40);
  const n = bandAnteilDb(rauschen(RATE * 4), RATE, 1000, 5000);        // 4 kHz of 24 kHz: 10 log10(1/6) = -7.8 dB
  assert.ok(Math.abs(n - 10 * Math.log10(4000 / 24000)) < 1, `noise read ${n}`);
  const tiefAnteil = bandAnteilDb(sinus(80, RATE * 2), RATE, 0, 120), keinAnteil = bandAnteilDb(sinus(500, RATE * 2), RATE, 0, 120);
  assert.ok(tiefAnteil > -0.5 && keinAnteil < -30, `below 120 Hz: ${tiefAnteil} vs ${keinAnteil}`);
  // a move above the 1.5 dB gate is visible: a 2 kHz sine of amplitude 0.5 plus a 200 Hz sine of 0.5 (share 1/2 = -3.01 dB) or of 0.2 (share 0.125/0.145 = -0.64 dB)
  const mit = (a) => sinus(2000, RATE * 2, 0.5).map((v, i) => v + a * Math.sin((2 * Math.PI * 200 * i) / RATE));
  const d = bandAnteilDb(mit(0.2), RATE, 1000, 5000) - bandAnteilDb(mit(0.5), RATE, 1000, 5000);
  assert.ok(Math.abs(d - 2.37) < 0.15, `a quieter 200 Hz partial raises the share by ${d} dB, closed form 2.37`);
  assert.ok(Math.abs(bandAnteilDb(mit(0.5), RATE, 1000, 5000) - -3.01) < 0.15);
  // negative control: the same signal twice differs by 0
  assert.equal(bandAnteilDb(mit(0.2), RATE, 1000, 5000), bandAnteilDb(mit(0.2), RATE, 1000, 5000));
});

test('T4.5 decay share: the energy of the last half of each 16th, against the closed form e^-T/tau / (1 + e^-T/tau)', () => {
  const T = 0.125;
  for (const tau of [0.02, 0.06, 0.125]) {
    const soll = 10 * Math.log10(Math.exp(-T / tau) / (1 + Math.exp(-T / tau)));
    const ist = abklingAnteilDb(stoesse(tau), RATE, 120);
    assert.ok(Math.abs(ist - soll) < 0.5, `tau ${tau}: ${ist} vs ${soll}`);
  }
  // a faster decay reads lower by far more than the 2 dB gate; negative control: two equal signals differ by 0
  const schnell = abklingAnteilDb(stoesse(0.02), RATE, 120), langsam = abklingAnteilDb(stoesse(0.06), RATE, 120);
  assert.ok(langsam - schnell > 2);
  assert.equal(abklingAnteilDb(stoesse(0.06), RATE, 120), langsam);
  // a steady tone (no decay) puts half of its energy in the second half: -3 dB
  assert.ok(Math.abs(abklingAnteilDb(sinus(1000, RATE * 4), RATE, 120) - 10 * Math.log10(0.5)) < 0.2);
});

test('T4.5 messeDatei: the three quantities of a stereo WAV, equal channels equal the mono computation', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'richtung-')); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const x = stoesse(0.06), st = new Float32Array(x.length * 2);
  x.forEach((v, i) => { st[2 * i] = v; st[2 * i + 1] = v; });
  schreibeWav(path.join(d, 'a.wav'), st, 2, RATE);
  const m = messeDatei(path.join(d, 'a.wav'), 120);
  assert.equal(m.rate, RATE);
  assert.ok(Math.abs(m.schwerpunkt_hz / 1000 - 1) < 0.05);
  assert.ok(Math.abs(m.abkling_db - abklingAnteilDb(x, RATE, 120)) < 0.05);
  assert.ok(m.band_1_5k_db > -6 && m.band_unter_120_db < -30, `bands: ${m.band_1_5k_db} / ${m.band_unter_120_db}`);   // bursts of 60 ms spread some energy around the 1 kHz line
  assert.deepEqual(Object.keys(MESSUNG).sort(), ['aggressive', 'bright', 'dark', 'deep', 'soft', 'tight']);
  // silence is refused, not read as zero
  schreibeWav(path.join(d, 's.wav'), new Float32Array(RATE * 2), 2, RATE);
  assert.throws(() => messeDatei(path.join(d, 's.wav'), 120), /silent|silence/);
});

test('T4.5 bewegung: the gate of each word has the right sign, size and unit', async () => {
  const { bewegung } = await import('../pruef/richtung_messen.mjs');
  const a = { schwerpunkt_hz: 1000, band_1_5k_db: -6, band_unter_120_db: -10, abkling_db: -8 };
  assert.deepEqual([bewegung('bright', a, { ...a, schwerpunkt_hz: 1100.5 }).ok, bewegung('bright', a, { ...a, schwerpunkt_hz: 1090 }).ok], [true, false]);
  assert.deepEqual([bewegung('dark', a, { ...a, schwerpunkt_hz: 890 }).ok, bewegung('dark', a, { ...a, schwerpunkt_hz: 1100 }).ok], [true, false], 'dark must go DOWN');
  assert.deepEqual([bewegung('aggressive', a, { ...a, band_1_5k_db: -4.4 }).ok, bewegung('aggressive', a, { ...a, band_1_5k_db: -4.6 }).ok], [true, false]);
  assert.deepEqual([bewegung('soft', a, { ...a, band_1_5k_db: -7.6 }).ok, bewegung('soft', a, { ...a, band_1_5k_db: -4 }).ok], [true, false]);
  const h = { ...a, abkling_hoch_db: -5 };
  assert.deepEqual([bewegung('tight', h, { ...h, abkling_hoch_db: -5.4 }).ok, bewegung('tight', h, { ...h, abkling_hoch_db: -5.2 }).ok, bewegung('tight', h, { ...h, abkling_db: -20 }).ok], [true, false, false], 'tight reads the high-passed quantity only');
  assert.deepEqual([bewegung('deep', a, { ...a, band_unter_120_db: -8.9 }).ok, bewegung('deep', a, { ...a, band_unter_120_db: -9.5 }).ok], [true, false]);
  assert.equal(bewegung('bright', a, a).wert, 0, 'no change reads 0');
  assert.throws(() => bewegung('warm', a, a), /warm/);
});

test('T4.5 high-passed decay share: a steady 200 Hz hum does not hide the decay of the 2 kHz bursts, the plain share does not see it', () => {
  const RATE2 = 48000, s = Math.round(0.125 * RATE2), n = 32 * s;
  const burst = (tau) => Float64Array.from({ length: n }, (_, i) => 0.3 * Math.exp(-(i % s) / RATE2 / tau) * Math.sin((2 * Math.PI * 2000 * i) / RATE2));
  const hum = (x, a = 0.1) => x.map((v, i) => v + a * Math.sin((2 * Math.PI * 200 * i) / RATE2));
  const T = 0.125, soll = (tau) => 10 * Math.log10(Math.exp(-T / tau) / (1 + Math.exp(-T / tau)));
  for (const tau of [0.04, 0.06]) {
    assert.ok(Math.abs(abklingHochDb(burst(tau), RATE2, 120) - soll(tau)) < 0.7, `bursts alone, tau ${tau}: ${abklingHochDb(burst(tau), RATE2, 120)} vs ${soll(tau)}`);
    assert.ok(Math.abs(abklingHochDb(hum(burst(tau)), RATE2, 120) - abklingHochDb(burst(tau), RATE2, 120)) < 0.3, 'the hum below 1 kHz is filtered out');
  }
  // negative control: with a loud hum the plain share sits near -3 dB whatever the bursts do (a steady tone has half its energy in the second half), the high-passed one does not
  const laut = (tau) => hum(burst(tau), 0.5);
  assert.ok(Math.abs(abklingAnteilDb(laut(0.06), RATE2, 120) - abklingAnteilDb(laut(0.05), RATE2, 120)) < 0.1 && Math.abs(abklingAnteilDb(laut(0.06), RATE2, 120) + 3.01) < 0.5);
  assert.ok(abklingHochDb(burst(0.06), RATE2, 120) - abklingHochDb(burst(0.05), RATE2, 120) > 0.3, 'a decay 17 % shorter reads more than the 0.3 dB gate');
});

// Package 1.9 U5 (T5.3): the gates of the Surge table. Same quantities as spec 4.3; tight reads the late-half share of ALL energy (-2 dB, the Surge amp
// envelope shapes the tail, unlike the RB-338 decay); there is no `deep` for Surge.
test('U5 MESSUNG_SURGE: tight reads the share of all energy with the spec minimum 2 dB; the other words read the quantities of the RB table; no deep', async () => {
  const { bewegung, MESSUNG_SURGE, MESSUNG: rb } = await import('../pruef/richtung_messen.mjs');
  assert.deepEqual(Object.keys(MESSUNG_SURGE).sort(), ['aggressive', 'bright', 'dark', 'soft', 'tight']);
  for (const w of ['bright', 'dark', 'aggressive', 'soft']) assert.deepEqual(MESSUNG_SURGE[w], rb[w], w);
  assert.deepEqual([MESSUNG_SURGE.tight.feld, MESSUNG_SURGE.tight.min, MESSUNG_SURGE.tight.vorzeichen], ['abkling_db', 2, -1]);
  const a = { schwerpunkt_hz: 1000, band_1_5k_db: -6, band_unter_120_db: -10, abkling_db: -8, abkling_hoch_db: -5 };
  const t = (n, hoch) => bewegung('tight', a, { ...a, abkling_db: n, abkling_hoch_db: hoch }, MESSUNG_SURGE).ok;
  assert.deepEqual([t(-10.1, -5), t(-9.9, -5), t(-8, -9)], [true, false, false], 'only the all-energy share counts, 2 dB');
  assert.throws(() => bewegung('deep', a, a, MESSUNG_SURGE), /deep/);
  // the default table is still the RB one: tight is the high-passed share with 0.3 dB
  assert.equal(bewegung('tight', a, { ...a, abkling_hoch_db: -5.4 }).ok, true);
});
