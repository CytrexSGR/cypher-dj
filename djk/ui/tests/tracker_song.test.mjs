// Tracker task 10: the SONG list with its section buttons and the pattern cells (public/tracker/song.js). The view runs against the DOM stand-in
// and a small stand-in server that really applies project commands (fuehreListeAus), so the tests assert the POST bodies AND the project that results.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';
import { neuesProjekt } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { kopie } from './support/project.mjs';

installiere();
const { bindeTracker, BINDER } = await import('../public/tracker/tracker.js');
const S = await import('../public/tracker/song.js');

const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 40; i++) await new Promise((ok) => setImmediate(ok)); };
const AENDERN = () => attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url === '/proj/aendern').map((a) => a.koerper);

let server, wurzel, w, $t, fragen;
function neuerServer(p0) {
  const s = { projekt: p0, verlauf: [] };
  const antwort = () => ({ rev: s.projekt.rev, projekt: s.projekt, slug: 'song' });
  s.antworten = {
    'GET /proj/aktuell': () => ({ j: antwort() }),
    'POST /proj/aendern': (k) => {
      if (k.rev !== s.projekt.rev) return { code: 409, j: { fehler: 'rev_veraltet' } };
      let neu;
      try { neu = fuehreListeAus(kopie(s.projekt), k.befehle).projekt; } catch (e) { return { code: 409, j: { fehler: e.grund ?? 'abgelehnt', text: e.message } }; }
      s.verlauf.push(s.projekt);
      s.projekt = { ...neu, rev: s.projekt.rev + 1 };
      return { j: antwort() };
    },
  };
  return s;
}
const lauf = (p, b) => fuehreListeAus(kopie(p), b).projekt;
const midi = (name, start, laenge) => ({ befehl: 'clip_neu', spur_id: 's1', art: 'midi', name, start_beat: start, laenge_beats: laenge });
// one instrument track "I" (s1) and one "J" (s2); sections a1 (16 beats, 64 rows) and a2 (16 beats); clips Intro (a1) and Verse (a2) on s1
const basis = () => lauf(neuesProjekt('Song'), [
  { befehl: 'spur_neu', art: 'instrument', name: 'I', geraet: { art: 'intern', name: 'bk', graph: 'synth-mono', parameter: {} } },
  { befehl: 'spur_neu', art: 'instrument', name: 'J', geraet: { art: 'intern', name: 'bk', graph: 'synth-mono', parameter: {} } },
  { befehl: 'abschnitt_neu', zeilen: 64, name: 'Verse' },
  { befehl: 'abschnitt_umbenennen', id: 'a1', name: 'Intro' },
  midi('Intro', 0, 16), midi('Verse', 16, 16),
]);

async function aufbau(p = basis(), { bestaetigen = true } = {}) {
  server = neuerServer(p);
  installiere({ speicher: {}, antworten: server.antworten });
  fragen = [];
  wurzel = document.createElement('section');
  w = bindeTracker({ post, wurzel, frage: (t) => { fragen.push(t); return bestaetigen; } });
  $t = (n) => wurzel.querySelector(`[data-t="${n}"]`);
  w.zeige(); await ruhe();
}
const zeilen = () => wurzel.querySelectorAll('.t-lied-zeile');
const zellen = (abschnitt) => wurzel.querySelectorAll(`[data-t="song-zelle"][data-abschnitt="${abschnitt}"]`);
const klick = async (e) => { e.dispatch('click'); await ruhe(); };
const abschnittIds = () => server.projekt.tracker.abschnitte.map((a) => a.id);
beforeEach(() => aufbau());

test('BINDER carries the SONG binder after the keyboard binder (TO DJ follows it)', () => {
  assert.equal(BINDER.at(3), S.bindeSong);
});

test('the list shows number, name and length in rows, and one pattern cell per track: the clip covering most of the section, empty when none', async () => {
  assert.equal(zeilen().length, 2);
  assert.ok(zeilen()[0].textContent.includes('Intro') && zeilen()[0].textContent.includes('64'));
  assert.ok(zeilen()[1].textContent.includes('Verse'));
  assert.deepEqual(zellen('a1').map((c) => c.textContent.trim()), ['Intro', '']);
  assert.deepEqual(zellen('a2').map((c) => c.textContent.trim()), ['Verse', '']);
  assert.equal(zellen('a1')[0].getAttribute('data-spur'), 's1');
  assert.equal(AENDERN().length, 0);
});

test('covering clip: the largest overlap wins, the earlier start breaks a tie', () => {
  const p = { spuren: [{ id: 's1', clips: [
    { id: 'c1', art: 'midi', name: 'short', start_beat: 0, laenge_beats: 4 },
    { id: 'c2', art: 'midi', name: 'long', start_beat: 4, laenge_beats: 12 },
    { id: 'c3', art: 'midi', name: 'next', start_beat: 16, laenge_beats: 16 }] }] };
  const a1 = { von_beat: 0, laenge_beats: 16 };
  assert.equal(S.deckendeClip(p.spuren[0], a1).id, 'c2');
  assert.equal(S.deckendeClip(p.spuren[0], { von_beat: 0, laenge_beats: 8 }).id, 'c1', 'tie of 4 and 4: the earlier clip');
  assert.equal(S.deckendeClip(p.spuren[0], { von_beat: 40, laenge_beats: 8 }), null);
});

test('the colour is stable from the verbund id; clips without a pattern get none', () => {
  assert.equal(S.verbundFarbe('v1'), S.verbundFarbe('v1'));
  assert.notEqual(S.verbundFarbe('v1'), S.verbundFarbe('v2'));
  assert.match(S.verbundFarbe('v7'), /^hsl\(/);
});

test('a click selects the section; the buttons send the commands of task 8 for the selected section', async () => {
  await klick(zeilen()[1]);
  assert.equal(w.ctx.st.abschnitt_id, 'a2');
  assert.ok(zeilen()[1].classList.contains('an'));
  assert.equal(AENDERN().length, 0);

  await klick($t('song-neu'));
  assert.deepEqual(AENDERN().at(-1).befehle, [{ befehl: 'abschnitt_neu', nach: 'a2' }]);
  assert.equal(abschnittIds().length, 3);
  assert.equal(w.ctx.st.abschnitt_id, abschnittIds()[2], 'the new section is selected');

  await klick(zeilen()[0]);
  await klick($t('song-dup-link'));
  assert.deepEqual(AENDERN().at(-1).befehle, [{ befehl: 'abschnitt_duplizieren', id: 'a1', als: 'verknuepft' }]);
  await klick(zeilen()[0]);
  await klick($t('song-dup-kopie'));
  assert.deepEqual(AENDERN().at(-1).befehle, [{ befehl: 'abschnitt_duplizieren', id: 'a1', als: 'kopie' }]);

  await klick(zeilen()[0]);
  await klick($t('song-runter'));
  assert.deepEqual(AENDERN().at(-1).befehle, [{ befehl: 'abschnitt_verschieben', id: 'a1', richtung: 1 }]);
  assert.equal(w.ctx.st.abschnitt_id, 'a1', 'the selection follows the section');
  await klick($t('song-hoch'));
  assert.deepEqual(AENDERN().at(-1).befehle, [{ befehl: 'abschnitt_verschieben', id: 'a1', richtung: -1 }]);
});

test('ROWS and NAME commit on change: whole rows only, an empty name removes the name', async () => {
  assert.equal($t('song-zeilen').value, '64');
  assert.equal($t('song-name').value, 'Intro');
  $t('song-zeilen').value = '32'; $t('song-zeilen').dispatch('change'); await ruhe();
  assert.deepEqual(AENDERN().at(-1).befehle, [{ befehl: 'abschnitt_laenge', id: 'a1', zeilen: 32 }]);
  assert.equal($t('song-zeilen').value, '32');
  $t('song-name').value = 'Start'; $t('song-name').dispatch('change'); await ruhe();
  assert.deepEqual(AENDERN().at(-1).befehle, [{ befehl: 'abschnitt_umbenennen', id: 'a1', name: 'Start' }]);
  assert.ok(zeilen()[0].textContent.includes('Start'));
  $t('song-name').value = ''; $t('song-name').dispatch('change'); await ruhe();
  assert.deepEqual(AENDERN().at(-1).befehle, [{ befehl: 'abschnitt_umbenennen', id: 'a1', name: null }]);
  const n = AENDERN().length;
  $t('song-zeilen').value = 'abc'; $t('song-zeilen').dispatch('change'); await ruhe();
  assert.equal(AENDERN().length, n, 'no request for a value that is not a whole number');
  assert.equal($t('song-zeilen').value, '32', 'the field shows the real length again');
  assert.ok($t('meldung').classList.contains('fehler'));
});

test('DELETE asks first (frage) and sends nothing when declined; the last section is refused and the refusal is shown', async () => {
  await aufbau(basis(), { bestaetigen: false });
  await klick($t('song-loeschen'));
  assert.equal(fragen.length, 1);
  assert.equal(AENDERN().length, 0);
  await aufbau(basis(), { bestaetigen: true });
  await klick(zeilen()[1]);
  await klick($t('song-loeschen'));
  assert.deepEqual(AENDERN().at(-1).befehle, [{ befehl: 'abschnitt_loeschen', id: 'a2' }]);
  assert.equal(abschnittIds().length, 1);
  assert.equal(w.ctx.st.abschnitt_id, 'a1');
  await klick($t('song-loeschen'));
  assert.equal(abschnittIds().length, 1, 'the server refused');
  assert.ok($t('meldung').classList.contains('fehler'));
  assert.ok($t('meldung').textContent.length > 0);
});

test('DUP LINK: the two cells of the pattern share one colour, an unlinked cell has another', async () => {
  await klick(zeilen()[0]);
  await klick($t('song-dup-link'));
  const ids = abschnittIds();
  assert.equal(ids.length, 3);
  const clips = server.projekt.spuren[0].clips.filter((c) => c.name === 'Intro');
  assert.equal(clips.length, 2);
  assert.equal(clips[0].verbund, clips[1].verbund);
  const stil = (c) => c.getAttribute('style');
  const a = zellen('a1')[0], b = zellen(ids[1])[0];
  assert.equal(a.textContent.trim(), 'Intro');
  assert.equal(b.textContent.trim(), 'Intro');
  assert.ok(stil(a) && stil(a) === stil(b), 'same verbund, same colour');
  assert.equal(a.getAttribute('data-verbund'), b.getAttribute('data-verbund'));
  assert.ok(stil(zellen('a2')[0]) !== stil(a), 'the unlinked Verse cell has none of it');
});

test('double click on a pattern cell opens the menu; picking a pattern sends clip_verknuepfen with the covering clip and the chosen one', async () => {
  const intro = server.projekt.spuren[0].clips.find((c) => c.name === 'Intro').id;
  const verse = server.projekt.spuren[0].clips.find((c) => c.name === 'Verse').id;
  zellen('a2')[0].dispatch('dblclick'); await ruhe();
  assert.ok(!$t('song-menue').hidden);
  const eintraege = wurzel.querySelectorAll('[data-t="song-muster"]');
  assert.deepEqual(eintraege.map((e) => e.getAttribute('data-clip')), [intro], 'the other patterns of this track');
  await klick(eintraege[0]);
  assert.deepEqual(AENDERN().at(-1).befehle, [{ befehl: 'clip_verknuepfen', clip_id: verse, mit: intro }]);
  assert.ok($t('song-menue').hidden, 'the menu closes');
  assert.equal(zellen('a2')[0].textContent.trim(), 'Intro');
  const c = server.projekt.spuren[0].clips;
  assert.equal(c[0].verbund, c[1].verbund);
  assert.equal(zellen('a2')[0].getAttribute('style'), zellen('a1')[0].getAttribute('style'));
});

test('UNIQUE sends clip_entknuepfen and is only offered for a linked clip', async () => {
  zellen('a1')[0].dispatch('dblclick'); await ruhe();
  assert.ok($t('song-eigen').disabled, 'a clip without a pattern: nothing to unlink');
  await klick(zellen('a1')[0]);
  await klick($t('song-dup-link'));
  const verknuepft = server.projekt.spuren[0].clips.find((c) => c.verbund);
  zellen('a1')[0].dispatch('dblclick'); await ruhe();
  assert.equal($t('song-eigen').disabled, false);
  await klick($t('song-eigen'));
  assert.deepEqual(AENDERN().at(-1).befehle, [{ befehl: 'clip_entknuepfen', clip_id: verknuepft.id }]);
  assert.ok(server.projekt.spuren[0].clips.every((c) => c.verbund === undefined), 'a pattern left with one member loses its verbund');
});

test('NEW in the menu: one list that deletes the covering clip and creates an empty section-wide clip; without a covering clip it only creates', async () => {
  const verse = server.projekt.spuren[0].clips.find((c) => c.name === 'Verse').id;
  zellen('a2')[0].dispatch('dblclick'); await ruhe();
  await klick($t('song-leer'));
  const b = AENDERN().at(-1).befehle;
  assert.equal(AENDERN().at(-1).label.length > 0, true);
  assert.deepEqual(b.map((x) => x.befehl), ['clip_loeschen', 'clip_neu']);
  assert.equal(b[0].clip_id, verse);
  assert.deepEqual({ ...b[1], name: undefined }, { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 16, laenge_beats: 16, name: undefined });
  const neu = server.projekt.spuren[0].clips.find((c) => c.start_beat === 16);
  assert.ok(neu && neu.id !== verse && neu.noten.length === 0);

  // track J has no clip anywhere: the second cell of a1
  zellen('a1')[1].dispatch('dblclick'); await ruhe();
  await klick($t('song-leer'));
  assert.deepEqual(AENDERN().at(-1).befehle.map((x) => x.befehl), ['clip_neu']);
  assert.equal(server.projekt.spuren[1].clips.length, 1);
  assert.equal(server.projekt.spuren[1].clips[0].laenge_beats, 16);
});

test('a refusal of a pattern command is shown with the refusal text', async () => {
  zellen('a2')[0].dispatch('dblclick'); await ruhe();
  const eintrag = wurzel.querySelectorAll('[data-t="song-muster"]')[0];
  server.antworten['POST /proj/aendern'] = () => ({ code: 409, j: { fehler: 'verbund_spur', text: 'request refused (verbund_spur)', detail: 'x (s1) and y (s2) lie on different tracks' } });
  await klick(eintrag);
  assert.ok($t('meldung').classList.contains('fehler'));
  assert.equal($t('meldung').textContent, 'Linked clips must lie on the same track: x (s1) and y (s2) lie on different tracks');
});
