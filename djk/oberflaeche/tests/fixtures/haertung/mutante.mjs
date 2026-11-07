// Mutation helper for the hardening tests (tests/haertung_*.test.mjs).
//
// Every hardening file must contain at least one test that demonstrably fails against a deliberately broken copy of the
// module logic. This helper builds that broken copy: it reads the real module source, applies exact text replacements
// (each `alt` must occur exactly once, so a refactor of the module makes the mutation test fail loudly instead of silently
// testing nothing), rewrites the relative imports ('./x.ts') to absolute file URLs of the real modules, writes the result
// to a temporary directory and imports it. The real module files are never touched.
//
// Usage in a test: `const m = await ladeMutante(t, 'katalog.ts', [['old text', 'new text']]);` then run the same check
// function against `m` and assert that it fails (`await assert.rejects(() => pruefe(m))`).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const MODULE_DIR = path.resolve(import.meta.dirname, '..', '..', '..');

let zaehler = 0;

export async function ladeMutante(t, modul, ersetzungen) {
  const quelle = path.join(MODULE_DIR, modul);
  let text = fs.readFileSync(quelle, 'utf8');
  for (const [alt, neu] of ersetzungen) {
    const n = text.split(alt).length - 1;
    if (n !== 1) throw new Error(`mutation of ${modul}: expected exactly one occurrence of ${JSON.stringify(alt)}, found ${n}`);
    text = text.replace(alt, () => neu);
  }
  // relative imports → absolute URLs of the real neighbour modules
  text = text.replace(/from '\.\/([^']+)'/g, (_, rel) => `from '${pathToFileURL(path.join(MODULE_DIR, rel)).href}'`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-haertung-mutante-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ziel = path.join(dir, `${path.basename(modul, '.ts')}.mutante${++zaehler}.ts`);
  fs.writeFileSync(ziel, text);
  return import(pathToFileURL(ziel).href);
}

export function tmpDir(t, praefix = 'djk-haertung-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), praefix));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
