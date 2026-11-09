// Package 1.9 U4 (T4.5): the guards of check/acceptance_i19_direction.mjs (exit 2 before any network for the operation and for the letters it must never use;
// b, d, e pass the guards and then fail on the closed port with exit 1, never 2).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const SKRIPT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'pruef', 'acceptance_i19_direction.mjs');
const lauf = (args) => spawnSync(process.execPath, [SKRIPT, ...args], { encoding: 'utf8', timeout: 60000 });

test('abnahme_i19_richtung refuses the operation, letter a, c, f, a missing url or bau (exit 2), and lets b, d, e through the guards', (t) => {
  const aus = fs.mkdtempSync(path.join(os.tmpdir(), 'richtung-guard-')); t.after(() => fs.rmSync(aus, { recursive: true, force: true }));
  const bau = os.tmpdir();
  for (const url of ['http://127.0.0.1:47300', 'http://127.0.0.1:48300', 'http://127.0.0.1:50300', 'http://127.0.0.1:53300']) {
    const r = lauf(['--url', url, '--bau', bau, '--ausgabe', aus]);
    assert.equal(r.status, 2, `${url}: ${r.stderr}`);
  }
  assert.equal(lauf(['--bau', bau]).status, 2);
  assert.equal(lauf(['--url', 'http://127.0.0.1:52300']).status, 2);
  // the letter given explicitly cannot smuggle f in either
  assert.equal(lauf(['--url', 'http://127.0.0.1:52300', '--bau', bau, '--instanz', 'f', '--ausgabe', aus]).status, 2);
  // negative control: b, d, e pass the guards (no unit runs there on the unused port: the first point fails, exit 1)
  for (const url of ['http://127.0.0.1:49390', 'http://127.0.0.1:51390', 'http://127.0.0.1:52390']) {
    const r = lauf(['--url', url, '--bau', bau, '--instanz', url.includes('49') ? 'b' : url.includes('51') ? 'd' : 'e', '--ausgabe', aus]);
    assert.equal(r.status, 1, `${url}: ${r.stdout} ${r.stderr}`);
  }
});

// 1.9 U5: --surge takes the same guards; --sweep means nothing without --surge (usage, exit 2)
test('abnahme_i19_richtung --surge: the guards hold, --sweep alone is a usage error, b, d, e pass', (t) => {
  const aus = fs.mkdtempSync(path.join(os.tmpdir(), 'richtung-guard-')); t.after(() => fs.rmSync(aus, { recursive: true, force: true }));
  const bau = os.tmpdir();
  assert.equal(lauf(['--surge', '--url', 'http://127.0.0.1:47300', '--bau', bau, '--ausgabe', aus]).status, 2, 'never the operation');
  assert.equal(lauf(['--surge', '--url', 'http://127.0.0.1:53300', '--bau', bau, '--ausgabe', aus]).status, 2, 'never f');
  assert.equal(lauf(['--surge', '--url', 'http://127.0.0.1:52300', '--bau', bau, '--instanz', 'f', '--ausgabe', aus]).status, 2);
  assert.equal(lauf(['--sweep', '--url', 'http://127.0.0.1:52390', '--bau', bau, '--instanz', 'e', '--ausgabe', aus]).status, 2, '--sweep without --surge');
  const ok = lauf(['--surge', '--sweep', '--url', 'http://127.0.0.1:52390', '--bau', bau, '--instanz', 'e', '--ausgabe', aus]);
  assert.equal(ok.status, 1, `negative control: e passes the guards: ${ok.stdout} ${ok.stderr}`);
});

