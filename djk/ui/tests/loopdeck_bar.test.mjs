// Loop deck M4: the grid point of a cell start (loopZielBeat). The clock is a parameter, nothing reads the wall clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loopZielBeat, loopBeatJetzt, KeineUhrFehler, LOOP_VORLAUF_MS } from '../areas/live/loopdeck_bar.ts';
import { LOOP_RASTER_BEATS } from '../project/model.ts';

const uhr = (beat, bpm = 120, empfangenMs = 1000) => ({ beat, bpm, empfangenMs });

test('lead is 80 ms', () => assert.equal(LOOP_VORLAUF_MS, 80));

test('every raster: the next multiple, at least the lead ahead', () => {
  // bpm 120: 80 ms = 0.16 beat; the clock stands at beat 10.3 at "now"
  const erwartet = { '1/4': 10.5, '1/2': 10.5, '1': 11, takt: 12, '4takte': 16 };
  for (const [r, beats] of Object.entries(LOOP_RASTER_BEATS)) {
    const ziel = loopZielBeat(uhr(10.3), beats, 1000);
    assert.equal(ziel, erwartet[r], `raster ${r}`);
    assert.ok(Math.abs(ziel / beats - Math.round(ziel / beats)) < 1e-9, `${r}: on the grid`);
    assert.ok(ziel >= 10.3 + 0.16, `${r}: lead kept`);
  }
});

test('a point 50 ms away is skipped, one 100 ms away is taken', () => {
  // 120 bpm: 50 ms = 0.1 beat, 100 ms = 0.2 beat
  assert.equal(loopZielBeat(uhr(11.9), 1, 1000), 13);
  assert.equal(loopZielBeat(uhr(11.8), 1, 1000), 12);
  // exactly the lead away counts as reachable
  assert.equal(loopZielBeat(uhr(11.84), 1, 1000), 12);
});

test('a point we are exactly on is not repeated: the grid step after it wins', () => {
  assert.equal(loopZielBeat(uhr(12), 4, 1000), 16);
});

test('extrapolates from the receipt time of the /uhr', () => {
  // 500 ms later at 120 bpm the clock is one beat further
  assert.equal(loopBeatJetzt(uhr(10, 120, 1000), 1500), 11);
  assert.equal(loopZielBeat(uhr(10, 120, 1000), 1, 1500), 12);
  assert.equal(loopZielBeat(uhr(10, 60, 1000), 1, 3000), 13);
  // the lead is in beats of the CURRENT tempo: 80 ms at 150 bpm = 0.2 beat
  assert.equal(loopZielBeat(uhr(10.85, 150, 2000), 1, 2000), 12);
});

test('bpm 0 or a missing clock throws the typed error', () => {
  for (const u of [null, undefined, uhr(10, 0), uhr(10, -5), uhr(NaN), uhr(10, NaN), { beat: 1, bpm: 120 }]) {
    assert.throws(() => loopZielBeat(u, 4, 1000), KeineUhrFehler);
  }
  assert.throws(() => loopZielBeat(uhr(10), 0, 1000), RangeError);
});
