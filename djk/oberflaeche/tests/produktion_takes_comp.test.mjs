// 1.14 Comping slice 1, task 8: the comp gesture on a take row (drag a range -> one comp_waehlen), the keys T and Esc, and the SSE update of the audition.
// Page tests on the DOM stand-in; the server does not exist here: holeJson and aendere are stubs that record what the page sends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fehlerText } from '../oeffentlich/produktion/produktion.js';
import { neuerSchreiber } from '../oeffentlich/produktion/schreiber.js';
import { T3_SPUR, projektMit } from './helfer/take_fixtures.mjs';

const { installiere } = await import('./helfer/seiten_attrappe.mjs');
const { bindeZeitachse } = await import('../oeffentlich/produktion/zeitachse_bedienung.js');
const { bindeSpuren } = await import('../oeffentlich/produktion/spurkoepfe.js');
const { oeffneMenue, schliesseMenue } = await import('../oeffentlich/produktion/kontextmenue.js');
const { bindeComp, CompGeste, COMP_TEXT } = await import('../oeffentlich/produktion/takes_bedienung.js');

const geraden = (id) => ({
  id, nr: 2, name: id, art: 'audio', farbe: '#2fd6c3', clips: [], fader_db: 0, pan: 0, mute: false, solo: false, automation: [],
});
// px per beat 24 (default view), beat0 0: beat b is at x = 24 b. Rows with s1 open: track 0..64, t1 64..104, t2 104..144, t3 144..184
const px = (b) => b * 24;
const Y_T2 = 120, Y_SPUR = 30;

function umgebung({ raster = 'beat', vorhoeren = {}, antwort = { status: 200, j: {} } } = {}) {
  installiere();
  const $ = (id) => document.querySelector(`#${id}`);
  const st = { projekt: projektMit([{ ...geraden('s1'), ...T3_SPUR, id: 's1' }, geraden('s2')]), sichtbar: true };
  const aenderungen = [], anrufe = [], meldungen = [], tasten = [];
  let geladen = 0;
  const ctx = {
    st, $, lies: (k, v) => v, merke() {}, beimProjekt: [], beimBild: [], beimEreignis: [], nachLaden: [], fehlerText, antwortText: fehlerText,
    melde: (t, f) => meldungen.push([t, f]), aendere: (label, befehle) => { aenderungen.push([label, befehle]); return Promise.resolve(true); },
    holeJson: async (url, body) => { anrufe.push([url, body]); return typeof antwort === 'function' ? antwort(body) : antwort; },
    ladeAktuell: async () => { geladen++; }, zug: { beginne() {} },
  };
  bindeZeitachse(ctx);
  st.raster = raster; st.takeOffen.add('s1'); st.vorhoeren = vorhoeren;
  const alt = document.addEventListener, altFenster = globalThis.addEventListener;
  const fensterTasten = [];
  globalThis.addEventListener = (art, f) => { if (art === 'keydown') fensterTasten.push(f); };
  document.addEventListener = (art, f) => { if (art === 'keydown') tasten.push(f); };
  bindeComp(ctx);
  document.addEventListener = alt; globalThis.addEventListener = altFenster;
  const flaeche = $('flaeche'), ueber = $('ueber');
  let verschluckt = 0;
  const unten = (x, y, extra = {}) => flaeche.dispatch('pointerdown', {
    target: ueber, offsetX: x, offsetY: y, button: 0, pointerId: 1, stopImmediatePropagation() { verschluckt++; }, ...extra,
  });
  const bewege = (x, y) => ueber.dispatch('pointermove', { offsetX: x, offsetY: y });
  const oben = (x, y) => ueber.dispatch('pointerup', { offsetX: x, offsetY: y });
  const taste = (key, extra = {}) => {
    const e = { key, repeat: false, target: { tagName: 'BODY' }, preventDefault() {}, ...extra };
    for (const f of tasten) f(e);
    return e;
  };
  return { fensterTasten, st, ctx, $, aenderungen, anrufe, meldungen, ueber,
    unten, bewege, oben, taste, geladen: () => geladen, verschluckt: () => verschluckt };
}
const ziehe = (u, von, bis, y = Y_T2) => { u.unten(px(von), y); u.bewege(px((von + bis) / 2), y); u.bewege(px(bis), y); u.oben(px(bis), y); };
const warte = () => new Promise((r) => setImmediate(r));
const BEFEHL = (von, bis, take = 't2') => ({ befehl: 'comp_waehlen', spur_id: 's1', take_id: take, von_beat: von, bis_beat: bis });

test('T8 gesture: a drag from beat 3.1 to 4.9 on take row t2 with grid 1/4 sends ONE comp_waehlen 3 to 5, label "Comp take"', () => {
  const u = umgebung();
  ziehe(u, 3.1, 4.9);
  assert.deepEqual(u.aenderungen, [['Comp take', [BEFEHL(3, 5)]]]);
  assert.equal(COMP_TEXT.label, 'Comp take');
  assert.equal(u.verschluckt(), 1, 'the take row consumed the pointer (no clip handling below it)');
});

test('T8 gesture: nothing is sent while the pointer moves, a draft is shown, and the grid decides the edges', () => {
  const u = umgebung();
  u.unten(px(3.1), Y_T2); u.bewege(px(4.9), Y_T2);
  assert.deepEqual(u.aenderungen, [], 'only the release sends');
  u.oben(px(4.9), Y_T2);
  assert.equal(u.aenderungen.length, 1);
  for (const [raster, von, bis] of [['sechzehntel', 3, 5], ['achtel', 3, 5], ['aus', 3.1, 4.9]]) {
    const v = umgebung({ raster });
    ziehe(v, 3.1, 4.9);
    assert.deepEqual(v.aenderungen[0][1][0], BEFEHL(von, bis), raster);
  }
  const takt = umgebung({ raster: 'takt' });
  ziehe(takt, 1.5, 9.6);
  assert.deepEqual(takt.aenderungen[0][1][0], BEFEHL(0, 8), 'BAR grid: 1.5 -> 0, 9.6 -> 8');
});

test('T8 gesture: a drag to the left is the same range; a start left of beat 0 is clamped to 0', () => {
  const u = umgebung();
  ziehe(u, 4.9, 3.1);
  assert.deepEqual(u.aenderungen[0][1][0], BEFEHL(3, 5));
  const v = umgebung();
  v.unten(px(2.2), Y_T2); v.bewege(px(0.3), Y_T2); v.bewege(-40, Y_T2); v.oben(-40, Y_T2);
  assert.deepEqual(v.aenderungen[0][1][0], BEFEHL(0, 2), '-40 px is beat -1.67: clamped');
});

test('T8 gesture: a click without movement and a twitch below the threshold send nothing', () => {
  const u = umgebung();
  u.unten(px(3.1), Y_T2); u.oben(px(3.1), Y_T2);
  u.unten(px(3.1), Y_T2); u.bewege(px(3.1) + 2, Y_T2); u.oben(px(3.1) + 2, Y_T2);
  assert.deepEqual(u.aenderungen, []);
  assert.deepEqual(u.meldungen, []);
});

test('T8 gesture: a range that snaps to nothing sends nothing and shows the English comp_leer text', () => {
  const u = umgebung({ raster: 'takt' });
  ziehe(u, 4.5, 5.9);   // BAR grid: 4.5 -> 4, 5.9 -> 4
  assert.deepEqual(u.aenderungen, []);
  assert.deepEqual(u.meldungen, [['The range is empty or outside the take lane: drag over a part of the take lane', true]]);
});

test('T8 gesture: Esc during the drag cancels it; the release afterwards sends nothing', () => {
  const u = umgebung({ vorhoeren: { s1: 't2' } });
  u.unten(px(3.1), Y_T2); u.bewege(px(4.9), Y_T2);
  u.taste('Escape');
  u.oben(px(4.9), Y_T2);
  assert.deepEqual(u.aenderungen, []);
  assert.deepEqual(u.anrufe, [], 'the Esc went to the drag only: the audition stays');
});

test('T8 gesture: a drag on a track row or a lane row is not ours (negative control); the drag on a take row is, on every take', () => {
  const u = umgebung();
  u.st.laneOffen.add('s1');
  ziehe(u, 3.1, 4.9, Y_SPUR);
  ziehe(u, 3.1, 4.9, 200);   // the automation row, below the three take rows (184..232)
  ziehe(u, 3.1, 4.9, 300);
  assert.deepEqual(u.aenderungen, []);
  assert.equal(u.verschluckt(), 0, 'the pointer went on to the clip and lane handling');
  const r = umgebung();
  ziehe(r, 3.1, 4.9, 80);
  ziehe(r, 3.1, 4.9, 160);
  assert.deepEqual(r.aenderungen.map((a) => a[1][0].take_id), ['t1', 't3']);
});

test('T8 gesture: no project, a right button or a foreign target is ignored', () => {
  const u = umgebung();
  u.unten(px(3), Y_T2, { button: 2 }); u.bewege(px(5), Y_T2); u.oben(px(5), Y_T2);
  u.unten(px(3), Y_T2, { target: {} }); u.bewege(px(5), Y_T2); u.oben(px(5), Y_T2);
  u.st.projekt = null;
  ziehe(u, 3, 5);
  assert.deepEqual(u.aenderungen, []);
});

test('T8 gesture: the pure gesture object has no side effect (CompGeste)', () => {
  const g = new CompGeste({ xZuBeat: (x) => x / 24, raster: 1 });
  assert.equal(g.down(px(3.1)), true);
  assert.equal(g.move(px(3.1) + 1), null, 'below the threshold');
  assert.deepEqual(g.move(px(4.9)), { von: 3, bis: 5 }, 'the draft is already snapped');
  assert.deepEqual(g.up(px(4.9)), { von: 3, bis: 5 });
});

test('T8 gesture: through the real writer the release is ONE POST /proj/aendern with the label and the command', async () => {
  const u = umgebung();
  const posts = [];
  const s = neuerSchreiber({
    holeJson: async (weg, k) => { posts.push([weg, k]); return { status: 200, j: { rev: 2, projekt: { rev: 2 } } }; },
    beiProjekt() {}, beiFehler() {},
  });
  s.setze('a', 1);
  u.ctx.aendere = (l, b) => s.aendere(l, b);
  ziehe(u, 3.1, 4.9);
  await warte();
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0], ['/proj/aendern', { rev: 1, label: 'Comp take', befehle: [BEFEHL(3, 5)] }]);
});

test('T8 reasons: comp_leer from the server shows an English text; the reasons the gesture meets are all texts, not "Rejected"', () => {
  assert.equal(fehlerText({ status: 409, j: { fehler: 'ersetzen_loop' } }),
    'A looped clip is in the way; split or move it first (a recorded take is kept as a file)');
  for (const code of ['comp_leer', 'take_unbekannt', 'ersetzen_loop', 'aufnahme_laeuft', 'kein_projekt']) {
    const t = fehlerText({ status: 409, j: { fehler: code } });
    assert.doesNotMatch(t, /^Rejected/, code);
    assert.doesNotMatch(t, /[äöüÄÖÜß]/, code);
  }
  assert.equal(fehlerText({ status: 409, j: { fehler: 'comp_leer' } }), 'The range is empty or outside the take lane: drag over a part of the take lane');
  assert.match(fehlerText({ status: 409, j: { fehler: 'unbekannter_grund_x' } }), /^Rejected/, 'negative control: an unknown reason still shows Rejected');
});

// ---- keys ----
test('T8 key T: toggles the audition of the take row under the pointer (one POST; on again turns it off)', async () => {
  const u = umgebung();
  u.ueber.dispatch('pointermove', { offsetX: 200, offsetY: Y_T2 });
  u.taste('t');
  await warte();
  assert.deepEqual(u.anrufe, [['/proj/take_vorhoeren', { spur_id: 's1', take_id: 't2' }]]);
  assert.equal(u.geladen(), 1, 'the state with the new map is fetched');
  u.st.vorhoeren = { s1: 't2' };
  u.taste('T');
  await warte();
  assert.deepEqual(u.anrufe.at(-1), ['/proj/take_vorhoeren', { spur_id: 's1', take_id: null }], 'toggle off');
  u.ueber.dispatch('pointermove', { offsetX: 200, offsetY: 160 });
  u.taste('t');
  await warte();
  assert.deepEqual(u.anrufe.at(-1), ['/proj/take_vorhoeren', { spur_id: 's1', take_id: 't3' }], 'another take row switches to that take');
});

test('T8 key T: not on a track row, outside the canvas, with a modifier, held down, in a text field, or on a hidden page (negative controls)', async () => {
  const u = umgebung();
  u.ueber.dispatch('pointermove', { offsetX: 200, offsetY: Y_SPUR });
  u.taste('t');
  u.ueber.dispatch('pointermove', { offsetX: 200, offsetY: Y_T2 });
  u.taste('t', { ctrlKey: true }); u.taste('t', { metaKey: true }); u.taste('t', { altKey: true });
  u.taste('t', { repeat: true });
  u.taste('t', { target: { tagName: 'INPUT', type: 'text' } });
  u.st.sichtbar = false; u.taste('t'); u.st.sichtbar = true;
  u.ueber.dispatch('pointerleave', {});
  u.taste('t');
  u.ueber.dispatch('pointermove', { offsetX: 200, offsetY: Y_T2 });
  u.st.takeOffen.clear();
  u.taste('t');   // the take rows are closed: y 120 is the next track now
  await warte();
  assert.deepEqual(u.anrufe, []);
  u.st.takeOffen.add('s1');
  u.taste('t');   // control: the same state with the rows open does send
  await warte();
  assert.equal(u.anrufe.length, 1);
});

test('T8 key T: a refusal shows the English text and loads nothing', async () => {
  const u = umgebung({ antwort: { status: 409, j: { fehler: 'take_unbekannt' } } });
  u.ueber.dispatch('pointermove', { offsetX: 200, offsetY: Y_T2 });
  u.taste('t');
  await warte();
  assert.deepEqual(u.meldungen, [['That take lane no longer exists', true]]);
  assert.equal(u.geladen(), 0);
});

test('T8 key Esc: ends the audition of every track (one POST each with null), then one reload', async () => {
  const u = umgebung({ vorhoeren: { s1: 't2', s2: 't1' } });
  const e = u.taste('Escape');
  await warte();
  assert.deepEqual(u.anrufe, [['/proj/take_vorhoeren', { spur_id: 's1', take_id: null }], ['/proj/take_vorhoeren', { spur_id: 's2', take_id: null }]]);
  assert.equal(u.geladen(), 1);
  assert.equal(e.defaultPrevented, undefined);
});

test('T8 key Esc: with nothing lit, in a text field or on a hidden page it sends nothing (negative controls)', async () => {
  const u = umgebung({ vorhoeren: {} });
  u.taste('Escape');
  u.st.vorhoeren = { s1: 't2' };
  u.taste('Escape', { target: { tagName: 'INPUT', type: 'text' } });
  u.st.sichtbar = false; u.taste('Escape'); u.st.sichtbar = true;
  await warte();
  assert.deepEqual(u.anrufe, []);
  u.taste('Escape');   // control: lit and visible
  await warte();
  assert.equal(u.anrufe.length, 1);
});

// ---- SSE ----
test('T8 SSE: take_vorhoeren updates the speaker states without a reload, also for a change made by Cypher\'s hand', () => {
  installiere();
  const $ = (id) => document.querySelector(`#${id}`);
  const st = { projekt: projektMit([{ ...geraden('s1'), ...T3_SPUR, id: 's1' }, geraden('s2')]), sichtbar: true };
  let geladen = 0;
  const ctx = {
    st, $, lies: (k, v) => v, merke() {}, beimProjekt: [], beimBild: [], beimEreignis: [], nachLaden: [],
    melde() {}, aendere() {}, fehlerText, antwortText: fehlerText,
  };
  ctx.holeJson = async () => ({ status: 200, j: {} });
  ctx.ladeAktuell = async () => { geladen++; };
  ctx.layoutNeu = () => {}; ctx.zug = { beginne() {} };
  st.laneOffen = new Set(); st.laneZiel = new Map(); st.takeOffen = new Set(['s1']); st.vorhoeren = {};
  for (const id of ['neu-audio', 'neu-rb', 'neu-surge', 'neu-kit', 'auto-touch', 'auto-latch', 'auto-write']) $(id);
  bindeSpuren(ctx);
  for (const h of ctx.beimProjekt) h(st.projekt, true);
  const kopf = (t) => $('koepfe').querySelector(`.p-takekopf[data-take="${t}"]`);
  const an = (t) => kopf(t).querySelector('.p-takehoer').getAttribute('aria-pressed');
  const sende = (a, f) => { for (const h of ctx.beimEreignis) h(a, f); };
  assert.deepEqual(['t1', 't2', 't3'].map(an), ['false', 'false', 'false']);
  sende('take_vorhoeren', { vorhoeren: { s1: 't2' } });
  assert.deepEqual(['t1', 't2', 't3'].map(an), ['false', 'true', 'false'], 't2 lights');
  assert.equal(kopf('t2').classList.contains('an'), true);
  assert.deepEqual(st.vorhoeren, { s1: 't2' });
  sende('take_vorhoeren', { vorhoeren: { s1: 't3' } });
  assert.deepEqual(['t1', 't2', 't3'].map(an), ['false', 'false', 'true'], 'the light moves');
  sende('take_vorhoeren', { vorhoeren: {} });
  assert.deepEqual(['t1', 't2', 't3'].map(an), ['false', 'false', 'false'], 'all off');
  // negative controls: another event and a broken body change nothing
  sende('take_vorhoeren', { vorhoeren: { s1: 't1' } });
  sende('proj', { vorhoeren: { s1: 't2' } });
  sende('take_vorhoeren', null);
  sende('take_vorhoeren', { vorhoeren: 'x' });
  assert.deepEqual(['t1', 't2', 't3'].map(an), ['true', 'false', 'false']);
  assert.equal(geladen, 0, 'no reload for any of it');
});

test('T8 key Esc: with a context menu open the Esc closes only the menu and ends no audition; afterwards it does (negative control)', async () => {
  const u = umgebung({ vorhoeren: { s1: 't2' } });
  oeffneMenue([{ text: 'x', aktion() {} }], 0, 0);
  const esc = { key: 'Escape', repeat: false, target: { tagName: 'BODY' }, preventDefault() {} };
  for (const f of u.fensterTasten) f(esc);     // window capture: our listener asks first, then the menu closes itself
  schliesseMenue();
  u.taste('Escape');
  await warte();
  assert.deepEqual(u.anrufe, [], 'the first Esc belonged to the menu');
  for (const f of u.fensterTasten) f(esc);     // no menu any more
  u.taste('Escape');
  await warte();
  assert.equal(u.anrufe.length, 1, 'the next Esc ends the audition');
});

test('T8 gesture: the start edge is a beat, not a pixel: FOLLOW or a zoom during the drag does not move it', () => {
  const u = umgebung();
  u.unten(px(3.1), Y_T2);
  u.st.ansicht = { ...u.st.ansicht, beat0: 8 };   // the view scrolls by 8 beats while the button is down
  u.bewege(px(4.9), Y_T2);
  u.oben(px(4.9), Y_T2);                          // x = 4.9 beats of the NEW view = beat 12.9
  assert.deepEqual(u.aenderungen[0][1][0], BEFEHL(3, 13));
  const v = umgebung();                           // zoom: the pixel of the press means another beat afterwards
  v.unten(px(3.1), Y_T2);
  v.st.ansicht = { beat0: 0, pxProBeat: 48 };
  v.oben(px(3.1) * 2 + 96, Y_T2);                 // 2 beats right of the press at 48 px/beat -> beat 5.1
  assert.deepEqual(v.aenderungen[0][1][0], BEFEHL(3, 5));
});

test('T8 gesture: losing the pointer capture cancels the drag like pointercancel', () => {
  const u = umgebung();
  u.unten(px(3.1), Y_T2); u.bewege(px(4.9), Y_T2);
  u.ueber.dispatch('lostpointercapture', {});
  u.oben(px(4.9), Y_T2);
  assert.deepEqual(u.aenderungen, []);
});

test('T8 key T: Shift+T sends nothing; Ctrl+Esc ends no audition (negative controls)', async () => {
  const u = umgebung({ vorhoeren: { s1: 't2' } });
  u.ueber.dispatch('pointermove', { offsetX: 200, offsetY: Y_T2 });
  u.taste('T', { shiftKey: true });
  u.taste('Escape', { ctrlKey: true });
  u.taste('Escape', { metaKey: true });
  await warte();
  assert.deepEqual(u.anrufe, []);
  u.taste('t');                                   // control: the plain key sends
  await warte();
  assert.equal(u.anrufe.length, 1);
});
