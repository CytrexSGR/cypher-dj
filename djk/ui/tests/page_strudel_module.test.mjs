// Container core U5: the Strudel module is generated per stream. The page runs against the DOM stand-in: one row per `strom` track of the strudel
// group of the live project (streams 1, 2, 3 stay as defaults), a "+ STREAM" picker for the rest, the strip of a row binds the alias strip rows
// `erz/<n>/<suffix>`. Nothing leaves the process; no browser, no socket to the studio.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const T = (typ, gruppe) => (gruppe ? { typ, gruppe } : { typ });
const LEER = T('leer');
const warte = () => new Promise((r) => setTimeout(r, 30));
let lagePlaetze = null, ansicht, live, zustand, kanaele;
const zeige = async (plaetze, projekt = null, behalte = false) => {
  if (!behalte) (await import('../public/strudel_module.js')).schliesseGeoeffnete();
  lagePlaetze = plaetze; live.projekt = projekt; await ansicht.holeLage(); await warte(); };
const zeilen = () => attrappe.body.querySelectorAll('#deck-c .instanz');
const ströme = () => zeilen().map((z) => Number(z.dataset.strom));
const zeile = (n) => zeilen().find((z) => z.dataset.strom === String(n));
const q = (w, s) => w.querySelectorAll(s)[0];
const nurPosts = (von = 0) => attrappe.anrufe.slice(von).filter((a) => a.methode !== 'GET');

const strom = (n, extra = {}) => ({ id: `s${n}`, nr: n + 10, name: `S${n}`, art: 'strom', strom: n, gruppe: 'g2', fader_db: 0, pan: 0, mute: false, solo: false, clips: [], ...extra });
const projekt = (stroeme = [], extra = {}) => ({
  live: true, rev: 1, plaetze: [], spuren: stroeme.map((n) => strom(n)), returns: [],
  gruppen: [{ id: 'g2', name: 'STRUDEL', strudel: {} }], ...extra,
});
const PLATZ_C = [LEER, LEER, T('strudel', 'g2'), LEER];

before(async () => {
  installiere({
    html,
    antworten: {
      'GET /bestand': { j: [] }, 'GET /loops': { j: [] }, 'GET /strudel': { j: { text: '', status: null, autonom: true } },
      'GET /lage': () => ({ j: { plaetze: lagePlaetze, container: [{ art: 'leer' }, { art: 'leer' }, { art: 'leer' }, { art: 'leer' }] } }),
    },
  });
  const El = attrappe.body.constructor;
  if (!('cells' in El.prototype)) Object.defineProperty(El.prototype, 'cells', { get() { return this.children.filter((c) => typeof c !== 'string'); } });
  // the knob handles capture the pointer and read the length of their groove; the stand-in has neither
  El.prototype.setPointerCapture ??= function setPointerCapture() {};
  El.prototype.hasPointerCapture ??= function hasPointerCapture() { return true; };
  El.prototype.releasePointerCapture ??= function releasePointerCapture() {};
  Object.defineProperty(El.prototype, 'clientHeight', { get() { return 100; }, configurable: true });
  await import('../public/app.js');
  ansicht = await import('../public/slots_view.js');
  live = (await import('../public/live_view.js')).live;
  zustand = (await import('../public/page_state.js')).zustand;
  kanaele = await import('../public/kanaele.js');
  await warte();
});

test('a placed strudel module with no strom track shows rows for streams 1, 2, 3 and no other', async () => {
  await zeige(PLATZ_C, projekt());
  assert.deepEqual(ströme(), [1, 2, 3]);
  assert.deepEqual(zeilen().map((z) => q(z, '.instanzname').textContent), ['DRUMS', 'BASS', 'MELODY']);
});

test('one row per strom track of the strudel group, in stream order', async () => {
  await zeige(PLATZ_C, projekt([16, 9, 2, 5]));
  assert.deepEqual(ströme(), [1, 2, 3, 5, 9, 16]);
  // a track of another group, or a track that is not a stream track, is no row
  const p = projekt([2]);
  p.spuren.push(strom(6, { gruppe: 'g9' }), { ...strom(7), art: 'audio', strom: undefined });
  await zeige(PLATZ_C, p);
  assert.deepEqual(ströme(), [1, 2, 3]);
});

test('the + STREAM picker lists exactly STROEME minus the shown streams, and picking opens an empty row without any request', async () => {
  await zeige(PLATZ_C, projekt([5]));
  const wahl = q(attrappe.body, '#deck-c select[data-strom-plus]');
  assert.ok(wahl, 'the picker exists');
  const angebot = wahl.querySelectorAll('option').map((o) => o.attrs.value).filter((v) => v !== '').map(Number);
  assert.deepEqual(angebot, kanaele.STROEME.filter((n) => ![1, 2, 3, 5].includes(n)));
  const von = attrappe.anrufe.length;
  wahl.value = '9';
  wahl.dispatch('change');
  await warte();
  assert.deepEqual(ströme(), [1, 2, 3, 5, 9]);
  assert.equal(q(zeile(9), '.muster-feld').value, '', 'an empty row');
  assert.deepEqual(nurPosts(von), [], 'no write for opening a row');
  const wieder = q(attrappe.body, '#deck-c select[data-strom-plus]').querySelectorAll('option').map((o) => o.attrs.value);
  assert.ok(!wieder.includes('9'), 'the picked stream left the list');
});

test('the first pattern of a new row is sent as POST /strudel {strom, text} and nothing is created by the page', async () => {
  attrappe.antworten['POST /strudel'] = { j: { ok: true } };
  await zeige(PLATZ_C, projekt());
  const z = zeile(6) ?? (() => { const w = q(attrappe.body, '#deck-c select[data-strom-plus]'); w.value = '6'; w.dispatch('change'); return zeile(6); })();
  await warte();
  const von = attrappe.anrufe.length;
  q(z, '.muster-feld').value = 's("bd*4")';
  q(z, '.muster-senden').click();
  await warte();
  const p = nurPosts(von);
  assert.deepEqual(p.map((a) => `${a.methode} ${a.url}`), ['POST /strudel']);
  assert.deepEqual(p[0].koerper, { strom: 6, text: 's("bd*4")' });
  assert.equal(attrappe.anrufe.filter((a) => a.url.startsWith('/proj/aendern')).length, 0, 'the page adds no track');
});

test('a refusal kein_strudel_modul is shown in the row and the row keeps its text', async () => {
  attrappe.antworten['POST /strudel'] = { code: 409, j: { fehler: 'kein_strudel_modul', text: 'no Strudel module is placed' } };
  await zeige(PLATZ_C, projekt());
  const z = zeile(2);
  q(z, '.muster-feld').value = 'note("c2")';
  q(z, '.muster-senden').click();
  await warte();
  assert.equal(q(z, '.muster-fehler').textContent, 'no Strudel module is placed');
  assert.equal(q(z, '.muster-feld').value, 'note("c2")', 'the text stays');
  attrappe.antworten['POST /strudel'] = { code: 409, j: { fehler: 'kein_strudel_modul' } };
  q(z, '.muster-senden').click();
  await warte();
  assert.equal(q(z, '.muster-fehler').textContent, 'kein_strudel_modul', 'without a text the reason code shows');
});

test('the strip of a row binds erz/<n>/(fader|pfl|eq/*|kill/*|filter|trim) and nothing else', async () => {
  await zeige(PLATZ_C, projekt([5]));
  const z = zeile(5), strip = q(z, '.zug[data-kanalzug="erz/5"]');
  assert.ok(strip, 'the strip of the row');
  const regler = strip.querySelectorAll('.regler[data-pfad]'), schalter = strip.querySelectorAll('.schalter[data-pfad]');
  assert.ok(regler.length >= 6 && schalter.length >= 4);
  const von = attrappe.anrufe.length;
  for (const r of regler) { r.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 0, clientY: 50 }); r.dispatch('pointerup', { pointerId: 1 }); }
  for (const s of schalter) s.click();
  await warte(); await warte();
  // the track of the row has a slot, so pan and mute of the native rows sit in the strip too (checked in the last test); the alias part is what counts here
  const pfade = [...new Set(attrappe.anrufe.slice(von).filter((a) => a.url === '/griff').map((a) => a.koerper.pfad))].filter((p) => !p.startsWith('spur/')).sort();
  const erwartet = ['fader', 'filter', 'pfl', 'trim', 'eq/hoch', 'eq/mitte', 'eq/tief', 'kill/hoch', 'kill/mitte', 'kill/tief'].map((s) => `erz/5/${s}`).sort();
  assert.deepEqual(pfade, erwartet);
  for (const s of erwartet.map((p) => p.slice('erz/5/'.length))) assert.ok(kanaele.ALIAS_SUFFIXE.includes(s), `${s} is an alias suffix`);
  assert.equal(strip.querySelectorAll('[data-pfad]').filter((e) => !erwartet.includes(e.dataset.pfad) && !e.dataset.pfad.startsWith('spur/15/')).length, 0, 'no other bound path');
  assert.equal(strip.querySelectorAll('.xzuweisung').length, 0, 'the crossfader side is not an alias row');
});

test('a stream outside the alias set (16) keeps its row and strip, but binds no erz path and writes nothing', async () => {
  assert.equal(kanaele.STROEME.includes(16), false, 'stream 16 has no alias rows');
  await zeige(PLATZ_C, projekt([16, 5]));
  const strip16 = q(zeile(16), '.zug'), strip5 = q(zeile(5), '.zug');
  assert.ok(strip16, 'the strip still renders');
  assert.equal(strip16.dataset.ohneAlias, '1');
  assert.equal(strip5.dataset.ohneAlias, undefined, 'a stream of the set is bound');
  const gebunden = strip16.querySelectorAll('[data-pfad]').map((e) => e.dataset.pfad);
  assert.ok(gebunden.every((p) => p.startsWith('spur/')), `only native track rows may remain: ${gebunden.join()}`);
  const von = attrappe.anrufe.length;
  for (const r of strip16.querySelectorAll('.regler')) { r.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 0, clientY: 50 }); r.dispatch('pointerup', { pointerId: 1 }); }
  for (const e of strip16.querySelectorAll('.schalter')) e.click();
  await warte(); await warte();
  assert.deepEqual(attrappe.anrufe.slice(von).filter((a) => a.koerper?.pfad?.startsWith('erz/')), [], 'no erz/16 write');
  assert.ok(strip5.querySelectorAll('[data-pfad]').some((e) => e.dataset.pfad.startsWith('erz/5/')), 'control: stream 5 binds erz/5');
});

test('a stream whose track has no generator shows "no generator" and the strip still renders, level shows silence, no NaN', async () => {
  zustand.regler = { 'erz/2/fader': -3 };   // the read mirror lists the generator mixer rows of a stream that has one
  await zeige(PLATZ_C, projekt([2, 5]));
  const leise = q(zeile(5), '.erzeuger-hinweis'), da = q(zeile(2), '.erzeuger-hinweis');
  assert.equal(leise.textContent, 'no generator');
  assert.equal(leise.hidden, false);
  assert.equal(da.hidden, true, 'a stream with a generator shows no hint');
  assert.ok(q(zeile(5), '.zug[data-kanalzug="erz/5"] .meter'), 'the strip with its level meter still renders');
  const alles = JSON.stringify(q(zeile(5), '.zug'), (k, v) => (k === 'parent' ? undefined : v));   // the lanes of the row measure a real layout, the stand-in has none
  assert.doesNotMatch(alles, /NaN/);
  zustand.regler = {};
});

test('streams 9 and 10 are rows like any other: no loop box text, no pad path', async () => {
  await zeige(PLATZ_C, projekt([9, 10]));
  assert.deepEqual(ströme(), [1, 2, 3, 9, 10]);
  for (const n of [9, 10]) {
    const z = zeile(n);
    const pfade = z.querySelectorAll('[data-pfad], [data-kanalzug], [data-kanal]').flatMap((e) => [e.dataset.pfad, e.dataset.kanalzug, e.dataset.kanal]).filter(Boolean).filter((p) => !p.startsWith(`spur/${n + 10}/`));   // pan and mute of the native rows bind to the slot of the track
    assert.ok(pfade.length > 8);
    assert.ok(pfade.every((p) => p.startsWith(`erz/${n}`)), pfade.filter((p) => !p.startsWith(`erz/${n}`)).join());
    assert.doesNotMatch(z.textContent, /\b(box|pad|loopdeck|loop box)\b/i);
  }
});

test('the module renders identically in place 2 and place 4', async () => {
  const gestalt = (e) => (typeof e === 'string' ? e : `<${e.tagName} ${Object.entries(e.attrs).filter(([k]) => k !== 'data-platz').map(([k, v]) => `${k}=${v}`).join(' ')}>${e.children.map(gestalt).join('')}</>`);
  const p2 = [LEER, T('strudel', 'g2'), LEER, LEER], p4 = [LEER, LEER, LEER, T('strudel', 'g2')];
  await zeige(p2, projekt([2, 5]));
  const a = gestalt(q(attrappe.body, '#deck-c'));
  assert.equal(q(attrappe.body, '#deck-c').dataset.platz, '2');
  await zeige(p4, projekt([2, 5]));
  const b = gestalt(q(attrappe.body, '#deck-c'));
  assert.equal(q(attrappe.body, '#deck-c').dataset.platz, '4');
  assert.equal(a, b);
});

test('without a slot the strip omits pan, mute and sends; with the slot of the track they bind spur/<nr>/...', async () => {
  const ohne = projekt();   // stream 3 has no track: no slot
  await zeige(PLATZ_C, ohne);
  const leer = (n) => zeile(n).querySelectorAll('[data-pfad]').map((e) => e.dataset.pfad).filter((p) => /\/(pan|mute|send\/)/.test(p));
  assert.deepEqual(leer(3), []);
  const mit = projekt([3], { returns: [
    { id: 'r1', nr: 1, name: 'HALL', strudel: { art: 'hall' }, gruppe: 'g2' }, { id: 'r2', nr: 2, name: 'DELAY', strudel: { art: 'delay' }, gruppe: 'g2' },
    { id: 'r3', nr: 3, name: 'other', gruppe: 'g9' } ] });
  await zeige(PLATZ_C, mit);
  const slot = mit.spuren[0].nr;
  assert.deepEqual(leer(3).sort(), [`spur/${slot}/mute`, `spur/${slot}/pan`, `spur/${slot}/send/1`, `spur/${slot}/send/2`].sort());
  await zeige(PLATZ_C, projekt());
  assert.deepEqual(leer(3), [], 'the controls leave with the track');
});

test('the stream strip offers the device window of its track: a button only where the stream has a track, it opens #geraet=<track id>', async () => {
  const geoeffnet = [];
  const alt = globalThis.window.open;
  globalThis.window.open = (adresse, name) => { geoeffnet.push([adresse, name]); return { focus() {} }; };
  try {
    await zeige(PLATZ_C, projekt([5]));
    const knopf = (n) => q(zeile(n), '[data-strom-geraete]');
    assert.ok(knopf(5), 'the stream with a track has the button');
    assert.equal(knopf(5).hidden, false);
    assert.equal(knopf(2).hidden, true, 'stream 2 has no track: nothing to open');
    assert.equal(knopf(5).dataset.stromGeraete, '5');
    knopf(5).click();
    assert.equal(geoeffnet.length, 1);
    assert.match(geoeffnet[0][0], /#geraet=s5$/);
    knopf(2).click();
    assert.equal(geoeffnet.length, 1, 'a hidden button opens nothing');
  } finally { globalThis.window.open = alt; }
});
