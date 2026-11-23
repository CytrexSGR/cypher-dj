// A loop whose loop.f32 is digital silence is listed with still: true (it loads, but plays nothing); a sounding one with still: false.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { leseLoops, istStill } from '../loops.ts';

function schreibe(dir, name, samples) {
  fs.mkdirSync(path.join(dir, name));
  fs.writeFileSync(path.join(dir, name, 'loop.json'), JSON.stringify({ schema: 1, name, beats: 1, bpm: 128, frames: 22500, datei: 'loop.f32', quelle: 'test' }));
  fs.writeFileSync(path.join(dir, name, 'loop.f32'), Buffer.from(samples.buffer));
}

test('silent loop is marked still, a sounding one is not, and a rewrite is seen', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-loops-still-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const leer = new Float32Array(45000);
  const ton = new Float32Array(45000); ton[44999] = 0.25;   // the only sound is the very last sample
  schreibe(dir, 'leise', leer);
  schreibe(dir, 'laut', ton);
  const liste = leseLoops(dir);
  assert.deepEqual(liste.map((l) => [l.name, l.ladbar, l.still]), [['laut', true, false], ['leise', true, true]]);
  // the cache must notice a new file content (size equal, mtime moves)
  const datei = path.join(dir, 'leise', 'loop.f32');
  fs.writeFileSync(datei, Buffer.from(ton.buffer));
  const spaeter = new Date(Date.now() + 5000); fs.utimesSync(datei, spaeter, spaeter);
  assert.equal(istStill(datei), false);
});
