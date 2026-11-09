// 1.10 slice 3, Task 10b: the merge renders dry (the sends are not part of the render tap) and the new track takes over the sends of the sources,
// but only if all sources have identical sends; otherwise merge_sends. Pure calculation here; the real render is a point of the acceptance (Task 13).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { mergePlan, mergeRegler, mergeSicht, baueMergeProjekt, pruefeMergeNochGleich, MergeFehler } from '../project/merge.ts';
import { routingRegler } from '../project/render.ts';

const SHA = 'c'.repeat(64);
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
// s1..s3 audio tracks with a clip each, returns r1 (Hall) and r2 (Plate), no groups
function basis() {
  let p = neuesProjekt('T');
  p = lauf(p, ['Kick', 'Bass', 'Lead'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  for (const id of ['s1', 's2', 's3']) p = lauf(p, [{ befehl: 'clip_neu', spur_id: id, art: 'audio', start_beat: 0, laenge_beats: 16, sha256: SHA, name: id }]);
  return lauf(p, [{ befehl: 'return_neu', name: 'Hall' }, { befehl: 'return_neu', name: 'Plate' }]);
}
const send = (p, s, r, db) => lauf(p, [{ befehl: 'send_setzen', strang_id: s, return_id: r, db }]);
const A = { spur_ids: ['s1', 's2'], von_beat: 4, bis_beat: 12 };
const grund = (f) => { try { f(); } catch (e) { assert.ok(e instanceof MergeFehler, String(e)); return e.grund; } return null; };

test('10b same sends: the new track carries them in the same undo step, the sources are muted', () => {
  const p = send(send(basis(), 's1', 'r1', -6), 's2', 'r1', -6);
  const z = mergePlan(p, A, 'andreas');
  assert.deepEqual(z.sends, [{ id: 'r1', db: -6 }]);
  const { projekt, spurId } = baueMergeProjekt(p, z, { sha256: SHA, pfad: '/x.wav' }, 'andreas');
  const neu = projekt.spuren.find((s) => s.id === spurId);
  assert.deepEqual(neu.sends, [{ id: 'r1', db: -6 }]);
  assert.deepEqual(projekt.spuren.filter((s) => ['s1', 's2'].includes(s.id)).map((s) => s.mute), [true, true]);
  assert.deepEqual(projekt.spuren.find((s) => s.id === 's1').sends, [{ id: 'r1', db: -6 }], 'the sources keep their sends (muted, nothing sounds twice)');
});

test('10b different sends: merge_sends in all three cases; negative control: both without sends passes and the new track carries none', () => {
  let a = send(send(basis(), 's1', 'r1', -6), 's2', 'r1', -9);
  assert.equal(grund(() => mergePlan(a, A, 'andreas')), 'merge_sends', 'a: different levels');
  let b = send(send(basis(), 's1', 'r1', -6), 's2', 'r2', -6);
  assert.equal(grund(() => mergePlan(b, A, 'andreas')), 'merge_sends', 'b: different returns');
  let c = send(basis(), 's1', 'r1', -6);
  assert.equal(grund(() => mergePlan(c, A, 'andreas')), 'merge_sends', 'c: one with a send, one without');
  const z = mergePlan(basis(), A, 'andreas');
  assert.deepEqual(z.sends, []);
  const { projekt, spurId } = baueMergeProjekt(basis(), z, { sha256: SHA, pfad: '/x.wav' }, 'andreas');
  assert.ok(!('sends' in projekt.spuren.find((s) => s.id === spurId)) || projekt.spuren.find((s) => s.id === spurId).sends === undefined);
  assert.equal(grund(() => mergePlan(send(send(basis(), 's1', 'r1', -6), 's2', 'r1', -6), A, 'andreas')), null, 'identical sends are accepted');
});

test('10b dry: mergeRegler sets every send to -200 and mutes every existing return; mutation (no trocken) leaks the send into the render', () => {
  const p = send(send(basis(), 's1', 'r1', -6), 's2', 'r1', -6);
  const r = mergeRegler(p, ['s1', 's2']);
  for (const s of [1, 2, 3]) for (const x of [1, 2]) assert.equal(r[`spur/${s}/send/${x}`], -200, `spur/${s}/send/${x}`);
  assert.deepEqual([r['ret/1/mute'], r['ret/2/mute']], [1, 1]);
  assert.ok(!Object.keys(r).some((k) => /send/.test(k) && r[k] > -200), 'no value feeds a return');
  const undicht = routingRegler(p);                                  // what the render would get without "trocken"
  assert.equal(undicht['spur/1/send/1'], -6, 'the mutation would let the send sound in the render');
});

test('10b without returns the render file is exactly as before slice 3', () => {
  let p = neuesProjekt('T');
  p = lauf(p, ['Kick', 'Bass'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  const r = mergeRegler(p, ['s1', 's2']);
  assert.ok(!Object.keys(r).some((k) => /send|^ret\//.test(k)));
  assert.equal(Object.keys(r).length, 32 * 2 + 2 * 2, 'mute and solo of 32 tracks plus fader and pan of the two sources');
});

test('10b stale: a send of a source changed during the render makes the state stale; the same state stays null', () => {
  const p = send(send(basis(), 's1', 'r1', -6), 's2', 'r1', -6);
  const z = mergePlan(p, A, 'andreas');
  assert.equal(pruefeMergeNochGleich(p, z), null);
  assert.equal(pruefeMergeNochGleich(send(p, 's1', 'r1', -7), z), 'veraltet');
  assert.notEqual(mergeSicht(p, ['s1', 's2']), mergeSicht(send(p, 's2', 'r2', -3), ['s1', 's2']));
});
