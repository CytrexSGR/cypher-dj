// Strand 2 task 2.3: knob moves (/e/hand on plug/<h>/k<m>) reach the plugin parameter. Fakes only: no core, no host, no server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus } from '../project/commands.ts';
import { alleInserts } from '../project/model.ts';
import { ReglerWeiterleitung } from '../plugins/controls_weiterleitung.ts';
import { PluginLanenSpieler } from '../plugins/lanes_player.ts';
import fs from 'node:fs';
import path from 'node:path';
import { HostVerwaltung } from '../plugins/hostverwaltung.ts';
import { hostAttrappe, ZEITEN, warteBis } from './support/host_mock.mjs';
import { tmpOrdner } from './support/project.mjs';
import { basisProjekt } from './support/inserts_scenario.mjs';

const PLUGIN = { format: 'vst3', pfad: '/opt/plugins/Fake EQ.vst3', uid: 'ABCDEF0123456789ABCDEF0123456789' };
const ok = (p, b) => fuehreAus(p, b).projekt;
const spur = (p) => p.spuren[0].id;

function szenario() {
  let p = basisProjekt();
  p = ok(p, { befehl: 'insert_setzen', strang_id: spur(p), pos: 0, art: 'host', plugin: PLUGIN });
  const id = alleInserts(p).find((x) => x.insert.art === 'host').insert.id;
  const slot = alleInserts(p).find((x) => x.insert.id === id).insert.slot;
  p = ok(p, { befehl: 'plugin_regler_setzen', insert_id: id, knopf: 3, index: 7 });
  return { p, id, slot };
}
function bau(p, o = {}) {
  const aufrufe = [], zeilen = [], reglerGesetzt = [], frei = [];
  const w = new ReglerWeiterleitung({
    projekt: () => p,
    param: o.param ?? ((id, werte) => { aufrufe.push([id, werte]); return Promise.resolve({ ok: true }); }),
    parameter: async () => ({ ok: true, parameter: [{ index: 7, wert: 0.25 }, { index: 9, wert: 0.5 }] }),
    setzeRegler: async (pfad, wert) => { reglerGesetzt.push([pfad, wert]); return true; },
    spielt: () => o.spielt ?? false,
    log: (z) => zeilen.push(z),
  });
  return { w, aufrufe, zeilen, reglerGesetzt, frei };
}
const hand = (pfad, wert) => ['/e/hand', { pfad, wert }];

test('a move on an assigned knob reaches param with the plugin index', () => {
  const { p, id, slot } = szenario();
  const t = bau(p);
  t.w.ereignis(...hand(`plug/${slot}/k3`, 0.4));
  assert.deepEqual(t.aufrufe, [[id, { 7: 0.4 }]]);
});

test('unassigned knob, other addresses, other slots and bad values do nothing', () => {
  const { p, slot } = szenario();
  const t = bau(p);
  t.w.ereignis(...hand(`plug/${slot}/k4`, 0.4));
  t.w.ereignis(...hand(`plug/${slot === 8 ? 1 : slot + 1}/k3`, 0.4));
  t.w.ereignis(...hand(`plug/${slot}/k17`, 0.4));
  t.w.ereignis(...hand(`plug/${slot}/k3`, 'x'));
  t.w.ereignis('/e/regler', { pfad: `plug/${slot}/k3`, wert: 0.4 });
  assert.deepEqual(t.aufrufe, []);
});

test('two quick moves: one call in flight, one follow-up with the latest value', async () => {
  const { p, id, slot } = szenario();
  const offen = [];
  const t = bau(p, { param: (i, werte) => new Promise((res) => { offen.push([i, werte, res]); }) });
  t.w.ereignis(...hand(`plug/${slot}/k3`, 0.1));
  t.w.ereignis(...hand(`plug/${slot}/k3`, 0.2));
  t.w.ereignis(...hand(`plug/${slot}/k3`, 0.9));
  assert.equal(offen.length, 1);
  assert.deepEqual(offen[0].slice(0, 2), [id, { 7: 0.1 }]);
  offen[0][2]({ ok: true });
  await new Promise((r) => setImmediate(r));
  assert.equal(offen.length, 2);
  assert.deepEqual(offen[1].slice(0, 2), [id, { 7: 0.9 }]);
  offen[1][2]({ ok: true });
  await new Promise((r) => setImmediate(r));
  assert.equal(offen.length, 2);
});

test('a lane on that index wins while the transport plays; another index and a stopped transport do not', () => {
  const { p: p0, id, slot } = szenario();
  const sid = p0.spuren[0].id;
  const mitLane = (idx) => ok(p0, { befehl: 'auto_neu', strang_id: sid, ziel: `plugin.${id}.${idx}`, punkte: [{ beat: 0, wert: 0.5 }] });
  let p;
  try { p = mitLane(7); } catch (e) { assert.fail(`cannot build a lane: ${e.message}`); }
  const spielt = bau(p, { spielt: true });
  spielt.w.ereignis(...hand(`plug/${slot}/k3`, 0.4));
  assert.deepEqual(spielt.aufrufe, []);
  const steht = bau(p, { spielt: false });
  steht.w.ereignis(...hand(`plug/${slot}/k3`, 0.4));
  assert.equal(steht.aufrufe.length, 1);
  const anderer = bau(mitLane(8), { spielt: true });
  anderer.w.ereignis(...hand(`plug/${slot}/k3`, 0.4));
  assert.equal(anderer.aufrufe.length, 1);
});

test('the lane player reports the transport state', () => {
  const sp = new PluginLanenSpieler({ projekt: () => null, beatsProSekunde: () => 2, senden: () => {} });
  assert.equal(sp.spielt(), false);
  sp.zustand({ status: 2, projekt_beat: 1 });
  assert.equal(sp.spielt(), true);
  sp.zustand({ status: 0, projekt_beat: 1 });
  assert.equal(sp.spielt(), false);
});

test('pickup writes each assigned knob row to the plugin value', async () => {
  let { p, id, slot } = szenario();
  p = ok(p, { befehl: 'plugin_regler_setzen', insert_id: id, knopf: 5, index: 9 });
  const t = bau(p);
  await t.w.pickup(id);
  assert.deepEqual(t.reglerGesetzt.sort(), [[`plug/${slot}/k3`, 0.25], [`plug/${slot}/k5`, 0.5]]);
  const leer = bau(basisProjekt());
  await leer.w.pickup('gibt_es_nicht');
  assert.deepEqual(leer.reglerGesetzt, []);
});

test('onBereit fires once the host stage is ready and drives the pickup', async (t) => {
  const d = tmpOrdner(t, 'djk-regler-');
  const pfad = path.join(d, 'Fake EQ.vst3');
  fs.mkdirSync(pfad);
  const A = hostAttrappe({ ordner: path.join(d, 'project') });
  fs.mkdirSync(A.ordner, { recursive: true });
  let p = basisProjekt();
  p = ok(p, { befehl: 'insert_setzen', strang_id: spur(p), pos: 0, art: 'host', plugin: { format: 'vst3', pfad, uid: 'ABCDEF0123456789ABCDEF0123456789' } });
  const id = alleInserts(p).find((x) => x.insert.art === 'host').insert.id;
  p = ok(p, { befehl: 'plugin_regler_setzen', insert_id: id, knopf: 2, index: 1 });
  const bereitIds = [], reglerGesetzt = [];
  let verw, w;
  verw = new HostVerwaltung({ ...A.abhaengig(), onBereit: (i) => { bereitIds.push(i); void w.pickup(i); } }, ZEITEN);
  A.verw = verw;
  t.after(() => verw.halt());
  w = new ReglerWeiterleitung({
    projekt: () => p, param: (i, v) => verw.param(i, v), parameter: async () => ({ ok: true, parameter: [{ index: 1, wert: 0.75 }] }),
    setzeRegler: async (pf, wert) => { reglerGesetzt.push([pf, wert]); return true; }, spielt: () => false, log: () => {},
  });
  verw.abgleich(p);
  assert.ok(await warteBis(() => verw.lage()[0]?.status === 'bereit' && reglerGesetzt.length > 0), JSON.stringify(verw.lage()));
  assert.deepEqual(bereitIds, [id]);
  assert.deepEqual(reglerGesetzt, [['plug/1/k2', 0.75]]);
});

// ---- task 2.4: the learn routes (SitzungGeraet with fakes)
import { SitzungGeraet } from '../areas/proj/session_device.ts';
import { ProjFehler } from '../areas/proj/session.ts';
import { LernFehler } from '../areas/learn/store.ts';

function lernSzenario(o = {}) {
  let p = basisProjekt();
  p = ok(p, { befehl: 'insert_setzen', strang_id: spur(p), pos: 0, art: 'host', plugin: PLUGIN });
  const id = alleInserts(p).find((x) => x.insert.art === 'host').insert.id;
  const st = { p, aendern: [], pickups: 0, armiert: [], geloescht: [], abgebrochen: 0, wartet: null, cc: new Set(), bereitFehler: null, reihenfolge: [] };
  const lernen = o.keinLernen ? null : {
    pruefeBereit: () => { if (st.bereitFehler) throw st.bereitFehler; },
    arme: (pfad) => { st.armiert.push(pfad); st.wartet = pfad; st.reihenfolge.push('arme'); },
    wartet: () => st.wartet, abbrechen: () => { st.abgebrochen++; st.wartet = null; },
    loesche: async (pfad) => { st.geloescht.push(pfad); if (!st.cc.delete(pfad)) { throw new LernFehler('keine_zuordnung', 404); } },
    gelernt: () => st.cc,
  };
  const g = new SitzungGeraet({
    brauchOffen: () => ({ projekt: st.p }), riegel: () => {}, hosts: { parameter: async () => ({ ok: true, parameter: [{ index: 7, wert: 0.25 }, { index: 9, wert: 0.5 }, { index: 11, wert: 0 }] }) },
    instrumente: {}, surge: {},
    aendere: async (d) => { st.aendern.push(d); st.p = fuehreAus(st.p, d.befehle[0]).projekt; return { code: 200, j: { ok: true } }; },
    pickup: async () => { st.pickups++; st.reihenfolge.push('pickup'); },
    lernen: () => lernen,
  });
  return { st, g, id };
}
const fehlerGrund = async (f) => { try { await f(); } catch (e) { assert.ok(e instanceof ProjFehler, String(e)); return [e.code, e.fehler]; } return null; };

test('lernen: lowest free knob, one history step "Controller", pickup before arming, answers {pfad, knopf}', async () => {
  const { st, g, id } = lernSzenario();
  const slot = alleInserts(st.p).find((x) => x.insert.id === id).insert.slot;
  const r = await g.insertLernen(id, { index: 9 }, 'andreas');
  assert.deepEqual(r, { code: 200, j: { ok: true, pfad: `plug/${slot}/k1`, knopf: 1 } });
  assert.equal(st.aendern.length, 1);
  assert.equal(st.aendern[0].label, 'Controller');
  assert.deepEqual(alleInserts(st.p).find((x) => x.insert.id === id).insert.regler, [9]);
  assert.deepEqual(st.reihenfolge, ['pickup', 'arme']);
  const r2 = await g.insertLernen(id, { index: 11 }, 'andreas');
  assert.equal(r2.j.knopf, 2);
});

test('lernen: a parameter that has a knob keeps it and writes no new history step', async () => {
  const { st, g, id } = lernSzenario();
  await g.insertLernen(id, { index: 9 }, 'andreas');
  const r = await g.insertLernen(id, { index: 9 }, 'andreas');
  assert.equal(r.j.knopf, 1);
  assert.equal(st.aendern.length, 1);
  assert.equal(st.armiert.length, 2);
});

test('lernen: a freed knob in the middle is taken again before a new one', async () => {
  const { st, g, id } = lernSzenario();
  for (const i of [1, 2, 3]) await g.insertLernen(id, { index: i }, 'andreas');
  await g.insertLernenLoeschen(id, { index: 2 }, 'andreas');
  const r = await g.insertLernen(id, { index: 50 }, 'andreas');
  assert.equal(r.j.knopf, 2);
});

test('lernen: all 16 knobs in use gives plugin_regler_voll 409 and changes nothing', async () => {
  const { st, g, id } = lernSzenario();
  for (let i = 0; i < 16; i++) await g.insertLernen(id, { index: i }, 'andreas');
  const n = st.aendern.length, a = st.armiert.length;
  assert.deepEqual(await fehlerGrund(() => g.insertLernen(id, { index: 99 }, 'andreas')), [409, 'plugin_regler_voll']);
  assert.equal(st.aendern.length, n);
  assert.equal(st.armiert.length, a);
});

test('lernen: only Andreas, a known host stage, a valid index, a ready learn flow', async () => {
  const { st, g, id } = lernSzenario();
  assert.deepEqual(await fehlerGrund(() => g.insertLernen(id, { index: 1 }, 'cypher')), [403, 'nur_andreas']);
  assert.deepEqual(await fehlerGrund(() => g.insertLernenLoeschen(id, { index: 1 }, 'cypher')), [403, 'nur_andreas']);
  assert.deepEqual(await fehlerGrund(() => g.insertLernen('nix', { index: 1 }, 'andreas')), [404, 'insert_unbekannt']);
  for (const index of [-1, 1.5, '3', null, 100000]) assert.equal((await fehlerGrund(() => g.insertLernen(id, { index }, 'andreas')))[1], 'argument_ungueltig');
  st.bereitFehler = new LernFehler('kein_midi_eingang', 409);
  assert.deepEqual(await fehlerGrund(() => g.insertLernen(id, { index: 1 }, 'andreas')), [409, 'kein_midi_eingang']);
  assert.equal(st.aendern.length, 0, 'a learn flow that is not ready leaves the project alone');
});

test('lernen/loeschen: frees the knob, cancels a waiting arm, removes the CC; unknown parameter 404; armed-but-never-learned is fine', async () => {
  const { st, g, id } = lernSzenario();
  const slot = alleInserts(st.p).find((x) => x.insert.id === id).insert.slot;
  await g.insertLernen(id, { index: 9 }, 'andreas');
  const r = await g.insertLernenLoeschen(id, { index: 9 }, 'andreas');
  assert.deepEqual(r, { code: 200, j: { ok: true, pfad: `plug/${slot}/k1`, knopf: 1 } });
  assert.equal(alleInserts(st.p).find((x) => x.insert.id === id).insert.regler, undefined);
  assert.equal(st.abgebrochen, 1);
  assert.deepEqual(st.geloescht, [`plug/${slot}/k1`]);
  assert.deepEqual(await fehlerGrund(() => g.insertLernenLoeschen(id, { index: 9 }, 'andreas')), [404, 'keine_zuordnung']);
  await g.insertLernen(id, { index: 9 }, 'andreas');
  st.wartet = null; st.cc.add(`plug/${slot}/k1`);
  await g.insertLernenLoeschen(id, { index: 9 }, 'andreas');
  assert.equal(st.cc.size, 0);
});

test('parameter list carries knopf and gelernt per parameter', async () => {
  const { st, g, id } = lernSzenario();
  const slot = alleInserts(st.p).find((x) => x.insert.id === id).insert.slot;
  await g.insertLernen(id, { index: 9 }, 'andreas');
  await g.insertLernen(id, { index: 11 }, 'andreas');
  st.cc.add(`plug/${slot}/k2`);
  const l = (await g.insertParameter(id)).j.parameter;
  assert.deepEqual(l.map((q) => [q.index, q.knopf, q.gelernt]), [[7, undefined, undefined], [9, 1, false], [11, 2, true]]);
});
