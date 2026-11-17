// Analyze B1: short-term and momentary loudness maxima from the same ffmpeg run (project/loudness.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { leseMaxima, messeLautheit } from '../project/loudness.ts';
import { wavKopf } from '../project/recording.ts';

const ZEILE = 't: 9.99998    TARGET:-23 LUFS    M: -18.9 S: -19.3     I: -19.2 LUFS       LRA:   0.3 LU  FTPK: -15.2 -15.4 dBFS  TPK:  -8.5  -8.6 dBFS';

test('leseMaxima reads M and S of a frame line, with and without the space', () => {
  const stand = { s: null, m: null };
  leseMaxima(ZEILE, stand);
  assert.equal(stand.m, -18.9);
  assert.equal(stand.s, -19.3);
  leseMaxima('t: 10.1 TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU', stand);
  assert.equal(stand.m, -18.9, 'values <= -120 are ignored');
  assert.equal(stand.s, -19.3);
  leseMaxima('t: 10.2 TARGET:-23 LUFS    M: -inf S: -inf     I: -70.0 LUFS', stand);
  assert.equal(stand.m, -18.9, '-inf is ignored');
  leseMaxima('t: 10.3 TARGET:-23 LUFS    M:-17.5 S:-18.0     I: -19.0 LUFS', stand);
  assert.equal(stand.m, -17.5, 'a higher value without the space is taken');
  assert.equal(stand.s, -18.0);
  leseMaxima('t: 10.4 TARGET:-23 LUFS    M: -30.0 S: -31.0     I: -19.0 LUFS', stand);
  assert.equal(stand.m, -17.5, 'lower values do not lower the maximum');
  const vor = { ...stand };
  leseMaxima('  Integrated loudness:\n    I:         -19.2 LUFS\n    LRA:         0.3 LU', stand);
  assert.deepEqual(stand, vor, 'a summary line changes nothing');
});

function sinusWav(sek, amp) {
  const frames = 48000 * sek;
  const d = Buffer.alloc(frames * 8);
  for (let i = 0; i < frames; i++) {
    const v = amp * Math.sin(2 * Math.PI * 1000 * i / 48000);
    d.writeFloatLE(v, i * 8); d.writeFloatLE(v, i * 8 + 4);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-maxima-'));
  const datei = path.join(dir, 's.wav');
  fs.writeFileSync(datei, Buffer.concat([wavKopf(frames), d]));
  return { dir, datei };
}

test('messeLautheit with maxima: a steady sine has M and S maxima at its integrated loudness', async (t) => {
  const { dir, datei } = sinusWav(6, 0.25);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const l = await messeLautheit(datei, ['ffmpeg'], 120_000, { maxima: true });
  assert.equal(l.loudness_fehler, undefined);
  assert.ok(Math.abs(l.lufs_m_max - l.lufs_i) < 0.5, `M ${l.lufs_m_max} vs I ${l.lufs_i}`);
  assert.ok(Math.abs(l.lufs_s_max - l.lufs_i) < 0.5, `S ${l.lufs_s_max} vs I ${l.lufs_i}`);
  assert.equal(typeof l.lra, 'number');
  assert.equal(typeof l.true_peak_dbtp, 'number');
});

test('messeLautheit without the option answers as before', async (t) => {
  const { dir, datei } = sinusWav(6, 0.25);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const l = await messeLautheit(datei);
  assert.deepEqual(Object.keys(l).sort(), ['lra', 'lufs_i', 'true_peak_dbtp']);
});
