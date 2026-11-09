// Package 1.16 rest U4: routes under /kollektionen (spec 4.4) on the real Router, like tests/presets_bereich.test.mjs. One test runs the
// prefix check against deliberately broken prefix rules and requires it to fail there.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { Router } from '../http/router.ts';
import { json, postAbgewiesen } from '../http/transport.ts';
import { kollektionenBereich, istKollektionPfad } from '../collections/area.ts';
import { ruf } from './support/proj_stack.mjs';

const S1 = { art: 'sample', sha: 'a'.repeat(64) }, P1 = { art: 'preset', id: 'werk:komp/drum-bus' }, G1 = { art: 'geraet', geraet: 'rb338' };
async function stapel(t, quelle = 'andreas', ordner) {
  const d = ordner ?? fs.mkdtempSync(path.join(os.tmpdir(), 'koll-h-'));
  if (!ordner) t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const router = new Router();
  const log = [];
  router.melde(kollektionenBereich({ log: (z) => log.push(z), quelle: () => quelle }, { ordner: d }));
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
  return { url: `http://127.0.0.1:${port}`, router, ordner: d, log };
}

function pruefePrefix(regel) {
  for (const p of ['/kollektionen', '/kollektionen/', '/kollektionen/a', '/kollektionen/a/posten']) assert.equal(regel(p), true, p);
  for (const p of ['/kollektionenx', '/sammlungen', '/sammlungen/x', '/kollektion', '/proj/kollektionen', '/']) assert.equal(regel(p), false, p);
}
test('routes: one Bereich kollektionen under its own prefix, POST protected; never /sammlungen or /kollektionenx', async (t) => {
  const s = await stapel(t);
  assert.deepEqual(s.router.liste(), [{ bereich: 'kollektionen', methode: '*', pfad: '(muster)', schutz: 'fremdePost' }]);
  pruefePrefix(istKollektionPfad);
  assert.equal(s.router.finde('GET', '/sammlungen'), null);
});
test('the prefix test fails on broken prefix rules (deliberately broken implementation)', () => {
  assert.throws(() => pruefePrefix((p) => p.startsWith('/kollektionen')), assert.AssertionError);
  assert.throws(() => pruefePrefix((p) => p === '/kollektionen' || p.startsWith('/kollektionen/') || p.startsWith('/sammlungen')), assert.AssertionError);
});

test('create, add mixed items, read, remove, rename, delete over HTTP (AK-B16-7)', async (t) => {
  const s = await stapel(t);
  const neu = await ruf(s.url, 'POST', '/kollektionen', { name: 'Dark Stuff' });
  assert.deepEqual([neu.code, neu.j], [201, { slug: 'dark-stuff' }]);
  const h = await ruf(s.url, 'POST', '/kollektionen/dark-stuff/posten', { hinzu: [S1, P1, G1] });
  assert.deepEqual([h.code, h.j.anzahl, typeof h.j.geaendert], [200, 3, 'string']);
  const k = (await ruf(s.url, 'GET', '/kollektionen/dark-stuff')).j;
  assert.deepEqual([k.slug, k.name, k.posten], ['dark-stuff', 'Dark Stuff', [S1, P1, G1]]);
  const w = await ruf(s.url, 'POST', '/kollektionen/dark-stuff/posten', { weg: [P1], erwartet: h.j.geaendert });
  assert.equal(w.j.anzahl, 2);
  assert.equal((await ruf(s.url, 'POST', '/kollektionen/dark-stuff/posten', { weg: [S1], erwartet: h.j.geaendert })).j.fehler, 'veraltet');
  assert.deepEqual((await ruf(s.url, 'POST', '/kollektionen/dark-stuff/umbenennen', { name: 'Darker' })).j, { slug: 'darker' });
  assert.deepEqual((await ruf(s.url, 'GET', '/kollektionen')).j.map((x) => [x.slug, x.anzahl]), [['darker', 2]]);
  assert.deepEqual((await ruf(s.url, 'POST', '/kollektionen/darker/loeschen', {})).j, { ok: true });
  assert.deepEqual((await ruf(s.url, 'GET', '/kollektionen')).j, []);
  // refusals
  const p = await ruf(s.url, 'POST', '/kollektionen', { name: 'X' });
  const b = await ruf(s.url, 'POST', '/kollektionen/x/posten', { hinzu: [{ art: 'sample', sha: 'nope' }] });
  assert.deepEqual([b.code, b.j.fehler, b.j.posten], [400, 'posten_ungueltig', { art: 'sample', sha: 'nope' }]);
  assert.equal(p.code, 201);
  assert.equal((await ruf(s.url, 'GET', '/kollektionen/gibts')).code, 404);
  assert.equal((await ruf(s.url, 'POST', '/kollektionen', { name: 'x' })).j.fehler, 'name_vergeben');
  assert.equal((await ruf(s.url, 'POST', '/kollektionen/x/posten', '[1]')).j.fehler, 'koerper_ungueltig');
  assert.equal((await ruf(s.url, 'POST', '/kollektionen/x/posten', {}, { origin: 'http://evil.example' })).code, 403);
  assert.equal((await ruf(s.url, 'GET', '/kollektionen/x/posten')).code, 405);
});

test('Cypher removing an item from Andreas\' collection gets 403, file unchanged; adding is allowed (AK-B16-7)', async (t) => {
  const an = await stapel(t);
  const cy = await stapel(t, 'cypher', an.ordner);
  await ruf(an.url, 'POST', '/kollektionen', { name: 'His' });
  await ruf(an.url, 'POST', '/kollektionen/his/posten', { hinzu: [S1] });
  const f = path.join(an.ordner, 'his.json');
  const vorher = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const r = await ruf(cy.url, 'POST', '/kollektionen/his/posten', { weg: [S1] });
  assert.deepEqual([r.code, r.j.fehler], [403, 'nur_andreas_kollektion']);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'), vorher);
  assert.equal((await ruf(cy.url, 'POST', '/kollektionen/his/posten', { hinzu: [P1] })).j.anzahl, 2);
  assert.equal((await ruf(cy.url, 'POST', '/kollektionen', { name: 'Hers' })).code, 201);
  assert.equal((await ruf(an.url, 'GET', '/kollektionen/hers')).j.autor, 'cypher');
  assert.ok(cy.log.some((z) => z.typ === 'kollektion_geaendert' && z.quelle === 'cypher'));
});

test('real server: /kollektionen is mounted, x-djk-quelle cypher marks the new collection; /sammlungen still answers the DJ sets', async (t) => {
  const { stapel: echterStapel } = await import('./support/media_library.mjs');
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'koll-echt-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const { url } = await echterStapel(t, { kollektionen: { ordner } });
  assert.equal((await ruf(url, 'POST', '/kollektionen', { name: 'Live' }, { 'x-djk-quelle': 'cypher' })).code, 201);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ordner, 'live.json'), 'utf8')).autor, 'cypher');
  assert.deepEqual((await ruf(url, 'GET', '/kollektionen')).j.map((k) => k.slug), ['live']);
  const sets = await ruf(url, 'GET', '/sammlungen');
  assert.equal(sets.code, 200);
  assert.ok(!JSON.stringify(sets.j).includes('live'), 'the DJ sets are not the collections');
});
