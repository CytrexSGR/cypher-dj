// Takt-Zähler ab der ersten vollen Eins im Track (2026-10-17): bei „Wake up fucked up“ begann die Karte erst bei 178.8 s,
// davor stand „–“, obwohl die Striche schon über den ganzen Track liefen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ersteVolleEins } from '../oeffentlich/welle.js';

const FPB = 48000 * 60 / 128;   // 22500 Frames je Schlag bei 128 BPM

test('Karte beginnt spät: Takt 1 rückt an den Track-Anfang, im Viertakt-Abstand zur Eins', () => {
  const s0 = 100 * FPB + 7000;   // erster Schlag der Karte 100 Schläge + Rest nach Frame 0
  const e = ersteVolleEins(2, s0, FPB);
  assert.equal(((e - 2) % 4 + 4) % 4, 0);          // gleiche Taktphase wie die gemessene Eins
  assert.ok(s0 + e * FPB >= 0);                     // liegt im Track
  assert.ok(s0 + (e - 4) * FPB < 0);                // eine Eins früher läge vor dem Track
});

test('NEGATIV: Karte beginnt am Anfang → Eins unverändert', () => {
  assert.equal(ersteVolleEins(0, 14400, FPB), 0);
  assert.equal(ersteVolleEins(2, 3000, FPB), 2);
  assert.equal(ersteVolleEins(3, 0, FPB), 3);
});

test('Grenze: Eins genau auf Frame 0 zählt', () => {
  assert.equal(ersteVolleEins(4, 0, FPB), 0);
});

test('NEGATIV: erster Schlag knapp vor Frame 0 (Live-Fall Deck A, s0 = -105) → Eins bleibt, kein Versatz um einen Takt', () => {
  assert.equal(ersteVolleEins(0, -105, FPB), 0);
});
