// UI polish task 6 (Nr. 11, 32): the LOOPS tab prints words for the stored source names and a formatted date; a hidden tab asks for nothing.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
let rec;
const LOOPS = [
  { name: 'a-rec', beats: 16, quelle: 'mitschnitt', erstellt: '2026-11-22T23:01:00Z', ladbar: true },
  { name: 'b-none', beats: 8, ladbar: true },
  { name: 'c-odd', beats: 8, quelle: 'unknown-x', erstellt: 'not a date', ladbar: true },
];

before(async () => {
  installiere({ html: fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'), antworten: { 'GET /bestand': { j: [] }, 'GET /loops': { j: LOOPS } } });
  const El = attrappe.body.constructor;
  if (!('cells' in El.prototype)) Object.defineProperty(El.prototype, 'cells', { get() { return this.children.filter((c) => typeof c !== 'string'); } });
  await import('../public/app.js');
  rec = await import('../public/loop_rec_view.js');
  await new Promise((r) => setTimeout(r, 40));
});

test('quelleText: the table of words, a dash for a missing value, an unknown value unchanged', () => {
  assert.equal(rec.quelleText('mitschnitt'), 'recording');
  assert.equal(rec.quelleText('loop'), 'loop');
  assert.equal(rec.quelleText(undefined), '–');
  assert.equal(rec.quelleText('unknown-x'), 'unknown-x');
  assert.deepEqual({ ...rec.QUELLE_TEXT }, { mitschnitt: 'recording', erzeugt: 'generated', oneshot: 'one-shot', loop: 'loop', impuls: 'impulse', stimme: 'voice' });
});

test('the LOOPS rows show the word and the formatted date, a dash where a value is missing or not a date', async () => {
  await rec.ladeLoops();
  const zeilen = attrappe.body.querySelector('#loopliste').querySelectorAll('tr');
  const text = (z, i) => z.cells[i].textContent;
  assert.equal(text(zeilen[0], 2), 'recording');
  assert.match(text(zeilen[0], 3), /^\d{1,2} Nov 2026, \d{2}:\d{2}$/);
  assert.equal(text(zeilen[1], 2), '–');
  assert.equal(text(zeilen[1], 3), '–');
  assert.equal(text(zeilen[2], 2), 'unknown-x');
  assert.equal(text(zeilen[2], 3), '–');
});

test('taktSichtbar: no call while the document is hidden, one call when it comes back, the rate while visible is the given one', async () => {
  const { taktSichtbar } = await import('../public/sichtbar_bar.js');
  const dok = { hidden: false, auf: {}, addEventListener(art, f) { this.auf[art] = f; } };
  let ticks = 0, tick = null, ms = null;
  taktSichtbar(() => { ticks++; }, 1000, { setze: (f, t) => { tick = f; ms = t; return 1; }, dok });
  assert.equal(ms, 1000);
  tick(); tick();
  assert.equal(ticks, 2, 'visible: every tick calls');
  dok.hidden = true;
  tick(); tick(); tick();
  assert.equal(ticks, 2, 'hidden: no request');
  dok.hidden = false;
  dok.auf.visibilitychange();
  assert.equal(ticks, 3, 'visible again: one call at once');
  dok.hidden = true;
  dok.auf.visibilitychange();
  assert.equal(ticks, 3, 'turning hidden calls nothing');
});

test('the polling loops of the DJ page go through taktSichtbar', () => {
  const app = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
  const rahmen = fs.readFileSync(path.join(PUBLIC, 'seitenrahmen.js'), 'utf8');
  assert.match(app, /taktSichtbar\(ausgang, 1000\)/);
  assert.match(rahmen, /taktSichtbar\(alle, 1000\)/);
  assert.ok(!/setInterval\(ausgang/.test(app) && !/setInterval\(alle/.test(rahmen));
});
