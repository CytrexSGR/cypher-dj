// Calibration of check/ak33_m2_measure.mjs (AK33 M2): the instrument is checked against signals with known answers before it judges the core.
import test from 'node:test';
import assert from 'node:assert/strict';
import { klickSignal, tonSignal, klickLagen, klickFuesse, beatBeiQuelle, dehnung, erwarteteLagen, abweichungen, nahtMass, sprungMass, median, klickUrteil, GRENZE } from '../check/ak33_m2_measure.mjs';

const links = (x) => Float32Array.from({ length: x.length / 2 }, (_, i) => x[2 * i]);
const klick = links(klickSignal()), ton = links(tonSignal()), sprung = links(tonSignal(10.05));

test('klickLagen: 63 bursts, each centre of energy on source sample 24000 * k to within 0.01 sample', () => {
  const l = klickLagen(klick);
  assert.equal(l.length, 63);
  const d = abweichungen(l, Array.from({ length: 63 }, (_, j) => 24000 * (j + 1)));
  assert.ok(d.max < 0.01, String(d.max));
});

test('klickLagen follows a shift: the same bursts moved by 7 samples read 7 samples later (the instrument sees what it must see)', () => {
  const x = new Float32Array(klick.length + 7); x.set(klick, 7);
  const d = abweichungen(klickLagen(x), Array.from({ length: 63 }, (_, j) => 24000 * (j + 1)));
  assert.ok(Math.abs(d.d[10] - 7) < 0.01 && Math.abs(d.max - 7) < 0.01, JSON.stringify(d.d.slice(0, 3)));
});

test('klickFuesse: the onset foot sits before the centre (about 56 samples at 20 %), moves with a shift, and a missing click changes the count', () => {
  const f = klickFuesse(klick);
  assert.equal(f.length, 63);
  const off = median(f.map((v, j) => v - 24000 * (j + 1)));
  assert.ok(off < -40 && off > -72, String(off));
  const x = new Float32Array(klick.length + 5); x.set(klick, 5);
  assert.ok(Math.abs(median(klickFuesse(x).map((v, j) => v - 24000 * (j + 1))) - off - 5) < 1);
  const ohne = Float32Array.from(klick); ohne.fill(0, 24000 * 30 - 200, 24000 * 30 + 200);
  assert.equal(klickLagen(ohne).length, 62);
});

test('beatBeiQuelle, dehnung, erwarteteLagen: grid markers give clicks exactly on the project grid, a dragged marker moves the clicks by the map', () => {
  const gitter = [[0, 0], [10, 20], [32, 64]];
  assert.equal(beatBeiQuelle(gitter, 7.5), 15);
  assert.ok(Math.abs(dehnung(gitter, 5, 128) - 120 / 128) < 1e-12);
  const e = erwarteteLagen(gitter, 8, 22500);
  assert.equal(e[0], 9 * 22500); assert.equal(e[62], 71 * 22500);
  const gezogen = [[0, 0], [10.05, 20], [32, 64]];
  const e2 = erwarteteLagen(gezogen, 8, 22500);
  assert.ok(Math.abs(e2[19] - (8 + 20 * 10 / 10.05) * 22500) < 1, String(e2[19]));   // click 20 at source 10.0: beat 20 * 10 / 10.05
  assert.ok(Math.abs(e2[62] - 71 * 22500) < 60);                                         // the last click moves only by 0.0023 beat (52 samples): the second segment is 0.2 % faster
  assert.ok(abweichungen(e2, e).max > 2000, 'the dragged map differs from the grid by more than 2000 samples (negative control of NK2)');
});

test('nahtMass: a steady tone has a residual below -80 dB, a phase flip makes it exceed -10 dB; the frequency search finds 470 Hz when the nominal is 466', () => {
  const w = nahtMass(ton, 400000, 410000, { fNenn: 440, spanne: 4 });
  assert.ok(Math.max(...w.map((o) => o.db)) < -80, String(Math.max(...w.map((o) => o.db))));
  const s = nahtMass(sprung, 482000, 483500, { fNenn: 440, spanne: 4 });
  assert.ok(Math.max(...s.map((o) => o.db)) > -10);
  const t470 = Float32Array.from({ length: 20000 }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 470 * i / 48000));
  const f = nahtMass(t470, 0, 10000, { fNenn: 466, spanne: 8 });
  assert.ok(f.every((o) => Math.abs(o.f - 470) <= 0.5 && o.db < -80), JSON.stringify(f[0]));
});

test('sprungMass: no step in a steady tone (ratio 1), a phase flip near a crest steps more than 15 times the reference; a frequency change of 0.5 % does not', () => {
  assert.ok(Math.abs(sprungMass(ton, 630000).verhaeltnis - 1) < 0.01);
  const s = sprungMass(sprung, 482427 - 25);
  assert.ok(s.verhaeltnis > 15, String(s.verhaeltnis));
  let ph = 0;   // continuous phase: only the frequency changes, the waveform does not step
  const zwei = Float32Array.from({ length: 300000 }, (_, i) => { ph += 2 * Math.PI * (i < 150000 ? 469.3 : 471.7) / 48000; return 0.3 * Math.sin(ph); });
  assert.ok(sprungMass(zwei, 150000).verhaeltnis < 1.1);
});

// G3 (review F5): the K2 verdict must be able to FAIL. A signal whose 63 clicks sit exactly where the dragged map puts them is judged against (a) that map and (b) the same map
// shifted by 30 samples (an engine that placed the clicks 30 samples off); the limit of COMPLEX and TONES is 24 samples (D6), RE-PITCH 1.5.
const klickAn = (positionen) => {
  const x = new Float32Array(40 * 48000);   // 63 clicks up to beat 72 = 33.75 s
  for (const c of positionen) for (let n = -72; n <= 72; n++) x[c + n] = 0.8 * 0.5 * (1 + Math.cos(Math.PI * n / 73)) * Math.cos(2 * Math.PI * 1000 * n / 48000);
  return x;
};
const gezogen = [[0, 0], [10.05, 20], [32, 64]];
const verschoben = (m, samples) => m.map(([s, b]) => [s, b + samples / 22500]);     // every beat of the map later by `samples` (22500 frames per beat at 128 BPM)

test('K2 verdict: clicks exactly on the dragged map pass every limit (control), the same clicks against a map shifted by 30 samples fail COMPLEX/TONES (24) and RE-PITCH (1.5), 20 samples fail only RE-PITCH', () => {
  const soll = erwarteteLagen(gezogen, 8, 22500);
  const lagen = klickLagen(klickAn(soll.map((v) => Math.round(v))));
  assert.equal(lagen.length, 63);
  for (const g of Object.values(GRENZE)) assert.ok(klickUrteil(abweichungen(lagen, soll), g), `control must pass the limit ${g}`);
  const d30 = abweichungen(lagen, erwarteteLagen(verschoben(gezogen, 30), 8, 22500));
  assert.ok(Math.abs(d30.max - 30) < 1, `a map 30 samples off reads ${d30.max}`);
  assert.equal(klickUrteil(d30, GRENZE.complex), false); assert.equal(klickUrteil(d30, GRENZE.tones), false); assert.equal(klickUrteil(d30, GRENZE.repitch), false);
  const d20 = abweichungen(lagen, erwarteteLagen(verschoben(gezogen, 20), 8, 22500));
  assert.equal(klickUrteil(d20, GRENZE.complex), true); assert.equal(klickUrteil(d20, GRENZE.repitch), false);
});

test('K2 verdict: a missing click and a doubled click each fail whatever the positions (the count is part of the verdict)', () => {
  const soll = erwarteteLagen(gezogen, 8, 22500), pos = soll.map((v) => Math.round(v));
  const eins_fehlt = abweichungen(klickLagen(klickAn(pos.filter((_, i) => i !== 30))), soll);
  assert.notEqual(eins_fehlt.n, 63, 'the missing click must show in the count');
  assert.equal(klickUrteil(eins_fehlt, GRENZE.complex), false);
  const doppelt = abweichungen(klickLagen(klickAn([...pos, pos[30] + 11000].sort((a, b) => a - b))), soll);
  assert.notEqual(doppelt.n, 63, 'the extra click must show in the count');
  assert.equal(klickUrteil(doppelt, GRENZE.complex), false);
  assert.equal(klickUrteil(abweichungen(klickLagen(klickAn(pos)), soll), GRENZE.complex), true, 'control: all 63 clicks pass');
  // Known limit of the instrument, pinned so it cannot be forgotten: clicks closer than 10000 frames (208 ms) merge into one detection, so an extra click 3000 frames after a real one is NOT counted.
  // M2 measures where the clicks sit, not flams inside 208 ms.
  assert.equal(klickLagen(klickAn([...pos, pos[30] + 3000].sort((a, b) => a - b))).length, 63);
});
