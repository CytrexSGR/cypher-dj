// 1.8 S2b.5: the pure measuring helpers of pruef/abnahme_rec2.mjs. Synthetic clicks at known frames, a shifted copy, silence (no click is FEHL, never OK).
import test from 'node:test';
import assert from 'node:assert/strict';
import { klickOrte, abweichung, spitzeDb, urteilKlicks, KLICK_ABSTAND } from '../check/rec_measure.mjs';

// the click of the core metronome: 96 samples, 2 kHz, decaying, first sample is the maximum (arr_metronom.cpp)
const klick = (pegel) => Float32Array.from({ length: 96 }, (_, i) => pegel * Math.exp(-i / 12) * Math.cos((2 * Math.PI * 2000 * i) / 48000));
function signal(laenge, orte, pegel = () => 0.5) {
  const x = new Float32Array(laenge);
  orte.forEach((o, k) => { const f = klick(pegel(k)); for (let i = 0; i < f.length && o + i < laenge; i++) x[o + i] += f[i]; });
  return x;
}
const SOLL = Array.from({ length: 16 }, (_, b) => b * 24000);   // 120 BPM: a beat every 24000 frames

test('klickOrte finds the onset frame of every click, accented (full level) and normal (half level) alike', () => {
  const x = signal(24000 * 16 + 1000, SOLL.map((s) => s + 300), (k) => (k % 4 === 0 ? 0.8 : 0.4));
  assert.deepEqual(klickOrte(x, 0.2), SOLL.map((s) => s + 300));
});
test('klickOrte: a click on frame 0 and one on the last frames count (the take starts on the first beat)', () => {
  const x = signal(5000, [0, 4990]);
  assert.deepEqual(klickOrte(x, 0.2), [0, 4990]);
});
test('klickOrte: silence and a signal below the threshold give no click', () => {
  assert.deepEqual(klickOrte(new Float32Array(100000), 0.2), []);
  assert.deepEqual(klickOrte(signal(100000, [500, 30000], () => 0.1), 0.2), []);
});
test('klickOrte: the ringing of one click (more crossings within the spacing) is one click', () => {
  const x = signal(10000, [1000]);
  assert.equal(klickOrte(x, 0.05).length, 1, 'the tail crosses the threshold again, the spacing keeps it one');
  assert.ok(KLICK_ABSTAND >= 96);
});
test('abweichung: clicks 256 frames late give +256 each; the same clicks compensated by the offset give 0', () => {
  const orte = klickOrte(signal(24000 * 16 + 1000, SOLL.map((s) => s + 256)), 0.2);
  const roh = abweichung(orte, SOLL);
  assert.deepEqual([roh.fehlend, roh.max, roh.min], [0, 256, 256]);
  const ausgeglichen = abweichung(orte.map((o) => o - 256), SOLL);
  assert.deepEqual([ausgeglichen.fehlend, ausgeglichen.max, ausgeglichen.min, ausgeglichen.streuung], [0, 0, 0, 0]);
});
test('abweichung: a shifted copy moves every deviation by exactly the shift; the spread of jitter is reported', () => {
  const jitter = [0, 3, -2, 1, 0, -1, 2, 0, 0, 1, -3, 0, 2, 0, -1, 1];
  const orte = SOLL.map((s, i) => s + 10 + jitter[i]);
  const a = abweichung(orte, SOLL), b = abweichung(orte.map((o) => o + 100), SOLL);
  assert.deepEqual(a.je.map((e) => e.abw), jitter.map((j) => 10 + j));
  assert.deepEqual(b.je.map((e, i) => e.abw - a.je[i].abw), new Array(16).fill(100));
  assert.ok(a.streuung > 0 && a.streuung < 3);
});
test('abweichung: a beat without a click is counted as missing, not as a deviation of 0', () => {
  const orte = SOLL.filter((_, i) => i !== 5).map((s) => s + 4);
  const a = abweichung(orte, SOLL);
  assert.equal(a.fehlend, 1);
  assert.equal(a.je[5].fehlt, true);
  assert.equal(a.je.filter((e) => !e.fehlt).length, 15);
});
test('urteilKlicks: silent input is FEHL "no click", never OK (negative control: a clean take is OK)', () => {
  const still = urteilKlicks(klickOrte(new Float32Array(24000 * 16), 0.2), SOLL, 48);
  assert.equal(still.ok, false);
  assert.match(still.grund, /no click/);
  const gut = urteilKlicks(klickOrte(signal(24000 * 16 + 1000, SOLL.map((s) => s + 7)), 0.2).map((o) => o - 7), SOLL, 48);
  assert.deepEqual([gut.ok, gut.fehlend], [true, 0]);
  const schief = urteilKlicks(klickOrte(signal(24000 * 16 + 1000, SOLL.map((s) => s + 300)), 0.2), SOLL, 48);
  assert.equal(schief.ok, false);
  assert.match(schief.grund, /deviation/);
  assert.equal(schief.maxAbs, 300);
});
test('urteilKlicks: tolerance is max(48, 2 * spread): a measured spread widens it, a small one never narrows below 48', () => {
  const orte = SOLL.map((s) => s + 60);
  assert.equal(urteilKlicks(orte, SOLL, 48).ok, false);
  assert.equal(urteilKlicks(orte, SOLL, Math.max(48, 2 * 40)).ok, true);
  assert.equal(urteilKlicks(SOLL.map((s) => s + 40), SOLL, Math.max(48, 2 * 0)).ok, true);
});
test('spitzeDb: full scale 0 dB, half -6.02 dB, silence -200 like the core', () => {
  assert.equal(spitzeDb(Float32Array.of(0, -1, 0.5)), 0);
  assert.ok(Math.abs(spitzeDb(Float32Array.of(0.5, -0.25)) + 6.0206) < 1e-3);
  assert.equal(spitzeDb(new Float32Array(10)), -200);
});
