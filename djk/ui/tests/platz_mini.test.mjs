// Mini view of a Track place and the side columns of the DJ view (platz_mini.js, 2026-11-14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ladeMini, speichereMini, istMini, umschalten, SPALTEN } from '../public/platz_mini.js';

const speicher = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('mini state survives a reload and ignores junk', () => {
  const s = speicher();
  speichereMini(s, new Set([2, 1]));
  assert.deepEqual([...ladeMini(s)].sort(), [1, 2]);
  s.setItem('djk-platz-mini', '[7, "x", 3]');
  assert.deepEqual([...ladeMini(s)], [3]);
  s.setItem('djk-platz-mini', '{');
  assert.equal(ladeMini(s).size, 0);
  assert.equal(ladeMini(null).size, 0);
  const kaputt = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(ladeMini(kaputt).size, 0);
  speichereMini(kaputt, new Set([1]));   // must not throw
});

test('only a place that shows a track can be mini', () => {
  const layout = ['track', 'track', 'strudel', 'loops'];
  const mini = new Set([1, 3]);
  assert.equal(istMini(layout, mini, 1), true);
  assert.equal(istMini(layout, mini, 2), false);
  assert.equal(istMini(layout, mini, 3), false);   // Strudel never folds, even with a stale flag
});

test('umschalten flips one place and leaves the input alone', () => {
  const a = new Set([1]);
  const b = umschalten(a, 2), c = umschalten(b, 1);
  assert.deepEqual([...a], [1]);
  assert.deepEqual([...b].sort(), [1, 2]);
  assert.deepEqual([...c], [2]);
});

test('page: two side columns hold the places, top place first', () => {
  assert.deepEqual(SPALTEN, { l: [1, 3], r: [2, 4] });
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const s of ['l', 'r']) assert.match(html, new RegExp(`<div class="seitenspalte" data-seite="${s}"></div>`));
  assert.equal((html.match(/data-platz-mini/g) ?? []).length, 4);
  const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.seitenspalte \{ display: contents; \}/);   // the Studio view keeps its grid areas
  assert.match(css, /\.seitenspalte > \[data-platz\]\.mini \{ flex: 0 0 auto; \}/);
});
