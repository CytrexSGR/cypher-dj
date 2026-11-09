// Package 1.9 U2 (T2.6): the guards of pruef/abnahme_i19_kit.mjs. The script drives a live test instance, so only its refusals can be tested here:
// it exits 2 before touching any network for the operation, for the letters it must never use, and for a missing argument. Negative control: an
// allowed letter gets past the guards (it then fails to reach a server, exit 1, never 2).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const SKRIPT = path.resolve(import.meta.dirname, '..', 'check', 'acceptance_i19_kit.mjs');
const kits = fs.mkdtempSync(path.join(os.tmpdir(), 'i19-kits-'));
const aus = fs.mkdtempSync(path.join(os.tmpdir(), 'i19-aus-'));
test.after(() => { fs.rmSync(kits, { recursive: true, force: true }); fs.rmSync(aus, { recursive: true, force: true }); });
const lauf = (...args) => spawnSync(process.execPath, [SKRIPT, ...args], { encoding: 'utf8', timeout: 60000 });
const ziel = (url) => ['--url', url, '--bau', '/nonexistent', '--kits', kits, '--ausgabe', aus];

test('i19 kit acceptance: usage and the guards give exit 2', () => {
  assert.equal(lauf().status, 2);
  assert.match(lauf('--url', 'http://127.0.0.1:51300').stderr, /usage/);
  for (const [was, url] of [['operation page', 'http://127.0.0.1:47300'], ['operation core', 'http://127.0.0.1:47100'], ['letter f', 'http://127.0.0.1:56300'],
    ['letter a', 'http://127.0.0.1:48300'], ['letter c', 'http://127.0.0.1:50300'], ['letter g', 'http://127.0.0.1:53300']]) {
    const r = lauf(...ziel(url));
    assert.equal(r.status, 2, `${was}: exit ${r.status} ${r.stderr}`);
    assert.match(r.stderr, /not allowed|never against the operation/, was);
  }
  assert.equal(lauf('--url', 'http://127.0.0.1:51300', '--bau', '/x', '--kits', '/gibt/es/nicht').status, 2, 'a kit folder that does not exist');
});

test('i19 kit acceptance: letters b, d, e pass the guards (negative control), no server there gives a FEHL, not a usage error', () => {
  for (const url of ['http://127.0.0.1:49300', 'http://127.0.0.1:51300', 'http://127.0.0.1:52300']) {
    const r = lauf(...ziel(url), '--nur', 'S');
    assert.equal(r.status, 1, `${url}: exit ${r.status} ${r.stderr}`);
    assert.match(r.stdout, /FEHL/);
  }
});
