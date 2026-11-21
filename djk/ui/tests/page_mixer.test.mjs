// Container core U4: the mixer row shows the four container strips A..D, each in the cell of its place. The cells are static in index.html (no plan is
// computed in the page); the strips keep their template and core lines.
import { liesApp } from './helpers/app_source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZIELE } from '../public/curves.js';
import { CONTAINER } from '../public/kanaele.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const lies = (n) => fs.readFileSync(path.join(PUBLIC, n), 'utf8');
const app = liesApp(), html = lies('index.html'), css = lies('style.css');

const vorlage = html.slice(html.indexOf('<template id="zug-vorlage">'), html.indexOf('</template>', html.indexOf('<template id="zug-vorlage">')));
const TEILE = [...vorlage.matchAll(/data-teil="([^"]+)"/g)].map((m) => m[1]);
/** the container strips of the markup: path, row and column of the grid cell */
const zuege = [...html.matchAll(/<div class="zug"([^>]*data-kanalzug="((?:deck|pad)\/\d)"[^>]*)>/g)]
  .map((m) => ({ pfad: m[2], zeile: /data-mix-zeile="(\d)"/.exec(m[1])?.[1], spalte: /data-mix-spalte="(\d)"/.exec(m[1])?.[1], deck: /data-deck="(\d)"/.exec(m[1])?.[1] }));

test('the strip template carries fader, trim, EQ, filter, PFL and the crossfader side', () => {
  for (const t of ['fader', 'trim', 'eq/hoch', 'eq/mitte', 'eq/tief', 'filter', 'pfl', 'xseite']) assert.ok(TEILE.includes(t), t);
});

test('the four container strips sit in the cells of places 1..4: A and C left of the middle, B and D right of it', () => {
  assert.deepEqual(zuege.map((z) => z.pfad), CONTAINER.map((c) => c.pfad), 'one strip per container, in the order of the places');
  assert.deepEqual(zuege.map((z) => [z.zeile, z.spalte]), [['1', '2'], ['1', '4'], ['2', '2'], ['2', '4']]);
  assert.deepEqual(zuege.filter((z) => z.deck).map((z) => [z.deck, z.pfad]), [['1', 'deck/1'], ['2', 'deck/2']], 'the strips of the players keep their data-deck');
  for (const z of zuege) for (const t of TEILE) assert.ok(ZIELE.has(`${z.pfad}/${t}`), `${z.pfad}/${t} is a control target`);
  assert.match(html, /<div class="mitte" data-mix-zeile="1" data-mix-spalte="3">/);
  assert.match(html, /<div class="fxmitte" id="fxmitte" data-mix-zeile="2" data-mix-spalte="3"/);
});

test('the page computes no mixer plan: no plan function, no data-mix write, no loop deck output write, no L1/L2 strip', () => {
  assert.doesNotMatch(app, /mixerPlan|wendeMixerAn|zugKnoten|mixAussen|mixZeile|mixSpalte/);
  assert.doesNotMatch(app, /\/loopdeck\/plaetze/);
  assert.doesNotMatch(html, /data-boxzug/);
});

test('the DJ view lets the strips take cells of the page grid around a fixed middle column (master, beat FX), the crossfader below, the Studio view is untouched', () => {
  assert.match(css, /body:not\(\.studio\) #mischer, body:not\(\.studio\) #mischer-unten \{ display: contents; \}/);
  assert.match(css, /body:not\(\.studio\) #pult \{ grid-template-columns: minmax\(0, 1fr\) var\(--zug\) var\(--mitte\) var\(--zug\) minmax\(0, 1fr\);/);
  assert.doesNotMatch(css, /data-mix-aussen/, 'the outer strip columns are gone: the four strips always fit the five columns');
  assert.match(css, /\[data-mix-zeile="1"\] \{ grid-row: 1 \/ 3; \}/);
  assert.match(css, /\.xfader \{ grid-area: 5 \/ 2 \/ 6 \/ -2;/);
  assert.match(html, /<div class="fxmitte" id="fxmitte"/);
  assert.match(css, /body\.studio #pult \{[^}]*"c c mo" "mu d mo"/);
  assert.match(css, /body\.studio #mischer-unten \{ grid-template-columns: repeat\(5, var\(--zug\)\)/);
});

test('the strip heads name the container letter and the type: the strip of place N is found by its container path', () => {
  const f = app.slice(app.indexOf('function zeigeZugKoepfe('), app.indexOf('function zeigeStudioZuege('));
  assert.match(f, /\.zug\[data-kanalzug="\$\{pfadVonPlatz\(n\)\}"\] \.zugname/);
  assert.match(f, /zugKopf\(zustand\.plaetze, n\)/);
  assert.doesNotMatch(f, /innerHTML|cloneNode|createElement/);
});
