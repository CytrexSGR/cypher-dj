// Browser plan 1, task 5 (and 6): the /bibliothek routes over a real http server, a fake builder and temp folders.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { Router } from '../http/router.ts';
import { json, postAbgewiesen, quelleAusKopf } from '../http/transport.ts';
import { KatalogJob } from '../catalog_job.ts';
import { bibliothekBereich } from '../areas/bibliothek/area.ts';

const warte = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function stapel(t, plan = { rc: 0 }) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bibber-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const python = path.join(d, 'python');
  fs.writeFileSync(python, `#!/bin/sh\ncat "${d}/zeige.json"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(d, 'zeige.json'), JSON.stringify({ ziel: path.join(d, 'katalog.sqlite'), zustand: 'absent', zaehlung: null, wurzeln: [] }));
  const befehl = () => spawn(process.execPath, ['-e', `const p=${JSON.stringify(plan)};for(const z of p.stderr??[])process.stderr.write(z+'\\n');setTimeout(()=>process.exit(0),p.warteMs??0);`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const job = new KatalogJob({ python, cwd: d, befehl, entprellMs: 50 });
  t.after(() => job.schliesse());
  const router = new Router();
  let quelle = 'andreas', port = 0;
  router.melde(bibliothekBereich({ log: () => {} }, job));
  const server = http.createServer(async (q, a) => {
    quelle = quelleAusKopf(q);
    const url = new URL(q.url ?? '/', 'http://127.0.0.1');
    const r = router.finde(q.method ?? '', url.pathname);
    if (!r) return json(a, 404, { fehler: 'keine_route' });
    if (r.schutz === 'fremdePost' && q.method === 'POST' && postAbgewiesen(q, a, port)) return;
    await r.handler(q, a, url);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
  t.after(() => server.close());
  const ruf = async (methode, pfad, kopf = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${pfad}`, methode === 'GET' ? { headers: kopf } : { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: '{}' });
    const text = await r.text();
    return { code: r.status, j: text ? JSON.parse(text) : null };
  };
  return { d, job, ruf, port };
}

test('POST /bibliothek/bauen as source cypher is allowed (page and hand)', async (t) => {
  const s = await stapel(t);
  const r = await s.ruf('POST', '/bibliothek/bauen', { 'x-djk-quelle': 'cypher' });
  assert.deepEqual([r.code, r.j], [200, { ok: true, laeuft: true }]);
  await s.job.ruht();
});

test('POST /bibliothek/bauen with a foreign Origin is 403', async (t) => {
  const s = await stapel(t);
  const r = await s.ruf('POST', '/bibliothek/bauen', { origin: 'http://evil.example' });
  assert.equal(r.code, 403);
});

test('POST /bibliothek/bauen while a build runs joins it', async (t) => {
  const s = await stapel(t, { rc: 0, warteMs: 300 });
  const a = await s.ruf('POST', '/bibliothek/bauen');
  const b = await s.ruf('POST', '/bibliothek/bauen');
  assert.deepEqual([a.j.laeuft, b.j.laeuft], [true, true]);
  await s.job.ruht();
});

test('GET /bibliothek/midi filters by name from the sidecar and is empty without one', async (t) => {
  const s = await stapel(t);
  assert.deepEqual((await s.ruf('GET', '/bibliothek/midi?text=beat')).j, { dateien: [] });
  fs.writeFileSync(path.join(s.d, 'katalog.sqlite.midi.json'), JSON.stringify({ schema: 1, dateien: [
    { pfad: '/m/Beat 1.mid', name: 'Beat 1.mid', groesse: 4 }, { pfad: '/m/Bass.mid', name: 'Bass.mid', groesse: 4 }, { pfad: '/m/beat2.midi', name: 'beat2.midi', groesse: 4 }] }));
  const r = await s.ruf('GET', '/bibliothek/midi?text=beat');
  assert.deepEqual(r.j.dateien.map((x) => x.name), ['Beat 1.mid', 'beat2.midi']);
  assert.equal((await s.ruf('GET', '/bibliothek/midi?max=1')).j.dateien.length, 1);
  assert.equal((await s.ruf('GET', '/bibliothek/midi')).j.dateien.length, 3);
});

test('GET /bibliothek/stand before any build, and during a run phase scan with a rising fertig', async (t) => {
  const s = await stapel(t, { stderr: ['{"phase":"scan","fertig":7,"gesamt":null}'], rc: 0, warteMs: 600 });
  const vor = await s.ruf('GET', '/bibliothek/stand');
  assert.equal(vor.code, 200);
  assert.deepEqual([vor.j.phase, vor.j.letzter_bau, vor.j.fremd], ['ruht', null, false]);
  await s.ruf('POST', '/bibliothek/bauen');
  await warte(300);
  const mitten = (await s.ruf('GET', '/bibliothek/stand')).j;
  assert.deepEqual([mitten.phase, mitten.fertig], ['scan', 7]);
  await s.job.ruht();
  assert.equal((await s.ruf('GET', '/bibliothek/stand')).j.letzter_bau.rc, 0);
});
