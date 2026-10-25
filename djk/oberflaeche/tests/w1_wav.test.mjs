// Paket 1.13 Warp, Slice 1: die Messwerkzeuge der Zielabnahme (pruef/w1_wav.mjs) an erfundenen Signalen. Jedes Werkzeug hat seinen Fall, der treffen muss.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { schreibeWav, leseWav, klicks, frequenz, cent } from '../pruef/w1_wav.mjs';

const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'w1wav-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('WAV: schreiben und lesen ist verlustfrei (Float32 stereo), der linke Kanal kommt zurück', (t) => {
  const d = tmp(t), n = 1000, daten = new Float32Array(2 * n);
  for (let i = 0; i < n; i++) { daten[2 * i] = Math.sin(i / 10); daten[2 * i + 1] = -0.5; }
  schreibeWav(path.join(d, 'a.wav'), daten);
  const w = leseWav(path.join(d, 'a.wav'));
  assert.equal(w.frames, n); assert.equal(w.rate, 48000);
  assert.deepEqual(Array.from(w.l.subarray(0, 5)), Array.from(daten.filter((_, i) => i % 2 === 0).subarray(0, 5)));
  assert.throws(() => { fs.writeFileSync(path.join(d, 'k.wav'), 'kein riff'); leseWav(path.join(d, 'k.wav')); }, /kein RIFF/);
});

test('klicks: findet jeden Klick auf dem Sample, auch bei Rauschen darunter; Negativ-Kontrolle: Stille ergibt keinen', () => {
  const x = new Float32Array(200000);
  for (let i = 0; i < x.length; i++) x[i] = 0.01 * Math.sin(i);
  const soll = [100, 22600, 45100, 67600];
  for (const s of soll) x[s] = 0.7;
  assert.deepEqual(klicks(x), soll);
  assert.deepEqual(klicks(new Float32Array(1000)), []);
});

test('klicks: ein Klick auf Index 0 und einer auf dem letzten Index werden gefunden (der Export beginnt auf dem Einsatz-Sample)', () => {
  const x = new Float32Array(50000);
  x[0] = 0.8; x[25000] = 0.8; x[49999] = 0.8;
  assert.deepEqual(klicks(x), [0, 25000, 49999]);
  const y = new Float32Array(10);
  y[0] = 0.8;
  assert.deepEqual(klicks(y), [0], 'ein einziger Klick auf Index 0, sonst Stille');
  const z = new Float32Array(10);
  z[0] = 0.1; z[9] = 0.1;
  assert.deepEqual(klicks(z), [], 'unter der Schwelle bleibt auch am Rand unter der Schwelle');
});

test('frequenz: 1000 Hz auf ±0,01 ct, 1024 Hz als +41,06 ct gegen 1000 Hz', () => {
  const x = new Float32Array(96000), y = new Float32Array(96000);
  for (let i = 0; i < x.length; i++) { x[i] = Math.sin(2 * Math.PI * 1000 * i / 48000); y[i] = Math.sin(2 * Math.PI * 1024 * i / 48000); }
  assert.ok(Math.abs(cent(frequenz(x, 1000, 90000), 1000)) < 0.01);
  assert.ok(Math.abs(cent(frequenz(y, 1000, 90000), 1000) - 1200 * Math.log2(128 / 125)) < 0.01);
  assert.equal(frequenz(new Float32Array(100), 0, 100), 0, 'Stille: keine Nulldurchgänge');
});
