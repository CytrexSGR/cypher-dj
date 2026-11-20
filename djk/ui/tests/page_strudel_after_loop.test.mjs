// Strudel place -> loop deck: the row "LOOP 1 1 2 3 4  LOOP 2 1 2 3 4" records the Strudel sum (erz/1+2+3) and loads it into a loop deck track.
import { liesApp } from './helpers/app_source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const rec = fs.readFileSync(path.join(PUBLIC, 'loop_rec_view.js'), 'utf8');
const ansicht = fs.readFileSync(path.join(PUBLIC, 'loopdeck', 'view.js'), 'utf8');
const app = liesApp();

test('the Strudel header has one button per loop deck track, 2 decks x 4 tracks, in the REC row', () => {
  const strudel = html.slice(html.indexOf('id="deck-c"'), html.indexOf('class="instanzen"'));
  assert.deepEqual([...strudel.matchAll(/data-recziel="(\d:\d)"/g)].map((m) => m[1]), ['1:1', '1:2', '1:3', '1:4', '2:1', '2:2', '2:3', '2:4']);
  assert.ok(strudel.indexOf('id="rec-knopf"') < strudel.indexOf('data-recziel'), 'the row comes after REC');
});

test('a click records the sum for the chosen length and the finished loop goes into the track', () => {
  assert.match(rec, /starteRec\(true, \{ deck, spur \}\)/);
  assert.match(rec, /\{ aktion: 'rec', beats: recBeats, name, summe: 1 \}/);
  assert.match(rec, /if \(ziel && ok === true\) ladeLoopInSpur\(ziel\.deck, ziel\.spur, name\)/);
  assert.match(rec, /\$\('#rec-knopf'\)\.addEventListener\('click', \(\) => starteRec\(false, null\)\)/);   // plain REC stays erz/1
  assert.match(ansicht, /'\/loopdeck\/laden', \{ deck: nr, spur, quelle: \{ loop: name \} \}/);   // no cell: the server takes the first empty one
  assert.ok(app.length > 0);
});
