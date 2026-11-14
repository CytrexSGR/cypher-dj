// Loop slots L1, L2: the loop of a module group, the position of the playhead inside it and the beat grid (public/loop_wave.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loopVonGruppe, loopPosition, raster } from '../public/loop_wave.js';

const PROJEKT = {
  spuren: [
    { art: 'audio', ausgang: { art: 'gruppe', id: 'g1' }, name: 'Loop', clips: [{ art: 'audio', loop_beats: 4, start_beat: 0, quelle: { sha256: 'aa' }, warp: { versatz_beats: 0 } }] },
    { art: 'audio', ausgang: { art: 'gruppe', id: 'g2' }, name: 'Drums original', clips: [{ art: 'audio', loop_beats: 4, quelle: { sha256: 'bb' } }] },
    { art: 'audio', ausgang: { art: 'gruppe', id: 'g6' }, name: 'Loop', clips: [{ art: 'audio', loop_beats: 16, start_beat: 2, quelle: { sha256: 'cc' }, warp: { versatz_beats: 0.5 } }] },
  ],
};

test('the loop of a module group is the audio clip on the group itself (not on a stem group)', () => {
  assert.deepEqual(loopVonGruppe(PROJEKT, 'g1'), { sha: 'aa', beats: 4, start: 0, versatz: 0 });
  assert.deepEqual(loopVonGruppe(PROJEKT, 'g6'), { sha: 'cc', beats: 16, start: 2, versatz: 0.5 });
  assert.equal(loopVonGruppe(PROJEKT, 'gX'), null);
  assert.equal(loopVonGruppe(null, 'g1'), null);
  assert.equal(loopVonGruppe({ spuren: [{ art: 'audio', ausgang: { id: 'g1' }, clips: [{ art: 'audio', loop_beats: 0, quelle: { sha256: 'x' } }] }] }, 'g1'), null, 'no loop length: no waveform');
});

test('the playhead folds the project beat into the loop; stopped or before the clip: none', () => {
  const l4 = { sha: 'aa', beats: 4, start: 0, versatz: 0 };
  assert.equal(loopPosition(0, l4), 0);
  assert.equal(loopPosition(5.5, l4), 1.5);
  assert.equal(loopPosition(63.75, l4), 3.75);
  assert.equal(loopPosition(null, l4), null);
  const l16 = { sha: 'cc', beats: 16, start: 2, versatz: 0.5 };
  assert.equal(loopPosition(2.5, l16), 0);
  assert.equal(loopPosition(18.5, l16), 0);
  assert.equal(loopPosition(1, l16), null);
});

test('the grid has one line per beat and marks every bar start with its number', () => {
  const r = raster(16);
  assert.equal(r.length, 16);
  assert.deepEqual(r.filter((x) => x.eins).map((x) => [x.beat, x.takt]), [[0, 1], [4, 2], [8, 3], [12, 4]]);
  assert.deepEqual(raster(4).filter((x) => x.eins).map((x) => x.takt), [1]);
});
