// Return fader lane (return automation slice 2), task 4: the model and the commands take a `fader` lane on a return and refuse it on the master and on a
// group; a return takes no other device lane. One undo step per command, the lane starts at the fader of the return.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, BefehlFehler, laneStart } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt, kanonisch } from '../project/model.ts';
import { wende } from '../project/patch.ts';
import { ohneAbgeleitetes } from './support/project.mjs';

const ok = (p, b) => fuehreAus(p, b);
const lehntAb = (p, b, grund, text) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === grund && (!text || text.test(e.detail)),
  `expected ${grund} for ${JSON.stringify(b).slice(0, 100)}`);
const gueltig = (p) => pruefeProjekt(JSON.parse(JSON.stringify(p))).fehler;
const mitReturn = () => {
  let p = neuesProjekt('T');
  p = ok(p, { befehl: 'spur_neu', art: 'audio', name: 'A' }).projekt;
  p = ok(p, { befehl: 'return_neu', name: 'Hall' }).projekt;
  return ok(p, { befehl: 'return_aendern', return_id: p.returns?.[0]?.id ?? 'r1', fader_db: -6 }).projekt;
};
const mitGruppe = () => ok(ok(neuesProjekt('T'), { befehl: 'spur_neu', art: 'audio', name: 'A' }).projekt, { befehl: 'gruppenspur_neu', name: 'G' }).projekt;

test('return_fader_lane_anlegen: auto_neu on a return makes a fader lane that starts at the return fader; points follow the track rules', () => {
  const p = mitReturn();
  const rid = p.returns[0].id;
  assert.equal(p.returns[0].fader_db, -6);
  const r = ok(p, { befehl: 'auto_neu', strang_id: rid, ziel: 'fader' });
  assert.deepEqual(r.projekt.returns[0].automation, [{ id: 'a1', ziel: 'fader', punkte: [{ beat: 0, wert: -6 }, { beat: 32, wert: -6 }] }]);
  assert.equal(r.betrifft_wiedergabe, true);
  assert.equal(gueltig(r.projekt), undefined, 'the model accepts the lane');
  assert.equal(p.returns[0].automation, undefined, 'the input is untouched');
  assert.equal(kanonisch(JSON.parse(kanonisch(r.projekt))), kanonisch(r.projekt), 'canonical form is stable');
  lehntAb(r.projekt, { befehl: 'auto_neu', strang_id: rid, ziel: 'fader' }, 'lane_doppelt');
  // the points: a ramp -200 to 0 dB, the fader range -200..6 as on a track
  const q = ok(r.projekt, { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 0, wert: -200 }, { beat: 16, wert: 0 }], loesche_von: 0, loesche_bis: 1e6 });
  assert.deepEqual(q.projekt.returns[0].automation[0].punkte, [{ beat: 0, wert: -200 }, { beat: 16, wert: 0 }]);
  assert.equal(gueltig(q.projekt), undefined);
  lehntAb(r.projekt, { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 4, wert: 7 }] }, 'argument_ungueltig');
  // points in the same command
  const m = ok(p, { befehl: 'auto_neu', strang_id: rid, ziel: 'fader', punkte: [{ beat: 0, wert: -200 }, { beat: 16, wert: 0, form: 's' }] });
  assert.equal(m.projekt.returns[0].automation[0].punkte.length, 2);
  // a chain lane on a return still works next to it (the insert lane is not touched by the new target)
  const mi = ok(p, { befehl: 'insert_setzen', strang_id: rid, pos: 0, art: 'komp' }).projekt;
  const beides = ok(ok(mi, { befehl: 'auto_neu', strang_id: rid, ziel: 'fader' }).projekt, { befehl: 'auto_neu', strang_id: rid, ziel: 'insert.i1.schwelle' });
  assert.deepEqual(beides.projekt.returns[0].automation.map((l) => l.ziel), ['fader', 'insert.i1.schwelle']);
  assert.equal(gueltig(beides.projekt), undefined);
  // the lane is deleted again like any lane
  const weg = ok(r.projekt, { befehl: 'auto_loeschen', lane_id: 'a1' });
  assert.equal(weg.projekt.returns[0].automation, undefined);
});

test('master_fader_lane_abgelehnt: neither the command nor the model takes a volume curve on the master', () => {
  const p = mitReturn();
  lehntAb(p, { befehl: 'auto_neu', strang_id: 'master', ziel: 'fader' }, 'ziel_unbekannt', /no volume curve/);
  lehntAb(p, { befehl: 'auto_neu', strang_id: 'master', ziel: 'pan' }, 'ziel_unbekannt');
  const roh = JSON.parse(JSON.stringify(p));
  roh.master.automation = [{ id: 'a1', ziel: 'fader', punkte: [{ beat: 0, wert: 0 }, { beat: 8, wert: -6 }] }];
  roh.naechste_id.lane = 2;
  const f = pruefeProjekt(roh).fehler;
  assert.ok(f && /master\.automation\[0\]\.ziel/.test(f.wo ?? f) || /master/.test(JSON.stringify(f)), `the model refuses it: ${JSON.stringify(f)}`);
  assert.match(JSON.stringify(f), /no volume curve/);
  // positive control: the same lane on the return is valid
  const r = JSON.parse(JSON.stringify(p));
  r.returns[0].automation = [{ id: 'a1', ziel: 'fader', punkte: [{ beat: 0, wert: 0 }, { beat: 8, wert: -6 }] }];
  r.naechste_id.lane = 2;
  assert.equal(pruefeProjekt(r).fehler, undefined);
});

test('gruppe_fader_lane_abgelehnt: a group takes no volume curve either', () => {
  const p = mitGruppe();
  const gid = p.gruppen[0].id;
  lehntAb(p, { befehl: 'auto_neu', strang_id: gid, ziel: 'fader' }, 'ziel_unbekannt', /no volume curve/);
  const roh = JSON.parse(JSON.stringify(p));
  roh.gruppen[0].automation = [{ id: 'a1', ziel: 'fader', punkte: [{ beat: 0, wert: 0 }, { beat: 8, wert: -6 }] }];
  roh.naechste_id.lane = 2;
  assert.match(JSON.stringify(pruefeProjekt(roh).fehler), /no volume curve/);
});

test('return_pan_lane_abgelehnt: a return takes the fader lane only, no pan, mute, solo or device lane', () => {
  const p = mitReturn();
  const rid = p.returns[0].id;
  for (const ziel of ['pan', 'mute', 'solo', 'geraet.cutoff']) lehntAb(p, { befehl: 'auto_neu', strang_id: rid, ziel }, 'ziel_unbekannt');
  const roh = JSON.parse(JSON.stringify(p));
  roh.returns[0].automation = [{ id: 'a1', ziel: 'pan', punkte: [{ beat: 0, wert: 0 }, { beat: 8, wert: 0.5 }] }];
  roh.naechste_id.lane = 2;
  assert.ok(pruefeProjekt(roh).fehler, 'the model refuses a pan lane on a return');
  // a track keeps taking all of them (nothing narrowed for tracks)
  const t = ok(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'pan' });
  assert.equal(t.projekt.spuren[0].automation[0].ziel, 'pan');
});

test('undo_redo_return_lane: one command is one patch; undo removes the lane, redo restores it deep-equal', () => {
  const p = mitReturn();
  const rid = p.returns[0].id;
  const r = ok(p, { befehl: 'auto_neu', strang_id: rid, ziel: 'fader', punkte: [{ beat: 0, wert: -200 }, { beat: 16, wert: 0 }] });
  const zurueck = wende(r.projekt, r.zurueck);
  assert.equal(ohneAbgeleitetes(zurueck), ohneAbgeleitetes(p), 'undo removes the lane');
  assert.equal(zurueck.returns[0].automation, undefined);
  const vor = wende(zurueck, r.vor);
  assert.deepEqual(JSON.parse(ohneAbgeleitetes(vor)), JSON.parse(ohneAbgeleitetes(r.projekt)), 'redo restores it');
  assert.deepEqual(vor.returns[0].automation, r.projekt.returns[0].automation);
  // an edit of the points and the delete are steps as well
  const e = ok(r.projekt, { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 8, wert: -30 }] });
  assert.equal(ohneAbgeleitetes(wende(e.projekt, e.zurueck)), ohneAbgeleitetes(r.projekt));
  const d = ok(e.projekt, { befehl: 'auto_loeschen', lane_id: 'a1' });
  assert.deepEqual(wende(d.projekt, d.zurueck).returns[0].automation, e.projekt.returns[0].automation);
});

test('laneStart_liest_return_fader: the start value of a return lane is the fader of the return', () => {
  const p = mitReturn();
  assert.equal(laneStart(p.returns[0], 'fader'), -6);
  const q = ok(p, { befehl: 'return_aendern', return_id: p.returns[0].id, fader_db: 3 }).projekt;
  assert.equal(laneStart(q.returns[0], 'fader'), 3);
});
