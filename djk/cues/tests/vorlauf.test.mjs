// Traktor zählt den Encoder-Vorlauf der MP3 (LAME: 1105 Samples = 25,057 ms bei 44,1 kHz) doppelt mit: Seine Zeiten
// liegen auf der ffmpeg-Zeitachse um 2·start_time zu spät (Messung 2026-10-12, ~/messungen/2026-10-12-traktor-zeitbasis/,
// Traktor MP3+LAME n=108 Median −50,9 ms = 2·start_time; die frühere Annahme 1·start_time ließ ~25 ms Rest).
import test from 'node:test';
import assert from 'node:assert/strict';
import { verschiebeTraktor, traktorVersatz } from '../bibliothek.ts';

const TR = { raster_s: 0.246884, bpm: 126.999, cues: [{ name: 'n.n.', typ: 5, typ_name: 'loop', s: 75.8482, laenge_s: 3.78, hotcue: 0 }] };

// Die frühere Zeile „Kicks 28 bis 38 ms vor Traktors Grid“ (2026-09-26) ist nicht reproduzierbar.
test('Traktor-Zeiten um den übergebenen Versatz verschoben', () => {
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

test('traktorVersatz: 2·start_time nur bei MP3 mit start_time > 0', () => {
  assert.ok(Math.abs(traktorVersatz(0.025057, 'a.mp3') - 0.050114) < 1e-12);
  assert.ok(Math.abs(traktorVersatz(0.025057, 'A.MP3') - 0.050114) < 1e-12);
  assert.equal(traktorVersatz(0, 'a.mp3'), 0);
  assert.equal(traktorVersatz(0.046, 'a.m4a'), 0);
  assert.equal(traktorVersatz(0, 'a.wav'), 0);
});

test('Raster 0,246884 wird mit dem MP3-Versatz auf 0,196770 verschoben', () => {
  const v = verschiebeTraktor(TR, traktorVersatz(0.025057, 'x.mp3'));
  assert.ok(Math.abs(v.raster_s - 0.19677) < 1e-9);
  assert.ok(Math.abs(v.vorlauf_s - 0.050114) < 1e-12);
});
