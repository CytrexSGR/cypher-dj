// 1.12 S7 (M13): the measurements of the real-core acceptance (check/s7_loop_measure.mjs) on synthetic events
import test from 'node:test';
import assert from 'node:assert/strict';
import { blockGroesse, sampleBeiBeat, nahtLuecken, verlauf, stoppVerzug, SR } from '../check/s7_loop_measure.mjs';

// /uhr every 256 samples at 128 BPM from beat 0 at sample 1000
const BPM = 128, SPB = 60 / BPM * SR;   // 22500 samples per beat
const uhren = Array.from({ length: 2000 }, (_, i) => ({ sample: 1000 + 256 * i, beat: (256 * i) / SPB, bpm: BPM }));
const s = (beat) => 1000 + Math.round(beat * SPB);

test('S7 loop measure: block size and the sample of a beat', () => {
  assert.equal(blockGroesse(uhren), 256);
  assert.equal(blockGroesse(uhren.slice(0, 1)), null);
  assert.equal(sampleBeiBeat(uhren, 4), s(4));
  assert.equal(sampleBeiBeat(uhren, 8.5), s(8.5));
  assert.equal(sampleBeiBeat([{ sample: 0, beat: 10, bpm: BPM }], 4), null, 'no line before the beat');
});

test('S7 loop measure: seam gaps are 0 when every pass sets its start value on its beat; a late or missing set is seen', () => {
  const regler = [];
  for (let k = 0; k < 6; k++) {
    regler.push({ pfad: 'erz/2/fader', wert: 0, beat: 4 * k, sample: s(4 * k) });
    for (let j = 1; j < 4; j++) regler.push({ pfad: 'erz/2/fader', wert: -10 * j, beat: 4 * k + j, sample: s(4 * k + j) });
  }
  regler.unshift({ pfad: 'erz/3/fader', wert: 0, beat: 8, sample: s(8) + 7 });   // another path at the same beat, listed first: not counted
  const starts = [4, 8, 12, 16, 20];
  assert.deepEqual(nahtLuecken(regler, uhren, { pfad: 'erz/2/fader', starts, wert: 0 }).map((x) => x.luecke), [0, 0, 0, 0, 0]);
  const spaet = regler.map((x) => (x.beat === 12 && x.wert === 0 ? { ...x, sample: x.sample + 300, beat: x.beat + 300 / SPB } : x));
  assert.deepEqual(nahtLuecken(spaet, uhren, { pfad: 'erz/2/fader', starts, wert: 0 }).map((x) => x.luecke), [0, 0, 300, 0, 0]);
  const fehlt = regler.filter((x) => !(x.beat === 16 && x.wert === 0));
  assert.equal(nahtLuecken(fehlt, uhren, { pfad: 'erz/2/fader', starts, wert: 0 })[3].fehlt, true);
  assert.deepEqual(verlauf(regler, 'erz/2/fader', 8, 12), [0, -10, -20, -30]);
});

test('S7 loop measure: STOP delay from the abort sample to the hold event', () => {
  const regler = [{ pfad: 'erz/2/fader', wert: -12, sample: 5000, beat: 0 }, { pfad: 'erz/2/fader', wert: -13.5, sample: 5256, beat: 0 }];
  assert.deepEqual(stoppVerzug(regler, 'erz/2/fader', 5100), { sample: 5256, wert: -13.5, verzug: 156 });
  assert.equal(stoppVerzug(regler, 'erz/2/fader', 6000), null);
  assert.equal(stoppVerzug(regler, 'erz/3/fader', 0), null);
});

test('S7 loop measure: the old ramp end reported on the seam sample belongs to the old pass, not to the course of the next (real core, 2026-11-04)', () => {
  // The real core reports the end value of the running ramp (-30) and the next pass's set (0) on the SAME sample of the seam beat, the end first.
  const regler = [
    { pfad: 'erz/2/fader', wert: -29.9, beat: 7.97, sample: s(7.97) },
    { pfad: 'erz/2/fader', wert: -30, beat: 8, sample: s(8) },       // end of the old pass
    { pfad: 'erz/2/fader', wert: 0, beat: 8, sample: s(8) },         // start of the next pass, same sample, last event wins
    { pfad: 'erz/2/fader', wert: -5, beat: 10, sample: s(10) },
    { pfad: 'erz/2/fader', wert: -9.9, beat: 15.97, sample: s(15.97) },
    { pfad: 'erz/2/fader', wert: -10, beat: 16, sample: s(16) },     // end of the new pass
    { pfad: 'erz/2/fader', wert: 0, beat: 16, sample: s(16) },
  ];
  assert.deepEqual(verlauf(regler, 'erz/2/fader', 8, 16), [0, -5, -9.9], 'next pass: from its set to its last reported value');
  assert.deepEqual(verlauf(regler, 'erz/2/fader', 0, 8), [-29.9], 'old pass: the event at its end beat is replaced by the set on the same sample');
  // negative control: two different samples keep both events
  assert.deepEqual(verlauf(regler.map((x, i) => (i === 2 ? { ...x, sample: x.sample + 1 } : x)), 'erz/2/fader', 8, 16), [-30, 0, -5, -9.9]);
});
