// Backlog production task 7: the lane of a GROUP is edited like the lane of a track. The selected range survives the overlay frame, Delete removes a point,
// the draft shows a dragged point (laneMitId, the overlay and the key handler of lanes_operation.js, draft.js).
import test from 'node:test';
import assert from 'node:assert/strict';

const { installiere, El } = await import('./helpers/pages_mock.mjs');
const { bindeLanen } = await import('../public/production/lanes_operation.js');
const { laneMitId, setzeKettenZiele, kettenZieleVon } = await import('../public/production/lanes.js');
const { zeilenTabelle } = await import('../public/production/layout.js');
const { wertZuY, LANE_HOEHE } = await import('../public/production/lanes.js');
const { entwurf } = await import('../public/production/draft.js');

const ZIEL = 'insert.i1.b1/freq';
const projekt = () => ({
  taktart: [4, 4],
  spuren: [{ id: 's1', clips: [], automation: [] }],
  gruppen: [{ id: 'g1', nr: 1, name: 'G1', inserts: [{ id: 'i1', art: 'eq' }],
    automation: [{ id: 'a1', ziel: ZIEL, punkte: [{ beat: 0, wert: 100 }, { beat: 4, wert: 400 }] }] }],
});

test('Task 7: laneMitId finds a lane that lives on a group, and still one of a track', () => {
  const p = projekt();
  p.spuren[0].automation = [{ id: 'a2', ziel: 'fader', punkte: [{ beat: 0, wert: 0 }] }];
  const g = laneMitId(p, 'a1');
  assert.equal(g?.art, 'gruppe'); assert.equal(g.strang.id, 'g1'); assert.equal(g.lane.id, 'a1');
  const s = laneMitId(p, 'a2');
  assert.equal(s?.art, 'spur'); assert.equal(s.strang.id, 's1');
  assert.equal(laneMitId(p, 'zz'), null);
});

test('Task 7: the draft of auto_punkte, auto_dehnen and auto_neigen changes a group lane and leaves the project untouched', () => {
  const p = projekt();
  const e = entwurf(p, [{ befehl: 'auto_punkte', lane_id: 'a1', loesche_von: 4, loesche_bis: 4, setze: [{ beat: 6, wert: 200 }] }]);
  assert.deepEqual(e.gruppen[0].automation[0].punkte.map((q) => q.beat), [0, 6]);
  assert.deepEqual(p.gruppen[0].automation[0].punkte.map((q) => q.beat), [0, 4], 'the project itself is not changed');
  const d = entwurf(p, [{ befehl: 'auto_dehnen', lane_id: 'a1', von_beat: 0, bis_beat: 4, neu_bis: 8 }]);
  assert.notDeepEqual(d.gruppen[0].automation[0].punkte, p.gruppen[0].automation[0].punkte, 'stretch reaches the group lane');
  // a project without groups gets no gruppen key (byte-equal drafts of old projects)
  assert.equal('gruppen' in entwurf({ spuren: [{ id: 's1', clips: [] }] }, [{ befehl: 'auto_punkte', lane_id: 'x', setze: [] }]), false);
});

function seite() {
  installiere();
  const p = projekt();
  setzeKettenZiele(p);
  assert.ok(kettenZieleVon(p.gruppen[0]).has(ZIEL), 'the target of the fixture exists');
  const malen = [];   // what the overlay draws
  const els = { flaeche: new El('div'), ueber: new El('canvas') };
  els.ueber.setPointerCapture = () => {};
  els.ueber.getContext = () => new Proxy({}, { get: (_, k) => (...a) => malen.push([k, ...a]), set: () => true });
  const tasten = [];
  const alt = document.addEventListener;
  document.addEventListener = (art, f) => { if (art === 'keydown') tasten.push(f); };
  const spur = zeilenTabelle(1)[0];   // the track row; the group head and its open lane row below it, built by hand (the group layout has its own tests)
  const lane = { art: 'lane', gruppe: 0, y: spur.h + 20, h: LANE_HOEHE };
  const tabelle = [spur, { art: 'gruppe', gruppe: 0, y: spur.h, h: 20 }, lane];
  const befehle = [], bilder = [];
  const st = { projekt: p, ansicht: { beat0: 0, pxProBeat: 10 }, laneZiel: new Map(), sichtbar: true, raster: 'beat' };
  const ctx = { st, $: (k) => els[k], zeilen: () => tabelle, beimBild: bilder, aendere: (l, b) => { befehle.push(...b); return Promise.resolve(true); }, melde() {},
    zug: { beginne: () => ({ bewege() {}, lass() {}, verwirf() {} }) } };
  try { bindeLanen(ctx); } finally { document.addEventListener = alt; }
  const alle = (art, e) => { for (const f of els.ueber.listeners[art] ?? []) f(e); };
  const frame = () => { malen.length = 0; for (const f of bilder) f(); return malen.map((m) => m[0]); };
  return { st, els, lane, befehle, malen, tasten, alle, frame, y: (wert) => wertZuY(lane, wert, ZIEL) };
}
const ereignis = (ziel, x, y, extra = {}) => ({ target: ziel, offsetX: x, offsetY: y, button: 0, pointerId: 1, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...extra });

test('Task 7: a range selected on a group lane survives the next overlay frame and is drawn with its handles', () => {
  const t = seite();
  const y = t.lane.y + 4;   // an empty place of the lane (the points sit at the beats 0 and 4)
  t.els.flaeche.dispatch('pointerdown', ereignis(t.els.ueber, 15, y));
  t.alle('pointermove', ereignis(t.els.ueber, 60, y));
  t.alle('pointerup', ereignis(t.els.ueber, 60, y));
  assert.equal(t.frame().filter((k) => k === 'fillRect').length, 4, 'the range and its three handles are drawn: the range was not cleared');
  assert.equal(t.frame().filter((k) => k === 'fillRect').length, 4, 'and again on the next frame');
});

test('Task 7: Delete removes the selected point of a group lane', () => {
  const t = seite();
  t.els.flaeche.dispatch('pointerdown', ereignis(t.els.ueber, 40, t.y(400)));   // the point at beat 4
  t.alle('pointerup', ereignis(t.els.ueber, 40, t.y(400)));
  assert.deepEqual(t.befehle, [], 'a click on a point changes nothing');
  let verschluckt = 0;
  t.alle('keydown', { key: 'Delete', preventDefault() { verschluckt++; }, stopImmediatePropagation() {} });
  assert.equal(verschluckt, 1, 'the key is ours');
  assert.equal(t.befehle.length, 1);
  assert.equal(t.befehle[0].befehl, 'auto_punkte'); assert.equal(t.befehle[0].lane_id, 'a1');
  assert.deepEqual([t.befehle[0].loesche_von, t.befehle[0].loesche_bis], [4, 4]);
});

test('Task 7: the selected point of a group lane is circled in the overlay', () => {
  const t = seite();
  t.els.flaeche.dispatch('pointerdown', ereignis(t.els.ueber, 40, t.y(400)));
  t.alle('pointerup', ereignis(t.els.ueber, 40, t.y(400)));
  assert.ok(t.frame().includes('arc'), 'the selected point is circled');
});

// Automation slice 1 T4: the lanes of a return and of the master are edited like those of a group (rows {art:'lane', strang}).
function seiteStrang(id) {
  installiere();
  const p = projekt();
  p.returns = [{ id: 'r1', name: 'R1', inserts: [{ id: 'i1', art: 'eq' }], automation: [{ id: 'a3', ziel: ZIEL, punkte: [{ beat: 0, wert: 100 }, { beat: 4, wert: 400 }] }] }];
  p.master = { fader_db: 0, inserts: [{ id: 'i1', art: 'eq' }], automation: [{ id: 'a4', ziel: ZIEL, punkte: [{ beat: 0, wert: 100 }, { beat: 4, wert: 400 }] }] };
  setzeKettenZiele(p);
  const els = { flaeche: new El('div'), ueber: new El('canvas') };
  els.ueber.setPointerCapture = () => {};
  els.ueber.getContext = () => new Proxy({}, { get: () => () => {}, set: () => true });
  const tasten = [];
  const alt = document.addEventListener;
  document.addEventListener = (art, f) => { if (art === 'keydown') tasten.push(f); };
  const kopf = { art: id === 'master' ? 'master' : 'return', id, y: 0, h: 28 };
  const lane = { art: 'lane', strang: id, y: 28, h: LANE_HOEHE };
  const tabelle = [kopf, lane];
  const befehle = [];
  const st = { projekt: p, ansicht: { beat0: 0, pxProBeat: 10 }, laneZiel: new Map(), sichtbar: true, raster: 'beat' };
  const ctx = { st, $: (k) => els[k], zeilen: () => tabelle, beimBild: [], aendere: (l, b) => { befehle.push(...b); return Promise.resolve(true); }, melde() {},
    zug: { beginne: () => ({ bewege() {}, lass() {}, verwirf() {} }) } };
  try { bindeLanen(ctx); } finally { document.addEventListener = alt; }
  const alle = (art, e) => { for (const f of els.ueber.listeners[art] ?? []) f(e); };
  return { st, els, befehle, alle, kopf, lane, p, y: (wert) => wertZuY(lane, wert, ZIEL) };
}

for (const [id, laneId] of [['r1', 'a3'], ['master', 'a4']]) {
  test(`T4: Delete on a selected point of the ${id} lane sends auto_punkte with lane_id only`, () => {
    const t = seiteStrang(id);
    t.els.flaeche.dispatch('pointerdown', ereignis(t.els.ueber, 40, t.y(400)));
    t.alle('pointerup', ereignis(t.els.ueber, 40, t.y(400)));
    assert.deepEqual(t.befehle, [], 'a click on a point changes nothing');
    t.alle('keydown', { key: 'Delete', preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(t.befehle.length, 1);
    assert.equal(t.befehle[0].befehl, 'auto_punkte'); assert.equal(t.befehle[0].lane_id, laneId);
    assert.equal('strang_id' in t.befehle[0], false, 'only auto_neu carries strang_id');
    assert.deepEqual([t.befehle[0].loesche_von, t.befehle[0].loesche_bis], [4, 4]);
  });

}

// A press on a head row or on a track row is never ours: it must reach the clip handling (no stopImmediatePropagation) and must end a point selection.
// The `z.art !== 'lane'` check in laneAn is NOT redundant: a group head row {art:'gruppe', gruppe} and a track row {art:'spur', spur} resolve to a strand
// through laneStrang just like the lane row does (only the real head rows of returns and master carry no key laneStrang knows).
function druckAufKopf(t, y) {
  let verschluckt = 0;
  t.els.flaeche.dispatch('pointerdown', ereignis(t.els.ueber, 40, y, { stopImmediatePropagation() { verschluckt++; } }));
  return verschluckt;
}
function waehlePunkt(t) {
  t.els.flaeche.dispatch('pointerdown', ereignis(t.els.ueber, 40, t.y(400)));
  t.alle('pointerup', ereignis(t.els.ueber, 40, t.y(400)));
}
const loescheTaste = (t) => t.alle('keydown', { key: 'Delete', preventDefault() {}, stopImmediatePropagation() {} });

for (const id of ['r1', 'master']) {
  test(`T4: a click on the collapsed head row of ${id} hits no lane and ends the point selection`, () => {
    const t = seiteStrang(id);
    waehlePunkt(t);
    assert.equal(druckAufKopf(t, 10), 0, 'the press is not swallowed by the lane handling');
    loescheTaste(t);
    assert.deepEqual(t.befehle, [], 'the selected point was dropped by the press, Delete sends nothing');
  });
}

test('T4: a press on the group head row or on the track row above a group lane is not a lane press', () => {
  const t = seite();
  const spurY = 5, kopfY = t.lane.y - 10;   // the track row at the top, the group head row {art:'gruppe'} right above the lane row
  assert.equal(druckAufKopf(t, kopfY), 0, 'group head row: not swallowed');
  assert.equal(druckAufKopf(t, spurY), 0, 'track row: not swallowed');
  t.els.flaeche.dispatch('pointerdown', ereignis(t.els.ueber, 40, t.y(400)));
  t.alle('pointerup', ereignis(t.els.ueber, 40, t.y(400)));   // select the point on the lane row
  assert.equal(druckAufKopf(t, kopfY), 0);
  loescheTaste(t);
  assert.deepEqual(t.befehle, [], 'the press on the head row dropped the selected point');
});

test('T4: the draft of a point edit on a return lane and a master lane shows the points and leaves the project untouched', () => {
  const p = seiteStrang('r1').p;
  const e1 = entwurf(p, [{ befehl: 'auto_punkte', lane_id: 'a3', loesche_von: 4, loesche_bis: 4, setze: [{ beat: 6, wert: 200 }] }]);
  assert.deepEqual(e1.returns[0].automation[0].punkte.map((q) => q.beat), [0, 6]);
  assert.deepEqual(p.returns[0].automation[0].punkte.map((q) => q.beat), [0, 4], 'projekt.returns[0] is not mutated');
  const e2 = entwurf(p, [{ befehl: 'auto_punkte', lane_id: 'a4', loesche_von: 4, loesche_bis: 4, setze: [{ beat: 6, wert: 200 }] }]);
  assert.deepEqual(e2.master.automation[0].punkte.map((q) => q.beat), [0, 6]);
  assert.deepEqual(p.master.automation[0].punkte.map((q) => q.beat), [0, 4], 'projekt.master is not mutated');
  const e3 = entwurf(p, [{ befehl: 'auto_dehnen', lane_id: 'a3', von_beat: 0, bis_beat: 4, neu_bis: 8 }]);
  assert.notDeepEqual(e3.returns[0].automation[0].punkte, p.returns[0].automation[0].punkte);
  // old projects without returns/master get no such keys
  assert.equal('returns' in entwurf({ spuren: [{ id: 's1', clips: [] }] }, [{ befehl: 'auto_punkte', lane_id: 'x', setze: [] }]), false);
  assert.equal('master' in entwurf({ spuren: [{ id: 's1', clips: [] }] }, [{ befehl: 'auto_punkte', lane_id: 'x', setze: [] }]), false);
});
