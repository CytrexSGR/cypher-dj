// DJ view places, task 14: the page grid cells and the place switch. The page is not run here (the browser check covers it); like page_decks.test.mjs
// this reads app.js, index.html and style.css. The node handling itself is pure and tested in slots.test.mjs (wendeAn).
import { liesApp } from './helpers/app_source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TYPEN, LAYOUT_STANDARD, gueltig, ladeLayout, wechsel, still, kanaele, streifen, mixerPlan, wahl, kopf, knotenPlan, zugKopf, SCHLUESSEL } from '../public/slots.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const lies = (n) => fs.readFileSync(path.join(PUBLIC, n), 'utf8');
const app = liesApp(), html = lies('index.html'), css = lies('style.css');
const funktion = (name) => { const a = app.indexOf(`function ${name}(`); assert.ok(a >= 0, name); return app.slice(a, app.indexOf('\n}\n', a) + 3); };

test('the page has four place heads with a type switch each, and a Loops node and a Loops2 node with an empty deck container each', () => {
  for (const n of [1, 2, 3, 4]) assert.match(html, new RegExp(`class="platzkopf" data-platz-kopf="${n}"`), `head ${n}`);
  assert.equal((html.match(/data-platz-typ="track"/g) ?? []).length, 4);
  assert.equal((html.match(/data-platz-typ="strudel"/g) ?? []).length, 4);
  assert.equal((html.match(/data-platz-typ="loops"/g) ?? []).length, 4);
  assert.equal((html.match(/data-platz-typ="seq"/g) ?? []).length, 4, 'SEQ is the fourth type of every place (task 7)');
  assert.equal((html.match(/data-platz-typ="remix"/g) ?? []).length, 0, 'Remix is an effect with its own window, not a place type');
  assert.match(html, /data-remix-oeffnen/);
  assert.match(html, /<section id="platz-remix"[^>]*>[\s\S]*?class="remix-ziele"[\s\S]*?class="remix-feld"/);
  assert.equal((html.match(/data-platz-typ="loops2"/g) ?? []).length, 4, 'Loops 2 is a type of every place (loop deck P1)');
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
  assert.match(f, /wechsel\(plaetzeLayout, platz, b\.dataset\.platzTyp, still\(plaetzeLayout, platz, zustand\.regler\), seqAnsicht\(live\.projekt, platz\)\.vorhanden\)/);   // the fifth argument: the place holds a SEQ deck (task 7)
  assert.match(f, /if \(!r\.ok\) \{ melde\(.*zeigePlaetze\(\); return; \}/);
  assert.ok(f.indexOf('if (!r.ok)') < f.indexOf('speichereLayout('), 'saved only after the accepted switch');
  const z = funktion('zeigePlaetze');
  assert.match(z, /b\.disabled = !w\.aktuell && \(!w\.frei \|\| \(!s\.still && !belegt\) \|\| sp\.gesperrt\)/, 'the buttons are disabled while the place is not silent, unless it parks a SEQ deck');
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

test('the Remix plate: node, lock of the type switch and the panel through the knob rows of fx/3 (FX3)', () => {
  assert.match(app, /remix: '#platz-remix'/);
  assert.match(funktion('bindePlaetze'), /typSperre\(graphenGeladen\)\.gesperrt\) \{ melde/, 'the click handler refuses too');
  assert.match(funktion('remixPanelBauen'), /baueFrontplatte\(feld, \{ panel: info\.panel, regler: info\.regler, adapter: remixAdapter, breit: true \}\)/);
  assert.match(app, /const fx3Adapter = kanalAdapter\(FX3_PLATZ\)/);
  assert.match(css, /#platz-remix \.remix-feld \{[^}]*overflow: hidden/);   // nothing scrolls: the plate is scaled into the place
  assert.match(funktion('remixEinpassen'), /platte\.style\.zoom = String\(Math\.max\(0\.3, z\)\)/);
  assert.match(css, /body\.studio #platz-remix \{ display: none; \}/);
});

// ---------- the pure place model with the loop types (loop deck P1) ----------
const reglerOffen = { 'pad/1/trim': 0, 'pad/1/fader': 0, 'pad/2/trim': 0, 'pad/2/fader': 0, 'deck/1/trim': 0, 'deck/1/fader': 0 };

test('loops2 is a type, shown at most once like loops; both may sit together', () => {
  assert.ok(TYPEN.includes('loops2'));
  assert.equal(gueltig(['loops', 'loops2', 'track', 'seq']), true);
  assert.equal(gueltig(['loops2', 'loops2', 'track', 'seq']), false);
  assert.equal(gueltig(['loops', 'track', 'loops', 'seq']), false);
  const r = wechsel(['loops2', 'track', 'strudel', 'seq'], 2, 'loops2', true);
  assert.deepEqual([r.ok, r.grund], [false, 'doppelt']);
  assert.equal(wahl(['loops2', 'track', 'strudel', 'seq'], 2).find((w) => w.typ === 'loops2').frei, false);
  assert.equal(wechsel(['track', 'track', 'strudel', 'seq'], 1, 'loops2', true).ok, true);
});

test('the mixer plan always places L1 and L2 (pad/1, pad/2) in its row, with or without a loop place', () => {
  for (const layout of [[...LAYOUT_STANDARD], ['track', 'track', 'strudel', 'seq'], ['loops', 'loops2', 'strudel', 'seq'], ['loops2', 'seq', 'track', 'loops']]) {
    const plan = mixerPlan(layout);
    const pads = plan.reihen.flat().filter((s) => s?.art === 'pad');
    assert.deepEqual(pads.map((s) => s.kanal), ['pad/1', 'pad/2'], layout.join(' '));
    assert.ok(plan.reihen.every((r) => r.length === 4));
  }
  const ohne = mixerPlan(['track', 'track', 'strudel', 'seq']).reihen.flat().filter((s) => s?.art === 'pad');
  assert.deepEqual(ohne.map((s) => s.platz), [3, 4], 'the pads are the faders of places 3 and 4, whatever they show');
  const mit = mixerPlan(['loops2', 'track', 'strudel', 'loops']).reihen.flat().filter((s) => s?.art === 'pad');
  assert.deepEqual(mit.map((s) => [s.kanal, s.platz]), [['pad/1', 3], ['pad/2', 4]], 'row 2 stays [pad/1 left, pad/2 right]');
  // a loop deck in place 1 or 2 is steered by the deck strip of that place (the fader belongs to the place)
  assert.deepEqual(streifen(['loops', 'loops2', 'strudel', 'seq'], 1).map((s) => s.kanal), ['deck/1']);
  assert.deepEqual(streifen(['loops', 'loops2', 'strudel', 'seq'], 2).map((s) => s.kanal), ['deck/2']);
  assert.deepEqual(streifen(['track', 'track', 'loops', 'loops2'], 3), [], 'places 3 and 4 have the pad strips of the fixed row');
  const reihe1 = mixerPlan(['loops2', 'loops', 'strudel', 'seq']).reihen[0].filter(Boolean).map((s) => s.kanal);
  assert.deepEqual(reihe1, ['deck/1', 'deck/2']);
});

test('a loop place owns the channel of its place: the silence rule applies to it and its head names the strip', () => {
  for (const [typ, platz, kanal] of [['loops', 1, 'deck/1'], ['loops2', 2, 'deck/2'], ['loops', 3, 'pad/1'], ['loops2', 4, 'pad/2']]) {
    const layout = ['track', 'track', 'strudel', 'seq']; layout[platz - 1] = typ;
    assert.deepEqual(kanaele(layout, platz), [kanal]);
    assert.equal(still(layout, platz, { [`${kanal}/trim`]: 0, [`${kanal}/fader`]: 0 }).still, false, `${kanal} open`);
    const zu = still(layout, platz, { [`${kanal}/trim`]: 0, [`${kanal}/fader`]: -80 });
    assert.equal(zu.still, true);
    assert.equal(wechsel(layout, platz, 'seq', zu).ok, true);
  }
  assert.equal(still(['track', 'track', 'strudel', 'seq'], 1, reglerOffen).still, false, 'a Track place is judged as before');
});

test('zugKopf: the head of a strip names the channel and the loop deck that sounds on it', () => {
  const l = ['track', 'loops', 'loops2', 'seq'];
  assert.equal(zugKopf(l, 'deck', 1), 'A');
  assert.equal(zugKopf(l, 'deck', 2), 'B · LOOP 1');
  assert.equal(zugKopf(l, 'pad', 1), 'L1 · LOOP 2');
  assert.equal(zugKopf(l, 'pad', 2), 'L2');
  assert.equal(zugKopf(['loops2', 'track', 'track', 'loops'], 'deck', 1), 'A · LOOP 2');
  assert.equal(zugKopf(['loops2', 'track', 'track', 'loops'], 'pad', 2), 'L2 · LOOP 1');
});

test('the stored layout with only loops still loads; one with loops2 loads too; a broken one falls back', () => {
  const speicher = (v) => ({ getItem: (k) => (k === SCHLUESSEL ? v : null) });
  assert.deepEqual(ladeLayout(speicher(JSON.stringify(['track', 'track', 'strudel', 'loops']))), ['track', 'track', 'strudel', 'loops']);
  assert.deepEqual(ladeLayout(speicher(JSON.stringify(['loops', 'seq', 'track', 'seq']))), ['loops', 'seq', 'track', 'seq']);
  assert.deepEqual(ladeLayout(speicher(JSON.stringify(['track', 'loops2', 'strudel', 'loops']))), ['track', 'loops2', 'strudel', 'loops']);
  assert.deepEqual(ladeLayout(speicher(JSON.stringify(['loops2', 'loops2', 'track', 'seq']))), [...LAYOUT_STANDARD]);
});

test('the head names the deck and the node plan has a node for loops2', () => {
  assert.equal(kopf(1, { typ: 'loops' }), 'LOOP 1');
  assert.equal(kopf(3, { typ: 'loops2' }), 'LOOP 2');
  assert.equal(knotenPlan(['track', 'loops2', 'strudel', 'loops']).platz.loops2, 2);
});

// ---- place channel: places 3/4 report what they hold, the kern routes it into pad/1, pad/2 ----
import { platzKanalInhalt } from '../public/slots.js';
test('platzKanalInhalt: place 3 -> pad/1, place 4 -> pad/2; Strudel 1, track deck/3 = 2, deck/4 = 3, everything else 0', () => {
  assert.deepEqual(platzKanalInhalt(['track', 'track', 'strudel', 'loops']), [1, 0]);   // the default layout
  assert.deepEqual(platzKanalInhalt(['track', 'track', 'track', 'track']), [2, 3]);
  assert.deepEqual(platzKanalInhalt(['track', 'track', 'loops', 'strudel']), [0, 1]);
  assert.deepEqual(platzKanalInhalt(['strudel', 'seq', 'seq', 'loops2']), [2, 0]);   // places 1/2 never matter; a SEQ deck in place 3 plays on deck/3, which goes to pad/1; loops own their channel
});
test('wendePlaetzeAn reports the place channel at its end, so load, place switch and server follow all pass it', () => {
  const f = funktion('wendePlaetzeAn');
  assert.match(f.trimEnd().replace(/\n\}$/, ''), /meldePlatzKanal\(\);\s*$/);
  assert.match(app, /fetch\('\/platz\/kanal'/);
});
