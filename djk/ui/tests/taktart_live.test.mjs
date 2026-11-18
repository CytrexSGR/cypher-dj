// Studio follows the time signature n/4, T0: shared helpers (no behaviour change).
import test from 'node:test';
import assert from 'node:assert/strict';
import { takteProLive, liveBeats, TAKT_STANDARD } from '../project/taktart_live.ts';
import { AB, abRaster } from '../hand_operation.ts';

test('takteProLive: undefined, null, [4,4], [3,4], [6,8], [13,4], [1,4], [3.5,4], "3" give 4,4,4,3,4,4,4,4,4', () => {
  const eingaben = [undefined, null, [4, 4], [3, 4], [6, 8], [13, 4], [1, 4], [3.5, 4], '3'];
  assert.deepEqual(eingaben.map((t) => takteProLive(t)), [4, 4, 4, 3, 4, 4, 4, 4, 4]);
  assert.equal(TAKT_STANDARD, 4);
});

test('liveBeats(4) === 64 and liveBeats(3) === 48 and liveBeats(12) === 192', () => {
  assert.equal(liveBeats(4), 64);
  assert.equal(liveBeats(3), 48);
  assert.equal(liveBeats(12), 192);
});

test('abRaster(k, 4) === AB[k] for jetzt, schlag, takt, phrase and an unknown key', () => {
  for (const k of ['jetzt', 'schlag', 'takt', 'phrase', 'unbekannt']) assert.equal(abRaster(k, 4), AB[k]);
  assert.equal(abRaster('unbekannt', 4), undefined);
});

test("abRaster('phrase', 3) === 24 and ('takt', 3) === 3 and ('schlag', 3) === 1", () => {
  assert.equal(abRaster('phrase', 3), 24);
  assert.equal(abRaster('takt', 3), 3);
  assert.equal(abRaster('schlag', 3), 1);
  assert.equal(abRaster('jetzt', 3), 0);
});
