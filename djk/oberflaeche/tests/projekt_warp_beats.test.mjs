// Paket 1.13 Slice 4, Task 2: beatsEinheiten (rein)
import test from 'node:test';
import assert from 'node:assert/strict';
import { beatsEinheiten, MAX_BEATS_EINHEITEN, BEATS_VORLAUF_S } from '../projekt/warp.ts';

const W = { an: true, modus: 'beats', marker: [[0, 0], [1.92, 4]], versatz_beats: 0, quelle: 'takte', transpose_st: 0, detune_ct: 0 };   // 125 BPM

test('Raster 1/16 über 4 Beats: 16 Einheiten, Quellzeit aus W', () => {
  const e = beatsEinheiten({ ...W, beats: { raster: '1/16', loop: 'aus', huelle: 100 } }, 4, null);
  assert.equal(e.length, 16);
  assert.deepEqual(e[0], [0, 0]);
  assert.ok(Math.abs(e[1][1] - 0.12) < 1e-9 && e[1][0] === 0.25);
});
test('ohne beats gilt die Vorgabe transienten, ohne Transienten 1/16 (D7)', () => {
  assert.equal(beatsEinheiten(W, 4, null).length, 16);
  assert.equal(beatsEinheiten(W, 4, []).length, 16);
});
test('Transienten: eine Einheit am Anfang plus je Transient, Beat über W⁻¹', () => {
  // D12 umgerechnet: Quelle s − 0,003; 125 BPM = 4/1,92 Beats je Sekunde, also 0,477 → 0,99375, 0,957 → 1,99375, 1,497 → 3,11875 (vorher 1, 2, 3,125)
  const e = beatsEinheiten(W, 4, [0.48, 0.96, 1.5]);
  nah(e.map((x) => x[0]), [0, 0.99375, 1.99375, 3.11875]);
  nah(e.map((x) => x[1]), [0, 0.477, 0.957, 1.497]);
});
test('Transient genau am Anfang ergibt keine doppelte Einheit', () => {
  nah(beatsEinheiten(W, 4, [0, 0.96]).map((x) => x[0]), [0, 1.99375]);      // D12: 0,957 s → 1,99375 (vorher 2)
});
test('versatz und Länge bestimmen den Bereich; vor der Quelle keine Einheit', () => {
  const e = beatsEinheiten({ ...W, versatz_beats: -1, beats: { raster: '1/4', loop: 'aus', huelle: 100 } }, 6, null);
  assert.deepEqual(e.map((x) => x[0]), [0, 1, 2, 3, 4]);        // Beat -1 läge vor Quellsekunde 0
});
test('zu viele Einheiten: Liste hört bei MAX + 1 auf, wirft nicht (D9; die Ablehnung macht uebersetze)', () => {
  const e = beatsEinheiten({ ...W, beats: { raster: '1/32', loop: 'aus', huelle: 100 } }, (MAX_BEATS_EINHEITEN + 80) / 8, null);
  assert.equal(e.length, MAX_BEATS_EINHEITEN + 1);
});

// --- Fix nach Review (T1 bis T3) ---
import { beatsEinheitenZahl } from '../projekt/warp.ts';
const nah = (ist, soll) => { assert.equal(ist.length, soll.length, JSON.stringify(ist)); soll.forEach((x, i) => assert.ok(Math.abs(ist[i] - x) < 1e-9, `[${i}] ${ist[i]} statt ${x}`)); };
const B = (raster, extra = {}) => ({ ...W, ...extra, beats: { raster, loop: 'aus', huelle: 100 } });

test('Review 3: Raster-Zweig hält die Grenze MAX + 1 auch bei versatz neben dem Raster (heute 32770, soll 32769)', () => {
  assert.equal(beatsEinheiten(B('1/32', { versatz_beats: 0.1 }), 5000, null).length, MAX_BEATS_EINHEITEN + 1);
});
test('Review 3: Transienten werden als Kopie aufsteigend sortiert, der Aufrufer-Array bleibt', () => {
  const t = [1.5, 0.48, 0.96];
  nah(beatsEinheiten(W, 4, t).map((x) => x[1]), [0, 0.477, 0.957, 1.497]);      // D12: je 3 ms früher (vorher 0,48, 0,96, 1,5)
  assert.deepEqual(t, [1.5, 0.48, 0.96]);
});
test('Mutation unshift: versatz nicht auf dem Raster ergibt eine Einheit am Anfang', () => {
  const e = beatsEinheiten(B('1/8', { versatz_beats: 0.1 }), 1, null);
  assert.deepEqual(e.map((x) => x[0]), [0.1, 0.5, 1]);
});
test('Mutation 1/8: Wert 0,5 gemessen', () => {
  assert.deepEqual(beatsEinheiten(B('1/8'), 2, null).map((x) => x[0]), [0, 0.5, 1, 1.5]);
  assert.deepEqual(beatsEinheiten(B('1/4'), 2, null).map((x) => x[0]), [0, 1]);
  assert.deepEqual(beatsEinheiten(B('1/32'), 0.5, null).map((x) => x[0]), [0, 0.125, 0.25, 0.375]);
});
test('Mutation beat >= bis: ein Transient hinter dem Ende ergibt keine Einheit', () => {
  const e = beatsEinheiten(B('transienten'), 4, [0.48, 5.0]);
  nah(e.map((x) => x[0]), [0, 0.99375]);                                  // D12: 0,477 s → 0,99375 (vorher 1)
});
test('Review 4: beatsEinheitenZahl stimmt mit beatsEinheiten(...).length überein', () => {
  const faelle = [];
  for (const raster of ['1/4', '1/8', '1/16', '1/32', 'transienten']) {
    for (const versatz of [0, 0.1, -1, 0.03125, 0.3333333333, 7.0000000001]) {
      for (const laenge of [0, 0.01, 1, 4, 5.3, 100.7, 4096, 4096.125, 4096.1, 4095.9, 4200]) faelle.push([raster, versatz, laenge]);
    }
  }
  for (const [raster, versatz, laenge] of faelle) {
    const w = B(raster, { versatz_beats: versatz });
    assert.equal(beatsEinheitenZahl(w, laenge, null), beatsEinheiten(w, laenge, null).length, `${raster} versatz ${versatz} laenge ${laenge}`);
  }
  const w = B('transienten');
  assert.equal(beatsEinheitenZahl(w, 4, [0.96, 0.48]), beatsEinheiten(w, 4, [0.96, 0.48]).length);
});

// ---- Fix-Runde Slice 4, Punkt 2 (Entscheidung D12): Vorlauf der Transienten-Einheiten ----
// Gemessen an echten Loops: der Detektor-Treffer liegt im Median am Fuß des Anschlags, im p90 aber 1,6 bis 4,2 ms dahinter. BEATS beginnt darum 3 ms früher.
test('D12: BEATS_VORLAUF_S ist 3 ms', () => { assert.equal(BEATS_VORLAUF_S, 0.003); });
test('D12: jede Transienten-Einheit (außer der am Anfang) beginnt 3 ms früher, Beat über W⁻¹ der früheren Quellsekunde', () => {
  const e = beatsEinheiten(W, 4, [0.48, 0.96, 1.5]);
  assert.equal(e.length, 4);
  assert.deepEqual(e[0], [0, 0], 'die Anfangs-Einheit bleibt');
  [0.48, 0.96, 1.5].forEach((t, k) => {
    assert.ok(Math.abs(e[k + 1][1] - (t - 0.003)) < 1e-12, `Quelle ${e[k + 1][1]} statt ${t - 0.003}`);
    assert.ok(Math.abs(e[k + 1][0] - (t - 0.003) * 4 / 1.92) < 1e-12, `Beat ${e[k + 1][0]} statt ${(t - 0.003) * 4 / 1.92}`);   // 125 BPM: 2,0833 Beats je Sekunde
  });
});
test('D12: der Vorlauf reicht nie vor die vorige Einheit: bei kleinerem Abstand als 6 ms nur die Hälfte, die Beats bleiben streng steigend', () => {
  const e = beatsEinheiten(W, 4, [0.48, 0.484, 0.5]);
  assert.deepEqual(e.map((x) => x[1].toFixed(4)), ['0.0000', '0.4770', '0.4820', '0.4970'], 'zweiter: 4 ms nach dem ersten Treffer, Hälfte = 2 ms; dritter: volle 3 ms');
  for (let i = 1; i < e.length; i++) assert.ok(e[i][0] > e[i - 1][0], `Beat ${i} steigt`);
});
test('D12: der Vorlauf reicht nie vor den Anfang des Bereichs', () => {
  const e = beatsEinheiten(W, 4, [0.001, 0.5]);
  assert.ok(e[1][1] >= 0 && e[1][1] > e[0][1], `erste Transienten-Einheit bei ${e[1][1]} s`);
  assert.ok(Math.abs(e[1][1] - 0.0005) < 1e-12, 'Hälfte des Abstands zum Anfang');
  const v = beatsEinheiten({ ...W, versatz_beats: 1 }, 3, [0.481, 0.96]);     // Bereich beginnt bei Beat 1 = Quellsekunde 0,48
  assert.ok(v[0][1] === 0.48 || Math.abs(v[0][1] - 0.48) < 1e-12);
  assert.ok(v[1][1] >= 0.48 && v[1][1] < 0.481, `Quelle ${v[1][1]}: nicht vor dem Bereichsanfang`);
  assert.ok(Math.abs(v[2][1] - 0.957) < 1e-12);
});
test('D12: ohne Transienten (Raster) und bei den Rasterbeats gibt es keinen Vorlauf', () => {
  assert.deepEqual(beatsEinheiten(W, 1, null).map((x) => x[0]), [0, 0.25, 0.5, 0.75]);
  assert.deepEqual(beatsEinheiten(B('1/4'), 2, [0.5]).map((x) => x[0]), [0, 1]);
});
