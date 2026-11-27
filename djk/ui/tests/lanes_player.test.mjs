// Strand 2 slice 1 task 1.2: the lane player (plugins/lanes_player.ts) with a fake `senden`, and HostVerwaltung.automation against the host stand-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PluginLanenSpieler, VORLAUF_S } from '../plugins/lanes_player.ts';
import { HostVerwaltung } from '../plugins/hostverwaltung.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { alleInserts } from '../project/model.ts';
import { basisProjekt } from './support/inserts_scenario.mjs';
import { tmpOrdner } from './support/project.mjs';
import { hostAttrappe, ZEITEN, warteBis, schlaf } from './support/host_mock.mjs';

const PLUGIN = { format: 'vst3', pfad: '/opt/plugins/Fake EQ.vst3', uid: 'ABCDEF0123456789ABCDEF0123456789' };
const mitHost = (art = 'host') => {
  const p = fuehreListeAus(basisProjekt(), [art === 'host'
    ? { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'host', plugin: PLUGIN } : { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art }]).projekt;
  return { p, id: alleInserts(p).find((x) => x.insert.art === art).insert.id };
};
const mitLane = (p, id, index, punkte) => fuehreListeAus(p, [{ befehl: 'auto_neu', strang_id: 's1', ziel: `plugin.${id}.${index}`, punkte }]).projekt;
const RAMPE = [{ beat: 0, wert: 0, form: 'linear' }, { beat: 4, wert: 1, form: 'linear' }];
function spieler(p, bpm = 120) {
  const aus = [];
  const s = new PluginLanenSpieler({ projekt: () => p, beatsProSekunde: () => bpm / 60, senden: (id, w) => aus.push([id, w]) });
  return { s, aus };
}
const tick = (s, beat, status = 2) => s.zustand({ status, projekt_beat: beat });

test('a 0..1 lane over 4 beats at 120 BPM: ticks send the value one tick (0.04 beats) ahead; an unchanged value is not resent', () => {
  const { p, id } = mitHost();
  const { s, aus } = spieler(mitLane(p, id, 3, RAMPE));
  assert.equal(VORLAUF_S, 0.02);
  tick(s, 0); tick(s, 0.04); tick(s, 0.08);
  assert.deepEqual(aus.map(([i, w]) => [i, Object.keys(w)]), [[id, ['3']], [id, ['3']], [id, ['3']]]);
  const v = aus.map(([, w]) => w['3']);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(v[k] - (0.04 * (k + 1)) / 4) < 1e-9, String(v[k]));
  tick(s, 0.08); assert.equal(aus.length, 3, 'same beat, same value: nothing');
  tick(s, 5); tick(s, 5.04);
  assert.equal(aus.length, 4, 'past the last point the value is constant: sent once');
});

test('status 0 then 2 sends again; a jump back sends again', () => {
  const { p, id } = mitHost();
  const { s, aus } = spieler(mitLane(p, id, 0, [{ beat: 0, wert: 0.7, form: 'linear' }]));
  tick(s, 0); tick(s, 0.04); assert.equal(aus.length, 1);
  tick(s, 0.04, 0); tick(s, 0.04, 2); assert.equal(aus.length, 2);
  tick(s, 0.0); assert.equal(aus.length, 3, 'the beat moved backwards');
});

test('two lanes on one stage go out as ONE call', () => {
  const { p, id } = mitHost();
  const q = mitLane(mitLane(p, id, 1, RAMPE), id, 2, RAMPE);
  const { s, aus } = spieler(q);
  tick(s, 1);
  assert.equal(aus.length, 1);
  assert.deepEqual(Object.keys(aus[0][1]).sort(), ['1', '2']);
});

test('a lane whose stage is not a host stage is ignored; no project, no call', () => {
  const { p, id } = mitHost();
  const q = mitLane(p, id, 1, RAMPE);
  const kaputt = JSON.parse(JSON.stringify(q));
  kaputt.spuren[0].inserts.find((i) => i.id === id).art = 'eq';
  const a = spieler(kaputt); tick(a.s, 1); assert.equal(a.aus.length, 0);
  const b = new PluginLanenSpieler({ projekt: () => null, beatsProSekunde: () => 2, senden: () => assert.fail('no project') });
  tick(b, 1);
});

function aufbau(t) {
  const d = tmpOrdner(t, 'djk-lane-');
  fs.mkdirSync(path.join(d, 'Fake EQ.vst3'));
  const A = hostAttrappe({ ordner: path.join(d, 'project') });
  fs.mkdirSync(A.ordner, { recursive: true });
  const verw = new HostVerwaltung(A.abhaengig(), { ...ZEITEN });
  A.verw = verw;
  t.after(() => verw.halt());
  const plugin = { ...PLUGIN, pfad: path.join(d, 'Fake EQ.vst3') };
  const projekt = fuehreListeAus(basisProjekt(), [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'host', plugin }]).projekt;
  return { A, verw, id: alleInserts(projekt).find((x) => x.insert.art === 'host').insert.id, projekt };
}

test('automation(): one command in flight, the waiting values are replaced (latest wins), no latency read, clamped', async (t) => {
  const { A, verw, id, projekt } = aufbau(t);
  verw.abgleich(projekt);
  assert.ok(await warteBis(() => verw.lage().find((x) => x.h === 1)?.status === 'bereit'));
  await schlaf(40);
  const vorher = A.folge.length;
  A.sockMs.params_setzen = 80;
  verw.automation(id, { 0: 0.1 });
  verw.automation(id, { 0: 0.2 });
  verw.automation(id, { 0: 0.9, 1: 7 });
  await schlaf(300);
  const neu = A.folge.slice(vorher).filter((z) => z.art === 'sock');
  assert.deepEqual(neu.map((z) => [z.befehl, z.werte]), [['params_setzen', { 0: 0.1 }], ['params_setzen', { 0: 0.9, 1: 1 }]]);
  assert.equal(A.hosts.get(1).werte[0], 0.9);
  verw.automation('gibt_es_nicht', { 0: 1 });   // unknown stage: nothing, no throw
});

test('automation(): an unknown index is logged once and skipped; the other values still go out', async (t) => {
  const { A, verw, id, projekt } = aufbau(t);
  const log = [];
  verw.dep.log = (z) => log.push(z);
  verw.abgleich(projekt);
  assert.ok(await warteBis(() => verw.lage().find((x) => x.h === 1)?.status === 'bereit'));
  await schlaf(40);
  verw.automation(id, { 0: 0.3, 9: 0.5 });
  await schlaf(100);
  verw.automation(id, { 9: 0.6, 1: 0.4 });
  await schlaf(100);
  assert.equal(log.filter((z) => z.typ === 'plugin_lane_param_unbekannt').length, 1);
  assert.deepEqual([A.hosts.get(1).werte[0], A.hosts.get(1).werte[1]], [0.3, 0.4]);
});
