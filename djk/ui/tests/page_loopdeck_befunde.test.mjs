// Review fixes of the loop deck page (loop deck P fix round): auto-create guard (C1), menu clamping (I1), reconnect (I2), export row stand (I3),
// library buttons (I4) and the smaller findings. DOM stand-in and fake fetch; never touches a studio port.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { El, installiere } from './helpers/pages_mock.mjs';
import { APP_DATEIEN } from './helpers/app_source.mjs';

const HTML = '<body><div id="meldung"></div><table><tbody id="loopliste"></tbody></table><section id="platz-loops"><div class="loopdeck" data-deck="1"></div></section><section id="platz-loops2"><div class="loopdeck" data-deck="2"></div></section></body>';
const ruhe = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok)); };
const zelle = (n, extra = {}) => ({ id: `z${n}`, name: `cell ${n}`, farbe: n, art: 'loop', sha256: `sha${n}`, beats: 8, bpm: 128, gain_db: 0, frames: 1000, ...extra });
const lauf0 = () => ({ zelle: null, verwaist: false, ab_beat: 0, versatz_beats: 0, wartend: null, zuletzt: null });
const spur = (g, nr, extra = {}) => ({ spur_id: `s${g}${nr}`, nr, name: `L${g}.${nr}`, fader_db: 0, mute: false, filter: 0, zellen: [zelle(1), null, zelle(3), null, null, null, null, null], lauf: lauf0(), ...extra });
const deck = (g, extra = {}) => ({ gruppe_id: `g${g}`, platz: g, raster: '1', spuren: [1, 2, 3, 4].map((n) => spur(g, n, extra.spur?.(n))), ...extra.deck });
const posts = (a) => a.anrufe.filter((c) => c.methode === 'POST');
const urls = (a) => posts(a).map((c) => c.url);
const dk = (n = 1) => document.querySelector(`.loopdeck[data-deck="${n}"]`);
const zk = (n, s, z) => dk(n).querySelectorAll('.ld-spur')[s - 1].querySelectorAll('.zelle')[z - 1];

async function start({ stand = { decks: { 1: deck(1), 2: null }, beat: 16, bpm: 120 }, live = null, extra = {}, html = HTML, frage = () => true } = {}) {
  const a = installiere({ html, antworten: { 'GET /loopdeck/stand': () => ({ j: typeof stand === 'function' ? stand() : stand }), 'POST /loopdeck/neu': { j: { ok: true } }, 'GET /proj/aktuell': { j: { slug: 'live', rev: 1 } }, ...extra } });
  const la = await import('../public/live_view.js');   // registers the live hooks of the loop deck view
  const m = await import('../public/loopdeck/view.js');
  globalThis.confirm = frage;   // installiere() put its own
  la.live.projekt = live;
  m.zuruecksetzen(); m.zeigeLoopdecks(); await ruhe();
  return { a, m, la };
}
const projektOffen = { code: 409, j: { ok: false, grund: 'projekt_offen', text: 'a project is open' } };

// ---------- C1 ----------
test('C1: a visible loop place without an open live container sends no /loopdeck/neu; the head offers CREATE DECK and a hint', async () => {
  const { a } = await start({ live: null });
  assert.equal(urls(a).filter((u) => u === '/loopdeck/neu').length, 0);
  assert.equal(dk(2).querySelector('.ld-neu').hidden, false);
  assert.equal(dk(2).querySelector('.ld-hinweis').hidden, false);
  assert.match(dk(2).querySelector('.ld-hinweis').textContent, /live container/i);
  const p = await start({ live: { slug: 'p1' } });   // another project open: not the live container
  assert.equal(urls(p.a).filter((u) => u === '/loopdeck/neu').length, 0);
});

// UI polish task 3, verdict C: a `proj` event reads the stand (no decks in another project) while live.projekt still says live (pruefeLive runs 250 ms
// later): the automatic create fired and the server answered 409 projekt_offen. The create now asks the server first and only goes on for `live`.
test('C1 race: live.projekt still live but the server has another project open: no /loopdeck/neu; the deck is created once the answer is live', async () => {
  const { a, m } = await start({ live: { live: true, slug: 'live' }, extra: { 'GET /proj/aktuell': { j: { slug: 'p1', rev: 3 } } } });
  assert.equal(urls(a).filter((u) => u === '/loopdeck/neu').length, 0, 'stale live.projekt must not send the automatic create');
  assert.ok(a.anrufe.some((c) => c.url.startsWith('/proj/aktuell') && c.url.includes('nur=rev')), 'it asked the server first');
  a.antworten['GET /proj/aktuell'] = { j: { slug: 'live', rev: 4 } };
  m.zeigeLoopdecks(); await ruhe();
  assert.equal(urls(a).filter((u) => u === '/loopdeck/neu').length, 1, 'with the live set open the missing deck is created (a failed check does not use up the one try)');
});

test('C1: with the live container open a missing deck is created by exactly one request', async () => {
  const { a } = await start({ live: { live: true } });
  assert.equal(urls(a).filter((u) => u === '/loopdeck/neu').length, 1);
  assert.deepEqual(posts(a).find((c) => c.url === '/loopdeck/neu').koerper, { deck: 2 });
  assert.equal(dk(2).querySelector('.ld-hinweis').hidden, true);
});

test('C1: CREATE DECK answered with projekt_offen: No sends nothing more, the question names the closing', async () => {
  const frage = [];
  const { a } = await start({ live: null, extra: { 'POST /loopdeck/neu': projektOffen }, frage: (t) => { frage.push(t); return false; } });
  dk(2).querySelector('.ld-neu').click(); await ruhe();
  assert.deepEqual(urls(a), ['/loopdeck/neu']);
  assert.equal(frage.length, 1); assert.match(frage[0], /closes the open project/i);
});

test('C1: CREATE DECK answered with projekt_offen: Yes opens the live container, then asks for the deck again', async () => {
  let n = 0;
  const { a } = await start({ live: null, extra: { 'POST /loopdeck/neu': () => (++n === 1 ? projektOffen : { j: { ok: true } }), 'POST /live/oeffnen': { j: { ok: true } } } });
  dk(2).querySelector('.ld-neu').click(); await ruhe();
  assert.deepEqual(urls(a), ['/loopdeck/neu', '/live/oeffnen', '/loopdeck/neu']);
});

test('C1: every write goes through the one question: ladeInDeck and the cell menu ask once and repeat on Yes', async () => {
  const frage = [];
  let l = 0, z = 0;
  const { a, m } = await start({ frage: (t) => { frage.push(t); return true; }, stand: { decks: { 1: deck(1), 2: deck(2) }, beat: 16, bpm: 120 }, live: null,
    extra: { 'POST /loopdeck/laden': () => (++l === 1 ? projektOffen : { j: { ok: true, spur: 1, zelle: 2 } }), 'POST /loopdeck/zelle': () => (++z === 1 ? projektOffen : { j: { ok: true } }), 'POST /live/oeffnen': { j: { ok: true } } } });
  assert.equal(await m.ladeInDeck(1, { loop: 'x' }), true);
  assert.deepEqual(urls(a), ['/loopdeck/laden', '/live/oeffnen', '/loopdeck/laden']);
  zk(1, 1, 1).dispatch('contextmenu'); await ruhe();
  dk(1).querySelector('[data-eintrag="leeren"]').click(); await ruhe();
  assert.deepEqual(urls(a).slice(3), ['/loopdeck/zelle', '/live/oeffnen', '/loopdeck/zelle']);
  assert.equal(frage.length, 2);
  const o = urls(a).length;   // a refusal that is not projekt_offen is not asked about
  const { a: b } = await start({ frage: () => { throw new Error('no question expected'); }, stand: { decks: { 1: deck(1), 2: deck(2) }, beat: 1, bpm: 120 }, extra: { 'POST /loopdeck/start': { code: 409, j: { ok: false, grund: 'zelle_leer' } } } });
  zk(1, 1, 1).click(); await ruhe();
  assert.deepEqual(urls(b), ['/loopdeck/start']); assert.ok(o > 0);
});

test('C1: app.js no longer binds [data-liveoeffnen] and its comment no longer claims the page opens the container by a click', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /data-liveoeffnen/);
  assert.doesNotMatch(app, /the only way the page opens the live container/);
});

// ---------- I1 ----------
async function menueBei(ankerTop, ankerLeft, menueHoehe, tiefe = 765, hoehe = 320) {
  const { m } = await start({ stand: { decks: { 1: deck(1), 2: deck(2) }, beat: 1, bpm: 120 } });
  const wurzel = dk(1), menue = wurzel.querySelector('.ld-zellmenue'), anker = zk(1, 1, 1);
  wurzel.getBoundingClientRect = () => ({ left: 0, top: 0, width: tiefe, height: hoehe, right: tiefe, bottom: hoehe });
  anker.getBoundingClientRect = () => ({ left: ankerLeft, top: ankerTop, width: 60, height: 20, right: ankerLeft + 60, bottom: ankerTop + 20 });
  menue.getBoundingClientRect = () => ({ left: 0, top: 0, width: 190, height: menueHoehe, right: 190, bottom: menueHoehe });
  anker.dispatch('contextmenu'); await ruhe();
  return { menue, m };
}
test('I1: the menu of row 1 opens below the cell, the menu of row 8 opens upwards; both lie inside the deck', async () => {
  const eins = await menueBei(60, 10, 190);
  assert.equal(parseInt(eins.menue.style.top, 10), 80);
  const acht = await menueBei(280, 10, 190);
  const top = parseInt(acht.menue.style.top, 10);
  assert.ok(top >= 0 && top + 190 <= 320, `top ${top}`);
  assert.equal(top, 90);
});
test('I1: left is limited to the deck width; a menu taller than the deck gets max-height and scrolls', async () => {
  const r = await menueBei(100, 700, 190);
  assert.ok(parseInt(r.menue.style.left, 10) + 190 <= 765, `left ${r.menue.style.left}`);
  const hoch = await menueBei(100, 10, 400);
  assert.ok(parseInt(hoch.menue.style.maxHeight, 10) <= 320 && parseInt(hoch.menue.style.maxHeight, 10) > 0, `max-height ${hoch.menue.style.maxHeight}`);
  assert.ok(parseInt(hoch.menue.style.top, 10) >= 0);
  assert.match(fs.readFileSync(new URL('../public/loopdeck/loopdeck.css', import.meta.url), 'utf8'), /\.ld-zellmenue \{[^}]*overflow-y: auto/);
});

// ---------- I2 / I3 ----------
test('I2: the stand event of the stream (reconnect) reads the loop deck stand again', async () => {
  const { a, m } = await start({ live: { live: true } });
  const vorher = a.anrufe.filter((c) => c.url === '/loopdeck/stand').length;
  m.loopdeckEreignis('stand', { regler: {}, decks: {}, geladen: {} }); await ruhe();
  assert.equal(a.anrufe.filter((c) => c.url === '/loopdeck/stand').length, vorher + 1);
});

test('I3: the export row reads the stand once when no loop place is shown, and the L1/L2 toggle then works', async () => {
  const sz = await import('../public/page_state.js');
  const a = installiere({ html: '<body><div id="meldung"></div><section class="deck" data-deck="1"><button data-nachdeck hidden>L1</button><button data-nachspur="1">1</button></section></body>',
    antworten: { 'GET /loopdeck/stand': () => ({ j: { decks: { 1: deck(1), 2: deck(2) }, beat: 1, bpm: 120 } }), 'POST /loopdeck/laden': { j: { ok: true, spur: 1, zelle: 2 } } } });
  const m = await import('../public/loopdeck/view.js'), la = await import('../public/live_view.js');
  m.zuruecksetzen(); sz.zustand.decks[1] = { status: 3, beats_bis_ende: null };
  la.zeigeExport(1); la.zeigeExport(1); await ruhe(); la.zeigeExport(1); await ruhe();
  assert.equal(a.anrufe.filter((c) => c.url === '/loopdeck/stand').length, 1);
  const wahl = document.querySelector('[data-nachdeck]');
  assert.equal(wahl.hidden, false);
  m.wechsleExportDeck(); await ruhe();
  assert.equal(m.exportZiel().deck, 2);
  assert.equal(wahl.textContent, 'LOOP 2');
});

// ---------- I4 ----------
test('I4: LOAD LOOP 1 / 2 of the LOOPS tab load into the loop deck, whether or not a loop place shows', async () => {
  if (!('cells' in El.prototype)) Object.defineProperty(El.prototype, 'cells', { get() { return this.elemente; }, configurable: true });   // the stand-in has no table cells
  const a = installiere({ html: '<body><div id="meldung"></div><table><tbody id="loopliste"></tbody></table></body>',
    antworten: { 'GET /loops': { j: [{ name: 'drums-a', beats: 8, quelle: 'q', erstellt: '2026-11-20' }] }, 'POST /loopdeck/laden': { j: { ok: true, spur: 2, zelle: 1 } }, 'GET /loopdeck/stand': { j: { decks: { 1: deck(1), 2: deck(2) }, beat: 1, bpm: 120 } } } });
  const r = await import('../public/loop_rec_view.js');
  await r.ladeLoops(); await ruhe();
  const knoepfe = document.querySelectorAll('#loopliste button.laden');
  assert.equal(knoepfe.length, 2);
  assert.ok(knoepfe.every((b) => !b.disabled), 'not tied to a loop place');
  knoepfe[1].click(); await ruhe();
  assert.deepEqual(posts(a)[0], { url: '/loopdeck/laden', methode: 'POST', koerper: { deck: 2, quelle: { loop: 'drums-a' } } });
});
test('I4: no page source calls /modul/loop any more', () => {
  const quelle = [...APP_DATEIEN, 'live_module.js', 'browse_table.js', 'module_after_seq.js'].map((n) => fs.readFileSync(new URL(`../public/${n}`, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(quelle, /\/modul\/loop\b/);
});

// ---------- smaller findings ----------
test('export: while the request runs all buttons of the deck are locked and a second click sends nothing', async () => {
  const ROW = '<button data-nachdeck hidden>L1</button><button data-nachspur="1">1</button><button data-nachspur="2">2</button>';
  const HTMLX = `<body><div id="meldung"></div><section class="deck" data-deck="1"><div data-muell></div><div data-sync></div><div data-pads></div><div data-loops></div><div data-ueber></div><div data-lauf></div><div data-gridwert></div><div data-gridfix></div><div data-gridset></div>${ROW}</section><section id="platz-loops"><div class="loopdeck" data-deck="1"></div></section></body>`;
  const sz = await import('../public/page_state.js'), g = await import('../public/deck_griffe.js');
  const { a, m, la } = await start({ html: HTMLX, stand: { decks: { 1: deck(1), 2: null }, beat: 1, bpm: 120 }, live: { live: true } });
  sz.deckAnsicht[1] = {}; g.bindeDeckBedienung(1, document.querySelector('.deck[data-deck="1"]'));
  sz.zustand.decks[1] = { status: 3, beats_bis_ende: null };
  la.zeigeExport(1);
  let frei; const tor = new Promise((ok) => { frei = ok; });
  const echt = globalThis.fetch;
  globalThis.fetch = async (u, o) => { if (u === '/loopdeck/laden') { await tor; } return echt(u, o); };
  a.antworten['POST /loopdeck/laden'] = { j: { ok: true, spur: 1, zelle: 2 } };
  const t1 = document.querySelector('[data-nachspur="1"]'), t2 = document.querySelector('[data-nachspur="2"]');
  t1.click(); await ruhe();
  assert.equal(t1.disabled, true); assert.equal(t2.disabled, true);
  la.zeigeExport(1);   // a redraw in the middle of the request does not release them
  assert.equal(t2.disabled, true);
  t2.click(); t1.click(); await ruhe();
  frei(); await ruhe();
  globalThis.fetch = echt;
  assert.equal(posts(a).filter((c) => c.url === '/loopdeck/laden').length, 1);
  assert.equal(t1.disabled, false); assert.ok(m);
});

test('mute and grid: a refusal puts the optimistic state back', async () => {
  const { a } = await start({ stand: { decks: { 1: deck(1), 2: null }, beat: 1, bpm: 120 }, live: { live: true },
    extra: { 'POST /loopdeck/spur': { code: 409, j: { ok: false, grund: 'x', text: 'no' } }, 'POST /loopdeck/raster': { code: 409, j: { ok: false, grund: 'x', text: 'no' } } } });
  const s = dk(1).querySelectorAll('.ld-spur')[0];
  s.querySelector('.ld-mute').click(); await ruhe();
  assert.ok(!s.querySelector('.ld-mute').classList.contains('an'));
  assert.equal(s.querySelector('.ld-mute').getAttribute('aria-pressed'), 'false');
  dk(1).querySelectorAll('.ld-r')[3].click(); await ruhe();
  assert.ok(!dk(1).querySelectorAll('.ld-r')[3].classList.contains('an'));
  assert.ok(dk(1).querySelector('.ld-r[data-raster="1"]').classList.contains('an'));
  assert.ok(a);
});

test('waveform: a failed /welle is not remembered as null; the next change of the playing cell asks again', async () => {
  let n = 0;
  const lauf = (zelleNr) => ({ ...lauf0(), zelle: zelleNr, ab_beat: 0 });
  const { a, m } = await start({ stand: { decks: { 1: deck(1), 2: null }, beat: 1, bpm: 120 }, live: { live: true },
    extra: { 'GET /welle': () => (++n === 1 ? { code: 500, j: {} } : { j: {} }) } });
  m.loopdeckEreignis('loopdeck', { deck: 1, spur: 1, lauf: lauf(1) }); await ruhe();
  m.loopdeckEreignis('loopdeck', { deck: 1, spur: 1, lauf: lauf(3) }); await ruhe();
  m.loopdeckEreignis('loopdeck', { deck: 1, spur: 1, lauf: lauf(1) }); await ruhe();
  // the cell thumbnails ask for the same sha too (session column component), so the count is not exactly 2; the failed first request is asked again
  assert.ok(a.anrufe.filter((c) => c.url === '/welle?sha=sha1').length >= 2);
});

test('clock: beat or bpm null from the stand set no clock (no play head from Number(null))', async () => {
  const stand = { decks: { 1: deck(1, { spur: (nr) => (nr === 1 ? { lauf: { ...lauf0(), zelle: 1, ab_beat: 0 } } : {}) }), 2: null }, beat: null, bpm: null };
  await start({ stand, live: { live: true } });
  assert.equal(dk(1).querySelectorAll('.kopf-ph')[0].hidden, true);
});

test('COLOR knob (strip row): a redraw during the drag does not reset it', async () => {
  const { m } = await start({ stand: () => ({ decks: { 1: deck(1), 2: null }, beat: 1, bpm: 120 }), live: { live: true } });   // the server still says filter 0
  const k = dk(1).querySelectorAll('.ld-spur')[0].querySelector('.ld-color .ld-mini');
  k.dispatch('pointerdown', { clientY: 150, pointerId: 1 }); k.dispatch('pointermove', { clientY: 0 });
  assert.equal(k.getAttribute('aria-valuenow'), '1.00');
  m.loopdeckEreignis('proj', {}); await ruhe();
  assert.equal(k.getAttribute('aria-valuenow'), '1.00');
  k.dispatch('pointerup');
});

test('scene column: it shares the row template of the tracks and has no fixed paddings', () => {
  const css = fs.readFileSync(new URL('../public/loopdeck/loopdeck.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.ld-szenen \{[^}]*padding-(top|bottom): \d+px/);
  assert.match(css, /\.ld-spur, \.ld-szenen \{[^}]*grid-template-rows: 14px 14px minmax\(0, 1fr\) 20px 26px/);
  assert.match(css, /\.ld-spur \.zellen, \.ld-szenenzeilen \{[^}]*grid-template-rows: repeat\(8, minmax\(22px, 1fr\)\)/);   // 14 px below 1500 px, see page_layout_1366.test.mjs
  assert.doesNotMatch(css, /\.ld-spur \.zelle \{[^}]*max-height/);
});

// ---------- missing tests ----------
test('a click on the playing cell stops its track (toggle, Andreas 2026-11-22; it used to send start again)', async () => {
  const stand = { decks: { 1: deck(1, { spur: (nr) => (nr === 1 ? { lauf: { ...lauf0(), zelle: 1, ab_beat: 0 } } : {}) }), 2: null }, beat: 1, bpm: 120 };
  const { a } = await start({ stand, live: { live: true } });
  assert.ok(zk(1, 1, 1).classList.contains('spielt'));
  zk(1, 1, 1).click(); await ruhe();
  assert.deepEqual(posts(a).at(-1), { url: '/loopdeck/stopp', methode: 'POST', koerper: { deck: 1, spur: 1 } });
});

test('deck 2: menu, stop, scene and stream events address deck 2', async () => {
  const { a, m } = await start({ stand: { decks: { 1: deck(1), 2: deck(2) }, beat: 1, bpm: 120 }, live: { live: true } });
  zk(2, 3, 1).dispatch('contextmenu'); await ruhe();
  dk(2).querySelector('[data-eintrag="leeren"]').click(); await ruhe();
  assert.deepEqual(posts(a).at(-1), { url: '/loopdeck/zelle', methode: 'POST', koerper: { deck: 2, spur: 3, zelle: 1, leeren: true } });
  dk(2).querySelectorAll('.ld-spur')[1].querySelector('.stopp').click(); await ruhe();
  assert.deepEqual(posts(a).at(-1).koerper, { deck: 2, spur: 2 });
  dk(2).querySelectorAll('.ld-szene')[2].click(); await ruhe();
  assert.deepEqual(posts(a).at(-1), { url: '/loopdeck/szene', methode: 'POST', koerper: { deck: 2, zeile: 3 } });
  m.loopdeckEreignis('loopdeck', { deck: 2, spur: 4, lauf: { ...lauf0(), zelle: 3, ab_beat: 0 } });
  assert.ok(zk(2, 4, 3).classList.contains('spielt'));
  assert.ok(!zk(1, 4, 3).classList.contains('spielt'));
});
