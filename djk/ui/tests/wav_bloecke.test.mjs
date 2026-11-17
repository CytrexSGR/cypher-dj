// Analyze B1: block reader for float32 stereo WAV (sampler/wav.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { leseWavF32, leseWavF32Bloecke } from '../sampler/wav.ts';
import { wavKopf } from '../project/recording.ts';

test('leseWavF32Bloecke delivers every frame once in blocks', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-bloecke-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const frames = 10_000;
  const f = new Float32Array(frames * 2);
  for (let i = 0; i < f.length; i++) f[i] = Math.fround((i % 1000) / 1000 - 0.5);
  const p = path.join(dir, 'a.wav');
  fs.writeFileSync(p, Buffer.concat([wavKopf(frames), Buffer.from(f.buffer)]));
  const laengen = [], teile = [];
  const n = leseWavF32Bloecke(p, 4096, (b) => { laengen.push(b.length); teile.push(Float32Array.from(b)); });
  assert.equal(n, frames);
  assert.deepEqual(laengen, [8192, 8192, 3616]);
  const alle = new Float32Array(f.length);
  let o = 0;
  for (const b of teile) { alle.set(b, o); o += b.length; }
  assert.deepEqual(alle, f);
  assert.deepEqual(alle, leseWavF32(p).daten);
});

test('leseWavF32Bloecke refuses a mono WAV with format_falsch', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-bloecke-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const k = wavKopf(100);
  k.writeUInt16LE(1, 22);   // one channel
  const p = path.join(dir, 'm.wav');
  fs.writeFileSync(p, Buffer.concat([k, Buffer.alloc(800)]));
  assert.throws(() => leseWavF32Bloecke(p, 4096, () => {}), (e) => e.grund === 'format_falsch');
});
