// Tracker task 2: the TRACKER view (fifth view) with a readable grid. tracker.js is run against the DOM stand-in (tests/helpers/pages_mock.mjs);
// stream events are driven by calling the view's event entry directly. The wiring in the page files is pinned as text. Nothing is written but M / S.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

const UI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lies = (n) => fs.readFileSync(path.join(UI, n), 'utf8');

installiere();   // the globals the modules read at import time
const { bindeTracker, TRACKER_TEXT, BINDER } = await import('../public/tracker/tracker.js');
const R = await import('../public/tracker/grid_view.js');
const { projiziere } = await import('../public/tracker/grid_model.js');

const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const klick = (e) => e.dispatch('click');
const POSTS = () => attrappe.anrufe.filter((a) => a.methode === 'POST');

const note = (id, beat, laenge, ton, vel = 100, extra = {}) => ({ id, beat, laenge, ton, vel, ...extra });
const projekt = (extra = {}) => ({
  name: 'Song', rev: 5, tempo_bpm: 120, taktart: [4, 4], loop: { an: false, von_beat: 0, bis_beat: 16 },
  spuren: [
    { id: 's1', nr: 1, name: 'Drums', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'kick' }, clips: [{
      id: 'c1', art: 'midi', name: 'a', start_beat: 0, laenge_beats: 16,
      noten: [note('n1', 0, 0.5, 60), note('n2', 1, 0.25, 62), note('n3', 2.125, 0.25, 64, 90), note('n4', 4, 0.25, 36, 127, { versatz: 25 })],
    }] },
    { id: 's2', nr: 2, name: 'Bass', art: 'instrument', geraet: { art: 'intern', name: 'rb338' }, clips: [] },
    { id: 's3', nr: 3, name: 'Vox', art: 'audio', clips: [{ id: 'a1', art: 'audio', name: 'verse', start_beat: 8, laenge_beats: 8 }] },
  ], ...extra,
});
const ZWEI_ABSCHNITTE = { tracker: { abschnitte: [{ id: 'a1', name: 'Intro', laenge_beats: 8 }, { id: 'a2', name: 'Verse', laenge_beats: 8 }] } };

let wurzel, w, $t;
function aufbau({ p = projekt(), speicher = {} } = {}) {
  installiere({ speicher, antworten: { 'GET /proj/aktuell': { j: { slug: 'song', projekt: p } } } });
  wurzel = document.createElement('section');
  w = bindeTracker({ post, wurzel, frage: () => true });
  $t = (n) => wurzel.querySelector(`[data-t="${n}"]`);
}
const zelle = (s, sp, z, u, f = '') => wurzel.querySelector(`[data-k="${s}:${sp}:${z}:${u}:${f}"]`);
const taste = (key, extra = {}) => $t('raster').dispatch('keydown', { key, ...extra });
const nr = (z) => wurzel.querySelector(`.t-zeile[data-z="${z}"]`).querySelector('.t-nr').textContent;
const spielt = () => wurzel.querySelectorAll('.t-zeile.spielt').map((e) => Number(e.getAttribute('data-z')));

beforeEach(() => aufbau());

test('nothing is fetched before the view is shown; the binder order is the contract', () => {
  assert.equal(attrappe.anrufe.length, 0);
  assert.equal(BINDER.length, 9);   // bar, grid, keyboard, SONG, TO DJ, shelf, NEW MODULE
  assert.ok(TRACKER_TEXT.keinProjekt.length > 0);
});

test('the view builds on the open project: bar, song column, grid with one row per step, instruments, status line', async () => {
  w.zeige(); await ruhe();
  for (const n of ['kopf', 'lied', 'raster', 'instr', 'status']) assert.ok($t(n), `region ${n}`);
  assert.equal(wurzel.querySelectorAll('.t-zeile').length, 64, '16 beats at 4 rows per beat');
  assert.deepEqual(wurzel.querySelectorAll('.t-kopf-spur .t-buchstabe').map((e) => e.textContent), ['A', 'B', 'C']);
  assert.ok(wurzel.querySelector('.t-kopf-spur').textContent.includes('Drums'));
  assert.ok($t('instr').querySelectorAll('.t-instr-zeile').length === 2, 'two instrument tracks, the audio track is not listed');
  assert.ok($t('instr').textContent.includes('RB-338'));
  assert.equal($t('leer').hidden, true);
});

test('the grid shows the note names of the projection in the right rows; the end is ===; a delayed note keeps its row', async () => {
  w.zeige(); await ruhe();
  assert.equal(zelle(0, 0, 0, 'note').textContent, 'C-3');
  assert.equal(zelle(0, 0, 4, 'note').textContent, 'D-3');
  assert.equal(zelle(0, 0, 2, 'note').textContent, '===', 'D4: the end of the first note is in row 2');
  assert.equal(zelle(0, 0, 0, 'vol').textContent, '64', 'velocity 100 in hex');
  assert.equal(zelle(0, 0, 16, 'note').textContent, 'C-1', 'a delayed note stays in the row of its written beat');
  assert.ok(zelle(0, 0, 8, 'note').classList.contains('schief'), 'the note off the row line is tinted');
  assert.ok(!zelle(0, 0, 4, 'note').classList.contains('schief'));
  assert.equal(zelle(0, 0, 1, 'note').textContent, '...');
  const r = projiziere(projekt(), { abschnitt_id: 'a1' });
  assert.equal(zelle(0, 0, 8, 'note').textContent, 'E-3', `projection ${r.spuren[0].notenspalten[0][8].note.ton}`);
});

test('every beat and every bar is emphasised', async () => {
  w.zeige(); await ruhe();
  const kl = (z) => wurzel.querySelector(`.t-zeile[data-z="${z}"]`).className;
  assert.ok(kl(0).includes('takt'));
  assert.ok(kl(16).includes('takt'));
  assert.ok(kl(4).includes('beat') && !kl(4).includes('takt'));
  assert.ok(!kl(5).includes('beat') && !kl(5).includes('takt'));
});

test('dimmed empties and the audio track as a narrow read-only column with the clip name', async () => {
  w.zeige(); await ruhe();
  assert.ok(zelle(0, 0, 1, 'note').classList.contains('leer'));
  assert.equal(zelle(2, 0, 32, 'note').textContent, 'verse', 'the clip starts at beat 8 = row 32');
  assert.equal(zelle(2, 0, 33, 'note').textContent, '');
  assert.equal(zelle(2, 0, 32, 'dly'), null, 'an audio column has no sub-columns');
});

test('the audio fold toggle hides the audio column and is remembered in djk-tr-audio', async () => {
  w.zeige(); await ruhe();
  klick($t('audio')); await ruhe();
  assert.equal(zelle(2, 0, 32, 'note'), null);
  assert.equal(localStorage.getItem('djk-tr-audio'), 'zu');
  assert.deepEqual(wurzel.querySelectorAll('.t-kopf-spur .t-buchstabe').map((e) => e.textContent), ['A', 'B']);
  aufbau({ speicher: { 'djk-tr-audio': 'zu' } });
  w.zeige(); await ruhe();
  assert.equal(zelle(2, 0, 32, 'note'), null, 'a new page keeps it folded');
});

test('arrows move the cursor by row and sub-column and the status line follows; the cursor never leaves the section', async () => {
  w.zeige(); await ruhe();
  assert.deepEqual(w.ctx.st.cursor, { spur: 0, spalte: 0, zeile: 0, unterspalte: 'note' });
  assert.ok($t('status').textContent.includes('row 00'));
  assert.ok(zelle(0, 0, 0, 'note').classList.contains('cursor'));
  taste('ArrowDown'); taste('ArrowDown'); taste('ArrowDown'); taste('ArrowDown');
  assert.equal(w.ctx.st.cursor.zeile, 4);
  assert.ok($t('status').textContent.includes('row 04'));
  assert.ok($t('status').textContent.includes('D-3 (MIDI 62)'));
  assert.ok(zelle(0, 0, 4, 'note').classList.contains('cursor'));
  assert.ok(!zelle(0, 0, 0, 'note').classList.contains('cursor'));
  taste('ArrowRight');
  assert.equal(w.ctx.st.cursor.unterspalte, 'vol');
  assert.ok($t('status').textContent.includes('velocity 100 of 127'));
  taste('ArrowUp'); taste('ArrowUp'); taste('ArrowUp'); taste('ArrowUp'); taste('ArrowUp');
  assert.equal(w.ctx.st.cursor.zeile, 0, 'no wrap above the first row');
  taste('End'); assert.equal(w.ctx.st.cursor.zeile, 63);
  taste('ArrowDown'); assert.equal(w.ctx.st.cursor.zeile, 63, 'no wrap below the last row');
  taste('Home'); assert.equal(w.ctx.st.cursor.zeile, 0);
  taste('PageDown'); assert.equal(w.ctx.st.cursor.zeile, 16, 'one bar = 4 beats = 16 rows');
  taste('PageUp'); assert.equal(w.ctx.st.cursor.zeile, 0);
  taste('Tab'); assert.equal(w.ctx.st.cursor.spur, 1);
  taste('Tab', { shiftKey: true }); assert.equal(w.ctx.st.cursor.spur, 0);
  assert.equal(POSTS().length, 0, 'moving the cursor writes nothing');
});

test('a click on a cell sets the cursor and writes nothing', async () => {
  w.zeige(); await ruhe();
  klick(zelle(1, 0, 6, 'note'));
  assert.deepEqual(w.ctx.st.cursor, { spur: 1, spalte: 0, zeile: 6, unterspalte: 'note' });
  assert.equal(POSTS().length, 0);
});

test('switching DLY on shows the DLY sub-column (and the delay), switching it off removes it again', async () => {
  w.zeige(); await ruhe();
  assert.equal(zelle(0, 0, 16, 'dly'), null);
  assert.equal($t('sp-dly').getAttribute('aria-pressed'), 'false');
  klick($t('sp-dly')); await ruhe();
  assert.equal($t('sp-dly').getAttribute('aria-pressed'), 'true');
  assert.equal(zelle(0, 0, 16, 'dly').textContent, ' 25', 'the delay appears in the DLY cell of the written row');
  assert.equal(zelle(0, 0, 0, 'dly').textContent, '...');
  taste('ArrowRight'); taste('ArrowRight');
  assert.equal(w.ctx.st.cursor.unterspalte, 'dly', 'the arrows walk through the new sub-column');
  klick($t('sp-dly')); await ruhe();
  assert.equal(zelle(0, 0, 16, 'dly'), null);
  assert.equal(w.ctx.st.cursor.unterspalte, 'note', 'a cursor on a hidden sub-column returns to the note');
  assert.equal(POSTS().length, 0);
});

test('VOL and FX switches hide their sub-columns', async () => {
  w.zeige(); await ruhe();
  assert.ok(zelle(0, 0, 0, 'fx', 0));
  klick($t('sp-fx')); klick($t('sp-vol')); await ruhe();
  assert.equal(zelle(0, 0, 0, 'fx', 0), null);
  assert.equal(zelle(0, 0, 0, 'vol'), null);
});

test('HEX/DEC changes the row numbers and the velocity', async () => {
  w.zeige(); await ruhe();
  assert.equal(nr(12), '0C'); assert.equal(nr(63), '3F');
  assert.equal($t('zahlen').textContent, 'HEX');
  klick($t('zahlen')); await ruhe();
  assert.equal($t('zahlen').textContent, 'DEC');
  assert.equal(nr(12), '12'); assert.equal(nr(63), '63');
  assert.equal(zelle(0, 0, 0, 'vol').textContent, '100');
  assert.equal(w.ctx.st.zahlen, 'dec');
  assert.equal(POSTS().length, 0);
});

test('the SONG column lists the sections with their length in rows; a click selects one; the cursor stays in the section', async () => {
  aufbau({ p: projekt(ZWEI_ABSCHNITTE) });
  w.zeige(); await ruhe();
  assert.equal(wurzel.querySelectorAll('.t-lied-zeile').length, 2);
  assert.ok(wurzel.querySelectorAll('.t-lied-zeile')[1].textContent.includes('Verse'));
  assert.ok(wurzel.querySelectorAll('.t-lied-zeile')[1].textContent.includes('32'), 'length in rows');
  assert.equal(wurzel.querySelectorAll('.t-zeile').length, 32);
  assert.equal(w.ctx.st.abschnitt_id, 'a1');
  taste('End'); assert.equal(w.ctx.st.cursor.zeile, 31);
  klick(wurzel.querySelectorAll('.t-lied-zeile')[1]); await ruhe();
  assert.equal(w.ctx.st.abschnitt_id, 'a2');
  assert.equal(zelle(2, 0, 0, 'note').textContent, 'verse', 'the audio clip of beat 8 is row 0 of section 2');
  assert.equal(w.ctx.st.cursor.zeile, 31);
  assert.equal(POSTS().length, 0);
});

test('the play line runs across all tracks from the head; FOLLOW selects the section of the play head, FOLLOW off does not', async () => {
  aufbau({ p: projekt(ZWEI_ABSCHNITTE) });
  w.zeige(); await ruhe();
  w.ereignis('/zustand/arr', { projekt_beat: 2, status: 2 });
  for (const h of w.ctx.vorBild) h(performance.now());
  assert.deepEqual(spielt(), [8]);
  assert.equal(w.ctx.st.abschnitt_id, 'a1');
  w.ereignis('/zustand/arr', { projekt_beat: 9, status: 2 });
  for (const h of w.ctx.vorBild) h(performance.now());
  assert.equal(w.ctx.st.abschnitt_id, 'a2', 'FOLLOW on: the section of the play head is selected');
  assert.deepEqual(spielt(), [4]);
  klick($t('follow')); await ruhe();
  assert.equal(w.ctx.st.follow, false);
  klick(wurzel.querySelectorAll('.t-lied-zeile')[0]); await ruhe();
  w.ereignis('/zustand/arr', { projekt_beat: 9, status: 2 });
  for (const h of w.ctx.vorBild) h(performance.now());
  assert.equal(w.ctx.st.abschnitt_id, 'a1', 'FOLLOW off: the selection stays');
  w.ereignis('/zustand/arr', { projekt_beat: 9, status: 0 });
  for (const h of w.ctx.vorBild) h(performance.now());
  assert.deepEqual(spielt(), [], 'a stopped transport shows no play line');
  assert.equal(POSTS().length, 0);
});

test('M and S are the only writes: spur_aendern with the rev', async () => {
  w.zeige(); await ruhe();
  attrappe.antworten['POST /proj/aendern'] = { j: { rev: 6, projekt: projekt({ rev: 6, spuren: projekt().spuren.map((s) => (s.id === 's1' ? { ...s, mute: true } : s)) }) } };
  klick(wurzel.querySelector('[data-a="mute"][data-spur="s1"]')); await ruhe();
  assert.equal(POSTS().length, 1);
  const b = POSTS()[0];
  assert.equal(b.url, '/proj/aendern');
  assert.equal(b.koerper.rev, 5);
  assert.deepEqual(b.koerper.befehle, [{ befehl: 'spur_aendern', spur_id: 's1', mute: true }]);
  assert.equal(wurzel.querySelector('[data-a="mute"][data-spur="s1"]').getAttribute('aria-pressed'), 'true', 'the answer redraws the head');
  attrappe.antworten['POST /proj/aendern'] = { j: { rev: 7, projekt: projekt({ rev: 7 }) } };
  klick(wurzel.querySelector('[data-a="solo"][data-spur="s2"]')); await ruhe();
  assert.deepEqual(POSTS()[1].koerper.befehle, [{ befehl: 'spur_aendern', spur_id: 's2', solo: true }]);
});

test('the track head carries a level meter on the track channel, a device name and the column buttons', async () => {
  w.zeige(); await ruhe();
  const kopf = wurzel.querySelector('.t-kopf-spur');
  assert.equal(kopf.querySelector('.meter').getAttribute('data-kanal'), 'spur/1');
  assert.ok(kopf.textContent.includes('kick'), 'device name of the bk track');
  assert.ok(kopf.querySelector('[data-a="note-plus"]') && kopf.querySelector('[data-a="note-minus"]'));
  assert.ok(kopf.querySelector('[data-a="fx-plus"]') && kopf.querySelector('[data-a="fx-minus"]'));
});

test('+ adds a note column, remembered per project and track in localStorage (D5); - never goes below what the data needs', async () => {
  w.zeige(); await ruhe();
  assert.equal(zelle(0, 1, 0, 'note'), null);
  klick(wurzel.querySelector('[data-a="note-plus"][data-spur="s1"]')); await ruhe();
  assert.ok(zelle(0, 1, 0, 'note'), 'a second, empty note column');
  assert.equal(zelle(0, 1, 0, 'note').textContent, '...');
  assert.deepEqual(JSON.parse(localStorage.getItem('djk-tr-spalten-song-s1')), { n: 2, f: 1 });
  klick(wurzel.querySelector('[data-a="note-minus"][data-spur="s1"]')); await ruhe();
  assert.equal(zelle(0, 1, 0, 'note'), null);
  klick(wurzel.querySelector('[data-a="note-minus"][data-spur="s1"]')); await ruhe();
  assert.ok(zelle(0, 0, 0, 'note'), 'one note column stays');
  klick(wurzel.querySelector('[data-a="fx-plus"][data-spur="s1"]')); await ruhe();
  assert.ok(zelle(0, 0, 0, 'fx', 1));
  assert.equal(POSTS().length, 0);
});

test('a project that changed elsewhere reloads (nachladenNoetig); an older state of the same project is dropped', async () => {
  w.zeige(); await ruhe();
  const n = attrappe.anrufe.length;
  attrappe.antworten['GET /proj/aktuell'] = { j: { slug: 'song', projekt: projekt({ rev: 6, tempo_bpm: 125 }) } };
  w.ereignis('proj', { slug: 'song', rev: 6 }); await new Promise((ok) => setTimeout(ok, 80));
  assert.ok(attrappe.anrufe.length > n, 'a fetch of /proj/aktuell');
  assert.equal(w.ctx.st.projekt.tempo_bpm, 125);
  w.ctx.uebernimm('song', projekt({ rev: 4, tempo_bpm: 99 }));
  assert.equal(w.ctx.st.projekt.tempo_bpm, 125);
});

test('without an open project the empty state shows and nothing is drawn', async () => {
  installiere({ antworten: { 'GET /proj/aktuell': { j: { slug: null } } } });
  wurzel = document.createElement('section');
  w = bindeTracker({ post, wurzel, frage: () => true });
  w.zeige(); await ruhe();
  assert.equal(wurzel.querySelector('[data-t="leer"]').hidden, false);
  assert.equal(wurzel.querySelectorAll('.t-zeile').length, 0);
});

test('viewing writes nothing: opening, hiding, showing and the bar buttons of later tasks are only GETs', async () => {
  w.zeige(); await ruhe(); w.verberge(); w.zeige(); await ruhe();
  klick($t('follow'));
  for (const n of ['play', 'stopp', 'modus', 'bpm', 'lpb', 'ticks', 'okt', 'schritt', 'edit', 'speichern', 'module', 'zu-dj']) assert.ok($t(n), `bar item ${n}`);
  assert.equal($t('speichern').disabled, false, 'SAVE MODULE is enabled with an open project (task 23)');
  assert.equal($t('zu-dj').disabled, false, 'TO DJ is enabled with an open project (task 24)');
  for (const n of ['play', 'stopp', 'modus', 'bpm', 'lpb', 'ticks', 'okt', 'schritt', 'edit']) assert.equal($t(n).disabled, false, `${n} is enabled by the keyboard binder`);
  assert.deepEqual(attrappe.anrufe.map((a) => a.methode), attrappe.anrufe.map(() => 'GET'));
});

test('pure helpers: row numbers, row classes, cursor movement', () => {
  assert.equal(R.zeilenNummer(10, 64, 'hex'), '0A');
  assert.equal(R.zeilenNummer(10, 64, 'dec'), '10');
  assert.equal(R.zeilenNummer(10, 300, 'hex'), '00A', 'three hex digits above 256 rows');
  assert.equal(R.zeilenKlasse(0, 4, 4), 'takt');
  assert.equal(R.zeilenKlasse(16, 4, 4), 'takt');
  assert.equal(R.zeilenKlasse(4, 4, 4), 'beat');
  assert.equal(R.zeilenKlasse(3, 4, 4), '');
  const raster = projiziere(projekt(), { abschnitt_id: 'a1' });
  const opt = { spaltenAn: { vol: true, dly: false, chn: false, rpt: false, fx: true }, audioAn: true, anzahl: () => ({ n: 1, f: 1 }), taktBeats: 4 };
  const c0 = { spur: 0, spalte: 0, zeile: 0, unterspalte: 'note' };
  assert.deepEqual(R.bewegeCursor(raster, c0, 'ArrowDown', opt), { ...c0, zeile: 1 });
  assert.deepEqual(R.bewegeCursor(raster, c0, 'ArrowUp', opt), c0);
  assert.deepEqual(R.bewegeCursor(raster, c0, 'ArrowRight', opt), { ...c0, unterspalte: 'vol' });
  assert.deepEqual(R.bewegeCursor(raster, { ...c0, unterspalte: 'vol' }, 'ArrowRight', opt), { spur: 0, spalte: 0, zeile: 0, unterspalte: 'fx', fxspalte: 0 });
  assert.deepEqual(R.bewegeCursor(raster, { spur: 0, spalte: 0, zeile: 0, unterspalte: 'fx', fxspalte: 0 }, 'ArrowRight', opt), { spur: 1, spalte: 0, zeile: 0, unterspalte: 'note' }, 'right past the last sub-column enters the next track');
  assert.deepEqual(R.bewegeCursor(raster, { spur: 1, spalte: 0, zeile: 0, unterspalte: 'note' }, 'ArrowLeft', opt), { spur: 0, spalte: 0, zeile: 0, unterspalte: 'fx', fxspalte: 0 });
  assert.deepEqual(R.bewegeCursor(raster, c0, 'ArrowLeft', opt), c0, 'nothing left of the first sub-column');
  assert.equal(R.bewegeCursor(raster, { ...c0, spur: 2 }, 'Tab', opt).spur, 2, 'Tab on the last track stays');
  assert.equal(R.bewegeCursor(raster, { ...c0, spur: 2 }, 'Tab', { ...opt, audioAn: false }).spur, 1, 'a folded audio track is skipped (clamped to the last visible one)');
  assert.equal(R.bewegeCursor(raster, { ...c0, zeile: 60 }, 'PageDown', opt).zeile, 63);
});

test('the wiring of the fifth view is pinned in the page files', () => {
  const html = lies('public/index.html');
  assert.ok(html.includes('<button data-ansicht="tracker" aria-pressed="false" title="Tracker view: the open project as rows, keyboard first">TRACKER</button>'));
  assert.ok(html.indexOf('data-ansicht="tracker"') > html.indexOf('data-ansicht="produktion"'), 'after PRODUCTION');
  assert.ok(html.includes('<section id="tracker" aria-label="Tracker"></section>'));
  assert.ok(html.includes('<link rel="stylesheet" href="tracker/tracker.css">'));
  const rahmen = lies('public/seitenrahmen.js');
  assert.match(rahmen, /const ANSICHTEN = \[[^\]]*'tracker'[^\]]*\]/);
  assert.match(rahmen, /for \(const k of \[[^\]]*'tracker'[^\]]*\]\) document\.body\.classList\.toggle\(k, a === k\)/);
  assert.ok(rahmen.includes('export let tracker = null'));
  assert.ok(rahmen.includes('export function setzeTracker(t) { tracker = t; }'));
  assert.ok(rahmen.includes("if (a === 'tracker') tracker?.zeige(); else tracker?.verberge();"));
  const app = lies('public/app.js');
  assert.ok(app.includes("import { bindeTracker } from './tracker/tracker.js';"));
  assert.match(app, /if \(!geraetFensterSpurId\) try \{ setzeTracker\(bindeTracker\(\{ post: jsonPost[^\n]*\} catch \(e\) \{ console\.error\('Tracker view:', e\); \}/);
  assert.ok(/setzeTracker/.test(app.split('\n').find((z) => z.startsWith('import { bindeAnsicht'))), 'setzeTracker is imported');
  const strom = lies('public/stream.js');
  assert.ok(strom.includes("import { produktion, werkbank, tracker } from './seitenrahmen.js';"));
  assert.ok(strom.includes("try { tracker?.ereignis(a, f); } catch (e) { console.error('Tracker view:', e); }"));
  const pult = lies('areas/controller/pult_production.ts');
  assert.ok(pult.includes("'ansicht: dj, studio, produktion, werkbank or tracker'"));
  assert.match(pult, /const ANSICHT = \/\^\(dj\|studio\|produktion\|werkbank\|tracker\)\$\/;/);
});

test('the page frame ignores the library keys while TRACKER is the view (G would toggle lib-gross, Escape the drawer)', () => {
  const rahmen = lies('public/seitenrahmen.js');
  const handler = rahmen.slice(rahmen.indexOf("document.addEventListener('keydown'"), rahmen.indexOf("$('#suche').addEventListener"));
  assert.match(handler, /document\.body\.classList\.contains\('tracker'\)\) return;/);
  assert.ok(handler.indexOf("classList.contains('tracker')") < handler.indexOf("e.key === 'g'"));
  assert.ok(handler.indexOf("classList.contains('tracker')") < handler.indexOf("e.key === 'Escape' && istGeraeteseite"));
});

test('the tracker refusal reasons have English texts; the detail of the server (clip and track name) follows', async () => {
  const { FEHLER_TEXT, TRACKER_GRUENDE, antwortText, fehlerText } = await import('../public/production/production.js');
  assert.equal(TRACKER_GRUENDE.size, 12);   // + mod_ungueltig (IMPORT MOD, task 26)
  for (const g of TRACKER_GRUENDE) {
    assert.ok(typeof FEHLER_TEXT[g] === 'string' && FEHLER_TEXT[g].length > 8 && !/[äöüÄÖÜß]/.test(FEHLER_TEXT[g]), g);
    assert.equal(fehlerText({ status: 400, j: { fehler: g } }), FEHLER_TEXT[g]);
    assert.ok(!antwortText({ status: 400, j: { fehler: g } }).startsWith('Rejected'), g);
  }
  const detail = 'clip "Bass" on track "Lead" is linked to another section: make it UNIQUE first';
  assert.equal(antwortText({ status: 400, j: { fehler: 'abschnitt_verknuepft', text: 'request refused (abschnitt_verknuepft)', detail } }),
    `${FEHLER_TEXT.abschnitt_verknuepft}: ${detail}`);
});
