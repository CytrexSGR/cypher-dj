// Places plan, slice 3 task 12: loop field D leaves the DJ view. The L1 and L2 strips stay (they are the pad/1 and pad/2 channel strips), the loop
// boxes (fields, waveform, grid) go, and the live panel takes the grid cell. Like page_decks.test.mjs this reads app.js, index.html and style.css.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOOPBOXEN } from '../public/curves.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const lies = (n) => fs.readFileSync(path.join(PUBLIC, n), 'utf8');
const app = lies('app.js'), html = lies('index.html'), css = lies('style.css');

test('the page has no loop field D and no loop boxes', () => {
  assert.doesNotMatch(html, /id="deck-d"/);
  assert.doesNotMatch(html, /id="boxen"/);
  assert.doesNotMatch(html, /class="box"/);
  assert.doesNotMatch(html, /id="box-vorlage"/);
  assert.doesNotMatch(css, /#boxen|#deck-d|\.box\b/);
  for (const sym of ['zeigeBox', 'ladeLoopWelle', 'zeigeLoopRaster', 'loopRasterPost', 'holeLoopRaster', 'loopAnsicht', 'BOX_STATUS', 'data-boxplay'])
    assert.ok(!app.includes(sym), `${sym} is gone from app.js`);
});

test('the L1 and L2 strips stay and are wired to pad/1 and pad/2', () => {
  assert.deepEqual(LOOPBOXEN, ['pad/1', 'pad/2']);
  assert.match(html, /data-boxzug="1"/); assert.match(html, /data-boxzug="2"/);
  const f = app.slice(app.indexOf('function baueLoopZuege('));
  assert.match(f.slice(0, 900), /\$\(`\.zug\[data-boxzug="\$\{n\}"\]`\)/);
  assert.match(f.slice(0, 900), /dataset\.pfad = `\$\{k\}\/\$\{e\.dataset\.teil\}`/);
  assert.match(app, /^baueLoopZuege\(\);$/m);
  assert.doesNotMatch(app, /baueBoxen/);
});

test('the live panel has no row of its own any more (task 14 moves it into the Loops place)', () => {
  assert.match(css, /#live-panel \{[^}]*display: grid/);
  assert.doesNotMatch(css, /body\.live-offen #pult/);
  assert.doesNotMatch(css, /"l l l"/);
});
