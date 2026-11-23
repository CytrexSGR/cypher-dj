// generator/src/strudel.mjs: a missing CYPHERDJ_STRUDEL folder ends the process with one stderr line and exit 2 (no stack trace, no restart loop).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const STRUDEL = path.join(import.meta.dirname, '..', 'src', 'strudel.mjs');

test('strudel.mjs: CYPHERDJ_STRUDEL=/missing gives one line on stderr and exit 2', () => {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, CYPHERDJ_STRUDEL: '/missing' };
  const r = spawnSync(process.execPath, [STRUDEL], { env, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.equal(r.stderr, 'CYPHERDJ_STRUDEL: /missing does not exist\n');
});
