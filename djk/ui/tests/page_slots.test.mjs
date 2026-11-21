// DJ view places (container core U3): the page grid cells, the type switch and the places read from lage.plaetze. The page is not run here (seite_plaetze_senden
// runs it); like page_decks.test.mjs this reads the page sources and index.html and style.css.
import { liesApp } from './helpers/app_source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATZ_TYPEN, zugKopf } from '../public/slots.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const lies = (n) => fs.readFileSync(path.join(PUBLIC, n), 'utf8');
const app = liesApp(), html = lies('index.html'), css = lies('style.css');
const funktion = (name) => { const a = app.indexOf(`function ${name}(`); assert.ok(a >= 0, name); return app.slice(a, app.indexOf('\n}\n', a) + 3); };

test('four place heads with a type switch each: six buttons in the order of PLATZ_TYPEN, no Loops2 node', () => {
  for (const n of [1, 2, 3, 4]) assert.match(html, new RegExp(`class="platzkopf" data-platz-kopf="${n}"`), `head ${n}`);
  for (const typ of PLATZ_TYPEN) assert.equal((html.match(new RegExp(`data-platz-typ="${typ}"`, 'g')) ?? []).length, 4, typ);
  assert.equal((html.match(/data-platz-typ="/g) ?? []).length, 24);
  const kopf = html.slice(html.indexOf('data-platz-kopf="1"'), html.indexOf('data-platz-kopf="2"'));
  assert.deepEqual([...kopf.matchAll(/data-platz-typ="(\w+)"/g)].map((m) => m[1]), [...PLATZ_TYPEN]);
  assert.equal((html.match(/data-platz-typ="(remix|loops2)"/g) ?? []).length, 0, 'Remix is an effect with its own window, a second loop deck is a second loops entry');
  assert.match(html, /data-remix-oeffnen/);
  assert.match(html, /<section id="platz-remix"[^>]*>[\s\S]*?class="remix-ziele"[\s\S]*?class="remix-feld"/);
  assert.match(html, /<section id="platz-loops"[^>]*>\s*<div class="loopdeck" data-deck="1"><\/div>/);
  assert.match(html, /<section id="platz-loops2"[^>]*>\s*<div class="loopdeck" data-deck="2"><\/div>/);
});

test('the CSS gives the four cells by data-platz, beats the id rules, and leaves the Studio view alone', () => {
  for (const n of [1, 2, 3, 4]) assert.match(css, new RegExp(`body:not\\(\\.studio\\) #pult > \\[data-platz="${n}"\\] \\{ grid-area: p${n}; \\}`));
  assert.match(css, /body:not\(\.studio\) #pult \{[^}]*"h1 mo h2" "p1 mo p2" "h3 mu h4" "p3 mu p4"/);
  assert.match(css, /body:not\(\.studio\) \.platz-aus \{ display: none !important; \}/);
  assert.match(css, /body\.studio \.platzkopf, body\.studio #platz-loops, body\.studio #platz-loops2 \{ display: none; \}/);
  assert.doesNotMatch(css, /body\.live-offen #pult/);
  assert.match(css, /body\.studio #pult \{[^}]*"c c mo" "mu d mo"/, 'the Studio areas are as they were');
});

test('applying lage.plaetze only changes attributes of the existing nodes (no rebuild)', () => {
  for (const name of ['wendePlaetzeAn', 'ordneKnoten']) assert.doesNotMatch(funktion(name), /innerHTML|cloneNode|createElement|replaceChildren|\.remove\(\)/, name);
  assert.match(funktion('wendePlaetzeAn'), /ordneKnoten\(\);/);
  assert.match(app, /^bindePlaetze\(\);$/m);
  assert.match(funktion('bindePlaetze'), /wendePlaetzeAn\(\);[\s\S]*holeLage\(\);/);
});

test('a Track place N plays deck N: the node of place N is the section of deck N and nothing offers a deck choice', () => {
  assert.match(app, /track: \(n\) => \$\(`\.deck\[data-deck="\$\{n\}"\]`\),/);
  assert.doesNotMatch(html, /data-platz-deck|deckwahl/);
  assert.match(funktion('kopfText'), /zustand\.decks\[platz\]/);
});

test('a switch asks the silence rule first, a refusal keeps the head and saves nothing', () => {
  const f = funktion('wechsle');
  assert.match(f, /still\(zustand\.plaetze, platz, zustand\.regler\)/);
  assert.ok(f.indexOf('still(') < f.indexOf("fetch('/plaetze'"), 'the page asks first');
  assert.match(f, /if \(!r\.ok\) \{ melde\(.*zeigePlaetze\(\); return; \}/);
  assert.ok(f.indexOf('if (!r.ok)') < f.indexOf('await holeLage()'), 'the head follows /lage, not the answer');
  assert.match(funktion('zeigePlaetze'), /close it to switch/);
});

test('the places follow the state: the heads refresh on every row, deck and live change', () => {
  for (const name of ['zeigeWert', 'zeigeDeck', 'zeichneLive']) assert.match(funktion(name), /zeigePlaetzeSpaeter\(\);/, name);
});

test('the Remix plate: node, shown by the Remix window and not by a place, and the panel through the knob rows of fx/3 (FX3)', () => {
  assert.match(funktion('wendePlaetzeAn'), /if \(remixFenster\) \{ const r = \$\('#platz-remix'\); r\.hidden = false;/);
  assert.doesNotMatch(funktion('wechsle'), /typSperre/, 'Remix is not a place type, so no place switch is locked by it');
  assert.match(funktion('remixPanelBauen'), /baueFrontplatte\(feld, \{ panel: info\.panel, regler: info\.regler, adapter: remixAdapter, breit: true \}\)/);
  assert.match(app, /const fx3Adapter = kanalAdapter\(FX3_PLATZ\)/);
  assert.match(css, /#platz-remix \.remix-feld \{[^}]*overflow: hidden/);   // nothing scrolls: the plate is scaled into the place
  assert.match(funktion('remixEinpassen'), /platte\.style\.zoom = String\(Math\.max\(0\.3, z\)\)/);
  assert.match(css, /body\.studio #platz-remix \{ display: none; \}/);
});

test('the head names the strip: container letter and type', () => {
  const p = [{ typ: 'seq', gruppe: 'g1' }, { typ: 'track' }, { typ: 'strudel', gruppe: 'g2' }, { typ: 'leer' }];
  assert.deepEqual([1, 2, 3, 4].map((n) => zugKopf(p, n)), ['A seq', 'B track', 'C strudel', 'D empty']);
  assert.match(funktion('zeigeZugKoepfe'), /zugKopf\(zustand\.plaetze, n\)/);
});

test('the page keeps no layout: no storage key, no place channel, no crossfader write', () => {
  assert.doesNotMatch(app, /djk-plaetze|platz\/kanal|platzKanal|plaetze_alt/);
  const block = funktion('wendePlaetzeAn') + funktion('wechsle') + funktion('holeLage');
  assert.doesNotMatch(block, /localStorage|\/regler|xseite|deckPost|proj\/aendern/);
});
