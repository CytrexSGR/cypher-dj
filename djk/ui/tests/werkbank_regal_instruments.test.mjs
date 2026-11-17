// Shelf: instrument bar of the SAMPLES tab (INSTRUMENT TO TRACK, build progress) and the tab INSTRUMENTS (list, TO TRACK, DELETE).
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeWerkbank } = await import('../public/werkbank/werkbank.js');
const { instrumentBalken, baufortschritt } = await import('../public/werkbank/regal_samples.js');
const { instrumentZeilen, loeschFrage } = await import('../public/werkbank/regal_instruments.js');

const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const warte = (ms) => new Promise((ok) => setTimeout(ok, ms));
const POSTS = (weg) => attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url === weg);
const GETS = (weg) => attrappe.anrufe.filter((a) => a.methode === 'GET' && a.url.split('?')[0] === weg);

const modul = (name, spuren = 1) => ({ name, rev: 3, werkbank: { schema: 1 }, tempo_bpm: 130, taktart: [4, 4], loop: { an: true, von_beat: 0, bis_beat: 16 },
  spuren: Array.from({ length: spuren }, (_, i) => ({ id: `s${i + 1}`, name: `T${i + 1}`, art: 'instrument', clips: [] })) });
const AKTUELL = { slug: 'm', projekt: modul('M') };
const INSTR = { noten: 88, lagen: 4, takes: 1, dateien: 352 };
const LISTING = (instrument) => ({ wurzel: 'Core', ordner: 'Grand Piano', ordner_liste: [], dateien: [{ name: 'a C3.wav', rel: 'Grand Piano/a C3.wav', bytes: 10 }], ...(instrument ? { instrument } : {}) });
const dateiAntworten = (listing) => ({ 'GET /sampler/dateien': () => ({ j: /wurzel=/.test(attrappe.anrufe.at(-1).url) ? listing : { wurzeln: [{ name: 'Core' }] } }) });
const KEIN_LAUF = { 'GET /sampler/instrument/lauf': { j: { laeuft: false } } };

let wurzel, w, fragen;
function aufbau({ tab = 'samples', aktuell = AKTUELL, antworten = {}, frage = () => true } = {}) {
  fragen = [];
  installiere({ speicher: { 'djk-wb-regal-tab': tab, 'djk-wb-regal-katalog': '{"modus":"ordner"}' }, antworten: { 'GET /proj/aktuell': { j: aktuell }, 'GET /proj/liste': { j: [] }, 'GET /proj/werkbank/vorlagen': { j: { vorlagen: [] } }, ...antworten } });
  wurzel = document.createElement('section');
  w = bindeWerkbank({ post, wurzel, frage: (t) => { fragen.push(t); return frage(t); } });
  w.ctx.laufMs = 5;
}
const regal = () => wurzel.querySelector('[data-w="regal"]');
const wd = (n) => regal().querySelectorAll(`[data-w="${n}"]`);
const balken = () => wd('samples-instrument')[0];
const knopf = () => wd('samples-instrument-spur')[0];
const meldung = () => wurzel.querySelector('[data-w="meldung"]');
const hinweis = () => regal().querySelector('.w-hinweis').textContent;
const klick = (e) => e.dispatch('click');

test('instrumentBalken: layers singular and plural, takes only above one, variants line only when named', () => {
  assert.deepEqual(instrumentBalken({ noten: 88, lagen: 4, takes: 1 }), { zeile: 'This folder is an instrument: 88 notes, 4 layers', varianten: null });
  assert.equal(instrumentBalken({ noten: 12, lagen: 1, takes: 1 }).zeile, 'This folder is an instrument: 12 notes, 1 layer');
  assert.equal(instrumentBalken({ noten: 12, lagen: 2, takes: 3 }).zeile, 'This folder is an instrument: 12 notes, 2 layers, 3 takes');
  assert.equal(instrumentBalken({ noten: 12, lagen: 2, takes: 3, varianten: [] }).varianten, null);
  assert.equal(instrumentBalken({ noten: 12, lagen: 2, varianten: ['Close', 'Mid'] }).varianten, 'Uses the largest set; also here: Close, Mid');
});

test('baufortschritt: text only while a build runs', () => {
  assert.equal(baufortschritt({ laeuft: true, name: 'Grand Piano', fertig: 37, von: 126 }), 'Building Grand Piano: 37 of 126');
  assert.equal(baufortschritt({ laeuft: false, name: '', fertig: 0, von: 0 }), null);
  assert.equal(baufortschritt(null), null);
});

test('instrumentZeilen: broken entries dropped, newest first, readable info and size', () => {
  const z = instrumentZeilen({ instrumente: [
    { id: 'a', name: 'Old', noten: 30, zonen: 30, bytes: 2048, erstellt: '2026-11-15T10:00:00Z' },
    { id: 'b', name: 'New', noten: 88, zonen: 352, bytes: 5 * 1024 * 1024, erstellt: '2026-11-16T10:00:00Z' },
    { name: 'no id' }, null] });
  assert.deepEqual(z.map((x) => x.id), ['b', 'a']);
  assert.equal(z[0].info, '88 notes · 352 zones');
  assert.equal(z[0].groesse, '5.0 MB');
  assert.equal(instrumentZeilen({ instrumente: [{ id: 'c', name: 'C', noten: 1, zonen: 1 }] })[0].info, '1 note · 1 zone');
  assert.deepEqual(instrumentZeilen(null), []);
  assert.equal(loeschFrage('X'), 'Delete the instrument "X"? This cannot be undone.');
});

test('the bar shows for an instrument folder only, with its texts and the button', async () => {
  aufbau({ antworten: { ...dateiAntworten(LISTING({ ...INSTR, varianten: ['Close'] })), ...KEIN_LAUF } });
  w.zeige(); await ruhe();
  assert.equal(balken().hidden, false);
  assert.ok(balken().textContent.includes('This folder is an instrument: 88 notes, 4 layers'));
  assert.ok(balken().textContent.includes('Uses the largest set; also here: Close'));
  assert.equal(knopf().textContent, 'INSTRUMENT TO TRACK');
  assert.equal(knopf().disabled, false);
  aufbau({ antworten: { ...dateiAntworten(LISTING(null)), ...KEIN_LAUF } });
  w.zeige(); await ruhe();
  assert.equal(balken().hidden, true);
});

test('the button is disabled without an open module, with the TO TRACK text', async () => {
  aufbau({ aktuell: { slug: null }, antworten: { ...dateiAntworten(LISTING(INSTR)), ...KEIN_LAUF } });
  w.zeige(); await ruhe();
  assert.equal(knopf().disabled, true);
  assert.equal(knopf().getAttribute('title'), 'Open a module first.');
});

test('build: posts wurzel, ordner and spur; polls the progress while the POST is pending; stops after it; takes the project over', async () => {
  let fertig = 0, freigeben, laeuft = false;
  const spaet = new Promise((ok) => { freigeben = ok; });
  const neu = { ...modul('M', 2), rev: 4 };
  aufbau({ antworten: { ...dateiAntworten(LISTING(INSTR)),
    'GET /sampler/instrument/lauf': () => ({ j: laeuft ? { laeuft: true, name: 'Grand Piano', fertig: fertig += 37, von: 126 } : { laeuft: false } }) } });
  const echt = globalThis.fetch;
  globalThis.fetch = async (u, o = {}) => {
    if (o.method === 'POST' && u === '/sampler/instrument') {
      attrappe.anrufe.push({ url: u, methode: 'POST', koerper: JSON.parse(o.body) });
      laeuft = true; await spaet; laeuft = false;
      return { status: 200, ok: true, json: async () => ({ instrument: { id: 'i1' }, text: 'Instrument Grand Piano on a new track', rev: 4, projekt: neu, spur_id: 's2' }) };
    }
    return echt(u, o);
  };
  try {
    w.zeige(); await ruhe();
    const vorher = GETS('/sampler/instrument/lauf').length;
    klick(knopf()); await warte(40);
    assert.deepEqual(POSTS('/sampler/instrument').map((p) => p.koerper), [{ wurzel: 'Core', ordner: '', spur: true }]);
    assert.equal(knopf().disabled, true, 'disabled while it builds');
    assert.ok(GETS('/sampler/instrument/lauf').length > vorher + 1, 'polled more than once');
    assert.match(balken().textContent, /Building Grand Piano: \d+ of 126/);
    klick(knopf()); await ruhe();
    assert.equal(POSTS('/sampler/instrument').length, 1, 'a second click sends nothing');
    freigeben(); await ruhe();
    const nachher = GETS('/sampler/instrument/lauf').length;
    await warte(40);
    assert.equal(GETS('/sampler/instrument/lauf').length, nachher, 'no polling after the POST returned');
    assert.equal(knopf().disabled, false);
    assert.ok(w.ctx.st.wahl === 's2');
    assert.equal(w.ctx.st.projekt.spuren.length, 2);
    assert.equal(meldung().textContent, 'Instrument Grand Piano on a new track');
    assert.doesNotMatch(balken().textContent, /Building/);
  } finally { globalThis.fetch = echt; }
});

test('a refused build shows the text in the hint and changes nothing else', async () => {
  aufbau({ antworten: { ...dateiAntworten(LISTING(INSTR)), ...KEIN_LAUF,
    'POST /sampler/instrument': { code: 400, j: { fehler: 'zu_gross', text: 'the pack would be 3.1 GiB, the limit is 2 GiB' } } } });
  w.zeige(); await ruhe();
  klick(knopf()); await ruhe();
  assert.equal(hinweis(), 'The pack would be 3.1 GiB, the limit is 2 GiB');
  assert.equal(w.ctx.st.projekt.spuren.length, 1);
  assert.equal(knopf().disabled, false);
});

test('a build that started before the reload shows its progress and holds the button until it ends', async () => {
  let n = 0;
  aufbau({ antworten: { ...dateiAntworten(LISTING(INSTR)),
    'GET /sampler/instrument/lauf': () => ({ j: ++n < 4 ? { laeuft: true, name: 'Grand Piano', fertig: n * 10, von: 126 } : { laeuft: false, name: '', fertig: 0, von: 0 } }),
    'GET /sampler/instrumente': { j: { instrumente: [] } } } });
  w.zeige(); await ruhe();
  assert.equal(knopf().disabled, true);
  assert.match(balken().textContent, /Building Grand Piano: \d+ of 126/);
  await warte(80);
  assert.equal(knopf().disabled, false);
  assert.doesNotMatch(balken().textContent, /Building/);
});

// ---- tab INSTRUMENTS ----
const LISTE = { instrumente: [
  { id: 'ins-1', name: 'Grand Piano', noten: 88, zonen: 352, bytes: 3 * 1024 * 1024, erstellt: '2026-11-16T10:00:00Z' },
  { id: 'ins-2', name: 'Marimba', noten: 40, zonen: 40, bytes: 2048, erstellt: '2026-11-15T10:00:00Z' }] };
async function insOffen(opt = {}) {
  aufbau({ tab: 'instrumente', ...opt, antworten: { 'GET /sampler/instrumente': { j: LISTE }, ...(opt.antworten ?? {}) } });
  w.zeige(); await ruhe();
}
const zeilen = () => wd('instrument-zeile');
const inZeile = (z, n) => z.querySelectorAll(`[data-w="${n}"]`)[0];

test('INSTRUMENTS: rows with name, notes and zones, size; the hint; the tab is remembered', async () => {
  await insOffen();
  assert.deepEqual(regal().querySelectorAll('.w-tab').map((x) => x.textContent), ['MODULES', 'LOOPS', 'CUTS', 'SAMPLES', 'INSTRUMENTS']);
  assert.equal(zeilen().length, 2);
  assert.ok(zeilen()[0].textContent.includes('Grand Piano'));
  assert.ok(zeilen()[0].textContent.includes('88 notes · 352 zones'));
  assert.ok(zeilen()[0].textContent.includes('3.0 MB'));
  assert.match(hinweis(), /^TO TRACK puts an instrument/);
  regal().querySelectorAll('.w-tab')[0].dispatch('click'); await ruhe();
  regal().querySelectorAll('.w-tab')[4].dispatch('click'); await ruhe();
  assert.equal(localStorage.getItem('djk-wb-regal-tab'), 'instrumente');
  assert.equal(GETS('/sampler/instrumente').length, 2, 'fetched again whenever the tab is shown');
});

test('INSTRUMENTS: the empty text', async () => {
  await insOffen({ antworten: { 'GET /sampler/instrumente': { j: { instrumente: [] } } } });
  assert.equal(zeilen().length, 0);
  assert.ok(regal().textContent.includes('No instruments yet. Open a folder of note samples in SAMPLES and use INSTRUMENT TO TRACK.'));
});

test('INSTRUMENTS: TO TRACK sends the id, takes the project over and selects the track; disabled without a module', async () => {
  await insOffen({ antworten: { 'POST /sampler/instrument/spur': { j: { rev: 4, projekt: { ...modul('M', 2), rev: 4 }, spur_id: 's2', text: 'Instrument Grand Piano on a new track' } } } });
  klick(inZeile(zeilen()[0], 'instrument-spur')); await ruhe();
  assert.deepEqual(POSTS('/sampler/instrument/spur').map((p) => p.koerper), [{ id: 'ins-1' }]);
  assert.ok(w.ctx.st.wahl === 's2');
  assert.equal(meldung().textContent, 'Instrument Grand Piano on a new track');
  await insOffen({ aktuell: { slug: null } });
  assert.equal(inZeile(zeilen()[0], 'instrument-spur').disabled, true);
  assert.equal(inZeile(zeilen()[0], 'instrument-spur').getAttribute('title'), 'Open a module first.');
});

test('INSTRUMENTS: DELETE asks first; no sends nothing; yes sends the id and reloads; a refusal shows the places', async () => {
  let ja = false;
  await insOffen({ frage: () => ja, antworten: { 'POST /sampler/instrument/loeschen': { j: { ok: true } } } });
  klick(inZeile(zeilen()[0], 'instrument-weg')); await ruhe();
  assert.equal(POSTS('/sampler/instrument/loeschen').length, 0);
  assert.equal(fragen.at(-1), 'Delete the instrument "Grand Piano"? This cannot be undone.');
  ja = true;
  klick(inZeile(zeilen()[0], 'instrument-weg')); await ruhe();
  assert.deepEqual(POSTS('/sampler/instrument/loeschen').map((p) => p.koerper), [{ id: 'ins-1' }]);
  assert.equal(GETS('/sampler/instrumente').length, 2, 'the list is fetched again');
  attrappe.antworten['POST /sampler/instrument/loeschen'] = { code: 409, j: { fehler: 'instrument_in_gebrauch', text: 'the instrument is in use by track "T1" of the open project "Alpha"' } };
  klick(inZeile(zeilen()[1], 'instrument-weg')); await ruhe();
  assert.equal(meldung().textContent, 'The instrument is in use by track "T1" of the open project "Alpha"');
  assert.ok(meldung().classList.contains('fehler'));
});

test('a build that finished while INSTRUMENTS is shown reloads the list', async () => {
  await insOffen();
  const n = GETS('/sampler/instrumente').length;
  w.ctx.beiInstrumentGebaut(); await ruhe();
  assert.equal(GETS('/sampler/instrumente').length, n + 1);
});

test('stage 2b: the bar text names loops and release samples only when the listing carries them', () => {
  assert.equal(instrumentBalken({ noten: 22, lagen: 2, takes: 1, schleifen: 18, release: 45 }).zeile, 'This folder is an instrument: 22 notes, 2 layers, looped, 45 release samples');
  assert.equal(instrumentBalken({ noten: 22, lagen: 2, takes: 1, schleifen: 3 }).zeile, 'This folder is an instrument: 22 notes, 2 layers, looped');
  assert.equal(instrumentBalken({ noten: 22, lagen: 2, takes: 1, release: 1 }).zeile, 'This folder is an instrument: 22 notes, 2 layers, 1 release sample');
  assert.equal(instrumentBalken({ noten: 22, lagen: 2, takes: 3, schleifen: 1, release: 2 }).zeile, 'This folder is an instrument: 22 notes, 2 layers, 3 takes, looped, 2 release samples');
  assert.equal(instrumentBalken({ noten: 22, lagen: 2, takes: 1, schleifen: 0, release: 0 }).zeile, 'This folder is an instrument: 22 notes, 2 layers');
});

test('stage 2b: the rows show looped and release after the zone count only when the row carries them', () => {
  const z = instrumentZeilen({ instrumente: [
    { id: 'a', name: 'A', noten: 22, zonen: 44, schleifen: 40, release: 45, bytes: 1, erstellt: '2026-11-16T10:00:00Z' },
    { id: 'b', name: 'B', noten: 3, zonen: 3, schleifen: 2, bytes: 1, erstellt: '2026-11-15T10:00:00Z' },
    { id: 'c', name: 'C', noten: 3, zonen: 3, release: 1, bytes: 1, erstellt: '2026-11-14T10:00:00Z' },
    { id: 'd', name: 'D', noten: 3, zonen: 3, schleifen: 0, release: 0, bytes: 1, erstellt: '2026-11-13T10:00:00Z' }] });
  assert.deepEqual(z.map((x) => x.info), ['22 notes · 44 zones · looped · 45 release', '3 notes · 3 zones · looped', '3 notes · 3 zones · 1 release', '3 notes · 3 zones']);
});

test('stage 2b: the bar in the shelf shows the looped and release text of the listing', async () => {
  aufbau({ antworten: { ...dateiAntworten(LISTING({ ...INSTR, schleifen: 120, release: 30 })), ...KEIN_LAUF } });
  w.zeige(); await ruhe();
  assert.ok(balken().textContent.includes('This folder is an instrument: 88 notes, 4 layers, looped, 30 release samples'));
});
