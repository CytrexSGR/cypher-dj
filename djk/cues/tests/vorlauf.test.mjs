// Traktor zählt den Encoder-Vorlauf der MP3 mit (LAME: 1105 Samples = 25,057 ms bei 44,1 kHz), ffmpeg und der Browser
// schneiden ihn ab. Traktor-Zeiten müssen darum um den Vorlauf früher liegen (gemessen 2026-09-26 an vier Tracks:
// Kicks 28 bis 38 ms vor Traktors Grid in der eigenen Dekodierung).
import test from 'node:test';
import assert from 'node:assert/strict';
import { verschiebeTraktor } from '../bibliothek.ts';

const TR = { raster_s: 0.246884, bpm: 126.999, cues: [{ name: 'n.n.', typ: 5, typ_name: 'loop', s: 75.8482, laenge_s: 3.78, hotcue: 0 }] };

test('Traktor-Zeiten um den Vorlauf verschoben', () => {
  const v = verschiebeTraktor(TR, 0.025057);
  assert.ok(Math.abs(v.raster_s - 0.221827) < 1e-9);
  assert.ok(Math.abs(v.cues[0].s - 75.823143) < 1e-9);
  assert.equal(v.vorlauf_s, 0.025057);
  assert.equal(TR.raster_s, 0.246884, 'Eingabe bleibt unverändert');
});

test('Negativ-Kontrolle: Vorlauf 0 ändert nichts, fehlender Eintrag bleibt null', () => {
  const v = verschiebeTraktor(TR, 0);
  assert.equal(v.raster_s, TR.raster_s); assert.equal(v.cues[0].s, TR.cues[0].s);
  assert.equal(verschiebeTraktor(null, 0.025), null);
});

test('nie vor 0', () => {
  const v = verschiebeTraktor({ raster_s: 0.01, bpm: 120, cues: [{ s: 0.0 }] }, 0.025);
  assert.equal(v.raster_s, 0); assert.equal(v.cues[0].s, 0);
});
