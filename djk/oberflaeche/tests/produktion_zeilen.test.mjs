// Automation Slice 1, task 10 (AK28): the row table of the arrangement (tracks and open lanes), pure (node).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SPUR_HOEHE, LANE_HOEHE, spurIndexBei, clipKasten, zeilenTabelle, zeilenHoehe, zeileBei, spurIndexBeiTabelle, spurZeile, laneZeile }
  from '../oeffentlich/produktion/layout.js';

const A = { beat0: 4, pxProBeat: 10 };

test('S1 T10 layout: spurIndexBei is unchanged (golden from the old formula floor(y / 64)) and the table without open lanes equals it', () => {
  assert.equal(SPUR_HOEHE, 64);
  assert.equal(LANE_HOEHE, 48);
  for (const anzahl of [0, 1, 3, 32]) {
    const tab = zeilenTabelle(anzahl);
    for (let y = -5; y <= 32 * 64 + 5; y++) {
      const alt = y >= 0 && Math.floor(y / 64) < anzahl ? Math.floor(y / 64) : -1;
      assert.equal(spurIndexBei(y, anzahl), alt, `wrapper y=${y} n=${anzahl}`);
      assert.equal(spurIndexBeiTabelle(tab, y), alt, `table y=${y} n=${anzahl}`);
    }
    assert.equal(zeilenHoehe(tab), anzahl * 64);
  }
});

test('S1 T10 layout: three tracks, lane open under track 1 and 3: every y finds the right row, heights add up, a click in a lane never hits a clip', () => {
  const tab = zeilenTabelle(3, [0, 2]);
  assert.deepEqual(tab.map((z) => [z.art, z.spur, z.y, z.h]),
    [['spur', 0, 0, 64], ['lane', 0, 64, 48], ['spur', 1, 112, 64], ['spur', 2, 176, 64], ['lane', 2, 240, 48]]);
  assert.equal(zeilenHoehe(tab), 3 * 64 + 2 * 48);
  const soll = (y) => (y < 0 || y >= 288 ? null : tab.find((z) => y >= z.y && y < z.y + z.h));
  for (let y = -3; y <= 291; y++) assert.equal(zeileBei(tab, y), soll(y) ?? null, `y=${y}`);
  assert.deepEqual(zeileBei(tab, 70), tab[1]);
  assert.equal(zeileBei(tab, 70).art, 'lane');
  assert.equal(zeileBei(tab, 70).spur, 0);
  assert.equal(spurIndexBeiTabelle(tab, 70), -1, 'a lane row is no track row');
  assert.equal(spurIndexBeiTabelle(tab, 120), 1);
  assert.equal(spurIndexBeiTabelle(tab, 200), 2);
  assert.equal(spurIndexBeiTabelle(tab, 250), -1);
  assert.equal(zeileBei(tab, NaN), null);
  assert.deepEqual(spurZeile(tab, 2), tab[3]);
  assert.deepEqual(laneZeile(tab, 2), tab[4]);
  assert.equal(laneZeile(tab, 1), null);
  assert.deepEqual(zeilenTabelle(3, new Set([0, 2])), tab, 'a Set works like an array');
});

test('S1 T10 layout: the clip box takes the row top from the table, not i * SPUR_HOEHE', () => {
  const tab = zeilenTabelle(3, [0]);
  const clip = { start_beat: 8, laenge_beats: 2 };
  const ohne = clipKasten(A, 1, clip);
  const mit = clipKasten(A, 1, clip, spurZeile(tab, 1).y);
  assert.deepEqual(ohne, { x: 40, y: 65, w: 20, h: 62 }, 'old call unchanged');
  assert.equal(mit.y, 112 + 1);
  assert.equal(mit.h, ohne.h);
  assert.equal(mit.x, ohne.x);
});

test('T7 layout: takeZeilen defaults to nothing, so every old call shape gives the old table (negative control)', () => {
  for (const offen of [[], [0], [0, 2], new Set([1])]) {
    assert.deepEqual(zeilenTabelle(3, offen, new Map()), zeilenTabelle(3, offen));
    assert.deepEqual(zeilenTabelle(3, offen, new Map([[1, 0]])), zeilenTabelle(3, offen), 'zero rows is no rows');
  }
  assert.ok(zeilenTabelle(3, [0]).every((z) => !('take' in z)), 'track and lane rows carry no take field');
});

test('T7 layout: take rows sit under their own track, above its lane, and shift everything below', () => {
  const tab = zeilenTabelle(3, [0, 1], new Map([[0, 2], [1, 1]]));
  assert.deepEqual(tab.map((z) => [z.art, z.spur, z.y, z.h]),
    [['spur', 0, 0, 64], ['take', 0, 64, 40], ['take', 0, 104, 40], ['lane', 0, 144, 48], ['spur', 1, 192, 64], ['take', 1, 256, 40], ['lane', 1, 296, 48], ['spur', 2, 344, 64]]);
  assert.equal(spurIndexBeiTabelle(tab, 350), 2);
  assert.equal(spurIndexBeiTabelle(tab, 270), -1);
});
