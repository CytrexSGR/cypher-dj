// Package 1.9 U3 (T3.6): (1) the measurements of pruef/i19_spektrum.mjs on synthetic signals, with their negative controls, (2) the guards of
// pruef/abnahme_i19_wirte.mjs (exit 2 before any network for the operation and for the letters it must never use; b, d, e pass the guards).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { peakFrequenz, pegelBei, hannPegel, laengsterStillstand, spektrum, db, leseF32Stereo } from '../pruef/i19_spektrum.mjs';

const RATE = 48000;
const sinus = (f, n, a = 0.5) => Float64Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / RATE));

test('peakFrequenz finds the fundamental within 1 % and tells 261.6 Hz from 523.3 Hz', () => {
  for (const f of [261.63, 523.25, 392.0]) assert.ok(Math.abs(peakFrequenz(sinus(f, 65536), RATE) / f - 1) < 0.001, `f ${f}`);
  // negative control: the peak of a 523 Hz tone is not within 1 % of 261.6 Hz
  assert.ok(Math.abs(peakFrequenz(sinus(523.25, 65536), RATE) / 261.63 - 1) > 0.5);
  // two tones: the stronger one wins
  const zwei = sinus(261.63, 65536, 0.5).map((v, i) => v + 0.05 * Math.sin((2 * Math.PI * 523.25 * i) / RATE));
  assert.ok(Math.abs(peakFrequenz(zwei, RATE) / 261.63 - 1) < 0.001);
});

test('hannPegel and pegelBei: a -26 dBFS sine reads about -26 dB, the other fundamental of a pure tone reads far below -40 dB', () => {
  const x = sinus(261.63, 65536, 0.05);
  assert.ok(Math.abs(hannPegel(x, RATE, 261.63 * 0.99, 261.63 * 1.01) - db(0.05)) < 0.3);
  assert.ok(Math.abs(pegelBei(x, RATE, 261.63) - db(0.05)) < 0.5);
  assert.ok(hannPegel(x, RATE, 523.25 * 0.99, 523.25 * 1.01) - hannPegel(x, RATE, 261.63 * 0.99, 261.63 * 1.01) < -40, 'a pure tone has nothing at the octave');
  // negative control: a tone that carries the octave at -30 dB relative is NOT below -40 dB
  const mitOktave = x.map((v, i) => v + 0.05 * 0.0316 * Math.sin((2 * Math.PI * 523.25 * i) / RATE));
  assert.ok(hannPegel(mitOktave, RATE, 523.25 * 0.99, 523.25 * 1.01) - hannPegel(mitOktave, RATE, 261.63 * 0.99, 261.63 * 1.01) > -40);
  assert.throws(() => spektrum(new Float64Array(1000)), /power of two/);
});

test('laengsterStillstand counts the longest run of digital silence in the window only', () => {
  const n = 1000, l = new Float32Array(n).fill(0.1), r = new Float32Array(n).fill(0.1);
  assert.equal(laengsterStillstand(l, r, 0, n), 0);
  for (let i = 100; i < 150; i++) l[i] = r[i] = 0;                    // a 50-frame gap
  for (let i = 400; i < 420; i++) l[i] = r[i] = 0;                    // a 20-frame gap
  assert.equal(laengsterStillstand(l, r, 0, n), 50);
  assert.equal(laengsterStillstand(l, r, 300, n), 20, 'the window excludes the first gap');
  l[120] = 0.5;                                                       // one channel alive in the middle of the gap splits it
  assert.equal(laengsterStillstand(l, r, 0, n), 29);
  // 48 frames pass the AK-W5 limit, 49 do not
  const m = new Float32Array(200).fill(0.1);
  for (let i = 10; i < 58; i++) m[i] = 0;
  assert.ok(laengsterStillstand(m, m, 0, 200) <= 48);
  m[58] = 0;
  assert.ok(laengsterStillstand(m, m, 0, 200) > 48);
});

test('leseF32Stereo reads interleaved f32 as a freeze file holds it', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'i19w-'));
  try {
    const b = Buffer.alloc(24);
    [0.25, -0.5, 1, 0, -1, 0.125].forEach((v, i) => b.writeFloatLE(v, i * 4));
    fs.writeFileSync(path.join(d, 'a.f32'), b);
    const { l, r, frames } = leseF32Stereo(path.join(d, 'a.f32'));
    assert.deepEqual([frames, [...l], [...r]], [3, [0.25, 1, -1], [-0.5, 0, 0.125]]);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

const SKRIPT = path.resolve(import.meta.dirname, '..', 'pruef', 'abnahme_i19_wirte.mjs');
const aus = fs.mkdtempSync(path.join(os.tmpdir(), 'i19w-aus-'));
test.after(() => fs.rmSync(aus, { recursive: true, force: true }));
const lauf = (...args) => spawnSync(process.execPath, [SKRIPT, ...args], { encoding: 'utf8', timeout: 60000 });
const ziel = (url) => ['--url', url, '--bau', '/nonexistent', '--ausgabe', aus];

test('i19 wirte acceptance: usage and the guards give exit 2', () => {
  assert.equal(lauf().status, 2);
  assert.match(lauf('--url', 'http://127.0.0.1:51300').stderr, /usage/);
  for (const [was, url] of [['operation page', 'http://127.0.0.1:47300'], ['operation core', 'http://127.0.0.1:47100'], ['letter f', 'http://127.0.0.1:56300'],
    ['letter a', 'http://127.0.0.1:48300'], ['letter c', 'http://127.0.0.1:50300'], ['letter g', 'http://127.0.0.1:53300']]) {
    const r = lauf(...ziel(url));
    assert.equal(r.status, 2, `${was}: exit ${r.status} ${r.stderr}`);
    assert.match(r.stderr, /not allowed|never against the operation/, was);
  }
});

test('i19 wirte acceptance: letters b, d, e pass the guards (negative control), no server there gives a FEHL, not a usage error', () => {
  for (const url of ['http://127.0.0.1:49300', 'http://127.0.0.1:51300', 'http://127.0.0.1:52300']) {
    const r = lauf(...ziel(url), '--nur', 'S');
    assert.equal(r.status, 1, `${url}: exit ${r.status} ${r.stderr}`);
    assert.match(r.stdout, /FEHL/);
  }
});
