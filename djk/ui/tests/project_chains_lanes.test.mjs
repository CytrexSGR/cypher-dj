// 1.12 slice 6: automation lanes on insert stage parameters (`insert.<id>.<param>`) and rack macros (`rack.m1..m4`): project model, commands, translator.
// Pure calculation: no server, no core (the core side is kern test_arr_auto_kette, the audible side is check/acceptance_lanes_chain.mjs).
// Cases: A refusals and the controls next to them, B lanes on every kind of strip, C one writer per parameter (both directions), D the lane goes with
// its target, E the editors respect the parameter's own range, F translator (chain_auto, /2, old projects the same), G limits, H the model is closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt, kanonisch, wiedergabeSicht, MAX_KETTEN_LANEN } from '../project/model.ts';
import { uebersetze } from '../project/playback.ts';
import { wende } from '../project/patch.ts';
import { basisProjekt, szenarioOhneInserts } from './support/inserts_scenario.mjs';
import { ohneAbgeleitetes } from './support/project.mjs';

const ok = (p, b) => fuehreAus(p, b);
const lehntAb = (p, b, grund) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === grund,
  `expected ${grund} for ${JSON.stringify(b).slice(0, 100)}`);
const pruefe = (p, r) => {   // valid, forward and back patches round-trip
  assert.equal(pruefeProjekt(r.projekt).fehler, undefined, JSON.stringify(pruefeProjekt(r.projekt)));
  assert.equal(ohneAbgeleitetes(wende(p, r.vor)), ohneAbgeleitetes(r.projekt));
  assert.equal(ohneAbgeleitetes(wende(r.projekt, r.zurueck)), ohneAbgeleitetes(p));
};
const stufe = (p, strang, art = 'komp', pos = 0) => ok(p, { befehl: 'insert_setzen', strang_id: strang, pos, art }).projekt;
const W = (p) => uebersetze(p, { nr: 1, audioOrdner: '/x', frames: () => 96000 });
const alle = () => {   // s1..s3 with clips, group g1 (s2, s3), return r1; a komp on s1 (i1), g1 (i2), r1 (i3), master (i4)
  let p = basisProjekt();
  p = ok(p, { befehl: 'gruppenspur_neu', mitglieder: ['s2', 's3'] }).projekt;
  p = ok(p, { befehl: 'return_neu' }).projekt;
  for (const st of ['s1', 'g1', 'r1', 'master']) p = stufe(p, st);
  return p;
};
const lane = (p, strang, ziel, punkte) => ok(p, { befehl: 'auto_neu', strang_id: strang, ziel, ...(punkte ? { punkte } : {}) });
const strangVon = (p, id) => id === 'master' ? p.master : p.spuren.find((s) => s.id === id) ?? p.gruppen.find((g) => g.id === id) ?? p.returns.find((r) => r.id === id);

test('A: a stage lane is accepted: it starts at the row value, the model and the patches stay valid; the refusals and their negative controls', () => {
  const p = alle();
  const r = ok(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'insert.i1.schwelle' }); pruefe(p, r);
  const l = r.projekt.spuren[0].automation[0];
  assert.equal(l.ziel, 'insert.i1.schwelle');
  assert.deepEqual(l.punkte.map((q) => q.wert), [-18, -18], 'a new lane starts at the row value: nothing audible changes until a point is moved');
  assert.equal(r.betrifft_wiedergabe, true, 'a lane is playback');
  // refusals, each next to its control
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'insert.i9.schwelle' }, 'insert_unbekannt');
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'insert.i2.schwelle' }, 'insert_unbekannt');            // i2 is a stage of g1, not of s1
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'insert.i1.quatsch' }, 'argument_unbekannt');
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'insert.i1.an' }, 'argument_unbekannt');                // the stage switch is not a parameter lane
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'insert.i1.sc' }, 'argument_unbekannt');                // the key has its own commands
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'rack.m1' }, 'rack_unbekannt');                         // no rack on s1
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'rack.m5' }, 'ziel_unbekannt');
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'ins/komp/1/schwelle' }, 'ziel_unbekannt');
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's1', strang_id: 'g1', ziel: 'insert.i2.schwelle' }, 'argument_ungueltig');   // one of the two
  lehntAb(p, { befehl: 'auto_neu', strang_id: 's1', ziel: 'insert.i1.schwelle', punkte: [{ beat: 0, wert: 5 }] }, 'argument_ungueltig');   // schwelle -60..0
  assert.equal(ok(p, { befehl: 'auto_neu', strang_id: 's1', ziel: 'insert.i1.schwelle', punkte: [{ beat: 0, wert: -60 }, { beat: 4, wert: 0, form: 's' }] })
    .projekt.spuren[0].automation[0].punkte[1].form, 's', 'the range ends are inside (control)');
  lehntAb(r.projekt, { befehl: 'auto_neu', spur_id: 's1', ziel: 'insert.i1.schwelle' }, 'lane_doppelt');
  assert.equal(ok(r.projekt, { befehl: 'auto_neu', spur_id: 's1', ziel: 'insert.i1.ratio' }).projekt.spuren[0].automation.length, 2, 'another parameter of the stage is fine');
  // a switch or a step list of a built-in stage is no lane target (eq band switch, type)
  const e = stufe(p, 's1', 'eq', 1);
  lehntAb(e, { befehl: 'auto_neu', spur_id: 's1', ziel: 'insert.i5.b1/an' }, 'param_nicht_stetig');
  lehntAb(e, { befehl: 'auto_neu', spur_id: 's1', ziel: 'insert.i5.b1/typ' }, 'param_nicht_stetig');
  assert.equal(ok(e, { befehl: 'auto_neu', spur_id: 's1', ziel: 'insert.i5.b1/gain' }).projekt.spuren[0].automation[0].ziel, 'insert.i5.b1/gain', 'b1/gain is continuous');
  // a device lane does not belong on a group
  lehntAb(p, { befehl: 'auto_neu', strang_id: 'g1', ziel: 'fader' }, 'ziel_unbekannt');
});

test('B: lanes on a group, a return and the master (strang_id), and on a track (either spelling); lanes of all strips find their ID', () => {
  let p = alle();
  p = lane(p, 'g1', 'insert.i2.ratio').projekt;
  p = lane(p, 'r1', 'insert.i3.knie').projekt;
  p = lane(p, 'master', 'insert.i4.makeup').projekt;
  p = lane(p, 's1', 'insert.i1.mix').projekt;
  assert.equal(pruefeProjekt(p).fehler, undefined);
  const ids = [strangVon(p, 'g1'), strangVon(p, 'r1'), p.master, p.spuren[0]].map((st) => st.automation[0].id);
  assert.equal(new Set(ids).size, 4, 'lane ids are unique over all strips');
  assert.deepEqual(ids, ['a1', 'a2', 'a3', 'a4']);
  // the editors find a lane on any strip
  const q = ok(p, { befehl: 'auto_punkte', lane_id: ids[1], setze: [{ beat: 2, wert: 12 }] });
  pruefe(p, q);
  assert.deepEqual(strangVon(q.projekt, 'r1').automation[0].punkte.map((x) => [x.beat, x.wert]), [[0, 6], [2, 12], [32, 6]], 'the lane starts as two points on the loop brackets (0..32)');
  const lock = ok(p, { befehl: 'auto_aendern', lane_id: ids[2], gesperrt: true }).projekt;
  lehntAb(lock, { befehl: 'auto_punkte', lane_id: ids[2], setze: [{ beat: 1, wert: 3 }] }, 'lane_gesperrt');
  const weg = ok(p, { befehl: 'auto_loeschen', lane_id: ids[2] });
  pruefe(p, weg);
  assert.equal(weg.projekt.master.automation, undefined, 'an empty lane list is never written');
  lehntAb(p, { befehl: 'auto_loeschen', lane_id: 'a99' }, 'lane_unbekannt');
  // negative control: a project without such lanes has no automation key anywhere
  assert.ok(!JSON.stringify(alle()).includes('automation'));
});

test('B2: a rack macro lane (rack.m1..m4) on any strip with a rack; it starts at the live macro value', () => {
  let p = alle();
  p = ok(p, { befehl: 'rack_setzen', strang_id: 'g1', makros: [{ ziel: [{ insert: 'i2', param: 'schwelle', von: -40, bis: -10 }] }] }).projekt;
  p = ok(p, { befehl: 'rack_makro', strang_id: 'g1', nr: 2, wert: 0.25 }).projekt;
  const r = lane(p, 'g1', 'rack.m2'); pruefe(p, r);
  assert.deepEqual(strangVon(r.projekt, 'g1').automation[0].punkte.map((q) => q.wert), [0.25, 0.25]);
  lehntAb(r.projekt, { befehl: 'auto_punkte', lane_id: r.projekt.gruppen[0].automation[0].id, setze: [{ beat: 1, wert: 1.5 }] }, 'argument_ungueltig');   // 0..1
  assert.equal(ok(r.projekt, { befehl: 'auto_punkte', lane_id: r.projekt.gruppen[0].automation[0].id, setze: [{ beat: 1, wert: 1 }] }).projekt.gruppen[0].automation[0].punkte.length, 3);
  lehntAb(p, { befehl: 'auto_neu', strang_id: 'r1', ziel: 'rack.m1' }, 'rack_unbekannt');   // r1 has no rack
});

test('C: one writer per parameter: a lane on a mapped parameter and a mapping onto a lane are both refused; the macro itself can be automated', () => {
  let p = alle();
  p = ok(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [{ insert: 'i1', param: 'schwelle', von: -40, bis: -10 }] }] }).projekt;
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'insert.i1.schwelle' }, 'param_gemappt');
  assert.equal(ok(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'insert.i1.ratio' }).projekt.spuren[0].automation.length, 1, 'control: an unmapped parameter of the same stage');
  assert.equal(ok(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'rack.m1' }).projekt.spuren[0].automation.length, 1, 'the macro is the one writer: automate it');
  // the other direction
  const q = lane(stufe(alle(), 's2'), 's1', 'insert.i1.ratio').projekt;
  lehntAb(q, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [{ insert: 'i1', param: 'ratio', von: 1, bis: 8 }] }] }, 'param_hat_lane');
  assert.equal(ok(q, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [{ insert: 'i1', param: 'schwelle', von: -40, bis: -10 }] }] }).projekt.spuren[0].rack.slot, 1, 'control: another parameter maps');
  // a project file with both is not a valid project (the model is closed)
  const x = structuredClone(ok(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'insert.i1.ratio' }).projekt);
  x.spuren[0].automation[0].ziel = 'insert.i1.schwelle';
  x.spuren[0].automation[0].punkte.forEach((q) => { q.wert = -18; });
  x.spuren[0].rack = { slot: 1, namen: ['', '', '', ''], makros: [{ ziel: [{ insert: 'i1', param: 'schwelle', von: -40, bis: -10 }] }, { ziel: [] }, { ziel: [] }, { ziel: [] }], werte: [0, 0, 0, 0] };
  assert.match(pruefeProjekt(x).fehler, /param_gemappt/);
});

test('D: a lane goes with its target: stage removed, rack mapping removed, strip removed', () => {
  let p = alle();
  p = lane(p, 's1', 'insert.i1.ratio').projekt;
  p = ok(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [{ insert: 'i1', param: 'schwelle', von: -40, bis: -10 }] }] }).projekt;
  p = lane(p, 's1', 'rack.m1').projekt;
  assert.equal(p.spuren[0].automation.length, 2);
  const a = ok(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [] });
  pruefe(p, a);
  assert.deepEqual(a.projekt.spuren[0].automation.map((l) => l.ziel), ['insert.i1.ratio'], 'the macro lane goes with the rack, the stage lane stays');
  const b = ok(p, { befehl: 'insert_entfernen', insert_id: 'i1' });
  pruefe(p, b);
  assert.equal(b.projekt.spuren[0].automation, undefined, 'the stage takes both lanes: its parameter lane and (the rack is empty now) the macro lane');
  const c = ok(lane(alle(), 'g1', 'insert.i2.ratio').projekt, { befehl: 'gruppenspur_loeschen', gruppe_id: 'g1' });
  assert.equal(pruefeProjekt(c.projekt).fehler, undefined);
  assert.ok(!JSON.stringify(c.projekt).includes('insert.i2'), 'a deleted group takes its lanes');
  // replacing a stage by another kind (new id) takes the old stage's lanes
  const d = ok(lane(alle(), 's1', 'insert.i1.ratio').projekt, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'eq', ersetzen: true });
  assert.equal(pruefeProjekt(d.projekt).fehler, undefined);
  assert.equal(d.projekt.spuren[0].automation, undefined);
});

test('E: the editors take the parameter range (not the fader or 0..1): auto_punkte, auto_form, auto_vereinfachen on a stage lane', () => {
  let p = alle();
  p = lane(p, 's1', 'insert.i1.release', [{ beat: 0, wert: 10 }, { beat: 8, wert: 1000 }]).projekt;   // release 10..1000 ms
  const id = p.spuren[0].automation[0].id;
  lehntAb(p, { befehl: 'auto_punkte', lane_id: id, setze: [{ beat: 2, wert: 1001 }] }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'auto_punkte', lane_id: id, setze: [{ beat: 2, wert: 9 }] }, 'argument_ungueltig');
  assert.equal(ok(p, { befehl: 'auto_punkte', lane_id: id, setze: [{ beat: 2, wert: 500 }] }).projekt.spuren[0].automation[0].punkte.length, 3);
  const f = ok(p, { befehl: 'auto_form', lane_id: id, von_beat: 0, bis_beat: 8, form: 'rampe_auf' }); pruefe(p, f);
  const pk = f.projekt.spuren[0].automation[0].punkte;
  assert.equal(Math.min(...pk.map((q) => q.wert)), 10, 'the default span of an inserted shape is the parameter range');
  assert.equal(Math.max(...pk.map((q) => q.wert)), 1000);
  lehntAb(p, { befehl: 'auto_form', lane_id: id, von_beat: 0, bis_beat: 8, form: 'rampe_auf', unten: 5, oben: 20 }, 'argument_ungueltig');
  const v = ok(p, { befehl: 'auto_vereinfachen', lane_id: id, von_beat: 0, bis_beat: 8 }); pruefe(p, v);
  const d = ok(p, { befehl: 'auto_dehnen', lane_id: id, von_beat: 0, bis_beat: 8, neu_bis_beat: 16 }); pruefe(p, d);
  const n = ok(p, { befehl: 'auto_neigen', lane_id: id, von_beat: 0, bis_beat: 8, faktor: 0.5 }); pruefe(p, n);
});

test('F: translator: chain_auto per strip with stage position and parameter index, macro index; device lanes stay in `auto`; /2; old projects the same', () => {
  let p = alle();
  p = stufe(p, 's1', 'eq', 1);                                                                    // s1: komp i1, eq i5
  p = lane(p, 's1', 'insert.i5.b1/gain', [{ beat: 0, wert: 0 }, { beat: 8, wert: 12, form: 's' }]).projekt;
  p = lane(p, 's1', 'insert.i1.ratio', [{ beat: 0, wert: 2 }, { beat: 4, wert: 8 }]).projekt;
  p = lane(p, 's1', 'fader').projekt;
  p = lane(p, 'g1', 'insert.i2.schwelle').projekt;
  p = lane(p, 'r1', 'insert.i3.knie').projekt;
  p = lane(p, 'master', 'insert.i4.makeup', [{ beat: 0, wert: 1 }, { beat: 2, wert: 3, form: 'sprung' }]).projekt;
  assert.equal(pruefeProjekt(p).fehler, undefined);
  // s2 has no komp yet: give it one, then map and lane the macro
  let q = stufe(alle(), 's2');   // i5 on s2
  q = ok(q, { befehl: 'rack_setzen', strang_id: 's2', makros: [{}, {}, { ziel: [{ insert: 'i5', param: 'ratio', von: 1, bis: 8 }] }] }).projekt;
  q = lane(q, 's2', 'rack.m3', [{ beat: 0, wert: 0 }, { beat: 4, wert: 1 }]).projekt;
  const w = W(q);
  assert.equal(w.format, 'cypherdj-arr/2');
  const s2 = w.spuren.find((s) => s.nr === 2);
  assert.deepEqual(s2.chain_auto, [{ makro: 2, punkte: [[0, 0, 0], [4, 1, 0]] }]);
  assert.equal(s2.auto, undefined, 'a chain lane is not a device lane');
  const w1 = W(p).spuren.find((s) => s.nr === 1);
  assert.deepEqual(w1.chain_auto, [{ stufe: 1, param: 6, punkte: [[0, 0, 0], [8, 12, 1]] }, { stufe: 0, param: 2, punkte: [[0, 2, 0], [4, 8, 0]] }]);
  assert.deepEqual(w1.auto.map((a) => a.ziel), ['fader'], 'the fader lane keeps its place in auto');
  const wp = W(p);
  assert.deepEqual(wp.gruppen[0].chain_auto, [{ stufe: 0, param: 1, punkte: [[0, -18, 0], [32, -18, 0]] }]);
  assert.deepEqual(wp.returns[0].chain_auto, [{ stufe: 0, param: 3, punkte: [[0, 6, 0], [32, 6, 0]] }]);
  assert.deepEqual(wp.pm.chain_auto, [{ stufe: 0, param: 6, punkte: [[0, 1, 0], [2, 3, 2]] }]);
  // negative controls: no lane, no chain_auto anywhere; and the whole playback of a project without chain lanes is the one it was
  assert.ok(!JSON.stringify(W(alle())).includes('chain_auto'));
  const g = szenarioOhneInserts();
  assert.equal(JSON.stringify(W(g.projekt)), g.wiedergabe, 'a project with no inserts and no lanes translates byte for byte as before');
  // a lane on a parameter a macro drives never reaches the playback (the macro wins; the project refuses it, this is the second line)
  const x = structuredClone(p);
  x.spuren[0].rack = { slot: 1, namen: ['', '', '', ''], makros: [{ ziel: [{ insert: 'i1', param: 'ratio', von: 1, bis: 8 }] }, { ziel: [] }, { ziel: [] }, { ziel: [] }], werte: [0, 0, 0, 0] };
  const wx = W(x).spuren.find((s) => s.nr === 1);
  assert.deepEqual(wx.chain_auto.map((l) => l.param), [6], 'the ratio lane is dropped, the eq lane stays');
  // the view that decides whether a new playback is needed sees the lanes of every strip
  const a1 = kanonisch(wiedergabeSicht(alle())), a2 = kanonisch(wiedergabeSicht(lane(alle(), 'r1', 'insert.i3.knie').projekt));
  assert.notEqual(a1, a2);
});

test('G: limits: a strip holds 12 lanes, the project MAX_KETTEN_LANEN chain lanes (the core refuses more)', () => {
  assert.equal(MAX_KETTEN_LANEN, 64);
  let p = basisProjekt();
  for (let i = 0; i < 6; i++) p = ok(p, { befehl: 'spur_neu', art: 'audio', name: `X${i}` }).projekt;   // 9 tracks
  for (let i = 1; i <= 9; i++) p = stufe(p, `s${i}`);
  const PARAMS = ['schwelle', 'ratio', 'knie', 'attack', 'release', 'makeup', 'mix', 'schp'];
  let n = 0;
  for (let i = 1; i <= 8; i++) for (const pr of PARAMS) { p = lane(p, `s${i}`, `insert.i${i}.${pr}`).projekt; n++; }
  assert.equal(n, 64);
  assert.equal(pruefeProjekt(p).fehler, undefined);
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's9', ziel: 'insert.i9.schwelle' }, 'zu_gross');
  assert.equal(ok(p, { befehl: 'auto_neu', spur_id: 's9', ziel: 'fader' }).projekt.spuren[8].automation.length, 1, 'a device lane is not a chain lane: no limit hit');
  // the model refuses a file with 65
  const x = structuredClone(p);
  x.spuren[8].automation = [{ id: 'a99', ziel: 'insert.i9.schwelle', punkte: [{ beat: 0, wert: -18 }] }];
  assert.match(pruefeProjekt(x).fehler, /zu_gross|at most 64/);
});

test('H: the model is closed: a chain lane needs its stage or rack on the same strip, a continuous parameter, the range; ids are unique over all strips', () => {
  const p = lane(lane(alle(), 'g1', 'insert.i2.ratio').projekt, 's1', 'insert.i1.ratio').projekt;
  assert.equal(pruefeProjekt(p).fehler, undefined);
  const fehler = (mut) => { const x = structuredClone(p); mut(x); return pruefeProjekt(x).fehler; };
  assert.match(fehler((x) => { x.spuren[0].automation[0].ziel = 'insert.i2.ratio'; }), /ziel_unbekannt|no stage parameter/);   // i2 sits on g1
  assert.match(fehler((x) => { x.spuren[0].automation[0].ziel = 'insert.i1.an'; }), /no stage parameter/);
  assert.match(fehler((x) => { x.spuren[0].automation[0].ziel = 'rack.m1'; }), /no stage parameter or macro/);
  assert.match(fehler((x) => { x.spuren[0].automation[0].punkte[0].wert = 99; }), /number 1\.\.20/);
  assert.match(fehler((x) => { x.gruppen[0].automation[0].id = x.spuren[0].automation[0].id; }), /doppelt/);
  assert.match(fehler((x) => { x.gruppen[0].automation[0].ziel = 'fader'; }), /fader|only|ziel/, 'a device target on a group is refused');
  assert.match(fehler((x) => { x.gruppen[0].automation = []; }), /non-empty list/);
  assert.equal(fehler((x) => { x.master.automation = [{ id: 'a50', ziel: 'insert.i4.ratio', punkte: [{ beat: 0, wert: 4 }] }]; }), undefined, 'control: the master carries i4');
  assert.match(fehler((x) => { x.master.automation = [{ id: 'a50', ziel: 'insert.i1.ratio', punkte: [{ beat: 0, wert: 4 }] }]; }), /no stage parameter/);
});
