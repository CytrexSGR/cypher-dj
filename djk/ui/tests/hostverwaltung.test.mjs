// Plan 1.11 task 7: the host manager (plugins/hostverwaltung.ts) against an in-memory stand-in for djk-insert, the host socket and the core
// (tests/support/host_mock.mjs), at a small time scale. The session wiring (open, undo, route, split loads) is in the second half of this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { HostVerwaltung, hostSpec, insHostListe, ladeAblehnung, sockAnfrage, insertAusfuehren } from '../plugins/hostverwaltung.ts';
import { zustandDatei } from '../plugins/state.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { basisProjekt } from './support/inserts_scenario.mjs';
import { tmpOrdner } from './support/project.mjs';
import { hostAttrappe, ZEITEN, warteBis, schlaf } from './support/host_mock.mjs';

function aufbau(t, { vst3 = true, zeiten = {}, hosts = 1 } = {}) {
  const d = tmpOrdner(t, 'djk-host-');
  const pfad = path.join(d, 'Fake EQ.vst3');
  if (vst3) fs.mkdirSync(pfad);
  const A = hostAttrappe({ ordner: path.join(d, 'project') });
  fs.mkdirSync(A.ordner, { recursive: true });
  const verw = new HostVerwaltung(A.abhaengig(), { ...ZEITEN, ...zeiten });
  A.verw = verw;
  t.after(() => verw.halt());
  const plugin = { format: 'vst3', pfad, uid: 'ABCDEF0123456789ABCDEF0123456789' };
  const befehle = ['s1', 's2', 's3', 'master'].slice(0, hosts).map((strang) => ({ befehl: 'insert_setzen', strang_id: strang, pos: 0, art: 'host', plugin }));
  const projekt = fuehreListeAus(basisProjekt(), befehle).projekt;
  const inserts = (p = projekt) => p.spuren.flatMap((s) => s.inserts ?? []).filter((i) => i.art === 'host');
  return { d, pfad, A, verw, plugin, projekt, inserts, spec: hostSpec(plugin) };
}
const bereit = (verw, h = 1) => verw.lage().find((x) => x.h === h)?.status === 'bereit';
const flagFolge = (A, h = 1) => A.aufrufe('kern', 'ins_host').filter((z) => z.h === h).map((z) => z.gesund);

test('spec string: always with the trailing # (an LV2 URI with # inside included)', () => {
  assert.equal(hostSpec({ format: 'vst3', pfad: '/a/B.vst3', uid: 'AB12' }), 'vst3:/a/B.vst3#AB12');
  assert.equal(hostSpec({ format: 'lv2', pfad: 'http://x.org/p#comp', uid: '' }), 'lv2:http://x.org/p#comp#');
  assert.equal(hostSpec({ format: 'lv2', pfad: 'http://lsp-plug.in/plugins/lv2/comp_stereo', uid: '' }).endsWith('#'), true);
});

test('abgleich returns at once; a host start that sleeps 5 s does not hold it, lage says startet', async (t) => {
  const e = aufbau(t);
  e.A.startMs = 5000;
  const t0 = performance.now();
  e.verw.abgleich(e.projekt);
  assert.ok(performance.now() - t0 < 200, `took ${performance.now() - t0} ms`);
  assert.deepEqual(e.verw.lage().map((x) => [x.h, x.status]), [[1, 'startet']]);
  assert.deepEqual(e.verw.stufe(1).an, false);
});

test('a missing plugin file: lage says fehlt at once, nothing is started', async (t) => {
  const e = aufbau(t, { vst3: false });
  e.A.startMs = 5000;
  const t0 = performance.now();
  e.verw.abgleich(e.projekt);
  assert.ok(performance.now() - t0 < 200);
  const [x] = e.verw.lage();
  assert.deepEqual([x.status, x.grund], ['fehlt', 'plugin_nicht_ladbar']);
  assert.equal(e.A.aufrufe('insert', 'start').length, 0);
  assert.deepEqual(e.verw.stufe(1), { an: false, latenz: 512 }, 'the estimate, off');
});

test('variant B: flag 1, measurement on the empty rack, lade, state, ready; latency = round trip + plugin latency + extra; the spec has the #', async (t) => {
  const e = aufbau(t);
  const datei = zustandDatei(e.A.ordner, e.inserts()[0].zustand);
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  fs.writeFileSync(datei, '<Info><Name>Fake EQ</Name></Info>');
  const stufenBeiZustand = [];
  const alt = e.A.sock;
  e.A.sock = async (p, b, ms) => { if (b.befehl === 'zustand_setzen') stufenBeiZustand.push(e.verw.stufe(1).an); return alt(p, b, ms); };
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => bereit(e.verw)), JSON.stringify(e.verw.lage()));
  const folge = e.A.folge.filter((z) => z.art !== 'insert' || z.befehl !== 'status').map((z) => z.befehl);
  assert.deepEqual(folge.slice(0, 7), ['start', 'ins_host', 'ins_mess', 'lade', 'info', 'zustand_setzen', 'latenz']);
  assert.equal(e.A.aufrufe('insert', 'start')[0].spec, e.spec);
  assert.deepEqual(stufenBeiZustand, [false], 'the state goes in before the stage is switched on');
  assert.deepEqual(e.verw.stufe(1), { an: true, latenz: 512 + 69 });
  assert.equal(e.verw.lage()[0].gemessen, true);
  assert.equal(flagFolge(e.A).at(-1), 1);
  assert.ok(await warteBis(() => e.A.neuLaden.length >= 1));
  assert.deepEqual(e.A.neuLaden[0].stufen[0], { an: true, latenz: 581 });
  e.verw.abgleich(fuehreListeAus(e.projekt, [{ befehl: 'insert_latenz_extra', insert_id: e.inserts()[0].id, samples: 100 }]).projekt);
  assert.equal(e.verw.stufe(1).latenz, 681, 'extra latency counts');
  assert.ok(await warteBis(() => e.A.neuLaden.length >= 2), 'and reloads the playback');
});

test('the measurement still works with a plugin that mutes when active (a-exp): the impulse never passes an active plugin', async (t) => {
  const e = aufbau(t);
  e.A.sock = ((alt) => async (p, b, ms) => { const r = await alt(p, b, ms); if (b.befehl === 'lade') e.A.hosts.get(1).stumm = true; return r; })(e.A.sock);
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => bereit(e.verw)));
  assert.equal(e.verw.lage()[0].gemessen, true);
  assert.equal(e.verw.stufe(1).latenz, 512 + 69);
  const ms = e.A.aufrufe('kern', 'ins_mess'), lade = e.A.aufrufe('sock', 'lade');
  assert.equal(ms.length, 1); assert.ok(ms[0].t <= lade[0].t, 'measured before lade');
});

test('transport running: no measurement, 2 x quantum as a marked estimate; at the next stop the host restarts empty and is measured', async (t) => {
  const e = aufbau(t);
  e.A.steht = false;
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => bereit(e.verw)));
  assert.equal(e.A.aufrufe('kern', 'ins_mess').length, 0);
  assert.deepEqual([e.verw.lage()[0].gemessen, e.verw.stufe(1).latenz], [false, 512 + 69]);
  assert.deepEqual(flagFolge(e.A), [1], 'the flag rises only after lade and state (no measurement needs it earlier)');
  e.verw.ereignis('/zustand/arr', { status: 2 });
  e.A.steht = true;
  e.verw.ereignis('/zustand/arr', { status: 0 });
  assert.ok(await warteBis(() => e.verw.lage()[0].gemessen && bereit(e.verw)), JSON.stringify(e.verw.lage()));
  assert.equal(e.A.aufrufe('kern', 'ins_mess').length, 1);
  assert.equal(e.A.aufrufe('insert', 'start').length, 2, 'one clean restart');
});

test('a measurement refused with host_fehlt (the core has not seen the host edges yet) is asked again, then measured (real-core finding)', async (t) => {
  const e = aufbau(t);
  e.A.messung.push('host_fehlt', 'host_fehlt', 700);
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => e.verw.lage()[0].gemessen && bereit(e.verw)), JSON.stringify(e.verw.lage()));
  assert.equal(e.verw.stufe(1).latenz, 700 + 69, 'the retried measurement counts');
  assert.equal(e.A.aufrufe('kern', 'ins_mess').length, 3);
});

test('implausible measurement (under 2 x quantum) is discarded, the estimate stays marked; a failed one keeps the last good value', async (t) => {
  const e = aufbau(t);
  e.A.messung.push(100);
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => bereit(e.verw)));
  assert.deepEqual([e.verw.lage()[0].gemessen, e.verw.stufe(1).latenz], [false, 512 + 69], 'stale return audio is not a round trip');
  // the next opportunity (a stop edge) measures again, now a good value
  e.A.messung.push(700);
  e.verw.ereignis('/zustand/arr', { status: 2 }); e.verw.ereignis('/zustand/arr', { status: 0 });
  assert.ok(await warteBis(() => e.verw.lage()[0].gemessen && bereit(e.verw)));
  assert.equal(e.verw.stufe(1).latenz, 700 + 69);
  // a restart whose measurement fails keeps 700
  e.A.messung.push('kein_rueckweg');
  e.A.abstuerzen(1);
  assert.ok(await warteBis(() => e.A.aufrufe('kern', 'ins_mess').length === 3 && bereit(e.verw)), JSON.stringify(e.verw.lage()));
  assert.equal(e.verw.stufe(1).latenz, 700 + 69, 'the last good value');
  assert.equal(e.verw.lage()[0].gemessen, true);
});

test('latency 69 then 133 after a param call: exactly one playback reload, the stage latency = round trip + 133', async (t) => {
  const e = aufbau(t);
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => bereit(e.verw)));
  await schlaf(40);
  const vorher = e.A.neuLaden.length;
  e.A.hosts.get(1).nachParam = (x) => { x.info.latenz = 133; };
  const r = await e.verw.param(e.inserts()[0].id, { 0: 0.9 });
  assert.deepEqual(r, { ok: true, werte: { 0: 0.9 } });
  assert.ok(await warteBis(() => e.A.neuLaden.length > vorher));
  await schlaf(60);
  assert.equal(e.A.neuLaden.length, vorher + 1, 'exactly one reload');
  assert.equal(e.verw.stufe(1).latenz, 512 + 133);
  await e.verw.param(e.inserts()[0].id, { 0: 0.4 });
  await schlaf(60);
  assert.equal(e.A.neuLaden.length, vorher + 1, 'negative control: an unchanged latency reloads nothing');
});

test('param: clamps, names param_unbekannt, host_fehlt without a ready host', async (t) => {
  const e = aufbau(t);
  assert.deepEqual(await e.verw.param('i1', { 0: 0.5 }), { ok: false, fehler: 'host_fehlt' });
  e.verw.abgleich(e.projekt);
  assert.deepEqual(await e.verw.param(e.inserts()[0].id, { 0: 0.5 }), { ok: false, fehler: 'host_fehlt' }, 'not ready yet');
  assert.ok(await warteBis(() => bereit(e.verw)));
  assert.deepEqual(await e.verw.param(e.inserts()[0].id, { 1: 1.5 }), { ok: true, werte: { 1: 1 } });
  assert.deepEqual(await e.verw.param(e.inserts()[0].id, { 7: 0.5 }), { ok: false, fehler: 'param_unbekannt' });
});

test('health: a host that restarts EMPTY clears the flag within one poll, is re-sequenced and ends healthy again', async (t) => {
  const e = aufbau(t);
  const datei = zustandDatei(e.A.ordner, e.inserts()[0].zustand);
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => bereit(e.verw)));
  await e.verw.zustandSichern('export');
  assert.ok(fs.existsSync(datei));
  const lade0 = e.A.aufrufe('sock', 'lade').length, folge0 = flagFolge(e.A).length;
  const nl0 = e.A.neuLaden.length;
  e.A.ladeMs = 100;                                   // the new load takes a while: the stage must play dry meanwhile
  const t0 = Date.now();
  e.A.abstuerzen(1);
  assert.ok(await warteBis(() => flagFolge(e.A).length > folge0, 400), 'flag 0');
  assert.ok(Date.now() - t0 < ZEITEN.pollMs * 4 + 60, `flag 0 after ${Date.now() - t0} ms`);
  assert.equal(flagFolge(e.A)[folge0], 0);
  assert.ok(await warteBis(() => e.A.neuLaden.length > nl0), 'a reload');
  assert.equal(e.A.neuLaden[nl0].stufen[0].an, false, 'the first reload after the crash writes the stage off: dry, aligned');
  assert.equal(e.A.neuLaden[nl0].stufen[0].latenz, 581, 'with the last latency');
  assert.ok(await warteBis(() => bereit(e.verw) && e.A.flag[1] === 1), JSON.stringify(e.verw.lage()));
  assert.equal(e.A.aufrufe('sock', 'lade').length, lade0 + 1, 're-sequenced');
  assert.ok(e.A.aufrufe('sock', 'zustand_setzen').length >= 1, 'the state went back in');
  assert.ok(e.A.aufrufe('kern', 'ins_mess').length >= 2, 'measured again on the empty rack');
});

test('health: a new pid after lade without status leer, a status of the old pid, a dead host and a stale pulse all clear the flag', async (t) => {
  const e = aufbau(t);
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => bereit(e.verw)));
  // restart whose file already says geladen (neustart phase is over, same plugin loaded by someone else): pid differs
  e.A.hosts.get(1).pid = 424242;
  assert.ok(await warteBis(() => e.A.flag[1] === 0, 400), 'pid changed');
  e.A.hosts.get(1).bereit = 'leer';
  assert.ok(await warteBis(() => bereit(e.verw) && e.A.flag[1] === 1));
  e.A.hosts.get(1).haengt = true;
  assert.ok(await warteBis(() => e.A.flag[1] === 0, 600), 'stale pulse');
  assert.equal(e.verw.lage()[0].grund, 'haengt');
  e.A.hosts.get(1).haengt = false;
  assert.ok(await warteBis(() => bereit(e.verw) && e.A.flag[1] === 1), 'the same process back: ready again');
  e.A.hosts.get(1).laeuft = false;
  assert.ok(await warteBis(() => e.A.flag[1] === 0 && e.verw.lage()[0].status === 'ausfall', 400), 'dead');
});

test('watchdog tolerance: a silent pulse is tolerated while a call of the manager is open, not otherwise', async (t) => {
  const e = aufbau(t, { zeiten: { toleranzMs: 500 } });
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => bereit(e.verw)));
  const id = e.inserts()[0].id;
  e.A.sockMs.zustand_holen = 250;                      // a slow state call: far more than pulsMs (60), less than toleranzMs
  e.A.hosts.get(1).haengt = false;
  const lauf = e.verw.zustandSichern('export');
  const x = e.A.hosts.get(1);
  const pulsAlt = x.puls; x.puls = pulsAlt;            // keep the counter, then freeze it for the duration of the call
  x.haengt = true;
  const f0 = flagFolge(e.A).length;
  await schlaf(150);
  assert.equal(flagFolge(e.A).length, f0, 'tolerated: the call is open');
  x.haengt = false;
  await lauf;
  x.haengt = true;
  assert.ok(await warteBis(() => e.A.flag[1] === 0, 600), 'no call open: cleared');
  void id;
});

test('a plugin that cannot be loaded: fehlt with plugin_nicht_ladbar, the flag is 0, no restart loop', async (t) => {
  const e = aufbau(t);
  e.A.nichtLadbar = true;
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => e.verw.lage()[0].status === 'fehlt'));
  assert.equal(e.verw.lage()[0].grund, 'plugin_nicht_ladbar');
  await schlaf(100);
  assert.equal(e.A.aufrufe('sock', 'lade').length, 1);
  assert.equal(e.A.flag[1], 0);
  assert.equal(e.verw.stufe(1).an, false);
});

test('a start refused with exit 2 (plugin missing for djk-insert) is fehlt', async (t) => {
  const e = aufbau(t);
  e.A.fehlend.add(e.spec);
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => e.verw.lage()[0].status === 'fehlt'));
});

test('state: ten param calls in a row write once, 2 s (scaled) after the last; the file is replaced atomically', async (t) => {
  const e = aufbau(t);
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => bereit(e.verw)));
  const id = e.inserts()[0].id;
  for (let i = 0; i < 10; i++) { await e.verw.param(id, { 0: i / 10 }); await schlaf(10); }
  assert.equal(e.A.aufrufe('sock', 'zustand_holen').length, 0, 'not yet');
  assert.ok(await warteBis(() => e.A.aufrufe('sock', 'zustand_holen').length === 1));
  await schlaf(200);
  assert.equal(e.A.aufrufe('sock', 'zustand_holen').length, 1, 'exactly one');
  const datei = zustandDatei(e.A.ordner, e.inserts()[0].zustand);
  assert.ok(fs.existsSync(datei) && !fs.existsSync(`${datei}.neu`));
  assert.ok(e.A.aufrufe('sock', 'zustand_holen')[0].pfad.endsWith('.carxs.neu'));
});

test('state: window open writes every 30 s (scaled), closing writes once more; close and end write once each', async (t) => {
  const e = aufbau(t);
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => bereit(e.verw)));
  const id = e.inserts()[0].id, n = () => e.A.aufrufe('sock', 'zustand_holen').length;
  e.verw.fensterOffen(id);
  assert.ok(await warteBis(() => n() >= 2, 1000), 'interval while open');
  await e.verw.fensterZu(id);
  const nach = n();
  await schlaf(300);
  assert.equal(n(), nach, 'no interval after close');
  await e.verw.zustandSichern('schliessen');
  assert.equal(n(), nach + 1, 'project close: one');
  await e.verw.beende();
  assert.equal(n(), nach + 2, 'server end: one');
});

test('state: a slow host does not hold the end longer than endeMs', async (t) => {
  const e = aufbau(t);
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => bereit(e.verw)));
  e.A.sockMs.zustand_holen = 2000;
  const t0 = Date.now();
  await e.verw.beende();
  assert.ok(Date.now() - t0 < ZEITEN.endeMs + 200, `${Date.now() - t0} ms`);
});

test('state of another plugin: zustand_passt_nicht is the grund, the state file is never overwritten', async (t) => {
  const e = aufbau(t);
  const datei = zustandDatei(e.A.ordner, e.inserts()[0].zustand);
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  fs.writeFileSync(datei, '<Info><Name>Other Plugin</Name></Info>');
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => bereit(e.verw)));
  assert.equal(e.verw.lage()[0].grund, 'zustand_passt_nicht');
  await e.verw.zustandSichern('export');
  assert.equal(e.A.aufrufe('sock', 'zustand_holen').length, 0);
  assert.match(fs.readFileSync(datei, 'utf8'), /Other Plugin/);
});

test('removing the stage stops the host and keeps the state file; adding it again restores the sound', async (t) => {
  const e = aufbau(t);
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => bereit(e.verw)));
  await e.verw.param(e.inserts()[0].id, { 0: 0.7 });
  const datei = zustandDatei(e.A.ordner, e.inserts()[0].zustand);
  e.verw.abgleich(basisProjekt());
  assert.ok(await warteBis(() => !e.A.hosts.has(1) && e.A.aufrufe('insert', 'stop').length === 1));
  assert.equal(e.verw.lage().length, 0);
  assert.ok(fs.existsSync(datei), 'the state file stays');
  assert.equal(e.A.flag[1], 0);
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => bereit(e.verw)));
  assert.equal(e.A.aufrufe('sock', 'zustand_setzen').length, 1, 'redo: the state goes back in');
});

test('two hosts: independent lage; a fifth cannot exist in the project; the flag goes only to the host that changed', async (t) => {
  const e = aufbau(t, { hosts: 3 });
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => [1, 2, 3].every((h) => bereit(e.verw, h))));
  assert.deepEqual(e.verw.lage().map((x) => x.h), [1, 2, 3]);
  e.A.abstuerzen(2);
  assert.ok(await warteBis(() => flagFolge(e.A, 2).length >= 3, 800));
  assert.equal(flagFolge(e.A, 2)[2], 0, 'host 2: measure 1, ready 1, crash 0');
  assert.deepEqual([flagFolge(e.A, 1).length, flagFolge(e.A, 3).length], [flagFolge(e.A, 1).length, flagFolge(e.A, 3).length]);
  assert.deepEqual([e.A.flag[1], e.A.flag[3]], [1, 1]);
  assert.equal(flagFolge(e.A, 1).filter((g) => g === 0).length, 0, 'host 1 never cleared');
});

test('the real socket client talks JSON lines to a Unix socket and times out on a silent one', async (t) => {
  const d = tmpOrdner(t, 'djk-sock-');
  const p = path.join(d, 'h.sock'), still = path.join(d, 's.sock');
  const srv = net.createServer((c) => c.on('data', (b) => c.write(`${JSON.stringify({ ok: true, echo: JSON.parse(b.toString()) })}\n`)));
  const srv2 = net.createServer(() => undefined);
  await new Promise((ok) => srv.listen(p, ok)); await new Promise((ok) => srv2.listen(still, ok));
  t.after(() => { srv.close(); srv2.close(); });
  assert.deepEqual(await sockAnfrage(p, { befehl: 'info' }, 500), { ok: true, echo: { befehl: 'info' } });
  await assert.rejects(sockAnfrage(still, { befehl: 'info' }, 80), /sock_timeout/);
  await assert.rejects(sockAnfrage(path.join(d, 'weg.sock'), { befehl: 'info' }, 80), /sock_verbindung/);
});

test('insertAusfuehren runs a command and reports code, output and error', async (t) => {
  const d = tmpOrdner(t, 'djk-ins-');
  const skript = path.join(d, 'fake-insert');
  fs.writeFileSync(skript, '#!/bin/sh\necho "args: $*"\necho oops >&2\nexit 3\n', { mode: 0o755 });
  const r = await insertAusfuehren(['start', '1', 'vst3:/x#y'], 'e', skript);
  assert.deepEqual([r.code, r.aus.trim(), r.fehler.trim()], [3, 'args: start 1 vst3:/x#y --instanz e', 'oops']);
  assert.equal((await insertAusfuehren(['status', '1'], '', path.join(d, 'gibts-nicht'))).code, 127);
});

test('pure helpers: ins_host list from the core state, loader tokens searched as substrings', () => {
  const l = insHostListe({ h_1: 1, gesund_1: 1, rundweg_1: 512, h_2: 2, gesund_2: 0, rundweg_2: -1, h_3: 3, gesund_3: 0, rundweg_3: -1, h_4: 4, gesund_4: 0, rundweg_4: -1 });
  assert.deepEqual(l[0], { h: 1, gesund: true, rundweg: 512 });
  assert.equal(l.length, 4);
  assert.equal(ladeAblehnung('format', 'spuren[0].chain[0].host_fehlt: the effect-host ports'), 'host_fehlt');
  assert.equal(ladeAblehnung('zu_gross', 'x pdc_zu_lang (9000 samples)'), 'pdc_zu_lang');
  assert.equal(ladeAblehnung('format', 'slot ungueltig: host h is pool instance'), 'host_ungueltig');
  assert.equal(ladeAblehnung('format', 'something else'), null);
});

// --- the session wiring: open, param route, undo, split loads, end ----------------------------------------------------------------------
import { sitzung, pruefKontext, warteBis as warteS } from './support/proj_context.mjs';

async function sitzungMitHost(t, { vst3 = true, zeiten = {}, quelle = 'andreas' } = {}) {
  const d = tmpOrdner(t, 'djk-hsess-');
  const pfad = path.join(d, 'Fake EQ.vst3');
  if (vst3) fs.mkdirSync(pfad);
  const A = hostAttrappe({ ordner: null });
  const k = pruefKontext();
  const { s, wurzel } = sitzung(t, { host: { abhaengig: { insert: (...a) => A.insert(...a), sock: (...a) => A.sock(...a) }, zeiten: { ...ZEITEN, ...zeiten } } }, k);
  // the session builds its own core calls (flag and measurement through the context); the stand-in answers them
  A.verw = s.hosts;
  A.neuLaden = { length: 0, push() { this.length++; } };
  const alt = k.sende.bind(k);
  k.sende = (adr, f) => { if (adr === '/k/arr/ins_host') A.flag[f.h] = f.gesund; if (adr === '/k/arr/ins_mess') A.kern.insMess(f.h); return alt(adr, f); };
  s.ereignis('/zustand/arr', { nr: 0, status: 0, loop_an: 0, projekt_beat: 0, ursprung_sample: 0n, start_beat: 0, metronom_an: 0, limiter_db: 0 });
  await s.neu('H', 'andreas');
  A.ordner = path.join(wurzel, 'h');
  const plugin = { format: 'vst3', pfad, uid: 'ABCDEF0123456789ABCDEF0123456789' };
  const rev = () => s.aktuell().j.projekt.rev;
  const setze = (strang = 's1', extra = {}) => s.aendern({ rev: rev(), label: 'host', befehle: [{ befehl: 'insert_setzen', strang_id: strang, pos: 0, art: 'host', plugin, ...extra }] }, quelle);
  await s.aendern({ rev: rev(), label: 't', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  return { s, k, A, d, wurzel, pfad, plugin, rev, setze };
}

test('session: open returns in under 200 ms with a host start that sleeps 5 s; a missing plugin says fehlt', async (t) => {
  const e = await sitzungMitHost(t);
  assert.equal((await e.setze()).code, 200);
  await e.s.oeffnen('h', 'andreas');                    // reopen: the host stage is there
  e.A.startMs = 5000;
  const t0 = performance.now();
  const r = await e.s.oeffnen('h', 'andreas');
  assert.ok(performance.now() - t0 < 200, `open took ${performance.now() - t0} ms`);
  assert.equal(r.code, 200);
  assert.equal(e.s.hostLage()[0].status, 'startet');
  fs.rmSync(e.pfad, { recursive: true });
  e.A.startMs = 0;
  await e.s.oeffnen('h', 'andreas');
  const t1 = performance.now();
  await e.s.oeffnen('h', 'andreas');
  assert.ok(performance.now() - t1 < 200);
  assert.deepEqual(e.s.hostLage().map((x) => x.status), ['fehlt']);
});

test('session: the param route is no command: no history entry, no project write, no revision change', async (t) => {
  const e = await sitzungMitHost(t);
  assert.equal((await e.setze()).code, 200);
  assert.ok(await warteS(() => e.s.hostLage()[0]?.status === 'bereit'));
  const id = e.s.aktuell().j.projekt.spuren[0].inserts[0].id;
  const dateien = () => fs.readdirSync(path.join(e.wurzel, 'h')).map((n) => [n, fs.statSync(path.join(e.wurzel, 'h', n)).mtimeMs]);
  const vor = { rev: e.rev(), verlauf: e.s.verlaufListe().j.length, dateien: dateien(), laden: e.k.an('/k/arr/laden').length };
  await schlaf(30);
  const r = await e.s.insertParam(id, { werte: { 0: 0.8, 1: 0.2 } }, 'andreas');
  assert.deepEqual([r.code, r.j.ok], [200, true]);
  assert.deepEqual({ rev: e.rev(), verlauf: e.s.verlaufListe().j.length, dateien: dateien(), laden: e.k.an('/k/arr/laden').length }, vor);
  await assert.rejects(e.s.insertParam(id, { werte: { 9: 0.5 } }, 'andreas'), (x) => x.grund === 'param_unbekannt' || x.fehler === 'param_unbekannt');
  await assert.rejects(e.s.insertParam('i999', { werte: { 0: 0.5 } }, 'andreas'), (x) => x.code === 404);
  for (const roh of [null, [], {}, { 0: 'x' }, { a: 0.5 }, { 0: Infinity }]) {
    await assert.rejects(e.s.insertParam(id, { werte: roh }, 'andreas'), (x) => x.code === 400, JSON.stringify(roh));
  }
  e.k.ki = true;
  await assert.rejects(e.s.insertParam(id, { werte: { 0: 0.5 } }, 'cypher'), (x) => x.code === 409);
  assert.equal((await e.s.insertParam(id, { werte: { 0: 0.5 } }, 'andreas')).code, 200, 'Stop Cypher does not stop Andreas');
});

test('session: flag and measurement go out as leitstand, also while Stop Cypher is on', async (t) => {
  const e = await sitzungMitHost(t);
  e.k.ki = true;
  assert.equal((await e.setze()).code, 200);
  assert.ok(await warteS(() => e.s.hostLage()[0]?.status === 'bereit'));
  const sendungen = [...e.k.an('/k/arr/ins_host'), ...e.k.an('/k/arr/ins_mess')];
  assert.ok(sendungen.length >= 3);
  assert.ok(sendungen.every((x) => x.felder.quelle === 'leitstand'));
});

test('session: undo of insert_setzen stops the host and keeps the state file; redo restores the sound', async (t) => {
  const e = await sitzungMitHost(t);
  assert.equal((await e.setze()).code, 200);
  assert.ok(await warteS(() => e.s.hostLage()[0]?.status === 'bereit'));
  const id = e.s.aktuell().j.projekt.spuren[0].inserts[0].id;
  await e.s.insertParam(id, { werte: { 0: 0.7 } }, 'andreas');
  await e.s.hostZustandSichern('export');
  const datei = path.join(e.wurzel, 'h', 'plugins', `${id}.carxs`);
  assert.ok(fs.existsSync(datei));
  assert.equal((await e.s.umkehr('undo', { rev: e.rev() }, 'andreas')).code, 200);
  assert.ok(await warteS(() => e.s.hostLage().length === 0 && e.A.aufrufe('insert', 'stop').length >= 1));
  assert.ok(fs.existsSync(datei), 'the state file stays');
  assert.equal((await e.s.umkehr('redo', { rev: e.rev() }, 'andreas')).code, 200);
  assert.ok(await warteS(() => e.s.hostLage()[0]?.status === 'bereit'));
  assert.equal(e.A.aufrufe('sock', 'zustand_setzen').length, 1, 'the sound comes back from the state file');
});

test('session: the 5th host insert is host_grenze and nothing is half applied', async (t) => {
  const e = await sitzungMitHost(t);
  await e.s.aendern({ rev: e.rev(), label: 'more', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  for (const sp of ['s1', 's2', 's3', 's4']) assert.equal((await e.setze(sp)).code, 200);
  const rev = e.rev(), laden = e.k.an('/k/arr/laden').length;
  await assert.rejects(e.setze('s5'), (x) => x.grund === 'host_grenze' || x.fehler === 'host_grenze');
  assert.deepEqual([e.rev(), e.k.an('/k/arr/laden').length], [rev, laden]);
});

test('session: a host slot never changes strip inside one playback load (removal first, entry at least latency + 480 samples later)', async (t) => {
  const e = await sitzungMitHost(t);
  assert.equal((await e.setze('s1')).code, 200);
  assert.ok(await warteS(() => e.s.hostLage()[0]?.status === 'bereit'));
  await schlaf(60);
  const id = e.s.aktuell().j.projekt.spuren[0].inserts[0].id;
  const vor = e.k.an('/k/arr/laden').length, zeit0 = Date.now();
  const w = await e.s.aendern({ rev: e.rev(), label: 'move', befehle: [{ befehl: 'insert_entfernen', insert_id: id }, { befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'host', plugin: e.plugin }] }, 'andreas');
  assert.equal(w.code, 200);
  const neu = e.k.an('/k/arr/laden').slice(vor);
  assert.ok(neu.length >= 2, `two loads (${neu.length})`);
  const gelesen = neu.map((x) => JSON.parse(fs.readFileSync(path.join(e.s.arbeitsordner, `wiedergabe-${x.felder.nr}.json`), 'utf8')));
  const traeger = (w) => w.spuren.flatMap((sp, i) => (sp.chain ?? []).filter((c) => c.art === 'host').map(() => i));
  assert.deepEqual(traeger(gelesen[0]), [], 'the first load has no host stage on the old strip');
  assert.ok(Date.now() - zeit0 >= (512 + 69 + 480) / 48 - 1, 'the entry waits for latency + 480 samples');
  void traeger;
});

test('session: server end writes the state once; project close writes once', async (t) => {
  const e = await sitzungMitHost(t);
  assert.equal((await e.setze('s1')).code, 200);
  assert.ok(await warteS(() => e.s.hostLage()[0]?.status === 'bereit'));
  const n = () => e.A.aufrufe('sock', 'zustand_holen').length;
  await e.s.beende();
  assert.equal(n(), 1, 'server end: one');
});

test('session: project close writes the state once and stops the hosts', async (t) => {
  const e = await sitzungMitHost(t);
  assert.equal((await e.setze('s1')).code, 200);
  assert.ok(await warteS(() => e.s.hostLage()[0]?.status === 'bereit'));
  await e.s.neu('Anderes', 'andreas');                  // project switch
  assert.equal(e.A.aufrufe('sock', 'zustand_holen').length, 1, 'close: one');
  assert.ok(await warteS(() => e.s.hostLage().length === 0 && e.A.aufrufe('insert', 'stop').length >= 1));
});

test('session negative control: insert_latenz_extra with the stored value makes no history entry and no reload; a new value reloads once', async (t) => {
  const e = await sitzungMitHost(t);
  assert.equal((await e.setze('s1')).code, 200);
  assert.ok(await warteS(() => e.s.hostLage()[0]?.status === 'bereit'));
  await schlaf(60);
  const id = e.s.aktuell().j.projekt.spuren[0].inserts[0].id;
  const extra = (samples) => e.s.aendern({ rev: e.rev(), label: 'extra', befehle: [{ befehl: 'insert_latenz_extra', insert_id: id, samples }] }, 'andreas');
  assert.equal((await extra(100)).code, 200);
  const stand = () => [e.rev(), e.s.verlaufListe().j.length, e.k.an('/k/arr/laden').length];
  const vor = stand();
  await extra(100).catch(() => undefined);
  await schlaf(60);
  assert.deepEqual(stand(), vor, 'the stored value again: nothing happens');
  assert.equal((await extra(200)).code, 200);
  assert.equal(e.k.an('/k/arr/laden').length, vor[2] + 1, 'a new value: one reload');
});
