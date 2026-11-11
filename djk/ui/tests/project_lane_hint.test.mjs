// 1.12 slices 6 and 7, fix round: a write to a parameter on which a lane lies is kept but answered with a hint (`lane_treibt`): the value is only the rest value.
// Cases: A insert stage parameter (insert_param_setzen, light path; insert_setzen with another value, general path), B rack macro (rack_makro, makro_variation_laden),
// C Baukasten knob (spur_aendern geraet), D no hint where there is none (no lane, another parameter, an RB-338 lane, the same value, a lane created in the same list),
// E the page turns the hint into a notice, F the answer of /proj/aendern (the session) carries it, also in the short form of the answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { hinweisMeldung } from '../public/production/production.js';
import { Projekte } from '../project/storage.ts';
import { sitzung, pruefKontext } from './support/proj_context.mjs';

const ok = (p, b) => fuehreAus(p, b);
const KOMP = { schwelle: -20, ratio: 4, knie: 3, attack: 10, release: 100, makeup: 0, mix: 1, schp: 0 };
function basis() {
  let p = neuesProjekt('T');
  p = ok(p, { befehl: 'spur_neu', art: 'audio', name: 'A' }).projekt;
  p = ok(p, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'pad', parameter: { k2: 0.8 } } }).projekt;
  p = ok(p, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} } }).projekt;
  p = ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', werte: { ...KOMP } }).projekt;
  return p;
}
const mitLane = (p, b) => ok(p, b).projekt;

test('A: an insert parameter with a lane: insert_param_setzen answers lane_treibt, the value is stored, the control parameter has no hint', () => {
  let p = basis();
  const id = p.spuren[0].inserts[0].id;
  p = mitLane(p, { befehl: 'auto_neu', spur_id: 's1', ziel: `insert.${id}.schwelle` });
  const lane = p.spuren[0].automation[0];
  const r = ok(p, { befehl: 'insert_param_setzen', insert_id: id, param: 'schwelle', wert: -30 });
  assert.equal(r.projekt.spuren[0].inserts[0].werte.schwelle, -30, 'the write is kept (the rest value)');
  assert.equal(r.hinweise.length, 1);
  assert.deepEqual({ ...r.hinweise[0], text: undefined }, { index: 0, hinweis: 'lane_treibt', lane_id: lane.id, ziel: lane.ziel, strang_id: 's1', text: undefined });
  assert.match(r.hinweise[0].text, new RegExp(`driven by lane ${lane.id}`));
  assert.match(r.hinweise[0].text, /rest value/);
  assert.match(r.hinweise[0].text, /transport is stopped/);
  assert.doesNotMatch(r.hinweise[0].text, /[äöüß]/);
  // control: another parameter of the same stage, no lane: no hint
  assert.equal(ok(p, { befehl: 'insert_param_setzen', insert_id: id, param: 'ratio', wert: 8 }).hinweise, undefined);
  // control: the same value is no write
  assert.equal(ok(p, { befehl: 'insert_param_setzen', insert_id: id, param: 'schwelle', wert: -20 }).hinweise, undefined);
  // the general path (a list with a heavy command) gives the same hint with the index of the command
  const g = fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: 's1', name: 'Z' }, { befehl: 'insert_param_setzen', insert_id: id, param: 'schwelle', wert: -31 }], { voll: true });
  assert.deepEqual(g.hinweise.map((h) => [h.index, h.lane_id]), [[1, lane.id]]);
});

test('B: a macro with a lane: rack_makro answers lane_treibt; without a lane on that macro no hint', () => {
  let p = basis();
  const id = p.spuren[0].inserts[0].id;
  p = mitLane(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [{ insert: id, param: 'schwelle', von: -60, bis: 0 }] }, { ziel: [{ insert: id, param: 'ratio', von: 1, bis: 20 }] }] });
  p = mitLane(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'rack.m1' });
  const lane = p.spuren[0].automation[0];
  const r = ok(p, { befehl: 'rack_makro', strang_id: 's1', nr: 1, wert: 0.3 });
  assert.deepEqual(r.hinweise.map((h) => [h.hinweis, h.lane_id, h.ziel]), [['lane_treibt', lane.id, 'rack.m1']]);
  assert.equal(ok(p, { befehl: 'rack_makro', strang_id: 's1', nr: 2, wert: 0.3 }).hinweise, undefined, 'macro 2 has no lane');
});

test('C: a Baukasten knob with a lane: a device write that changes the knob answers lane_treibt, another knob does not', () => {
  let p = basis();
  p = mitLane(p, { befehl: 'auto_neu', spur_id: 's2', ziel: 'geraet.k2' });
  const lane = p.spuren[1].automation[0];
  const r = ok(p, { befehl: 'spur_aendern', spur_id: 's2', geraet: { art: 'intern', name: 'bk', graph: 'pad', parameter: { k2: 0.1 } } });
  assert.deepEqual(r.hinweise.map((h) => [h.lane_id, h.ziel, h.strang_id]), [[lane.id, 'geraet.k2', 's2']]);
  assert.equal(ok(p, { befehl: 'spur_aendern', spur_id: 's2', geraet: { art: 'intern', name: 'bk', graph: 'pad', parameter: { k2: 0.8, k5: 0.2 } } }).hinweise, undefined,
    'k2 unchanged, k5 has no lane');
});

test('D: no hint without a lane, for a mixer lane, or when the lane is created by the same list', () => {
  const p = basis();
  const id = p.spuren[0].inserts[0].id;
  assert.equal(ok(p, { befehl: 'insert_param_setzen', insert_id: id, param: 'schwelle', wert: -30 }).hinweise, undefined);
  const mix = mitLane(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader' });
  assert.equal(ok(mix, { befehl: 'insert_param_setzen', insert_id: id, param: 'schwelle', wert: -30 }).hinweise, undefined, 'a fader lane is not a chain lane');
  const beides = fuehreListeAus(p, [{ befehl: 'insert_param_setzen', insert_id: id, param: 'schwelle', wert: -30 }, { befehl: 'auto_neu', spur_id: 's1', ziel: `insert.${id}.schwelle` }]);
  assert.equal(beides.hinweise, undefined, 'the write came before the lane existed');
});

test('E: the page turns the hint into a notice with the lane named; old hints are unchanged', () => {
  const h = { index: 0, hinweis: 'lane_treibt', lane_id: 'a3', ziel: 'insert.i1.schwelle', strang_id: 's1', text: 'parameter is driven by lane a3 (insert.i1.schwelle): saved as the rest value' };
  const m = hinweisMeldung([h]);
  assert.match(m.text, /^Parameter is driven by lane a3/);
  assert.equal(m.fehler, false);
  assert.match(hinweisMeldung([{ index: 0, hinweis: 'lane_treibt' }]).text, /rest value/, 'fallback text without the server text');
  assert.match(hinweisMeldung([{ index: 0, hinweis: 'analyse_laeuft' }]).text, /already running/);
});

test('F: the session answers a write to a lane-driven parameter with hinweise (and a control write without)', async (t) => {
  const { s, wurzel } = sitzung(t, {}, pruefKontext());
  const pr = new Projekte(wurzel), { slug } = pr.lege('Lane');
  pr.speichere(slug, neuesProjekt('Lane'));
  const r0 = await s.oeffnen(slug, 'andreas');
  let rev = r0.j.projekt.rev;
  const aendern = async (befehle) => { const r = await s.aendern({ rev, label: 'x', befehle }, 'andreas'); assert.equal(r.code, 200, JSON.stringify(r.j).slice(0, 200)); rev = r.j.rev; return r.j; };
  await aendern([{ befehl: 'spur_neu', art: 'audio', name: 'A' }, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', werte: { ...KOMP } }]);
  const j1 = await aendern([{ befehl: 'insert_param_setzen', insert_id: 'i1', param: 'schwelle', wert: -25 }]);
  assert.equal(j1.hinweise, undefined, 'control: no lane yet');
  await aendern([{ befehl: 'auto_neu', spur_id: 's1', ziel: 'insert.i1.schwelle' }]);
  const j2 = await aendern([{ befehl: 'insert_param_setzen', insert_id: 'i1', param: 'schwelle', wert: -35 }]);
  assert.deepEqual(j2.hinweise.map((h) => [h.index, h.hinweis, h.ziel]), [[0, 'lane_treibt', 'insert.i1.schwelle']]);
  assert.match(j2.hinweise[0].text, /driven by lane/);
});
