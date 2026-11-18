// tests/serial.txt against the code: a test file that takes the lock of the shared test instance (support/media_library.mjs takes it at import,
// belegeTestInstanz() anywhere else) must be on the serial list, or it fails with "Testinstanz ... belegt" next to the serial stage of
// tests/run.sh full. Static imports and import('...') with a literal path are followed through tests/ (fixtures and support included).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g;
const SPERRE = path.join(HIER, 'support', 'media_library.mjs');

function sperrt(datei, gesehen = new Map()) {
  const p = path.normalize(datei);
  if (gesehen.has(p)) return gesehen.get(p);
  gesehen.set(p, false);   // a cycle does not lock by itself
  if (p === SPERRE) { gesehen.set(p, true); return true; }
  if (!p.startsWith(HIER + path.sep) || !fs.existsSync(p) || !fs.statSync(p).isFile()) return false;
  const text = fs.readFileSync(p, 'utf8');
  let ja = /^\s*belegeTestInstanz\(\)/m.test(text);
  for (const m of text.matchAll(IMPORT)) {
    if (ja) break;
    ja = sperrt(path.join(path.dirname(p), m[1]), gesehen);
  }
  gesehen.set(p, ja);
  return ja;
}

const seriell = fs.readFileSync(path.join(HIER, 'serial.txt'), 'utf8').split('\n').map((z) => z.trim()).filter((z) => z && !z.startsWith('#'));

test('every test file that takes the test instance lock is on the serial list', () => {
  const dateien = fs.readdirSync(HIER).filter((n) => n.endsWith('.test.mjs')).sort();
  const fehlt = dateien.filter((n) => !seriell.includes(n) && sperrt(path.join(HIER, n)));
  assert.deepEqual(fehlt, [], 'add these files to tests/serial.txt');
});

test('the serial list names existing files only', () => {
  assert.deepEqual(seriell.filter((n) => !fs.existsSync(path.join(HIER, n))), []);
});

test('negative control: the walk finds the lock through a fixture module, and a pure model test does not lock', () => {
  assert.equal(sperrt(path.join(HIER, 'taktart_4_server.test.mjs')), true);
  assert.equal(sperrt(path.join(HIER, 'szenen_bar.test.mjs')), false);
});
