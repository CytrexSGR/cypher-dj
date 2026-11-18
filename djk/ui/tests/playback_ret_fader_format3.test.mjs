// Return fader lane (return automation slice 2), task 5: the translator sends the fader lane of a return as returns[].auto in cypherdj-arr/3 (the format is
// the version gate: an old core refuses /3 as a whole). A project without such a lane keeps /1 or /2 and the exact bytes of before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uebersetze, WiedergabeFehler, WIEDERGABE_FORMAT_3 } from '../project/playback.ts';
import { pruefeProjekt, MAX_AUTO_PUNKTE } from '../project/model.ts';
import { fuehreAus } from '../project/commands.ts';
import { specProjekt, kopie, SHA_A } from './support/project.mjs';

const opt = (extra = {}) => ({ nr: 1, audioOrdner: '/arbeit/arr/audio', frames: (sha) => (sha === SHA_A ? 2_000_000 : null), ...extra });
const mitReturns = () => {
  let p = fuehreAus(pruefeProjekt(kopie(specProjekt())).projekt, { befehl: 'return_neu', name: 'Hall' }).projekt;
  return fuehreAus(p, { befehl: 'return_neu', name: 'Plate' }).projekt;
};
const mitLane = (punkte, rid = 'r2') => {
  const p = mitReturns();
  return fuehreAus(p, { befehl: 'auto_neu', strang_id: rid, ziel: 'fader', punkte }).projekt;
};

test('wiedergabe_ret_fader_format3: a return fader lane makes the file /3 with returns[].auto in the track point format', () => {
  assert.equal(WIEDERGABE_FORMAT_3, 'cypherdj-arr/3');
  const w = uebersetze(mitLane([{ beat: 0, wert: -200 }, { beat: 8, wert: -6, form: 's' }, { beat: 8, wert: -12, form: 'sprung' }, { beat: 16, wert: 0 }]), opt());
  assert.equal(w.format, 'cypherdj-arr/3');
  assert.deepEqual(w.returns[1].auto, [{ ziel: 'fader', punkte: [[0, -200, 0], [8, -6, 1], [8, -12, 2], [16, 0, 0]] }]);
  assert.equal('auto' in w.returns[0], false, 'a return without a lane carries no field');
  assert.deepEqual(w.returns.map((r) => r.nr), [1, 2]);
  assert.deepEqual(w.gruppen, [], 'groups stay present in /3 as in /2');
});

test('wiedergabe_ret_fader_format3: the lane points count against the point limit (zu_gross), the limit itself passes', () => {
  const viele = (n) => Array.from({ length: n }, (_, i) => ({ beat: i, wert: 0 }));
  assert.equal(MAX_AUTO_PUNKTE, 65536);
  // the model caps a lane at 8192 points; the translator's own limit is checked on the sum, so the lanes are set directly (no model check on this path)
  const p = mitLane([{ beat: 0, wert: 0 }]);
  p.returns[1].automation[0].punkte = viele(MAX_AUTO_PUNKTE - 1);
  p.returns[0].automation = [{ id: 'a8', ziel: 'fader', punkte: viele(1) }];
  assert.equal(uebersetze(p, opt()).format, 'cypherdj-arr/3', 'exactly the limit goes');
  p.returns[0].automation[0].punkte = viele(2);
  assert.throws(() => uebersetze(p, opt()), (e) => e instanceof WiedergabeFehler && e.grund === 'zu_gross', 'one more point refuses');
});

test('wiedergabe_ohne_ret_lane_bytegleich: without a return lane the file stays /1 or /2, byte for byte as before', () => {
  const basis = uebersetze(specProjekt(), opt());
  assert.equal(basis.format, 'cypherdj-arr/1');
  const p = mitReturns();
  const w2 = uebersetze(p, opt());
  assert.equal(w2.format, 'cypherdj-arr/2');
  assert.equal(JSON.stringify(w2).includes('"auto"'), false);
  // a track lane alone is /2 and has no returns[].auto
  const t = fuehreAus(p, { befehl: 'auto_neu', strang_id: 's1', ziel: 'fader' }).projekt;
  const wt = uebersetze(t, opt());
  assert.equal(wt.format, 'cypherdj-arr/2');
  assert.ok(wt.returns.every((r) => !('auto' in r)));
  // the lane on a return that is then removed: back to /2, same bytes as the project that never had it
  const mit = mitLane([{ beat: 0, wert: 0 }, { beat: 4, wert: -6 }]);
  const ohne = JSON.parse(JSON.stringify(mit));
  delete ohne.returns[1].automation;
  assert.equal(JSON.stringify(uebersetze(ohne, opt())), JSON.stringify(w2));
  assert.notEqual(JSON.stringify(uebersetze(mit, opt())), JSON.stringify(w2));
});
