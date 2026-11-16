// Workbench task 3: the view shell with transport. werkbank.js is run against the DOM stand-in (tests/helpers/pages_mock.mjs); the stream
// events are driven by calling the view's event entry directly (bindeWerkbank alone creates no EventSource). The wiring of the fourth view in the
// page files is pinned as text.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const lies = (n) => fs.readFileSync(path.join(PUBLIC, n), 'utf8');

installiere();   // the globals the modules read at import time
const { bindeWerkbank, istModul, WERKBANK_TEXT } = await import('../public/werkbank/werkbank.js');
const { modulTakte, laengeBefehl, tempoBefehl, LAENGEN } = await import('../public/werkbank/kopf.js');
const { regalEintraege } = await import('../public/werkbank/regal.js');
const { antwortText } = await import('../public/production/production.js');

const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const klick = (e) => e.dispatch('click');
const tippe = (e, text, taste) => { e.value = text; e.dispatch('keydown', { key: taste }); };
const POSTS = (weg) => attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url === weg);
const letzter = (weg) => { const l = POSTS(weg); assert.ok(l.length > 0, `no ${weg} sent`); return l.at(-1); };

const VORLAGE = { id: 'techno-130-start', name: 'Techno 130 · Start', text: 'Drums 909 and Bass Banddrive, 4 bars, 130 BPM' };
const modul = (extra = {}) => ({
  name: 'Techno 130 · Start', rev: 3, werkbank: { schema: 1 }, tempo_bpm: 130, taktart: [4, 4], loop: { an: true, von_beat: 0, bis_beat: 16 },
  spuren: [{ id: 's1', name: 'Drums', art: 'instrument', clips: [] }, { id: 's2', name: 'Bass', art: 'instrument', clips: [] }], ...extra,
});
const produktion = () => ({ name: 'Song', rev: 1, tempo_bpm: 120, taktart: [4, 4], loop: { an: false, von_beat: 0, bis_beat: 16 }, spuren: [] });

let wurzel, w, frageAntworten, fragen, $w;
function aufbau({ antworten = {}, frage } = {}) {
  installiere({
    antworten: {
      'GET /proj/aktuell': { j: { slug: null } },
      'GET /proj/liste': { j: [] },
      'GET /proj/werkbank/vorlagen': { j: { vorlagen: [VORLAGE] } },
      ...antworten,
    },
  });
  wurzel = document.createElement('section');
  fragen = [];
  frageAntworten = frage ?? (() => true);
  w = bindeWerkbank({ post, wurzel, frage: (t) => { fragen.push(t); return frageAntworten(t); } });
  $w = (n) => wurzel.querySelector(`[data-w="${n}"]`);
}
const knopfMitText = (text) => wurzel.querySelectorAll('button').find((b) => b.textContent === text);
const MODUL_ANTWORTEN = (p = modul()) => ({
  'GET /proj/aktuell': { j: { slug: 'techno-130-start', projekt: p } },
  'POST /proj/neu': { j: { slug: 'techno-130-start', projekt: p } },
  'POST /proj/oeffnen': { j: { slug: 'techno-130-start', projekt: p } },
});

beforeEach(() => aufbau());

test('nothing is fetched before the view is shown', () => {
  assert.equal(attrappe.anrufe.length, 0);
});

test('no module open: the empty state offers the template; a click creates it and PLAY starts at beat 0, STOP stops', async () => {
  w.zeige(); await ruhe();
  assert.equal($w('leer').hidden, false);
  assert.equal($w('spuren').hidden, true);
  assert.equal($w('name').textContent, '');
  assert.ok($w('leer').textContent.includes(WERKBANK_TEXT.keinModul));
  attrappe.antworten['POST /proj/neu'] = { j: { slug: 'techno-130-start', projekt: modul() } };
  klick(knopfMitText('Techno 130 · Start')); await ruhe();
  assert.deepEqual(letzter('/proj/neu').koerper, { name: 'Techno 130 · Start', werkbank: true, vorlage: 'techno-130-start' });
  assert.equal($w('name').textContent, 'Techno 130 · Start');
  assert.equal($w('leer').hidden, true);
  assert.equal($w('spuren').hidden, false);
  klick($w('play')); await ruhe();
  assert.deepEqual(letzter('/proj/transport').koerper, { aktion: 'start', beat: 0 });
  klick($w('stopp')); await ruhe();
  assert.deepEqual(letzter('/proj/transport').koerper, { aktion: 'stopp' });
});

test('+ empty module creates a module without a template under the typed name', async () => {
  w.zeige(); await ruhe();
  attrappe.antworten['POST /proj/neu'] = { j: { slug: 'leer-1', projekt: modul({ name: 'Mine' }) } };
  klick(knopfMitText('+ empty module'));
  tippe($w('leer-name'), 'Mine', 'Enter'); await ruhe();
  assert.deepEqual(letzter('/proj/neu').koerper, { name: 'Mine', werkbank: true });
  assert.equal($w('name').textContent, 'Mine');
});

test('the shelf select opens a module from the list (only modules are listed)', async () => {
  attrappe.antworten['GET /proj/liste'] = { j: [{ slug: 'a', name: 'Alpha', werkbank: true }, { slug: 'b', name: 'Song' }] };
  w.zeige(); await ruhe();
  const s = $w('leer-oeffnen');
  assert.deepEqual(s.querySelectorAll('option').map((o) => o.value), ['', 'a']);
  attrappe.antworten['POST /proj/oeffnen'] = { j: { slug: 'a', projekt: modul({ name: 'Alpha' }) } };
  s.value = 'a'; s.dispatch('change'); await ruhe();
  assert.deepEqual(letzter('/proj/oeffnen').koerper, { slug: 'a' });
  assert.equal($w('name').textContent, 'Alpha');
});

test('LENGTH and BPM write project commands with the rev; a bad tempo sends nothing', async () => {
  Object.assign(attrappe.antworten, MODUL_ANTWORTEN());
  w.zeige(); await ruhe();
  assert.equal($w('bpm').value, '130');
  assert.equal($w('laenge-4').classList.contains('an'), true);
  assert.equal($w('laenge-8').classList.contains('an'), false);
  attrappe.antworten['POST /proj/aendern'] = { j: { rev: 4, projekt: modul({ rev: 4, loop: { an: true, von_beat: 0, bis_beat: 32 } }) } };
  klick($w('laenge-8')); await ruhe();
  const l = letzter('/proj/aendern').koerper;
  assert.equal(l.rev, 3); assert.equal(l.label, 'Length 8 bars');
  assert.deepEqual(l.befehle, [{ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 32 }]);
  assert.equal($w('laenge-8').classList.contains('an'), true);
  attrappe.antworten['POST /proj/aendern'] = { j: { rev: 5, projekt: modul({ rev: 5, tempo_bpm: 132 }) } };
  tippe($w('bpm'), '132', 'Enter'); await ruhe();
  const t = letzter('/proj/aendern').koerper;
  assert.equal(t.rev, 4); assert.equal(t.label, 'Tempo 132');
  assert.deepEqual(t.befehle, [{ befehl: 'tempo_setzen', bpm: 132 }]);
  const n = attrappe.anrufe.length;
  tippe($w('bpm'), 'abc', 'Enter'); await ruhe();
  assert.equal(attrappe.anrufe.length, n, 'nonsense sends nothing');
  assert.equal($w('bpm').value, '132', 'the stored tempo is shown again');
});

test('a loop that is off, not from 0 or an odd length shows no LENGTH button active; PLAY still starts', async () => {
  for (const loop of [{ an: false, von_beat: 0, bis_beat: 16 }, { an: true, von_beat: 4, bis_beat: 20 }, { an: true, von_beat: 0, bis_beat: 12 }]) {
    aufbau({ antworten: MODUL_ANTWORTEN(modul({ loop })) });
    w.zeige(); await ruhe();
    assert.deepEqual(LAENGEN.filter((n) => $w(`laenge-${n}`).classList.contains('an')), []);
    klick($w('play')); await ruhe();
    assert.deepEqual(letzter('/proj/transport').koerper, { aktion: 'start', beat: 0 });
  }
});

test('a deck is playing: BPM and PLAY show the server text and return to idle (R2)', async () => {
  Object.assign(attrappe.antworten, MODUL_ANTWORTEN());
  w.zeige(); await ruhe();
  const r = { code: 409, j: { fehler: 'deck_laeuft' } };
  attrappe.antworten['POST /proj/aendern'] = r;
  tippe($w('bpm'), '140', 'Enter'); await ruhe();
  assert.equal($w('meldung').textContent, antwortText({ status: 409, j: r.j }));
  assert.equal($w('bpm').value, '130', 'the field shows the stored tempo again');
  attrappe.antworten['POST /proj/transport'] = r;
  klick($w('play')); await ruhe();
  assert.equal($w('meldung').textContent, antwortText({ status: 409, j: r.j }));
  assert.equal($w('play').classList.contains('wartet'), false);
  klick($w('play')); await ruhe();
  assert.equal(POSTS('/proj/transport').length, 2, 'idle again: a new click starts again');
});

test('a production project is open: empty state, nothing sent, the project stays open (review focus 1)', async () => {
  Object.assign(attrappe.antworten, { 'GET /proj/aktuell': { j: { slug: 'song', projekt: produktion() } } });
  w.zeige(); await ruhe();
  assert.equal($w('leer').hidden, false);
  assert.ok($w('leer').textContent.includes(WERKBANK_TEXT.keinWerkbank));
  assert.equal($w('spuren').hidden, true);
  assert.equal($w('play').disabled, true);
  klick($w('play')); klick($w('stopp')); await ruhe();
  assert.equal(attrappe.anrufe.filter((a) => a.methode === 'POST').length, 0);
});

test('live container plays: the open asks, "no" sends nothing more (review focus 1)', async () => {
  aufbau({ frage: () => false });
  w.zeige(); await ruhe();
  attrappe.antworten['POST /proj/neu'] = { code: 409, j: { fehler: 'live_laeuft' } };
  klick(knopfMitText('Techno 130 · Start')); await ruhe();
  assert.equal(POSTS('/proj/neu').length, 1);
  assert.equal(fragen.length, 1);
  assert.equal($w('name').textContent, '');
  // "yes": the same request goes again with bestaetigt
  aufbau({ frage: () => true });
  w.zeige(); await ruhe();
  attrappe.antworten['POST /proj/neu'] = (k) => (k.bestaetigt ? { j: { slug: 'x', projekt: modul() } } : { code: 409, j: { fehler: 'live_laeuft' } });
  klick(knopfMitText('Techno 130 · Start')); await ruhe();
  assert.equal(POSTS('/proj/neu').length, 2);
  assert.equal(letzter('/proj/neu').koerper.bestaetigt, true);
  assert.equal($w('name').textContent, 'Techno 130 · Start');
});

test('PLAY while waiting sends no second start; STOP during the wait stops (review focus 2, R3)', async () => {
  Object.assign(attrappe.antworten, MODUL_ANTWORTEN());
  w.zeige(); await ruhe();
  klick($w('play')); klick($w('play')); await ruhe();
  assert.equal(POSTS('/proj/transport').length, 1, 'two clicks before any stream event: one start');
  assert.equal($w('play').classList.contains('wartet'), true);
  w.ereignis('/zustand/arr', { status: 1, projekt_beat: 0, nr: 1 });
  klick($w('play')); await ruhe();
  assert.equal(POSTS('/proj/transport').length, 1, 'waiting reported by the core: still no second start');
  w.ereignis('/zustand/arr', { status: 2, projekt_beat: 0.5, nr: 1 });
  assert.equal($w('play').classList.contains('an'), true);
  assert.equal($w('play').classList.contains('wartet'), false);
  klick($w('play')); await ruhe();
  assert.equal(POSTS('/proj/transport').length, 1, 'playing: a click sends nothing');
  klick($w('stopp')); await ruhe();
  assert.deepEqual(letzter('/proj/transport').koerper, { aktion: 'stopp' });
  w.ereignis('/zustand/arr', { status: 0, projekt_beat: 0, nr: 1 });
  assert.equal($w('play').classList.contains('an'), false);
  klick($w('play')); await ruhe();
  assert.equal(POSTS('/proj/transport').length, 3, 'stopped: PLAY starts again');
});

test('STOP before the stream reports playing clears the wait', async () => {
  Object.assign(attrappe.antworten, MODUL_ANTWORTEN());
  w.zeige(); await ruhe();
  klick($w('play')); await ruhe();
  assert.equal($w('play').classList.contains('wartet'), true);
  klick($w('stopp')); await ruhe();
  assert.equal($w('play').classList.contains('wartet'), false);
  klick($w('play')); await ruhe();
  assert.equal(POSTS('/proj/transport').length, 3);
});

test('UNDO and REDO go through the writer (R8) and the context carries the contract', async () => {
  Object.assign(attrappe.antworten, MODUL_ANTWORTEN());
  w.zeige(); await ruhe();
  attrappe.antworten['POST /proj/undo'] = { j: { rev: 4, projekt: modul({ rev: 4 }) } };
  klick($w('undo')); await ruhe();
  assert.deepEqual(letzter('/proj/undo').koerper, { rev: 3 });
  attrappe.antworten['POST /proj/redo'] = { j: { rev: 5, projekt: modul({ rev: 5 }) } };
  klick($w('redo')); await ruhe();
  assert.deepEqual(letzter('/proj/redo').koerper, { rev: 4 });
  const ctx = w.ctx;
  for (const f of ['$', 'holeJson', 'holeGet', 'melde', 'lies', 'merke', 'aendere', 'aendereAus', 'uebernimm', 'ladeAktuell', 'waehle', 'kopfBeat', 'oeffneModul', 'neuesModul', 'frage', 'info', 'undo', 'redo']) {
    assert.equal(typeof ctx[f], 'function', f);
  }
  for (const h of ['beimProjekt', 'beimEreignis', 'vorBild', 'beiWahl']) assert.ok(Array.isArray(ctx[h]), h);
  for (const k of ['slug', 'projekt', 'sichtbar', 'wahl', 'arr']) assert.ok(k in ctx.st, k);
  assert.equal(ctx.info(null), null, 'no track, no instrument info (the cache itself is tested in werkbank_tracks.test.mjs)');
});

test('the selected track is remembered per module and offered to the hooks', async () => {
  Object.assign(attrappe.antworten, MODUL_ANTWORTEN());
  const gesehen = [];
  w.ctx.beiWahl.push((id) => gesehen.push(id));
  w.zeige(); await ruhe();
  assert.equal(w.ctx.st.wahl, 's1', 'default: the first track');
  w.ctx.waehle('s2');
  assert.equal(w.ctx.st.wahl, 's2');
  assert.equal(localStorage.getItem('djk-wb-wahl-techno-130-start'), 's2');
  assert.deepEqual(gesehen.at(-1), 's2');
});

test('the heads: beimProjekt is called with the change flag, beimEreignis gets the stream', async () => {
  Object.assign(attrappe.antworten, MODUL_ANTWORTEN());
  const projekte = [], ereignisse = [];
  w.ctx.beimProjekt.push((p, wechsel) => projekte.push([p?.name ?? null, wechsel]));
  w.ctx.beimEreignis.push((a) => ereignisse.push(a));
  w.zeige(); await ruhe();
  assert.deepEqual(projekte.at(-1), ['Techno 130 · Start', true]);
  w.ereignis('/zustand/arr', { status: 0, projekt_beat: 0, nr: 1 });
  assert.deepEqual(ereignisse, ['/zustand/arr']);
});

test('verberge stops the frame loop: no hook runs once the view is hidden', async () => {
  const bilder = [];
  let nachster = null;
  globalThis.requestAnimationFrame = (f) => { nachster = f; return 1; };
  Object.assign(attrappe.antworten, MODUL_ANTWORTEN());
  w.ctx.vorBild.push((t) => bilder.push(t));
  w.zeige(); await ruhe();
  nachster(0);
  assert.equal(bilder.length, 1);
  w.verberge();
  nachster(1);
  assert.equal(bilder.length, 1);
  globalThis.requestAnimationFrame = () => 0;
});

test('every region of the contract exists as a host and as a binder file', () => {
  for (const r of ['kopf', 'spuren', 'noten', 'klang', 'regal', 'leer', 'meldung']) assert.ok($w(r), `region ${r}`);
  for (const f of ['werkbank.js', 'werkbank.css', 'kopf.js', 'kopf.css', 'regal.js', 'regal.css', 'tracks.js', 'tracks.css', 'sound.js', 'sound.css', 'grid_view.js', 'grid.css']) {
    assert.ok(fs.existsSync(path.join(PUBLIC, 'werkbank', f)), f);
  }
  const css = lies('werkbank/werkbank.css');
  const reihe = ['kopf', 'regal', 'spuren', 'raster', 'klang'].map((n) => css.indexOf(`@import url('${n}.css')`));
  assert.ok(reihe.every((i) => i >= 0), 'every region CSS is imported');
  assert.deepEqual([...reihe].sort((a, b) => a - b), reihe, 'in the order of the binders');
});

test('the fourth view is wired', () => {
  assert.match(lies('seitenrahmen.js'), /const ANSICHTEN = \['dj', 'studio', 'produktion', 'werkbank'\]/);
  assert.match(lies('index.html'), /data-ansicht="studio"[^>]*>LIVE</);
  assert.match(lies('index.html'), /data-ansicht="werkbank"[^>]*>STUDIO</);
  assert.match(lies('index.html'), /<section id="werkbank" aria-label="Studio"><\/section>/);
  assert.match(lies('index.html'), /<link rel="stylesheet" href="werkbank\/werkbank\.css">/);
  assert.match(lies('stream.js'), /werkbank\?\.ereignis\(a, f\)/);
  assert.match(lies('seq_view.js'), /!b\.contains\('werkbank'\)/);
  assert.match(lies('app.js'), /setzeWerkbank\(bindeWerkbank\(/);
});

test('modulTakte, laengeBefehl, tempoBefehl, istModul', () => {
  assert.equal(modulTakte({ loop: { an: true, von_beat: 0, bis_beat: 16 } }), 4);
  assert.equal(modulTakte({ loop: { an: true, von_beat: 0, bis_beat: 4 } }), 1);
  for (const loop of [{ an: false, von_beat: 0, bis_beat: 16 }, { an: true, von_beat: 4, bis_beat: 20 }, { an: true, von_beat: 0, bis_beat: 12 }]) assert.equal(modulTakte({ loop }), null);
  assert.equal(modulTakte(null), null);
  assert.deepEqual(laengeBefehl(8), { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 32 });
  assert.deepEqual([tempoBefehl('130'), tempoBefehl('59'), tempoBefehl('201'), tempoBefehl(''), tempoBefehl('130,25'), tempoBefehl('130.123')],
    [{ befehl: 'tempo_setzen', bpm: 130 }, null, null, null, { befehl: 'tempo_setzen', bpm: 130.25 }, null]);
  assert.deepEqual(LAENGEN, [1, 2, 4, 8, 16]);
  assert.equal(istModul({ werkbank: { schema: 1 } }), true);
  assert.equal(istModul({ werkbank: { schema: 2 } }), false);
  assert.equal(istModul(null), false);
});

test('regalEintraege: only modules, sorted by name, the open one marked', () => {
  const r = regalEintraege([{ slug: 'b', name: 'beta', werkbank: true }, { slug: 'x', name: 'Song' }, { slug: 'a', name: 'Alpha', werkbank: true }], { vorlagen: [VORLAGE] }, 'a');
  assert.deepEqual(r.module, [{ slug: 'a', name: 'Alpha', offen: true }, { slug: 'b', name: 'beta', offen: false }]);
  assert.deepEqual(r.vorlagen, [VORLAGE]);
  assert.deepEqual(regalEintraege(null, null, null), { module: [], vorlagen: [] });
});
