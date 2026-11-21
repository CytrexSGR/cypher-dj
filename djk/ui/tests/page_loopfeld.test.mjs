// Places plan, slice 3 task 12: loop field D leaves the DJ view. The L1 and L2 strips stay (they are the pad/1 and pad/2 channel strips), the loop
// boxes (fields, waveform, grid) go, and the live panel takes the grid cell. Like page_decks.test.mjs this reads app.js, index.html and style.css.
import { liesApp } from './helpers/app_source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const lies = (n) => fs.readFileSync(path.join(PUBLIC, n), 'utf8');
const app = liesApp(), html = lies('index.html'), css = lies('style.css');

test('the page has no loop field D and no loop boxes', () => {
  assert.doesNotMatch(html, /id="deck-d"/);
  assert.doesNotMatch(html, /id="boxen"/);
  assert.doesNotMatch(html, /class="box"/);
  assert.doesNotMatch(html, /id="box-vorlage"/);
  assert.doesNotMatch(css, /#boxen|#deck-d|\.box\b/);
  for (const sym of ['zeigeBox', 'ladeLoopWelle', 'zeigeLoopRaster', 'loopRasterPost', 'holeLoopRaster', 'loopAnsicht', 'BOX_STATUS', 'data-boxplay'])
    assert.ok(!app.includes(sym), `${sym} is gone from app.js`);
});

test('the strips of the pad containers C and D are the container strips, built with the others; there is no L1/L2 pair', () => {
  assert.doesNotMatch(html, /data-boxzug/);
  assert.match(html, /data-kanalzug="pad\/1"/); assert.match(html, /data-kanalzug="pad\/2"/);
  assert.match(app, /for \(const c of CONTAINER\) baueZug\(\$\(`\.zug\[data-kanalzug="\$\{c\.pfad\}"\]`\), c\.pfad\);/);
  assert.match(app, /e\.dataset\.pfad = `\$\{k\}\/\$\{e\.dataset\.teil\}`/);
  assert.doesNotMatch(app, /baueLoopZuege|baueBoxen|LOOPBOXEN/);
});
