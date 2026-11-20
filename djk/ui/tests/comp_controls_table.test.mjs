// The six-knob table of the channel compressor (face and live dock): pure, its rows pinned here (the strip detail it once mirrored is gone).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KOMP_SECHS } from '../public/comp_controls_table.js';

test('KOMP_SECHS: exactly six names in signal order', () => {
  assert.deepEqual(KOMP_SECHS.map((r) => r.name), ['THRESHOLD', 'RATIO', 'ATTACK', 'RELEASE', 'MAKEUP', 'MIX']);
  assert.deepEqual(KOMP_SECHS.map((r) => r.feld), ['schwelle', 'ratio', 'attack', 'release', 'makeup', 'mix']);
});

test('KOMP_SECHS: ranges, steps and defaults of the compressor rows (the face, the live dock knobs and the presets read them)', () => {
  assert.deepEqual(KOMP_SECHS.map((r) => [r.feld, r.min, r.max, r.schritt, r.vorgabe]), [
    ['schwelle', -60, 0, 0.5, -18], ['ratio', 1, 20, 0.1, 4], ['attack', 0.1, 100, 0.1, 10], ['release', 10, 1000, 1, 120], ['makeup', 0, 24, 0.1, 0], ['mix', 0, 1, 0.01, 1],
  ]);
});

test('comp_controls_table.js has no import (it breaks the import cycle)', () => {
  assert.doesNotMatch(readFileSync(new URL('../public/comp_controls_table.js', import.meta.url), 'utf8'), /^\s*import\s/m);
});
