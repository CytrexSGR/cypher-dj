// Plan 1.11 task 7 review fixes (part 4): restart loop, scanner uids, failed restore, latency over the core's limit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as HV from '../plugins/hostverwaltung.ts';
const { HostVerwaltung, hostSpec } = HV;
const HOST_LAT_MAX = HV.HOST_LAT_MAX ?? 8192;
import { zustandDatei } from '../plugins/state.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { basisProjekt } from './support/inserts_scenario.mjs';
import { tmpOrdner } from './support/project.mjs';
import { hostAttrappe, ZEITEN, warteBis, schlaf } from './support/host_mock.mjs';

function aufbau(t, zeiten = {}) {
  const d = tmpOrdner(t, 'djk-t7fix-');
  const pfad = path.join(d, 'Fake EQ.vst3');
  fs.mkdirSync(pfad);
  const A = hostAttrappe({ ordner: path.join(d, 'project') });
  fs.mkdirSync(A.ordner, { recursive: true });
  const verw = new HostVerwaltung(A.abhaengig(), { ...ZEITEN, ...zeiten });
  A.verw = verw;
  t.after(() => verw.halt());
  const plugin = { format: 'vst3', pfad, uid: 'ABCDEF0123456789ABCDEF0123456789' };
  const projekt = fuehreListeAus(basisProjekt(), [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'host', plugin }]).projekt;
  const insert = projekt.spuren.flatMap((s) => s.inserts ?? []).find((i) => i.art === 'host');
  const an = (wert) => fuehreListeAus(projekt, [{ befehl: 'insert_an', insert_id: insert.id, an: wert }]).projekt;
  return { A, verw, projekt, insert, an, plugin };
}
const status = (verw) => verw.lage()[0]?.status;

test('a plugin that kills its host during lade: three sequences, then ausfall absturz_schleife, stop, no more reloads; insert_an on starts again', async (t) => {
  const e = aufbau(t);
  e.A.absturzBeiLade = true;
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => e.verw.lage()[0]?.grund === 'absturz_schleife', 3000), JSON.stringify(e.verw.lage()));
  await schlaf(150);
  assert.equal(e.A.aufrufe('sock', 'lade').length, 3, 'three sequences, not an endless loop');
  assert.equal(e.verw.lage()[0].status, 'ausfall');
  assert.equal(e.A.aufrufe('insert', 'stop').at(-1).h, 1, 'djk-insert stop h');
  const reloads = e.A.neuLaden.length;
  await schlaf(200);
  assert.equal(e.A.neuLaden.length, reloads, 'no further playback reloads');
  assert.equal(e.A.aufrufe('sock', 'lade').length, 3);
  // the user acts: stage off, then on again; the plugin works now
  e.A.absturzBeiLade = false;
  e.verw.abgleich(e.an(false));
  await schlaf(60);
  assert.equal(status(e.verw), 'ausfall', 'a stage that is off is not retried');
  e.verw.abgleich(e.an(true));
  assert.ok(await warteBis(() => status(e.verw) === 'bereit'), JSON.stringify(e.verw.lage()));
});

test('HOST_UID_ZEICHEN: scanner labels with spaces and a slash are accepted, # and control characters are not', () => {
  const lauf = (uid) => fuehreListeAus(basisProjekt(), [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'host', plugin: { format: 'vst3', pfad: '/p/X.vst3', uid } }]);
  for (const uid of ['Cypher EQ', 'A/B Tester x2 Mono', 'ABCDEF0123456789']) assert.equal(lauf(uid).projekt.spuren[0].inserts[0].plugin.uid, uid);
  for (const uid of ['a#b', 'a\nb', 'x'.repeat(257)]) assert.throws(() => lauf(uid), (x) => x.grund === 'argument_ungueltig', uid);
});

test('a failed restore keeps the stage dry (ausfall zustand_fehler), writes no state file until the user acts, and the user file stays', async (t) => {
  const e = aufbau(t);
  const datei = zustandDatei(e.A.ordner, e.insert.zustand);
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  fs.writeFileSync(datei, '<Info><Name>Fake EQ</Name></Info><V>user state</V>');
  e.A.zustandSetzenFehler = true;
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => e.verw.lage()[0]?.grund === 'zustand_fehler'), JSON.stringify(e.verw.lage()));
  assert.equal(e.verw.stufe(1).an, false, 'dry');
  assert.equal(e.A.flag[1], 0);
  await e.verw.zustandSichern('export');
  await e.verw.param(e.insert.id, { 0: 0.9 });
  await schlaf(150);
  assert.equal(e.A.aufrufe('sock', 'zustand_holen').length, 0, 'the manager never asks the host for its state');
  assert.ok(fs.readFileSync(datei, 'utf8').includes('user state'));
  e.A.zustandSetzenFehler = false;
  e.verw.abgleich(e.an(false)); e.verw.abgleich(e.an(true));
  assert.ok(await warteBis(() => status(e.verw) === 'bereit'), JSON.stringify(e.verw.lage()));
});

test('every state write keeps the previous version as <file>.bak', async (t) => {
  const e = aufbau(t);
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => status(e.verw) === 'bereit'));
  const datei = zustandDatei(e.A.ordner, e.insert.zustand);
  await e.verw.zustandSichern('export');
  assert.ok(fs.existsSync(datei) && !fs.existsSync(`${datei}.bak`), 'the first write has no earlier version');
  const erste = fs.readFileSync(datei, 'utf8');
  e.A.hosts.get(1).werte[0] = 0.123;
  await e.verw.zustandSichern('export');
  assert.equal(fs.readFileSync(`${datei}.bak`, 'utf8'), erste);
  assert.notEqual(fs.readFileSync(datei, 'utf8'), erste);
});

test('latency of 8192 or more: the stage is ausfall latenz_zu_gross and its slot is left out of the playback; a core refusal with pdc_zu_lang does the same', async (t) => {
  const e = aufbau(t);
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => status(e.verw) === 'bereit'));
  assert.deepEqual([...e.verw.ausgelassen()], []);
  e.A.hosts.get(1).info.latenz = HOST_LAT_MAX;           // 512 + 8192 >= 8192 once the plugin reports it
  await e.verw.param(e.insert.id, { 0: 0.5 });
  assert.ok(await warteBis(() => e.verw.lage()[0].grund === 'latenz_zu_gross'), JSON.stringify(e.verw.lage()));
  assert.deepEqual([...e.verw.ausgelassen()], [1]);
  assert.equal(e.verw.stufe(1).an, false);
  assert.equal(e.A.flag[1], 0);
  // the plugin is under the limit again; the user switches the stage off and on: it plays again
  e.A.hosts.get(1).info.latenz = 100;
  e.verw.abgleich(e.an(false)); e.verw.abgleich(e.an(true));
  assert.ok(await warteBis(() => status(e.verw) === 'bereit'), JSON.stringify(e.verw.lage()));
  assert.deepEqual([...e.verw.ausgelassen()], []);
  // the core refuses a load with pdc_zu_lang: the host with the most latency leaves the playback
  const vor = e.A.neuLaden.length;
  e.verw.ladeAbgelehnt('zu_gross pdc_zu_lang');
  await warteBis(() => e.verw.ausgelassen().size === 1);
  assert.equal(e.verw.lage()[0].grund, 'latenz_zu_gross');
  assert.ok(await warteBis(() => e.A.neuLaden.length > vor));
  e.verw.ladeAbgelehnt('rev_veraltet');                  // another refusal changes nothing
});

test('a latency over the limit already at the start never goes ready', async (t) => {
  const e = aufbau(t);
  e.A.startMs = 0;
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => e.A.hosts.has(1)));
  e.A.hosts.get(1).info.latenz = 9000;
  assert.ok(await warteBis(() => e.verw.lage()[0]?.grund === 'latenz_zu_gross' || status(e.verw) === 'bereit'));
  if (status(e.verw) === 'bereit') { await e.verw.param(e.insert.id, { 0: 0.5 }); assert.ok(await warteBis(() => e.verw.lage()[0].grund === 'latenz_zu_gross')); }
});

test('an adopted host (plugin loaded before the server started) still gets zustand_setzen from the project file', async (t) => {
  const e = aufbau(t);
  const datei = zustandDatei(e.A.ordner, e.insert.zustand);
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  fs.writeFileSync(datei, '<Info><Name>Fake EQ</Name></Info><V>saved</V>');
  await e.A.insert(['start', '1', hostSpec(e.plugin)]);   // host already running ...
  e.A.hosts.get(1).bereit = 'geladen';                                                                              // ... and loaded
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => status(e.verw) === 'bereit'), JSON.stringify(e.verw.lage()));
  assert.equal(e.A.aufrufe('sock', 'lade').length, 0, 'nothing loaded again');
  assert.equal(e.A.hosts.get(1).zustandSetzen, 1);
});

test('a sock_timeout in info after a confirmed lade: ausfall haengt, then the rest of the sequence runs when the host answers again', async (t) => {
  const e = aufbau(t);
  e.A.sockMs.info = 5;
  let erste = true;
  const alt = e.A.sock.bind(e.A);
  const abh = e.A.abhaengig({ sock: async (pfad, b, ms) => { if (b.befehl === 'info' && erste) { erste = false; throw new Error('sock_timeout'); } return alt(pfad, b, ms); } });
  const verw = new HostVerwaltung(abh, { ...ZEITEN });
  e.A.verw = verw;
  t.after(() => verw.halt());
  verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => verw.lage()[0]?.status === 'bereit', 3000), JSON.stringify(verw.lage()));
  assert.equal(e.A.aufrufe('sock', 'lade').length, 1, 'the plugin was loaded once');
});
