// DJ view places, task 16: the Loops place carries the live container. The page never opens it by itself and never closes it; EXPORT and the library
// load buttons need a Loops place. Like page_decks.test.mjs this reads app.js, index.html and style.css and runs the pure parts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportKnopf, modulAnsicht, modulHtml } from '../public/live_module.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const lies = (n) => fs.readFileSync(path.join(PUBLIC, n), 'utf8');
const app = lies('app.js'), html = lies('index.html'), css = lies('style.css'), modul = lies('live_module.js');
const funktion = (name) => { const a = app.indexOf(`function ${name}(`); assert.ok(a >= 0, name); return app.slice(a, app.indexOf('\n}\n', a) + 3); };

test('without a Loops place EXPORT is off with the hint; with one it is as before', () => {
  const ohne = exportKnopf({ loop: true, geladen: true, live: true, loopsPlatz: false });
  assert.equal(ohne.aus, true); assert.match(ohne.titel, /switch a place to LOOPS/);
  assert.equal(exportKnopf({ loop: true, geladen: true, live: true, loopsPlatz: true }).aus, false);
  assert.equal(exportKnopf({ loop: true, geladen: true, live: true }).aus, false, 'the default keeps the old callers working');
  assert.equal(exportKnopf({ loop: false, geladen: true, live: true, loopsPlatz: true }).aus, true);
});

test('the page disables EXPORT, the deck LOOP -> L buttons and the library load buttons without a Loops place, with the hint', () => {
  assert.match(app, /const HINWEIS_LOOPS = 'switch a place to LOOPS';/);
  assert.match(app, /const loopsPlatzDa = \(\) => plaetzeLayout\.includes\('loops'\);/);
  assert.match(funktion('zeigeExport'), /loopsPlatz: loopsPlatzDa\(\)/);
  assert.match(funktion('zeigeExport'), /\[data-nachbox\]/);
  const s = funktion('zeigeLoopsSperre');
  assert.match(s, /#loopliste button\.laden/); assert.match(s, /button\.in-box/); assert.match(s, /HINWEIS_LOOPS/);
  assert.match(funktion('wendePlaetzeAn'), /zeigeLoopsSperre\(\);/, 'every layout change refreshes the buttons');
  assert.match(app, /b\.disabled = !s\.aktiv \|\| loopImportLaeuft \|\| !loopsPlatzDa\(\);/, 'new Mediathek buttons start disabled too');
  assert.match(app, /if \(!loopsPlatzDa\(\)\) \{ b\.disabled = true; b\.title = HINWEIS_LOOPS; \}/, 'new library loop buttons start disabled too');
});

test('the hand is not restricted: the server verbs are not touched by the layout (no layout check before a call)', () => {
  for (const f of ['exportiere', 'exportiereInSlot', 'ladeLoopInSlot']) assert.ok(modul.includes(`export async function ${f}(`), f);
  assert.doesNotMatch(modul.slice(modul.indexOf('export async function exportiereInSlot')), /loopsPlatz/);
});

test('the LIVE button sits in the Loops place head; a closed container shows it prominently; the click goes through the existing confirmation', () => {
  const loops = html.slice(html.indexOf('<section id="platz-loops"'), html.indexOf('<div class="platzkopf" data-platz-kopf="1"'));
  assert.match(loops, /class="deckkopf">[\s\S]*?data-liveoeffnen[\s\S]*?<\/div>/, 'LIVE in the head');
  assert.match(loops, /class="loops-leer" data-loops-leer>[\s\S]*?livetaste gross" data-liveoeffnen/, 'the prominent one while the container is closed');
  assert.match(loops, /<section id="live-panel" hidden/, 'the slot rows render in the Loops place');
  assert.match(funktion('zeichneLive'), /leer\.hidden = a\.offen/);
  assert.match(funktion('zeichneLive'), /for \(const b of \$\$\('\[data-liveoeffnen\]'\)\) b\.classList\.toggle\('an', a\.offen\);/);
  const o = funktion('liveOeffnen');
  assert.match(o, /oeffneLive\(holeJson, \(t\) => window\.confirm\(t\)\)/);
  assert.match(modul, /live_laeuft[\s\S]*?frage\(/, 'the confirmation of the open live container');
  assert.doesNotMatch(css, /body\.live-offen/);
});

test('the page never opens the live container by itself and never closes it', () => {
  // the only caller of the opening is the click handler of the LIVE buttons; a page start (pruefeLive) only reads
  assert.equal((app.match(/oeffneLive\(/g) ?? []).length, 1, 'one call');
  assert.equal((app.match(/liveOeffnen/g) ?? []).length, 2, 'the definition and the binding, nothing else');
  assert.match(app, /for \(const b of \$\$\('\[data-liveoeffnen\]'\)\) b\.addEventListener\('click', liveOeffnen\);/);
  const lesen = funktion('pruefeLive');
  assert.doesNotMatch(lesen, /oeffneLive|liveOeffnen|\/live\/oeffnen|confirm/);
  assert.doesNotMatch(app + modul, /\/live\/(?:schliessen|zu|close)|\/proj\/schliessen/);
});

test('the deck 3 bar and the separate live panel block are gone; the panel sits inside the Loops place', () => {
  assert.doesNotMatch(html, /id="deck-3"|data-deck3/);
  assert.match(html, /<section id="platz-loops"[\s\S]*<section id="live-panel"[^>]*><\/section>\s*<\/section>/);
  assert.doesNotMatch(css, /#live-panel \{ grid-area/, 'the panel has no cell of its own');
});

test('a place switch leaves the container and the slots alone', () => {
  const block = app.slice(app.indexOf('// ---------- DJ view places'), app.indexOf('// ---------- Aufbau'));
  assert.doesNotMatch(block, /live\.projekt\s*=|live\.stand\s*=|oeffneLive|\/modul\/|\/live\//);
  // the slot rows are a pure function of the project, not of the place: the same rows come back after a switch away and back
  const projekt = { live: true, gruppen: [{ id: 'g1', name: 'M', modul: { slot: 'A', titel: 'Loop X', kuenstler: '', bpm: 128, tonart: '5A', laenge_beats: 16 }, fader_db: 0 }], spuren: [] };
  const regler = { 'pad/1/fader': -60 };
  const a = modulHtml(modulAnsicht(projekt, { A: { stems: 'fertig' } }, null, regler));
  const b = modulHtml(modulAnsicht(projekt, { A: { stems: 'fertig' } }, null, regler));
  assert.equal(a, b); assert.match(a, /Loop X/);
});
