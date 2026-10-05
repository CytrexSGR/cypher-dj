import test from 'node:test';
import assert from 'node:assert/strict';
import { kompiliere } from '../src/kompiliere.mjs';

test('gültiges Muster, auch über mehrere Zeilen', () => {
  assert.equal(typeof kompiliere('s("bd*4")').muster.queryArc, 'function');
  const m = kompiliere('stack(\n  s("bd*4"),\n  s("[~ hh]*4").gain(0.6)\n)').muster;
  assert.equal(m.queryArc(0, 1).filter((h) => h.hasOnset()).length, 8);
});

test('Syntaxfehler mit Zeilennummer', () => {
  const r = kompiliere('s("bd*4")\n  .gain(');
  assert.match(r.fehler, /^Zeile 2: /);
});

test('Mini-Notation kaputt, kein Muster, leer', () => {
  assert.match(kompiliere('s("bd*[")').fehler, /^Zeile 1: /);
  assert.match(kompiliere('42').fehler, /kein Strudel-Muster/);
  assert.match(kompiliere('  \n ').fehler, /leer/);
});
