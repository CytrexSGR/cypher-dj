// Tracker task 6: keyboard entry, selection keys, undo and transport in the view. The view runs against the DOM stand-in
// (tests/helpers/pages_mock.mjs) and a small stand-in server that really applies project commands (fuehreListeAus) and keeps an undo
// stack, so the tests assert the POST bodies AND the project that results. Keys are dispatched on the grid element.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';
import { neuesProjekt } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { kopie } from './support/project.mjs';

installiere();
const { bindeTracker, BINDER } = await import('../public/tracker/tracker.js');
const B = await import('../public/tracker/operation.js');

const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 40; i++) await new Promise((ok) => setImmediate(ok)); };
const POSTS = (weg) => attrappe.anrufe.filter((a) => a.methode === 'POST' && (!weg || a.url === weg));
const AENDERN = () => POSTS('/proj/aendern').map((a) => a.koerper);

// --- stand-in server ---
let server, dokListener, wurzel, w, $t;
function neuerServer(p0) {
  const s = { projekt: p0, verlauf: [], rev: p0.rev };
  const antwort = () => ({ rev: s.projekt.rev, projekt: s.projekt, slug: 'song' });
  s.antworten = {
    'GET /proj/aktuell': () => ({ j: antwort() }),
    'POST /proj/aendern': (k) => {
      if (k.rev !== s.projekt.rev) return { code: 409, j: { fehler: 'rev_veraltet' } };
      const neu = fuehreListeAus(kopie(s.projekt), k.befehle).projekt;
      s.verlauf.push(s.projekt);
      s.projekt = { ...neu, rev: s.projekt.rev + 1 };
      return { j: antwort() };
    },
    'POST /proj/undo': () => {
      const vorher = s.verlauf.pop();
      if (!vorher) return { code: 409, j: { fehler: 'nichts_zu_tun' } };
      s.projekt = { ...vorher, rev: s.projekt.rev + 1 };
      return { j: antwort() };
    },
    'POST /sampler/hoeren': () => ({ j: {} }),
    'POST /proj/transport': () => ({ j: { quittung: { status: 0 } } }),
  };
  return s;
}
const lauf = (p, b) => fuehreListeAus(kopie(p), b).projekt;
const basis = () => lauf(neuesProjekt('Song'), [{ befehl: 'spur_neu', art: 'instrument', name: 'I', geraet: { art: 'intern', name: 'bk', graph: 'synth-mono', parameter: {} } }]);
const ohneRev = (p) => { const k = kopie(p); delete k.rev; return JSON.stringify(k); };

async function aufbau(p = basis(), speicher = {}) {
  server = neuerServer(p);
  installiere({ speicher, antworten: server.antworten });
  dokListener = [];
  document.addEventListener = (art, f) => { if (art === 'keydown') dokListener.push(f); };
  wurzel = document.createElement('section');
  w = bindeTracker({ post, wurzel, frage: () => true });
  $t = (n) => wurzel.querySelector(`[data-t="${n}"]`);
  w.zeige(); await ruhe();
}
const st = () => w.ctx.st;
const taste = (code, extra = {}) => $t('raster').dispatch('keydown', { code, key: extra.key ?? code, ...extra });
const buchstabe = (c, extra = {}) => taste(`Key${c}`, { key: c.toLowerCase(), ...extra });
const ziffer = (z, extra = {}) => taste(`Digit${z}`, { key: String(z), ...extra });
const strg = (c, extra = {}) => taste(`Key${c}`, { key: c.toLowerCase(), ctrlKey: true, ...extra });
const zelle = (s, sp, z, u, f = '') => wurzel.querySelector(`[data-k="${s}:${sp}:${z}:${u}:${f}"]`);
const clip = () => server.projekt.spuren[0].clips[0];
const noten = () => (clip()?.noten ?? []).map((n) => ({ ...n })).sort((a, b) => a.beat - b.beat || a.ton - b.ton);
const editAn = async () => { $t('edit').dispatch('click'); await ruhe(); };
const meldung = () => $t('meldung');
beforeEach(() => aufbau());

test('BINDER has the keyboard binder after the grid; the bar items of this task are enabled (TICKS since task 17), SAVE MODULE is on with a project, TO DJ is on with a project', () => {
  assert.equal(BINDER.length, 9);
  assert.equal(BINDER[2], B.bindeBedienung);
  for (const n of ['play', 'stopp', 'modus', 'bpm', 'lpb', 'ticks', 'okt', 'schritt', 'edit']) assert.equal($t(n).disabled, false, n);
  assert.equal($t('speichern').disabled, false, 'SAVE MODULE (task 23) is enabled with an open project');
  assert.equal($t('zu-dj').disabled, false, 'TO DJ (task 24) is enabled with an open project');
});

test('acceptance: a bar of notes (16 rows) with EDIT on = 16 requests, the notes are in the MIDI clip; undo per key press restores the project byte for byte', async () => {
  const vorher = ohneRev(server.projekt);
  await editAn();
  assert.equal($t('edit').getAttribute('aria-pressed'), 'true');
  const codes = ['KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM', 'KeyQ', 'Digit2', 'KeyW', 'Digit3'];
  for (const c of codes) taste(c);                       // all 16 presses at once: each is one request, computed in its turn
  await ruhe();
  assert.equal(AENDERN().length, 16);
  assert.equal(AENDERN()[0].befehle[0].befehl, 'clip_neu');
  assert.deepEqual(AENDERN().slice(1).map((k) => k.befehle.at(-1).befehl), Array(15).fill('noten_neu'));
  assert.equal(AENDERN()[0].label, 'Note C-3');
  assert.deepEqual(noten().map((n) => [n.beat, n.ton]), codes.map((_, i) => [i / 4, 60 + i]));
  assert.ok(noten().slice(0, 15).every((n) => n.laenge === 0.25), 'every note lasts up to the next one');
  assert.equal(st().cursor.zeile, 16, 'the cursor moved down by STEP after every note');
  assert.deepEqual(POSTS('/sampler/hoeren').map((a) => a.koerper.ton), codes.map((_, i) => 60 + i));
  assert.equal(POSTS('/sampler/hoeren')[0].koerper.spur_id, 's1');

  for (let i = 0; i < 16; i++) {
    const vor = noten().length;
    dokListener.forEach((f) => f({ target: $t('raster'), key: 'z', code: 'KeyZ', ctrlKey: true, preventDefault() {} }));
    await ruhe();
    assert.equal(POSTS('/proj/undo').length, i + 1, 'one request per key press');
    if (i < 15) assert.equal(noten().length, i === 0 ? 15 : vor - 1, `after undo ${i + 1}`);
  }
  assert.equal(ohneRev(server.projekt), vorher, 'the original project, byte for byte');
});

test('EDIT off: note keys only sound, nothing is written, the cursor stays; OCT shifts the pitch', async () => {
  buchstabe('Z'); await ruhe();
  assert.equal(AENDERN().length, 0);
  assert.deepEqual(POSTS('/sampler/hoeren').map((a) => a.koerper), [{ spur_id: 's1', ton: 60 }]);
  assert.equal(st().cursor.zeile, 0);
  taste('BracketRight'); buchstabe('Z'); await ruhe();
  assert.equal($t('okt').value, '4');
  assert.equal(POSTS('/sampler/hoeren')[1].koerper.ton, 72);
  taste('BracketLeft'); taste('BracketLeft'); buchstabe('Z'); await ruhe();
  assert.equal(POSTS('/sampler/hoeren')[2].koerper.ton, 48);
});

test('a note key with EDIT off says why nothing was written (hint names Escape and the EDIT button)', async () => {
  buchstabe('Z'); await ruhe();
  assert.equal(AENDERN().length, 0);
  assert.ok(meldung().textContent.includes('EDIT is off'), meldung().textContent);
  assert.ok(meldung().textContent.includes('Escape') && meldung().textContent.includes('click EDIT'), meldung().textContent);
});

test('a note key with EDIT off keeps the reminder in the status line until EDIT is on, and flashes the EDIT button', async () => {
  assert.ok(!$t('status').textContent.includes('EDIT is off'));
  buchstabe('Z'); await ruhe();
  assert.ok($t('status').textContent.includes('EDIT is off'), $t('status').textContent);
  assert.ok($t('status').textContent.includes('row 00'), 'the cursor text stays: ' + $t('status').textContent);
  assert.ok($t('edit').classList.contains('blitz'), 'EDIT button flashes');
  await ruhe();
  assert.ok($t('status').textContent.includes('EDIT is off'), 'still there later');
  await editAn();
  assert.ok(!$t('status').textContent.includes('EDIT is off'), $t('status').textContent);
});

test('a refusal of the sampler is shown in the message line', async () => {
  server.antworten['POST /sampler/hoeren'] = () => ({ code: 409, j: { fehler: 'kein_klang', text: 'This track has no sound yet' } });
  buchstabe('Z'); await ruhe();
  assert.ok(meldung().textContent.includes('This track has no sound yet'), meldung().textContent);
});

test('Shift holds the cursor and puts the chord into the next free note column; STEP (Alt+Up/Down) sets the advance', async () => {
  await editAn();
  buchstabe('Z', { shiftKey: true }); buchstabe('C', { shiftKey: true }); await ruhe();
  assert.equal(st().cursor.zeile, 0);
  assert.equal(AENDERN().length, 2);
  assert.deepEqual(noten().map((n) => [n.beat, n.ton, n.spalte ?? 1]), [[0, 60, 1], [0, 64, 2]]);
  taste('ArrowUp', { altKey: true }); taste('ArrowUp', { altKey: true });
  assert.equal($t('schritt').value, '3');
  buchstabe('X'); await ruhe();
  assert.equal(st().cursor.zeile, 3);
  for (let i = 0; i < 30; i++) taste('ArrowUp', { altKey: true });
  assert.equal($t('schritt').value, '16', 'STEP is at most 16');
  for (let i = 0; i < 30; i++) taste('ArrowDown', { altKey: true });
  assert.equal($t('schritt').value, '0');
});

test('a refused builder shows its text in the message line and sends nothing', async () => {
  await editAn();
  for (let i = 0; i < 5; i++) taste('BracketRight');
  assert.equal($t('okt').value, '8');
  buchstabe('P'); await ruhe();                          // 12 * 10 + 28 = 148
  assert.equal(AENDERN().length, 0);
  assert.ok(meldung().textContent.includes('out of range'), meldung().textContent);
  assert.ok(meldung().classList.contains('fehler'));
  assert.equal(POSTS('/sampler/hoeren').length, 0, 'a pitch the grid cannot hold is not sounded');
});

test('note off (A) writes a note off and moves down; Delete clears the cell, Backspace pulls the rows up, Insert pushes them down', async () => {
  await editAn();
  buchstabe('Z'); buchstabe('X'); buchstabe('C'); await ruhe();          // rows 0, 1, 2
  taste('ArrowUp'); taste('ArrowUp'); taste('ArrowUp');
  assert.equal(st().cursor.zeile, 0);
  taste('Insert'); await ruhe();                                          // push down from row 0
  assert.deepEqual(noten().map((n) => n.beat), [0.25, 0.5, 0.75]);
  taste('Backspace'); await ruhe();                                       // pull up: the note in row 0 (none) ... rows move back
  assert.deepEqual(noten().map((n) => n.beat), [0, 0.25, 0.5]);
  taste('Delete'); await ruhe();
  assert.deepEqual(noten().map((n) => n.ton), [62, 64]);
  assert.equal(st().cursor.zeile, 0, 'Delete does not move');
  taste('ArrowDown'); buchstabe('A'); await ruhe();
  assert.equal(AENDERN().at(-1).label, 'Note off');
  assert.equal(st().cursor.zeile, 2, 'a note off moves down like a note');
});

test('with EDIT off the writing keys refuse with a hint and send nothing', async () => {
  taste('Delete'); taste('Insert'); strg('V'); await ruhe();
  assert.equal(AENDERN().length, 0);
  assert.ok(meldung().textContent.includes('EDIT'), meldung().textContent);
});

test('value digits: VOL completes after 2 hex digits, a pending digit is dropped when the cursor moves, DEC takes 3', async () => {
  await editAn();
  for (let i = 0; i < 4; i++) buchstabe('Z');   // rows 0..3
  await ruhe();
  const n0 = AENDERN().length;
  st().cursor = { spur: 0, spalte: 0, zeile: 1, unterspalte: 'vol' }; w.ctx.zeichne();
  ziffer(4); await ruhe();
  assert.equal(AENDERN().length, n0, 'one digit is only buffered');
  taste('ArrowDown'); taste('ArrowUp'); ziffer(0); await ruhe();
  assert.equal(AENDERN().length, n0, 'the buffer was dropped when the cursor moved');
  ziffer(5); await ruhe();                                                // buffer "05" now: 0 then 5 = 05
  assert.equal(AENDERN().length, n0 + 1);
  assert.deepEqual(AENDERN().at(-1).befehle, [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: noten().find((n) => n.beat === 0.25).id, vel: 5 }] }]);
  ziffer(4); ziffer(0); await ruhe();                                     // hex 40 = 64
  assert.equal(noten().find((n) => n.beat === 0.25).vel, 64);
  $t('zahlen').dispatch('click');
  ziffer(1); ziffer(2); await ruhe();
  assert.equal(noten().find((n) => n.beat === 0.25).vel, 64, 'DEC: two digits are not enough');
  ziffer(0); await ruhe();
  assert.equal(noten().find((n) => n.beat === 0.25).vel, 120);
  // the last VOL typed on the track is the velocity of the next new note (D3)
  st().cursor = { spur: 0, spalte: 0, zeile: 8, unterspalte: 'note' }; w.ctx.zeichne();
  buchstabe('Z'); await ruhe();
  assert.equal(noten().find((n) => n.beat === 2).vel, 120);
});

test('a value outside its range is refused by the builder and shown, never clamped', async () => {
  await editAn();
  buchstabe('Z'); await ruhe();
  const n = AENDERN().length;
  st().cursor = { spur: 0, spalte: 0, zeile: 0, unterspalte: 'vol' }; w.ctx.zeichne();
  taste('KeyF', { key: 'f' }); taste('KeyF', { key: 'f' }); await ruhe();     // FF = 255
  assert.equal(AENDERN().length, n);
  assert.ok(meldung().textContent.includes('Velocity 1..127'), meldung().textContent);
});

test('CHN takes 2 digits, RPT 1 digit, DLY takes an optional minus and 2 digits (00 clears the delay)', async () => {
  await editAn();
  for (let i = 0; i < 6; i++) buchstabe('Z');
  await ruhe();
  for (const u of ['chn', 'rpt', 'dly']) $t(`sp-${u}`).dispatch('click');
  const id = (beat) => noten().find((n) => n.beat === beat).id;
  const wert = (beat, f) => noten().find((n) => n.beat === beat)[f];
  st().cursor = { spur: 0, spalte: 0, zeile: 2, unterspalte: 'chn' }; w.ctx.zeichne();
  ziffer(5); await ruhe(); assert.equal(wert(0.5, 'chance'), undefined);
  ziffer(0); await ruhe(); assert.equal(wert(0.5, 'chance'), 50);
  st().cursor = { spur: 0, spalte: 0, zeile: 2, unterspalte: 'rpt' }; w.ctx.zeichne();
  ziffer(3); await ruhe(); assert.equal(wert(0.5, 'wdh'), 3);
  st().cursor = { spur: 0, spalte: 0, zeile: 4, unterspalte: 'dly' }; w.ctx.zeichne();
  taste('Minus', { key: '-' }); ziffer(2); await ruhe(); assert.equal(wert(1, 'versatz'), undefined);
  ziffer(5); await ruhe(); assert.equal(wert(1, 'versatz'), -25);
  assert.equal(id(1) !== undefined, true);
  ziffer(0); ziffer(0); await ruhe(); assert.equal(wert(1, 'versatz'), undefined, '00 clears the delay');
});

test('shift+arrows select, the selected cells are marked; Escape clears the selection first and toggles EDIT only without one', async () => {
  await editAn();
  for (let i = 0; i < 4; i++) buchstabe('Z');
  await ruhe();
  st().cursor = { spur: 0, spalte: 0, zeile: 1, unterspalte: 'note' }; w.ctx.zeichne();
  taste('ArrowDown', { shiftKey: true }); taste('ArrowDown', { shiftKey: true }); await ruhe();
  assert.equal(st().cursor.zeile, 1, 'the cursor is the anchor');
  const marks = wurzel.querySelectorAll('.t-c.gewaehlt').map((e) => e.getAttribute('data-k').split(':')[2]);
  assert.ok(marks.includes('1') && marks.includes('2') && marks.includes('3') && !marks.includes('0') && !marks.includes('4'), marks.join());
  taste('Escape');
  assert.equal(wurzel.querySelectorAll('.t-c.gewaehlt').length, 0);
  assert.equal($t('edit').getAttribute('aria-pressed'), 'true', 'the first Escape only cleared the selection');
  taste('Escape');
  assert.equal($t('edit').getAttribute('aria-pressed'), 'false');
  taste('Escape');
  assert.equal($t('edit').getAttribute('aria-pressed'), 'true');
});

test('copy, paste, transpose, duplicate and select-all go through the builders of task 5, one request each', async () => {
  await editAn();
  for (let i = 0; i < 4; i++) buchstabe('Z');
  await ruhe();
  const n0 = AENDERN().length;
  st().cursor = { spur: 0, spalte: 0, zeile: 0, unterspalte: 'note' }; w.ctx.zeichne();
  taste('ArrowDown', { shiftKey: true }); taste('ArrowDown', { shiftKey: true });
  strg('C'); await ruhe();
  assert.equal(AENDERN().length, n0, 'copy writes nothing');
  taste('ArrowUp', { ctrlKey: true }); await ruhe();                       // transpose the selection +1
  assert.equal(AENDERN().length, n0 + 1);
  assert.equal(AENDERN().at(-1).label, 'Transpose +1');
  assert.deepEqual(noten().slice(0, 3).map((n) => n.ton), [61, 61, 61]);
  taste('Escape');
  st().cursor = { spur: 0, spalte: 0, zeile: 8, unterspalte: 'note' }; w.ctx.zeichne();
  strg('V'); await ruhe();
  assert.equal(AENDERN().length, n0 + 2);
  assert.deepEqual(noten().filter((n) => n.beat >= 2).map((n) => n.beat), [2, 2.25, 2.5]);
  taste('ArrowDown', { shiftKey: true });
  strg('D'); await ruhe();
  assert.equal(AENDERN().at(-1).label, 'Duplicate');
  strg('A'); await ruhe();
  assert.ok(wurzel.querySelectorAll('.t-c.gewaehlt').length > 0);
});

test('a builder refusal of a selection operation is shown (interpolate without a value column)', async () => {
  await editAn();
  buchstabe('Z'); await ruhe();
  const n = AENDERN().length;
  strg('I'); await ruhe();
  assert.equal(AENDERN().length, n);
  assert.ok(meldung().classList.contains('fehler'));
});

// --- transport ---
test('Space: PATTERN sets the section loop (one request, only when it differs), then starts at the section start; Space again stops', async () => {
  await aufbau();
  taste('Space'); await ruhe();
  const ab = AENDERN();
  assert.equal(ab.length, 1);
  assert.equal(ab[0].label, 'Loop section 00');
  assert.deepEqual(ab[0].befehle, [{ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 16 }]);
  assert.deepEqual(POSTS('/proj/transport').map((a) => a.koerper), [{ aktion: 'start', beat: 0 }]);
  const alle = attrappe.anrufe.filter((a) => a.methode === 'POST').map((a) => a.url);
  assert.deepEqual(alle, ['/proj/aendern', '/proj/transport'], 'the loop is set before the start');
  w.ereignis('/zustand/arr', { status: 2, projekt_beat: 1 });
  taste('Space'); await ruhe();
  assert.deepEqual(POSTS('/proj/transport').at(-1).koerper, { aktion: 'stopp' });
  w.ereignis('/zustand/arr', { status: 0, projekt_beat: 0 });
  taste('Space'); await ruhe();
  assert.equal(AENDERN().length, 1, 'the loop already is the section loop: no second write');
  assert.deepEqual(POSTS('/proj/transport').at(-1).koerper, { aktion: 'start', beat: 0 });
});

test('Enter plays from the cursor row; the PLAY and STOP buttons do what Space does', async () => {
  await aufbau();
  for (let i = 0; i < 8; i++) taste('ArrowDown');
  taste('Enter'); await ruhe();
  assert.deepEqual(POSTS('/proj/transport').at(-1).koerper, { aktion: 'start', beat: 2 }, 'row 8 at 4 rows per beat');
  $t('stopp').dispatch('click'); await ruhe();
  assert.deepEqual(POSTS('/proj/transport').at(-1).koerper, { aktion: 'stopp' });
  $t('play').dispatch('click'); await ruhe();
  assert.deepEqual(POSTS('/proj/transport').at(-1).koerper, { aktion: 'start', beat: 0 });
});

test('SONG mode plays from the section start and switches off the loop the tracker set; a loop of the person stays', async () => {
  await aufbau();
  taste('Space'); await ruhe();                                           // PATTERN: loop on
  w.ereignis('/zustand/arr', { status: 0, projekt_beat: 0 });
  assert.equal(server.projekt.loop.an, true);
  $t('modus').dispatch('click');
  assert.equal($t('modus').textContent, 'SONG');
  taste('Space'); await ruhe();
  assert.deepEqual(AENDERN().at(-1).befehle, [{ befehl: 'loop_setzen', an: false, von_beat: 0, bis_beat: 16 }]);
  assert.equal(AENDERN().at(-1).label, 'Loop off');
  assert.deepEqual(POSTS('/proj/transport').at(-1).koerper, { aktion: 'start', beat: 0 });
  // a loop of the person (not the section loop of the tracker) is left alone
  const eigene = { ...server.projekt, rev: server.projekt.rev + 1, loop: { an: true, von_beat: 4, bis_beat: 12 } };
  server.projekt = eigene; w.ctx.uebernimm('song', eigene);
  const n = AENDERN().length;
  taste('Space'); await ruhe();
  assert.equal(AENDERN().length, n);
});

test('Shift+Space loops the current section from its first row, also in SONG mode', async () => {
  await aufbau();
  $t('modus').dispatch('click');
  for (let i = 0; i < 8; i++) taste('ArrowDown');
  taste('Space', { shiftKey: true, key: ' ' }); await ruhe();
  assert.deepEqual(AENDERN().at(-1).befehle, [{ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 16 }]);
  assert.deepEqual(POSTS('/proj/transport').at(-1).koerper, { aktion: 'start', beat: 0 });
});

test('a failed transport answer is shown', async () => {
  await aufbau();
  server.antworten['POST /proj/transport'] = () => ({ code: 409, j: { fehler: 'kein_kern' } });
  taste('Enter'); await ruhe();
  assert.ok(meldung().classList.contains('fehler'));
});

// --- bar fields ---
test('LPB writes tracker_setzen (one undo step) and keeps the cursor on its beat; BPM writes tempo_setzen; nonsense writes nothing', async () => {
  await aufbau();
  for (let i = 0; i < 8; i++) taste('ArrowDown');
  $t('lpb').value = '8'; $t('lpb').dispatch('change'); await ruhe();
  assert.deepEqual(AENDERN().at(-1), { rev: 0, label: 'LPB 8', befehle: [{ befehl: 'tracker_setzen', lpb: 8 }] });
  assert.equal($t('lpb').value, '8');
  assert.equal(st().cursor.zeile, 16, 'row 8 of 4 per beat = row 16 of 8 per beat');
  $t('bpm').value = '130'; $t('bpm').dispatch('change'); await ruhe();
  assert.deepEqual(AENDERN().at(-1).befehle, [{ befehl: 'tempo_setzen', bpm: 130 }]);
  assert.equal($t('bpm').value, '130');
  const n = AENDERN().length;
  $t('bpm').value = 'abc'; $t('bpm').dispatch('change'); await ruhe();
  assert.equal(AENDERN().length, n);
  assert.equal($t('bpm').value, '130', 'the stored value is shown again');
  assert.ok(meldung().classList.contains('fehler'));
});

test('OCT and STEP fields: a typed value is taken, nonsense is refused with the old value shown', async () => {
  await aufbau();
  $t('okt').value = '5'; $t('okt').dispatch('change');
  assert.equal(st().okt, 5);
  $t('okt').value = '9'; $t('okt').dispatch('change');
  assert.equal(st().okt, 5);
  assert.equal($t('okt').value, '5');
  $t('schritt').value = '2'; $t('schritt').dispatch('change');
  assert.equal(st().schritt, 2);
  $t('schritt').value = '17'; $t('schritt').dispatch('change');
  assert.equal(st().schritt, 2);
});

test('viewing and moving the cursor write nothing', async () => {
  await aufbau();
  for (const c of ['ArrowDown', 'ArrowRight', 'PageDown', 'End', 'Home', 'Tab']) taste(c);
  taste('Escape'); taste('Escape');
  await ruhe();
  assert.equal(POSTS().filter((a) => a.url === '/proj/aendern').length, 0);
});

test('pure helper: a selection covers its cells (one column or whole tracks)', () => {
  const a = { abschnitt_id: 'a1', spur_von: 0, spur_bis: 1, zeile_von: 2, zeile_bis: 4, spalten: 'spur' };
  assert.equal(B.inAuswahl(a, { spur: 1, spalte: 0, zeile: 3, unterspalte: 'vol' }), true);
  assert.equal(B.inAuswahl(a, { spur: 2, spalte: 0, zeile: 3, unterspalte: 'vol' }), false);
  assert.equal(B.inAuswahl(a, { spur: 0, spalte: 0, zeile: 5, unterspalte: 'note' }), false);
  const e = { abschnitt_id: 'a1', spur_von: 0, spur_bis: 0, zeile_von: 0, zeile_bis: 3, spalten: 'eine', spalte: 1, unterspalte: 'note' };
  assert.equal(B.inAuswahl(e, { spur: 0, spalte: 1, zeile: 1, unterspalte: 'dly' }), true);
  assert.equal(B.inAuswahl(e, { spur: 0, spalte: 0, zeile: 1, unterspalte: 'note' }), false);
  assert.equal(B.inAuswahl(e, { spur: 0, spalte: 0, zeile: 1, unterspalte: 'fx', fxspalte: 0 }), false);
  assert.equal(B.inAuswahl(null, { spur: 0, spalte: 0, zeile: 1, unterspalte: 'note' }), false);
});

// review fix: a key the grid uses never reaches the page handlers (L, G, S, Space, Escape, arrows of the library drawer and LIBRARY)
const spione = () => { const z = { pd: 0, sp: 0 }; return { z, preventDefault() { z.pd++; }, stopPropagation() { z.sp++; } }; };

test('keys the grid uses are consumed: preventDefault AND stopPropagation (note key G, Escape, arrow, Space)', async () => {
  await editAn();
  for (const [code, key] of [['KeyG', 'g'], ['Escape', 'Escape'], ['ArrowDown', 'ArrowDown'], ['Space', ' ']]) {
    const s = spione();
    taste(code, { key, preventDefault: s.preventDefault, stopPropagation: s.stopPropagation });
    assert.ok(s.z.pd >= 1 && s.z.sp >= 1, `${code}: pd ${s.z.pd}, sp ${s.z.sp}`);
  }
});

test('keys the grid does not use stay with the page; a hidden view and a text field take no key at all', async () => {
  const s = spione();
  taste('F5', { key: 'F5', preventDefault: s.preventDefault, stopPropagation: s.stopPropagation });
  assert.ok(s.z.pd === 0 && s.z.sp === 0, 'F5 is not ours');
  await editAn();
  const feld = spione();
  taste('KeyZ', { key: 'z', target: { tagName: 'INPUT', type: 'text', closest: () => null }, preventDefault: feld.preventDefault, stopPropagation: feld.stopPropagation });
  assert.ok(feld.z.pd === 0 && noten().length === 0, 'an input with the focus: no note');
  w.verberge();
  const weg = spione();
  taste('KeyZ', { key: 'z', preventDefault: weg.preventDefault, stopPropagation: weg.stopPropagation });
  assert.ok(weg.z.pd === 0 && weg.z.sp === 0 && noten().length === 0, 'a hidden view: no note, key not consumed');
});
