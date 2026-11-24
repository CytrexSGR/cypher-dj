// Review 3 (M6): the FILTER key at <=800 px opens ITS OWN filter bar. The MODULES tab builds a second .lib-filter (module_library.js), earlier in
// the DOM and hidden; a bare $('.lib-filter') took that one, so Key/BPM/Energy/±1 could neither be opened nor cleared. Real bindeLibrary, both bars in the fixture.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere } from './helpers/pages_mock.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MODULE_LEISTE = '<div class="lib-filter" id="modul-leiste"><input type="search" data-modul-suche></div>';
let doc, ansicht, detail, tabelle;

before(async () => {
  const roh = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  // the MODULES bar comes first in the document order, like in the page where the module tab lives in the dock before BROWSE
  const html = roh.replace('<div class="st-kopf">', `${MODULE_LEISTE}<div class="st-kopf">`);
  assert.notEqual(html, roh, 'the fixture got the MODULES bar');
  installiere({ html, antworten: { 'GET /bestand': { j: [] }, 'GET /loops': { j: [] } } });
  ({ stz: tabelle } = await import('../public/browse_table.js'));
  detail = await import('../public/browse_detail.js');
  ansicht = await import('../public/library_view.js');
  doc = globalThis.document;
  ansicht.bindeLibrary();
});

const id = (x) => doc.querySelector(x);
const klick = (el) => el.dispatch('click');

test('the fixture has both bars, MODULES first', () => {
  const alle = doc.querySelectorAll('.lib-filter');
  assert.equal(alle.length, 2);
  assert.equal(alle[0].id, 'modul-leiste');
  assert.equal(id('#lib-mehr').closest('.lib-filter'), alle[1]);
});

test('FILTER toggles "offen" on the BROWSE bar, never on the MODULES bar', () => {
  const modul = id('#modul-leiste'), browse = id('#lib-mehr').closest('.lib-filter');
  klick(id('#lib-mehr'));
  assert.equal(browse.classList.contains('offen'), true, 'BROWSE bar open');
  assert.equal(modul.classList.contains('offen'), false, 'MODULES bar untouched');
  assert.equal(id('#lib-mehr').getAttribute('aria-expanded'), 'true');
  klick(id('#lib-mehr'));
  assert.equal(browse.classList.contains('offen'), false);
  assert.equal(id('#lib-mehr').getAttribute('aria-expanded'), 'false');
});

test('markiereTyp: the FILTER mark follows the values, and the list view hides the BROWSE bar only', () => {
  const browse = id('#lib-mehr').closest('.lib-filter'), modul = id('#modul-leiste');
  tabelle.typ = 'track'; tabelle.liste = null; tabelle.camelot = '8A'; tabelle.bpm = ''; tabelle.energie = ''; tabelle.nachbarn = false;
  detail.markiereTyp();
  assert.equal(id('#lib-mehr').classList.contains('an'), true, 'a key filter marks FILTER');
  tabelle.camelot = '';
  detail.markiereTyp();
  assert.equal(id('#lib-mehr').classList.contains('an'), false, 'cleared: mark gone');
  tabelle.liste = { id: 1 };
  detail.markiereTyp();
  assert.equal(browse.hidden, true);
  assert.equal(modul.hidden, false, 'the MODULES bar is not hidden by the list view');
  tabelle.liste = null;
});
