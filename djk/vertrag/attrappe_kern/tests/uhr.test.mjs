// node --test tests/uhr.test.mjs: Tempo-Karte gegen die Golden-Werte aus SCHNITTSTELLEN §1.3
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Karte, llround, taktVon, schlagVon, phraseVon, MAX_SEGMENTE } from '../uhr.mjs';

const nah = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b} (±${eps})`);

test('konstant 128: sample(64) = 1 440 000, beat(1 440 000) = 64', () => {
  const k = new Karte(128);
  nah(k.sample(64), 1440000);
  nah(k.beat(1440000), 64);
});

// Referenz mit 50 Stellen (Python decimal, Formeln §1.3): sample(144) = 3237188,00436067521…, sample(160) = 3588923,07692307692…,
// sample(192) = 4287104,89510489510…, bpm(144) = 130,015383705160059…; der Vertrag nennt sie auf 3 Stellen gerundet.
test('Rampe 128 -> 132 ab Beat 128 über 32 Beats: Golden-Werte ±1e-6 Samples vor dem Runden', () => {
  const k = new Karte(128);
  assert.equal(k.rampe(128, 132, 32), null);
  nah(k.sample(128), 2880000);
  const g = k.segBeiBeat(130);
  nah(g.dauer_s, 14.769231, 1e-6);
  nah(g.k, 0.270833, 1e-6);
  nah(k.sample(144), 3237188.0043606752, 1e-6);
  assert.equal(llround(k.sample(144)), 3237188);
  nah(k.bpmBeiBeat(144), 130.01538370516006, 1e-9);
  nah(k.sample(160), 3588923.0769230769, 1e-6);
  assert.equal(llround(k.sample(160)), 3588923);
  nah(k.sample(192), 4287104.8951048951, 1e-6);
  assert.equal(llround(k.sample(192)), 4287105);
  for (const b of [0, 100, 128, 131.5, 144, 159.99, 160, 200]) nah(k.beat(k.sample(b)), b, 1e-9);
});

test('int64-Segmentanfang mit exaktem b0 ergibt dieselben Golden-Werte (Vertrag nennt s0 als int64)', () => {
  const k = new Karte(128);
  k.rampe(128, 132, 32);
  const s0 = llround(k.sample(160));          // 3 588 923
  const b0 = k.beat(s0);                      // exakter Beat an diesem Sample
  const sample192 = s0 + ((192 - b0) * 60 * 48000) / 132;
  nah(sample192, 4287104.8951048951, 1e-6);
});

test('Takt, Schlag, Phrase für Beat 0 / 3,5 / 64 / 127,99 / 128', () => {
  const f = (b) => `${taktVon(b)}.${schlagVon(b)} P${phraseVon(b)}`;
  assert.deepEqual([0, 3.5, 64, 127.99, 128].map(f), ['1.1 P1', '1.4 P1', '17.1 P3', '32.4 P4', '33.1 P5']);
});

test('llround: ,5 vom Nullpunkt weg', () => {
  assert.deepEqual([2.5, -2.5, 3.49, -3.5].map(llround), [3, -3, 3, -4]);
});

test('Karte voll: die Rampe, die das 65. Segment bräuchte, wird abgelehnt (Negativ-Kontrolle: die davor geht)', () => {
  const k = new Karte(128);
  let n = 0;
  for (let i = 0; i < 31; i++) { assert.equal(k.rampe(10 + i * 10, 128 + (i % 2), 2), null); n++; }
  assert.equal(k.seg.length, 63);
  assert.equal(k.rampe(1000, 130, 2), 'karte_voll');
  assert.equal(k.seg.length, 63);
  assert.ok(MAX_SEGMENTE === 64 && n === 31);
});
