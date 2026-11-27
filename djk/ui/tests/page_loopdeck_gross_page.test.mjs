// The loop deck pop-up on the real app.js and index.html (DOM stand-in, fake fetch, fake event stream; no studio port). It carries what the SESSION
// view tests pinned for columns, strips, dock and cell drops, now through the pop-up, and pins that the SESSION view itself is gone.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, attrappe, sendeStrom } from './helpers/pages_mock.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const lies = (n) => fs.readFileSync(path.join(PUBLIC, n), 'utf8');
const html = lies('index.html'), css = lies('style.css');
let seitenrahmen, platz;

before(async () => {
  installiere({
    html, speicher: { 'djk-ansicht': 'studio' },
    antworten: { 'GET /bestand': { j: [] }, 'GET /loops': { j: [] }, 'GET /graphen': { j: { graphen: [] } }, 'GET /proj/kits': { j: { kits: [] } }, 'GET /proj/liste': { j: [] } },
  });
  await import('../public/app.js');
  seitenrahmen = await import('../public/seitenrahmen.js');
  platz = await import('../public/loopdeck/view.js');
  await new Promise((r) => setTimeout(r, 40));
});

// ---------- the SESSION view is gone ----------
test('no SESSION button, no #session section, no session/ansicht.css link', () => {
  assert.doesNotMatch(html, /data-ansicht="studio"/);
  assert.doesNotMatch(html, /id="session"/);
  assert.doesNotMatch(html, /session\/ansicht\.css/);
  assert.equal(attrappe.body.querySelector('[data-ansicht="studio"]'), null);
  assert.equal(attrappe.body.querySelector('#session'), null);
});

test('the views are dj, produktion, werkbank, tracker; the stored djk-ansicht studio fell back to dj', () => {
  assert.match(lies('seitenrahmen.js'), /const ANSICHTEN = \['dj', 'produktion', 'werkbank', 'tracker'\]/);
  assert.equal(attrappe.body.querySelector('[data-ansicht="dj"]').getAttribute('aria-pressed'), 'true');
});

test('the SESSION leftovers left the page code and the styles', () => {
  assert.equal(seitenrahmen.sessionAnsicht, undefined);
  assert.doesNotMatch(css, /body\.studio #pult/);
  assert.doesNotMatch(css, /> #session/);
  for (const f of ['session/ansicht.js', 'session/kopf.js', 'session/szenen.js', 'session/szenen_tab.js', 'session/strudel_tab.js', 'session/ansicht.css']) assert.equal(fs.existsSync(path.join(PUBLIC, f)), false, f);
});

test('the scene sequencer, the Strudel editors and the record head stay home: nothing moves them any more', () => {
  assert.doesNotMatch(lies('seitenrahmen.js'), /seq-szenen/);
  assert.doesNotMatch(lies('loopdeck/gross.js'), /seq-szenen|strudel-zeilen|appendChild\(\$\(|\.append\(\$\(/);
});

// ---------- the pop-up on the real app ----------
const tick = () => new Promise((r) => setTimeout(r, 5));
const lauf0 = () => ({ zelle: null, verwaist: false, ab_beat: 0, versatz_beats: 0, wartend: null, zuletzt: null });
const zelle = (n) => ({ id: `z${n}`, name: `cell ${n}`, farbe: n, art: 'loop', sha256: `sha${n}`, beats: 8, frames: 1000 });
const spalteV = (id, deck, spur, extra = {}) => ({ spur_id: id, kurz: `C${spur}`, name: `Loop ${deck}.${spur}`, art: 'audio', deck, spur,
  zellen: [zelle(1), zelle(2), zelle(3), null, null, null, null, null], lauf: lauf0(), ...extra });
const vier = (deck, pre) => [1, 2, 3, 4].map((n) => spalteV(`${pre}${n}`, deck, n));
const standV = (extra = {}) => ({ raster: '1', szenen: Array.from({ length: 8 }, () => ({})), beat: 17.5, bpm: 128,
  container: [{ buchstabe: 'A', typ: 'loops', name: 'Loop deck 1', spalten: vier(1, 'a') }, { buchstabe: 'B', typ: 'loops', name: 'Loop deck 2', spalten: vier(2, 'b') }], geparkt: [], ...extra });
const platzStand = () => ({ decks: { 1: { gruppe_id: 'g1', platz: 1, raster: '1', spuren: [] }, 2: { gruppe_id: 'g2', platz: 2, raster: '1', spuren: [] } }, beat: 17.5, bpm: 128 });
const setzeStand = (st, code = 200) => { attrappe.antworten['GET /session/stand'] = () => ({ code, j: st }); };
const stands = () => attrappe.anrufe.filter((c) => c.url === '/session/stand').length;
const posts = (url) => attrappe.anrufe.filter((c) => c.url === url && c.methode === 'POST');
const text = (e) => e.textContent;
const ruhe = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok)); };
const oeffneSession = async (st = standV(), nr = 1) => {
  for (const z of attrappe.body.querySelectorAll('.ldg-zu')) z.click();
  setzeStand(st);
  attrappe.antworten['GET /loopdeck/stand'] = () => ({ j: platzStand() });
  platz.zuruecksetzen(); platz.zeigeLoopdecks();
  await ruhe();
  attrappe.body.querySelector(`.loopdeck[data-deck="${nr}"] .ld-gross`).click();
  await ruhe(); await tick();
};
const session = () => attrappe.body.querySelector('.ldg-panel');
const host = (id) => session().querySelector(`.spalte-host[data-spur="${id}"]`);
const zug = (id) => host(id).querySelector('.zug-slot .zug');
const stoss = async () => {   // a proj event and the frame that runs the refetch
  const rafs = [], alt = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (f) => { rafs.push(f); return rafs.length; };
  try { sendeStrom('proj', {}); for (const f of rafs.splice(0)) f(0); await ruhe(); } finally { globalThis.requestAnimationFrame = alt; }
};
const spurPosts = () => posts('/loopdeck/spur');
const projektMit = async (spuren, rev = 7) => {
  const m = await import('../public/live_view.js');
  m.live.projekt = { rev, spuren }; m.live.rev = rev;
  return m;
};


test('V4 every column carries a lane strip: meter, long fader, knobs HI MID LOW and COLOR HALL DLY, keys M S, keys 1 2 3; no kill keys, no arm key', async () => {
  await oeffneSession();
  for (const id of ['a1', 'a4']) {
    const z = zug(id);
    assert.ok(z, `strip of ${id}`);
    assert.equal(z.querySelectorAll('.meter.senkrecht').length, 1);
    assert.equal(z.querySelectorAll('input.zug-fader').length, 1);
    assert.deepEqual(z.querySelectorAll('.zug-knopf').map((k) => k.getAttribute('aria-label')), ['HI EQ', 'MID EQ', 'LOW EQ', 'COLOR', 'HALL send', 'DELAY send']);
    assert.deepEqual(z.querySelectorAll('.zug-name').map(text), ['HI', 'MID', 'LOW', 'FILTER', 'HALL', 'DLY']);   // COLOR names the art of the main mixer (FILTER by default)
    assert.equal(z.querySelectorAll('[data-kill]').length, 0);
    assert.equal(z.querySelectorAll('.zug-r').length, 0);
    assert.equal(text(z.querySelector('.zug-m')), 'M'); assert.equal(text(z.querySelector('.zug-s')), 'S');
    assert.deepEqual(z.querySelectorAll('.zug-fx').map(text), ['1', '2', '3']);
    assert.deepEqual(z.querySelectorAll('.zug-fx').map((b) => b.dataset.einheit), ['1', '2', '3']);
  }
});

test('V4 each control sends its field and nothing else', async () => {
  await oeffneSession(undefined, 2); await ruhe();
  const z = zug('b2');   // deck 2, track 2
  const sende = async (f) => { const vor = spurPosts().length; f(); await ruhe(); assert.equal(spurPosts().length, vor + 1, 'exactly one request'); return spurPosts().at(-1).koerper; };
  const fader = z.querySelector('input.zug-fader');
  fader.value = '-12'; assert.deepEqual(await sende(() => fader.dispatch('input')), { deck: 2, spur: 2, fader_db: -12 });
  const [hi, mid, low, flt, hall, dly] = z.querySelectorAll('.zug-knopf');
  let k = await sende(() => { flt.dispatch('pointerdown', { clientY: 100, pointerId: 1 }); flt.dispatch('pointermove', { clientY: 70 }); flt.dispatch('pointerup'); });
  assert.deepEqual(Object.keys(k), ['deck', 'spur', 'filter']); assert.ok(k.filter > 0 && k.filter <= 1);
  assert.deepEqual(await sende(() => hall.dispatch('dblclick')), { deck: 2, spur: 2, send: { hall: -200 } });
  k = await sende(() => dly.dispatch('keydown', { key: 'ArrowUp' }));
  assert.deepEqual(Object.keys(k.send), ['delay']); assert.ok(k.send.delay > -200 && k.send.delay <= 0);
  k = await sende(() => mid.dispatch('keydown', { key: 'ArrowUp' }));
  assert.deepEqual(Object.keys(k), ['deck', 'spur', 'eq']); assert.deepEqual(Object.keys(k.eq), ['mitte']); assert.ok(k.eq.mitte > 0 && k.eq.mitte <= 6);
  assert.deepEqual(await sende(() => low.dispatch('dblclick')), { deck: 2, spur: 2, eq: { tief: 0 } });
  k = await sende(() => hi.dispatch('keydown', { key: 'ArrowDown' }));
  assert.deepEqual(Object.keys(k.eq), ['hoch']); assert.ok(k.eq.hoch < 0);
  assert.deepEqual(await sende(() => z.querySelector('.zug-fx[data-einheit="3"]').click()), { deck: 2, spur: 2, fx: { 3: true } });
  assert.ok(z.querySelector('.zug-fx[data-einheit="3"]').classList.contains('an'));
  assert.deepEqual(await sende(() => z.querySelector('.zug-m').click()), { deck: 2, spur: 2, mute: true });
  assert.ok(z.querySelector('.zug-m').classList.contains('an'));
});

test('V4 a refused write rolls the button back and shows the refusal', async () => {
  await oeffneSession(); await ruhe();
  const z = zug('a3');
  attrappe.antworten['POST /loopdeck/spur'] = { code: 400, j: { ok: false, grund: 'form', text: 'no way' } };
  try {
    z.querySelector('.zug-m').click(); await ruhe();
    assert.ok(!z.querySelector('.zug-m').classList.contains('an'), 'rolled back');
    assert.match(text(attrappe.body.querySelector('#meldung')), /no way/);
  } finally { attrappe.antworten['POST /loopdeck/spur'] = { j: { ok: true } }; }
});

const standMit = (spalte0) => { const st = standV(); Object.assign(st.container[0].spalten[0], spalte0); return st; };

test('V4 solo writes the project track through /proj/aendern (spur_aendern, one undo step)', async () => {
  const m = await projektMit([], 9);
  attrappe.antworten['POST /proj/aendern'] = { j: { ok: true, rev: 10, projekt: { live: true, rev: 10, spuren: [] } } };
  m.live.slug = 'live';   // the refetch after a write finds the project again (it must not look closed in between)
  attrappe.antworten['GET /proj/aktuell'] = () => ({ j: { slug: 'live', rev: m.live.rev ?? 9, projekt: { live: true, rev: m.live.rev ?? 9, spuren: [] } } });
  await oeffneSession(standMit({ nr: 3, solo: false, arm: false })); await ruhe();
  const z = zug('a1'), aendern = () => posts('/proj/aendern');
  const vor = aendern().length;
  z.querySelector('.zug-s').click(); await ruhe();
  assert.equal(aendern().length, vor + 1);
  assert.deepEqual(aendern().at(-1).koerper.befehle, [{ befehl: 'spur_aendern', spur_id: 'a1', solo: true }]);
  assert.equal(aendern().at(-1).koerper.rev, 9);
  assert.match(aendern().at(-1).koerper.label, /Solo/);
  z.querySelector('.zug-s').click();
  for (let i = 0; i < 50 && aendern().length < vor + 2; i++) await ruhe();   // the second write waits for the first one's answer
  assert.deepEqual(aendern().at(-1).koerper.befehle, [{ befehl: 'spur_aendern', spur_id: 'a1', solo: false }]);
  assert.match(aendern().at(-1).koerper.label, /Unsolo/);
  assert.equal(aendern().at(-1).koerper.rev, 10, 'the second write carries the revision the first one made (no stale rev)');
  assert.equal(spurPosts().filter((c) => 'solo' in c.koerper || 'arm' in c.koerper).length, 0, 'not through the loop deck route');
  m.live.projekt = null;
});

test('V4 solo shows the stand; the meter listens to spur/<nr> of the stand; a proj event does not turn them off', async () => {
  await projektMit([]);   // a stale live.projekt without the track: the strip must not read it
  await oeffneSession(standMit({ nr: 6, solo: true, arm: true })); await ruhe();
  const z = zug('a1');
  assert.ok(z.querySelector('.zug-s').classList.contains('an'));
  assert.equal(z.querySelector('.meter').dataset.kanal, 'spur/6');
  const { zeigePegel, zeigePegelJetzt } = await import('../public/deck_view.js');
  zeigePegel('spur/6', -30); zeigePegelJetzt(); assert.equal(z.querySelector('.meter i').style.height, '50%');
  assert.ok(!zug('a2').querySelector('.zug-s').classList.contains('an'));
  await stoss();
  assert.ok(z.querySelector('.zug-s').classList.contains('an'), 'still on after the refetch');
});

test('V4 level events are applied once per frame, the last value of each channel wins', async () => {
  await projektMit([]);
  await oeffneSession(standMit({ nr: 6, solo: true, arm: true })); await ruhe();
  const z = zug('a1');
  const { zeigePegel, zeigePegelJetzt } = await import('../public/deck_view.js');
  for (let i = 0; i < 200; i++) { zeigePegel('spur/6', -60 + (i % 50)); zeigePegel('spur/7', -10); }
  zeigePegel('spur/6', -15); zeigePegel('spur/7', -45);
  zeigePegelJetzt();
  assert.equal(z.querySelector('.meter i').style.height, '75%');
  zeigePegelJetzt();   // nothing pending: untouched
  assert.equal(z.querySelector('.meter i').style.height, '75%');
});

test('V4 a refused solo rolls the button back', async () => {
  await projektMit([], 9);
  attrappe.antworten['POST /proj/aendern'] = { code: 400, j: { ok: false, text: 'track is gone' } };
  try {
    await oeffneSession(standMit({ nr: 3, solo: false, arm: false })); await ruhe();
    const z = zug('a1');
    z.querySelector('.zug-s').click(); await ruhe();
    assert.ok(!z.querySelector('.zug-s').classList.contains('an'));
  } finally { attrappe.antworten['POST /proj/aendern'] = { j: { ok: true } }; }
});

test('V4 thirty fader inputs make at most two requests (one in flight, the latest value wins) and the last value arrives last', async () => {
  await oeffneSession(undefined, 2); await ruhe();
  const z = zug('b3'), fader = z.querySelector('input.zug-fader');
  const vor = spurPosts().length;
  for (let i = 1; i <= 30; i++) { fader.value = String(-i); fader.dispatch('input'); }
  await ruhe();
  const neu = spurPosts().slice(vor).map((c) => c.koerper.fader_db);
  assert.ok(neu.length <= 2, `requests: ${neu.length}`);
  assert.equal(neu.at(-1), -30, 'the latest value is the last one sent');
});

test('V4 a refused continuous control (fader, knob) goes back to the value the server last accepted', async () => {
  const st = standV(); st.container[0].spalten[2].fader_db = -6; st.container[0].spalten[2].send = { hall: -20, delay: -200 };
  await oeffneSession(st); await ruhe();
  const z = zug('a3'), fader = z.querySelector('input.zug-fader'), hall = z.querySelectorAll('.zug-knopf')[4];
  attrappe.antworten['POST /loopdeck/spur'] = { code: 400, j: { ok: false, grund: 'form', text: 'fader refused' } };
  try {
    fader.value = '-30'; fader.dispatch('input'); await ruhe();
    assert.equal(fader.value, '-6', 'fader back at the accepted value');
    assert.match(text(attrappe.body.querySelector('#meldung')), /fader refused/);
    hall.dispatch('dblclick'); await ruhe();
    assert.equal(hall.getAttribute('aria-valuenow'), '-20.00', 'knob back too');
  } finally { attrappe.antworten['POST /loopdeck/spur'] = { j: { ok: true } }; }
});

test('V4 values come from the stand; a knob in the hand or just turned does not jump back', async () => {
  await projektMit([]);
  const st = standV(); st.container[0].spalten[0].filter = 0.25; st.container[0].spalten[0].fader_db = -6; st.container[0].spalten[0].mute = true;
  st.container[0].spalten[0].kill = { tief: false, mitte: true, hoch: false }; st.container[0].spalten[0].eq = { tief: -3, mitte: 2, hoch: 1 };
  st.container[0].spalten[0].send = { hall: -20, delay: -200 }; st.container[0].spalten[0].fx = { 1: false, 2: true, 3: false };
  await oeffneSession(st); await ruhe();
  const z = zug('a1'), flt = z.querySelector('[data-art="filter"]');
  assert.equal(flt.getAttribute('aria-valuenow'), '0.25');
  assert.equal(z.querySelector('input.zug-fader').value, '-6');
  assert.ok(z.querySelector('.zug-m').classList.contains('an'));
  assert.equal(z.querySelector('[data-art="eq/mitte"]').getAttribute('aria-valuenow'), '-200.00', 'a killed band shows its knob fully left');
  assert.equal(z.querySelector('[data-art="eq/tief"]').getAttribute('aria-valuenow'), '-3.00'); assert.equal(z.querySelector('[data-art="eq/hoch"]').getAttribute('aria-valuenow'), '1.00');
  assert.equal(z.querySelector('[data-art="hall"]').getAttribute('aria-valuenow'), '-20.00');
  assert.deepEqual(z.querySelectorAll('.zug-fx').map((b) => b.classList.contains('an')), [false, true, false]);
  // in the hand: a stand with the old value arrives and the knob stays
  flt.dispatch('pointerdown', { clientY: 100, pointerId: 1 }); flt.dispatch('pointermove', { clientY: 60 });
  const inHand = flt.getAttribute('aria-valuenow'); assert.notEqual(inHand, '0.25');
  await stoss();
  assert.equal(flt.getAttribute('aria-valuenow'), inHand, 'not pulled back while held');
  flt.dispatch('pointerup'); await ruhe();
  // released and sent: the next stand carries the new value, the knob stays there
  const neu = Number(inHand);
  const st2 = standV(); st2.container[0].spalten[0].filter = neu; setzeStand(st2);
  await stoss();
  assert.equal(flt.getAttribute('aria-valuenow'), inHand);
  // and a stand with another value (another hand moved it) is shown once the write is confirmed
  const st3 = standV(); st3.container[0].spalten[0].filter = -0.5; setzeStand(st3);
  await stoss();
  assert.equal(flt.getAttribute('aria-valuenow'), '-0.50');
});

test('V4 the strip is 150 px high in the full variant and the compact variant (loop deck place) keeps its own row', () => {
  const a = lies('loopdeck/gross.css');
  assert.match(a, /\.spalte\[data-variante="voll"\] \.zug \{[^}]*height: 150px/);
  assert.doesNotMatch(lies('loopdeck/loopdeck.css'), /height: 150px/);
  assert.match(lies('session/strip.js'), /export function knopf\(/);
  assert.doesNotMatch(lies('loopdeck/view.js'), /function knopf\(/);
  assert.match(lies('loopdeck/view.js'), /import \{ knopf, EQ_OPT, SEND_OPT, EQ_BAENDER, FX_EINHEITEN \} from '\.\.\/session\/zug\.js'/);
});


test('V4 a band whose kill is on shows its knob fully left; turning it sends eq and kill off in one request; a refusal puts both back', async () => {
  const st = standV(); Object.assign(st.container[0].spalten[0], { eq: { tief: -3, mitte: 2, hoch: 1 }, kill: { tief: false, mitte: true, hoch: false } });
  await oeffneSession(st); await ruhe();
  const z = zug('a1'), mid = z.querySelector('[data-art="eq/mitte"]');
  assert.equal(mid.getAttribute('aria-valuenow'), '-200.00');
  const vor = spurPosts().length;
  mid.dispatch('keydown', { key: 'ArrowUp' }); await ruhe();
  assert.equal(spurPosts().length, vor + 1);
  const k = spurPosts().at(-1).koerper;
  assert.deepEqual(Object.keys(k), ['deck', 'spur', 'eq', 'kill']); assert.deepEqual(k.kill, { mitte: false }); assert.ok(k.eq.mitte > -200);
  // the accepted state now has the kill off: the next turn sends only eq
  mid.dispatch('keydown', { key: 'ArrowUp' }); await ruhe();
  assert.deepEqual(Object.keys(spurPosts().at(-1).koerper), ['deck', 'spur', 'eq']);
  // refused: back to fully left (kill on again)
  const st2 = standV(); Object.assign(st2.container[0].spalten[0], { eq: { tief: 0, mitte: 2, hoch: 0 }, kill: { tief: true, mitte: false, hoch: false } });
  setzeStand(st2); await stoss();
  const low = z.querySelector('[data-art="eq/tief"]');
  assert.equal(low.getAttribute('aria-valuenow'), '-200.00');
  attrappe.antworten['POST /loopdeck/spur'] = { code: 400, j: { ok: false, grund: 'form', text: 'eq refused' } };
  try {
    low.dispatch('keydown', { key: 'ArrowUp' }); await ruhe();
    assert.equal(low.getAttribute('aria-valuenow'), '-200.00', 'back at the killed (fully left) position');
  } finally { attrappe.antworten['POST /loopdeck/spur'] = { j: { ok: true } }; }
});

test('V4 the COLOR label of every lane names the art of the main mixer and follows color/art', async () => {
  await oeffneSession();
  const { zustand } = await import('../public/page_state.js');
  const { zeigeColor } = await import('../public/color_view.js');
  const namen = (id) => zug(id).querySelectorAll('.zug-name').map(text)[3];
  assert.equal(namen('a1'), 'FILTER');
  try {
    for (const [art, name] of [[1, 'SPACE'], [2, 'DUB ECHO'], [3, 'SWEEP'], [4, 'NOISE'], [5, 'CRUSH']]) {
      zustand.regler = { ...(zustand.regler ?? {}), 'color/art': art }; zeigeColor();
      for (const id of ['a1', 'a2', 'a3', 'a4']) assert.equal(namen(id), name, `${id} art ${art}`);
    }
  } finally { zustand.regler = { ...(zustand.regler ?? {}), 'color/art': 0 }; zeigeColor(); }
  assert.equal(namen('a1'), 'FILTER');
});

test('V4 keys 1 2 3 follow the stand (absent fx = all dark), a click toggles one unit, a refusal rolls it back', async () => {
  await oeffneSession(); await ruhe();
  const z = zug('a1'), an = () => z.querySelectorAll('.zug-fx').map((b) => b.classList.contains('an'));
  assert.deepEqual(an(), [false, false, false]);
  const st = standV(); st.container[0].spalten[0].fx = { 1: true, 2: false, 3: true }; setzeStand(st); await stoss();
  assert.deepEqual(an(), [true, false, true]);
  z.querySelector('.zug-fx[data-einheit="2"]').click(); await ruhe();
  assert.deepEqual(spurPosts().at(-1).koerper, { deck: 1, spur: 1, fx: { 2: true } });
  assert.deepEqual(an(), [true, true, true]);
  attrappe.antworten['POST /loopdeck/spur'] = { code: 400, j: { ok: false, grund: 'form', text: 'no way' } };
  try {
    z.querySelector('.zug-fx[data-einheit="1"]').click(); await ruhe();
    assert.deepEqual(an(), [true, true, true], 'rolled back to the accepted value');
  } finally { attrappe.antworten['POST /loopdeck/spur'] = { j: { ok: true } }; }
});

// ---------- V8: DEVICES, the TRACKS row (the dock host, session/dock_host.js) ----------
const devPane = () => attrappe.body.querySelector('#session-unten .pane-devices');
const devSpur = (id, nr, extra = {}) => ({ id, nr, name: `Loop ${nr}`, art: 'audio', farbe: '#3b8fe0', fader_db: 0, clips: [], zellen: [], filter: 0, eq: { tief: 0, mitte: 0, hoch: 0 }, ...extra });
const devProjekt = (extra = {}) => ({ live: true, name: 'live', rev: 11, gruppen: [], returns: [], master: { fader_db: 0, inserts: [] },
  spuren: [...'ab'].flatMap((d, i) => [1, 2, 3, 4].map((n) => devSpur(`${d}${n}`, i * 4 + n))), ...extra });
const mitDevProjekt = async (p = devProjekt()) => { const m = await import('../public/live_view.js'); m.live.projekt = p; m.live.rev = p.rev; m.zeichneLive(); await ruhe(); return m; };

test('V8 the DEVICES tab holds the dock: one TRACKS card per column of the grid, then EFFECTS with the MASTER card', async () => {
  await oeffneSession();
  const m = await mitDevProjekt();
  try {
    const d = devPane();
    const karten = d.querySelectorAll('[data-w="karte-spur"]');
    assert.deepEqual(karten.map((k) => k.getAttribute('data-spur-id')), ['a1', 'a2', 'a3', 'a4']);
    assert.deepEqual(karten.slice(0, 4).map((k) => k.querySelector('.w-buchstabe').textContent), ['C1', 'C2', 'C3', 'C4']);
    assert.deepEqual(d.querySelectorAll('.w-dock-etikett').map((e) => e.textContent), ['TRACKS', 'EFFECTS']);
    assert.ok(d.querySelector('[data-w="dock-fx"] [data-w="karte-master"]'), 'the MASTER card ends the EFFECTS row');
  } finally { m.live.projekt = null; }
});

test('V8 turning FILTER on a TRACKS card writes spur_aendern filter through the SESSION writer (one request) and the strip follows the stand', async () => {
  await oeffneSession();
  const m = await mitDevProjekt();
  try {
    const knopf = devPane().querySelectorAll('[data-w="karte-spur"]')[1].querySelectorAll('[data-w="karte-knopf"]').find((k) => k.getAttribute('data-param') === 'filter');
    assert.ok(knopf);
    const vorher = posts('/proj/aendern').length;
    knopf.dispatch('keydown', { key: 'ArrowUp' }); await ruhe();
    const neu = posts('/proj/aendern').slice(vorher);
    assert.equal(neu.length, 1);
    assert.deepEqual(neu[0].koerper.befehle, [{ befehl: 'spur_aendern', spur_id: 'a2', filter: 0.04 }]);
    const st = standV(); st.container[0].spalten[1].filter = 0.04; setzeStand(st); await stoss();
    assert.equal(zug('a2').querySelector('[data-art="filter"]').getAttribute('aria-valuenow'), '0.04', 'the strip of the grid shows it');
  } finally { m.live.projekt = null; }
});

// V9: selection both ways between the grid and the TRACKS cards
const spalteHost = (id) => attrappe.body.querySelectorAll('.ldg-spalten .spalte-host').find((h) => h.getAttribute('data-spur') === id);
test('V9 a click on a TRACKS card selects the column of the grid and reports it as fokus with the source session', async () => {
  await oeffneSession();
  const m = await mitDevProjekt();
  const { fokus } = await import('../public/controller_fokus.js');
  const orig = fokus.melde, gemeldet = [];
  fokus.melde = (sel, quelle) => { gemeldet.push([sel, quelle]); };
  try {
    const karte = devPane().querySelectorAll('[data-w="karte-spur"]')[1];
    karte.click(); await ruhe();
    assert.ok(spalteHost('a2'), 'the column host carries data-spur');
    assert.ok(spalteHost('a2').classList.contains('spalte-gewaehlt'), 'column C2 is marked in the grid');
    assert.ok(!spalteHost('a1').classList.contains('spalte-gewaehlt'));
    assert.ok(devPane().querySelectorAll('[data-w="karte-spur"]')[1].classList.contains('aktiv'), 'the card is highlighted');
    assert.deepEqual(gemeldet.at(-1), [{ spur_id: 'a2' }, 'session']);
  } finally { fokus.melde = orig; m.live.projekt = null; }
});

test('V9 a cell selection in the grid highlights the card of its column', async () => {
  await oeffneSession();
  const m = await mitDevProjekt();
  const { fokus } = await import('../public/controller_fokus.js');
  const orig = fokus.melde, gemeldet = [];
  fokus.melde = (sel, quelle) => { gemeldet.push([sel, quelle]); };
  try {
    const sp = session().querySelectorAll('.ldg-spalten .spalte');
    sp[2].querySelector('.zelle[data-zelle="2"]').click(); await ruhe();
    const aktiv = devPane().querySelectorAll('[data-w="karte-spur"]').filter((k) => k.classList.contains('aktiv')).map((k) => k.getAttribute('data-spur-id'));
    assert.deepEqual(aktiv, ['a3']);
    assert.ok(spalteHost('a3').classList.contains('spalte-gewaehlt'));
    assert.deepEqual(gemeldet.at(-1), [{ spur_id: 'a3' }, 'session']);
  } finally { fokus.melde = orig; m.live.projekt = null; }
});


// V10: load and move cells in SESSION
const transferV = (daten = {}) => { const d = { ...daten }; return { types: Object.keys(d), setData: (t, v) => { d[t] = v; }, getData: (t) => d[t] ?? '', effectAllowed: '', dropEffect: '' }; };
const TQ = 'application/x-djk-loopquelle', TZ = 'application/x-djk-loopzelle';
const zellEl = (id, n) => spalteHost(id).querySelector(`.zelle[data-zelle="${n}"]`);
const ablegenV = async (ziel, daten) => { ziel.dispatch('drop', { dataTransfer: transferV(daten) }); await ruhe(); };

test('V10 a library loop dropped on cell 5 of L2.3 posts /loopdeck/laden with deck, track, cell and the source, then reads the stand', async () => {
  await oeffneSession(undefined, 2);
  attrappe.antworten['POST /loopdeck/laden'] = { j: { ok: true, spur: 3, zelle: 5 } };
  const s0 = stands(), p0 = posts('/loopdeck/laden').length;
  await ablegenV(zellEl('b3', 5), { [TQ]: JSON.stringify({ loop: 'kick-1' }) });
  const neu = posts('/loopdeck/laden').slice(p0);
  assert.equal(neu.length, 1);
  assert.deepEqual(neu[0].koerper, { deck: 2, spur: 3, zelle: 5, quelle: { loop: 'kick-1' } });
  assert.ok(stands() > s0, 'the stand is read again');
});

test('V10 a cell dropped on a cell posts /loopdeck/bewegen; the same cell does nothing', async () => {
  await oeffneSession(undefined, 2);
  attrappe.antworten['POST /loopdeck/bewegen'] = { j: { ok: true } };
  const p0 = posts('/loopdeck/bewegen').length;
  await ablegenV(zellEl('b4', 6), { [TZ]: JSON.stringify({ deck: 1, spur: 2, zelle: 1 }) });
  assert.deepEqual(posts('/loopdeck/bewegen').slice(p0).map((c) => c.koerper), [{ von: { deck: 1, spur: 2, zelle: 1 }, nach: { deck: 2, spur: 4, zelle: 6 } }]);
  await ablegenV(zellEl('b2', 1), { [TZ]: JSON.stringify({ deck: 2, spur: 2, zelle: 1 }) });
  assert.equal(posts('/loopdeck/bewegen').length, p0 + 1, 'the same cell posts nothing');
});

test('V10 a filled cell is a drag source with deck, track and cell; an empty cell is not', async () => {
  await oeffneSession();
  assert.equal(zellEl('a2', 1).getAttribute('draggable'), 'true');
  assert.equal(zellEl('a2', 7).getAttribute('draggable'), 'false');
  const t = transferV();
  zellEl('a2', 1).dispatch('dragstart', { dataTransfer: t });
  assert.deepEqual(JSON.parse(t.getData(TZ)), { deck: 1, spur: 2, zelle: 1 });
});

test('V10 the library buttons keep the route /loopdeck/laden (→ L1 / → L2 of the module library and the → LOOP buttons of the browser table)', () => {
  const rd = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
  assert.match(rd('module_library.js'), /data-modul-laden="\$\{n\}"[^]*→ L\$\{n\}/);
  assert.match(rd('browse_table.js'), /import \{ ladeInDeck \} from '\.\/loopdeck\/ansicht\.js'/);
  assert.match(rd('browse_table.js'), /→ LOOP \$\{n\}/);
  assert.match(rd('loopdeck/view.js'), /export async function ladeInDeck[^]*?senden\('\/loopdeck\/laden'/);
  assert.doesNotMatch(rd('browse_table.js') + rd('module_library.js'), /session\/ansicht/);
});

test('fix round: the editor tabs write one request at a time, in order (no two session writes in flight)', async () => {
  await oeffneSession();
  attrappe.antworten['POST /session/huelle'] = { j: { ok: true } };
  const echt = globalThis.fetch; let imFlug = 0, hoechst = 0; const reihe = [];
  globalThis.fetch = async (url, opt = {}) => {
    const schreibt = opt.method === 'POST' && String(url).startsWith('/session/huelle');
    if (schreibt) { imFlug++; hoechst = Math.max(hoechst, imFlug); reihe.push(JSON.parse(opt.body).ziel); }
    try { if (schreibt) await new Promise((ok) => setTimeout(ok, 15)); return await echt(url, opt); } finally { if (schreibt) imFlug--; }
  };
  try {
    session().querySelectorAll('.ldg-spalten .spalte')[0].querySelector('.zelle[data-zelle="1"]').click(); await tick();
    const unten = attrappe.body.querySelector('#session-unten');
    unten.querySelector('[data-tab="ENVELOPES"]').click();
    unten.querySelector('.hl-ziel [data-wert="gain"]').click();
    unten.querySelector('.hl-ziel [data-wert="filter"]').click();
    await new Promise((ok) => setTimeout(ok, 120));
  } finally { globalThis.fetch = echt; }
  assert.deepEqual(reihe, ['gain', 'filter'], 'both were sent, in order');
  assert.equal(hoechst, 1, 'never two in flight');
});

// ---------- the controller view: the pop-up is what the APC20 session mode follows ----------
const ansichtPosts = () => posts('/controller/ansicht').map((c) => c.koerper.ansicht);
test('opening the pop-up reports studio, closing it reports the shown view again; a focus re-report while open stays studio', async () => {
  seitenrahmen.setzeAnsicht('dj', false); await ruhe();
  await oeffneSession();
  assert.equal(ansichtPosts().at(-1), 'studio', 'open: the APC20 grid launches cells');
  seitenrahmen.meldeAnsicht(undefined, true);   // what the focus event and the 20 s interval call
  assert.equal(ansichtPosts().at(-1), 'studio', 'a re-report keeps studio while the pop-up is open');
  attrappe.body.querySelector('.ldg-zu').click(); await ruhe();
  assert.equal(ansichtPosts().at(-1), 'dj', 'closed: the shown view');
  seitenrahmen.meldeAnsicht(undefined, true);
  assert.equal(ansichtPosts().at(-1), 'dj');
});

test('a window with an address (not the main window) reports nothing for the pop-up', async () => {
  seitenrahmen.setzeAnsicht('dj', false); await ruhe();
  globalThis.location.hash = '#remix';
  try {
    const vor = posts('/controller/ansicht').length;
    await oeffneSession();
    attrappe.body.querySelector('.ldg-zu').click(); await ruhe();
    assert.equal(posts('/controller/ansicht').length, vor);
  } finally { delete globalThis.location.hash; }
});

