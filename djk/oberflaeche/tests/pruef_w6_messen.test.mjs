// Eichung der Rechnung von pruef/abnahme_w6.mjs (pruef/w6_messen.mjs) an synthetischen Daten:
// jede Prüfung besteht auf Gutem, jede Negativ-Kontrolle schlägt an.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stemWarp } from '../projekt/stems.ts';
import { quellSekunde } from '../projekt/warp.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SR, lageMax, f0Von, z3Ok, nk3Ok, anschlagMessung, vergleichAusEinsaetzen, z4aOk, z4Ok, z4bOk, nk4Ok, restFestMs, summe, restDb,
  standSchluessel, wirkung, wirkungOk, lokalerEinsatz, hochpass, f64 } from '../pruef/w6_messen.mjs';
import { anschlaege } from '../pruef/w3a_messen.mjs';
import { schreibeWav, leseWav } from '../pruef/w1_wav.mjs';

const TEMPO = 124, VON = 16, BIS = 48;
// Original: Clip ab Beat 0, Marker mit Tempowechsel (nicht linear), versatz 0,5
const orig = { start_beat: 0, offset_s: 0, warp: { an: true, modus: 'complex', marker: [[0, 0], [9, 20], [31, 70], [60, 140]],
  versatz_beats: 0.5, quelle: 'takte', transpose_st: 0, detune_ct: 0 } };
// Stem so gebaut, wie der Server es tut (projekt/stems.ts stemWarp): Bereich VON..BIS
function stemClip(f0Verschiebung = 0) {
  const bClip0 = VON - orig.start_beat + orig.warp.versatz_beats;
  const f0 = f0Von(orig, VON, TEMPO), f1 = Math.round(quellSekunde(orig.warp.marker, BIS + orig.warp.versatz_beats) * SR);
  return { start_beat: VON, offset_s: 0, warp: stemWarp(orig.warp, bClip0, f0 + f0Verschiebung, f1 + f0Verschiebung) };
}

test('Z3: Stem-Marker um F0 verschoben liegen auf dem Original, an 129 Beats ≤ 1 Sample', () => {
  const r = lageMax(orig, stemClip(), VON, BIS, TEMPO);
  assert.equal(r.punkte, 129);
  assert.ok(r.max <= 1, `max ${r.max}`);
  assert.ok(z3Ok(r));
});
test('NK3: F0 um 48 Frames verschoben → ≥ 40 Samples, z3Ok schlägt an', () => {
  const echt = f0Von(orig, VON, TEMPO);
  const r = lageMax(orig, stemClip(), VON, BIS, TEMPO, { f0: echt + 48 });
  assert.ok(r.max >= 40, `max ${r.max}`);
  assert.ok(nk3Ok(r)); assert.ok(!z3Ok(r));
  const falscherStem = lageMax(orig, stemClip(48), VON, BIS, TEMPO);
  // der Stem selbst um 48 Frames verrutscht (Mutation „Rückweg 48 Samples verschoben“)
  assert.ok(!z3Ok(falscherStem), `max ${falscherStem.max}`);
});
test('Z3 ohne Warp: Original ungewarpt (offset_s, Projekttempo), Stem ungewarpt mit offset 0', () => {
  const o = { start_beat: 4, offset_s: 1.5, warp: null }, s = { start_beat: VON, offset_s: 0, warp: null };
  assert.ok(z3Ok(lageMax(o, s, VON, BIS, TEMPO)));
  assert.ok(!z3Ok(lageMax(o, s, VON, BIS, TEMPO, { f0: f0Von(o, VON, TEMPO) + 48 })));
});

// Schlagzeug-Spur: n Kicks (Sweep 120 auf 50 Hz mit Klick-Anschlag) im Abstand einer Viertel bei 124 BPM; optional dauernder Bass (Pegel gegen die Kick-Spitze)
function kicks(n, { bassDb = null, verschiebungMs = 0, hats = false } = {}) {
  const P = 60 / TEMPO, x = new Float64Array(Math.round((n + 1) * P * SR));
  for (let k = 0; k < n; k++) {
    const a = Math.round((k * P + verschiebungMs / 1000) * SR);
    for (let i = 0; i < 7200 && a + i < x.length; i++) {
      const t = i / SR, ph = 2 * Math.PI * (50 * t + 70 * 0.02 * (1 - Math.exp(-t / 0.02)));
      x[a + i] += Math.exp(-t / 0.06) * Math.sin(ph) + 0.7 * Math.exp(-i / 40) * Math.sin(2 * Math.PI * 3000 * t);
    }
    if (hats) {
      const b = a + Math.round(P / 2 * SR);
      for (let i = 0; i < 600 && b + i < x.length; i++) x[b + i] += 0.3 * Math.exp(-i / 120) * Math.sin(2 * Math.PI * 7000 * i / SR);
    }
  }
  if (bassDb !== null) for (let i = 0; i < x.length; i++) x[i] += 10 ** (bassDb / 20) * Math.sin(2 * Math.PI * 55 * i / SR);
  return x;
}
const bass = (n, db) => Float64Array.from({ length: n }, (_, i) => 10 ** (db / 20) * Math.sin(2 * Math.PI * 55 * i / SR));
const misch = (a, db) => Float64Array.from(a, (v, i) => v + 10 ** (db / 20) * Math.sin(2 * Math.PI * 55 * i / SR));

test('Z4/Z4b: gleiche Drums im Original → n = 64, p90 ≤ 1 ms, Median-Differenz ≤ 1 ms', () => {
  const d = kicks(64), r = anschlagMessung(d, d, TEMPO, VON);
  assert.equal(r.n_drums, 64); assert.ok(r.n >= 63, `n ${r.n}`);   // der Schlag auf Sample 0 hat kein Fenster davor
  assert.ok(z4aOk(r) && z4Ok(r) && z4bOk(r), JSON.stringify(r));
});
test('M3: Kick plus Bass bei -10 dB (und 0 dB) im Original: n ≥ 60 von 64 und p90 ≤ 1 ms; die globale Erkennung allein fände fast nichts', () => {
  const drums = kicks(64);
  for (const db of [-10, 0]) {
    const mix = misch(drums, db);
    const r = anschlagMessung(drums, mix, TEMPO, VON);
    assert.ok(r.n >= 60, `Bass ${db} dB: n ${r.n}`);
    assert.ok(r.p90_ms <= 1, `Bass ${db} dB: p90 ${r.p90_ms}`);
    assert.ok(z4Ok(r) && z4bOk(r), JSON.stringify(r));
  }
  const alt = anschlaege(misch(drums, -10), SR);
  assert.ok(alt.length < 16, `die alte Erkennung zählt ${alt.length} (Vorbefund: 1)`);   // der Vorbefund des Reviews, an dieser Synthese nachgestellt
});
test('NK4 auf der Mischung: Drums um 5 ms später (Signal verschoben) → p90 > 4 ms, Z4 und Z4b rot, nk4Ok grün', () => {
  const drums = kicks(64), mix = misch(drums, -10);
  const r = anschlagMessung(drums, mix, TEMPO, VON, Math.round(0.005 * SR));
  assert.ok(r.n >= 60 && nk4Ok(r), JSON.stringify(r));
  assert.ok(Math.abs(r.p90_ms - 5) < 0.5, `p90 ${r.p90_ms}`);
  assert.ok(!z4Ok(r) && !z4bOk(r));
});
test('Z4 mit Hi-Hats und Bass: Treffer bleiben ≥ 75 %', () => {
  const drums = kicks(48, { hats: true }), mix = misch(drums, -6);
  const r = anschlagMessung(drums, mix, TEMPO, VON);
  assert.ok(z4Ok(r), JSON.stringify(r));
});
test('Z4a: Original ohne Einsätze (nur Bass) oder Stille: n = 0, nie grün, NK4 auch nicht trügerisch wahr', () => {
  const drums = kicks(64), nurBass = bass(drums.length, -10);
  for (const o of [nurBass, new Float64Array(drums.length)]) {
    const r = anschlagMessung(drums, o, TEMPO, VON);
    assert.equal(r.n, 0); assert.ok(!z4aOk(r) && !z4Ok(r) && !z4bOk(r) && !nk4Ok(r), JSON.stringify(r));
  }
  assert.equal(anschlagMessung(new Float64Array(48000 * 4), kicks(8), TEMPO, VON).n_drums, 0);
});
test('lokalerEinsatz: Anstieg in der Mitte gefunden, Stille und reiner Abfall (Spitze am Fensteranfang) geben null', () => {
  const x = new Float64Array(48000); x[24000] = 0; for (let i = 24000; i < 24400; i++) x[i] = Math.sin(i);
  const t = lokalerEinsatz(x, 24000 / SR);
  assert.ok(Math.abs(t - 24000 / SR) < 0.001, `t ${t}`);
  assert.equal(lokalerEinsatz(new Float64Array(48000), 0.5), null);
  const ab = Float64Array.from({ length: 48000 }, (_, i) => Math.exp(-(i + 6000) / 3000) * Math.sin(i));
  assert.equal(lokalerEinsatz(ab, 0.5), null);
  assert.ok(hochpass(Float64Array.from({ length: 4800 }, () => 1)).at(-1) < 1e-3);          // Gleichanteil weg
});
test('vergleichAusEinsaetzen: n_drums, Paare, p90 (nicht Minimum), Median-Differenz mit Betrag, Mindestzahlen', () => {
  const P = 60 / TEMPO / 4, grid = Array.from({ length: 20 }, (_, k) => k * P);
  const orig = grid.map((t, k) => t + (k < 5 ? 0.0035 : 0));             // 5 von 20 daneben: p90 sieht sie, ein Minimum nicht
  const r = vergleichAusEinsaetzen(grid, orig, TEMPO, VON);
  assert.equal(r.n, 20); assert.equal(r.n_drums, 20);
  assert.ok(r.p90_ms > 3 && !z4Ok(r), `p90 ${r.p90_ms}`);
  // Mediane mit Vorzeichen: Drums -2 ms, Original +2 ms vor dem Raster → Differenz 4 ms (Betrag), Z4b rot; mit vertauschten Rollen dasselbe
  const d2 = grid.map((t) => t - 0.002), o2 = grid.map((t) => t + 0.002);
  assert.ok(!z4bOk(vergleichAusEinsaetzen(d2, o2, TEMPO, VON)) && !z4bOk(vergleichAusEinsaetzen(o2, d2, TEMPO, VON)));
  assert.ok(vergleichAusEinsaetzen(d2, o2, TEMPO, VON).median_diff_ms > 3.9);
  // Mindestzahlen: 10 Drums → rot, auch bei Treffern; 20 Drums aber nur 10 im Original (< 75 %) → rot; Original ganz leer → n 0
  assert.ok(!z4aOk(vergleichAusEinsaetzen(grid.slice(0, 10), grid.slice(0, 10), TEMPO, VON)));
  assert.ok(!z4aOk(vergleichAusEinsaetzen(grid, grid.map((t, k) => (k < 10 ? t : null)), TEMPO, VON)));
  assert.ok(z4aOk(vergleichAusEinsaetzen(grid, grid.map((t, k) => (k < 16 ? t : null)), TEMPO, VON)));
  // jede Bedingung einzeln: 16 Drums, 13 gefunden (81 %, aber < 16) → rot; 40 Drums, 20 gefunden (≥ 16, aber 50 %) → rot
  const g40 = Array.from({ length: 40 }, (_, k) => k * P);
  assert.ok(!z4aOk(vergleichAusEinsaetzen(g40.slice(0, 16), g40.slice(0, 16).map((t, k) => (k < 13 ? t : null)), TEMPO, VON)));
  assert.ok(!z4aOk(vergleichAusEinsaetzen(g40, g40.map((t, k) => (k < 20 ? t : null)), TEMPO, VON)));
  assert.ok(z4aOk(vergleichAusEinsaetzen(g40, g40.map((t, k) => (k < 30 ? t : null)), TEMPO, VON)));
  // NK4 ist ohne genug Paare nie wahr, auch wenn die wenigen Paare 5 ms daneben liegen
  const wenig = vergleichAusEinsaetzen(grid.slice(0, 3), grid.slice(0, 3).map((t) => t + 0.005), TEMPO, VON);
  assert.ok(wenig.p90_ms > 4 && !nk4Ok(wenig));
  const leer = vergleichAusEinsaetzen(grid, grid.map(() => null), TEMPO, VON);
  assert.equal(leer.n, 0); assert.ok(!z4aOk(leer) && !z4Ok(leer) && !nk4Ok(leer));
});
test('Z3: weniger als 129 Punkte sind nie grün (punkte === 129)', () => {
  const r = lageMax(orig, stemClip(), VON, BIS, TEMPO, { schritte: 64 });
  assert.ok(r.max < 1e-6); assert.equal(r.punkte, 65);
  assert.ok(!z3Ok(r));
});
test('M1 Wirkung: B ≠ C, B ≠ O und Pegel C ≈ O grün; Mute wirkungslos (B = C), stumm wirkungslos (C = 2 · O) rot; je Kanal, Stille rot', () => {
  const n = 48000, o = Float64Array.from({ length: n }, (_, i) => 0.5 * Math.sin(i * 0.05) + 0.2 * Math.sin(i * 0.31));
  const dr = Float64Array.from(o, (v) => v * 0.4), c = Float64Array.from(o, (v) => v * 0.98);
  assert.ok(wirkungOk(wirkung(dr, c, o)), JSON.stringify(wirkung(dr, c, o)));
  assert.ok(!wirkungOk(wirkung(c, c, o)));                                      // nomute: Drums-Export = Summe
  assert.ok(!wirkungOk(wirkung(o, c, o)));                                      // Drums-Export = Original
  assert.ok(!wirkungOk(wirkung(dr, Float64Array.from(o, (v) => v * 2), o)));    // stumm wirkt nicht: Summe + Original = 2 · O (+6 dB)
  assert.ok(!wirkungOk(wirkung(dr, new Float64Array(n), o)) && !wirkungOk(wirkung(dr, c, new Float64Array(n))));   // Stille
  const anders = Float64Array.from({ length: n }, (_, i) => 0.5 * Math.sin(i * 0.07) + 0.2 * Math.sin(i * 0.41));   // ähnlicher Pegel, anderes Signal
  assert.ok(wirkungOk(wirkung(dr, anders, o)) === true);
  assert.ok(!wirkungOk(wirkung(anders, anders, o)));                            // B = C, O anders (nur B–C greift)
  assert.ok(!wirkungOk(wirkung(o, anders, o)));                                 // B = O, C anders (nur B–O greift)
  assert.ok(wirkungOk(wirkung(dr, c, Float64Array.from(o, (v) => v * 1.3))));   // 2,3 dB Pegelunterschied bleibt unter dem Tor
  assert.ok(!wirkungOk(wirkung(dr, c, Float64Array.from(o, (v) => v * 1.6))));  // 4,1 dB darüber
});
test('M4 leseWav liefert beide Kanäle (.r), .l unverändert; Mono: r ist l', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'w6wav-')), x = new Float32Array(2000);
  for (let i = 0; i < 1000; i++) { x[2 * i] = 0.25; x[2 * i + 1] = -0.5; }
  try {
    schreibeWav(path.join(d, 's.wav'), x);
    const w = leseWav(path.join(d, 's.wav'));
    assert.equal(w.l[10], 0.25); assert.equal(w.r[10], -0.5); assert.equal(w.r.length, w.frames);
    schreibeWav(path.join(d, 'm.wav'), new Float32Array(100).fill(0.1), 1);
    const m = leseWav(path.join(d, 'm.wav'));
    assert.equal(m.r, m.l);
    // Z5 je Kanal: ein stummer rechter Kanal im Export gibt für rechts NaN, nicht ok
    assert.ok(Number.isNaN(restDb(f64(w.r).map(() => 0), new Float64Array(1000))));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
test('restFestMs: fester Raster-Nullpunkt folgt dem Exportbeginn (Beginn bei Beat 16,125)', () => {
  const P = 60 / 120 / 4;
  assert.ok(restFestMs([P * 3, P * 5], 120, 16).every((r) => Math.abs(r) < 1e-9));
  assert.ok(restFestMs([0.0625, 0.1875], 120, 16.125).every((r) => Math.abs(r) < 1e-9));   // Raster bei Beat 16,25 = 0,0625 s nach Exportbeginn
  assert.ok(Math.abs(restFestMs([0.0625 + 0.002], 120, 16.125)[0] - 2) < 1e-6);            // + = nach dem Raster
  assert.ok(Math.abs(restFestMs([0.125], 120, 16.125)[0]) > 60);                           // ohne die Verschiebung läge das Raster woanders
});

test('Z5/NK5: vier Viertel gegen Original ≤ −20 dB; Original gegen Stille 0 dB; halbe Summe −6 dB (Messgerät sieht Verlust)', () => {
  const n = 48000, o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = 0.5 * Math.sin(i * 0.05) + 0.2 * Math.sin(i * 0.31);
  const stem = (g, rauschen = 0) => Float32Array.from(o, (v, i) => v * g + rauschen * Math.sin(i * 1.7));
  const gut = summe(stem(0.25, 0.001), stem(0.25), stem(0.25), stem(0.25));
  assert.ok(restDb(gut, o) <= -20, `${restDb(gut, o)}`);
  assert.ok(Math.abs(restDb(new Float64Array(n), o)) < 1e-9);               // NK5: Summe aus Stille → 0 dB
  const schlecht = summe(stem(0.125), stem(0.125), stem(0.125), stem(0.125));
  assert.ok(Math.abs(restDb(schlecht, o) + 6.02) < 0.05, `${restDb(schlecht, o)}`);
  assert.ok(restDb(gut.subarray(0, n - 100), o) <= -20);                    // kürzere Länge gilt
  assert.ok(Number.isNaN(restDb(gut, new Float32Array(n))));               // Original stumm: kein Ergebnis statt Zahl
});

test('Z6: Stand-Schlüssel gleich bei gleichem Stand, anders bei Spur, stumm, mute oder Gruppe', () => {
  const p = () => ({ spuren: [{ id: 's1', mute: false, clips: [{ id: 'c1' }, { id: 'c2', stumm: true }] }], gruppen: [] });
  assert.equal(standSchluessel(p()), standSchluessel(p()));
  const a = p(); a.spuren[0].clips[1].stumm = false; assert.notEqual(standSchluessel(a), standSchluessel(p()));
  const b = p(); b.spuren[0].mute = true; assert.notEqual(standSchluessel(b), standSchluessel(p()));
  const c = p(); c.gruppen = [{ id: 'g1' }]; assert.notEqual(standSchluessel(c), standSchluessel(p()));
  const d = p(); d.spuren.push({ id: 's2', mute: false, clips: [] }); assert.notEqual(standSchluessel(d), standSchluessel(p()));
  assert.equal(standSchluessel({ spuren: [], gruppen: undefined }), standSchluessel({ spuren: [], gruppen: [] }));
});
