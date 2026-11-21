// Places plan, slice 1 task 3: the page deck code works over a list of N decks. The page is not run here (the browser check of the task covers
// the running page); like live_page.test.mjs this reads app.js, index.html and style.css, and runs the pure parts.
import { liesApp } from './helpers/app_source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECKS } from '../public/curves.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const lies = (n) => fs.readFileSync(path.join(PUBLIC, n), 'utf8');
const app = liesApp(), html = lies('index.html'), css = lies('style.css');
const funktion = (name) => {   // body of a top-level function of app.js, up to the next top-level line that is not part of it
  const a = app.indexOf(`function ${name}(`);
  assert.ok(a >= 0, `function ${name}`);
  const b = app.indexOf('\n}\n', a);
  return app.slice(a, b + 3);
};

test('the page builds a section for every deck of DECKS (1 to 4) and a channel strip for decks 1 and 2 only', () => {
  assert.deepEqual(DECKS, [1, 2, 3, 4]);
  for (const n of DECKS) {
    assert.match(html, new RegExp(`<section class="deck" data-deck="${n}"`), `section ${n}`);
    if (n <= 2) assert.match(html, new RegExp(`<div class="zug" data-deck="${n}"`), `strip ${n}`);
    else assert.doesNotMatch(html, new RegExp(`class="zug" data-deck="${n}"`), `no strip ${n}: the main mixer has four channels (A, B, L1, L2)`);
  }
  assert.match(funktion('baueDecks'), /for \(const n of DECKS\)/);
  assert.match(funktion('baueDecks'), /\.deck\[data-deck="\$\{n\}"\]/);
  assert.match(funktion('baueDecks'), /for \(const c of CONTAINER\) baueZug\(\$\(`\.zug\[data-kanalzug="\$\{c\.pfad\}"\]`\), c\.pfad\)/, 'the strips are the container strips');
});

test('decks 3 and 4 are hidden in the old layout, decks 1 and 2 are not; the hidden rule beats the layout rules', () => {
  for (const n of [3, 4]) {
    assert.match(html, new RegExp(`<section class="deck" data-deck="${n}"[^>]*\\bhidden>`), `section ${n} hidden`);
  }
  for (const n of [1, 2]) {
    assert.doesNotMatch(html, new RegExp(`<section class="deck" data-deck="${n}"[^>]*\\bhidden>`), `section ${n} shown`);
    assert.doesNotMatch(html, new RegExp(`<div class="zug" data-deck="${n}"[^>]*\\bhidden>`), `strip ${n} shown`);
  }
  assert.match(css, /\.deck\[hidden\], \.zug\[hidden\] \{ display: none !important; \}/);
  // decks 3 and 4 have no channel strip anywhere on the page (Andreas 2026-11-15); #mischer-unten keeps the strips of containers C and D
  assert.doesNotMatch(html, /class="zug" data-deck="[34]"/);
  assert.match(html, /id="mischer-unten"[\s\S]*?data-kanalzug="pad\/1"/);
});

test('nothing in app.js compares a deck number against 2, and DECK3 is not a special case any more', () => {
  assert.doesNotMatch(app, /\bDECK3\b/);
  assert.doesNotMatch(app, /\bf\.deck\s*<=\s*2\b/);
  assert.doesNotMatch(app, /\bdeck\s*(?:<=|<|===|!==)\s*2\b/);
  assert.doesNotMatch(app, /\[1, 2, DECK3\]|zeigeDeck\(1\); zeigeDeck\(2\)/);
});

test('a deck state message updates the section of the deck, shown or hidden (places plan task 16: the deck 3 bar is gone)', () => {
  const z = app.slice(app.indexOf("case '/zustand/deck':"), app.indexOf("case '/e/fx':"));
  assert.match(z, /if \(deckAnsicht\[f\.deck\]\) zeigeDeck\(f\.deck\);/);
  assert.match(z, /\/e\/hotcue': if \(deckAnsicht\[f\.deck\]\) holeHotcues/);
  assert.match(z, /\/e\/raster': if \(deckAnsicht\[f\.deck\]\) holeRaster/);
  const g = app.slice(app.indexOf("case '/e/geladen':"), app.indexOf("case '/q':"));
  assert.match(g, /if \(deckAnsicht\[f\.deck\]\) zeigeDeck\(f\.deck\);/);
  assert.match(app, /DECKS\.forEach\(zeigeDeck\); pruefeLiveSpaeter\(0\)/, 'a (re)connect redraws every deck');
});

test('the deck 3 bar is gone: no bar code, no STREIFEN_DECKS, and the deck section carries SYNC', () => {
  assert.doesNotMatch(app, /STREIFEN_DECKS|baueStreifen|zeigeStreifen|streifenPost/);
  assert.doesNotMatch(html, /id="deck-3"|deckstreifen|data-deck3/);
  assert.doesNotMatch(css, /#deck-3/);
  assert.match(html, /<button class="taste sync" data-sync /);
  assert.match(app, /\$\('\[data-sync\]', d\)\.addEventListener\('click', \(\) => deckPost\('\/deck\/start', \{ deck: n, ab: 'takt' \}/);
});

test('the export button state is computed per deck, for every button of that deck (bar and section)', () => {
  const f = funktion('zeigeExport');
  assert.match(f, /\$\$\(`\[data-exportloop="\$\{n\}"\]`\)/);
  assert.match(app, /for \(const n of DECKS\) zeigeExport\(n\);/);
  assert.doesNotMatch(f, /loopsPlatzDa|liveOffen/, 'the export no longer depends on a Loops place or on an open live container (loop deck P5)');
});

test('the draw loop skips hidden deck sections; the library offers LOAD for all four decks', () => {
  assert.match(app, /if \(a\.sektion\.hidden\) continue;/);
  assert.match(app, /sektion: d, lauf: new Laufansicht/);
  assert.match(app, /const LADE_DECKS = \[1, 2, 3, 4\];/);
});

test('an empty deck names how to open the library (newcomer test 2026-11-20: the hint led nowhere)', () => {
  assert.match(html, /data-meta>Pick a track in the library \(⤢ or G opens it\) and press LOAD</);
});
