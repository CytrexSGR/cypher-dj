// Saved searches as smart collections: stored tags and text, count taken live, validation, protection of the POSTs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Router } from '../http/router.ts';
import { json, postAbgewiesen } from '../http/transport.ts';
import { tagsBereich } from '../tags/area.ts';
import { DatabaseSync } from 'node:sqlite';
import { oeffneStore, schreibeItems, dat } from './support/tags_store.mjs';
import { ruf } from './support/proj_stack.mjs';

async function stapel(t, items = []) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tags-g-'));
  const katalog = path.join(d, 'katalog.sqlite');
  const db = oeffneStore(path.join(d, 'tags.sqlite'));
  schreibeItems(db, items);
  db.close();
  const router = new Router();
  const b = tagsBereich({ log: () => {}, quelle: () => 'andreas' }, { katalog });
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
  return { url: `http://127.0.0.1:${port}`, d, b };
}
const KICKS = [1, 2, 3].map((n) => ({ id: dat(n), name: `k${n}`, tags: ['typ:kick', 'charakter:dark'] }));

test('save, list, count: the count is live, not a snapshot', async (t) => {
  const { url } = await stapel(t, [...KICKS, { id: dat(4), name: 'x', tags: ['typ:kick'] }]);
  assert.deepEqual((await ruf(url, 'GET', '/tags/gespeichert')).j, { suchen: [] });
  const w = await ruf(url, 'POST', '/tags/gespeichert', { name: 'dark kicks', tags: ['typ:kick', 'charakter:dark'], text: '' });
  assert.deepEqual(w.j, { ok: true });
  const live = (await ruf(url, 'GET', '/tags/suche?tags=typ:kick,charakter:dark')).j.treffer.length;
  const l = (await ruf(url, 'GET', '/tags/gespeichert')).j.suchen;
  assert.deepEqual(l, [{ name: 'dark kicks', tags: ['typ:kick', 'charakter:dark'], text: '', art: '', anzahl: live, frisch: true }]);
  assert.equal(live, 3);
  // tag one more item through the route: the count grows without saving again
  await ruf(url, 'POST', '/tags/setzen', { items: [dat(4)], tags: ['charakter:dark'], an: true });
  assert.equal((await ruf(url, 'GET', '/tags/gespeichert')).j.suchen[0].anzahl, 4);
  // a text-only search
  await ruf(url, 'POST', '/tags/gespeichert', { name: 'Named k', tags: [], text: 'k2', art: 'loop' });
  const l2 = (await ruf(url, 'GET', '/tags/gespeichert')).j.suchen;
  assert.deepEqual(l2.map((x) => [x.name, x.anzahl, x.art]), [['dark kicks', 4, ''], ['Named k', 1, 'loop']], 'alphabetical, case-insensitive');
});

test('the same name replaces; weg removes; unknown weg is 404 suche_unbekannt', async (t) => {
  const { url } = await stapel(t, KICKS);
  await ruf(url, 'POST', '/tags/gespeichert', { name: 'a', tags: ['typ:kick'], text: '' });
  await ruf(url, 'POST', '/tags/gespeichert', { name: ' a ', tags: ['typ:snare'], text: '' });
  let l = (await ruf(url, 'GET', '/tags/gespeichert')).j.suchen;
  assert.deepEqual(l.map((x) => [x.name, x.tags, x.anzahl]), [['a', ['typ:snare'], 0]], 'replaced, and the count follows the new content');
  assert.deepEqual((await ruf(url, 'POST', '/tags/gespeichert/weg', { name: 'a' })).j, { ok: true });
  assert.deepEqual((await ruf(url, 'GET', '/tags/gespeichert')).j.suchen, []);
  const r = await ruf(url, 'POST', '/tags/gespeichert/weg', { name: 'a' });
  assert.equal(r.code, 404);
  assert.equal(r.j.grund, 'suche_unbekannt');
});

test('invalid names and contents are refused with the contract reasons', async (t) => {
  const { url } = await stapel(t, KICKS);
  const p = (b) => ruf(url, 'POST', '/tags/gespeichert', b);
  for (const name of ['', '   ', 'x'.repeat(41), 'new\nline', 'tab\there', undefined, 5]) {
    const r = await p({ name, tags: ['typ:kick'], text: '' });
    assert.deepEqual([r.code, r.j.grund], [400, 'suche_name_ungueltig'], JSON.stringify(name));
  }
  assert.equal((await p({ name: 'x'.repeat(40), tags: ['typ:kick'], text: '' })).code, 200);
  const leer = await p({ name: 'n', tags: [], text: '  ' });
  assert.deepEqual([leer.code, leer.j.grund], [400, 'tag_ungueltig']);
  const schlecht = await p({ name: 'n', tags: ['typ:kick', 'typ:nope'], text: '' });
  assert.deepEqual([schlecht.code, schlecht.j.grund, schlecht.j.betroffen], [400, 'tag_ungueltig', 'typ:nope']);
  assert.equal((await p({ name: 'n', tags: ['Typ:Kick'], text: '' })).j.grund, 'tag_ungueltig');
  assert.equal((await p({ name: 'n', tags: ['typ:kick'], text: '', art: 'Loop!' })).j.grund, 'art_ungueltig');
  assert.equal((await ruf(url, 'POST', '/tags/gespeichert/weg', { name: '' })).j.grund, 'suche_name_ungueltig');
  assert.equal((await ruf(url, 'GET', '/tags/gespeichert')).j.suchen.length, 1, 'only the valid one was stored');
});

test('a stored search whose word left the vocabulary is listed with anzahl 0 and does not break the list', async (t) => {
  const { url, d } = await stapel(t, KICKS);
  await ruf(url, 'POST', '/tags/gespeichert', { name: 'ok', tags: ['typ:kick'], text: '' });
  const db = new DatabaseSync(path.join(d, 'tags.sqlite'));
  db.prepare("INSERT INTO gespeichert(name, tags, text, art, angelegt) VALUES ('old', 'typ:kick,genre:gone', '', '', 1)").run();
  db.close();
  const r = await ruf(url, 'GET', '/tags/gespeichert');
  assert.equal(r.code, 200);
  assert.deepEqual(r.j.suchen.map((x) => [x.name, x.anzahl]), [['ok', 3], ['old', 0]]);
});

test('both POSTs refuse a foreign origin; the GET works without the page token', async (t) => {
  const { url } = await stapel(t, KICKS);
  const fremd = { origin: 'http://evil.example' };
  for (const [pfad, b] of [['/tags/gespeichert', { name: 'a', tags: ['typ:kick'], text: '' }], ['/tags/gespeichert/weg', { name: 'a' }]]) {
    const r = await ruf(url, 'POST', pfad, b, fremd);
    assert.ok(r.code === 403 || r.code === 415, `${pfad} -> ${r.code}`);
  }
  assert.equal((await ruf(url, 'GET', '/tags/gespeichert', undefined, fremd)).code, 200);
  assert.equal((await ruf(url, 'GET', '/tags/gespeichert')).j.suchen.length, 0, 'nothing was stored by the refused calls');
  assert.equal((await ruf(url, 'POST', '/tags/gespeichert/weg', undefined)).code, 400);
});

test('a count from before the last change is listed as null and frisch false, never as the current number', async (t) => {
  const { b } = await stapel(t, [...KICKS]);
  const sp = b.speicher;
  sp.merke('a', ['typ:kick'], '');
  sp.merke('b', ['charakter:dark'], '');
  const echt = sp.zaehle.bind(sp);
  sp.zaehle = (x) => { const a = performance.now(); while (performance.now() - a < 40) { /* slow count: the budget of one call is spent after one search */ } return echt(x); };
  const l1 = sp.gespeichert();
  assert.deepEqual(l1.map((x) => [x.name, x.anzahl, x.frisch]), [['a', 3, true], ['b', null, false]], 'the second search was not counted in this call');
  const l2 = sp.gespeichert();
  assert.deepEqual(l2.map((x) => [x.name, x.anzahl, x.frisch]), [['a', 3, true], ['b', 3, true]]);
  sp.setze([dat(9)], ['typ:kick'], true, 'nutzer');   // the store changes: both counts are old now
  const l3 = sp.gespeichert();
  assert.deepEqual(l3.map((x) => [x.name, x.frisch]), [['a', true], ['b', false]]);
  assert.equal(l3[1].anzahl, null, 'the old 3 is not shown as current');
});
