// DJ view places, task 16: the Loops place carries the live container. The page never opens it by itself and never closes it; EXPORT and the library
// load buttons need a Loops place. Like page_decks.test.mjs this reads app.js, index.html and style.css and runs the pure parts.
import { liesApp } from './helpers/app_source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { modulAnsicht } from '../public/live_module.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const lies = (n) => fs.readFileSync(path.join(PUBLIC, n), 'utf8');
const app = liesApp(), html = lies('index.html'), css = lies('style.css'), modul = lies('live_module.js');
const funktion = (name) => { const a = app.indexOf(`function ${name}(`); assert.ok(a >= 0, name); return app.slice(a, app.indexOf('\n}\n', a) + 3); };

test('the Mediathek buttons and the deck export no longer depend on a Loops place; the LOOPS tab buttons neither (fix round)', () => {
  assert.doesNotMatch(app, /HINWEIS_LOOPS|loopsPlatzDa/, 'the place check and its hint are gone');
  assert.doesNotMatch(funktion('zeigeExport'), /loopsPlatzDa/);
  assert.match(funktion('zeigeExport'), /\[data-nachspur\]/);
  const s = funktion('zeigeLoopsSperre');
  assert.doesNotMatch(s, /#loopliste button\.laden/, 'the LOOPS tab buttons load into a loop deck: no place needed'); assert.match(s, /button\.in-box/);
  assert.match(funktion('wendePlaetzeAn'), /zeigeLoopsSperre\(\);/, 'every layout change refreshes the buttons');
  assert.match(app, /b\.disabled = !s\.aktiv \|\| loopImportLaeuft;/, 'the Mediathek buttons no longer need a Loops place (loop deck P3)');
  assert.doesNotMatch(app, /if \(!loopsPlatzDa\(\)\) \{ b\.disabled = true;/);
});

test('the hand is not restricted: the server verbs are not touched by the layout (no layout check before a call)', () => {
  const lad = app.slice(app.indexOf('async function ladeInDeck('), app.indexOf('async function exportiereVonDeck('));
  assert.ok(lad.length > 40, 'ladeInDeck');
  assert.doesNotMatch(lad, /loopsPlatz|plaetzeLayout|zustand\.plaetze/);
});

test('a loops place holds the deck container of its group: the LIVE head, the closed-container hint and the module panel left (loop deck P1)', () => {
  const loops = html.slice(html.indexOf('<section id="platz-loops"'), html.indexOf('<section id="platz-remix"'));
  assert.match(loops, /<section id="platz-loops"[^>]*>\s*<div class="loopdeck" data-deck="1"><\/div>\s*<\/section>/);
  assert.match(loops, /<section id="platz-loops2"[^>]*>\s*<div class="loopdeck" data-deck="2"><\/div>\s*<\/section>/);
  assert.match(funktion('loopDeckVon'), /g\?\.loopdeck\?\.platz/, 'the deck identity comes from the group, not from the place number');
  assert.doesNotMatch(html, /live-panel|live-slot|data-loops-leer|data-liveoeffnen/);
  const z = funktion('zeichneLive');
  assert.doesNotMatch(z, /innerHTML|live-panel|modulHtml|bindeLoopWellen/);
  assert.doesNotMatch(z, /data-liveoeffnen/, 'the dead LIVE button toggle is gone');
  const o = funktion('liveOeffnen');
  assert.match(o, /oeffneLive\(holeJson, \(t\) => window\.confirm\(t\)\)/);
  assert.match(modul, /live_laeuft[\s\S]*?frage\(/, 'the confirmation of the open live container');
  assert.doesNotMatch(css, /body\.live-offen/);
});

test('the page never opens the live container by itself and never closes it', () => {
  // the opening is reached from the loop deck view only after its question (senden: projekt_offen), never by a page start (pruefeLive only reads)
  assert.equal((app.match(/oeffneLive\(/g) ?? []).length, 2, 'the call of liveOeffnen and the hook of the loop deck view');
  const hook = app.match(/\n[^\n]*haken\.oeffneLive\(\)/g) ?? [];
  assert.equal(hook.length, 1, 'one use of the hook');
  assert.match(app, /!haken\.frage\(FRAGE_PROJEKT\)\) return[^\n]*\n\s*const o = await haken\.oeffneLive\(\);/, 'the question comes first');
  const ohneImport = app.replace(/^import .*$/gm, '');   // since the module split a use is also imported once; the import lines are not uses
  assert.equal((ohneImport.match(/liveOeffnen/g) ?? []).length, 4, 'the definition, the registration, the OPEN LIVE button of the loop deck pop-up and the key of the closed-set banner (a click only), nothing else');
  // that button opens the container only on a click (the pop-up shows one line "No live project open"; nothing opens it by itself)
  const sitzung = lies('loopdeck/gross.js');
  assert.equal((sitzung.match(/oeffneLive\(\)/g) ?? []).length, 1);
  assert.match(sitzung, /addEventListener\('click', async \(\) => \{ await opt\.oeffneLive\(\);/);
  assert.doesNotMatch(app, /\[data-liveoeffnen\]/, 'the dead binding is gone: no element carries the attribute any more');
  const lesen = funktion('pruefeLive');
  assert.doesNotMatch(lesen, /oeffneLive|liveOeffnen|\/live\/oeffnen|confirm/);
  assert.doesNotMatch(app + modul, /\/live\/(?:schliessen|zu|close)|\/proj\/schliessen/);
});

test('a place switch leaves the container and the slots alone', () => {
  const block = ['wechsle', 'holeLage', 'wendePlaetzeAn', 'ordneKnoten'].map(funktion).join('');
  assert.doesNotMatch(block, /live\.projekt\s*=|live\.stand\s*=|oeffneLive|\/modul\/|\/live\//);
  assert.deepEqual([...funktion('wechsle').matchAll(/fetch\('([^']+)'/g)].map((m) => m[1]), ['/plaetze'], 'the place switch sends only /plaetze');
  // the slot model is a pure function of the project, not of the place: the same model comes back after a switch away and back
  const projekt = { live: true, plaetze: [{ typ: 'stems', gruppe: 'g1' }, { typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }], gruppen: [{ id: 'g1', name: 'M', modul: { titel: 'Loop X', kuenstler: '', bpm: 128, tonart: '5A', laenge_beats: 16 }, fader_db: 0 }], spuren: [] };
  const regler = { 'deck/1/fader': -60 };
  const a = modulAnsicht(projekt, { A: { stems: 'fertig' } }, null, regler);
  const b = modulAnsicht(projekt, { A: { stems: 'fertig' } }, null, regler);
  assert.deepEqual(a, b); assert.equal(a.slots[0].titel, 'Loop X');
});
