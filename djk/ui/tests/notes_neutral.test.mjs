// NOTEN (note editor, N16): the modules of public/noten/ stay host-neutral so that a plugin shell can run them with an adapter of its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pruefeAdapter } from '../public/noten/contract.js';

const ORDNER = resolve(dirname(fileURLToPath(import.meta.url)), '../public/noten');
const dateien = readdirSync(ORDNER).filter((f) => f.endsWith('.js'));
const ohneKommentare = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const spezifizierer = (code) => [...code.matchAll(/(?:\bimport\s*(?:[\w*{}\s,]+\sfrom\s*)?|\bexport\s*(?:\*|\{[^}]*\})\s*from\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);

test('the five modules exist', () => {
  assert.deepEqual(dateien.sort(), ['view.js', 'operation.js', 'contract.js', 'zeichnen.js', 'time.js']);
});

test('no module under public/noten imports anything outside public/noten', () => {
  let gesehen = 0;
  for (const f of dateien) {
    const code = ohneKommentare(readFileSync(join(ORDNER, f), 'utf8'));
    for (const s of spezifizierer(code)) {
      gesehen++;
      assert.ok(s.startsWith('./') || s.startsWith('../'), `${f}: bare or absolute import ${s}`);
      const ziel = resolve(ORDNER, s);
      assert.ok(ziel.startsWith(ORDNER + sep), `${f}: ${s} leaves public/noten`);
    }
    for (const verboten of [/\bdocument\b/, /\bwindow\b/, /\bfetch\s*\(/, /\blocalStorage\b/, /\bEventSource\b/]) assert.ok(!verboten.test(code), `${f}: host global ${verboten}`);
  }
  assert.ok(gesehen >= 4, 'the scan found the imports between the modules');
});

test('the scan itself recognises an outside import (negative control)', () => {
  assert.deepEqual(spezifizierer("import { a } from '../production/x.js';\nexport * from './y.js';\nconst z = await import('/abs.js');\nimport './s.js';"),
    ['../production/x.js', './y.js', '/abs.js', './s.js']);
  assert.ok(!resolve(ORDNER, '../production/x.js').startsWith(ORDNER + sep));
});

test('pruefeAdapter names every missing member of an incomplete adapter', () => {
  assert.deepEqual(pruefeAdapter({ lies() {}, schreibe() {}, abonniere() {} }), []);
  assert.deepEqual(pruefeAdapter({}), ['lies', 'schreibe', 'abonniere']);
  assert.deepEqual(pruefeAdapter({ lies() {} }), ['schreibe', 'abonniere']);
  assert.deepEqual(pruefeAdapter({ lies() {}, schreibe: 5, abonniere() {} }), ['schreibe'], 'a member of the wrong type is named too');
  assert.deepEqual(pruefeAdapter(null), ['lies', 'schreibe', 'abonniere']);
  assert.deepEqual(pruefeAdapter(undefined), ['lies', 'schreibe', 'abonniere']);
});
