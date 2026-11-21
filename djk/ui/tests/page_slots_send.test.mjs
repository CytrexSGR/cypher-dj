// Container core U3: the places come from GET /lage and change with POST /plaetze only. The page keeps no layout of its own: no localStorage key,
// no /platz/kanal, no crossfader write. Runs the real page against the DOM stand-in; nothing leaves the process.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, attrappe, sendeStrom } from './helpers/pages_mock.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SEQ = { typ: 'seq', gruppe: 'g1' }, STRUDEL = { typ: 'strudel', gruppe: 'g2' };
const STAND = [SEQ, { typ: 'track' }, { typ: 'leer' }, { typ: 'loops', gruppe: 'g3' }];
let lagePlaetze = STAND, postAntwort = { code: 200, j: {} }, zustand, ansicht;
const zugriffe = [];
const kopf = (p) => attrappe.body.querySelectorAll('.platzkopf').find((x) => x.dataset.platzKopf === String(p));
const knopf = (p, typ) => kopf(p).querySelectorAll(`[data-platz-typ="${typ}"]`)[0];
const text = (p) => kopf(p).querySelectorAll('[data-platz-text]')[0].textContent;
const hinweis = (p) => kopf(p).querySelectorAll('[data-platz-hinweis]')[0].textContent;
const frisch = () => { attrappe.anrufe.length = 0; };
const posts = () => attrappe.anrufe.filter((a) => a.methode === 'POST');
const warte = () => new Promise((r) => setTimeout(r, 30));

before(async () => {
  installiere({
    html: fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'),
    antworten: {
      'GET /bestand': { j: [] }, 'GET /loops': { j: [] },
      'GET /lage': () => ({ j: { plaetze: lagePlaetze, container: [{ art: 'modul' }, { art: 'player' }, { art: 'leer' }, { art: 'modul' }] } }),
      'POST /plaetze': () => postAntwort,
    },
  });
  // a stand-in storage that fails the test when the old layout key is touched
  const echt = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => { zugriffe.push(['get', k]); return echt.getItem(k); }, setItem: (k, v) => { zugriffe.push(['set', k]); echt.setItem(k, v); }, removeItem: (k) => echt.removeItem(k) };
  const El = attrappe.body.constructor;
  if (!('cells' in El.prototype)) Object.defineProperty(El.prototype, 'cells', { get() { return this.children.filter((c) => typeof c !== 'string'); } });
  await import('../public/app.js');
  zustand = (await import('../public/page_state.js')).zustand;
  ansicht = await import('../public/slots_view.js');
  await warte();
});

test('the start reads /lage and the heads show the places of the live project', () => {
  assert.ok(attrappe.anrufe.some((a) => a.methode === 'GET' && a.url.startsWith('/lage')), 'GET /lage at start');
  assert.match(text(1), /^SEQ 1/);
  assert.match(text(4), /^LOOP 1/);
  assert.equal(knopf(1, 'seq').classList.contains('an'), true);
  assert.equal(knopf(1, 'track').classList.contains('an'), false);
});

test('a click on a type button posts /plaetze with {platz, typ} once and writes nothing else', async () => {
  zustand.regler = {};   // everything closed
  frisch(); postAntwort = { code: 200, j: { ok: true, plaetze: STAND } };
  knopf(3, 'strudel').click(); await warte();
  assert.deepEqual(posts().map((a) => [a.url, a.koerper]), [['/plaetze', { platz: 3, typ: 'strudel' }]]);
  assert.ok(!attrappe.anrufe.some((a) => /platz\/kanal|proj\/aendern|regler/.test(a.url)));
});

test('the head changes only after the next /lage', async () => {
  zustand.regler = {};
  assert.equal(text(3), 'EMPTY');
  const vorher = text(3);
  frisch(); postAntwort = { code: 200, j: { ok: true, plaetze: STAND } };   // the server answered, but /lage still shows the old place
  knopf(3, 'strudel').click(); await warte();
  assert.equal(text(3), vorher, 'unchanged while /lage says leer');
  lagePlaetze = [SEQ, { typ: 'track' }, STRUDEL, { typ: 'loops', gruppe: 'g3' }];
  knopf(3, 'strudel').click(); await warte();
  assert.match(text(3), /^STRUDEL/);
  assert.equal(knopf(3, 'strudel').classList.contains('an'), true);
});

test('an open strip stops the click before any call and says why', async () => {
  lagePlaetze = [SEQ, { typ: 'track' }, STRUDEL, { typ: 'loops', gruppe: 'g3' }]; await ansicht.holeLage();
  zustand.regler = { 'pad/1/trim': 0, 'pad/1/fader': -3 };   // place 3 (container C) is open
  ansicht.zeigePlaetze();
  frisch();
  knopf(3, 'track').click(); await warte();
  assert.equal(attrappe.anrufe.length, 0);
  assert.match(hinweis(3), /C is open/);
  assert.equal(knopf(3, 'track').disabled, true);
  zustand.regler = {};
});

test('the guard in wechsle stops a click on an enabled button when the strip opened after the last draw', async () => {
  lagePlaetze = [SEQ, { typ: 'track' }, STRUDEL, { typ: 'loops', gruppe: 'g3' }]; await ansicht.holeLage();
  zustand.regler = { 'pad/1/trim': 0, 'pad/1/fader': -60 };   // closed: the buttons are drawn enabled
  ansicht.zeigePlaetze();
  frisch();
  assert.equal(knopf(3, 'track').disabled, false, 'drawn enabled');
  zustand.regler = { 'pad/1/trim': 0, 'pad/1/fader': -3 };   // the strip opens between the draw and the click, no redraw
  knopf(3, 'track').click(); await warte();
  assert.equal(attrappe.anrufe.length, 0, 'no call');
  assert.match(hinweis(3), /C is open/);
  zustand.regler = {};
});

test('a 409 platz_offen from the server shows the server text and keeps the head', async () => {
  zustand.regler = {};
  const vorher = text(2);
  frisch(); postAntwort = { code: 409, j: { fehler: 'platz_offen', text: 'B is open (server view)' } };
  knopf(2, 'seq').click(); await warte();
  assert.equal(posts().length, 1);
  assert.match(attrappe.body.querySelectorAll('#meldung')[0].textContent, /B is open \(server view\)/);
  assert.equal(text(2), vorher);
  assert.equal(knopf(2, 'track').classList.contains('an'), true);
});

test('a place that holds a SEQ deck or a loop deck leaves without the still rule, like the server parks it', async () => {
  zustand.regler = { 'deck/1/trim': 0, 'deck/1/fader': 0 };   // the strip of place 1 is open, the place holds seq
  ansicht.zeigePlaetze();
  assert.equal(knopf(1, 'track').disabled, false);
  frisch(); postAntwort = { code: 200, j: { ok: true, plaetze: STAND, parken: true } };
  knopf(1, 'track').click(); await warte();
  assert.deepEqual(posts().map((a) => a.koerper), [{ platz: 1, typ: 'track' }]);
  zustand.regler = {};
});

test('no live project: all heads are disabled with the hint, a click posts nothing', async () => {
  lagePlaetze = undefined; await ansicht.holeLage();
  ansicht.zeigePlaetze();
  for (const p of [1, 2, 3, 4]) {
    for (const b of kopf(p).querySelectorAll('[data-platz-typ]')) assert.equal(b.disabled, true, `place ${p} ${b.dataset.platzTyp}`);
    assert.match(hinweis(p), /open the live set/);
  }
  frisch(); knopf(2, 'seq').click(); await warte();
  assert.equal(attrappe.anrufe.length, 0);
  lagePlaetze = STAND; await ansicht.holeLage();
});

test('every head offers the six types in the order of F5', () => {
  for (const p of [1, 2, 3, 4]) assert.deepEqual(kopf(p).querySelectorAll('[data-platz-typ]').map((b) => b.dataset.platzTyp), ['leer', 'track', 'strudel', 'seq', 'loops', 'stems']);
});

test('the page never reads or writes localStorage djk-plaetze', () => {
  assert.deepEqual(zugriffe.filter(([, k]) => k === 'djk-plaetze'), []);
});

test('a proj event refetches /lage once', async () => {
  frisch();
  sendeStrom('proj', { rev: 7 }); await warte();
  assert.equal(attrappe.anrufe.filter((a) => a.methode === 'GET' && a.url.split('?')[0] === '/lage').length, 1);
});
