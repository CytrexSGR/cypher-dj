// Storage layout A4: the routes /quellen on the real Router with the real Python command line (python3 -m quellen), a tmp CYPHERDJ_HEIM and a tmp
// sampler folder. No studio, no test instance; invented paths only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Router } from '../http/router.ts';
import { json, postAbgewiesen } from '../http/transport.ts';
import { Erreichbarkeit } from '../erreichbar.ts';
import { Quellen } from '../sources.ts';
import { quellenBereich } from '../areas/quellen/area.ts';
import { tabletVerboten } from '../http/coupling.ts';
import { ruf } from './support/proj_stack.mjs';

const DJK = path.resolve(import.meta.dirname, '..', '..');
async function stapel(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'quellen-b-'));
  const heim = path.join(d, 'heim'), sampler = path.join(d, 'sampler');
  fs.mkdirSync(heim);
  const alt = process.env.CYPHERDJ_HEIM;
  process.env.CYPHERDJ_HEIM = heim;
  t.after(() => { if (alt === undefined) delete process.env.CYPHERDJ_HEIM; else process.env.CYPHERDJ_HEIM = alt; fs.rmSync(d, { recursive: true, force: true }); });
  const e = new Erreichbarkeit({ ttlMs: 0 });
  const quellen = new Quellen({ python: 'python3', cwd: DJK, erreichbar: e, env: { CYPHERDJ_SAMPLER: sampler } });
  const router = new Router();
  const log = [];
  router.melde(quellenBereich({ log: (z) => log.push(z) }, quellen));
  let port = 0;
  const server = http.createServer(async (q, a) => {
    const url = new URL(q.url ?? '/', 'http://127.0.0.1');
    const r = router.finde(q.method ?? '', url.pathname);
    if (!r) return json(a, 404, { fehler: 'keine_route' });
    if (r.schutz === 'fremdePost' && q.method === 'POST' && postAbgewiesen(q, a, port)) return;
    await r.handler(q, a, url);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${port}`, d, heim, sampler, quellen, log };
}

test('GET /quellen lists roots with erreichbar', async (t) => {
  const s = await stapel(t);
  const voll = path.join(s.d, 'voll'), leer = path.join(s.d, 'leer');
  fs.mkdirSync(voll); fs.mkdirSync(leer); fs.writeFileSync(path.join(voll, 'a.wav'), 'x');
  assert.equal((await ruf(s.url, 'POST', '/quellen/dazu', { name: 'voll', pfad: voll, art: 'sample' })).code, 200);
  assert.equal((await ruf(s.url, 'POST', '/quellen/dazu', { name: 'leer', pfad: leer, art: 'loop' })).code, 200);
  const r = await ruf(s.url, 'GET', '/quellen');
  assert.equal(r.code, 200);
  assert.equal(r.j.datei, path.join(s.heim, 'quellen.toml'));
  const je = Object.fromEntries(r.j.wurzeln.map((w) => [w.name, w]));
  assert.deepEqual([je.voll.erreichbar, je.voll.pfad, je.voll.art, je.voll.grund], [true, voll, 'sample', undefined]);
  assert.deepEqual([je.leer.erreichbar, je.leer.grund], [false, 'ordner']);
});

test('a root without a path for this machine is not reachable', async (t) => {
  const s = await stapel(t);
  fs.writeFileSync(path.join(s.heim, 'quellen.toml'), [
    'schema = 1', '', '[[wurzel]]', 'name = "Fern"', 'art = "sample"', '[wurzel.pfade]', 'laptop-a = "/media/tester/Musik"', ''].join('\n'));
  const r = await ruf(s.url, 'GET', '/quellen');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j.wurzeln.map((w) => [w.name, w.pfad, w.erreichbar, w.grund]), [['Fern', null, false, 'kein_pfad_fuer_rechner']]);
  assert.equal(s.quellen.wechselplatte('/media/tester/Musik/x.wav'), null, 'no path on this machine: no root holds it');
});

test('POST /quellen/dazu adds a root and regenerates the shelf list', async (t) => {
  const s = await stapel(t);
  const p = path.join(s.d, 'Meine Samples');   // a space in the path stays intact
  fs.mkdirSync(p);
  const r = await ruf(s.url, 'POST', '/quellen/dazu', { name: 'Meine', pfad: p, art: 'sample', regal: true });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j.wurzeln.map((w) => [w.name, w.regal]), [['Meine', true]]);
  const regal = JSON.parse(fs.readFileSync(path.join(s.sampler, 'wurzeln.json'), 'utf8'));
  assert.ok(regal.some((w) => w.name === 'Meine' && w.pfad === p), JSON.stringify(regal));
  const doppelt = await ruf(s.url, 'POST', '/quellen/dazu', { name: 'Meine', pfad: p, art: 'sample' });
  assert.deepEqual([doppelt.code, doppelt.j.fehler], [409, 'name_vergeben']);
  const w = await ruf(s.url, 'POST', '/quellen/weg', { name: 'Meine' });
  assert.deepEqual([w.code, w.j.wurzeln], [200, []]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.sampler, 'wurzeln.json'), 'utf8')), []);
});

test('wechselplatte answers by the longest root prefix', async (t) => {
  const s = await stapel(t);
  await ruf(s.url, 'POST', '/quellen/dazu', { name: 'a', pfad: '/media/tester/Musik', art: 'sample' });
  await ruf(s.url, 'POST', '/quellen/dazu', { name: 'b', pfad: '/media/tester/Musik/fest', art: 'sample', wechselplatte: false });
  assert.equal(s.quellen.wechselplatte('/media/tester/Musik/x/y.wav'), true);
  assert.equal(s.quellen.wechselplatte('/media/tester/Musik/fest/y.wav'), false);
  assert.equal(s.quellen.wechselplatte('/media/tester/Anderes/y.wav'), null);
});

test('a relative path is 400 argument_ungueltig', async (t) => {
  const s = await stapel(t);
  const r = await ruf(s.url, 'POST', '/quellen/dazu', { name: 'x', pfad: 'musik/rel', art: 'sample' });
  assert.deepEqual([r.code, r.j.fehler], [400, 'argument_ungueltig']);
  assert.match(r.j.text, /absolute/);
  for (const k of [{ name: 'x', pfad: '/media/tester/Musik', art: 'kaffee' }, { name: '', pfad: '/media/tester/Musik', art: 'sample' }, { name: 'x/y', pfad: '/media/tester/Musik', art: 'sample' }]) {
    assert.equal((await ruf(s.url, 'POST', '/quellen/dazu', k)).code, 400, JSON.stringify(k));
  }
});

test('POST /quellen/weg of an unknown name is 404', async (t) => {
  const s = await stapel(t);
  const r = await ruf(s.url, 'POST', '/quellen/weg', { name: 'gibt-es-nicht' });
  assert.deepEqual([r.code, r.j.fehler], [404, 'unbekannt']);
});

test('a broken source list file is 409 quellen_kaputt', async (t) => {
  const s = await stapel(t);
  fs.writeFileSync(path.join(s.heim, 'quellen.toml'), 'das ist [ kein toml');
  const r = await ruf(s.url, 'GET', '/quellen');
  assert.deepEqual([r.code, r.j.fehler], [409, 'quellen_kaputt']);
});

test('the POSTs refuse a foreign origin and plain text', async (t) => {
  const s = await stapel(t);
  const f = await fetch(`${s.url}/quellen/weg`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://boese.example' }, body: '{"name":"x"}' });
  assert.equal(f.status, 403);
  const p = await fetch(`${s.url}/quellen/weg`, { method: 'POST', body: '{"name":"x"}' });
  assert.equal(p.status, 415);
});

test('the tablet port refuses GET /quellen and its POSTs', () => {
  assert.equal(tabletVerboten('GET', '/quellen'), true);
  assert.equal(tabletVerboten('POST', '/quellen/dazu'), true);
  assert.equal(tabletVerboten('POST', '/quellen/weg'), true);
});
