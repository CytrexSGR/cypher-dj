// The six-knob table of the channel compressor face: pure, pinned to KOMP_DETAIL of effects_view.js (read as text: the module pulls half the page in).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KOMP_SECHS } from '../public/comp_controls_table.js';

const ansicht = readFileSync(new URL('../public/effects_view.js', import.meta.url), 'utf8');
const detail = [...ansicht.slice(ansicht.indexOf('export const KOMP_DETAIL')).split('];')[0].matchAll(/feld: '(\w+)', name: '(\w+)', min: ([-\d.]+), max: ([-\d.]+), schritt: ([\d.]+), vorgabe: ([-\d.]+)/g)]
  .map((m) => ({ feld: m[1], name: m[2], min: Number(m[3]), max: Number(m[4]), schritt: Number(m[5]), vorgabe: Number(m[6]) }));

test('KOMP_SECHS: exactly six names in the order of the strip detail', () => {
  assert.deepEqual(KOMP_SECHS.map((r) => r.name), ['THRESHOLD', 'RATIO', 'ATTACK', 'RELEASE', 'MAKEUP', 'MIX']);
  assert.deepEqual(KOMP_SECHS.map((r) => r.feld), ['schwelle', 'ratio', 'attack', 'release', 'makeup', 'mix']);
});

test('KOMP_SECHS: min, max, step and default equal the fields of KOMP_DETAIL (the two tables cannot drift apart)', () => {
  assert.equal(detail.length, 6, 'the regular expression found the six rows of KOMP_DETAIL');
  for (const [i, r] of KOMP_SECHS.entries()) {
    const d = detail[i];
    assert.deepEqual({ feld: r.feld, name: r.name, min: r.min, max: r.max, schritt: r.schritt, vorgabe: r.vorgabe }, d, r.feld);
  }
});

test('comp_controls_table.js has no import (it breaks the import cycle)', () => {
  assert.doesNotMatch(readFileSync(new URL('../public/comp_controls_table.js', import.meta.url), 'utf8'), /^\s*import\s/m);
});
