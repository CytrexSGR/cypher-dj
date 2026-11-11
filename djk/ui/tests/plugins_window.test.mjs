// Plan 1.11 tasks 8 and 15 (server part): the plugin window route, the latency watch while it is open, the state writes, and Stop Cypher on the host commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpOrdner } from './support/project.mjs';
import { hostAttrappe, ZEITEN, warteBis, schlaf } from './support/host_mock.mjs';
import { sitzung, pruefKontext, warteBis as warteS } from './support/proj_context.mjs';

async function aufbau(t, zeiten = {}) {
  const d = tmpOrdner(t, 'djk-fenster-');
  const pfad = path.join(d, 'Fake EQ.vst3');
  fs.mkdirSync(pfad);
  const A = hostAttrappe({ ordner: null });
  const k = pruefKontext();
  const { s, wurzel } = sitzung(t, { host: { abhaengig: { insert: (...a) => A.insert(...a), sock: (...a) => A.sock(...a) },
    zeiten: { ...ZEITEN, fensterMs: 10_000, fensterLatenzMs: 20, ...zeiten } } }, k);
  A.verw = s.hosts;
  A.neuLaden = { length: 0, push() { this.length++; } };
  const alt = k.sende.bind(k);
  k.sende = (adr, f) => { if (adr === '/k/arr/ins_host') A.flag[f.h] = f.gesund; if (adr === '/k/arr/ins_mess') A.kern.insMess(f.h); return alt(adr, f); };
  s.ereignis('/zustand/arr', { nr: 0, status: 0, loop_an: 0, projekt_beat: 0, ursprung_sample: 0n, start_beat: 0, metronom_an: 0, limiter_db: 0 });
  await s.neu('F', 'andreas');
  A.ordner = path.join(wurzel, 'f');
  const plugin = { format: 'vst3', pfad, uid: 'ABCDEF0123456789ABCDEF0123456789' };
  const rev = () => s.aktuell().j.projekt.rev;
  await s.aendern({ rev: rev(), label: 't', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  const r = await s.aendern({ rev: rev(), label: 'h', befehle: [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'host', plugin }] }, 'andreas');
  assert.equal(r.code, 200);
  assert.ok(await warteS(() => s.hostLage()[0]?.status === 'bereit'));
  await schlaf(50);
  const id = s.aktuell().j.projekt.spuren[0].inserts[0].id;
  return { s, k, A, id, rev };
}

test('fenster route: Cypher gets nur_andreas and the host is not called; Andreas opens: one fenster call, lage and /proj/aktuell show it', async (t) => {
  const e = await aufbau(t);
  await assert.rejects(e.s.insertFenster(e.id, { an: true }, 'cypher'), (x) => x.code === 403 && x.fehler === 'nur_andreas');
  assert.equal(e.A.aufrufe('sock', 'fenster').length, 0);
  const r = await e.s.insertFenster(e.id, { an: true }, 'andreas');
  assert.deepEqual([r.code, r.j.fenster], [200, true]);
  assert.equal(e.A.aufrufe('sock', 'fenster').length, 1);
  assert.deepEqual(e.A.aufrufe('sock', 'fenster')[0].an, true);
  assert.equal(e.s.hostLage()[0].fenster, true);
  assert.equal(e.s.aktuell().j.hosts[0].fenster, true);
  await assert.rejects(e.s.insertFenster(e.id, { an: 'ja' }, 'andreas'), (x) => x.code === 400);
  await assert.rejects(e.s.insertFenster('i999', { an: true }, 'andreas'), (x) => x.code === 404);
  await e.s.insertFenster(e.id, { an: false }, 'andreas');
});

test('fenster: the host refuses (keine_anzeige): 409 with that reason, nothing is watched', async (t) => {
  const e = await aufbau(t);
  e.A.hosts.get(1).keinFenster = 'keine_anzeige';
  await assert.rejects(e.s.insertFenster(e.id, { an: true }, 'andreas'), (x) => x.code === 409 && x.fehler === 'keine_anzeige');
  assert.equal(e.s.hostLage()[0].fenster, false);
});

test('window open: a latency change made in the plugin UI reloads the playback exactly once; closing writes the state once', async (t) => {
  const e = await aufbau(t);
  await e.s.insertFenster(e.id, { an: true }, 'andreas');
  const vor = e.k.an('/k/arr/laden').length, holen = e.A.hosts.get(1).zustandAnzahl;
  e.A.hosts.get(1).info.latenz = 133;
  assert.ok(await warteBis(() => e.k.an('/k/arr/laden').length > vor));
  await schlaf(120);
  assert.equal(e.k.an('/k/arr/laden').length, vor + 1, 'exactly one reload while the timer keeps reading the same value');
  assert.equal(e.A.hosts.get(1).zustandAnzahl, holen, 'no state write while open (30 s interval)');
  await e.s.insertFenster(e.id, { an: false }, 'andreas');
  assert.equal(e.A.hosts.get(1).zustandAnzahl, holen + 1, 'one zustand_holen on close');
  assert.equal(e.s.hostLage()[0].fenster, false);
  e.A.hosts.get(1).info.latenz = 200;
  await schlaf(100);
  assert.equal(e.k.an('/k/arr/laden').length, vor + 1, 'the watch stopped with the window');
});

test('window open: the state is written every fensterMs', async (t) => {
  const e = await aufbau(t, { fensterMs: 60 });
  const holen = e.A.hosts.get(1).zustandAnzahl;
  await e.s.insertFenster(e.id, { an: true }, 'andreas');
  assert.ok(await warteBis(() => e.A.hosts.get(1).zustandAnzahl >= holen + 2));
  await e.s.insertFenster(e.id, { an: false }, 'andreas');
});

test('Stop Cypher: insert_setzen host and plugins param are ki_gestoppt for Cypher, Andreas is not blocked', async (t) => {
  const e = await aufbau(t);
  e.k.ki = true;
  const plugin = { format: 'vst3', pfad: '/nonexistent', uid: 'X' };
  await assert.rejects(e.s.aendern({ rev: e.rev(), label: 'x', befehle: [{ befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'host', plugin }] }, 'cypher'),
    (x) => x.fehler === 'ki_gestoppt' || x.grund === 'ki_gestoppt');
  await assert.rejects(e.s.insertParam(e.id, { werte: { 0: 0.5 } }, 'cypher'), (x) => x.fehler === 'ki_gestoppt');
  assert.equal((await e.s.insertParam(e.id, { werte: { 0: 0.5 } }, 'andreas')).code, 200);
  await assert.rejects(e.s.aendern({ rev: e.rev(), label: 'x', befehle: [{ befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'host', plugin }] }, 'andreas'),
    (x) => x.grund === 'plugin_nicht_ladbar' || x.fehler === 'plugin_nicht_ladbar', 'Andreas passes the guard (and meets the file check)');
});

test('parameter route: the host list joined with the values', async (t) => {
  const e = await aufbau(t);
  const r = await e.s.insertParameter(e.id);
  assert.deepEqual(r.j.parameter.map((x) => [x.index, x.name, x.wert]), [[0, 'Gain', 0.5], [1, 'Freq', 0.5]]);
  await assert.rejects(e.s.insertParameter('i999'), (x) => x.code === 404);
});
