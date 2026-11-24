// Tag search: AND over effective tags, text over names and tag words, art filter, clamps, speed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Router } from '../http/router.ts';
import { json } from '../http/transport.ts';
import { TagSpeicher } from '../tags/store.ts';
import { TagFehler } from '../tags/model.ts';
import { tagsBereich } from '../tags/area.ts';
import { oeffneStore, schreibeItems, dat } from './support/tags_store.mjs';
import { ruf } from './support/proj_stack.mjs';

function stapel(t, items) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tags-s-'));
  const pfad = path.join(d, 'tags.sqlite');
  const db = oeffneStore(pfad);
  schreibeItems(db, items);
  db.close();
  const s = new TagSpeicher({ pfad });
  t.after(() => { s.schliesse(); fs.rmSync(d, { recursive: true, force: true }); });
  return { s, pfad };
}
const ids = (r) => r.map((x) => x.item);
const fehler = (f) => { try { f(); } catch (e) { assert.ok(e instanceof TagFehler, String(e)); return e; } assert.fail('no TagFehler'); };

test('tags are ANDed over effective tags; manual removal and manual tempo count', (t) => {
  const { s } = stapel(t, [
    { id: dat(1), name: 'a', tags: ['typ:kick', 'tempo:128'] },
    { id: dat(2), name: 'b', tags: ['typ:kick'] },
    { id: dat(3), name: 'c', tags: ['typ:kick', 'tempo:128', ['typ:kick', 'nutzer', 0]] },
    { id: dat(4), name: 'd', tags: ['typ:kick', 'tempo:128', ['tempo:140', 'nutzer', 1]] },
  ]);
  assert.deepEqual(ids(s.suche({ tags: ['typ:kick', 'tempo:128'] })), [dat(1)]);
  assert.deepEqual(ids(s.suche({ tags: ['tempo:140'] })), [dat(4)]);
  assert.deepEqual(ids(s.suche({ tags: ['typ:kick'] })), [dat(1), dat(2), dat(4)]);
  const t1 = s.suche({ tags: ['typ:kick', 'tempo:128'] })[0];
  assert.deepEqual([t1.name, t1.art, t1.tags], ['a', 'loop', ['tempo:128', 'typ:kick']]);
});

test('text matches names and tag words, every word somewhere; art narrows; unknown art is empty', (t) => {
  const { s } = stapel(t, [
    { id: dat(1), name: 'Dark Kick 01', art: 'oneshot' },
    { id: dat(2), name: 'Boom', art: 'loop', tags: ['charakter:dark', 'typ:kick'] },
    { id: dat(3), name: 'Dark Pad', art: 'loop', tags: ['typ:pad'] },
    { id: dat(4), name: 'Deep thing', art: 'loop', tags: ['genre:deep_house'] },
  ]);
  assert.deepEqual(ids(s.suche({ tags: [], text: 'dark kick' })), [dat(2), dat(1)]);
  assert.deepEqual(ids(s.suche({ tags: [], text: 'dark kick', art: 'loop' })), [dat(2)]);
  assert.deepEqual(ids(s.suche({ tags: [], text: 'DARK', art: 'loop' })), [dat(2), dat(3)]);
  assert.deepEqual(ids(s.suche({ tags: [], text: 'deep house' })), [dat(4)]);
  assert.deepEqual(s.suche({ tags: [], text: 'dark', art: 'nonsense' }), []);
  assert.deepEqual(ids(s.suche({ tags: ['typ:kick'], text: 'boom' })), [dat(2)]);
  assert.deepEqual(s.suche({ tags: [], text: '100%_x' }), [], 'LIKE wildcards are plain characters');
});

test('bad query: unknown tag word, too many tags; empty query gives the newest 100', (t) => {
  const items = Array.from({ length: 150 }, (_, i) => ({ id: dat(i + 1), name: `n${i}`, geaendert: i + 1 }));
  const { s } = stapel(t, items);
  assert.equal(fehler(() => s.suche({ tags: ['charakter:notaword'] })).grund, 'tag_ungueltig');
  assert.equal(fehler(() => s.suche({ tags: Array.from({ length: 21 }, (_, i) => `frei:t${i}`) })).grund, 'zu_viele_tags');
  const r = s.suche({ tags: [] });
  assert.equal(r.length, 100);
  assert.equal(r[0].item, dat(150));
  assert.equal(r[99].item, dat(51));
});

test('limit is clamped to 500; weg items never appear', (t) => {
  const items = Array.from({ length: 600 }, (_, i) => ({ id: dat(i + 1), name: `n${String(i).padStart(3, '0')}`, tags: ['typ:kick'], weg: i === 0 }));
  const { s } = stapel(t, items);
  assert.equal(s.suche({ tags: ['typ:kick'], limit: 1000 }).length, 500);
  assert.equal(s.suche({ tags: ['typ:kick'], limit: 3 }).length, 3);
  assert.ok(!ids(s.suche({ tags: ['typ:kick'], limit: 500 })).includes(dat(1)));
  assert.ok(!ids(s.suche({ tags: [], limit: 500 })).includes(dat(1)));
  assert.deepEqual(ids(s.suche({ tags: ['typ:kick'], limit: 2 })), [dat(2), dat(3)], 'name order, then id');
});

test('performance pin: 3,000 items with 6 tags, two-tag search', (t) => {
  const alle = ['typ:kick', 'typ:snare', 'typ:bass', 'charakter:dark', 'charakter:warm', 'genre:techno', 'genre:house', 'einsatz:drop', 'tonart:8A', 'tonart:9A'];
  const items = Array.from({ length: 3000 }, (_, i) => ({ id: dat(i + 1), name: `Item ${i}`, tags: [alle[i % 10], alle[(i + 3) % 10], alle[(i + 5) % 10], `tempo:${100 + (i % 60)}`, `energie:${1 + (i % 5)}`, alle[(i + 7) % 10]] }));
  const { s } = stapel(t, items);
  s.suche({ tags: ['typ:kick'] });
  const t0 = performance.now();
  const r = s.suche({ tags: ['typ:kick', 'charakter:dark'] });
  const ms = performance.now() - t0;
  console.log(`# two-tag search over 3000 items: ${ms.toFixed(1)} ms, ${r.length} hits`);
  assert.ok(r.length > 0);
  assert.ok(ms < 1000, `${ms} ms`);
  const t1 = performance.now();
  s.suche({ tags: [], text: 'item 17' });
  console.log(`# text-only search: ${(performance.now() - t1).toFixed(1)} ms`);
});

test('GET /tags/suche over HTTP', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tags-sr-'));
  const db = oeffneStore(path.join(d, 'tags.sqlite'));
  schreibeItems(db, [{ id: dat(1), name: 'Kick A', tags: ['typ:kick', 'tempo:128'] }, { id: dat(2), name: 'Snare', tags: ['typ:snare'] }]);
  db.close();
  const router = new Router();
  const b = tagsBereich({ log: () => {}, quelle: () => 'andreas' }, { katalog: path.join(d, 'katalog.sqlite') });
  router.melde(b);
  const server = http.createServer((q, a) => { const u = new URL(q.url, 'http://x'); const r = router.finde(q.method, u.pathname); return r ? r.handler(q, a, u) : json(a, 404, {}); });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  t.after(() => { server.close(); b.speicher.schliesse(); fs.rmSync(d, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const r = await ruf(url, 'GET', '/tags/suche?tags=typ:kick,tempo:128&text=kick&art=loop');
  assert.deepEqual([r.code, r.j.treffer.map((x) => x.item)], [200, [dat(1)]]);
  assert.deepEqual(Object.keys(r.j.treffer[0]).sort(), ['art', 'item', 'name', 'tags']);
  assert.equal((await ruf(url, 'GET', '/tags/suche?tags=typ:nope')).j.grund, 'tag_ungueltig');
  assert.equal((await ruf(url, 'GET', '/tags/suche?tags=' + Array.from({ length: 21 }, (_, i) => `frei:t${i}`).join(','))).j.grund, 'zu_viele_tags');
  assert.equal((await ruf(url, 'GET', '/tags/suche')).j.treffer.length, 2);
});
