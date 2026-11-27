// Piano roll tools: the arithmetic of quantise (grid, strength, swing, clamp) and humanise (seeded time and velocity offsets).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLL_RASTER, rasterBeatsRolle, quantisiereNoten, humanisiereNoten, zufall } from '../public/production/notes_tools.js';

const n = (id, beat, extra = {}) => ({ id, beat, laenge: 0.25, ton: 60, vel: 100, ...extra });
const q = (noten, o) => quantisiereNoten(noten, { grenze: 4, ...o });
const beats = (r) => r.map((x) => [x.id, x.beat]);

test('ROLL_RASTER: the nine grid values and rasterBeatsRolle', () => {
  assert.deepEqual(ROLL_RASTER.map((r) => r.id), ['1/32', '1/16T', '1/16', '1/8T', '1/8', '1/4T', '1/4', 'bar', 'off']);
  assert.deepEqual(ROLL_RASTER.map((r) => r.text), ['1/32', '1/16T', '1/16', '1/8T', '1/8', '1/4T', '1/4', 'BAR', 'OFF']);
  const w = Object.fromEntries(ROLL_RASTER.map((r) => [r.id, r.beats]));
  assert.deepEqual(w, { '1/32': 0.125, '1/16T': 1 / 6, '1/16': 0.25, '1/8T': 1 / 3, '1/8': 0.5, '1/4T': 2 / 3, '1/4': 1, bar: null, off: null });
  assert.equal(rasterBeatsRolle('1/16'), 0.25);
  assert.equal(rasterBeatsRolle('1/8T'), 1 / 3);
  for (const x of ['bar', 'off', 'nope', undefined, 5]) assert.equal(rasterBeatsRolle(x), null);
  assert.ok(Object.isFrozen(ROLL_RASTER));
});

test('quantise: straight grid, only the notes whose beat changes, lengths stay', () => {
  const r = q([n('a', 0.1), n('b', 0.25), n('c', 0.4), n('d', 1.9)], { raster_beats: 0.25 });
  assert.deepEqual(beats(r), [['a', 0], ['c', 0.5], ['d', 2]]);
  assert.deepEqual(Object.keys(r[0]), ['id', 'beat']);
  assert.deepEqual(q([n('a', 0.125)], { raster_beats: 0.25 }).map((x) => x.beat), [0], 'a tie goes to the earlier grid position');
  assert.deepEqual(q([n('a', 0.2)], { raster_beats: 0.125 }).map((x) => x.beat), [0.25]);
});

test('quantise: strength moves part of the way and rounds to 1e-9', () => {
  assert.deepEqual(beats(q([n('a', 0.1)], { raster_beats: 0.25, staerke: 0.5 })), [['a', 0.05]]);
  assert.deepEqual(beats(q([n('a', 0.4)], { raster_beats: 0.25, staerke: 0.5 })), [['a', 0.45]]);
  assert.deepEqual(q([n('a', 0.1)], { raster_beats: 0.25, staerke: 0 }), []);
  assert.deepEqual(beats(q([n('a', 0.1)], { raster_beats: 0.25, staerke: 1 / 3 })), [['a', 0.066666667]], 'rounded, no float tail');
  const r = q([n('a', 0.1)], { raster_beats: 0.25, staerke: 1 / 3 });
  assert.equal(r[0].beat, Math.round(r[0].beat * 1e9) / 1e9);
});

test('quantise: swing 66 on 1/16 puts the second sixteenth of each pair at pair + 0.33', () => {
  const r = q([n('a', 0.02), n('b', 0.26), n('c', 0.49), n('d', 0.8), n('e', 1.0)], { raster_beats: 0.25, swing: 66 });
  assert.deepEqual(beats(r), [['a', 0], ['b', 0.33], ['c', 0.5], ['d', 0.83]], 'e lies on the grid and is not returned');
  const p = q([n('a', 0.33)], { raster_beats: 0.25, swing: 66 });
  assert.deepEqual(p, [], 'a note on a swung position stays');
});

test('quantise: swing 50 is the straight grid; swing 66.67 on 1/8 gives triplet feel; swing 75 on 1/4', () => {
  assert.deepEqual(beats(q([n('a', 0.3)], { raster_beats: 0.25, swing: 50 })), beats(q([n('a', 0.3)], { raster_beats: 0.25 })));
  const r = q([n('a', 0.6), n('b', 1.1)], { raster_beats: 0.5, swing: 200 / 3 });
  assert.deepEqual(beats(r), [['a', 0.666666667], ['b', 1]]);
  assert.deepEqual(beats(q([n('a', 1.4)], { raster_beats: 1, swing: 75 })), [['a', 1.5]]);
});

test('quantise: clamp, a note 0.01 before the loop end of a 4 beat loop lands on 3.75', () => {
  assert.deepEqual(beats(q([n('a', 3.99)], { raster_beats: 0.25 })), [['a', 3.75]]);
  assert.deepEqual(beats(q([n('a', 3.99)], { raster_beats: 1 / 3 })), [['a', 3.666666667]]);
  assert.deepEqual(beats(q([n('a', 3.99)], { raster_beats: 0.25, swing: 75 })), [['a', 3.875]]);
  assert.deepEqual(beats(q([n('a', 3.99)], { raster_beats: 0.25, staerke: 0.5 })), [['a', 3.87]], 'strength on a clamped target moves half way to it');
});

test('quantise: a note outside [0, grenze) is not touched', () => {
  assert.deepEqual(q([n('a', 4.1), n('b', 4), n('c', 9.99)], { raster_beats: 0.25 }), []);
  assert.deepEqual(q([n('a', -0.1)], { raster_beats: 0.25 }), []);
});

test('quantise: two notes onto one beat both stay with their ids', () => {
  const r = q([n('a', 0.51), n('b', 0.49), n('c', 0.5)], { raster_beats: 0.5 });
  assert.deepEqual(beats(r), [['a', 0.5], ['b', 0.5]]);
});

test('quantise: idempotent on every grid, also with swing and a clip length that is no multiple of the step', () => {
  const alle = ROLL_RASTER.filter((r) => r.beats !== null);
  for (const g of alle) {
    for (const grenze of [4, 3.9, 7.7]) {
      for (const swing of g.id.endsWith('T') ? [50] : [50, 60, 66.67, 75]) {
        const noten = Array.from({ length: 60 }, (_, i) => n(`n${i}`, (i * 0.137) % grenze));
        const o = { raster_beats: g.beats, swing, grenze };
        const eins = quantisiereNoten(noten, o);
        const nach = noten.map((x) => ({ ...x, beat: eins.find((e) => e.id === x.id)?.beat ?? x.beat }));
        assert.deepEqual(quantisiereNoten(nach, o), [], `${g.id} swing ${swing} grenze ${grenze}`);
      }
    }
  }
});

test('quantise: 1/8T at beat 1/3 is stored as 0.333333333 and a second run changes nothing', () => {
  assert.deepEqual(q([n('a', 1 / 3)], { raster_beats: 1 / 3 }), [{ id: 'a', beat: 0.333333333 }]);
  const eins = q([n('a', 0.35)], { raster_beats: 1 / 3 });
  assert.deepEqual(eins, [{ id: 'a', beat: 0.333333333 }]);
  assert.deepEqual(q([n('a', 0.333333333)], { raster_beats: 1 / 3 }), []);
});

test('zufall: deterministic in [-1, 1), differs between note ids and fields, differs between seeds', () => {
  assert.equal(zufall(7, 'n1', 'beat'), zufall(7, 'n1', 'beat'));
  assert.notEqual(zufall(7, 'n1', 'beat'), zufall(7, 'n2', 'beat'));
  assert.notEqual(zufall(7, 'n1', 'beat'), zufall(7, 'n1', 'vel'));
  assert.notEqual(zufall(7, 'n1', 'beat'), zufall(8, 'n1', 'beat'));
  let min = 1, max = -1, sum = 0;
  for (let i = 0; i < 5000; i++) { const z = zufall(i, `n${i % 17}`, 'beat'); assert.ok(z >= -1 && z < 1); min = Math.min(min, z); max = Math.max(max, z); sum += z; }
  assert.ok(min < -0.95 && max > 0.95 && Math.abs(sum / 5000) < 0.05, `uniform over the range (min ${min}, max ${max}, mean ${sum / 5000})`);
});

test('humanise: time stays inside ±zeit percent of a sixteenth, velocity inside ±vel, only changed notes', () => {
  const noten = Array.from({ length: 200 }, (_, i) => n(`n${i}`, 1 + (i % 8) * 0.25, { vel: 60 + (i % 5) }));
  const r = humanisiereNoten(noten, { saat: 3, zeit: 50, vel: 10, grenze: 8 });
  assert.ok(r.length > 150);
  for (const x of r) {
    const o = noten.find((y) => y.id === x.id);
    if (x.beat !== undefined) { assert.notEqual(x.beat, o.beat); assert.ok(Math.abs(x.beat - o.beat) <= 0.125 + 1e-9); assert.equal(x.beat, Math.round(x.beat * 1e9) / 1e9); }
    if (x.vel !== undefined) { assert.notEqual(x.vel, o.vel); assert.ok(Number.isInteger(x.vel) && Math.abs(x.vel - o.vel) <= 10); }
    assert.ok(x.beat !== undefined || x.vel !== undefined);
  }
  const nurZeit = humanisiereNoten(noten, { saat: 3, zeit: 10, grenze: 8 });
  assert.ok(nurZeit.every((x) => x.vel === undefined && Math.abs(x.beat - noten.find((y) => y.id === x.id).beat) <= 0.025 + 1e-9));
  const nurVel = humanisiereNoten(noten, { saat: 3, vel: 5, grenze: 8 });
  assert.ok(nurVel.every((x) => x.beat === undefined && x.vel !== undefined));
  assert.deepEqual(humanisiereNoten(noten, { saat: 3, zeit: 0, vel: 0, grenze: 8 }), []);
});

test('humanise: the offset depends on seed, note id and field only, not on position or neighbours', () => {
  const a = humanisiereNoten([n('n1', 1), n('n2', 2)], { saat: 9, zeit: 40, vel: 20, grenze: 8 });
  const b = humanisiereNoten([n('n2', 2), n('n1', 1), n('n3', 3)], { saat: 9, zeit: 40, vel: 20, grenze: 8 });
  assert.deepEqual(a.find((x) => x.id === 'n1'), b.find((x) => x.id === 'n1'));
  assert.deepEqual(humanisiereNoten([n('n1', 1)], { saat: 9, zeit: 40, vel: 20, grenze: 8 }), a.filter((x) => x.id === 'n1'));
  assert.notDeepEqual(humanisiereNoten([n('n1', 1)], { saat: 10, zeit: 40, vel: 20, grenze: 8 }), a.filter((x) => x.id === 'n1'));
});

test('humanise: clamps velocity to 1..127 and beats to [0, grenze)', () => {
  const lo = Array.from({ length: 100 }, (_, i) => n(`l${i}`, 0, { vel: 1 }));
  const hi = Array.from({ length: 100 }, (_, i) => n(`h${i}`, 3.99, { vel: 127 }));
  const r = humanisiereNoten([...lo, ...hi], { saat: 1, zeit: 50, vel: 40, grenze: 4 });
  for (const x of r) {
    if (x.vel !== undefined) assert.ok(x.vel >= 1 && x.vel <= 127);
    if (x.beat !== undefined) assert.ok(x.beat >= 0 && x.beat < 4);
  }
  assert.ok(r.some((x) => x.id.startsWith('l') && x.vel > 1) && r.some((x) => x.id.startsWith('h') && x.vel < 127));
  assert.ok(lo.every((x) => !r.some((y) => y.id === x.id && y.vel !== undefined && y.vel < 1)));
  assert.deepEqual(humanisiereNoten([n('a', 4.2), n('b', -1)], { saat: 1, zeit: 50, vel: 40, grenze: 4 }), [], 'notes outside the range stay untouched');
});
