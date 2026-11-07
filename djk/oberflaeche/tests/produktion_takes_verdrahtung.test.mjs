// 1.14 Comping task 7, fix round 1: the three wirings no pure test pinned. Each test goes red when its wire is cut (mutations in the report).
// 1. ctx.zeilen (zeitachse_bedienung.js) and the lane binder (lanen_bedienung.js) build the row table WITH the take rows.
// 2. Arrangement draws the take rows: clips in the row, used regions in the track colour, the rest grey.
// 3. The speaker button sends through holeJson to /proj/take_vorhoeren; a refusal shows the English text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { zeilenTabelle, zeileBei, spurIndexBeiTabelle } from '../oeffentlich/produktion/layout.js';
import { takeZeilenVon } from '../oeffentlich/produktion/takes.js';
import { neueAnsicht } from '../oeffentlich/produktion/zeitachse.js';
import { fehlerText } from '../oeffentlich/produktion/produktion.js';
import { T3_SPUR, projektMit } from './helfer/take_fixtures.mjs';

const { installiere, El, attrappe } = await import('./helfer/seiten_attrappe.mjs');
const { bindeZeitachse } = await import('../oeffentlich/produktion/zeitachse_bedienung.js');
const { bindeLanen } = await import('../oeffentlich/produktion/lanen_bedienung.js');
const { bindeSpuren } = await import('../oeffentlich/produktion/spurkoepfe.js');
const { Arrangement } = await import('../oeffentlich/produktion/arrangement.js');

const geraden = (id, extra = {}) => ({
  id, nr: 1, name: id, art: 'audio', farbe: '#2fd6c3', clips: [], fader_db: 0, pan: 0, mute: false, solo: false, automation: [], ...extra,
});
// s1 holds the T3 takes (3 rows), s2 is a plain track below it
const projekt = () => projektMit([{ ...geraden('s1'), ...T3_SPUR, id: 's1' }, geraden('s2')]);

function umgebung() {
  installiere();
  const $ = (id) => document.querySelector(`#${id}`);
  const st = { projekt: projekt(), sichtbar: true };
  const ctx = { st, $, lies: (k, v) => v, merke() {}, beimProjekt: [], beimBild: [], beimEreignis: [], nachLaden: [], melde() {}, aendere() {} };
  return { st, ctx, $ };
}

test('T7 wiring: ctx.zeilen() carries the take rows, so a y below them finds the right row (zeitachse_bedienung.js)', () => {
  const { st, ctx } = umgebung();
  bindeZeitachse(ctx);
  st.laneOffen.add('s1');
  st.takeOffen.add('s1');
  const tab = ctx.zeilen();
  assert.deepEqual(tab.map((z) => z.art), ['spur', 'take', 'take', 'take', 'lane', 'spur']);
  assert.equal(zeileBei(tab, 190).art, 'lane', 'y 190 is the lane row only if the take rows are in the table');
  assert.equal(spurIndexBeiTabelle(tab, 250), 1, 'the next track starts below the lane row');
  assert.deepEqual(tab, zeilenTabelle(2, [0], takeZeilenVon(st)));
  // the page height follows (layoutNeu)
  ctx.layoutNeu();
  assert.equal(ctx.$('flaeche').style.height, `${64 + 3 * 40 + 48 + 64}px`);
  // negative control: T closed, the table is the one of today
  st.takeOffen.clear();
  assert.deepEqual(ctx.zeilen(), zeilenTabelle(2, [0]));
});

test('T7 wiring: the lane binder uses the same table: the lane row below the take rows is its own, a take row is not (lanen_bedienung.js)', () => {
  const { st, ctx, $ } = umgebung();
  bindeZeitachse(ctx);
  ctx.zug = { beginne() { throw new Error('no gesture without a lane'); } };
  bindeLanen(ctx);
  st.laneOffen.add('s1');
  st.takeOffen.add('s1');
  const flaeche = $('flaeche'), ueber = $('ueber');
  const klick = (y) => {
    let verschluckt = 0;
    flaeche.dispatch('pointerdown', { target: ueber, offsetX: 10, offsetY: y, button: 0, stopImmediatePropagation() { verschluckt++; } });
    return verschluckt;
  };
  assert.equal(klick(190), 1, 'y 190 is in the lane row (64 + 3 * 40 = 184 .. 232)');
  assert.equal(klick(100), 0, 'y 100 is a take row: not a lane');
  assert.equal(klick(30), 0, 'y 30 is the track row');
  assert.equal(klick(250), 0, 'y 250 is track 2');
});

// ---- 2. the canvas ----
function leinwand(w, h, aufruf) {
  const g = new Proxy({}, {
    get: (z, k) => (k in z ? z[k] : (...a) => {
      if (['fillRect', 'strokeRect', 'rect'].includes(k)) aufruf.push({ k, a, fill: z.fillStyle, stroke: z.strokeStyle });
    }),
    set: (z, k, v) => { z[k] = v; return true; },
  });
  const c = { width: 0, height: 0, getContext: () => g, getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0, right: w, bottom: h }) };
  return c;
}
function zeichne(takeZeilen) {
  const aufruf = [], ansicht = neueAnsicht(), p = projekt();
  const arr = new Arrangement({
    lineal: leinwand(800, 28, []), spuren: leinwand(800, 500, aufruf), ueber: leinwand(800, 500, []), wellen: { hole: () => ({}) },
  });
  arr.bild({ ansicht, projekt: p, loop: p.loop, kopfBeat: null, startBeat: 0, geist: null, takeZeilen });
  return { aufruf, px: ansicht.pxProBeat };
}
// the clip head bar (CLIP_KOPF, 14 px) carries the pure colour; the body has an alpha suffix
const inZeile = (aufruf, y, h = 14) => aufruf.filter((x) => x.k === 'fillRect' && x.a[1] === y && x.a[3] === h);

test('T7 wiring: Arrangement draws the take rows - clips in their row, used regions in the track colour, the rest grey (arrangement.js)', () => {
  const st = { projekt: projekt(), takeOffen: new Set(['s1']) };
  const { aufruf, px } = zeichne(takeZeilenVon(st));
  const farbe = '#e0563b', grau = '#8a8d98';   // T3_SPUR colour and the desaturated grey
  // rows: t1 y 65, t2 y 105, t3 y 145 (each clip box is 1 px inside a 40 px row at 64, 104, 144)
  const t1 = inZeile(aufruf, 65), t2 = inZeile(aufruf, 105), t3 = inZeile(aufruf, 145);
  assert.ok(t1.length > 0 && t2.length > 0 && t3.length > 0, 'every take row holds drawn clips');
  assert.ok(t1.every((x) => x.fill !== farbe), 'take 1 is unused: grey only');
  assert.ok(t1.some((x) => x.fill === grau));
  assert.ok(t2.some((x) => x.fill === grau) && t2.some((x) => x.fill === farbe), 'take 2: grey clip plus the used region in the track colour');
  assert.ok(t3.some((x) => x.fill === farbe));
  // the used regions are the clip regions of the highlight: take 2 [3,5) is 2 beats wide, take 3 has [0,3) and [5,8)
  const klammern = (y) => aufruf.filter((x) => x.k === 'rect' && x.a[1] === y).map((x) => x.a[2]);
  assert.deepEqual(klammern(104), [2 * px]);
  assert.deepEqual(klammern(144), [3 * px, 3 * px]);
  assert.deepEqual(klammern(64), [], 'nothing used in take 1');
  // the main lane is still drawn in its row (y 1)
  assert.ok(inZeile(aufruf, 1).length > 0);
});

test('T7 wiring: without take rows the canvas draws nothing below the track (negative control)', () => {
  const { aufruf } = zeichne(new Map());
  assert.equal(aufruf.filter((x) => x.k === 'fillRect' && x.a[1] >= 65 && x.a[1] < 128 && x.a[3] === 14).length, 0);
  assert.equal(aufruf.filter((x) => x.k === 'rect' && x.a[1] >= 64).length, 0, 'no clip regions without take rows');
});

// ---- 3. the speaker ----
function kopfUmgebung(antwort) {
  const { st, ctx, $ } = umgebung();
  const anrufe = [], meldungen = [];
  let geladen = 0;
  ctx.holeJson = async (url, body) => { anrufe.push([url, body]); return typeof antwort === 'function' ? antwort() : antwort; };
  ctx.melde = (t, fehler) => meldungen.push([t, fehler]);
  ctx.antwortText = fehlerText;
  ctx.ladeAktuell = async () => { geladen++; };
  ctx.layoutNeu = () => {};
  ctx.zug = { beginne() {} };
  st.laneOffen = new Set(); st.laneZiel = new Map(); st.takeOffen = new Set(['s1']); st.vorhoeren = {};
  for (const id of ['neu-audio', 'neu-rb', 'neu-surge', 'neu-kit', 'auto-touch', 'auto-latch', 'auto-write']) $(id);
  bindeSpuren(ctx);
  for (const h of ctx.beimProjekt) h(st.projekt, true);
  const behaelter = $('koepfe');
  const hoer = (t) => behaelter.querySelector(`.p-takekopf[data-take="${t}"] .p-takehoer`);
  return { st, anrufe, meldungen, hoer, geladen: () => geladen };
}

test('T7 wiring: the speaker posts {spur_id, take_id} to /proj/take_vorhoeren through holeJson, then reloads (spurkoepfe.js)', async () => {
  const { anrufe, hoer, geladen, meldungen } = kopfUmgebung({ status: 200, j: {} });
  hoer('t2').click();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(anrufe, [['/proj/take_vorhoeren', { spur_id: 's1', take_id: 't2' }]], 'holeJson is the POST path of the page');
  assert.equal(geladen(), 1, 'the state with `vorhoeren` is fetched');
  assert.deepEqual(meldungen, []);
});

test('T7 wiring: a 409 shows the English text, nothing is reloaded; two quick clicks send once (spurkoepfe.js)', async () => {
  const { anrufe, hoer, geladen, meldungen } = kopfUmgebung({ status: 409, j: { fehler: 'take_unbekannt' } });
  hoer('t2').click(); hoer('t2').click();
  await new Promise((r) => setImmediate(r));
  assert.equal(anrufe.length, 1, 'the button is locked until the answer is there');
  assert.deepEqual(meldungen, [['That take lane no longer exists', true]]);
  assert.equal(geladen(), 0);
  hoer('t2').click();
  await new Promise((r) => setImmediate(r));
  assert.equal(anrufe.length, 2, 'unlocked after the answer');
});

test('T7 heads: Enter and Escape give the focus back to the name', async () => {
  const { hoer } = kopfUmgebung({ status: 200, j: {} });
  const kopf = hoer('t1').parent, name = kopf.querySelector('.p-takename');
  for (const taste of ['Enter', 'Escape']) {
    name.dispatch('dblclick');
    const ein = kopf.querySelector('.p-takefeld');
    attrappe.aktiv = null;
    ein.dispatch('keydown', { key: taste });
    assert.equal(attrappe.aktiv, name, taste);
  }
});

void El;
