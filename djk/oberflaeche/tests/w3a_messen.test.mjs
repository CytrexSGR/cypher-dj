// Das Messgerät zuerst messen (Messen vor Behaupten): ein Klick-Track mit bekannter Wahrheit. Starres Raster → Rest ~ 0; Jitter ±3 ms → Rest in der Größe des Jitters;
// langsam laufende Drift (konstantes Tempo gegen driftende Quelle) → groß; zu wenig Signal → n 0 (kein stiller Erfolg).
import test from 'node:test';
import assert from 'node:assert/strict';
import { anschlaege, rasterRest, messe } from '../pruef/w3a_messen.mjs';

const SR = 48000;
function klickTrack(zeiten, dauer) {   // wie b_timemap.py klicktrack: 60 ms 1 kHz, 2 ms Anstieg, Abfall e^(−t/30 ms), Spitze 0,7
  const x = new Float32Array(Math.floor(dauer * SR)), L = Math.floor(0.06 * SR);
  for (const s of zeiten) {
    const a = Math.round(s * SR);
    for (let i = 0; i < L && a + i < x.length; i++) { const t = i / SR; x[a + i] += 0.7 * Math.sin(2 * Math.PI * 1000 * t) * Math.min(1, t / 0.002) * Math.exp(-t / 0.03); }
  }
  return x;
}
const P = 60 / 128;
test('starres Raster: alle 100 Einsätze, p90 unter 0,1 ms', () => {
  const m = messe(klickTrack(Array.from({ length: 100 }, (_, k) => 0.25 + k * P), 100 * P + 1), 128);
  assert.equal(m.n, 100); assert.ok(m.p90 < 0.1, `p90 ${m.p90}`);
});
test('Gegenprobe: Jitter ±3 ms und eine Drift von 40 ms über 60 Beats werden gesehen (p90 über 1 ms bzw. über 5 ms)', () => {
  let z = 12345;
  const zufall = () => { z = (z * 1664525 + 1013904223) >>> 0; return z / 2 ** 32; };
  const jitter = Array.from({ length: 100 }, (_, k) => 0.25 + k * P + (zufall() * 2 - 1) * 0.003);
  const mj = messe(klickTrack(jitter, 100 * P + 1), 128);
  assert.equal(mj.n, 100); assert.ok(mj.p90 > 1.0 && mj.p90 < 4.0, `Jitter: p90 ${mj.p90}`);
  const drift = Array.from({ length: 60 }, (_, k) => 0.25 + k * P + 0.04 * Math.sin(Math.PI * k / 59));
  const md = messe(klickTrack(drift, 60 * P + 1), 128);
  assert.ok(md.p90 > 5.0, `Drift: p90 ${md.p90}`);
});
test('kein Signal: keine Einsätze, p90 unendlich (kein stiller Erfolg); rasterRest ist phasenfrei (Verschiebung um 7 ms ändert den Rest nicht)', () => {
  assert.equal(messe(new Float32Array(SR), 128).n, 0);
  const t = Array.from({ length: 50 }, (_, k) => 1 + k * P), r0 = rasterRest(t, P), r1 = rasterRest(t.map((x) => x + 0.007), P);
  assert.ok(Math.max(...r0.map(Math.abs)) < 1e-6 && Math.max(...r1.map(Math.abs)) < 1e-6);
});
