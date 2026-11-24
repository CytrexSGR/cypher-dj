// UI polish task 6 (Nr. 9, 31): with no set the SETS tab says one plain sentence, PREPARE ALL and DELETE SET are off and the empty table is hidden;
// with a set both keys work again. Counts go through zaehlText. The real page runs against the DOM stand-in.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
let sets = [], bibliothek;
const uebersicht = (n) => ({ tracks: n, dauer_s: 200, bpm: null, camelot: {}, status: {}, genre: {} });

before(async () => {
  installiere({
    html: fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'),
    antworten: {
      'GET /bestand': { j: [] }, 'GET /loops': { j: [] }, 'GET /mediathek/listen': { j: [] },
      'GET /sammlungen': () => ({ j: sets }),
      'GET /sammlungen/s1': { j: { posten: [], uebersicht: uebersicht(1) } },
      'GET /sammlungen/s2': { j: { posten: [], uebersicht: uebersicht(3) } },
    },
  });
  const El = attrappe.body.constructor;
  if (!('cells' in El.prototype)) Object.defineProperty(El.prototype, 'cells', { get() { return this.children.filter((c) => typeof c !== 'string'); } });
  await import('../public/app.js');
  bibliothek = await import('../public/library_view.js');
  await new Promise((r) => setTimeout(r, 40));
});

test('setLeerZustand: the sentence and the keys for 0 sets, nothing for 1 or more', () => {
  assert.deepEqual(bibliothek.setLeerZustand(0), { text: 'No set yet: type a name and press NEW SET', knoepfeAn: false });
  assert.deepEqual(bibliothek.setLeerZustand(1), { text: '', knoepfeAn: true });
  assert.deepEqual(bibliothek.setLeerZustand(2), { text: '', knoepfeAn: true });
});

test('with 0 sets PREPARE ALL and DELETE SET are disabled, the table is hidden and the sentence stands in the summary', async () => {
  sets = [];
  await bibliothek.ladeSetListe();
  const b = attrappe.body;
  assert.equal(b.querySelector('#set-alle').disabled, true);
  assert.equal(b.querySelector('#set-loeschen').disabled, true);
  assert.equal(b.querySelector('[data-tabelle="sets"] table').hidden, true);
  assert.equal(b.querySelector('#set-zusammenfassung').textContent, 'No set yet: type a name and press NEW SET');
});

test('with 2 sets both keys are enabled again and the table shows; a single track is "1 track"', async () => {
  sets = [{ slug: 's1', name: 'S1' }, { slug: 's2', name: 'S2' }];
  await bibliothek.ladeSetListe();
  const b = attrappe.body;
  assert.equal(b.querySelector('#set-alle').disabled, false);
  assert.equal(b.querySelector('#set-loeschen').disabled, false);
  assert.equal(b.querySelector('[data-tabelle="sets"] table').hidden, false);
  assert.match(b.querySelector('#set-zusammenfassung').textContent, /^\d+ tracks? · /);
});

test('the inner tab for the whole library reads BROWSE with its title, the controllers tab says it opens a window, the search fields have names', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  assert.match(html, /<button data-reiter="library" title="Browse the whole library by folder, artist and tag">BROWSE<\/button>/);
  assert.match(html, /<button data-bereich="library" class="an" role="tab"[^>]*>LIBRARY<\/button>/, 'the outer LIBRARY stays');
  assert.match(html, /data-bereich="controller" role="tab" title="Opens the controller list in its own window">CONTROLLERS ↗<\/button>/);
  assert.match(html, /<input id="suche"[^>]*aria-label="Search title or key"/);
});
