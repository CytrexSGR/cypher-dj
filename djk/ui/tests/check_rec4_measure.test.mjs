// 1.8 T6: the pure measuring helpers of pruef/abnahme_rec4.mjs. Synthetic signals with known answers; every negative control turns red here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { klickOrte, urteilKlicks } from '../check/rec_measure.mjs';
import {
  samplesProBeat, sampleBei, zaehlSoll, klicksVorEinsatz, groessterSchritt, urteilNaht, shaFenster, naechsterTakt, taktLage, weitVonTaktlinie, istAkzent, sinus,
} from '../check/rec4_measure.mjs';

const klick = (pegel) => Float32Array.from({ length: 96 }, (_, i) => pegel * Math.exp(-i / 12) * Math.cos((2 * Math.PI * 2000 * i) / 48000));
function signal(laenge, orte, pegel = () => 0.5) {
  const x = new Float32Array(laenge);
  orte.forEach((o, k) => { const f = klick(pegel(k)); for (let i = 0; i < f.length && o + i < laenge; i++) x[o + i] += f[i]; });
  return x;
}

test('samplesProBeat and sampleBei: 120 BPM is exact, 127 BPM is rounded like llround', () => {
  assert.equal(samplesProBeat(120), 24000);
  assert.equal(sampleBei(4, 120), 96000);
  assert.equal(sampleBei(4, 127), 90709);   // 90708.66...
  assert.equal(sampleBei(8, 127), 181417);  // 181417.32...
  assert.equal(sampleBei(0, 127), 0);
});

test('zaehlSoll: 4N count-in clicks before the entry, the running clicks from the entry, all shifted by the output chain', () => {
  const s = zaehlSoll(1000000, 1, 120, 84, 2);
  assert.deepEqual(s, [1000000 - 4 * 24000 + 84, 1000000 - 3 * 24000 + 84, 1000000 - 2 * 24000 + 84, 1000000 - 24000 + 84, 1000000 + 84, 1000000 + 24000 + 84]);
  assert.equal(zaehlSoll(1000000, 4, 120, 0, 0).length, 16);
  assert.equal(zaehlSoll(1000000, 2, 120, 296, 0)[7], 1000000 - 24000 + 296);
});

test('the PDC is part of the shift once: adding it a second time moves every click by that much and the verdict is FEHL', () => {
  const entry = 500000, vorhalt = 84 + 212;   // limiter + PDC (a chain of inserts)
  const x = signal(entry + 40000, zaehlSoll(entry, 1, 120, vorhalt, 1).map((o) => o - 0));
  const orte = klickOrte(x, 0.2);
  assert.equal(urteilKlicks(orte, zaehlSoll(entry, 1, 120, vorhalt, 1), 0).ok, true);
  const doppelt = urteilKlicks(orte, zaehlSoll(entry, 1, 120, vorhalt + 212, 1), 0);
  assert.equal(doppelt.ok, false);
  assert.equal(doppelt.max, -212);
});

test('urteilKlicks with tolerance 0: one sample off is FEHL, a missing click is FEHL', () => {
  const soll = zaehlSoll(100000, 1, 120, 84, 1);
  const genau = klickOrte(signal(160000, soll), 0.2);
  assert.equal(urteilKlicks(genau, soll, 0).ok, true);
  assert.equal(urteilKlicks(genau.map((o, i) => (i === 2 ? o + 1 : o)), soll, 0).ok, false);
  assert.equal(urteilKlicks(genau.slice(1), soll, 0).ok, false);
});

test('klicksVorEinsatz counts exactly the count-in clicks (an extra click or a missing one changes the number)', () => {
  const entry = 200000, vorhalt = 84;
  const soll = zaehlSoll(entry, 2, 120, vorhalt, 3);
  const orte = klickOrte(signal(entry + 90000, soll), 0.2);
  assert.equal(klicksVorEinsatz(orte, entry, vorhalt, 120), 8);
  assert.equal(klicksVorEinsatz(orte.slice(1), entry, vorhalt, 120), 7);
  assert.equal(klicksVorEinsatz([...orte, entry - 40000], entry, vorhalt, 120), 9);
  assert.equal(klicksVorEinsatz([], entry, vorhalt, 120), 0);
});

test('groessterSchritt: a sine has small steps, a jump has the size of the jump; the window limits the search', () => {
  const x = sinus(48000, 440, 0.5);
  const m = groessterSchritt(x, 0, x.length);
  assert.ok(m > 0.027 && m < 0.03, `${m}`);   // 0.5 * 2 pi 440 / 48000 = 0.0288
  const y = Float32Array.from(x); for (let i = 20000; i < y.length; i++) y[i] = -y[i];
  assert.ok(groessterSchritt(y, 19900, 20100) > 0.1);
  assert.ok(groessterSchritt(y, 0, 19990) < 0.03, 'a window before the jump does not see it');
  assert.equal(groessterSchritt(new Float32Array(10), 0, 10), 0);
  assert.equal(groessterSchritt(x, 5, 5), 0);
});

test('urteilNaht: a seam step at most as large as the material passes, a larger one fails', () => {
  assert.equal(urteilNaht(0.05, 0.06).ok, true);
  assert.equal(urteilNaht(0.06, 0.06).ok, true);
  assert.equal(urteilNaht(0.4, 0.06).ok, false);
  assert.equal(urteilNaht(0.4, 0).ok, false);
});

test('shaFenster: bit-equal windows give equal hashes, one changed sample or a shifted window does not', () => {
  const a = sinus(1000, 440, 0.5), b = Float32Array.from(a);
  assert.equal(shaFenster(a, 100, 900), shaFenster(b, 100, 900));
  b[500] += 1e-7;
  assert.notEqual(shaFenster(a, 100, 900), shaFenster(b, 100, 900));
  assert.equal(shaFenster(a, 100, 499), shaFenster(b, 100, 499), 'the change at 500 lies outside this window');
});

test('naechsterTakt: the first bar line strictly after the beat; on a bar line it is the following one', () => {
  assert.equal(naechsterTakt(0.2), 4);
  assert.equal(naechsterTakt(3.99), 4);
  assert.equal(naechsterTakt(4), 8);
  assert.equal(naechsterTakt(5.5), 8);
  assert.equal(naechsterTakt(11.9), 12);
});

test('taktLage and weitVonTaktlinie: positions near a bar line are not used to name the next bar', () => {
  assert.equal(taktLage(9.25), 1.25);
  assert.equal(weitVonTaktlinie(9.25), true);
  assert.equal(weitVonTaktlinie(11.8), false);
  assert.equal(weitVonTaktlinie(12.2), false);
  assert.equal(weitVonTaktlinie(12.6), true);
});

test('istAkzent: the full-level click is the accent, the half-level one is not', () => {
  assert.equal(istAkzent(1.0, 1.0), true);
  assert.equal(istAkzent(0.5, 1.0), false);
  assert.equal(istAkzent(0.4, 0.5), true);
});

test('sinus: starts at 0, has the wanted amplitude and frequency', () => {
  const x = sinus(48000, 1000, 0.5);
  assert.equal(x[0], 0);
  assert.ok(Math.abs(Math.max(...x) - 0.5) < 1e-3);
  let n = 0; for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
  assert.equal(n, 999);   // 1000 periods, the one starting at sample 0 is not an upward crossing inside
});

test('sinus: a phase offset gives a different value at a bar line where the unshifted sines are both 0 (the cut is then a real jump)', () => {
  const a = sinus(100000, 440, 0.5), b = sinus(100000, 1000, 0.5, 1.0), b0 = sinus(100000, 1000, 0.5);
  assert.ok(Math.abs(a[96000]) < 1e-3 && Math.abs(b0[96000]) < 1e-3, 'bar 4 at 120 BPM is a zero crossing of both without a phase offset');
  assert.ok(Math.abs(a[96000] - b[96000]) > 0.3, `${a[96000]} ${b[96000]}`);
});
