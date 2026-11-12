// Plan 1.11 task 10: the plugin index in the server (plugins/index.ts, areas/plugins/area.ts) on the real Router, with a stand-in scan command.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Router } from '../http/router.ts';
import { json, postAbgewiesen } from '../http/transport.ts';
import { pluginsBereich } from '../areas/plugins/area.ts';
import { PluginIndex } from '../plugins/index.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { basisProjekt } from './support/inserts_scenario.mjs';

const eintrag = (id, extra = {}) => ({ id, format: 'vst3', pfad: `/p/${id}.vst3`, uid: `UID${id}`, name: `Plug ${id}`, hersteller: 'Maker', art: 'effekt',
  audio_ein: 2, audio_aus: 2, parameter: 3, status: 'ok', buendel: `/p/${id}.vst3`, mtime: 1, groesse: 1, gescannt: 'x', ...extra });
const EINTRAEGE = [eintrag('a1', { name: 'Fake EQ' }), eintrag('b2', { name: 'Big Synth', art: 'instrument', hersteller: 'Synthco' }),
  eintrag('c3', { name: 'Bad One', status: 'blockiert', grund: 'zeit' }), eintrag('d4', { name: 'Lv Comp', format: 'lv2', pfad: 'http://x.org/comp', uid: '' })];
const SCAN = { befehl: process.execPath, args: ['-e', 'setTimeout(()=>console.log(JSON.stringify({neu:1,entfernt:0,geaendert:0,blockiert:1})),400)'] };

async function stapel(t, { quelle = 'andreas', index = true, scan = SCAN, zugangExtra = {} } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'plug-b-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const datei = path.join(d, 'plugins', 'index.json');
  if (index) { fs.mkdirSync(path.dirname(datei)); fs.writeFileSync(datei, JSON.stringify({ version: 1, eintraege: EINTRAEGE, uebersprungen: [] })); }
  const q = { wert: quelle };
  const ereignisse = [];
  const idx = new PluginIndex({ datei, scan, bei: (s) => ereignisse.push(s) });
  const router = new Router();
  const ctx = { quelle: () => q.wert, log: () => {}, kiGestoppt: () => false, sende: () => 0, warteQuittung: async () => null, verteile: () => {} };
  router.melde(pluginsBereich(ctx, idx, { insertParameter: async () => ({ code: 200, j: {} }), insertFenster: async () => ({ code: 200, j: {} }), ...zugangExtra }));
  let port = 0;
  const server = http.createServer(async (rq, a) => {
    const url = new URL(rq.url ?? '/', 'http://127.0.0.1');
    const r = router.finde(rq.method ?? '', url.pathname);
    if (!r) return json(a, 404, { fehler: 'keine_route' });
    if (r.schutz === 'fremdePost' && rq.method === 'POST' && postAbgewiesen(rq, a, port)) return;
    await r.handler(rq, a, url);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
  t.after(() => server.close());
  const basis = `http://127.0.0.1:${port}`;
  const ruf = async (m, p, body) => {
    const r = await fetch(basis + p, { method: m, headers: m === 'POST' ? { 'content-type': 'application/json', origin: basis } : {}, body: body === undefined ? undefined : JSON.stringify(body) });
    return { code: r.status, j: await r.json() };
  };
  return { ruf, q, idx, datei, ereignisse };
}

test('GET /plugins: filters by text (name, maker, path), art and format', async (t) => {
  const s = await stapel(t);
  const ids = async (p) => (await s.ruf('GET', p)).j.plugins.map((x) => x.id);
  assert.deepEqual(await ids('/plugins'), ['a1', 'b2', 'c3', 'd4']);
  assert.deepEqual(await ids('/plugins?text=eq'), ['a1']);
  assert.deepEqual(await ids('/plugins?text=SYNTHCO'), ['b2'], 'maker, case-insensitive');
  assert.deepEqual(await ids('/plugins?text=x.org'), ['d4'], 'path');
  assert.deepEqual(await ids('/plugins?art=effekt'), ['a1', 'c3', 'd4']);
  assert.deepEqual(await ids('/plugins?format=lv2'), ['d4']);
  assert.deepEqual(await ids('/plugins?art=effekt&format=vst3&text=plug'), [], 'no match on the name Fake EQ / Bad One');
  assert.deepEqual(await ids('/plugins?art=effekt&format=vst3&text=bad'), ['c3']);
});

test('a missing index file is an empty list, no error', async (t) => {
  const s = await stapel(t, { index: false });
  const r = await s.ruf('GET', '/plugins');
  assert.equal(r.code, 200);
  assert.deepEqual(r.j.plugins, []);
});

test('rescan and entsperren are Andreas only: source cypher gets nur_andreas, nothing starts', async (t) => {
  const s = await stapel(t, { quelle: 'cypher' });
  for (const [p, b] of [['/plugins/rescan', {}], ['/plugins/entsperren', { id: 'c3' }]]) {
    const r = await s.ruf('POST', p, b);
    assert.deepEqual([r.code, r.j.fehler], [403, 'nur_andreas'], p);
    assert.ok(r.j.text);
  }
  assert.equal(s.idx.scanStand().laeuft, false);
  assert.equal(s.idx.finde('c3').status, 'blockiert');
});

test('a second rescan while one runs answers scan_laeuft; GET /plugins answers within 100 ms meanwhile; the scan ends with its result', async (t) => {
  const s = await stapel(t);
  const a = await s.ruf('POST', '/plugins/rescan', {});
  assert.deepEqual([a.code, a.j.ok], [200, true]);
  const b = await s.ruf('POST', '/plugins/rescan', {});
  assert.deepEqual([b.code, b.j.fehler], [409, 'scan_laeuft']);
  const t0 = performance.now();
  const g = await s.ruf('GET', '/plugins');
  assert.ok(performance.now() - t0 < 100, `took ${performance.now() - t0} ms`);
  assert.equal(g.j.scan.laeuft, true);
  const e = await s.ruf('POST', '/plugins/entsperren', { id: 'c3' });
  assert.deepEqual([e.code, e.j.fehler], [409, 'scan_laeuft'], 'the index is not edited under a running scan');
  const t1 = Date.now();
  while ((await s.ruf('GET', '/plugins/scan')).j.laeuft && Date.now() - t1 < 4000) await new Promise((ok) => setTimeout(ok, 30));
  const stand = (await s.ruf('GET', '/plugins/scan')).j;
  assert.deepEqual([stand.laeuft, stand.ergebnis, stand.fehler], [false, { neu: 1, entfernt: 0, geaendert: 0, blockiert: 1 }, null]);
  assert.deepEqual(s.ereignisse.map((x) => x.laeuft), [true, false], 'progress events: start and end');
  assert.equal((await s.ruf('POST', '/plugins/rescan', {})).code, 200, 'a new scan can start after the end');
});

test('a failing scan command ends with a fehler and frees the lock', async (t) => {
  const s = await stapel(t, { scan: { befehl: process.execPath, args: ['-e', 'process.exit(3)'] } });
  assert.equal((await s.ruf('POST', '/plugins/rescan', {})).code, 200);
  const t1 = Date.now();
  while ((await s.ruf('GET', '/plugins/scan')).j.laeuft && Date.now() - t1 < 4000) await new Promise((ok) => setTimeout(ok, 30));
  assert.deepEqual([(await s.ruf('GET', '/plugins/scan')).j.laeuft, (await s.ruf('GET', '/plugins/scan')).j.fehler], [false, 'exit 3']);
});

test('entsperren drops a blocked entry from the index; unknown id is plugin_unbekannt; an ok entry stays', async (t) => {
  const s = await stapel(t);
  assert.deepEqual((await s.ruf('POST', '/plugins/entsperren', { id: 'c3' })).j, { ok: true, entsperrt: true });
  assert.equal(s.idx.finde('c3'), null);
  assert.equal(s.idx.liste().length, 3);
  const u = await s.ruf('POST', '/plugins/entsperren', { id: 'zzz' });
  assert.deepEqual([u.code, u.j.fehler], [404, 'plugin_unbekannt']);
  assert.deepEqual((await s.ruf('POST', '/plugins/entsperren', { id: 'a1' })).j, { ok: true, entsperrt: false });
  assert.equal((await s.ruf('POST', '/plugins/entsperren', {})).code, 400);
});

test('insert_setzen with plugin_id: resolves the index; blocked, instrument and unknown ids are refused', async (t) => {
  const s = await stapel(t);
  const lauf = (b) => fuehreListeAus(basisProjekt(), [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'host', ...b }], { pluginIndex: (id) => s.idx.finde(id) });
  const ok = lauf({ plugin_id: 'a1' }).projekt.spuren.find((x) => x.id === 's1').inserts[0];
  assert.deepEqual(ok.plugin, { format: 'vst3', pfad: '/p/a1.vst3', uid: 'UIDa1', name: 'Fake EQ' });
  assert.deepEqual(lauf({ plugin_id: 'd4' }).projekt.spuren.find((x) => x.id === 's1').inserts[0].plugin.uid, '');
  const grund = (b) => { try { lauf(b); } catch (e) { return e.grund; } return null; };
  assert.equal(grund({ plugin_id: 'c3' }), 'plugin_blockiert');
  assert.equal(grund({ plugin_id: 'b2' }), 'kein_effekt');
  assert.equal(grund({ plugin_id: 'nope' }), 'plugin_unbekannt');
  assert.equal(grund({ plugin_id: 'a1', plugin: { format: 'vst3', pfad: '/x', uid: 'U' } }), 'argument_ungueltig');
});

test('GET /proj/spur/<id>/geraet/ist passes the names to the project session; without a session method it answers 404', async (t) => {
  const gesehen = [];
  const a = await stapel(t, { zugangExtra: { geraetIst: async (id, namen) => { gesehen.push([id, namen]); return { code: 200, j: { spur_id: id, werte: { a_x: 1 } } }; } } });
  const r = await a.ruf('GET', '/proj/spur/s7/geraet/ist?namen=a_x,a_y');
  assert.equal(r.code, 200);
  assert.deepEqual(r.j.werte, { a_x: 1 });
  assert.deepEqual(gesehen, [['s7', 'a_x,a_y']]);
  const b = await stapel(t);
  assert.equal((await b.ruf('GET', '/proj/spur/s7/geraet/ist?namen=a_x')).code, 404);
});
