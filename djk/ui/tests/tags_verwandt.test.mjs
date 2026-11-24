// Related items: made_from / used_in / similar_to lists, and passt_zu computed on read from effective tonart and tempo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { Router } from '../http/router.ts';
import { json } from '../http/transport.ts';
import { TagSpeicher } from '../tags/store.ts';
import { tagsBereich } from '../tags/area.ts';
import { oeffneStore, schreibeItems, schreibeBezug, dat } from './support/tags_store.mjs';
import { ruf } from './support/proj_stack.mjs';

function stapel(t, items, bezuege = []) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tags-v-'));
  const pfad = path.join(d, 'tags.sqlite');
  const db = oeffneStore(pfad);
  schreibeItems(db, items);
  for (const b of bezuege) schreibeBezug(db, ...b);
  db.close();
  const s = new TagSpeicher({ pfad });
  t.after(() => { s.schliesse(); fs.rmSync(d, { recursive: true, force: true }); });
  return { s, pfad, d };
}
const LEER = { gemacht_aus: [], steckt_in: [], passt_zu: [], aehnlich: [], daraus: [], enthaelt: [] };

test('made_from, used_in and similar_to come back in their lists; the other end sees daraus and enthaelt', (t) => {
  const { s } = stapel(t, [
    { id: 'loop:l1' }, { id: dat(1), art: 'track' }, { id: 'projekt:p1', art: 'projekt' }, { id: 'projekt:p2', art: 'projekt' },
    { id: dat(2) }, { id: dat(3) }, { id: dat(4) },
  ], [
    ['loop:l1', 'made_from', dat(1)], ['loop:l1', 'used_in', 'projekt:p2'], ['loop:l1', 'used_in', 'projekt:p1'],
    ['loop:l1', 'similar_to', dat(3), 'messen', 0.5], ['loop:l1', 'similar_to', dat(4), 'messen', 0.1], ['loop:l1', 'similar_to', dat(2), 'messen', 0.3],
  ]);
  const v = s.verwandt('loop:l1');
  assert.deepEqual(v.gemacht_aus, [dat(1)]);
  assert.deepEqual(v.steckt_in, ['projekt:p1', 'projekt:p2']);
  assert.deepEqual(v.aehnlich, [dat(4), dat(2), dat(3)], 'distance order');
  assert.deepEqual(s.verwandt(dat(1)).daraus, ['loop:l1']);
  // a project lists its clips in enthaelt (used_in INTO the project)
  assert.deepEqual(s.verwandt('projekt:p1').enthaelt, ['loop:l1']);
});

test('passt_zu: neighbouring keys and tempo within 6 percent, effective tags, never the item itself', (t) => {
  const { s } = stapel(t, [
    { id: dat(1), tags: ['tonart:8A', 'tempo:128'] },
    { id: dat(2), tags: ['tonart:8A', 'tempo:128'] },     // same key, same tempo
    { id: dat(3), tags: ['tonart:7A', 'tempo:124'] },
    { id: dat(4), tags: ['tonart:9A', 'tempo:132'] },
    { id: dat(5), tags: ['tonart:8B', 'tempo:121'] },     // 7 below: inside 6 percent (7.68)
    { id: dat(6), tags: ['tonart:3A', 'tempo:128'] },     // key too far
    { id: dat(7), tags: ['tonart:8A', 'tempo:140'] },     // tempo too far
    { id: dat(8), tags: ['tonart:8A', 'tempo:136'] },     // 8 above: just outside
    { id: dat(9), tags: ['tonart:3A', 'tempo:128', ['tonart:9A', 'nutzer', 1]] },   // a manual key wins over the measured one
    { id: dat(10), tags: ['tonart:8A', 'tempo:128', ['tempo:150', 'nutzer', 1]] },  // a manual tempo wins
    { id: dat(11), tags: ['tonart:8A', 'tempo:128'], art: 'oneshot' },              // other art
    { id: dat(12), tags: ['tonart:8A', 'tempo:128'], weg: 1 },                      // gone
    { id: dat(13), tags: ['tonart:8A'] },                                           // no tempo
  ]);
  const ids = s.verwandt(dat(1)).passt_zu;
  assert.deepEqual(ids, [dat(2), dat(9), dat(3), dat(4), dat(5)], 'nearest tempo first, then id');
  assert.ok(!ids.includes(dat(1)));
  assert.deepEqual(s.verwandt(dat(1), { passt_max: 2 }).passt_zu, [dat(2), dat(9)]);
  assert.deepEqual(s.verwandt(dat(13)).passt_zu, []);
  // the item's own effective tags count: dat(10) is at 150 now
  assert.ok(!s.verwandt(dat(1)).passt_zu.includes(dat(10)));
});

test('an unknown item gives six empty lists; a weg item is in no list', (t) => {
  const { s } = stapel(t, [{ id: 'loop:l1' }, { id: dat(1), weg: 1 }, { id: dat(2) }], [['loop:l1', 'made_from', dat(1)], ['loop:l1', 'made_from', dat(2)]]);
  assert.deepEqual(s.verwandt(dat(9)), LEER);
  assert.deepEqual(s.verwandt('loop:l1').gemacht_aus, [dat(2)]);
  assert.deepEqual(s.verwandt(dat(1)).daraus, ['loop:l1'], 'the weg item itself can still be asked');
});

test('a store that does not exist yet answers six empty lists', () => {
  const s = new TagSpeicher({ pfad: path.join(os.tmpdir(), 'tags-v-nie-' + process.pid, 'tags.sqlite') });
  assert.deepEqual(s.verwandt(dat(1)), LEER);
});

test('every lookup of verwandt uses an index (no full scan of item_tag or relation)', (t) => {
  const { s, pfad } = stapel(t, [{ id: dat(1), tags: ['tonart:8A', 'tempo:128'] }]);
  const sqls = [];
  const orig = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function (sql) { sqls.push(sql); return orig.call(this, sql); };
  try { s.verwandt(dat(1)); } finally { DatabaseSync.prototype.prepare = orig; }
  const d = new DatabaseSync(pfad);
  try {
    assert.ok(sqls.length >= 6);
    for (const sql of sqls.filter((x) => /relation|item_tag|wirksam/.test(x) && !/^\s*(PRAGMA|BEGIN)/i.test(x))) {
      const n = (sql.match(/\?/g) ?? []).length;
      const plan = d.prepare('EXPLAIN QUERY PLAN ' + sql).all(...Array(n).fill('x')).map((r) => r.detail);
      assert.deepEqual(plan.filter((z) => /^SCAN (item_tag|relation)\b/.test(z)), [], sql.slice(0, 80) + ' -> ' + plan.join(' | '));
    }
  } finally { d.close(); }
});

async function route(t, items, bezuege) {
  const st = stapel(t, items, bezuege);
  st.s.schliesse();
  const router = new Router();
  const b = tagsBereich({ log: () => {}, quelle: () => 'andreas' }, { katalog: path.join(st.d, 'katalog.sqlite') });
  router.melde(b);
  const server = http.createServer(async (q, a) => { const u = new URL(q.url, 'http://x'); const r = router.finde(q.method, u.pathname); return r ? r.handler(q, a, u) : json(a, 404, {}); });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  t.after(() => { server.close(); b.speicher.schliesse(); });
  return { url: `http://127.0.0.1:${server.address().port}`, b };
}

test('GET /tags/verwandt: exact keys, 400 item_ungueltig, relations reported at runtime appear without a restart', async (t) => {
  const { url, b } = await route(t, [{ id: dat(1) }]);
  const r = await ruf(url, 'GET', `/tags/verwandt?item=${dat(1)}`);
  assert.equal(r.code, 200);
  assert.deepEqual(Object.keys(r.j).sort(), Object.keys(LEER).sort());
  assert.deepEqual((await ruf(url, 'GET', '/tags/verwandt?item=nope')).j.grund, 'item_ungueltig');
  assert.equal((await ruf(url, 'GET', '/tags/verwandt')).code, 400);
  b.speicher.meldeBezug('made_from', 'loop:neu', dat(1));
  assert.deepEqual((await ruf(url, 'GET', '/tags/verwandt?item=loop:neu')).j.gemacht_aus, [dat(1)]);
  assert.equal((await ruf(url, 'GET', `/tags/verwandt?item=${dat(7)}`)).code, 200);
  assert.equal((await ruf(url, 'POST', '/tags/verwandt', {})).code, 405);
});
