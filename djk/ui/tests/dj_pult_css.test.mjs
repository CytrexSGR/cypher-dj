// UI polish task 5: pins of the DJ desk rules that only Chrome shows (the DOM stand-in has no layout). The measured numbers are in the task report.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const css = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');
const loopCss = fs.readFileSync(path.join(PUBLIC, 'loopdeck', 'loopdeck.css'), 'utf8');

test('the big browser leaves the desk only the place heads, the mini decks and the crossfader', () => {
  const zeile = css.split('\n').find((l) => l.startsWith('body.lib-gross:not(.studio) #pult :is('));
  assert.ok(zeile, 'the rule exists');
  assert.ok(zeile.endsWith('{ display: none; }'));
  for (const s of ['.zug', '.mitte', '.fxmitte', '#platz-loops', '#platz-loops2', '[data-platz]:not(.mini)']) assert.ok(zeile.includes(s), s);
  assert.ok(!zeile.includes('.xfader') && !zeile.includes('.platzkopf'), 'crossfader and heads stay');
});

test('small keys get a transparent hit area: K 20 x 20, the wider keys grow in height; static keys become the anchor with zero specificity', () => {
  assert.match(css, /#pult \.kill\.schalter::before \{ content: ''; position: absolute; inset: -3px; \}/);
  assert.match(css, /\.pfl\.schalter[^{]*::before[^{]*\{ content: ''; position: absolute; inset: -3px -1px; \}/);
  assert.match(css, /:where\(#pult \.kill\.schalter[^)]*\) \{ position: relative; \}/);
});

test('the FX keys of a strip and A THRU B have a full-width row of their own', () => {
  assert.match(css, /#pult \.zug \.fxzuweisung \{ grid-row: 7; grid-column: 1 \/ -1;/);
  assert.match(css, /#pult \.zug \.xzuweisung \{ grid-row: 8; grid-column: 1 \/ -1; \}/);
});

test('the loop deck head keeps each key on one line and wraps as a whole', () => {
  assert.match(loopCss, /\.ld-deckname, \.ld-r, \.ld-stopall, \.ld-set, \.ld-neu \{ white-space: nowrap; \}/);
  assert.match(loopCss, /\.ld-kopfzeile \{ flex-wrap: wrap;/);
});
