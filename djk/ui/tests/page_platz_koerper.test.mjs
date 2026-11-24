// Container core U4: one body per place type. The page runs against the DOM stand-in; every place shows exactly the body of its type and hides the
// other bodies, the strip of place N keeps showing the container strip whatever the type. Nothing leaves the process.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const T = (typ, gruppe) => (gruppe ? { typ, gruppe } : { typ });
const LEER = T('leer'), TRACK = T('track');
let lagePlaetze = null, ansicht, live;
const warte = () => new Promise((r) => setTimeout(r, 30));
const zeige = async (plaetze, projekt = null) => { lagePlaetze = plaetze; live.projekt = projekt; await ansicht.holeLage(); await warte(); };
const koerper = () => attrappe.body.querySelectorAll('[data-platz-body]');
/** place number -> kind of the one visible body at that place */
const sichtbar = () => Object.fromEntries(koerper().filter((k) => !k.hidden && k.dataset.platz).map((k) => [k.dataset.platz, k.dataset.platzBody]));
const knotenAm = (p) => koerper().find((k) => !k.hidden && k.dataset.platz === String(p));
const zugName = (pfad) => attrappe.body.querySelectorAll(`.zug[data-kanalzug="${pfad}"] .zugname`)[0].textContent;
const kopfText = (p) => attrappe.body.querySelectorAll('.platzkopf').find((x) => x.dataset.platzKopf === String(p)).querySelectorAll('[data-platz-text]')[0].textContent;

const projekt = (extra = {}) => ({
  live: true, rev: 3, plaetze: [], spuren: [
    { id: 's1', nr: 1, name: 'Kick', fader_db: -3, pan: 0, mute: false, solo: false, clips: [], ausgang: { art: 'gruppe', id: 'g4' } },
    { id: 's2', nr: 2, name: 'Bass', fader_db: 0, pan: 0, mute: true, solo: false, clips: [], ausgang: { art: 'gruppe', id: 'g4' } },
    { id: 's3', nr: 3, name: 'Other', fader_db: 0, pan: 0, mute: false, solo: false, clips: [], ausgang: { art: 'gruppe', id: 'g9' } },
  ],
  gruppen: [{ id: 'g1', name: 'SEQ', seq: { schema: 2 } }, { id: 'g2', name: 'STRUDEL', strudel: {} }, { id: 'g3', name: 'LOOPS', loopdeck: { platz: 2 } }, { id: 'g4', name: 'Stems' }],
  ...extra,
});

before(async () => {
  installiere({
    html,
    antworten: {
      'GET /bestand': { j: [] }, 'GET /loops': { j: [] },
      'GET /lage': () => ({ j: { plaetze: lagePlaetze, container: [{ art: 'leer' }, { art: 'leer' }, { art: 'leer' }, { art: 'leer' }] } }),
    },
  });
  const El = attrappe.body.constructor;
  if (!('cells' in El.prototype)) Object.defineProperty(El.prototype, 'cells', { get() { return this.children.filter((c) => typeof c !== 'string'); } });
  await import('../public/app.js');
  ansicht = await import('../public/slots_view.js');
  live = (await import('../public/live_view.js')).live;
  await warte();
});

test('each type shows exactly one body in its place and hides the other bodies', async () => {
  await zeige([T('seq', 'g1'), TRACK, T('strudel', 'g2'), T('loops', 'g3')], projekt());
  assert.deepEqual(sichtbar(), { 1: 'seq', 2: 'track', 3: 'strudel', 4: 'loops' });
  assert.equal(koerper().filter((k) => !k.hidden).length, 4, 'nothing else is visible');
  assert.ok(koerper().filter((k) => k.hidden).every((k) => !k.dataset.platz), 'a hidden body holds no place');
  const kinds = new Set(koerper().map((k) => k.dataset.platzBody));
  assert.deepEqual([...kinds].sort(), ['loops', 'seq', 'stems', 'strudel', 'track'], 'five body kinds exist, leer has none');
  await zeige([T('stems', 'g4'), LEER, TRACK, T('stems', 'g4')], projekt());
  assert.deepEqual(sichtbar(), { 1: 'stems', 3: 'track', 4: 'stems' });
});

test('leer shows the hint and no body, the strip stays', async () => {
  await zeige([LEER, TRACK, T('strudel', 'g2'), LEER], projekt());
  assert.deepEqual(sichtbar(), { 2: 'track', 3: 'strudel' });
  assert.equal(kopfText(1), 'EMPTY');
  assert.equal(zugName('deck/1'), 'A empty');
  assert.equal(zugName('pad/2'), 'D empty');
  assert.ok(attrappe.body.querySelectorAll('.zug[data-kanalzug="deck/1"]')[0], 'the strip of an empty place is still there');
});

test('an empty track place says what to do inside its waveform area; the line shows only where the deck head is dropped (compact container)', async () => {
  const css = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');
  await zeige([TRACK, TRACK, LEER, LEER], projekt());
  const deck = knotenAm(1);
  assert.ok(deck.classList.contains('ohne-track'), 'no track loaded');
  const zeile = deck.querySelectorAll('[data-lauf-leer]')[0];
  assert.ok(zeile, 'the line exists in the deck');
  assert.equal(zeile.textContent, 'No track loaded: pick one in the library and press LOAD');
  assert.match(css, /\.deck > \.lauf-leer \{ display: none;/, 'hidden while the full head is shown');
  assert.match(css, /@container deckplatz \(max-height: 290px\) \{[\s\S]*?\n  \.deck\.ohne-track > \.lauf-leer \{ display: flex; \}/, 'shown in the compact container state');
});

test('track at place 3 shows deck 3, track at place 4 shows deck 4 (place N plays deck N)', async () => {
  await zeige([LEER, LEER, TRACK, TRACK], projekt());
  assert.deepEqual(sichtbar(), { 3: 'track', 4: 'track' });
  assert.equal(knotenAm(3).dataset.deck, '3');
  assert.equal(knotenAm(4).dataset.deck, '4');
  await zeige([TRACK, TRACK, LEER, LEER], projekt());
  assert.equal(knotenAm(1).dataset.deck, '1');
  assert.equal(knotenAm(2).dataset.deck, '2');
});

test('strudel in place 1, 2, 3 or 4 shows the same module body, the strip is named by the container letter', async () => {
  const dom = [];
  for (const n of [1, 2, 3, 4]) {
    const p = [LEER, LEER, LEER, LEER]; p[n - 1] = T('strudel', 'g2');
    await zeige(p, projekt());
    assert.deepEqual(sichtbar(), { [n]: 'strudel' }, `place ${n}`);
    assert.equal(knotenAm(n).id, 'deck-c');
    dom.push(knotenAm(n).textContent);
    assert.equal(kopfText(n), 'STRUDEL');
    assert.equal(zugName(['deck/1', 'deck/2', 'pad/1', 'pad/2'][n - 1]), `${'ABCD'[n - 1]} strudel`);
  }
  assert.ok(dom.every((t) => t === dom[0]), 'the four runs show the same module DOM');
});

test('loops shows the deck of its group: a group whose LoopDeck.platz is 2 shows loop deck 2 even in place 3', async () => {
  await zeige([TRACK, TRACK, T('loops', 'g3'), LEER], projekt());
  assert.deepEqual(sichtbar(), { 1: 'track', 2: 'track', 3: 'loops' });
  assert.equal(knotenAm(3).id, 'platz-loops2');
  assert.equal(kopfText(3), 'LOOP 2');
  await zeige([TRACK, TRACK, T('loops', 'g_unbekannt'), LEER], projekt());
  assert.equal(knotenAm(3).id, 'platz-loops', 'a group the page does not know yet shows loop deck 1');
});

test('stems lists one row per group track, with fader and mute, and no LOAD', async () => {
  await zeige([LEER, T('stems', 'g4'), LEER, LEER], projekt());
  const k = knotenAm(2);
  assert.equal(k.dataset.platzBody, 'stems');
  const zeilen = k.querySelectorAll('.st-zeile');
  assert.deepEqual(zeilen.map((z) => z.querySelectorAll('.st-name')[0].textContent), ['Kick', 'Bass'], 'the track of another group is not a row');
  for (const z of zeilen) {
    assert.equal(z.querySelectorAll('input.st-fader').length, 1, 'fader');
    assert.equal(z.querySelectorAll('button.st-mute').length, 1, 'mute');
  }
  assert.equal(zeilen[1].querySelectorAll('button.st-mute')[0].classList.contains('an'), true, 'the muted track shows it');
  assert.equal(k.querySelectorAll('button.laden').length, 0, 'no LOAD');
  assert.doesNotMatch(k.textContent, /LOAD/);
});

test('no L1/L2 strip pair and no loop box row exist in the page', async () => {
  assert.doesNotMatch(html, /data-boxzug/);
  assert.equal(attrappe.body.querySelectorAll('[data-boxzug]').length, 0);
  assert.doesNotMatch(html, /data-recziel="pad/);
  assert.doesNotMatch(html, /LOOP BOX|loop box/i);
  assert.equal(attrappe.body.querySelectorAll('.zug[data-kanalzug="pad/1"]').length, 1);
  assert.equal(attrappe.body.querySelectorAll('.zug[data-kanalzug="pad/2"]').length, 1);
});

test('the page keeps working when lage.plaetze is null: every body hides, nothing throws', async () => {
  await zeige(null, null);
  assert.deepEqual(sichtbar(), {});
  assert.equal(koerper().filter((k) => !k.hidden).length, 0);
});
