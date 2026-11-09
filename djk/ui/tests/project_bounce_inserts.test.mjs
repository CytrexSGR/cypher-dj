// Integration review (b1-integration), spec 1.14 D10 with 1.10 slice 4: the bounce is dry and bakes no insert chain, so it refuses deterministically
// with merge_inserts: an_ort refuses a track with inserts, neue_spur a source with inserts (mergePlan), einfuegen a source or a target with inserts.
// The chains of groups, master and returns are not a refusal (see the test below).
// Pure model, no server, no core.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { MergeFehler } from '../project/merge.ts';
import { bouncePlan, bounceRegler } from '../project/bounce.ts';

const SHA = 'c'.repeat(64);
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
const grund = (f) => { try { f(); } catch (e) { assert.ok(e instanceof MergeFehler, String(e)); return e.grund; } return null; };
const stufe = (strang, art = 'komp') => ({ befehl: 'insert_setzen', strang_id: strang, pos: 0, art });
// s1 Kick (clip), s2 Ziel (audio), s3 Bass (clip); `mit` lists the strips that get a compressor stage (the eq pool has one instance only)
function projekt(mit = []) {
  let p = neuesProjekt('T');
  p = lauf(p, ['Kick', 'Ziel', 'Bass'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  p = lauf(p, ['s1', 's3'].map((id) => ({ befehl: 'clip_neu', spur_id: id, art: 'audio', start_beat: 0, laenge_beats: 16, sha256: SHA, name: id })));
  return mit.length ? lauf(p, mit.map((s) => stufe(s))) : p;
}
const EINF = { art: 'einfuegen', spur_ids: ['s1'], von_beat: 0, bis_beat: 8, ziel_spur_id: 's2', ziel_beat: 0 };
const AN_ORT = { art: 'an_ort', spur_id: 's1' };
const NEU = { art: 'neue_spur', spur_ids: ['s1'] };

test('negative control: without inserts all three arts plan', () => {
  const p = projekt();
  for (const d of [AN_ORT, NEU, EINF]) assert.equal(grund(() => bouncePlan(p, d, 'andreas')), null, d.art);
});
test('negative control: a chain on a track that is neither source nor target does not refuse', () => {
  const p = projekt(['s3']);
  for (const d of [AN_ORT, NEU, EINF]) assert.equal(grund(() => bouncePlan(p, d, 'andreas')), null, d.art);
});
test('positive control: neue_spur refuses a source with inserts (inherited from mergePlan)', () => {
  assert.equal(grund(() => bouncePlan(projekt(['s1']), NEU, 'andreas')), 'merge_inserts');
});
test('D10: an_ort refuses a track with inserts', () => {
  assert.equal(grund(() => bouncePlan(projekt(['s1']), AN_ORT, 'andreas')), 'merge_inserts');
});
test('D10: einfuegen refuses a source with inserts', () => {
  assert.equal(grund(() => bouncePlan(projekt(['s1']), EINF, 'andreas')), 'merge_inserts');
});
test('D10: einfuegen refuses a source among several when only one has inserts', () => {
  assert.equal(grund(() => bouncePlan(projekt(['s3']), { ...EINF, spur_ids: ['s1', 's3'] }, 'andreas')), 'merge_inserts');
});
test('D10: einfuegen refuses a target with inserts', () => {
  assert.equal(grund(() => bouncePlan(projekt(['s2']), EINF, 'andreas')), 'merge_inserts');
});
test('order: an instrument track is refused as bounce_nur_audio before the insert rule is looked at', () => {
  const p = lauf(projekt(), [{ befehl: 'spur_neu', art: 'instrument', name: 'Pad' }, stufe('s4')]);
  assert.equal(grund(() => bouncePlan(p, { art: 'an_ort', spur_id: 's4' }, 'andreas')), 'bounce_nur_audio');
});

// Chains of groups, master and returns are no refusal (measured: a stage in the render snapshot without its ins/ rows is bypassed, the audio is bit-equal
// to the dry render; messungen/2026-11-05-b1-integration/fix-master-kette-core.txt). The live chain acts once, later, on the bounced track.
function mitKetten() {
  let p = projekt();
  p = lauf(p, [{ befehl: 'gruppenspur_neu', name: 'G', mitglieder: ['s1', 's3'] }, { befehl: 'return_neu', name: 'Hall' }]);
  return lauf(p, [stufe('g1'), stufe('master'), stufe('r1')]);
}
test('chains on a group, the master or a return do not refuse any art', () => {
  const p = mitKetten();
  assert.equal((p.master.inserts ?? []).length + p.gruppen[0].inserts.length + p.returns[0].inserts.length, 3, 'the control: they exist');
  for (const d of [AN_ORT, NEU, { art: 'neue_spur', gruppe_id: 'g1' }, EINF]) assert.equal(grund(() => bouncePlan(p, d, 'andreas')), null, d.art);
});
test('the bounce render controls carry no ins/ row (the refusal is what keeps a chain out of them)', () => {
  const p = projekt();
  const z = { art: 'an_ort', spurIds: ['s1'], von: 0, bis: 16, quelle: 'andreas', name: 'x', sicht: '' };
  assert.equal(Object.keys(bounceRegler(p, z)).filter((k) => k.startsWith('ins/')).length, 0);
});
