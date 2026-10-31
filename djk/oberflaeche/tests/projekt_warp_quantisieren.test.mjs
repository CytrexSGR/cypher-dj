// Slice 4, T11: Quantize Audio als reine Rechnung (D8)
import test from 'node:test';
import assert from 'node:assert/strict';
import { quantisiere } from '../projekt/warp.ts';

const M = [[0, 0], [1.875, 4]];                      // 128 BPM: Beat = 0,46875 s
const zitter = [0.012, -0.015, 0.02, -0.008, 0.0];   // Sekunden, ±20 ms
test('Stärke 1 auf 1/16: jeder Transient landet genau auf seinem 1/16', () => {
  const t = [1, 2, 3].map((k, i) => k * 0.46875 + zitter[i]);
  const m = quantisiere(M, t, 0.25, 1);
  for (const [i, s] of t.entries()) {
    const paar = m.find((x) => Math.abs(x[0] - s) < 1e-9);
    assert.ok(paar, `Marker an Transient ${i}`);
    assert.ok(Math.abs(paar[1] - (i + 1)) < 1e-9, `Beat ${paar[1]} soll ${i + 1}`);
  }
});
test('Stärke 0,5 halbiert den Abstand zum Raster', () => {
  const s = 0.46875 + 0.02, b = s / 0.46875;
  const m = quantisiere(M, [s], 0.25, 0.5);
  const paar = m.find((x) => Math.abs(x[0] - s) < 1e-9);
  assert.ok(Math.abs(paar[1] - (b + 0.5 * (1 - b))) < 1e-9);
});
test('Marker außerhalb des Bereichs bleiben, innen werden ersetzt; streng steigend', () => {
  const m = quantisiere([[0, 0], [0.9, 2], [1.875, 4]], [0.5, 1.4], 0.25, 1, { von_beat: 0.5, bis_beat: 3.5 });
  assert.deepEqual(m[0], [0, 0]); assert.deepEqual(m[m.length - 1], [1.875, 4]);
  assert.ok(!m.some((x) => x[0] === 0.9));
  for (let i = 1; i < m.length; i++) assert.ok(m[i][0] > m[i - 1][0] && m[i][1] > m[i - 1][1]);
});
test('zwei Transienten auf demselben Ziel: der nähere bleibt', () => {
  const m = quantisiere(M, [0.46875 - 0.01, 0.46875 + 0.004], 1, 1);
  assert.equal(m.filter((x) => Math.abs(x[1] - 1) < 1e-9).length, 1);
  assert.ok(m.some((x) => Math.abs(x[0] - (0.46875 + 0.004)) < 1e-9));
});
test('Konflikt mit einem stehenbleibenden Marker: Fehler quantisieren_konflikt statt still verwerfen (D8)', () => {
  // Beat = Sekunde. Transient bei 1,13 -> Ziel 1,25; der stehenbleibende Marker [1,14; 1,14] läge dann hinter ihm im Beat, vor ihm in der Zeit.
  // (Der Plan-Fall [[0,0],[0.47,1.6],[1.875,4]] / [0.3,0.42] / Raster 1 wirft nicht: beide Transienten wollen Ziel 1, der nähere bleibt: [0,0],[0.3,1],[0.47,1.6].)
  assert.throws(() => quantisiere([[0, 0], [1.14, 1.14], [4, 4]], [1.13], 0.25, 1), /quantisieren_konflikt/);
  assert.doesNotThrow(() => quantisiere([[0, 0], [1.14, 1.14], [4, 4]], [1.13], 0.25, 0), 'Negativkontrolle: Stärke 0 lässt die Reihenfolge');
});
test('keine Transienten im Bereich: Fehler keine_transienten', () => {
  assert.throws(() => quantisiere(M, [], 0.25, 1), /keine_transienten/);
});

// ---- Fix-Runde: Raster im Projekt (D13), Ränder, Gleichstand, Reihenfolge ----
const L = [[0, 0], [2, 4]];                           // Beat = 2 · Sekunde, alles exakt in Binärzahlen
test('D13: off verschiebt das Raster: z = round((b + off) / r) · r − off; off = 0 ändert nichts', () => {
  const t = [0.5, 1.0];                               // Beat 1 und 2
  const mit = quantisiere(L, [0.6], 1, 1, { off: 0.1 });       // b = 1,2; im Projekt 1,3 → 1; zurück 0,9
  assert.ok(Math.abs(mit.find((x) => x[0] === 0.6)[1] - 0.9) < 1e-9);
  const ohne = quantisiere(L, [0.6], 1, 1, { off: 0 }), vorgabe = quantisiere(L, [0.6], 1, 1);
  assert.ok(Math.abs(ohne.find((x) => x[0] === 0.6)[1] - 1) < 1e-9);
  assert.deepEqual(vorgabe, ohne, 'Negativkontrolle: off = 0 und fehlendes off sind gleich');
  assert.ok(t.length === 2);
});
test('Ein Treffer vor dem ersten und hinter dem letzten Marker wird mit dem Randtempo quantisiert, wenn der Bereich dorthin reicht', () => {
  const m = quantisiere([[1, 2], [2, 4]], [0.4, 2.6], 1, 1, { von_beat: -1, bis_beat: 8 });   // b = 0,8 und 5,2
  assert.ok(Math.abs(m.find((x) => x[0] === 0.4)[1] - 1) < 1e-9); assert.ok(Math.abs(m.find((x) => x[0] === 2.6)[1] - 5) < 1e-9);
});
test('Ränder des Bereichs sind inklusive', () => {
  const m = quantisiere(L, [0.5, 1.5], 0.25, 0, { von_beat: 1, bis_beat: 3 });            // Grenzen genau bei 0,5 s und 1,5 s
  assert.ok(m.some((x) => x[0] === 0.5) && m.some((x) => x[0] === 1.5));
});
test('Gleichstand auf demselben Ziel: der frühere bleibt (strikt näher gewinnt)', () => {
  const m = quantisiere(L, [0.4375, 0.5625], 1, 1);            // b = 0,875 und 1,125, beide 0,125 vom Ziel 1
  assert.ok(m.some((x) => x[0] === 0.4375) && !m.some((x) => x[0] === 0.5625));
});
test('Reihenfolge der Beats: schon 5e-10 Abstand zum stehenden Marker ist ein Konflikt (Epsilon 1e-9)', () => {
  assert.throws(() => quantisiere([[0, 0], [1.5, 2.0000000005], [3, 4]], [1.4999], 1, 1), /quantisieren_konflikt/);
});
