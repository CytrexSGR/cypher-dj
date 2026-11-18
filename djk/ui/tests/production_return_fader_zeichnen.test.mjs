// Return fader lane, T2 (pins): the fader lane of a return is drawn and edited exactly like the fader lane of a track. The page code keys on the target
// ("fader"), never on the kind of strip; these tests pin that for the arrangement painter (fake 2D context) and the lane wiring (point drag, delete, lock).
import test from 'node:test';
import assert from 'node:assert/strict';
import { neueAnsicht } from '../public/production/timeline.js';
import { zeilenFuer } from '../public/production/layout.js';
import { wertZuY, yZuWert, LANE_HOEHE, UEBER_FARBE } from '../public/production/lanes.js';
import { sperreUmschalten } from '../public/production/track_heads.js';

const { installiere, El } = await import('./helpers/pages_mock.mjs');
const { bindeLanen } = await import('../public/production/lanes_operation.js');
const { zeilenTabelle } = await import('../public/production/layout.js');
const { entwurf } = await import('../public/production/draft.js');

const PUNKTE = () => [{ beat: 0, wert: -60 }, { beat: 4, wert: -12, form: 's' }, { beat: 8, wert: 0 }, { beat: 12, wert: 6 }];
const projekt = () => ({
  tempo_bpm: 120, taktart: [4, 4], loop: { an: false, von_beat: 0, bis_beat: 8 },
  spuren: [{ id: 's1', farbe: '#2fd6c3', clips: [], automation: [{ id: 'a2', ziel: 'fader', punkte: PUNKTE() }] }],
  returns: [{ id: 'r1', name: 'R1', farbe: '#d62f9b', inserts: [], fader_db: -6, automation: [{ id: 'a1', ziel: 'fader', punkte: PUNKTE() }] }],
  master: { fader_db: 0, inserts: [], automation: [] },
});

// ---- the painter ----
function kontext(log) {
  const z = {};
  return new Proxy(z, { get: (o, k) => (k in o ? o[k] : (...a) => { log.push({ k, fill: o.fillStyle, stroke: o.strokeStyle, a }); }), set: (o, k, v) => { o[k] = v; return true; } });
}
const leinwand = (w, h, log) => ({ width: w, height: h, getContext: () => kontext(log), getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0, right: w, bottom: h }) });
globalThis.ResizeObserver = class { observe() {} disconnect() {} };

async function gemalt(p) {
  const { Arrangement } = await import('../public/production/arrangement.js');
  const log = [];
  const arr = new Arrangement({ lineal: leinwand(800, 28, []), spuren: leinwand(800, 600, log), ueber: leinwand(800, 600, []), wellen: { hole: () => ({}) } });
  arr.bild({ ansicht: neueAnsicht(), projekt: p, loop: p.loop, kopfBeat: null, startBeat: 0, geist: null, lanen: [0], straenge: new Set(['r1']) });
  return { log, tab: zeilenFuer(p, [0], new Map(), new Set(['r1'])) };
}
const imBand = (z) => (c) => c.a[1] >= z.y && c.a[1] <= z.y + z.h;

test('return_fader_lane_gleich_gezeichnet_wie_spur: points, scale and mid line are the same as on a track fader lane, in the colour of the return', async () => {
  const p = projekt();
  const { log, tab } = await gemalt(p);
  const zs = tab.find((z) => z.art === 'lane' && z.spur === 0), zr = tab.find((z) => z.art === 'lane' && z.strang === 'r1');
  assert.ok(zs && zr, 'a lane row for the track and for the return');
  const punkte = (z) => log.filter((c) => c.k === 'arc' && imBand(z)(c));
  const as = punkte(zs), ar = punkte(zr);
  assert.equal(as.length, 4); assert.equal(ar.length, 4);
  p.returns[0].automation[0].punkte.forEach((q, i) => {
    assert.ok(Math.abs(ar[i].a[1] - wertZuY({ y: zr.y, h: zr.h }, q.wert, 'fader')) < 1e-9, `point ${i} of the return sits at the fader scale of its row`);
    assert.ok(Math.abs((ar[i].a[1] - zr.y) - (as[i].a[1] - zs.y)) < 1e-9, `point ${i}: same offset in its row as on the track`);
    assert.equal(ar[i].a[0], as[i].a[0], `point ${i}: same x`);
  });
  const mitte = (z) => Math.round(wertZuY(z, 0, 'fader')) + 0.5;
  const linien = (z) => log.filter((c) => c.k === 'moveTo' && c.a[1] === mitte(z) && c.a[0] === 0);
  assert.equal(linien(zr).length, 1, 'the 0 dB line is drawn once in the return row');
  assert.equal(linien(zs).length, 1);
  assert.equal(ar[0].fill, '#d62f9b', 'the colour of the return');
  assert.notEqual(ar[0].fill, UEBER_FARBE, 'never the override orange');
});

// ---- the wiring ----
function seite(id) {   // id 'r1': a return lane row {art:'lane', strang:'r1'}; id 's1': the track lane row
  installiere();
  const p = projekt();
  const els = { flaeche: new El('div'), ueber: new El('canvas') };
  els.ueber.setPointerCapture = () => {};
  els.ueber.getContext = () => new Proxy({}, { get: () => () => {}, set: () => true });
  const alt = document.addEventListener;
  document.addEventListener = () => {};
  const tabelle = id === 's1' ? [...zeilenTabelle(1, [0])] : [{ art: 'kopf', id: 'r1', y: 0, h: 28 }, { art: 'lane', strang: 'r1', y: 28, h: LANE_HOEHE }];
  const lane = tabelle.find((z) => z.art === 'lane');
  const befehle = [], entwuerfe = [], bilder = [];
  let gelassen = 0;
  const st = { projekt: p, ansicht: { beat0: 0, pxProBeat: 10 }, laneZiel: new Map(), sichtbar: true, raster: 'beat' };
  const ctx = { st, $: (k) => els[k], zeilen: () => tabelle, beimBild: bilder, aendere: (l, b) => { befehle.push(...b); return Promise.resolve(true); }, melde() {},
    zug: { beginne: () => ({ bewege(f) { entwuerfe.push(f().befehle); }, lass() { gelassen++; }, verwirf() {} }) } };
  try { bindeLanen(ctx); } finally { document.addEventListener = alt; }
  const alle = (art, e) => { for (const f of els.ueber.listeners[art] ?? []) f(e); };
  const mel = { fehler: [] }; ctx.melde = (t) => mel.fehler.push(t);
  return { p, st, els, befehle, entwuerfe, alle, lane, mel, gelassen: () => gelassen, y: (wert) => wertZuY(lane, wert, 'fader'), id: id === 's1' ? 'a2' : 'a1' };
}
const ereignis = (ziel, x, y, extra = {}) => ({ target: ziel, offsetX: x, offsetY: y, button: 0, pointerId: 1, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...extra });
const ziehe = (t, vonY, nachY) => {
  t.els.flaeche.dispatch('pointerdown', ereignis(t.els.ueber, 40, vonY));   // the point at beat 4 (x = 40 at 10 px per beat)
  t.alle('pointermove', ereignis(t.els.ueber, 40, nachY));
  t.alle('pointerup', ereignis(t.els.ueber, 40, nachY));
};

test('return_fader_punkt_ziehen_sendet_auto_punkte: dragging a point sends the same command as on a track fader lane, with the fader scale', () => {
  const vor = JSON.stringify(seite('r1').p.returns[0]);
  const r = seite('r1'), s = seite('s1');
  ziehe(r, r.y(-12), r.y(-12) - 20);
  ziehe(s, s.y(-12), s.y(-12) - 20);
  // a drag is committed through the drag session (zug): the last draft is the committed command
  assert.equal(r.gelassen(), 1, 'one undo step was committed');
  assert.equal(r.entwuerfe.at(-1).length, 1);
  const b = r.entwuerfe.at(-1)[0];
  assert.equal(b.befehl, 'auto_punkte'); assert.equal(b.lane_id, 'a1'); assert.equal('strang_id' in b, false, 'only auto_neu carries strang_id');
  assert.equal(b.setze.length, 1); assert.equal(b.setze[0].beat, 4);
  assert.ok(Math.abs(b.setze[0].wert - yZuWert(r.lane, r.y(-12) - 20, 'fader')) < 0.3, `value from the fader scale: ${b.setze[0].wert}`);
  assert.ok(b.setze[0].wert > -12, 'dragged up: louder');
  assert.deepEqual({ ...s.entwuerfe.at(-1)[0], lane_id: 'a1' }, b, 'the same command as on the track (apart from the lane id)');
  assert.deepEqual(entwurf(r.p, r.entwuerfe.at(-1)).returns[0].automation[0].punkte.map((q) => q.beat), [0, 4, 8, 12], 'the draft carries the dragged points');
  assert.equal(JSON.stringify(r.p.returns[0]), vor, 'the project is not touched by the drag');
  // the floor: a drag to the bottom edge of the row gives -60, below the edge off (-200)
  const f = seite('r1');
  ziehe(f, f.y(-12), f.lane.y + f.lane.h - 1);
  const fw = f.entwuerfe.at(-1)[0].setze[0].wert;
  assert.ok(fw <= -59 && fw >= -200, `bottom edge: ${fw}`);
});

test('return_fader_loeschen_und_sperre: Delete sends auto_punkte, the lane trash sends auto_loeschen, the lock sends auto_aendern; a locked lane takes no point press', () => {
  const t = seite('r1');
  t.els.flaeche.dispatch('pointerdown', ereignis(t.els.ueber, 40, t.y(-12)));
  t.alle('pointerup', ereignis(t.els.ueber, 40, t.y(-12)));
  t.alle('keydown', { key: 'Delete', preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(t.befehle.length, 1);
  assert.equal(t.befehle[0].befehl, 'auto_punkte'); assert.equal(t.befehle[0].lane_id, 'a1');
  assert.deepEqual([t.befehle[0].loesche_von, t.befehle[0].loesche_bis], [4, 4]);
  // the lock (track_heads.js sperreUmschalten) finds the lane of a return
  const aus = [];
  sperreUmschalten((rechne) => { aus.push(rechne(t.p)); }, 'r1', () => 'fader');
  assert.deepEqual(aus[0].befehle, [{ befehl: 'auto_aendern', lane_id: 'a1', gesperrt: true }]);
  // locked: a press on a point sends nothing and says why
  const g = seite('r1');
  g.p.returns[0].automation[0].gesperrt = true;
  g.els.flaeche.dispatch('pointerdown', ereignis(g.els.ueber, 40, g.y(-12)));
  g.alle('pointerup', ereignis(g.els.ueber, 40, g.y(-12)));
  assert.deepEqual(g.befehle, []);
  assert.equal(g.mel.fehler.length, 1, 'the page says the lane is locked');
});
