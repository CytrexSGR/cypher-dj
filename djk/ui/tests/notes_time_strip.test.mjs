// NOTEN (note editor slice 2): edge hit test, time drag op (snap, clamp, Alt free, shape) and the drag gestures of the surface.
import test from 'node:test';
import assert from 'node:assert/strict';
import { trefferKante, zeitZugOp, zeitVorschau, notenKasten, TREFFER_PX } from '../public/noten/view.js';
import { bindeNotenEditor } from '../public/noten/operation.js';

const note = (id, qa, qe, extra = {}) => ({ id, qa, qe, qton: 60, p: 0.9, ...extra });
const A = { s0: 0, pxProS: 100, tonOben: 64 };
// 120 bpm: a beat is 0.5 s, 1/16 of the grid is 0.125 s
const RASTER = { beatBeiS: (s) => s / 0.5, sBeiBeat: (b) => b * 0.5, beatsProTakt: 4 };

test('trefferKante: near the start or end line of a bar, narrow bars only beside, bodies and key column are no edge', () => {
  const n = [note('t1', 1, 2)];
  const k = notenKasten(A, n[0]), y = k.y + 2;
  assert.deepEqual(trefferKante(n, A, k.x + 1, y), { id: 't1', kante: 'a' });
  assert.deepEqual(trefferKante(n, A, k.x + k.w - 2, y), { id: 't1', kante: 'e' });
  assert.equal(trefferKante(n, A, k.x + k.w / 2, y), null);
  assert.equal(trefferKante(n, A, k.x + 1, k.y - 3), null);
  assert.equal(trefferKante(n, A, 10, y), null);
  const s = [note('t1', 1, 1.05)], ks = notenKasten(A, s[0]);          // 5 px wide: narrower than 2 * TREFFER_PX
  assert.equal(trefferKante(s, A, ks.x + ks.w / 2, ks.y + 2), null, 'the body of a narrow bar is no edge');
  assert.deepEqual(trefferKante(s, A, ks.x - 2, ks.y + 2), { id: 't1', kante: 'a' });
  assert.deepEqual(trefferKante(s, A, ks.x + ks.w + 2, ks.y + 2), { id: 't1', kante: 'e' });
  assert.equal(trefferKante(s, A, ks.x - TREFFER_PX - 2, ks.y + 2), null);
});

test('zeitZugOp move: the anchor start snaps to 1/16, Alt is free at 0.001 s, no grid is free, ids and shape', () => {
  const n = [note('t1', 1, 1.5), note('t2', 3, 4)];
  assert.deepEqual(zeitZugOp(n, ['t1'], 't1', 0.2, null, 'raster', RASTER), { art: 'zeit', ids: ['t1'], um_s: 0.25 });
  assert.deepEqual(zeitZugOp(n, ['t1'], 't1', 0.2004, null, 'frei', RASTER), { art: 'zeit', ids: ['t1'], um_s: 0.2 });
  assert.deepEqual(zeitZugOp(n, ['t1'], 't1', 0.2004, null, 'raster', null), { art: 'zeit', ids: ['t1'], um_s: 0.2 });
  assert.deepEqual(zeitZugOp(n, ['t1', 't2'], 't2', -0.3, null, 'raster', RASTER), { art: 'zeit', ids: ['t1', 't2'], um_s: -0.25 });
  assert.equal(zeitZugOp(n, ['t1'], 't1', 0.03, null, 'raster', RASTER), null, 'snaps back to 0: nothing moves');
  assert.equal(zeitZugOp(n, ['t1'], 'gone', 0.5, null, 'raster', RASTER), null);
});

test('zeitZugOp clamps toward the pointer at the neighbour, at 0 and at the stretch limit', () => {
  const n = [note('t1', 1, 1.5), note('t2', 3, 4)];
  const r = zeitZugOp(n, ['t1'], 't1', 5, null, 'frei', null);
  assert.equal(r.art, 'zeit');
  assert.ok(r.um_s > 1.49 && r.um_s <= 1.5, `up to the neighbour (${r.um_s})`);
  const l = zeitZugOp(n, ['t1'], 't1', -5, null, 'frei', null);
  assert.ok(l.um_s < -0.99 && l.um_s >= -1, `down to 0 (${l.um_s})`);
  assert.deepEqual(zeitZugOp([note('t1', 1, 2)], ['t1'], 't1', 0.4, 'e', 'frei', null), { art: 'kante', id: 't1', e: 2.4 });
  const k = zeitZugOp([note('t1', 1, 2)], ['t1'], 't1', 10, 'e', 'frei', null);
  assert.ok(k.e <= 5 && k.e > 4.99, `stretch limit 4 (${k.e})`);
  const s = zeitZugOp([note('t1', 1, 2)], ['t1'], 't1', -10, 'e', 'frei', null);
  assert.ok(s.e >= 1.25 && s.e < 1.26, `compression limit 0.25 (${s.e})`);
});

test('zeitZugOp edges: the edge snaps, the op carries only that edge', () => {
  const n = [note('t1', 1, 2)];
  assert.deepEqual(zeitZugOp(n, ['t1'], 't1', 0.13, 'a', 'raster', RASTER), { art: 'kante', id: 't1', a: 1.125 });
  assert.equal(zeitZugOp(n, ['t1'], 't1', -0.06, 'e', 'raster', RASTER), null, 'snaps back to the current end: nothing moves');
});

test('zeitVorschau: changed notes including a following neighbour', () => {
  const n = [note('t1', 1, 2), note('t2', 2, 3)];
  const v = zeitVorschau(n, { art: 'kante', id: 't1', e: 2.25 });
  assert.deepEqual(v.map((x) => [x.id, x.a ?? null, x.e ?? null]), [['t1', null, 2.25], ['t2', 2.25, null]]);
  assert.deepEqual(zeitVorschau(n, null), []);
});

// ---- gestures
function aufbau(noten) {
  const handler = new Map(), gesendet = [];
  const sicht = { quelleS: 4, hoerbarS: [0, 4], noten, kurve: null, welle: null, raster: RASTER, rasteTonart: null, render: { zustand: 'quelle' }, analyse: null };
  const adapter = { lies: () => sicht, schreibe: (op) => { gesendet.push(op); return Promise.resolve({ ok: true }); }, abonniere: () => () => {} };
  const g = new Proxy({}, { get: (_, n) => (n === 'measureText' ? () => ({ width: 5 }) : () => {}), set: () => true });
  const canvas = { width: 0, height: 0, style: {}, getContext: () => g, getBoundingClientRect: () => ({ left: 0, top: 0, width: 440, height: 180 }),
    addEventListener: (n, f) => handler.set(n, f), removeEventListener() {}, setPointerCapture() { throw new Error('gone'); }, releasePointerCapture() {}, focus() {} };
  bindeNotenEditor(canvas, adapter, { menue() {} });
  const ev = (name, o = {}) => handler.get(name)({ type: name, button: 0, offsetX: 0, offsetY: 0, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, pointerId: 1, preventDefault() {}, ...o });
  return { ev, gesendet, canvas, sicht };
}

test('gestures: horizontal drag = time op (pointer capture failure tolerated), Alt free, edge drag = kante op, vertical = pitch, Escape cancels', async () => {
  const t = aufbau([note('t1', 1, 2), note('t2', 3, 3.5)]);          // 400 px for 4 s: 100 px/s, t1 spans x 140..240
  t.ev('pointermove', { offsetX: 200, offsetY: 5 });                  // sets up the view
  let y = null;
  for (let yy = 0; yy < 180 && y === null; yy++) { t.ev('pointermove', { offsetX: 190, offsetY: yy }); if (t.canvas.style.cursor === 'grab') y = yy; }
  assert.ok(y !== null, 'cursor grab over the body');
  t.ev('pointermove', { offsetX: 141, offsetY: y }); assert.equal(t.canvas.style.cursor, 'ew-resize', 'edge cursor');
  t.ev('pointermove', { offsetX: 100, offsetY: y }); assert.equal(t.canvas.style.cursor, '');
  const gesto = async (von, nach, opt = {}) => {
    t.ev('pointerdown', { offsetX: von[0], offsetY: von[1] });
    t.ev('pointermove', { offsetX: nach[0], offsetY: nach[1], ...opt });
    t.ev('pointerup', { offsetX: nach[0], offsetY: nach[1], ...opt });
    await Promise.resolve(); await Promise.resolve();
  };
  await gesto([190, y], [210, y + 1]);
  assert.deepEqual(t.gesendet.splice(0), [{ art: 'zeit', ids: ['t1'], um_s: 0.25 }], '20 px = 0.2 s snapped to 0.25');
  await gesto([190, y], [210, y], { altKey: true });
  assert.deepEqual(t.gesendet.splice(0), [{ art: 'zeit', ids: ['t1'], um_s: 0.2 }], 'Alt: free');
  await gesto([238, y], [263, y]);                                      // end line of t1 at x 240
  assert.deepEqual(t.gesendet.splice(0), [{ art: 'kante', id: 't1', e: 2.25 }]);
  await gesto([142, y], [117, y]);                                      // start line
  assert.deepEqual(t.gesendet.splice(0), [{ art: 'kante', id: 't1', a: 0.75 }]);
  await gesto([190, y], [191, y - 18]);                                 // vertical-dominant: pitch
  const ton = t.gesendet.splice(0);
  assert.equal(ton.length, 1); assert.equal(ton[0].art, 'ton');
  t.ev('pointerdown', { offsetX: 190, offsetY: y }); t.ev('pointermove', { offsetX: 230, offsetY: y }); t.ev('keydown', { key: 'Escape' }); t.ev('pointerup', { offsetX: 230, offsetY: y });
  assert.deepEqual(t.gesendet, [], 'Escape cancels');
});

test('zeitAnwenden on the frame grid (256 / 48000 s): an edge that was not dragged is not stored and moves no neighbour', async () => {
  const { zeitAnwenden } = await import('../public/noten/time.js');
  const fr = 256 / 48000;
  const n = [note('t1', 56 * fr, 168 * fr), note('t2', 170 * fr, 282 * fr)];   // gap 10.7 ms: touching
  const r = zeitAnwenden(n, { ids: ['t2'], e: 282 * fr + 0.05 });
  assert.equal(r.grund, undefined);
  assert.deepEqual(r.liste[0], n[0], 'only the end of t2 was dragged: t1 stays as it is');
  assert.equal(r.liste[1].a, undefined);
  assert.equal(r.liste[1].e, Math.round((282 * fr + 0.05) * 1e6) / 1e6);
  const r2 = zeitAnwenden(n, { ids: ['t1'], a: 56 * fr - 0.05 });
  assert.deepEqual(r2.liste[1], n[1], 'only the start of t1 was dragged: t2 stays as it is');
  assert.equal(r2.liste[0].e, undefined);
  const r3 = zeitAnwenden(n, { ids: ['t2'], a: 170 * fr + 0.005 });   // the dragged edge still takes the neighbour along
  assert.equal(r3.liste[0].e, Math.round((170 * fr + 0.005) * 1e6) / 1e6);
});
