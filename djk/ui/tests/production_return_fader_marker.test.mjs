// Return fader lane: the pure reading `returnFaderZeigt` (production/lanes.js) that the dock's LEVEL knob of a return uses (dock/mischer.js). The strip DOM tests of the
// removed RETURNS panel are gone; the dock behaviour is covered by dock_mischer.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';

const { returnFaderZeigt } = await import('../public/production/lanes.js');

const LANE = () => ({ id: 'a1', ziel: 'fader', punkte: [{ beat: 0, wert: -24 }, { beat: 4, wert: 0 }] });
const R = (extra = {}, fader_db = -6) => ({ id: 'r1', nr: 1, name: 'Hall', farbe: '#3b8de0', fader_db, pan: 0, mute: false, solo: false, pre: false,
  hall: { an: true, pre: 0.1, decay: 0.5, groesse: 0.5, tief: 0.5, highcut: 1, fahne: 0.5 }, ...extra });

test('returnFaderZeigt: driving needs a lane with points and a finite playhead', () => {
  const r = R({ automation: [LANE()] });
  assert.deepEqual([returnFaderZeigt(r, 2).treibt, returnFaderZeigt(r, 2).db], [true, -12]);
  for (const k of [null, undefined, NaN]) { const z = returnFaderZeigt(r, k); assert.equal(z.treibt, false); assert.equal(z.db, -6); assert.equal(z.lane.id, 'a1'); }
  assert.deepEqual(returnFaderZeigt(R(), 2), { treibt: false, lane: null, db: -6 });
  assert.deepEqual(returnFaderZeigt(null, 2), { treibt: false, lane: null, db: undefined });
});
