// /tags routes on the real Router, like tests/collections_area.test.mjs, each with its own temp store.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Router } from '../http/router.ts';
import { json, postAbgewiesen } from '../http/transport.ts';
import { tagsBereich } from '../tags/area.ts';
import { GRUND_TEXT } from '../http/reasons.ts';
import { ruf } from './support/proj_stack.mjs';

const ITEM = `datei:${'a'.repeat(64)}`;
async function stapel(t, quelle = 'andreas') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tags-r-'));
  const router = new Router();
  const b = tagsBereich({ log: () => {}, quelle: () => quelle }, { katalog: path.join(d, 'katalog.sqlite') });
  router.melde(b);
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
  t.after(() => { server.close(); b.speicher.schliesse(); fs.rmSync(d, { recursive: true, force: true }); });
  return { url: `http://127.0.0.1:${port}`, dir: d };
}

test('GET /tags/vokabular: eight arts, 22 character words with nine measured, 24 keys', async (t) => {
  const s = await stapel(t);
  const r = await ruf(s.url, 'GET', '/tags/vokabular');
  assert.equal(r.code, 200);
  assert.deepEqual(r.j.arten.map((a) => a.art), ['typ', 'charakter', 'genre', 'einsatz', 'energie', 'tonart', 'tempo', 'frei']);
  const ch = r.j.arten.find((a) => a.art === 'charakter');
  assert.equal(ch.woerter.length, 22);
  assert.equal(ch.woerter.filter((w) => w.gemessen).length, 9);
  assert.equal(r.j.arten.find((a) => a.art === 'tonart').woerter.length, 24);
  assert.equal(r.j.arten.find((a) => a.art === 'tempo').einwertig, true);
  assert.equal(r.j.arten.find((a) => a.art === 'frei').frei, true);
});

test('GET /tags: empty without a store, 400 item_ungueltig with ok, grund, fehler and text', async (t) => {
  const s = await stapel(t);
  assert.deepEqual((await ruf(s.url, 'GET', `/tags?item=${ITEM}`)).j, { item: ITEM, tags: [] });
  assert.deepEqual(fs.readdirSync(s.dir), []);
  const r = await ruf(s.url, 'GET', '/tags?item=datei:xyz');
  assert.equal(r.code, 400);
  assert.deepEqual([r.j.ok, r.j.grund, r.j.fehler], [false, 'item_ungueltig', 'item_ungueltig']);
  assert.equal(r.j.text, GRUND_TEXT.item_ungueltig);
  assert.equal((await ruf(s.url, 'GET', '/tags')).code, 400);
});

test('POST /tags/setzen: foreign origin 403, valid body writes with origin nutzer, bad body refused', async (t) => {
  const s = await stapel(t);
  const fremd = await ruf(s.url, 'POST', '/tags/setzen', { items: [ITEM], tags: ['typ:kick'], an: true }, { origin: 'http://evil.example' });
  assert.deepEqual([fremd.code, fremd.j.fehler], [403, 'fremde_herkunft']);
  const ok = await ruf(s.url, 'POST', '/tags/setzen', { items: [ITEM], tags: ['typ:kick', 'frei:mine'], an: true });
  assert.deepEqual([ok.code, ok.j], [200, { ok: true, geaendert: 2 }]);
  const g = await ruf(s.url, 'GET', `/tags?item=${ITEM}`);
  assert.deepEqual(g.j.tags, [{ tag: 'frei:mine', herkunft: 'nutzer' }, { tag: 'typ:kick', herkunft: 'nutzer' }]);
  const schlecht = await ruf(s.url, 'POST', '/tags/setzen', { items: [ITEM], tags: ['Kick'], an: true });
  assert.deepEqual([schlecht.code, schlecht.j.grund, schlecht.j.betroffen], [400, 'tag_ungueltig', 'Kick']);
  assert.equal((await ruf(s.url, 'POST', '/tags/setzen', { items: [ITEM], tags: ['typ:kick'] })).j.grund, 'an_ungueltig');
  assert.equal((await ruf(s.url, 'GET', '/tags/unbekannt')).code, 404);
  const gross = await ruf(s.url, 'POST', '/tags/setzen', { items: Array.from({ length: 500 }, (_, i) => `datei:${String(i).padStart(3, '0').repeat(21)}0`), tags: ['frei:bulk'], an: true });
  assert.deepEqual([gross.code, gross.j.geaendert], [200, 500]);
});

test('with the agent as source the origin is agent', async (t) => {
  const s = await stapel(t, 'cypher');
  await ruf(s.url, 'POST', '/tags/setzen', { items: [ITEM], tags: ['genre:techno'], an: true });
  assert.deepEqual((await ruf(s.url, 'GET', `/tags?item=${ITEM}`)).j.tags, [{ tag: 'genre:techno', herkunft: 'agent' }]);
});

test('the body limit is 1 MiB in bytes, not in characters', async (t) => {
  const s = await stapel(t);
  const mehrbyte = JSON.stringify({ items: [ITEM], tags: ['frei:x'], an: true, fuell: 'ä'.repeat(600000) });   // 600k characters, 1.2 MB
  assert.ok(mehrbyte.length < 1 << 20 && Buffer.byteLength(mehrbyte) > 1 << 20);
  const r = await ruf(s.url, 'POST', '/tags/setzen', JSON.parse(mehrbyte));
  assert.deepEqual([r.code, r.j.grund], [400, 'koerper_zu_gross']);
  const klein = await ruf(s.url, 'POST', '/tags/setzen', { items: [ITEM], tags: ['frei:x'], an: true, fuell: 'ä'.repeat(100000) });
  assert.equal(klein.code, 200);
});
