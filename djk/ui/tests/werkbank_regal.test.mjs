// Workbench task 10: the shelf strip (region `regal`). Run against the DOM stand-in; the requests the cards send are asserted, not only the markup.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeWerkbank } = await import('../public/werkbank/werkbank.js');
const { regalEintraege } = await import('../public/werkbank/regal.js');

const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const POSTS = (weg) => attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url === weg);
const GETS = (weg) => attrappe.anrufe.filter((a) => a.methode === 'GET' && a.url === weg);

const VORLAGEN = { vorlagen: [{ id: 'techno-130-start', name: 'Techno 130 · Start', text: 'Drums 909 and Bass Banddrive, 4 bars, 130 BPM' }] };
const modul = (name) => ({
  name, rev: 3, werkbank: { schema: 1 }, tempo_bpm: 130, taktart: [4, 4], loop: { an: true, von_beat: 0, bis_beat: 16 },
  spuren: [{ id: 's1', name: 'Drums', art: 'instrument', clips: [] }],
});
const LISTE = [
  { slug: 'beta', name: 'Beta', werkbank: true, geaendert: '2026-11-14T09:30:00.000Z' },
  { slug: 'song', name: 'Plain Song', geaendert: '2026-11-01T00:00:00.000Z' },
  { slug: 'alpha', name: 'Alpha', werkbank: true, geaendert: '2026-11-15T12:00:00.000Z' },
];

let wurzel, w, fragen;
function aufbau({ liste = LISTE, aktuell = { slug: null }, frage = () => true, speicher = {}, antworten = {} } = {}) {
  installiere({ speicher, antworten: { 'GET /proj/aktuell': { j: aktuell }, 'GET /proj/liste': { j: liste }, 'GET /proj/werkbank/vorlagen': { j: VORLAGEN }, ...antworten } });
  wurzel = document.createElement('section');
  fragen = [];
  w = bindeWerkbank({ post, wurzel, frage: (t) => { fragen.push(t); return frage(t); } });
}
const regal = () => wurzel.querySelector('[data-w="regal"]');
const karten = () => regal().querySelectorAll('.w-karte');
const karte = (text) => { const k = karten().find((x) => x.textContent.includes(text)); assert.ok(k, `no card with ${text}`); return k; };
beforeEach(() => aufbau());

test('regalEintraege keeps modules only, sorted, marks the open one', () => {
  const e = regalEintraege([{ slug: 'b', name: 'Beta', werkbank: true }, { slug: 'p', name: 'Plain' }, { slug: 'a', name: 'Alpha', werkbank: true }], VORLAGEN, 'b');
  assert.deepEqual(e.module.map((m) => [m.name, m.offen]), [['Alpha', false], ['Beta', true]]);
});

test('regalEintraege carries the change date and keeps a broken entry with its text', () => {
  const e = regalEintraege([{ slug: 'k', name: 'k', fehler: 'json_kaputt', text: 'The file is broken' }, { slug: 'a', name: 'Alpha', werkbank: true, geaendert: '2026-11-15T12:00:00.000Z' }], VORLAGEN, null);
  assert.deepEqual(e.module.map((m) => m.slug), ['a', 'k']);
  assert.equal(e.module[0].geaendert, '2026-11-15T12:00:00.000Z');
  assert.equal(e.module[1].fehler, 'json_kaputt');
  assert.equal(e.module[1].text, 'The file is broken');
});

test('the shelf strip shows the label, the tabs, the hint, module cards with a date, template cards and the empty-module card', async () => {
  w.zeige(); await ruhe();
  const t = regal().textContent;
  assert.ok(t.includes('SHELF'));
  assert.ok(t.includes('MODULES'));
  assert.ok(t.includes('click = open the module · every change is saved at once · SAVE AS keeps a copy under a new name'));
  assert.deepEqual(regal().querySelectorAll('.w-tab').map((x) => x.textContent), ['MODULES', 'LOOPS', 'CUTS', 'SAMPLES', 'INSTRUMENTS']);
  assert.deepEqual(karten().map((k) => k.querySelector('b').textContent), ['Alpha', 'Beta', 'Techno 130 · Start', '+ empty module']);
  assert.ok(karte('Alpha').textContent.includes('15 Nov 2026'));
  assert.ok(karte('Techno 130 · Start').textContent.includes('template'));
  assert.ok(karte('Techno 130 · Start').textContent.includes('Drums 909 and Bass Banddrive'));
  assert.ok(!t.includes('Plain Song'));
});

test('a module card opens it; the open card sends nothing; a template card creates it', async () => {
  w.zeige(); await ruhe();
  attrappe.antworten['POST /proj/oeffnen'] = { j: { slug: 'alpha', projekt: modul('Alpha') } };
  const g0 = GETS('/proj/liste').length;
  karte('Alpha').dispatch('click'); await ruhe();
  assert.deepEqual(POSTS('/proj/oeffnen').map((a) => a.koerper), [{ slug: 'alpha' }]);
  assert.equal(w.ctx.st.slug, 'alpha');
  assert.ok(GETS('/proj/liste').length > g0, 'the shelf is fetched again after opening');
  // the open card is marked, disabled, and a click sends nothing
  const offen = karte('Alpha');
  assert.ok(offen.classList.contains('offen'));
  assert.ok(offen.textContent.includes('open'));
  assert.equal(offen.disabled, true);
  offen.dispatch('click'); await ruhe();
  assert.equal(POSTS('/proj/oeffnen').length, 1);
  assert.equal(POSTS('/proj/neu').length, 0);
  // a template card creates the module with its template
  attrappe.antworten['POST /proj/neu'] = { j: { slug: 'techno-130-start', projekt: modul('Techno 130 · Start') } };
  const g1 = GETS('/proj/liste').length;
  karte('Techno 130 · Start').dispatch('click'); await ruhe();
  assert.deepEqual(POSTS('/proj/neu').map((a) => a.koerper), [{ name: 'Techno 130 · Start', werkbank: true, vorlage: 'techno-130-start' }]);
  assert.equal(w.ctx.st.slug, 'techno-130-start');
  assert.ok(GETS('/proj/liste').length > g1, 'the shelf is fetched again after creating');
});

test('a module card refused by the live-container question sends nothing more', async () => {
  aufbau({ frage: () => false });
  w.zeige(); await ruhe();
  attrappe.antworten['POST /proj/oeffnen'] = { code: 409, j: { fehler: 'live_container_offen', text: 'A live container is open. Close it?' } };
  karte('Beta').dispatch('click'); await ruhe();
  assert.ok(POSTS('/proj/oeffnen').length <= 1);
  assert.equal(w.ctx.st.slug, null);
});

test('the empty-module card asks for a name; Enter creates, Escape sends nothing', async () => {
  w.zeige(); await ruhe();
  const feld = regal().querySelector('[data-w="regal-name"]');
  assert.equal(feld.hidden, true);
  karte('+ empty module').dispatch('click');
  assert.equal(feld.hidden, false);
  feld.value = 'x'; feld.dispatch('keydown', { key: 'Escape' }); await ruhe();
  assert.equal(feld.hidden, true);
  assert.equal(POSTS('/proj/neu').length, 0);
  karte('+ empty module').dispatch('click');
  attrappe.antworten['POST /proj/neu'] = { j: { slug: 'mine', projekt: modul('Mine') } };
  feld.value = '  Mine '; feld.dispatch('keydown', { key: 'Enter' }); await ruhe();
  assert.deepEqual(POSTS('/proj/neu').map((a) => a.koerper), [{ name: 'Mine', werkbank: true }]);
  assert.equal(w.ctx.st.slug, 'mine');
});

test('a broken list entry (fehler json_kaputt) is shown disabled with its text, not opened', async () => {
  aufbau({ liste: [{ slug: 'kaputt', name: 'kaputt', fehler: 'json_kaputt', text: 'The project file is broken', geaendert: '2026-11-10T00:00:00.000Z' }, ...LISTE] });
  w.zeige(); await ruhe();
  const k = karte('kaputt');
  assert.equal(k.disabled, true);
  assert.ok(k.classList.contains('kaputt'));
  assert.equal(k.getAttribute('title'), 'The project file is broken');
  k.dispatch('click'); await ruhe();
  assert.equal(POSTS('/proj/oeffnen').length, 0);
  // the empty state offers it disabled as well
  const o = wurzel.querySelector('[data-w="leer-oeffnen"]').querySelectorAll('option').find((x) => x.value === 'kaputt');
  assert.ok(o === undefined || o.disabled === true);
});

test('after a restart of the server the shelf lists the modules when none is open', async () => {
  aufbau({ aktuell: { slug: null } });
  w.zeige(); await ruhe();
  assert.equal(w.ctx.st.projekt, null);
  assert.ok(karte('Alpha'));
  assert.ok(!karte('Alpha').classList.contains('offen'));
});

// Sampler A1 task 5: the tab LOOPS and SLICE TO TRACK
const QUELLEN = {
  loops: [{ name: 'l4', beats: 4 }, { name: 'l16', beats: 16 }],
  module: [{ id: 'mod-a', titel: 'Night Drive', beats: 32, bpm: 127, audio: [{ stem: null, name: 'Loop' }, { stem: 'drums', name: 'Drums original' }] }],
};
const AKTUELL = { slug: 'alpha', projekt: modul('Alpha') };
const mitSpur = (id) => ({ ...modul('Alpha'), rev: 4, spuren: [...modul('Alpha').spuren, { id, name: 'Slices', art: 'instrument', clips: [] }] });
const tab = (text) => { const t = regal().querySelectorAll('.w-tab').find((x) => x.textContent === text); assert.ok(t, `no tab ${text}`); return t; };
const klick = (e) => e.dispatch('click');
const knopfIn = (k, text) => { const b = k.querySelectorAll('button').find((x) => x.textContent === text); assert.ok(b, `no button ${text}`); return b; };
const letzter = (schluessel) => { const [m, u] = schluessel.split(' '); const a = attrappe.anrufe.filter((x) => x.methode === m && x.url === u); assert.ok(a.length > 0, `no ${schluessel}`); return a.at(-1); };
const scheibenWahl = () => regal().querySelector('[data-w="regal-scheiben"]');
const loopsOffen = async (opt = {}) => {
  aufbau({ aktuell: AKTUELL, antworten: { 'GET /sampler/quellen': { j: QUELLEN }, ...opt.antworten }, speicher: opt.speicher });
  w.zeige(); await ruhe();
  klick(tab('LOOPS')); await ruhe();
};

test('LOOPS lists loops and module audio; SLICE TO TRACK sends the source and selects the new track', async () => {
  attrappe.anrufe.length = 0;
  await loopsOffen({ antworten: { 'POST /sampler/spur': { j: { rev: 4, projekt: mitSpur('s9'), spur_id: 's9', schnitt_id: 'l4-ab12', fit: 0.5 } } } });
  assert.deepEqual(karten().map((k) => k.querySelector('b').textContent), ['l4', 'l16', 'Night Drive · Loop', 'Night Drive · Drums']);
  assert.ok(karte('l4').textContent.includes('4 beats'));
  assert.ok(karte('Night Drive · Drums').textContent.includes('32 beats'));
  assert.ok(GETS('/sampler/quellen').length >= 1);
  klick(knopfIn(karte('l4'), 'SLICE TO TRACK')); await ruhe();
  assert.deepEqual(letzter('POST /sampler/spur').koerper, { quelle: { art: 'loop', ref: 'l4' } });
  assert.ok(w.ctx.st.wahl === 's9');
  assert.ok(w.ctx.st.projekt.spuren.some((s) => s.id === 's9'), 'the answer project is taken over');
  assert.equal(wurzel.querySelector('[data-w="meldung"]').textContent, '');
  // module audio: the Loop track has no stem, a stem card names it
  klick(knopfIn(karte('Night Drive · Loop'), 'SLICE TO TRACK')); await ruhe();
  assert.deepEqual(letzter('POST /sampler/spur').koerper, { quelle: { art: 'modul', ref: 'mod-a' } });
  klick(knopfIn(karte('Night Drive · Drums'), 'SLICE TO TRACK')); await ruhe();
  assert.deepEqual(letzter('POST /sampler/spur').koerper, { quelle: { art: 'modul', ref: 'mod-a', stem: 'drums' } });
});

test('the list is fetched when the tab opens and after every SLICE TO TRACK; the tab and the choice are remembered', async () => {
  await loopsOffen({ antworten: { 'POST /sampler/spur': { j: { rev: 4, projekt: mitSpur('s9'), spur_id: 's9', schnitt_id: 'l4-ab12', fit: 0.5 } } } });
  assert.equal(GETS('/sampler/quellen').length, 1);
  assert.equal(localStorage.getItem('djk-wb-regal-tab'), 'loops');
  klick(knopfIn(karte('l4'), 'SLICE TO TRACK')); await ruhe();
  assert.equal(GETS('/sampler/quellen').length, 2);
  klick(tab('MODULES')); await ruhe();
  assert.equal(localStorage.getItem('djk-wb-regal-tab'), 'module');
  assert.ok(karte('Alpha'));
  assert.equal(scheibenWahl().hidden, true);
  // a new page starts on the remembered tab
  aufbau({ aktuell: AKTUELL, antworten: { 'GET /sampler/quellen': { j: QUELLEN } }, speicher: { 'djk-wb-regal-tab': 'loops', 'djk-wb-scheiben': '32' } });
  w.zeige(); await ruhe();
  assert.ok(karte('l4'));
  assert.equal(scheibenWahl().value, '32');
  assert.equal(scheibenWahl().hidden, false);
});

test('choosing hits sends the method and no slice count; the remembered value may be hits', async () => {
  attrappe.anrufe.length = 0;
  await loopsOffen({ speicher: { 'djk-wb-regal-tab': 'loops', 'djk-wb-scheiben': 'hits' }, antworten: { 'POST /sampler/spur': { j: { rev: 4, projekt: mitSpur('s9'), spur_id: 's9', schnitt_id: 'x', fit: 1 } } } });
  assert.equal(scheibenWahl().value, 'hits');
  klick(knopfIn(karte('l4'), 'SLICE TO TRACK'));
  await ruhe();
  assert.deepEqual(POSTS('/sampler/spur').map((p) => p.koerper), [{ quelle: { art: 'loop', ref: 'l4' }, methode: 'anschlag' }]);
  scheibenWahl().value = '8'; scheibenWahl().dispatch('change');
  assert.equal(localStorage.getItem('djk-wb-scheiben'), '8');
  klick(knopfIn(karte('l4'), 'SLICE TO TRACK'));
  await ruhe();
  assert.deepEqual(POSTS('/sampler/spur').at(-1).koerper, { quelle: { art: 'loop', ref: 'l4' }, scheiben: 8 });
});

test('the SLICES choice is sent; a second click while waiting sends nothing; no module: disabled', async () => {
  let frei;
  const warte = new Promise((ok) => { frei = ok; });
  await loopsOffen({ antworten: { 'POST /sampler/spur': () => { throw new Error('replaced below'); } } });
  assert.deepEqual([...scheibenWahl().querySelectorAll('option')].map((o) => o.textContent), ['auto', 'hits', '4', '8', '16', '32', '64']);
  assert.equal(scheibenWahl().value, 'auto');
  scheibenWahl().value = '16'; scheibenWahl().dispatch('change');
  assert.equal(localStorage.getItem('djk-wb-scheiben'), '16');
  // a slow answer: the second click arrives while the first request runs
  const echt = globalThis.fetch;
  globalThis.fetch = async (u, o) => { if (String(u) === '/sampler/spur') { await warte; attrappe.antworten['POST /sampler/spur'] = { j: { rev: 4, projekt: mitSpur('s9'), spur_id: 's9', schnitt_id: 'x', fit: 1 } }; } return echt(u, o); };
  try {
    const b = knopfIn(karte('l4'), 'SLICE TO TRACK');
    klick(b); klick(b); klick(knopfIn(karte('l16'), 'SLICE TO TRACK'));
    await ruhe();
    frei(); await ruhe();
  } finally { globalThis.fetch = echt; }
  assert.equal(POSTS('/sampler/spur').length, 1);
  assert.deepEqual(POSTS('/sampler/spur')[0].koerper, { quelle: { art: 'loop', ref: 'l4' }, scheiben: 16 });
  // no module open: disabled with the reason, and a click sends nothing
  aufbau({ aktuell: { slug: null }, antworten: { 'GET /sampler/quellen': { j: QUELLEN } }, speicher: { 'djk-wb-regal-tab': 'loops' } });
  w.zeige(); await ruhe();
  const k = knopfIn(karte('l4'), 'SLICE TO TRACK');
  assert.equal(k.disabled, true);
  assert.equal(k.getAttribute('title'), 'Open a module first.');
  klick(k); await ruhe();
  assert.equal(POSTS('/sampler/spur').length, 0);
});

test('a refusal and fit null show their texts; a refused POST leaves the selection unchanged', async () => {
  await loopsOffen({ antworten: { 'POST /sampler/spur': { code: 409, j: { fehler: 'werkbank_voll', text: 'a module holds at most 8 instrument tracks' } } } });
  const meldung = () => wurzel.querySelector('[data-w="meldung"]');
  const vorher = w.ctx.st.wahl;
  const rev = w.ctx.st.projekt.rev;
  klick(knopfIn(karte('l4'), 'SLICE TO TRACK')); await ruhe();
  assert.equal(meldung().textContent, w.ctx.antwortText({ status: 409, j: { fehler: 'werkbank_voll' } }));
  assert.ok(meldung().classList.contains('fehler'));
  assert.ok(w.ctx.st.wahl === vorher);
  assert.equal(w.ctx.st.projekt.rev, rev);
  // a reason the page has no text for shows the text of the answer
  attrappe.antworten['POST /sampler/spur'] = { code: 400, j: { fehler: 'kein_raster', text: 'the loop has no usable beat grid' } };
  klick(knopfIn(karte('l4'), 'SLICE TO TRACK')); await ruhe();
  assert.equal(meldung().textContent, 'The loop has no usable beat grid');
  // fit null: the track is there and selected, the text says SPEED stays at 1
  attrappe.antworten['POST /sampler/spur'] = { j: { rev: 5, projekt: mitSpur('s9'), spur_id: 's9', schnitt_id: 'l4-ab12', fit: null } };
  klick(knopfIn(karte('l4'), 'SLICE TO TRACK')); await ruhe();
  assert.equal(meldung().textContent, "Tempo is out of FIT's range: SPEED stays at 1.");
  assert.ok(w.ctx.st.wahl === 's9');
  // the shelf is usable again after a refusal (the busy flag is released)
  attrappe.antworten['POST /sampler/spur'] = { code: 409, j: { fehler: 'werkbank_voll' } };
  const n = POSTS('/sampler/spur').length;
  klick(knopfIn(karte('l4'), 'SLICE TO TRACK')); await ruhe();
  assert.equal(POSTS('/sampler/spur').length, n + 1);
});

// 2026-11-16 follow-ups: silent loops, the module length text, the tab CUTS
test('a silent loop is marked and its SLICE TO TRACK is disabled', async () => {
  await loopsOffen({ antworten: { 'GET /sampler/quellen': { j: { loops: [{ name: 'l4', beats: 4 }, { name: 'leer', beats: 16, stumm: true }], module: [] } } } });
  assert.ok(karte('leer').textContent.includes('silent'));
  const k = knopfIn(karte('leer'), 'SLICE TO TRACK');
  assert.equal(k.disabled, true);
  assert.equal(k.getAttribute('title'), 'This loop is silent: there is nothing to cut');
  assert.equal(knopfIn(karte('l4'), 'SLICE TO TRACK').disabled, false);
  assert.ok(!karte('l4').textContent.includes('silent'));
});

test('a raised module length is told', async () => {
  await loopsOffen({ antworten: { 'POST /sampler/spur': { j: { rev: 4, projekt: mitSpur('s9'), spur_id: 's9', schnitt_id: 'l16-ab12', fit: 0.5, modul_takte: 8 } } } });
  klick(knopfIn(karte('l16'), 'SLICE TO TRACK')); await ruhe();
  assert.equal(wurzel.querySelector('[data-w="meldung"]').textContent, 'The module is now 8 bars long, so the whole loop plays.');
});

const SCHNITTE = { schnitte: [{ id: 'l4-ab12', name: 'l4', quelle: { art: 'loop', ref: 'l4' }, bpm: 128, beats: 4, scheiben: 16, geraet: 'smp-l4-ab12' },
  { id: 'brk-00ff', name: 'Break', quelle: { art: 'loop', ref: 'brk' }, bpm: 128, beats: 8, scheiben: 33, geraet: 'smp-brk-00ff' }] };
const cutsOffen = async (opt = {}) => {
  aufbau({ aktuell: AKTUELL, antworten: { 'GET /sampler/liste': { j: SCHNITTE }, ...opt.antworten }, frage: opt.frage });
  w.zeige(); await ruhe();
  klick(tab('CUTS')); await ruhe();
};

test('CUTS lists the cuts; TO TRACK sends the id and selects the track', async () => {
  await cutsOffen({ antworten: { 'POST /sampler/spur': { j: { rev: 4, projekt: mitSpur('s9'), spur_id: 's9', schnitt_id: 'brk-00ff', fit: 0.5 } } } });
  assert.deepEqual(regal().querySelectorAll('.w-tab').map((x) => x.textContent), ['MODULES', 'LOOPS', 'CUTS', 'SAMPLES', 'INSTRUMENTS']);
  assert.deepEqual(karten().map((k) => k.querySelector('b').textContent), ['l4', 'Break']);
  assert.ok(karte('Break').textContent.includes('33 slices · 8 beats'));
  assert.equal(scheibenWahl().hidden, true);
  assert.equal(localStorage.getItem('djk-wb-regal-tab'), 'cuts');
  klick(knopfIn(karte('Break'), 'TO TRACK')); await ruhe();
  assert.deepEqual(letzter('POST /sampler/spur').koerper, { id: 'brk-00ff' });
  assert.ok(w.ctx.st.wahl === 's9');
  assert.equal(GETS('/sampler/liste').length, 2, 'the list is fetched again');
});

test('DELETE asks first; yes sends the id and reloads; a refusal shows where the cut is in use', async () => {
  let ja = false;
  await cutsOffen({ frage: () => ja, antworten: { 'POST /sampler/loeschen': { j: { ok: true } } } });
  klick(knopfIn(karte('Break'), 'DELETE')); await ruhe();
  assert.equal(POSTS('/sampler/loeschen').length, 0, 'no: nothing is sent');
  assert.ok(fragen.at(-1).includes('Delete the cut "Break"'));
  ja = true;
  klick(knopfIn(karte('Break'), 'DELETE')); await ruhe();
  assert.deepEqual(letzter('POST /sampler/loeschen').koerper, { id: 'brk-00ff' });
  assert.equal(GETS('/sampler/liste').length, 2);
  attrappe.antworten['POST /sampler/loeschen'] = { code: 409, j: { fehler: 'schnitt_in_gebrauch', text: 'the cut is in use by track "l4" of the open project "Alpha"; remove it there first' } };
  klick(knopfIn(karte('l4'), 'DELETE')); await ruhe();
  const m = wurzel.querySelector('[data-w="meldung"]');
  assert.equal(m.textContent, 'The cut is in use by track "l4" of the open project "Alpha"; remove it there first');
  assert.ok(m.classList.contains('fehler'));
});

test('module cards: SAVE AS asks a name and posts /proj/kopie; DELETE asks and posts /proj/loeschen; the open module has no DELETE', async () => {
  aufbau({ aktuell: { slug: 'alpha', projekt: modul('Alpha') } });
  w.zeige(); await ruhe();
  const knopf = (name, w) => [...regal().querySelectorAll('.w-karte-huelle')].find((h) => h.textContent.includes(name))?.querySelector(`[data-w="${w}"]`) ?? undefined;
  assert.equal(knopf('Alpha', 'modul-weg'), undefined, 'the open module cannot be deleted');
  assert.ok(knopf('Alpha', 'modul-kopie'), 'the open module can be saved as a copy');
  attrappe.antworten['POST /proj/kopie'] = { j: { slug: 'alpha-v2', name: 'Alpha v2' } };
  knopf('Alpha', 'modul-kopie').dispatch('click'); await ruhe();
  const feld = regal().querySelector('[data-w="modul-kopie-name"]');
  assert.equal(feld.value, 'Alpha copy');
  feld.value = ' Alpha v2 '; feld.dispatch('keydown', { key: 'Enter' }); await ruhe();
  assert.deepEqual(POSTS('/proj/kopie').map((a) => a.koerper), [{ slug: 'alpha', name: 'Alpha v2' }]);
  attrappe.antworten['POST /proj/loeschen'] = { j: { slug: 'beta' } };
  knopf('Beta', 'modul-weg').dispatch('click'); await ruhe();
  assert.ok(fragen.at(-1).includes('Delete the module "Beta"'));
  assert.deepEqual(POSTS('/proj/loeschen').map((a) => a.koerper), [{ slug: 'beta' }]);
});

test('module cards: DELETE sends nothing when the question is answered no', async () => {
  aufbau({ frage: () => false });
  w.zeige(); await ruhe();
  [...regal().querySelectorAll('[data-w="modul-weg"]')][0].dispatch('click'); await ruhe();
  assert.equal(POSTS('/proj/loeschen').length, 0);
});
