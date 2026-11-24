// Test instance isolation, part 2: plugin_pfade.txt (POST /plugins/pfade/dazu|weg) and the Baukasten (kind geraete) write guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Router } from '../http/router.ts';
import { json, postAbgewiesen } from '../http/transport.ts';
import { pluginsBereich } from '../areas/plugins/area.ts';
import { pluginPfadeDatei } from '../paths.ts';
import { schreibeSample } from '../sampler/slots.ts';
import { pruefeBkSchreiben } from '../sampler/bk_schutz.ts';

const mitEnv = (kv, f) => {
  const alt = {}; for (const k of Object.keys(kv)) alt[k] = process.env[k];
  for (const [k, v] of Object.entries(kv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const fertig = () => { for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  try { const r = f(); if (r && typeof r.then === 'function') return r.finally(fertig); fertig(); return r; } catch (e) { fertig(); throw e; }
};

test('pluginPfadeDatei: live studio null (under home as before), instance its own shm file, env wins', () => {
  mitEnv({ CYPHERDJ_INSTANZ: undefined, CYPHERDJ_PLUGIN_PFADE_DATEI: undefined }, () => assert.equal(pluginPfadeDatei(), null));
  mitEnv({ CYPHERDJ_INSTANZ: 'e', CYPHERDJ_PLUGIN_PFADE_DATEI: undefined }, () => assert.equal(pluginPfadeDatei(), '/dev/shm/cypherdj-e/plugin_pfade.txt'));
  mitEnv({ CYPHERDJ_INSTANZ: 'e', CYPHERDJ_PLUGIN_PFADE_DATEI: '/tmp/x.txt' }, () => assert.equal(pluginPfadeDatei(), '/tmp/x.txt'));
  mitEnv({ CYPHERDJ_INSTANZ: 'e', CYPHERDJ_PLUGIN_PFADE_DATEI: '' }, () => assert.equal(pluginPfadeDatei(), '/dev/shm/cypherdj-e/plugin_pfade.txt'));
});

test('POST /plugins/pfade/dazu on a test instance writes the instance file, never <home>/.config/cypherdj/plugin_pfade.txt', async (t) => {
  const h = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pfade-i2-')));
  const shm = '/dev/shm/cypherdj-zz';
  t.after(() => { fs.rmSync(h, { recursive: true, force: true }); fs.rmSync(shm, { recursive: true, force: true }); });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pfade-i2root-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ziel = path.join(h, 'plugs'); fs.mkdirSync(ziel);
  const router = new Router(); let port = 0;
  const ctx = { quelle: () => 'andreas', log: (z) => { if (process.env.DBG) console.error(JSON.stringify(z)); }, kiGestoppt: () => false, sende: () => 0, warteQuittung: async () => null, verteile: () => {} };
  const idx = { liste: () => [], scanStand: () => ({}), scanne: () => true, merkeNachlauf: () => true, entsperre: () => null };
  router.melde(pluginsBereich(ctx, idx, { insertParameter: async () => ({ code: 200, j: {} }), insertFenster: async () => ({ code: 200, j: {} }) },
    { port: () => port, home: () => h, wurzel: root, erlaubt: () => [{ name: 'Home', pfad: h }] }));
  const server = http.createServer(async (rq, a) => {
    const url = new URL(rq.url ?? '/', 'http://127.0.0.1');
    const r = router.finde(rq.method ?? '', url.pathname);
    if (!r) return json(a, 404, { fehler: 'keine_route' });
    if (r.schutz === 'fremdePost' && rq.method === 'POST' && postAbgewiesen(rq, a, port)) return;
    await r.handler(rq, a, url);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); port = server.address().port; t.after(() => server.close());
  const basis = `http://127.0.0.1:${port}`;
  const dazu = () => fetch(`${basis}/plugins/pfade/dazu`, { method: 'POST', headers: { 'content-type': 'application/json', origin: basis }, body: JSON.stringify({ pfad: ziel }) });
  await mitEnv({ CYPHERDJ_INSTANZ: 'zz', CYPHERDJ_PLUGIN_PFADE_DATEI: undefined }, async () => {
    const r = await dazu(); assert.equal(r.status, 200, await r.text());
  });
  assert.ok(fs.existsSync(`${shm}/plugin_pfade.txt`), 'instance file written');
  assert.match(fs.readFileSync(`${shm}/plugin_pfade.txt`, 'utf8'), /plugs/);
  assert.ok(!fs.existsSync(path.join(h, '.config/cypherdj/plugin_pfade.txt')), 'the home file stays untouched');
  // negative control: live studio (no instance) still writes under home
  await mitEnv({ CYPHERDJ_INSTANZ: undefined, CYPHERDJ_PLUGIN_PFADE_DATEI: undefined }, async () => { const r = await dazu(); assert.equal(r.status, 200); });
  assert.ok(fs.existsSync(path.join(h, '.config/cypherdj/plugin_pfade.txt')));
});

test('Baukasten write guard: a test instance may not write the owner folder (own shm folder by default); with CYPHERDJ_BK_ORDNER or live it goes where it did', () => {
  const h = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bk-i2-')));
  try {
    const echt = path.join(h, '.config/cypherdj/baukasten');
    const frei = { HOME: h, CYPHERDJ_BK_ORDNER: undefined };
    mitEnv({ ...frei, CYPHERDJ_INSTANZ: 'e' }, () => {
      assert.throws(() => pruefeBkSchreiben(path.join(echt, 'samples', 'x.f32')), { grund: 'bk_ordner_fehlt', code: 409 });
      const n0 = schreibeSample(new Float32Array(4));                              // no env: the table gives the instance its own shm folder
      assert.ok(fs.existsSync(path.join('/dev/shm/cypherdj-e/geraete/samples', n0)));
      fs.rmSync('/dev/shm/cypherdj-e/geraete', { recursive: true, force: true });
      assert.ok(!fs.existsSync(echt), 'nothing was created in the owner folder');
      pruefeBkSchreiben(path.join(h, 'woanders', 'x.f32'));                       // another folder: fine
      assert.doesNotThrow(() => schreibeSample(new Float32Array(4), path.join(h, 'eigen')));
    });
    mitEnv({ ...frei, CYPHERDJ_INSTANZ: 'e', CYPHERDJ_BK_ORDNER: path.join(h, 'eigen2') }, () => {
      const n = schreibeSample(new Float32Array(4));
      assert.ok(fs.existsSync(path.join(h, 'eigen2', 'samples', n)));
      assert.ok(!fs.existsSync(echt));
    });
    mitEnv({ ...frei, CYPHERDJ_INSTANZ: undefined }, () => {
      const n = schreibeSample(new Float32Array(4));                              // live studio: as before
      assert.ok(fs.existsSync(path.join(echt, 'samples', n)));
    });
  } finally { fs.rmSync(h, { recursive: true, force: true }); }
});
