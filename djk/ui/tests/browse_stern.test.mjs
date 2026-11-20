// Star and recently used in the DJ library and in PRODUCTION LIBRARY (media browser slice 2, task 6). Page only: DOM stand-in, stubbed answers.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, attrappe } from './helpers/pages_mock.mjs';
import { neuesProjekt } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { stoebernUrl } from '../public/browse.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SHA = 'c'.repeat(64);
const E1 = { material_id: 'm1', titel: 'Own Song', camelot: '8A', quelle_bpm: 128, basis_bpm: 128, fassung: 1, dauer_s: 200, lufs: -14, tore_ok: true, beats: 400, erste_eins_quell_beat: 0 };
const ruhe = async () => { for (let i = 0; i < 8; i++) await new Promise((ok) => setImmediate(ok)); };
let tabelle;

before(async () => {
  installiere({ html: fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'), antworten: { 'GET /bestand': { j: [E1] }, 'GET /loops': { j: [] }, 'GET /sammlungen': { j: [] },
    'GET /stoebern': { j: { treffer: [], gesamt: 0, limit: 100, seite: 0, sort: 'titel', richtung: 'auf' } }, 'GET /stoebern/baum': { j: { ordner: [], facetten: {} } } } });
  const El = attrappe.body.constructor;
  if (!('cells' in El.prototype)) Object.defineProperty(El.prototype, 'cells', { get() { return this.children.filter((c) => typeof c !== 'string'); } });
  await import('../public/app.js');
  tabelle = await import('../public/browse_table.js');
  await new Promise((r) => setTimeout(r, 40));
});

test('stoebernUrl sends vorrang=1 while no column was chosen and drops it after a header click', () => {
  assert.equal(stoebernUrl({ typ: 'track', vorrang: true }), '/stoebern?typ=track&vorrang=1');
  assert.equal(stoebernUrl({ typ: 'track', vorrang: false, sort: 'bpm' }), '/stoebern?typ=track&sort=bpm');
  assert.equal(stoebernUrl({ typ: 'track', sort: 'bpm', vorrang: true }), '/stoebern?typ=track&sort=bpm&vorrang=1', 'the server sorts by the column inside each rank');
  assert.equal(tabelle.stz.vorrang, true, 'starts true');
  const th = attrappe.body.querySelector('#st-kopfzeile');
  tabelle.stz.typ = 'track'; tabelle.zeigeKopfzeile();
  const kopf = th.children.find((c) => typeof c !== 'string' && c.dataset.sort);
  kopf.dispatch('click');
  assert.equal(tabelle.stz.vorrang, false, 'a header click clears it');
  assert.equal(stoebernUrl(tabelle.stz).includes('vorrang'), false);
  attrappe.body.querySelector('[data-typ="loop"]').dispatch('click');
  assert.equal(tabelle.stz.vorrang, true, 'a type change sets it again');
});

test('a /stoebern row carries a star, a list-view row and a strudel row do not', () => {
  const stern = (tr) => tr.querySelectorAll('button.w-kat-stern');
  for (const typ of ['track', 'loop', 'oneshot']) {
    const tr = tabelle.stoebernZeile({ typ, sha: SHA, name: 'x', titel: 'x', favorit: true, pfad_da: true }, 0);
    const s = stern(tr);
    assert.equal(s.length, 1, typ);
    assert.ok(tr.querySelector('td.aktion').children[0] === s[0], 'the star sits first in the action cell');
    assert.equal(s[0].textContent, '★');
  }
  assert.equal(stern(tabelle.stoebernZeile({ typ: 'strudel', name: 's', ladbar: true }, 0)).length, 0);
  tabelle.stz.liste = 'p1';
  try { assert.equal(stern(tabelle.stoebernZeile({ typ: 'track', sha: SHA, titel: 'x', pfad_da: true }, 0)).length, 0, 'list view'); }
  finally { tabelle.stz.liste = null; }
});

test('the star posts to the favourites; a refusal flips it back and shows the text', async () => {
  attrappe.anrufe.length = 0;
  attrappe.antworten['POST /kollektionen/favourites/posten'] = { code: 409, j: { fehler: 'zu_viele', text: 'too many items' } };
  const tr = tabelle.stoebernZeile({ typ: 'oneshot', sha: SHA, name: 'x', favorit: false, pfad_da: true }, 0);
  const s = tr.querySelector('button.w-kat-stern');
  s.dispatch('click');
  assert.equal(s.textContent, '★', 'flips at once');
  await ruhe();
  assert.equal(s.textContent, '☆', 'a refusal flips it back');
  const a = attrappe.anrufe.find((x) => x.url === '/kollektionen/favourites/posten');
  assert.deepEqual(a.koerper, { hinzu: [{ art: 'sample', sha: SHA }] });
  delete attrappe.antworten['POST /kollektionen/favourites/posten'];
});

test('a deck load answered 200 records recently used, a refused load and a preview do not', async () => {
  const lade = (code) => {
    attrappe.anrufe.length = 0;
    attrappe.antworten['POST /laden'] = { code, j: code === 200 ? { felder: { id: 'f1' } } : { fehler: 'deck_hoerbar' } };
    attrappe.antworten['POST /kollektionen/recently-used/posten'] = { j: {} };
    const tr = tabelle.stoebernZeile({ typ: 'track', sha: SHA, material_id: 'm1', laden_mid: 'm1', pfad_da: true, titel: 'Own Song' }, 0);
    tr.querySelector('button.laden[data-deck="1"]').dispatch('click');
    return ruhe().then(() => attrappe.anrufe.filter((x) => x.methode === 'POST').map((x) => x.url));
  };
  assert.deepEqual(await lade(409), ['/laden']);
  const ok = await lade(200);
  assert.deepEqual(ok, ['/laden', '/kollektionen/recently-used/posten']);
  const p = { art: 'sample', sha: SHA };
  assert.deepEqual(attrappe.anrufe.at(-1).koerper, { weg: [p], hinzu: [p] });
});

test('a LIBRARY drop in PRODUCTION records recently used', async () => {
  const { bindeAblage } = await import('../public/production/storage.js');
  const { ZIEH_TYP } = await import('../public/production/drag.js');
  const el = () => ({ h: {}, addEventListener(n, f) { this.h[n] = f; } });
  const ueber = el();
  const alt = globalThis.document;
  globalThis.document = { querySelector: () => null };
  try {
    const p = fuehreListeAus(neuesProjekt('T'), [{ befehl: 'spur_neu', art: 'audio', name: 'Drums' }]).projekt;
    const posts = [];
    const ctx = { st: { projekt: p, sichtbar: true, ansicht: { x0: 0, ppb: 10 }, raster: 1 }, $: (n) => ({ ueber })[n], stoebern: () => null, beimSichtwechsel: [],
      zeilen: () => [{ art: 'spur', spur: 0, y: 0, h: 40 }], aendere: () => {}, aendereAus: () => {}, melde: () => {},
      holeJson: async (u, k) => { posts.push([u, k]); return { status: 200, j: {} }; } };
    bindeAblage(ctx);
    const drop = (n) => ueber.h.drop({ dataTransfer: { types: [ZIEH_TYP], getData: () => JSON.stringify(n) }, offsetX: 10, offsetY: 10, preventDefault() {} });
    drop({ sha: SHA, dauer_s: 2 });
    await ruhe();
    const q = { art: 'sample', sha: SHA };
    assert.deepEqual(posts, [['/kollektionen/recently-used/posten', { weg: [q], hinzu: [q] }]]);
    ctx.zeilen = () => [];   // a drop that no track takes records nothing
    posts.length = 0; drop({ sha: SHA, dauer_s: 2 });
    await ruhe();
    assert.deepEqual(posts, []);
  } finally { globalThis.document = alt; }
});
