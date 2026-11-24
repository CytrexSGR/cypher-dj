// Shared text helpers of the page (public/format_text.js) and the dark form-control rule of style.css.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { datumText, zaehlText } from '../public/format_text.js';

test('zaehlText: singular, default plural, explicit plural, zero', () => {
  assert.equal(zaehlText(1, 'slice'), '1 slice');
  assert.equal(zaehlText(2, 'slice'), '2 slices');
  assert.equal(zaehlText(0, 'cut'), '0 cuts');
  assert.equal(zaehlText(2, 'child', 'children'), '2 children');
});

test('datumText: en-GB medium date with short time, a dash for missing or invalid values', () => {
  const t = datumText('2026-11-22T23:01:00');
  assert.match(t, /Nov 2026/);
  assert.match(t, /23:01/);
  assert.equal(datumText(null), '–');
  assert.equal(datumText(undefined), '–');
  assert.equal(datumText('nonsense'), '–');
});

test('style.css: the first :root block sets color-scheme dark, a low-specificity rule darkens form controls', () => {
  const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'style.css'), 'utf8');
  const wurzel = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  assert.match(wurzel, /color-scheme:\s*dark/);
  assert.match(css, /input, select, textarea \{ background: var\(--panel2\); color: var\(--text\); border: 1px solid var\(--line\); \}/);
});
