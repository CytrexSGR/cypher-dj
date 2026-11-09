// 1.10 slice 7 (T6, spec 5.7, plan D6 to D8): the pure resample calculation: plan and refusals, the new project state. No server, no core, no file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt, sucheSpur } from '../project/model.ts';
import { PAN_MITTE_DB } from '../project/merge.ts';
import { resamplePlan, baueResampleProjekt, ResampleFehler, RESAMPLE_MAX_BEATS } from '../project/resample.ts';

const SHA = 'd'.repeat(64);
const lauf = (p, b, quelle = 'andreas') => fuehreListeAus(p, b, { quelle }).projekt;
const grund = (f) => { try { f(); } catch (e) { assert.ok(e instanceof ResampleFehler, String(e)); return e.grund; } return null; };
const VORGABE = { von: 0, bis: 16 };
// s1 Kick, s2 Bass (both in group g1), s3 Lead (master), return r1
function projekt() {
  let p = neuesProjekt('T');
  p = lauf(p, ['Kick', 'Bass', 'Lead'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  p = lauf(p, [{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 8, sha256: SHA, name: 'k' }]);
  p = lauf(p, [{ befehl: 'gruppenspur_neu', name: 'Drums', mitglieder: ['s1', 's2'] }, { befehl: 'return_neu', name: 'Hall' }]);
  return p;
}

test('6.1 plan: the four strip kinds map to the tap kind and number, point post by default, range from the default', () => {
  const p = projekt();
  const k = (id, d = {}) => { const z = resamplePlan(p, { strang_id: id, ...d }, VORGABE); return [z.art, z.nr, z.punkt, z.von, z.bis, z.name]; };
  assert.deepEqual(k('s2'), [0, 2, 'post', 0, 16, 'Bass']);
  assert.deepEqual(k('g1'), [1, 1, 'post', 0, 16, 'Drums']);
  assert.deepEqual(k('r1'), [2, 1, 'post', 0, 16, 'Hall']);
  assert.deepEqual(k('master'), [3, 1, 'post', 0, 16, 'Master']);
  assert.deepEqual(k('s3', { punkt: 'pre', von_beat: 4, bis_beat: 12 }), [0, 3, 'pre', 4, 12, 'Lead']);
  assert.equal(RESAMPLE_MAX_BEATS, 256);
});

test('6.2 plan refusals (error cases): unknown strip, bad arguments, range of 257 beats, a short or negative range, 32 tracks full', () => {
  const p = projekt();
  const g = (d) => grund(() => resamplePlan(p, d, VORGABE));
  assert.equal(g({ strang_id: 's9' }), 'spur_unbekannt');
  assert.equal(g({ strang_id: 'g7' }), 'spur_unbekannt');
  assert.equal(g({}), 'argument_ungueltig');
  assert.equal(g({ strang_id: 's1', punkt: 'mitte' }), 'argument_ungueltig');
  assert.equal(g({ strang_id: 's1', mehr: 1 }), 'argument_ungueltig');
  assert.equal(g({ strang_id: 's1', von_beat: 'a' }), 'argument_ungueltig');
  assert.equal(g({ strang_id: 's1', von_beat: 0, bis_beat: 257 }), 'zu_gross');
  assert.equal(g({ strang_id: 's1', von_beat: 0, bis_beat: 0.5 }), 'export_bereich');
  assert.equal(g({ strang_id: 's1', von_beat: -1, bis_beat: 4 }), 'export_bereich');
  assert.equal(grund(() => resamplePlan(p, { strang_id: 's1' }, { von: 0, bis: 0 })), 'export_bereich', 'an empty song has no default range');
  assert.equal(g({ strang_id: 's1', von_beat: 0, bis_beat: 256 }), null, 'negative control: exactly 256 beats pass');
  let voll = p;
  for (let n = 0; n < 29; n++) voll = lauf(voll, [{ befehl: 'spur_neu', art: 'audio', name: `T${n}` }]);
  assert.equal(voll.spuren.length, 32);
  assert.equal(grund(() => resamplePlan(voll, { strang_id: 's1' }, VORGABE)), 'merge_keine_spur_frei');
});

test('6.3 new state: track "<source> (resampled)" with one clip, gain PAN_MITTE_DB, output master, below the source for a track, at the end otherwise', () => {
  const p = projekt();
  const datei = { sha256: SHA, pfad: '/p/resample/resample-7.wav' };
  const bau = (id, d = {}) => baueResampleProjekt(p, resamplePlan(p, { strang_id: id, ...d }, VORGABE), datei, 'andreas');
  const t = bau('s1', { von_beat: 2, bis_beat: 10 });
  assert.deepEqual(t.projekt.spuren.map((s) => s.name), ['Kick', 'Kick (resampled)', 'Bass', 'Lead']);
  const neu = sucheSpur(t.projekt, t.spurId);
  assert.equal(neu.ausgang, undefined, 'output master');
  assert.equal(neu.clips.length, 1);
  assert.deepEqual([neu.clips[0].start_beat, neu.clips[0].laenge_beats, neu.clips[0].gain_db, neu.clips[0].quelle.sha256], [2, 8, PAN_MITTE_DB, SHA]);
  assert.deepEqual(sucheSpur(t.projekt, 's1'), sucheSpur(p, 's1'), 'the source is unchanged');
  assert.deepEqual(p.spuren.map((s) => s.name), ['Kick', 'Bass', 'Lead'], 'the input project is untouched');
  for (const id of ['g1', 'r1', 'master']) {
    const x = bau(id);
    assert.equal(x.projekt.spuren.at(-1).id, x.spurId, `${id}: at the end`);
    assert.equal(x.projekt.spuren.at(-1).clips[0].laenge_beats, 16);
  }
  assert.equal(bau('g1').projekt.spuren.at(-1).name, 'Drums (resampled)');
  assert.equal(bau('master').projekt.spuren.at(-1).name, 'Master (resampled)');
  // a long source name is cut to 80 characters
  const lang = lauf(p, [{ befehl: 'spur_aendern', spur_id: 's3', name: 'x'.repeat(80) }]);
  const z = resamplePlan(lang, { strang_id: 's3' }, VORGABE);
  assert.equal(baueResampleProjekt(lang, z, datei, 'andreas').projekt.spuren.at(-1).name.length, 80);
});
