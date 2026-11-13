// The stem tests skip (with the reason) when the Python cannot import the werkstatt, instead of waiting for a child that died.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pythonKannStems } from './support/stems_voraussetzung.mjs';

test('pythonKannStems: a Python that fails the import or does not exist is no stem Python', () => {
  assert.equal(pythonKannStems('/bin/false'), false);
  assert.equal(pythonKannStems('/gibt/es/nicht/python'), false);
  assert.equal(pythonKannStems('/bin/true'), true);
});

test('a stem test file with a Python without the werkstatt skips and ends fast (no hang)', () => {
  const datei = fileURLToPath(new URL('./proj_stems.test.mjs', import.meta.url));
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--test', '--test-timeout=20000', datei],
    { env: { ...process.env, NODE_TEST_CONTEXT: undefined, CYPHERDJ_PYTHON: '/bin/false' }, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stdout.slice(-800));
  assert.match(r.stdout, /# fail 0/);
  assert.match(r.stdout, /# skipped (2\d|[3-9]\d)/);
  assert.ok(Date.now() - t0 < 30000, 'took ' + (Date.now() - t0) + ' ms');
});
