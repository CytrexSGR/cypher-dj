// DJ view places, task 14: the page grid cells and the place switch. The page is not run here (the browser check covers it); like page_decks.test.mjs
// this reads app.js, index.html and style.css. The node handling itself is pure and tested in slots.test.mjs (wendeAn).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const lies = (n) => fs.readFileSync(path.join(PUBLIC, n), 'utf8');
const app = lies('app.js'), html = lies('index.html'), css = lies('style.css');
const funktion = (name) => { const a = app.indexOf(`function ${name}(`); assert.ok(a >= 0, name); return app.slice(a, app.indexOf('\n}\n', a) + 3); };

test('the page has four place heads with a type switch each, and a Loops node that holds the live panel', () => {
  for (const n of [1, 2, 3, 4]) assert.match(html, new RegExp(`class="platzkopf" data-platz-kopf="${n}"`), `head ${n}`);
  assert.equal((html.match(/data-platz-typ="track"/g) ?? []).length, 4);
  assert.equal((html.match(/data-platz-typ="strudel"/g) ?? []).length, 4);
  assert.equal((html.match(/data-platz-typ="loops"/g) ?? []).length, 4);
  assert.match(html, /<section id="platz-loops"[\s\S]*?<section id="live-panel"/);
});

test('the CSS gives the four cells by data-platz, beats the id rules, and leaves the Studio view alone', () => {
  for (const n of [1, 2, 3, 4]) assert.match(css, new RegExp(`body:not\\(\\.studio\\) #pult > \\[data-platz="${n}"\\] \\{ grid-area: p${n}; \\}`));
  assert.match(css, /body:not\(\.studio\) #pult \{[^}]*"h1 mo h2" "p1 mo p2" "h3 mu h4" "p3 mu p4"/);
  assert.match(css, /body:not\(\.studio\) \.platz-aus \{ display: none !important; \}/);
  assert.match(css, /body\.studio \.platzkopf, body\.studio #platz-loops \{ display: none; \}/);
  assert.doesNotMatch(css, /body\.live-offen #pult/);
  assert.match(css, /body\.studio #pult \{[^}]*"c c mo" "mu d mo"/, 'the Studio areas are as they were');
});

test('applying the layout only changes attributes of the existing nodes (no rebuild), at the start and after every switch', () => {
  const f = funktion('wendePlaetzeAn');
  assert.match(f, /wendeAn\(plaetzeLayout, platzKnoten\)/);
  assert.doesNotMatch(f, /innerHTML|cloneNode|createElement|replaceChildren|\.remove\(\)/);
  assert.match(app, /^bindePlaetze\(\);$/m);
  assert.match(funktion('bindePlaetze'), /wendePlaetzeAn\(\);\s*\}/);
});

test('a Track place N plays deck N: the node of place N is the section of deck N and nothing offers a deck choice', () => {
  assert.match(app, /key\.startsWith\('deck\/'\) \? \$\(`\.deck\[data-deck="\$\{key\.slice\(5\)\}"\]`\)/);
  assert.doesNotMatch(html, /data-platz-deck|deckwahl/);
  assert.match(funktion('platzZustand'), /const n = platz,/);
});

test('a switch asks the silence rule first and a refusal keeps the layout, says why and saves nothing', () => {
  const f = funktion('bindePlaetze');
  assert.match(f, /wechsel\(plaetzeLayout, platz, b\.dataset\.platzTyp, still\(plaetzeLayout, platz, zustand\.regler\)\)/);
  assert.match(f, /if \(!r\.ok\) \{ melde\(.*zeigePlaetze\(\); return; \}/);
  assert.ok(f.indexOf('if (!r.ok)') < f.indexOf('speichereLayout('), 'saved only after the accepted switch');
  const z = funktion('zeigePlaetze');
  assert.match(z, /b\.disabled = !w\.aktuell && \(!w\.frei \|\| !s\.still\)/, 'the buttons are disabled while the place is not silent');
  assert.match(z, /close it to switch/);
});

test('the layout is stored and read in try/catch under djk-plaetze, and the page never writes a crossfader side or a channel for a switch', () => {
  assert.match(app, /const speicherOderNull = \(\) => \{ try \{ return localStorage; \} catch \{ return null; \} \};/);
  assert.match(app, /let plaetzeLayout = ladeLayout\(speicherOderNull\(\)\);/);
  const block = app.slice(app.indexOf('// ---------- DJ view places'), app.indexOf('// ---------- Aufbau'));
  assert.doesNotMatch(block, /\/regler|xseite|deckPost|fetch\(/);
  assert.match(lies('slots.js'), /export const SCHLUESSEL = 'djk-plaetze';/);
});

test('the places follow the state: the heads refresh on every row, deck and live change', () => {
  for (const name of ['zeigeWert', 'zeigeDeck', 'zeichneLive']) assert.match(funktion(name), /zeigePlaetzeSpaeter\(\);/, name);
});
