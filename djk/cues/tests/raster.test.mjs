// Quantisierung und Takt/Schlag-Zählung am Raster (raster.js, geteilt von Seite und Server)
import test from 'node:test';
import assert from 'node:assert/strict';
import { cuePosition, naechsterTakt, taktSchlag, quellBeat, ersteEinsS, ersterSchlagS, ersteEinsQuellBeat, springe, cueFelder } from '../oeffentlich/raster.js';

// 120 BPM: Schlag 0,5 s, Takt 2 s; Eins bei 2,5 s -> erste Eins 0,5 s, erster Schlag 0,0 s, erste_eins_quell_beat 1
const R = { bpm: 120, eins_s: 2.5 };
const nahe = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('Raster-Ableitungen: erste Eins, erster Schlag, erste_eins_quell_beat', () => {
  nahe(ersteEinsS(R), 0.5); nahe(ersterSchlagS(R), 0); assert.equal(ersteEinsQuellBeat(R), 1);
  nahe(quellBeat(R, 0.5), 1); nahe(quellBeat(R, 2.5), 5);
});

test('Quantisierung an: nächste Takt-Eins (runden, nicht abschneiden)', () => {
  nahe(cuePosition(R, 2.4, true), 2.5);
  nahe(cuePosition(R, 3.4, true), 2.5);   // 0,9 s nach der Eins: näher an 2,5 als an 4,5
  nahe(cuePosition(R, 3.6, true), 4.5);   // 1,1 s nach der Eins: nächste
  nahe(cuePosition(R, 0.1, true), 0.5);
});

test('Negativ-Kontrolle: Quantisierung aus lässt die Position genau; auf dem Takt bleibt auf dem Takt', () => {
  nahe(cuePosition(R, 3.61, false), 3.61);
  nahe(cuePosition(R, 4.5, true), 4.5);
});

test('Fehlerfall Rand: vor 0 und hinter dem Ende bleibt die Eins in der Datei', () => {
  nahe(naechsterTakt({ bpm: 120, eins_s: 1.9 }, 0.0, 100), 1.9);    // -0,1 wäre die nächste: vor dem Anfang -> nächste gültige
  nahe(naechsterTakt(R, 99.9, 100), 98.5);                          // 100,5 läge hinter dem Ende
  nahe(cuePosition(R, -3, false, 100), 0);
  nahe(cuePosition(R, 120, false, 100), 100);
});

test('Takt und Schlag: Eins = 1.1, halber Takt = 1.3, vor der ersten Eins = Takt 0', () => {
  assert.deepEqual(taktSchlag(R, 0.5), { takt: 1, schlag: 1, bruch: 0 });
  assert.deepEqual(taktSchlag(R, 1.5), { takt: 1, schlag: 3, bruch: 0 });
  assert.deepEqual(taktSchlag(R, 2.5), { takt: 2, schlag: 1, bruch: 0 });
  const vor = taktSchlag(R, 0.0);
  assert.equal(vor.takt, 0); assert.equal(vor.schlag, 4);
});

test('Regression (gefunden 2026-09-26): auf 4 Stellen gerundete Sekunde einer Eins zählt als Eins, nicht als Schlag 4 davor', () => {
  const r = { bpm: 127, eins_s: 0.0537266 };
  const s = Math.round((r.eins_s + 16 * 4 * 60 / 127) * 1e4) / 1e4; // 0,0000x zu früh
  assert.deepEqual([taktSchlag(r, s).takt, taktSchlag(r, s).schlag], [17, 1]);
  const f = cueFelder(r, Math.round(r.eins_s * 1e4) / 1e4);
  assert.equal(f.takt, 1); assert.equal(f.schlag, 1);
  // Gegenprobe: 10 ms vor der Eins ist Schlag 4 des Vortakts
  assert.deepEqual([taktSchlag(r, s - 0.01).takt, taktSchlag(r, s - 0.01).schlag], [16, 4]);
});

test('Sprung: 1 Takt und 16 Takte, Phase bleibt, Grenzen halten', () => {
  nahe(springe(R, 3.0, 1, 100), 5.0);
  nahe(springe(R, 3.0, 16, 100), 35.0);
  nahe(springe(R, 3.0, -16, 100), 0);
  nahe(springe(R, 99.0, 1, 100), 99.99);
});
