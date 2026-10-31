// Paket 1.13 Warp, Slice 3b: das Messgerät von AK22 (pruef/w3b_messen.mjs) mit Eichung und Negativ-Kontrollen, bevor es am Ziel misst.
import test from 'node:test';
import assert from 'node:assert/strict';
import { abweichungAusserhalb, klickStellen, klickVersatz, rasterAbweichung } from '../pruef/w3b_messen.mjs';

const N = 200_000, PERIODE = 22_500;
function klickSpur(versatz = 0, hoehe = 0.9) {
  const x = new Float32Array(N);
  for (let k = 0; k * PERIODE + 100 + versatz < N; k++) for (let j = 0; j < 20; j++) x[k * PERIODE + 100 + versatz + j] = hoehe * Math.sin(Math.PI * j / 20);
  return x;
}

test('abweichungAusserhalb: gleich → 0; eine Abweichung im Fenster zählt nicht, eine knapp außerhalb zählt; andere Länge → nicht gleich', () => {
  const a = klickSpur(), b = Float32Array.from(a);
  assert.deepEqual(abweichungAusserhalb(a, b, 100_000, 96), { laenge_gleich: true, n: 0, max: 0, erst: -1 });
  b[100_000 + 96] += 0.5;                                        // genau am Rand des Fensters: noch drin
  assert.equal(abweichungAusserhalb(a, b, 100_000, 96).n, 0);
  b[100_000 + 97] += 0.25;                                       // ein Sample weiter: draußen
  const r = abweichungAusserhalb(a, b, 100_000, 96);
  assert.deepEqual([r.n, r.max, r.erst], [1, 0.25, 100_097]);
  assert.equal(abweichungAusserhalb(a, a.subarray(1), 100_000, 96).laenge_gleich, false);
});

test('klickVersatz: 8 Samples Verschiebung → 8; 30 Samples → 30 (über der Grenze 16, die Negativ-Kontrolle reißt); ein fehlender Klick → nicht gleich', () => {
  const a = klickSpur();
  assert.equal(klickStellen(a).length, 9);
  assert.equal(klickVersatz(a, klickSpur(0)).max, 0, 'Eichung: dasselbe Signal gibt 0');
  assert.equal(klickVersatz(a, klickSpur(8)).max, 8);
  assert.ok(klickVersatz(a, klickSpur(30)).max > 16, 'Negativ-Kontrolle: 30 Samples werden als zu viel erkannt');
  const ohne = klickSpur(); ohne.fill(0, 2 * PERIODE, 3 * PERIODE);
  assert.equal(klickVersatz(a, ohne).gleich, false);
  assert.equal(klickVersatz(new Float32Array(1000), new Float32Array(1000)).gleich, false, 'Stille hat keine Klicks');
});

test('rasterAbweichung: Klicks auf dem Raster → 0; einzelner Klick 12 daneben → 12; Teil um 0,05 Beat (1125 Samples) versetzt → weit über 16', () => {
  const a = klickSpur(), null0 = klickStellen(a)[0];
  assert.equal(rasterAbweichung(a, null0, PERIODE).max, 0, 'Eichung');
  const b = klickSpur(); b.fill(0, 4 * PERIODE, 5 * PERIODE);
  for (let j = 0; j < 20; j++) b[4 * PERIODE + 100 + 12 + j] = 0.9 * Math.sin(Math.PI * j / 20);
  assert.equal(rasterAbweichung(b, null0, PERIODE).max, 12);
  const c = klickSpur(); c.fill(0, 4 * PERIODE);
  for (let k = 4; k * PERIODE + 1225 + 20 < N; k++) for (let j = 0; j < 20; j++) c[k * PERIODE + 1225 + j] = 0.9 * Math.sin(Math.PI * j / 20);
  assert.ok(rasterAbweichung(c, null0, PERIODE).max > 16, 'Negativ-Kontrolle');
  assert.equal(rasterAbweichung(new Float32Array(1000), 0, PERIODE).max, Infinity, 'Stille');
});
