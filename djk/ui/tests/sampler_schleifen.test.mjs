// Sample player stage 2b: the loop point readers (WAV `smpl`, AIFF `INST` + `MARK`) and the move of a loop into the pack. Headers only; files are written by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { liesSchleife, schleifeImPack } from '../sampler/schleifen.ts';
import { wavMitSchleife, aiffMitSchleife } from './support/schleifen_files.mjs';

function ordner(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'smp-loop-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

test('WAV smpl: the first loop, the end is inclusive so the exclusive end is dwEnd + 1', (t) => {
  const d = ordner(t);
  wavMitSchleife(path.join(d, 'a.wav'), { rate: 44100, schleifen: [[1000, 4999], [10, 20]] });
  assert.deepEqual(liesSchleife(path.join(d, 'a.wav')), { rate: 44100, start: 1000, ende: 5000 });
});

test('WAV smpl: a chunk behind the data chunk is found', (t) => {
  const d = ordner(t);
  wavMitSchleife(path.join(d, 'a.wav'), { rate: 48000, frames: 20000, schleifen: [[200, 899]], smplNach: true });
  assert.deepEqual(liesSchleife(path.join(d, 'a.wav')), { rate: 48000, start: 200, ende: 900 });
});

test('WAV: no smpl chunk, no loops, an empty or backwards loop and a truncated chunk all mean no loop', (t) => {
  const d = ordner(t);
  wavMitSchleife(path.join(d, 'ohne.wav'), { schleifen: null });
  wavMitSchleife(path.join(d, 'null.wav'), { schleifen: [] });
  wavMitSchleife(path.join(d, 'rueck.wav'), { schleifen: [[500, 100]] });
  wavMitSchleife(path.join(d, 'kurz.wav'), { schleifen: [[100, 900]], smplLaenge: 40 });
  for (const n of ['ohne', 'null', 'rueck', 'kurz']) assert.equal(liesSchleife(path.join(d, `${n}.wav`)), null, n);
  assert.equal(liesSchleife(path.join(d, 'gibts-nicht.wav')), null);
  fs.writeFileSync(path.join(d, 'muell.wav'), 'RIFF....WAVEsmpl');
  assert.equal(liesSchleife(path.join(d, 'muell.wav')), null);
  fs.writeFileSync(path.join(d, 'leer.wav'), '');
  assert.equal(liesSchleife(path.join(d, 'leer.wav')), null);
});

test('AIFF INST + MARK: a sustain loop with play mode 1 reads the marker positions and the 80 bit rate', (t) => {
  const d = ordner(t);
  aiffMitSchleife(path.join(d, 'a.aif'), { rate: 44100, inst: { modus: 1, anfang: 2, ende: 3 }, marken: [[9, 7], [3, 4000], [2, 1500]] });
  assert.deepEqual(liesSchleife(path.join(d, 'a.aif')), { rate: 44100, start: 1500, ende: 4000 });
  aiffMitSchleife(path.join(d, 'b.aif'), { rate: 48000, inst: { modus: 2, anfang: 1, ende: 2 }, marken: [[1, 100], [2, 900]] });   // ping-pong is a loop too
  assert.deepEqual(liesSchleife(path.join(d, 'b.aif')), { rate: 48000, start: 100, ende: 900 });
});

test('AIFF-C with sowt or NONE reads like AIFF; another compression has no loop', (t) => {
  const d = ordner(t);
  for (const komp of ['sowt', 'NONE']) {
    aiffMitSchleife(path.join(d, `${komp}.aifc`), { rate: 96000, komp, inst: { modus: 1, anfang: 1, ende: 2 }, marken: [[1, 10], [2, 70]] });
    assert.deepEqual(liesSchleife(path.join(d, `${komp}.aifc`)), { rate: 96000, start: 10, ende: 70 }, komp);
  }
  aiffMitSchleife(path.join(d, 'able.aifc'), { komp: 'able', inst: { modus: 1, anfang: 1, ende: 2 }, marken: [[1, 10], [2, 70]] });
  assert.equal(liesSchleife(path.join(d, 'able.aifc')), null);
});

test('AIFF: play mode 0, a missing marker, a backwards loop, no INST or no MARK mean no loop', (t) => {
  const d = ordner(t);
  const m = [[1, 10], [2, 70]];
  aiffMitSchleife(path.join(d, 'modus0.aif'), { inst: { modus: 0, anfang: 1, ende: 2 }, marken: m });
  aiffMitSchleife(path.join(d, 'fehlt.aif'), { inst: { modus: 1, anfang: 1, ende: 5 }, marken: m });
  aiffMitSchleife(path.join(d, 'rueck.aif'), { inst: { modus: 1, anfang: 2, ende: 1 }, marken: m });
  aiffMitSchleife(path.join(d, 'keininst.aif'), { marken: m });
  aiffMitSchleife(path.join(d, 'keinmark.aif'), { inst: { modus: 1, anfang: 1, ende: 2 } });
  for (const n of ['modus0', 'fehlt', 'rueck', 'keininst', 'keinmark']) assert.equal(liesSchleife(path.join(d, `${n}.aif`)), null, n);
  fs.writeFileSync(path.join(d, 'muell.aif'), Buffer.concat([Buffer.from('FORM'), Buffer.alloc(4, 255), Buffer.from('AIFFINST')]));
  assert.equal(liesSchleife(path.join(d, 'muell.aif')), null);
});

test('other file types have no loop', (t) => {
  const d = ordner(t);
  fs.writeFileSync(path.join(d, 'a.flac'), 'fLaC');
  assert.equal(liesSchleife(path.join(d, 'a.flac')), null);
});

test('schleifeImPack: scaled to 48 kHz, moved by the trimmed frames, shifted to the zone start', () => {
  // 44.1 kHz source, loop 44100..88200 = 1.0 s..2.0 s -> 48000..96000; the leading 480 frames were trimmed; the zone starts at pack frame 1000
  assert.deepEqual(schleifeImPack({ rate: 44100, start: 44100, ende: 88200 }, { a: 1000, b: 1000 + 120000, abgeschnitten: 480 }), [1000 + 48000 - 480, 1000 + 96000 - 480]);
  // rounding: round(frame * 48000 / rate)
  assert.deepEqual(schleifeImPack({ rate: 44100, start: 1001, ende: 3001 }, { a: 0, b: 5000, abgeschnitten: 0 }), [Math.round(1001 * 48000 / 44100), Math.round(3001 * 48000 / 44100)]);
  assert.deepEqual(schleifeImPack({ rate: 48000, start: 100, ende: 500 }, { a: 7, b: 1000, abgeschnitten: 0 }), [107, 507]);
});

test('schleifeImPack: a loop that leaves the zone, starts inside the trimmed silence or is shorter than 64 frames is dropped', () => {
  const z = { a: 0, b: 1000, abgeschnitten: 100 };
  assert.deepEqual(schleifeImPack({ rate: 48000, start: 200, ende: 1100 }, z), [100, 1000]);   // ends exactly at b: kept
  assert.equal(schleifeImPack({ rate: 48000, start: 200, ende: 1101 }, z), null);              // one frame past b
  assert.equal(schleifeImPack({ rate: 48000, start: 50, ende: 600 }, z), null);                // starts before the zone (inside the trimmed silence)
  assert.deepEqual(schleifeImPack({ rate: 48000, start: 100, ende: 600 }, z), [0, 500]);       // starts exactly at a: kept
  assert.deepEqual(schleifeImPack({ rate: 48000, start: 200, ende: 264 }, z), [100, 164]);     // exactly 64 frames: kept
  assert.equal(schleifeImPack({ rate: 48000, start: 200, ende: 263 }, z), null);               // 63 frames
  assert.equal(schleifeImPack(null, z), null);
});
