// Workbench file export (public/werkbank/export.js): the pure helpers and the binder against the DOM stand-in (tests/helpers/pages_mock.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe, El } from './helpers/pages_mock.mjs';

installiere();
const { ergebnisZeilen, ergebnisKopf, dbText, warteBis, bindeExport, EXPORT_TEXT } = await import('../public/werkbank/export.js');

const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };

test('ergebnisZeilen: WAV rows carry the peak and the silent mark, a muted track has no file; MIDI rows carry the note count', () => {
  const wav = ergebnisZeilen('wav', { dateien: [
    { art: 'mix', name: 'Song', datei: 'mix.wav', spitze_db: -3.04, stumm: false },
    { art: 'spur', name: 'Bass', datei: '02-bass.wav', spitze_db: -90.5, stumm: true },
    { art: 'spur', name: 'Pad', datei: null, spitze_db: -200, stumm: true },
    { art: 'return', name: 'Hall', datei: 'fx1-hall.wav', spitze_db: -12, stumm: false }] });
  assert.deepEqual(wav.map((z) => [z.kind, z.datei, z.detail, z.stumm]), [
    ['Mix', 'mix.wav', '-3.0 dB', false], ['Track', '02-bass.wav', '-90.5 dB', true], ['Track', '', 'muted, no file', true], ['Return', 'fx1-hall.wav', '-12.0 dB', false]]);
  const midi = ergebnisZeilen('midi', { dateien: [{ art: 'alle', name: 'Song', datei: 'song.mid', noten: 12 }, { art: 'spur', name: 'Bass', datei: '02-bass.mid', noten: 1 }] });
  assert.deepEqual(midi.map((z) => [z.kind, z.detail]), [['All parts', '12 notes'], ['Track', '1 note']]);
  assert.deepEqual(ergebnisZeilen('wav', null), []);
  assert.equal(dbText(NaN), '');
  assert.equal(ergebnisKopf('midi', { von_beat: 0, bis_beat: 16 }), 'MIDI export, beats 0 to 16');
});

test('warteBis: true as soon as the condition holds, false after the time', async () => {
  let n = 0;
  assert.equal(await warteBis(() => ++n >= 3, 500, 1), true);
  assert.equal(await warteBis(() => false, 20, 5), false);
});

// a context like the one of werkbank.js, just what the binder reads
function aufbau({ antworten = {}, arr = null, projekt = { name: 'M' } } = {}) {
  installiere({ antworten });
  const kopf = new El('div'), wurzel = new El('div');
  kopf.setAttribute('data-w', 'kopf'); wurzel.append(kopf);
  const meldungen = [], aufrufe = [];
  const ctx = {
    st: { projekt, arr }, $: (n) => wurzel.querySelector(`[data-w="${n}"]`), beimProjekt: [], beimEreignis: [],
    melde: (t, f = false) => meldungen.push({ t, f }), antwortText: (r) => r.j?.text ?? 'failed',
    holeJson: async (weg, k) => { aufrufe.push({ weg, k }); const a = antworten[`POST ${weg}`]; const x = typeof a === 'function' ? a(k) : a; return { status: x?.code ?? 200, j: x?.j ?? {} }; },
  };
  bindeExport(ctx);
  return { ctx, $: ctx.$, meldungen, aufrufe };
}
const MIDI_ANTWORT = { ordner: '/p/export/song-20261116-120000', von_beat: 0, bis_beat: 16,
  dateien: [{ art: 'alle', name: 'Song', datei: 'song.mid', noten: 3 }, { art: 'spur', spur_id: 's2', name: 'Bass', datei: '02-bass.mid', noten: 3 }] };

test('binder: the buttons are disabled without a module; a click on EXPORT MIDI posts and opens the result panel, ✕ closes it', async () => {
  const a = aufbau({ antworten: { 'POST /proj/export_midi': { j: MIDI_ANTWORT } }, projekt: null });
  assert.ok(a.$('export-wav').disabled && a.$('export-midi').disabled);
  assert.equal(a.$('export-ergebnis').hidden, true);
  a.ctx.st.projekt = { name: 'M' };
  for (const h of a.ctx.beimProjekt) h(a.ctx.st.projekt, true);
  assert.ok(!a.$('export-midi').disabled);
  a.$('export-midi').dispatch('click'); await ruhe();
  assert.deepEqual(a.aufrufe, [{ weg: '/proj/export_midi', k: {} }]);
  assert.ok(a.$('export-midi').textContent === EXPORT_TEXT.midi && !a.$('export-midi').disabled, 'busy state is over');
  const p = a.$('export-ergebnis');
  assert.equal(p.hidden, false);
  assert.ok(a.$('export-pfad').textContent === MIDI_ANTWORT.ordner);
  assert.equal(a.$('export-liste').querySelectorAll('li').length, 2);
  assert.match(a.$('export-liste').textContent, /02-bass\.mid/);
  assert.match(a.$('export-liste').textContent, /3 notes/);
  a.$('export-zeigen').dispatch('click'); await ruhe();
  assert.deepEqual(a.aufrufe.at(-1), { weg: '/proj/export_zeige', k: { ordner: MIDI_ANTWORT.ordner } });
  a.$('export-zu').dispatch('click');
  assert.equal(a.$('export-ergebnis').hidden, true);
  assert.deepEqual(a.meldungen, []);
});

test('binder: an error answer goes to the message line and opens no panel; EXPORT WAV with a running transport stops it first', async () => {
  const a = aufbau({ antworten: { 'POST /proj/export_midi': { code: 409, j: { text: 'no note' } } } });
  a.$('export-midi').dispatch('click'); await ruhe();
  assert.deepEqual(a.meldungen, [{ t: 'no note', f: true }]);
  assert.equal(a.$('export-ergebnis').hidden, true);
  // WAV while playing: stop, wait for the report, then export; the report arrives while the page waits
  const w = aufbau({ arr: { status: 2 }, antworten: {
    'POST /proj/transport': () => { setTimeout(() => { w.ctx.st.arr = { status: 0 }; }, 20); return { j: {} }; },
    'POST /proj/export_spuren': { j: { ordner: '/p/export/x', von_beat: 0, bis_beat: 16, dateien: [{ art: 'mix', name: 'M', datei: 'mix.wav', spitze_db: -6, stumm: false }] } } } });
  w.$('export-wav').dispatch('click');
  await new Promise((ok) => setTimeout(ok, 5));
  assert.ok(w.$('export-wav').disabled && w.$('export-midi').disabled, 'both buttons are disabled while it runs');
  await new Promise((ok) => setTimeout(ok, 200));
  assert.deepEqual(w.aufrufe.map((x) => x.weg), ['/proj/transport', '/proj/export_spuren']);
  assert.deepEqual(w.aufrufe[0].k, { aktion: 'stopp' });
  assert.equal(w.$('export-ergebnis').hidden, false);
  assert.ok(!w.$('export-wav').disabled);
});
