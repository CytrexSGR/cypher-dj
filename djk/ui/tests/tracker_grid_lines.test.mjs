// Tracker fix round F4: the grid is compared row by row. A change of one note replaces only the elements of the rows whose text changed; the cursor, the
// selection and the play line only switch classes; a change of structure rebuilds everything. Element identity is compared with ===.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeTracker } = await import('../public/tracker/tracker.js');

const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const note = (id, beat, ton) => ({ id, beat, laenge: 0.25, ton, vel: 100 });
const projekt = (ton = 60) => ({
  name: 'Song', rev: 5, tempo_bpm: 120, taktart: [4, 4], loop: { an: false, von_beat: 0, bis_beat: 16 },
  spuren: [
    { id: 's1', nr: 1, name: 'Drums', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'kick' }, clips: [{
      id: 'c1', art: 'midi', name: 'a', start_beat: 0, laenge_beats: 16, noten: [note('n1', 0, 60), note('n2', 1, 62), note('n3', 2, ton), note('n4', 5, 64)] }] },
    { id: 's2', nr: 2, name: 'Bass', art: 'instrument', geraet: { art: 'intern', name: 'rb338' }, clips: [] },
  ],
});

let wurzel, w;
const reihen = () => wurzel.querySelectorAll('.t-zeile');
const raster = () => wurzel.querySelector('[data-t="raster"]');
beforeEach(async () => {
  installiere({ speicher: {}, antworten: { 'GET /proj/aktuell': { j: { slug: 'song', projekt: projekt() } } } });
  wurzel = document.createElement('section');
  w = bindeTracker({ post, wurzel, frage: () => true });
  w.zeige(); await ruhe();
});

test('a note change replaces only the row of that note; every other row element and the head stay the same elements', () => {
  const vorher = reihen(), kopf = wurzel.querySelector('.t-kopfzeile');
  const voll = w.ctx.zeichneStand.voll;
  w.ctx.uebernimm('song', { ...projekt(67), rev: 6 });   // beat 2 = row 8: D-3 .. G-3
  const nachher = reihen();
  assert.equal(nachher.length, 64);
  const anders = [];
  for (let z = 0; z < 64; z++) if (!(vorher[z] === nachher[z])) anders.push(z);
  assert.deepEqual(anders, [8], 'only row 08 is a new element');
  assert.ok(kopf === wurzel.querySelector('.t-kopfzeile'), 'the head is untouched');
  assert.equal(w.ctx.zeichneStand.voll, voll, 'no full rebuild');
  assert.ok(nachher[8].querySelector('[data-k="0:0:8:note:"]').textContent.startsWith('G'));
  assert.ok(wurzel.querySelector('.t-zeile[data-z="8"]') === nachher[8], 'the new element stands in the place of the old one');
});

test('the cursor, the play line and the same project again cause no replacement', () => {
  const vorher = reihen();
  const n = w.ctx.zeichneStand.zeilen;
  raster().dispatch('keydown', { key: 'ArrowDown', code: 'ArrowDown' });
  raster().dispatch('keydown', { key: 'ArrowRight', code: 'ArrowRight' });
  raster().dispatch('keydown', { key: 'ArrowDown', code: 'ArrowDown', shiftKey: true });   // a selection
  w.ctx.setzeCursor({ spur: 0, spalte: 0, zeile: 9, unterspalte: 'note' });
  w.ctx.uebernimm('song', { ...projekt(), rev: 6 });   // same content, a new revision
  const nachher = reihen();
  assert.ok(vorher.every((e, z) => e === nachher[z]), 'all 64 rows are the same elements');
  assert.equal(w.ctx.zeichneStand.zeilen, n);
  assert.equal(wurzel.querySelectorAll('.t-c.cursor').length, 1, 'exactly one cursor cell');
  assert.ok(wurzel.querySelector('.t-c.cursor').getAttribute('data-k').startsWith('0:0:9:'));
});

test('the cursor class follows a replaced row (the cursor stands in the row that changes)', () => {
  w.ctx.setzeCursor({ spur: 0, spalte: 0, zeile: 8, unterspalte: 'note' });
  w.ctx.uebernimm('song', { ...projekt(67), rev: 6 });
  const c = wurzel.querySelectorAll('.t-c.cursor');
  assert.equal(c.length, 1);
  assert.equal(c[0].getAttribute('data-k'), '0:0:8:note:');
});

test('a change of structure (number base, column count) rebuilds the grid', () => {
  const vorher = reihen();
  const voll = w.ctx.zeichneStand.voll;
  w.ctx.st.zahlen = 'dec'; w.ctx.zeichne();
  assert.equal(w.ctx.zeichneStand.voll, voll + 1);
  assert.ok(!(vorher[0] === reihen()[0]));
  w.ctx.st.spaltenAn = { ...w.ctx.st.spaltenAn, dly: true }; w.ctx.zeichne();
  assert.equal(w.ctx.zeichneStand.voll, voll + 2);
});

test('a track name change replaces the head only', () => {
  const vorher = reihen(), kopf = wurzel.querySelector('.t-kopfzeile');
  const p = projekt(); p.spuren[1].name = 'Bass 2';
  w.ctx.uebernimm('song', { ...p, rev: 6 });
  assert.ok(!(kopf === wurzel.querySelector('.t-kopfzeile')));
  assert.ok(wurzel.querySelector('.t-kopfzeile').textContent.includes('Bass 2'));
  assert.ok(reihen().every((e, z) => e === vorher[z]));
});
