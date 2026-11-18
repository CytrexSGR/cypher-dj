import test from 'node:test';
import assert from 'node:assert/strict';
const W = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const { installiere, El } = await import(`${W}/tests/helpers/pages_mock.mjs`);
const { bindeLanen } = await import(`${W}/public/production/lanes_operation.js`);
const { setzeKettenZiele, wertZuY, LANE_HOEHE } = await import(`${W}/public/production/lanes.js`);
const ZIEL = 'insert.i1.b1/freq';
const L = (id) => ({ id, ziel: ZIEL, punkte: [{ beat: 0, wert: 100 }, { beat: 4, wert: 400 }] });
function seite(id) {
  installiere();
  const p = { taktart: [4, 4], spuren: [], returns: [{ id: 'r1', name: 'R1', inserts: [{ id: 'i1', art: 'eq' }], automation: [L('a3')] }],
    master: { fader_db: 0, inserts: [{ id: 'i1', art: 'eq' }], automation: [L('a4')] } };
  setzeKettenZiele(p);
  const malen = [];
  const els = { flaeche: new El('div'), ueber: new El('canvas') };
  els.ueber.setPointerCapture = () => {};
  els.ueber.getContext = () => new Proxy({}, { get: (_, k) => (...a) => malen.push([k, ...a]), set: () => true });
  const alt = document.addEventListener; document.addEventListener = () => {};
  const lane = { art: 'lane', strang: id, y: 28, h: LANE_HOEHE };
  const bilder = [];
  const st = { projekt: p, ansicht: { beat0: 0, pxProBeat: 10 }, laneZiel: new Map(), sichtbar: true, raster: 'beat' };
  const ctx = { st, $: (k) => els[k], zeilen: () => [lane], beimBild: bilder, aendere: () => Promise.resolve(true), melde() {}, zug: { beginne: () => ({ bewege() {}, lass() {}, verwirf() {} }) } };
  try { bindeLanen(ctx); } finally { document.addEventListener = alt; }
  const alle = (a, e) => { for (const f of els.ueber.listeners[a] ?? []) f(e); };
  const frame = () => { malen.length = 0; for (const f of bilder) f(); return malen.map((m) => m[0]); };
  return { els, alle, frame, y: (w) => wertZuY(lane, w, ZIEL) };
}
const ev = (z, x, y) => ({ target: z, offsetX: x, offsetY: y, button: 0, pointerId: 1, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
for (const id of ['r1', 'master']) {
  test(`selected point circled in overlay on ${id} lane`, () => {
    const t = seite(id);
    t.els.flaeche.dispatch('pointerdown', ev(t.els.ueber, 40, t.y(400)));
    t.alle('pointerup', ev(t.els.ueber, 40, t.y(400)));
    assert.ok(t.frame().includes('arc'), 'the selected point is circled');
  });
  test(`range selection drawn with handles on ${id} lane`, () => {
    const t = seite(id); const y = 28 + 4;
    t.els.flaeche.dispatch('pointerdown', ev(t.els.ueber, 15, y));
    t.alle('pointermove', ev(t.els.ueber, 60, y));
    t.alle('pointerup', ev(t.els.ueber, 60, y));
    assert.equal(t.frame().filter((k) => k === 'fillRect').length, 4);
  });
}
