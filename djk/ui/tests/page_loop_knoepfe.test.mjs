// Places plan, slice 3 task 11 (page part), reduced by loop deck P5: the deck export moved to the loop deck (page_loopdeck_export.test.mjs). The
// library's load buttons load into a loop deck cell (POST /loopdeck/laden).
import { liesApp } from './helpers/app_source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const app = liesApp();
const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

test('the page buttons use the new verbs and no old box route', () => {
  assert.doesNotMatch(app, /loopAktion\(\{ aktion: 'laden'/);
  assert.match(app, /ladeInDeck\(n, \{ loop: l\.name \}\)/);   // the LOOPS tab loads into a loop deck cell (fix round), no slot route
  // the library's → L1 / → L2 (loop deck P3) load through /loopdeck/laden with the deck's selected cell, not through the old import route
  assert.match(app, /await ladeInDeck\(n, \{ sha: t\.sha \}\)/);
  assert.match(app, /b\.disabled = !s\.aktiv \|\| loopImportLaeuft;/);
  assert.doesNotMatch(app, /\/loops\/aus-katalog/);
  assert.match(app, /'\/loopdeck\/laden', z \? \{ deck: nr, spur: z\.spur, zelle: z\.zelle, quelle \} : \{ deck: nr, quelle \}/);
  assert.deepEqual([...html.matchAll(/data-nachspur="(\d)"/g)].map((m) => m[1]), ['1', '2', '3', '4']);   // loop deck P5
});

test('a disabled button is dimmed like EXPORT: general button:disabled rule (opacity .35, cursor default)', () => {
  const css = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');
  assert.match(css, /^button:disabled \{ opacity: \.35; cursor: default; \}/m);
});

test('DJ view mixer strip: one grid, PFL and FX 1/2 in the cell beside LO, fader row takes the free room', () => {
  const css = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');
  assert.match(css, /body:not\(\.studio\) #pult \.zug \.knoepfe, body:not\(\.studio\) #pult \.zug \.faderspalte \{ display: contents; \}/);
  assert.match(css, /grid-template-rows: auto repeat\(3, auto\) minmax\(60px, 1fr\) auto auto;/);
  assert.match(css, /#pult \.zug \.pfl \{ grid-row: 4; grid-column: 1;/);
  assert.match(css, /#pult \.zug \.regler\.senkrecht \{ grid-row: 5; grid-column: 1 \/ -1; \}/);
});
