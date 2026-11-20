// The factory samples of the amiga device: the TS writer is byte for byte the Python script (tests/amiga_werk.rs holds the Rust writer to it as well).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { werksProben, sichereWerksProben } from '../sampler/werksproben.ts';
import { legeBank } from '../sampler/slots.ts';

const HASH = {
  'amiga-quadrat.f32': '26d34faa9e2cd3623b58a85bd0441941738091fa59e42af2ebbe77f7f906da1c',
  'amiga-dreieck.f32': '47a265a23050b405f8b8da4a141d4a64931464b74807a0bf2dd58e5ebc56be0d',
  'amiga-saege.f32': 'c647707fd5135ab22567d3c69e09239a51414ff71ab45cfb6e7241936c083776',
  'amiga-rauschen.f32': 'a65899a7436d5216438cb6d6b58cab6016c8d158e7cc2cba1097e5404b1db0e0',
};
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const temp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'werks-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const SKRIPT = new URL('../../instruments/modular_dsp/build_amiga_samples.py', import.meta.url).pathname;

test('the four files have the pinned SHA-256 and the sizes of the slots', () => {
  const w = werksProben();
  assert.deepEqual(Object.keys(w).sort(), Object.keys(HASH).sort());
  for (const [n, h] of Object.entries(HASH)) assert.equal(sha(w[n]), h, n);
  assert.deepEqual(Object.keys(w).map((n) => w[n].length / 8), [32, 32, 32, 4096]);
});

test('byte for byte the Python script', (t) => {
  const ziel = path.join(temp(t), 'proben');
  try { execFileSync('python3', [SKRIPT, ziel], { stdio: 'pipe' }); } catch (e) { if (e.code === 'ENOENT') { t.skip('no python3'); return; } throw e; }
  const w = werksProben();
  for (const n of Object.keys(HASH)) assert.ok(Buffer.compare(fs.readFileSync(path.join(ziel, n)), w[n]) === 0, `${n} differs from the script`);
});

test('sichereWerksProben writes the missing files and never overwrites one', (t) => {
  const d = path.join(temp(t), 'neu', 'samples');
  assert.deepEqual(sichereWerksProben(d).sort(), Object.keys(HASH).sort());
  for (const [n, h] of Object.entries(HASH)) assert.equal(sha(fs.readFileSync(path.join(d, n))), h);
  assert.deepEqual(sichereWerksProben(d), [], 'second call: nothing to do');
  fs.writeFileSync(path.join(d, 'amiga-saege.f32'), 'mine');
  fs.rmSync(path.join(d, 'amiga-quadrat.f32'));
  assert.deepEqual(sichereWerksProben(d), ['amiga-quadrat.f32']);
  assert.equal(fs.readFileSync(path.join(d, 'amiga-saege.f32'), 'utf8'), 'mine');
  assert.ok(!fs.readdirSync(d).some((n) => n.endsWith('.tmp')));
});

test('making a bank makes sure the factory files exist', (t) => {
  const bk = temp(t);
  fs.mkdirSync(path.join(bk, 'panels'));
  fs.copyFileSync(new URL('../../instruments/modular_dsp/demos/amiga.json', import.meta.url).pathname, path.join(bk, 'amiga.json'));
  legeBank([], bk);
  for (const [n, h] of Object.entries(HASH)) assert.equal(sha(fs.readFileSync(path.join(bk, 'samples', n))), h);
});
