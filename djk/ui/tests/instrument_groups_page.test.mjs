// The real public/app.js against the DOM stand-in: the TYPE / ROLE buttons of the instrument pickers. What the markup tests in instrument_groups.test.mjs cannot
// show: a click stores the axis, redraws the pickers, keeps the loaded instrument selected and sends nothing to the server; the INSTRUMENTS area opens on the
// group of the loaded instrument on both axes; an instrument without `prinzip` is listed under Other and never dropped.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

import { GERAETE } from '../presets/devices.ts';

const HIER = new URL('..', import.meta.url);
const INHALT = JSON.parse(fs.readFileSync(new URL('presets/vokabular.json', HIER), 'utf8')).inhalt;
const GRAPHEN = [
  { name: 'fm-bass', art: 'instrument', regler_namen: {}, kategorie: 'bass', prinzip: 'fm', latenz: 0 },
  { name: 'ms20-bass', art: 'instrument', regler_namen: {}, kategorie: 'bass', prinzip: 'analog', latenz: 0 },
  { name: 'drums-909', art: 'instrument', regler_namen: {}, kategorie: 'drums', prinzip: 'drums', latenz: 0 },
  { name: 'eigen', art: 'instrument', regler_namen: {}, latenz: 0 },   // a user graph: no kategorie, no prinzip (Task 1 not required)
  { name: 'hall-a', art: 'effekt', regler_namen: {}, latenz: 0 },
];
const dokHoerer = {};
let holeGraphen, setzeGraphenGeladen, instrumenteAnsicht;

before(async () => {
  installiere({
    html: fs.readFileSync(new URL('public/index.html', HIER), 'utf8'),
    speicher: { 'djk-bereich': 'presets', 'djk-instrument': 'erz/5' },
    antworten: { 'GET /bestand': { j: [] }, 'GET /loops': { j: [] }, 'GET /presets': { j: [] }, 'GET /presets/geraete': { j: JSON.parse(JSON.stringify(GERAETE)) }, 'GET /presets/vokabular': { j: { version: 2, pruefsumme: 'x', inhalt: INHALT, anzahl: {} } }, 'GET /graphen': { j: { graphen: GRAPHEN, geladen: { 'erz/5': 'fm-bass', 'erz/6': 'drums-909' } } } },
  });
  document.addEventListener = (art, f) => { (dokHoerer[art] ??= []).push(f); };   // the stand-in's document drops listeners
  await import('../public/app.js');
  ({ holeGraphen, setzeGraphenGeladen } = await import('../public/graphs_view.js'));
  // a picker as the instrument window of the live dock builds it (live_dock/graph.js); zeigeGraphWahl fills every [data-graphplatz]
  const platz = document.createElement('div');
  platz.className = 'graphplatz'; platz.setAttribute('data-graphplatz', 'erz/6');
  attrappe.body.append(platz);
  ({ instrumenteAnsicht } = await import('../public/effects_bindung.js'));
  await holeGraphen();
  instrumenteAnsicht.baue();   // the INSTRUMENTS area builds when it opens; here it is built at once
  await new Promise((r) => setTimeout(r, 60));
});

const wahl = (k) => attrappe.body.querySelector(`select[data-graphwahl="${k}"]`);
const kat = (k) => attrappe.body.querySelector(`select[data-graphkat="${k}"]`);
const knopf = (k, achse) => attrappe.body.querySelector(`button[data-graphachse="${k}"][data-achse="${achse}"]`);
const klick = (b) => { for (const f of dokHoerer.click ?? []) f({ target: b, preventDefault() {} }); };
const entsch = (t) => t.replace(/&amp;/g, '&');
const gruppen = (sel) => sel.children.filter((c) => c.tagName === 'OPTGROUP').map((g) => entsch(g.attrs.label));
const optionen = (sel) => sel.querySelectorAll('option');
const gewaehlt = (sel) => optionen(sel).filter((o) => 'selected' in o.attrs).map((o) => o.attrs.value);
const nichtLesen = (von) => attrappe.anrufe.slice(von).filter((a) => a.methode !== 'GET');

test('page: with nothing stored the pickers group by type; an instrument without prinzip sits under Other and is not dropped', () => {
  assert.ok(wahl('erz/6'), 'a channel picker exists');
  assert.deepEqual(gruppen(wahl('erz/6')), ['Analog', 'FM', 'Drum Synthesis', 'Other']);
  assert.ok(optionen(wahl('erz/6')).some((o) => o.attrs.value === 'eigen'), 'the entry without prinzip is in the list');
  assert.deepEqual(gewaehlt(wahl('erz/6')), ['drums-909']);
  assert.equal(knopf('erz/5', 'prinzip').attrs['aria-pressed'], 'true', 'the buttons sit in the INSTRUMENTS area');
});

test('page: the INSTRUMENTS area opens on the group of the loaded instrument, on both axes', () => {
  assert.deepEqual(gewaehlt(kat('erz/5')), ['fm'], 'type axis: FM');
  assert.deepEqual(gewaehlt(wahl('erz/5')), ['fm-bass']);
  const von = attrappe.anrufe.length;
  klick(knopf('erz/5', 'rolle'));
  assert.deepEqual(gewaehlt(kat('erz/5')), ['bass'], 'role axis: Bass');
  assert.deepEqual(gewaehlt(wahl('erz/5')), ['fm-bass']);
  assert.deepEqual(nichtLesen(von), []);
  klick(knopf('erz/5', 'prinzip'));
  assert.deepEqual(gewaehlt(kat('erz/5')), ['fm']);
});

test('page: switching the axis stores it, redraws the channel pickers, keeps the loaded instrument selected and sends nothing', async () => {
  const von = attrappe.anrufe.length;
  klick(knopf('erz/5', 'rolle'));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(globalThis.localStorage.getItem('djk-instrument-achse'), 'rolle');
  assert.deepEqual(gruppen(wahl('erz/6')), ['Drums', 'Bass', 'Other']);
  assert.deepEqual(gewaehlt(wahl('erz/6')), ['drums-909']);
  assert.ok(optionen(wahl('erz/6')).some((o) => o.attrs.value === 'eigen'), 'the entry without kategorie is in the list on the role axis too');
  assert.equal(knopf('erz/5', 'rolle').attrs['aria-pressed'], 'true');
  assert.deepEqual(nichtLesen(von), [], 'no POST, no graph load');
  assert.deepEqual(attrappe.anrufe.slice(von).filter((a) => a.url === '/graph'), []);
  // the page keeps what is loaded: the server state still says the same
  setzeGraphenGeladen({ 'erz/5': 'fm-bass', 'erz/6': 'drums-909' });
  assert.deepEqual(gewaehlt(wahl('erz/6')), ['drums-909']);
  klick(knopf('erz/5', 'prinzip'));
  assert.deepEqual(gruppen(wahl('erz/6')), ['Analog', 'FM', 'Drum Synthesis', 'Other']);
  assert.deepEqual(gewaehlt(wahl('erz/6')), ['drums-909']);
  assert.deepEqual(nichtLesen(von), []);
});
