// Automation rows for returns and master (slice 1, T1): the row table appends head rows and one lane row per open strip after groups and tracks
import test from 'node:test';
import assert from 'node:assert/strict';
import { zeilenFuer, zeileBei, zeilenHoehe, spurIndexBeiTabelle, GRUPPEN_HOEHE, LANE_HOEHE, SPUR_HOEHE } from '../public/production/layout.js';

const sp = (id, g) => ({ id, name: id, clips: [], ...(g ? { ausgang: { art: 'gruppe', id: g } } : {}) });
const P = (extra = {}) => ({ spuren: [sp('s1'), sp('s2')], gruppen: [], returns: [{ id: 'r1' }, { id: 'r2' }], master: { fader_db: 0 }, ...extra });
const ohneStraenge = () => { const p = P(); delete p.returns; delete p.master; return p; };

test('T1 rows: heads of returns and master come after the tracks, r1..rn in order, master last, collapsed = GRUPPEN_HOEHE each', () => {
  const t = zeilenFuer(P());
  assert.deepEqual(t.map((z) => z.art), ['spur', 'spur', 'return', 'return', 'master']);
  assert.deepEqual(t.slice(2), [
    { art: 'return', id: 'r1', y: 2 * SPUR_HOEHE, h: GRUPPEN_HOEHE },
    { art: 'return', id: 'r2', y: 2 * SPUR_HOEHE + GRUPPEN_HOEHE, h: GRUPPEN_HOEHE },
    { art: 'master', id: 'master', y: 2 * SPUR_HOEHE + 2 * GRUPPEN_HOEHE, h: GRUPPEN_HOEHE },
  ]);
  assert.equal(zeilenHoehe(t), 2 * SPUR_HOEHE + 3 * GRUPPEN_HOEHE);
});

test('T1 rows: the rows come after the groups too', () => {
  const p = P({ spuren: [sp('s1', 'g1'), sp('s2')], gruppen: [{ id: 'g1', nr: 1, name: 'G1', gefaltet: false }] });
  assert.deepEqual(zeilenFuer(p).map((z) => z.art), ['gruppe', 'spur', 'spur', 'return', 'return', 'master']);
});

test('T1 rows: an open strip gets ONE lane row of LANE_HOEHE directly under its head and pushes the rows below down', () => {
  const zu = zeilenFuer(P()), auf = zeilenFuer(P(), [], new Map(), new Set(['r1', 'master']));
  assert.deepEqual(auf.map((z) => z.art), ['spur', 'spur', 'return', 'lane', 'return', 'master', 'lane']);
  assert.deepEqual(auf[3], { art: 'lane', strang: 'r1', y: zu[2].y + GRUPPEN_HOEHE, h: LANE_HOEHE });
  assert.equal(auf[4].y, zu[3].y + LANE_HOEHE, 'r2 moves down by the lane row of r1');
  assert.deepEqual(auf[6], { art: 'lane', strang: 'master', y: auf[5].y + GRUPPEN_HOEHE, h: LANE_HOEHE });
  assert.equal(zeilenHoehe(auf), zeilenHoehe(zu) + 2 * LANE_HOEHE);
});

test('T1 rows: zeileBei finds head and lane rows with the keys of the plan; a click there never hits a clip', () => {
  const t = zeilenFuer(P(), [], new Map(), new Set(['r2']));
  const y0 = 2 * SPUR_HOEHE;
  assert.equal(zeileBei(t, y0 + 1).id, 'r1');
  assert.equal(zeileBei(t, y0 + GRUPPEN_HOEHE + 1).id, 'r2');
  assert.deepEqual(zeileBei(t, y0 + 2 * GRUPPEN_HOEHE + 1), { art: 'lane', strang: 'r2', y: y0 + 2 * GRUPPEN_HOEHE, h: LANE_HOEHE });
  assert.equal(zeileBei(t, zeilenHoehe(t) + 1), null);
  for (const y of [y0 + 1, y0 + 2 * GRUPPEN_HOEHE + 1, zeilenHoehe(t) - 1]) assert.equal(spurIndexBeiTabelle(t, y), -1);
});

test('T1 rows: returns only, master only, no returns', () => {
  const nurR = P(); delete nurR.master;
  assert.deepEqual(zeilenFuer(nurR).map((z) => z.art), ['spur', 'spur', 'return', 'return']);
  const nurM = P({ returns: [] });
  assert.deepEqual(zeilenFuer(nurM).map((z) => z.art), ['spur', 'spur', 'master']);
  assert.deepEqual(zeilenFuer(P({ returns: undefined })).map((z) => z.art), ['spur', 'spur', 'master']);
});

test('T1 rows: a project without returns and master gives today\'s table, unknown ids add nothing', () => {
  const alt = zeilenFuer(ohneStraenge());
  assert.deepEqual(alt.map((z) => z.art), ['spur', 'spur']);
  assert.deepEqual(zeilenFuer(ohneStraenge(), [], new Map(), new Set(['r1', 'master'])), alt);
  assert.deepEqual(zeilenFuer(P(), [], new Map(), new Set(['r9', 's1', 'g1'])), zeilenFuer(P()), 'an unknown id adds no lane row');
});

test('T1 rows: deleting r1 keeps r2 as a row with its id and its open state', () => {
  const p = P({ returns: [{ id: 'r2' }] });
  const t = zeilenFuer(p, [], new Map(), new Set(['r2']));
  assert.deepEqual(t.slice(2).map((z) => [z.art, z.id ?? z.strang]), [['return', 'r2'], ['lane', 'r2'], ['master', 'master']]);
});

test('T1 rows: open track lanes and take rows keep their place before the new rows', () => {
  const t = zeilenFuer(P(), [0], new Map([[1, 2]]), new Set(['master']));
  assert.deepEqual(t.map((z) => z.art), ['spur', 'lane', 'spur', 'take', 'take', 'return', 'return', 'master', 'lane']);
});
