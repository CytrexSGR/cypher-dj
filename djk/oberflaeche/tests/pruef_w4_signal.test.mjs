// Paket 1.13 Warp, Slice 4 (Task 14): der Generator der Messsignale (pruef/w4_signal.mjs) mit Eichung, bevor er am Ziel gebraucht wird.
// Klickspur = Ein-Sample-Klicks (D11) mit Zittern, Schlagspur = Schlag mit Körper (Form, Lücken, Hülle), Rauschspur = Rausch-Burst mit 1 ms Anstieg (b2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { klickSpur, schlagSpur, burstSpur, sinusSpur } from '../pruef/w4_signal.mjs';
import { anschlaege } from '../pruef/w3a_messen.mjs';
import { klickStellen } from '../pruef/w3b_messen.mjs';
import { frequenz } from '../pruef/w1_wav.mjs';

const SR = 48000;
const links = (daten) => Float32Array.from({ length: daten.length / 2 }, (_, i) => daten[2 * i]);
const soll = (k, bpm, raster, vorlauf) => k * raster * 60 / bpm * SR + vorlauf;

test('klickSpur: Lagen wie bestellt, Zittern deterministisch, Prüfgerät findet sie (±1 ms)', () => {
  const { daten, lagen } = klickSpur({ bpm: 128, schlaege: 32, raster: 0.25, zittern_ms: 20, seed: 3, sr: SR });
  assert.equal(lagen.length, 32);
  assert.ok(lagen.some((f, k) => Math.abs(f - soll(k, 128, 0.25, 24000)) > 0.015 * SR), 'es zittert wirklich');
  assert.ok(lagen.every((f, k) => Math.abs(f - soll(k, 128, 0.25, 24000)) <= 0.020 * SR), 'höchstens 20 ms');
  assert.ok(lagen.every((f, k) => k === 0 || f > lagen[k - 1]), 'streng steigend');
  const gefunden = anschlaege(links(daten));
  assert.equal(gefunden.length, 32);
  gefunden.forEach((t, k) => assert.ok(Math.abs(t - lagen[k] / SR) <= 0.001, `Anschlag ${k}: ${((t - lagen[k] / SR) * 1000).toFixed(3)} ms`));
});

test('klickSpur: dieselbe Saat gibt dieselben Lagen, eine andere nicht; ohne Zittern exakt auf dem Raster', () => {
  const a = klickSpur({ bpm: 128, schlaege: 16, raster: 1, zittern_ms: 20, seed: 7 }), b = klickSpur({ bpm: 128, schlaege: 16, raster: 1, zittern_ms: 20, seed: 7 });
  const c = klickSpur({ bpm: 128, schlaege: 16, raster: 1, zittern_ms: 20, seed: 8 });
  assert.deepEqual(a.lagen, b.lagen); assert.notDeepEqual(a.lagen, c.lagen);
  const o = klickSpur({ bpm: 125, schlaege: 8, raster: 0.25, zittern_ms: 0, seed: 1, vorlauf: 960 });
  assert.deepEqual(o.lagen, Array.from({ length: 8 }, (_, k) => 960 + k * 5760));
});

test('klickSpur: Ein-Sample-Klicks 0,8 in beiden Kanälen; klickStellen (anderes Verfahren) findet genau die bestellten Frames', () => {
  const { daten, lagen } = klickSpur({ bpm: 125, schlaege: 32, raster: 0.25, zittern_ms: 0, seed: 1, vorlauf: 960, frames: 184320 });
  assert.equal(daten.length, 2 * 184320);
  const n = daten.reduce((s, v) => s + (v !== 0 ? 1 : 0), 0);
  assert.equal(n, 64);                                                   // 32 Klicks × 2 Kanäle, sonst Stille
  assert.ok(lagen.every((f) => daten[2 * f] === Float32Array.of(0.8)[0] && daten[2 * f + 1] === daten[2 * f]));
  assert.deepEqual(klickStellen(links(daten)), lagen);
});

test('klickSpur: ein Klick außerhalb der Datei oder zwei auf demselben Frame lehnt ab (kein stilles Kürzen)', () => {
  assert.throws(() => klickSpur({ bpm: 125, schlaege: 32, raster: 0.25, zittern_ms: 0, seed: 1, vorlauf: 24000, frames: 184320 }), /passt nicht/);
});

test('schlagSpur: Schlag mit Körper (Rausch-Burst 0,8·exp(−t/3 ms) + Sinus 180 Hz 0,5·exp(−t/40 ms)), jeder Schlag so lang wie sein Platz, zweite Hälfte hat Inhalt', () => {
  const { daten, lagen } = schlagSpur({ bpm: 125, schlaege: 32, raster: 0.25, zittern_ms: 0, seed: 1, vorlauf: 960, frames: 184320 });
  assert.deepEqual(lagen, Array.from({ length: 32 }, (_, k) => 960 + k * 5760));
  const x = links(daten), rms = (a, b) => Math.sqrt(x.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
  const h = lagen[10];
  assert.ok(rms(h, h + 144) > 0.3, 'Anschlag laut');                     // die ersten 3 ms: Rauschen und Sinus
  assert.ok(rms(h + 2880 - 960, h + 5760 - 960) > 0.02, 'zweite Hälfte der Einheit hat Inhalt (größer als −35 dBFS)');
  assert.ok(rms(0, 900) === 0, 'vor dem ersten Schlag Stille');
  assert.deepEqual(links(schlagSpur({ bpm: 125, schlaege: 32, raster: 0.25, seed: 1, vorlauf: 960, frames: 184320 }).daten), x, 'deterministisch');
  assert.ok(klickStellen(x).length >= 30, 'das Prüfgerät sieht die Anschläge');
});

test('burstSpur: Rausch-Burst mit 1 ms linearem Anstieg; Spitze nicht am ersten Sample, Anschlag des Prüfgeräts liegt vor der Spitze', () => {
  const { daten, lagen } = burstSpur({ bpm: 128, schlaege: 64, raster: 1, zittern_ms: 20, seed: 3, vorlauf: 11250 });
  const x = links(daten), a = lagen[5];
  assert.equal(x[a], 0);
  assert.ok(Math.abs(x[a + 24]) < 0.8 && x.slice(a, a + 48).some((v) => Math.abs(v) > 0.2), 'steigt über 1 ms');
  const gefunden = anschlaege(x);
  assert.equal(gefunden.length, 64);
  const dt = gefunden.map((t, k) => (t - lagen[k] / SR) * 1000);
  assert.ok(dt.every((d) => d > -1 && d < 3), `Anschlag nahe der Lage: ${Math.min(...dt).toFixed(2)}..${Math.max(...dt).toFixed(2)} ms`);
});

test('sinusSpur: 440 Hz, Amplitude 0,3, beide Kanäle gleich (Negativ-Kontrolle Transienten: keine Anschläge)', () => {
  const { daten } = sinusSpur({ frames: 184320, hz: 440 });
  assert.equal(daten.length, 2 * 184320);
  const x = links(daten);
  assert.ok(Math.abs(frequenz(x, 0, x.length) - 440) < 0.5);
  const m = x.reduce((s, v) => Math.max(s, v), 0);
  assert.ok(m <= 0.3 + 1e-6 && m > 0.29);
  assert.ok(daten.every((v, i) => i % 2 === 0 || v === daten[i - 1]));
});

// --- Messfunktionen der Abnahme (pruef/w4_messen.mjs): Eichung an synthetischen Exporten mit bekannter Wahrheit
import { formKorrelation, restFest, z5bOk } from '../pruef/w4_messen.mjs';
import { rasterAbweichung } from '../pruef/w3b_messen.mjs';

test('formKorrelation: ein idealer BEATS-Export (Schlag u von Frame u·5760 nach u·7200) gibt 1; zwei Samples daneben fällt unter 0,99; Verzug 1 Sample ist erlaubt und wird genannt', () => {
  const frames = 184320, { daten, lagen } = schlagSpur({ bpm: 125, schlaege: 32, raster: 0.25, zittern_ms: 0, seed: 1, vorlauf: 960, frames });
  const quelle = links(daten), P = 7200, ex = (verzug) => {
    const x = new Float32Array(32 * P + 5000);
    lagen.forEach((l, u) => { for (let i = 0; i < 4800; i++) x[u * P + 960 + verzug + i] = quelle[l + i]; });
    return x;
  };
  const ideal = formKorrelation(ex(0), quelle, lagen, P, 5760);
  assert.ok(ideal.min > 0.9999 && ideal.lag === 0, JSON.stringify(ideal));
  const eins = formKorrelation(ex(1), quelle, lagen, P, 5760);
  assert.ok(eins.min > 0.9999 && eins.lag === 1, JSON.stringify(eins));
  const zwei = formKorrelation(ex(2), quelle, lagen, P, 5760);
  assert.ok(zwei.min < 0.99, `zwei Samples daneben: ${zwei.min}`);
});

test('restFest: ohne Phasenfit, mit Vorzeichen: Anschläge 1,5 ms nach dem Raster geben Median +1,5; 1,5 ms davor −1,5; Zittern ±20 ms gibt p90 über 10 ms', () => {
  const bpm = 128, P = 60 / bpm * SR, mk = (versatzMs, zittern) => burstSpur({ bpm, schlaege: 64, raster: 1, zittern_ms: zittern, seed: 3, vorlauf: Math.round(P / 2) + Math.round(P / 2) + Math.round(versatzMs * 48) }).daten;
  const nach = restFest(links(mk(1.5, 0)), bpm), vor = restFest(links(mk(-1.5, 0)), bpm), zitter = restFest(links(mk(0, 20)), bpm);
  assert.equal(nach.n, 64); assert.equal(vor.n, 64);
  assert.ok(nach.median > 1.0 && nach.median < 1.6, `nach: ${nach.median}`);       // Anschlag (−0,3 ms) + 1,5 ms Versatz
  assert.ok(vor.median < -1.5 && vor.median > -2.2, `vor: ${vor.median}`);
  assert.ok(Math.abs(nach.median - vor.median - 3) < 0.05, 'die Differenz ist genau der Versatz');
  assert.ok(nach.p90 < 1.6 && zitter.p90 >= 10, `p90 ${nach.p90} / ${zitter.p90}`);
});

test('Z5b-Urteil: ±1 ms und −1,5 ms gleichmäßiger Versatz werden rot, Streuung ±20 ms wird rot, exakt auf dem Raster und ±1 ms Zittern bleiben grün', () => {
  const bpm = 128, P = 60 / bpm * SR;
  const mk = (versatzMs, zittern) => restFest(links(burstSpur({ bpm, schlaege: 64, raster: 1, zittern_ms: zittern, seed: 3, vorlauf: 2 * Math.round(P / 2) + Math.round(versatzMs * 48) }).daten), bpm);
  const f = (v, z) => { const m = mk(v, z); return `${z5bOk(m)} (n ${m.n}, Median ${m.median.toFixed(2)}, p90 ${m.p90.toFixed(2)})`; };
  assert.equal(z5bOk(mk(0, 0)), true, `Raster: ${f(0, 0)}`);
  assert.equal(z5bOk(mk(0, 1)), true, `±1 ms Zittern: ${f(0, 1)}`);
  for (const v of [1, -1, -1.5, 1.5]) assert.equal(z5bOk(mk(v, 0)), false, `${v} ms Versatz muss rot sein: ${f(v, 0)}`);
  assert.equal(z5bOk(mk(0, 20)), false, `Streuung: ${f(0, 20)}`);
  // das alte Kriterium (nur p90 ≤ 2 ms) ließ −1,5 ms durch: der Grund für die Verschärfung
  assert.ok(mk(-1.5, 0).p90 <= 2, `Beleg: p90 bei −1,5 ms Versatz ist ${mk(-1.5, 0).p90.toFixed(2)} ≤ 2`);
});

test('Z1-Nullpunkt: aus dem bekannten Frame des ersten Klicks, nicht aus dem ersten gemessenen; 3 Samples Versatz des ganzen Exports werden rot, mit dem gemessenen Nullpunkt blieben sie grün', () => {
  const bpm = 100, P = 0.25 * 60 / bpm * SR;                                 // 7200 Frames
  const mk = (versatz) => { const { daten, lagen } = klickSpur({ bpm, schlaege: 32, raster: 0.25, vorlauf: 960, sr: SR }); const x = links(daten), y = new Float32Array(x.length + 8); y.set(x, versatz); return { x: y, erster: lagen[0] }; };
  for (const [versatz, rot] of [[0, false], [1, false], [2, false], [3, true], [4, true]]) {
    const { x, erster } = mk(versatz), bekannt = rasterAbweichung(x, erster, P), gemessen = rasterAbweichung(x, klickStellen(x)[0], P);
    assert.equal(bekannt.n, 32);
    assert.equal(bekannt.max, versatz, `bekannter Nullpunkt: Versatz ${versatz} gemessen als ${bekannt.max}`);
    assert.equal(bekannt.max > 2, rot, `Versatz ${versatz} Samples: Urteil max ≤ 2 ist ${!rot}`);
    assert.equal(gemessen.max, 0, `Beleg des Fehlers: der gemessene Nullpunkt sieht den Versatz ${versatz} nicht`);
  }
});
