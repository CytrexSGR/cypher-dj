// Tracker task 21: the INSTRUMENTS column with the slot editor (public/tracker/instruments.js). Runs against the DOM stand-in and a stand-in server
// that answers the slot routes with canned data and records the bodies; the project commands are really applied (fuehreListeAus).
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';
import { neuesProjekt } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { kopie } from './support/project.mjs';

installiere();
const { bindeTracker } = await import('../public/tracker/tracker.js');
const I = await import('../public/tracker/instruments.js');
const { noteSchreiben } = await import('../public/tracker/eingabe.js');

const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 60; i++) await new Promise((ok) => setImmediate(ok)); };
const lauf = (p, b) => fuehreListeAus(kopie(p), b).projekt;
const basis = () => lauf(neuesProjekt('Slots'), [
  { befehl: 'spur_neu', art: 'instrument', name: 'Amiga', geraet: { art: 'intern', name: 'bk', graph: 'amiga', parameter: {} } },
  { befehl: 'spur_neu', art: 'instrument', name: 'Lead', geraet: { art: 'intern', name: 'bk', graph: 'synth-mono', parameter: {} } },
]);
const PLAETZE = [
  { nr: 1, name: 'Kick', leer: false, rate: 16574, frames: 4000, schleife: 0, s_von: 0, s_laenge: 0, pegel: 1, fein: 0 },
  { nr: 2, name: '', leer: true, rate: 16574, frames: 32, schleife: 0, s_von: 0, s_laenge: 0, pegel: 1, fein: 0 },
];

let wurzel, w, projekt, aufrufe, plaetzeAntwort;
const $t = (n) => wurzel.querySelector(`[data-t="${n}"]`);
const alle = (n) => wurzel.querySelectorAll(`[data-t="${n}"]`);
const klick = async (e) => { e.dispatch('click'); await ruhe(); };
const posts = (weg) => attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url === weg).map((a) => a.koerper);

async function aufbau() {
  projekt = { ...basis(), rev: 1 };
  plaetzeAntwort = PLAETZE;
  aufrufe = [];
  const antwort = () => ({ rev: projekt.rev, projekt, slug: 'slots' });
  const ok = (extra = {}) => ({ j: { graph: 'amiga', bank_neu: false, ...extra } });
  installiere({ speicher: {}, antworten: {
    'GET /proj/aktuell': () => ({ j: antwort() }),
    'GET /graphen': () => ({ j: { graphen: [{ name: 'amiga', rollen: { slot: 'plaetze' } }, { name: 'synth-mono' }] } }),
    'GET /sampler/plaetze': () => ({ j: { graph: 'amiga', plaetze: plaetzeAntwort } }),
    // one answer for both the roots and a folder listing (the stand-in sees no query)
    'GET /sampler/dateien': () => ({ j: { wurzeln: [{ name: 'drums' }], ordner: '', ordner_liste: [], dateien: [{ name: 'kick.wav', rel: 'kick.wav', bytes: 1000 }] } }),
    'POST /sampler/platz': () => ok({ text: 'Slot 2 holds kick.wav' }),
    'POST /sampler/platz/aendern': () => ok(),
    'POST /sampler/platz/leeren': () => ok(),
  } });
  wurzel = document.createElement('section');
  w = bindeTracker({ post, wurzel, frage: () => true });   // BINDER carries bindeInstrumente
  w.zeige(); await ruhe();
}
beforeEach(aufbau);

test('pure helpers: slot rows end with the next free slot, the load body, the field bodies', () => {
  const z = I.slotZeilen(PLAETZE);
  assert.deepEqual(z.map((x) => [x.nr, x.leer]), [[1, false], [2, true], [3, true]]);
  assert.deepEqual(I.ladeKoerper({ spur_id: 's1', platz: 2, wurzel: 'd', rel: 'a.wav', rate: '22050' }), { spur_id: 's1', platz: 2, wurzel: 'd', rel: 'a.wav', rate: 22050 });
  assert.deepEqual(I.ladeKoerper({ spur_id: 's1', platz: 2, wurzel: 'd', rel: 'a.wav', rate: 'roh' }), { spur_id: 's1', platz: 2, wurzel: 'd', rel: 'a.wav', roh: true });
  assert.deepEqual(I.felderKoerper('s1', 1, 'pegel', '50').koerper, { spur_id: 's1', platz: 1, pegel: 0.5 });
  assert.ok(I.felderKoerper('s1', 1, 'fein', '9').fehler);
  assert.ok(I.felderKoerper('s1', 1, 'name', '').fehler);
  assert.deepEqual(I.RATEN.map((r) => r.wert), ['8363', '16574', '22050', 'roh']);
  assert.equal(I.RATE_VORGABE, '16574');
});

test('the column lists the instrument tracks; only the amiga track gets a slot editor with its slots and rates', async () => {
  assert.equal(alle('instr-zeile').length, 2);
  assert.equal(alle('slots').length, 1);
  assert.equal(alle('slots')[0].getAttribute('data-spur'), projekt.spuren[0].id);
  const slots = alle('slot');
  assert.equal(slots.length, 3);
  assert.ok(slots[0].textContent.includes('Kick') && slots[0].textContent.includes('16574 Hz'));
  assert.ok(wurzel.querySelector('[data-t="instr-alt"]').hidden);
});

test('no slot is chosen at first: no editor, notes get no platz; a click chooses, a second click on the same slot lifts the choice', async () => {
  const spurId = projekt.spuren[0].id;
  assert.equal(w.ctx.platzVon(spurId), undefined);
  assert.equal(alle('slot-laden').length, 0, 'no editor without a chosen slot');
  assert.equal(alle('slot').filter((e) => e.klassen.has('an')).length, 0, 'no row is marked');
  const ort = { abschnitt_id: 'a1', spur_id: spurId, spalte: 0, zeile: 4, unterspalte: 'note' };
  const frei = noteSchreiben(w.ctx.st.projekt, ort, 60, { platz: w.ctx.platzVon(spurId) });
  assert.ok(!JSON.stringify(frei).includes('platz'), 'a new note carries no platz');
  await klick(alle('slot')[0]);
  assert.equal(w.ctx.platzVon(spurId), 1);
  assert.equal(alle('slot-laden').length, 1);
  await klick(alle('slot')[0]);
  assert.equal(w.ctx.platzVon(spurId), undefined, 'the second click lifts the choice');
  assert.equal(alle('slot-laden').length, 0);
});

test('the empty extra slot reads "+ new slot"; ctx.platzZahl is the real number of slots of the bank', async () => {
  const slots = alle('slot');
  assert.ok(slots[2].textContent.includes('+ new slot'));
  assert.ok(!slots[1].textContent.includes('+ new slot'), 'an emptied slot of the bank keeps its own text');
  assert.equal(w.ctx.platzZahl(projekt.spuren[0].id), 2);
  assert.equal(w.ctx.platzZahl(projekt.spuren[1].id), undefined);
  await klick(slots[2]);   // the new slot can be chosen and loaded
  assert.equal(w.ctx.platzVon(projekt.spuren[0].id), 3);
  assert.equal(alle('slot-laden').length, 1);
  assert.ok($t('slot-leeren').disabled);
});

test('a slot click chooses the slot: the next note on that track gets it (INS)', async () => {
  const spurId = projekt.spuren[0].id;
  await klick(alle('slot')[1]);
  assert.equal(w.ctx.platzVon(spurId), 2);
  assert.equal(w.ctx.platzVon(projekt.spuren[1].id), undefined, 'a track without a slot role takes none');
  assert.ok(alle('slot')[1].klassen.has('an'));
  const ort = { abschnitt_id: 'a1', spur_id: spurId, spalte: 0, zeile: 4, unterspalte: 'note' };
  const r = noteSchreiben(w.ctx.st.projekt, ort, 60, { platz: w.ctx.platzVon(spurId) });
  assert.ok(!r.fehler, JSON.stringify(r.fehler));
  assert.ok(JSON.stringify(r).includes('"platz":2'), 'the note command carries the chosen slot');
});

test('LOAD: picker, the default rate is 16574, a file click posts the slot with the rate; RAW posts roh', async () => {
  const spurId = projekt.spuren[0].id;
  await klick(alle('slot')[1]);
  await klick($t('slot-laden'));
  assert.equal($t('slot-rate').getAttribute('data-t'), 'slot-rate');
  await klick($t('slot-wurzel'));
  assert.equal(alle('slot-datei').length, 1);
  await klick($t('slot-datei'));
  assert.deepEqual(posts('/sampler/platz'), [{ spur_id: spurId, platz: 2, wurzel: 'drums', rel: 'kick.wav', rate: 16574 }]);
  assert.equal(alle('slot-picker').length, 0, 'the picker closes after the load');
  // RAW
  await klick($t('slot-laden')); await klick($t('slot-wurzel'));
  const sel = $t('slot-rate'); sel.value = 'roh'; sel.dispatch('change'); await ruhe();
  await klick($t('slot-datei'));
  assert.deepEqual(posts('/sampler/platz').at(-1), { spur_id: spurId, platz: 2, wurzel: 'drums', rel: 'kick.wav', roh: true });
});

test('the fields post /sampler/platz/aendern; CLEAR posts /sampler/platz/leeren; a bad value posts nothing', async () => {
  const spurId = projekt.spuren[0].id;
  await klick(alle('slot')[0]);
  const nam = $t('slot-name'); nam.value = 'Snare'; nam.dispatch('change'); await ruhe();
  assert.deepEqual(posts('/sampler/platz/aendern').at(-1), { spur_id: spurId, platz: 1, name: 'Snare' });
  const pg = $t('slot-pegel'); pg.value = '50'; pg.dispatch('change'); await ruhe();
  assert.deepEqual(posts('/sampler/platz/aendern').at(-1), { spur_id: spurId, platz: 1, pegel: 0.5 });
  await klick($t('slot-schleife'));
  assert.deepEqual(posts('/sampler/platz/aendern').at(-1), { spur_id: spurId, platz: 1, schleife: 1 });
  const n = posts('/sampler/platz/aendern').length;
  const fn = $t('slot-fein'); fn.value = '99'; fn.dispatch('change'); await ruhe();
  assert.equal(posts('/sampler/platz/aendern').length, n);
  await klick($t('slot-leeren'));
  assert.deepEqual(posts('/sampler/platz/leeren'), [{ spur_id: spurId, platz: 1 }]);
});

test('a first load that switches the track to a new bank: the project of the answer is taken over', async () => {
  const spurId = projekt.spuren[0].id;
  attrappe.antworten['POST /sampler/platz'] = () => {
    projekt = lauf(projekt, [{ befehl: 'spur_aendern', spur_id: spurId, geraet: { art: 'intern', name: 'bk', graph: 'amiga-abcdef', parameter: {} } }]);
    projekt = { ...projekt, rev: projekt.rev + 1 };
    return { j: { graph: 'amiga-abcdef', bank_neu: true, rev: projekt.rev, projekt } };
  };
  attrappe.antworten['GET /graphen'] = () => ({ j: { graphen: [{ name: 'amiga', rollen: { slot: 'plaetze' } }, { name: 'amiga-abcdef', rollen: { slot: 'plaetze' } }, { name: 'synth-mono' }] } });
  await klick(alle('slot')[1]); await klick($t('slot-laden')); await klick($t('slot-wurzel')); await klick($t('slot-datei'));
  assert.equal(w.ctx.st.projekt.spuren[0].geraet.graph, 'amiga-abcdef');
  assert.equal(w.ctx.platzVon(spurId), 2, 'the chosen slot survives the switch to the bank');
  assert.equal(alle('slots').length, 1);
});

test('the fields send on change only: typing (input) posts nothing', async () => {
  await klick(alle('slot')[0]);
  const nam = $t('slot-name'); nam.value = 'Sn'; nam.dispatch('input'); nam.dispatch('keydown', { key: 'a' }); await ruhe();
  assert.equal(posts('/sampler/platz/aendern').length, 0);
  nam.value = 'Snare'; nam.dispatch('change'); await ruhe();
  assert.equal(posts('/sampler/platz/aendern').length, 1);
});

test('the editor shows only for the cursor track (or the track clicked last) and only for the chosen slot; every track lists its slots', async () => {
  const [a, b] = [projekt.spuren[0].id, projekt.spuren[1].id];
  // a second amiga track
  projekt = { ...lauf(projekt, [{ befehl: 'spur_aendern', spur_id: b, geraet: { art: 'intern', name: 'bk', graph: 'amiga', parameter: {} } }]), rev: 2 };
  w.ctx.uebernimm('slots', projekt); await ruhe();
  assert.equal(alle('slots').length, 2);
  assert.equal(alle('slot').length, 6, 'both tracks list their slots');
  await klick(alle('slot')[0]);
  assert.equal(alle('slot-laden').length, 1);
  assert.equal(wurzel.querySelectorAll('[data-t="slot-laden"]')[0].closest('[data-spur]').getAttribute('data-spur'), a);
  await klick(alle('slot')[4]);   // a slot of track B: the editor moves there
  assert.equal(alle('slot-laden').length, 1);
  assert.equal($t('slot-laden').closest('[data-spur]').getAttribute('data-spur'), b);
  assert.equal(w.ctx.platzVon(a), 1, 'track A keeps its choice');
  w.ctx.setzeCursor({ spur: 0, spalte: 0, zeile: 1, unterspalte: 'note' });
  assert.equal($t('slot-laden').closest('[data-spur]').getAttribute('data-spur'), b, 'a cursor move inside the same track leaves the editor where the click put it');
  w.ctx.setzeCursor({ spur: 1, spalte: 0, zeile: 1, unterspalte: 'note' });
  w.ctx.setzeCursor({ spur: 0, spalte: 0, zeile: 1, unterspalte: 'note' });   // the cursor goes to track A: its editor returns
  assert.equal($t('slot-laden').closest('[data-spur]').getAttribute('data-spur'), a);
});

test('the picker is an overlay: Escape and a click beside it close it, the LOAD click and a click inside do not', async () => {
  await klick(alle('slot')[0]);
  await klick($t('slot-laden'));
  assert.ok(!$t('slot-ueber').hidden && alle('slot-picker').length === 1, 'open after LOAD');
  await klick($t('slot-wurzel'));
  assert.ok(alle('slot-picker').length === 1, 'a click inside (it redraws) keeps it open');
  wurzel.dispatch('keydown', { key: 'Escape' }); await ruhe();
  assert.equal(alle('slot-picker').length, 0, 'Escape closes');
  assert.ok($t('slot-ueber').hidden);
  await klick($t('slot-laden'));
  assert.equal(alle('slot-picker').length, 1);
  await klick($t('status'));   // beside it
  assert.equal(alle('slot-picker').length, 0, 'a click beside closes');
});

test('the stylesheet keeps the slot editor in the 220 px column: no wrapping rows, shrinkable fields, the column buttons centred', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../public/tracker/tracker.css', import.meta.url), 'utf8');
  assert.match(css, /\.t-slot \{[^}]*flex-wrap: nowrap;/);
  assert.match(css, /\.t-slot-name \{[^}]*min-width: 0;[^}]*text-overflow: ellipsis;/);
  assert.match(css, /\.t-slot-felder \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.t-slot-felder \.t-feld > input[^{]*\{[^}]*min-width: 0;/);
  assert.match(css, /\.t-spaltenknoepfe \{[^}]*justify-content: center;/);
});
