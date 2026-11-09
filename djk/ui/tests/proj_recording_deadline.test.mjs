// 1.8 S4b.1a (D7, D8): the horizon for the receipts of a count-in or running start, as a pure function.
// (quantBeats + 4 * vorzaehlerTakte + laufendBeats) * 60000 / bpm + 4000 ms
import test from 'node:test';
import assert from 'node:assert/strict';
import { quittungsFristMs } from '../areas/proj/recording_deadline.ts';

const a = (o = {}) => ({ bpm: 120, quant: 0, vorzaehlerTakte: 0, laufend: false, loopBeats: null, ...o });

test('quittungsFristMs: the four cases of the plan', () => {
  assert.equal(quittungsFristMs(a({ bpm: 60, quant: 2, vorzaehlerTakte: 4 })), (4 + 16) * 1000 + 4000);   // 24000
  assert.equal(quittungsFristMs(a({ bpm: 120, quant: 0, vorzaehlerTakte: 0 })), 4000);
  assert.equal(quittungsFristMs(a({ bpm: 60, laufend: true })), 8000);                                       // next bar: 4 beats at 60 BPM
  assert.equal(quittungsFristMs(a({ bpm: 120, laufend: true, loopBeats: 8 })), (4 + 8) * 500 + 4000);        // 10000
});
test('quittungsFristMs: quant 1 adds one beat, count-in 1 and 2 bars add 4 and 8 beats, a stopped transport ignores loopBeats', () => {
  assert.equal(quittungsFristMs(a({ bpm: 120, quant: 1 })), 500 + 4000);
  assert.equal(quittungsFristMs(a({ bpm: 120, vorzaehlerTakte: 1 })), 4 * 500 + 4000);
  assert.equal(quittungsFristMs(a({ bpm: 120, vorzaehlerTakte: 2 })), 8 * 500 + 4000);
  assert.equal(quittungsFristMs(a({ bpm: 120, loopBeats: 8 })), 4000, 'loopBeats count only for a running start');
});
