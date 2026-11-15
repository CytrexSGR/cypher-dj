// LOAD buttons exist for four decks, but only a deck that sits on a Track place can be loaded: the buttons of the other decks are disabled with a hint
// (not hidden). All four creation sites (stock list, library row, set row, Browse row) are covered; the page runs against the DOM stand-in.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const E1 = { material_id: 'm1', titel: 'Own Song', camelot: '8A', quelle_bpm: 128, basis_bpm: 128, fassung: 1, dauer_s: 200, lufs: -14, tore_ok: true, beats: 400, erste_eins_quell_beat: 0 };
const POSTEN = { id: 'p1', art: 'track', titel: 'Own Song', laden_mid: 'm1', status: 'fertig', mix: null };
const wirft = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
let ansicht, plaetze, bibliothek, stoebern;

const orte = {   // site name → the LOAD buttons that site built (all of them sit in the document)
  Stock: () => attrappe.body.querySelectorAll('#liste button.laden[data-deck]'),
  Library: () => attrappe.body.querySelectorAll('#test-lib button.laden[data-deck]'),
  Set: () => attrappe.body.querySelectorAll('#setliste button.laden[data-deck]'),
  Browse: () => attrappe.body.querySelectorAll('#test-browse button.laden[data-deck]'),
};
const nr = (b) => Number(b.dataset.deck);
const kopf = (p) => attrappe.body.querySelectorAll('.platzkopf').find((x) => x.dataset.platzKopf === String(p));
const pruefe = (erlaubt) => {
  for (const [ort, f] of Object.entries(orte)) {
    const bs = f();
    assert.equal(bs.length, 4, `${ort}: four buttons`);
    for (const b of bs) {
      assert.equal(b.disabled, !erlaubt(nr(b)), `${ort}: deck ${nr(b)}`);
      if (!erlaubt(nr(b))) assert.equal(b.title, ansicht.hinweisTrack(nr(b)), `${ort}: hint of deck ${nr(b)}`);
    }
  }
};

before(async () => {
  installiere({
    html: fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'),
    speicher: { 'djk-set': 's1' },
    antworten: {
      'GET /bestand': { j: [E1] }, 'GET /loops': { j: [] },
      'GET /sammlungen': { j: [{ slug: 's1', name: 'S1' }] },
      'GET /sammlungen/s1': { j: { posten: [POSTEN], uebersicht: { tracks: 1, dauer_s: 200, bpm: null, camelot: {}, status: {}, genre: {} } } },
    },
  });
  const El = attrappe.body.constructor;
  if (!('cells' in El.prototype)) Object.defineProperty(El.prototype, 'cells', { get() { return this.children.filter((c) => typeof c !== 'string'); } });   // table rows: the stand-in has no `cells`, filtere() reads it
  await import('../public/app.js');
  ansicht = await import('../public/slots_view.js');
  plaetze = await import('../public/slots.js');
  bibliothek = await import('../public/library_view.js');
  stoebern = await import('../public/browse_table.js');
  await new Promise((r) => setTimeout(r, 40));
  await bibliothek.ladeSetListe();
  const lib = new El('div'); lib.setAttribute('id', 'test-lib'); attrappe.body.append(lib);
  const td = new El('td'); lib.append(td); bibliothek.libKnoepfe(td, { material_id: 'm1' });
  const br = new El('div'); br.setAttribute('id', 'test-browse'); attrappe.body.append(br);
  br.append(stoebern.stoebernZeile({ typ: 'track', material_id: 'm1', laden_mid: 'm1', pfad_da: true, titel: 'Own Song' }, 0));
  ansicht.zeigePlaetze();
});

test('hinweisTrack names the place to switch', () => {
  assert.equal(ansicht.hinweisTrack(3), 'LOAD is off: switch place 3 to TRACK');
});

test('default layout: LOAD A and B are enabled, LOAD 3 and 4 are greyed with the hint, at every site', () => {
  assert.deepEqual([...ansicht.aktuellesLayout()], ['track', 'track', 'strudel', 'loops']);
  pruefe((n) => n <= 2);
});

test('a layout from throwing storage is the default: LOAD 3 and 4 off, nothing throws', () => {
  const l = plaetze.ladeLayout(wirft);
  assert.deepEqual(l, [...plaetze.LAYOUT_STANDARD]);
  assert.equal(plaetze.ladeDeckDa(l, 3), false);
  assert.equal(plaetze.ladeDeckDa(l, 4), false);
});

test('Track at place 3: LOAD 3 is enabled at all four sites', () => {
  kopf(3).querySelectorAll('[data-platz-typ="track"]')[0].click();   // the page switches its layout like a click on the place head
  assert.equal(ansicht.aktuellesLayout()[2], 'track');
  ansicht.zeigePlaetze();
  pruefe((n) => n <= 3);
});

test('a SEQ place at position 1 disables LOAD A at all four sites', () => {
  kopf(1).querySelectorAll('[data-platz-typ="seq"]')[0].click();
  assert.equal(ansicht.aktuellesLayout()[0], 'seq');
  ansicht.zeigePlaetze();
  pruefe((n) => n === 2 || n === 3);
});
