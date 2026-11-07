// 1.12 slice 3 task 8 (D15): Ramer-Douglas-Peucker on (beat, value) for a recorded take. Pure module projekt/vereinfachen.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { vereinfache, TOLERANZ_FADER_DB, TOLERANZ_PAN } from '../projekt/vereinfachen.ts';
import { laneWert } from '../projekt/lane.ts';

// deterministic noise in [-amp, amp]
const rauschen = (i, amp) => amp * Math.sin(i * 12.9898) * Math.cos(i * 4.1414);
const maxAbweichung = (orig, einfach, ziel) => Math.max(...orig.map((p) => Math.abs(laneWert(einfach, p.beat, ziel) - p.wert)));

test('D15.1 a 500-point ramp with noise <= 0.1 dB gives <= 60 points; the measured deviation is within the tolerance', () => {
  const orig = Array.from({ length: 500 }, (_, i) => ({ beat: i * 8 / 499, wert: -12 * i / 499 + rauschen(i, 0.1) }));
  const einfach = vereinfache(orig, 'fader');
  const dev = maxAbweichung(orig, einfach, 'fader');
  console.log(`# ramp: ${orig.length} -> ${einfach.length} points, max deviation ${dev.toFixed(4)} dB (tolerance ${TOLERANZ_FADER_DB})`);
  assert.ok(einfach.length <= 60, `${einfach.length} points`);
  assert.ok(einfach.length >= 2);
  assert.ok(dev <= TOLERANZ_FADER_DB, `deviation ${dev}`);
  assert.equal(einfach[0].beat, orig[0].beat); assert.equal(einfach.at(-1).beat, orig.at(-1).beat);
});

test('D15.2 a fader take that falls to -200 dB keeps the -200 dB point exact', () => {
  const orig = [];
  for (let i = 0; i <= 100; i++) orig.push({ beat: i * 0.1, wert: -0.1 * i });                 // 0 .. -10 dB
  orig.push({ beat: 10.1, wert: -200 });                                                       // the fall
  orig.push({ beat: 10.2, wert: -200 });
  orig.push({ beat: 11, wert: -200 });
  const einfach = vereinfache(orig, 'fader');
  const m = einfach.filter((p) => p.wert === -200);
  assert.ok(m.length >= 1, 'a -200 dB point is kept');
  assert.equal(m[0].wert, -200, 'exact, not interpolated');
  assert.equal(m[0].beat, 10.1, 'at the beat where the take fell');
  assert.equal(einfach.at(-1).wert, -200);
  assert.ok(einfach.length < orig.length / 4, `${einfach.length} points`);
});

test('D15.3 mute and solo jumps stay, as sprung points; repeated values go', () => {
  for (const ziel of ['mute', 'solo']) {
    const orig = [{ beat: 0, wert: 0 }, { beat: 1, wert: 0 }, { beat: 2, wert: 1 }, { beat: 3, wert: 1 }, { beat: 4, wert: 0 }, { beat: 5, wert: 0 }];
    const einfach = vereinfache(orig, ziel);
    assert.deepEqual(einfach.map((p) => [p.beat, p.wert]), [[0, 0], [2, 1], [4, 0], [5, 0]], ziel);
    assert.ok(einfach.every((p) => p.form === 'sprung'));
  }
});

test('D15.4 negative control: tolerance 0 keeps every point', () => {
  const orig = Array.from({ length: 60 }, (_, i) => ({ beat: i / 4, wert: -12 * i / 59 }));          // an exact ramp: all points are collinear
  assert.equal(vereinfache(orig, 'fader', 0).length, 60);
  assert.ok(vereinfache(orig, 'fader').length < 60, 'with the default tolerance the exact ramp collapses');
  assert.equal(vereinfache(orig, 'fader').length, 2);
});

test('D15.5 pan tolerance is 0.4 percent of the range; beats rise, at most two points share a beat, endpoints stay', () => {
  assert.equal(TOLERANZ_PAN, 0.008);
  const orig = [{ beat: 0, wert: 0 }, { beat: 1, wert: 0.004 }, { beat: 2, wert: 0 }, { beat: 3, wert: 0.5 }, { beat: 3, wert: -0.5 }, { beat: 3, wert: 0.25 }, { beat: 4, wert: 0.25 }];
  const e = vereinfache(orig, 'pan');
  assert.equal(e[0].beat, 0); assert.equal(e.at(-1).beat, 4);
  for (let i = 1; i < e.length; i++) assert.ok(e[i].beat >= e[i - 1].beat, 'rising');
  assert.ok(e.filter((p) => p.beat === 3).length <= 2, 'at most two at one beat');
  assert.equal(e.some((p) => p.beat === 1), false, 'the 0.004 wobble is below the tolerance');
});

test('D15.6 fewer than three points and empty input pass through', () => {
  assert.deepEqual(vereinfache([], 'fader'), []);
  assert.deepEqual(vereinfache([{ beat: 1, wert: -3 }], 'fader'), [{ beat: 1, wert: -3 }]);
  assert.equal(vereinfache([{ beat: 1, wert: -3 }, { beat: 2, wert: -4 }], 'fader').length, 2);
});
