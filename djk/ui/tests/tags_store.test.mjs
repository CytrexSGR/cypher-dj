// Tag store, page side: reads, user and agent writes, vocabulary check, damaged and locked files, store path.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { TagSpeicher, SCHEMA_DATEI, erbe } from '../tags/store.ts';
import { TagFehler } from '../tags/model.ts';
import { tagsBereich } from '../tags/area.ts';

const SHA = 'a'.repeat(64), ITEM = `datei:${SHA}`;
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tags-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

// A store as the Python side leaves it: the shared schema file applied to a fresh file, plus measured rows
export function legeStore(pfad, gemessen = []) {
  const d = new DatabaseSync(pfad);
  d.exec('PRAGMA journal_mode = WAL');
  d.exec(fs.readFileSync(SCHEMA_DATEI, 'utf8'));
  d.prepare("INSERT OR IGNORE INTO item(id, art) VALUES (?, 'loop')").run(ITEM);
  for (const t of gemessen) d.prepare("INSERT INTO item_tag(item, tag, herkunft, quelle, an, zeit) VALUES (?, ?, 'gemessen', 'messen', 1, 1)").run(ITEM, t);
  d.close();
}
const fehler = (f) => { try { f(); } catch (e) { assert.ok(e instanceof TagFehler, String(e)); return e; } assert.fail('no TagFehler'); };

test('tagsVon returns measured rows with their origin; an absent store reads empty and is created on the first write', (t) => {
  const p = path.join(tmp(t), 'tags.sqlite');
  const s = new TagSpeicher({ pfad: p });
  t.after(() => s.schliesse());
  assert.deepEqual(s.tagsVon(ITEM), []);
  assert.equal(fs.existsSync(p), false);
  assert.equal(s.setze([ITEM], ['frei:mine'], true, 'nutzer'), 1);
  assert.deepEqual(s.tagsVon(ITEM), [{ tag: 'frei:mine', herkunft: 'nutzer' }]);
  const q = path.join(tmp(t), 'tags.sqlite');
  legeStore(q, ['tempo:128', 'typ:kick']);
  const s2 = new TagSpeicher({ pfad: q });
  t.after(() => s2.schliesse());
  assert.deepEqual(s2.tagsVon(ITEM), [{ tag: 'tempo:128', herkunft: 'gemessen' }, { tag: 'typ:kick', herkunft: 'gemessen' }]);
  assert.deepEqual(s2.tagsVon('datei:' + 'b'.repeat(64)), []);
});

test('a user tempo hides the measured one; removal hides a measured tag and deletes the own row', (t) => {
  const p = path.join(tmp(t), 'tags.sqlite');
  legeStore(p, ['tempo:128', 'typ:kick']);
  const s = new TagSpeicher({ pfad: p });
  t.after(() => s.schliesse());
  s.setze([ITEM], ['tempo:140'], true, 'nutzer');
  assert.deepEqual(s.tagsVon(ITEM).filter((x) => x.tag.startsWith('tempo')), [{ tag: 'tempo:140', herkunft: 'nutzer' }]);
  s.setze([ITEM], ['tempo:150'], true, 'agent');
  assert.deepEqual(s.tagsVon(ITEM).filter((x) => x.tag.startsWith('tempo')), [{ tag: 'tempo:150', herkunft: 'agent' }]);
  // own tag removed: no trace, the measured value is back
  assert.equal(s.setze([ITEM], ['tempo:150'], false, 'nutzer'), 1);
  assert.deepEqual(s.tagsVon(ITEM).filter((x) => x.tag.startsWith('tempo')), [{ tag: 'tempo:128', herkunft: 'gemessen' }]);
  // measured tag removed: hidden
  assert.equal(s.setze([ITEM], ['typ:kick'], false, 'nutzer'), 1);
  assert.deepEqual(s.tagsVon(ITEM).map((x) => x.tag), ['tempo:128']);
  assert.equal(s.setze([ITEM], ['typ:kick'], false, 'nutzer'), 0);   // nothing to remove
  const db = new DatabaseSync(p);
  assert.equal(db.prepare("SELECT count(*) AS n FROM item_tag WHERE tag = 'tempo:150'").get().n, 0);
  db.close();
});

test('a user tag that is also measured, once removed, stays hidden', (t) => {
  const p = path.join(tmp(t), 'tags.sqlite');
  legeStore(p, ['typ:kick']);
  const s = new TagSpeicher({ pfad: p });
  t.after(() => s.schliesse());
  s.setze([ITEM], ['typ:kick'], true, 'nutzer');
  s.setze([ITEM], ['typ:kick'], false, 'nutzer');
  assert.deepEqual(s.tagsVon(ITEM), []);
});

test('Review Focus: all or nothing on a bad id or tag; capitals, spaces, umlauts, length, empty frei, unknown word rejected', (t) => {
  const p = path.join(tmp(t), 'tags.sqlite');
  const s = new TagSpeicher({ pfad: p });
  t.after(() => s.schliesse());
  const ids = Array.from({ length: 50 }, (_, i) => `datei:${String(i).padStart(2, '0').repeat(32)}`);
  ids[17] = 'datei:xyz';
  const e = fehler(() => s.setze(ids, ['typ:kick'], true, 'nutzer'));
  assert.deepEqual([e.grund, e.code, e.wer], ['item_ungueltig', 400, 'datei:xyz']);
  assert.equal(fs.existsSync(p), false, 'nothing written, not even the store');
  for (const tag of ['Dark', ' dark', 'charakter:dührt', 'frei:', 'frei:' + 'a'.repeat(25), 'charakter:notaword', 'charakter:Dark', 'tempo:300', 'tempo:0128', 'tonart:13A', 'energie:6', 'typ:']) {
    assert.equal(fehler(() => s.setze([ITEM], [tag], true, 'nutzer')).grund, 'tag_ungueltig', tag);
  }
  assert.equal(fehler(() => s.setze([ITEM, ITEM], ['charakter:dark', 'tag:bad'], true, 'nutzer')).grund, 'tag_ungueltig');
  assert.equal(fehler(() => s.setze(Array(501).fill(ITEM), ['typ:kick'], true, 'nutzer')).grund, 'zu_viele_items');
  assert.equal(fehler(() => s.setze([ITEM], Array.from({ length: 21 }, (_, i) => `frei:t${i}`), true, 'nutzer')).grund, 'zu_viele_tags');
  assert.equal(fehler(() => s.setze([ITEM], ['tempo:120', 'tempo:130'], true, 'nutzer')).grund, 'tag_ungueltig');
  assert.equal(fs.existsSync(p), false);
  // valid words of every art pass
  assert.equal(s.setze([ITEM], ['charakter:dark', 'genre:techno', 'einsatz:drop', 'energie:3', 'tonart:8A', 'tempo:128', 'typ:kick', 'typ:bass', 'frei:my tag-1'], true, 'nutzer'), 9);
});

test('inheritance runs after a write', (t) => {
  const p = path.join(tmp(t), 'tags.sqlite');
  const s = new TagSpeicher({ pfad: p });
  t.after(() => s.schliesse());
  const A = `datei:${'1'.repeat(64)}`, B = `datei:${'2'.repeat(64)}`;
  s.setze([A, B], ['frei:x'], true, 'nutzer');
  s.setze([A], ['genre:techno'], true, 'nutzer');
  const db = new DatabaseSync(p);
  db.prepare("INSERT INTO relation(von, art, nach, herkunft, zeit) VALUES (?, 'made_from', ?, 'melde', 1)").run(B, A);
  db.close();
  s.setze([B], ['frei:y'], true, 'nutzer');
  assert.deepEqual(s.tagsVon(B).map((x) => `${x.tag}/${x.herkunft}`), ['frei:x/nutzer', 'frei:y/nutzer', 'genre:techno/abgeleitet']);
});

test('inheritance after a write touches only descendants of the touched items and writes nothing twice', (t) => {
  const p = path.join(tmp(t), 'tags.sqlite');
  const s = new TagSpeicher({ pfad: p });
  t.after(() => s.schliesse());
  const id = (n) => `datei:${String(n).repeat(64)}`;
  s.setze([id(1), id(2), id(3), id(4)], ['frei:x'], true, 'nutzer');
  s.setze([id(1), id(3)], ['genre:techno'], true, 'nutzer');
  const db = new DatabaseSync(p);
  const rel = db.prepare("INSERT INTO relation(von, art, nach, herkunft, zeit) VALUES (?, 'made_from', ?, 'melde', 1)");
  rel.run(id(2), id(1)); rel.run(id(4), id(3));
  db.close();
  s.setze([id(1)], ['frei:y'], true, 'nutzer');                 // recomputes id(1) and id(2) only
  const abgeleitet = () => { const d = new DatabaseSync(p); try { return d.prepare("SELECT item, tag, wert, zeit FROM item_tag WHERE quelle = 'erbe' ORDER BY item").all().map((r) => ({ ...r })); } finally { d.close(); } };
  const nach1 = abgeleitet();
  assert.deepEqual(nach1.map((r) => [r.item, r.tag, r.wert]), [[id(2), 'genre:techno', 1]]);   // id(4) was not part of the call
  s.setze([id(1)], ['frei:z'], true, 'nutzer');                 // nothing changed for id(2): its row is not rewritten
  assert.deepEqual(abgeleitet(), nach1);
  s.setze([id(3)], ['frei:y'], true, 'nutzer');
  assert.deepEqual(abgeleitet().map((r) => [r.item, r.tag, r.wert]), [[id(2), 'genre:techno', 1], [id(4), 'genre:techno', 1]]);
  s.setze([id(1)], ['genre:techno'], false, 'nutzer');           // the source loses the genre: the derived row goes
  assert.deepEqual(abgeleitet().map((r) => r.item), [id(4)]);
});

test('inheritance writes in transactions of at most 500 rows', (t) => {
  const p = path.join(tmp(t), 'tags.sqlite');
  const s = new TagSpeicher({ pfad: p });
  t.after(() => s.schliesse());
  const id = (n) => `datei:${String(n).padStart(4, '0').repeat(16)}`;
  const db = new DatabaseSync(p);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(fs.readFileSync(SCHEMA_DATEI, 'utf8'));
  db.exec('BEGIN');
  const rel = db.prepare("INSERT INTO relation(von, art, nach, herkunft, zeit) VALUES (?, 'made_from', ?, 'melde', 1)");
  const tag = db.prepare("INSERT INTO item_tag(item, tag, herkunft, quelle, an, zeit) VALUES (?, 'genre:techno', 'gemessen', 'messen', 1, 1)");
  const item = db.prepare("INSERT INTO item(id, art) VALUES (?, 'loop')");
  for (let i = 1; i <= 1100; i++) { item.run(id(i)); item.run(id(i + 5000)); tag.run(id(i)); rel.run(id(i + 5000), id(i)); }
  db.exec('COMMIT');
  db.close();
  s.setze([id(1)], ['frei:go'], true, 'nutzer');                 // touches one item and its one descendant
  const d2 = new DatabaseSync(p);
  t.after(() => d2.close());
  d2.exec('PRAGMA busy_timeout = 5000');
  assert.equal(erbe(d2, 1, undefined, 500), 1099);               // the whole store: 1099 more rows, in 500 + 500 + 99
  assert.equal(erbe(d2, 1, undefined, 500), 0, 'a second run writes nothing');
  assert.equal(d2.prepare("SELECT count(*) AS n FROM item_tag WHERE quelle = 'erbe'").get().n, 1100);
});

test('opening a current store takes no write lock: a reader answers while a writer holds the lock', async (t) => {
  const p = path.join(tmp(t), 'tags.sqlite');
  const s0 = new TagSpeicher({ pfad: p });
  s0.setze([ITEM], ['frei:a'], true, 'nutzer');
  s0.schliesse();
  const kind = spawn(process.execPath, ['-e', `
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(${JSON.stringify(p)});
    d.exec('PRAGMA busy_timeout = 5000'); d.exec('BEGIN IMMEDIATE');
    process.stdout.write('gesperrt\\n');
    setTimeout(() => { d.exec('COMMIT'); d.close(); }, 1500);`], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => kind.kill());
  await new Promise((ok) => kind.stdout.once('data', ok));
  const s = new TagSpeicher({ pfad: p });
  t.after(() => s.schliesse());
  const t0 = Date.now();
  assert.deepEqual(s.tagsVon(ITEM), [{ tag: 'frei:a', herkunft: 'nutzer' }]);
  assert.ok(Date.now() - t0 < 500, `read waited ${Date.now() - t0} ms`);
});

test('the store clock never runs ahead of wall time, however many calls', (t) => {
  const p = path.join(tmp(t), 'tags.sqlite');
  const s = new TagSpeicher({ pfad: p, jetzt: () => 5_000_000 });
  t.after(() => s.schliesse());
  for (let i = 0; i < 401; i++) s.setze([ITEM], ['frei:tick'], i % 2 === 0, 'nutzer');
  const d = new DatabaseSync(p);
  const m = d.prepare('SELECT max(zeit) AS z FROM item_tag').get().z;
  d.close();
  assert.ok(m - 5000 < 0.01, `ran ${m - 5000} s ahead`);
  assert.ok(m >= 5000);
});

test('a damaged store is renamed aside, reads are empty, the next write works', (t) => {
  const d = tmp(t), p = path.join(d, 'tags.sqlite');
  fs.writeFileSync(p, Buffer.from(Array.from({ length: 100 }, (_, i) => i)));
  const s = new TagSpeicher({ pfad: p });
  t.after(() => s.schliesse());
  assert.deepEqual(s.tagsVon(ITEM), []);
  assert.equal(fs.readdirSync(d).filter((f) => f.startsWith('tags.sqlite.defekt-')).length, 1);
  assert.equal(s.setze([ITEM], ['frei:ok'], true, 'nutzer'), 1);
  assert.deepEqual(s.tagsVon(ITEM), [{ tag: 'frei:ok', herkunft: 'nutzer' }]);
});

test('a store locked by another process for 200 ms is waited out', async (t) => {
  const p = path.join(tmp(t), 'tags.sqlite');
  legeStore(p);
  const kind = spawn(process.execPath, ['-e', `
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(${JSON.stringify(p)});
    d.exec('PRAGMA busy_timeout = 5000'); d.exec('BEGIN IMMEDIATE');
    process.stdout.write('gesperrt\\n');
    setTimeout(() => { d.exec('COMMIT'); d.close(); }, 200);`], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => kind.kill());
  await new Promise((ok) => kind.stdout.once('data', ok));
  const s = new TagSpeicher({ pfad: p });
  t.after(() => s.schliesse());
  const t0 = Date.now();
  assert.equal(s.setze([ITEM], ['frei:wait'], true, 'nutzer'), 1);
  assert.ok(Date.now() - t0 >= 100, 'it really waited');
});

test('the schema is the one under djk/bibliothek, no copy in djk/ui', () => {
  assert.equal(SCHEMA_DATEI, path.resolve(import.meta.dirname, '../../bibliothek/tags_schema.sql'));
  const kopie = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === 'node_modules' ? [] : e.isDirectory() ? kopie(path.join(d, e.name)) : e.name === 'tags_schema.sql' || e.name === 'tags_erbe.sql' ? [e.name] : []));
  assert.deepEqual(kopie(path.resolve(import.meta.dirname, '..')), []);
});

test('store path: next to the catalogue, overridable, none without either', (t) => {
  const ctx = { log: () => {}, quelle: () => 'andreas' };
  const d = tmp(t), e = tmp(t);
  const b = tagsBereich(ctx, { katalog: path.join(d, 'katalog.sqlite') });
  t.after(() => b.speicher.schliesse());
  assert.deepEqual(b.speicher.tagsVon(ITEM), []);
  assert.deepEqual(fs.readdirSync(d), []);
  b.speicher.setze([ITEM], ['frei:a'], true, 'nutzer');
  assert.ok(fs.existsSync(path.join(d, 'tags.sqlite')));
  assert.deepEqual(fs.readdirSync(d).filter((f) => !f.startsWith('tags.sqlite')), []);
  const c = tagsBereich(ctx, { katalog: path.join(d, 'katalog.sqlite'), tags: { pfad: path.join(e, 'x.sqlite') } });
  t.after(() => c.speicher.schliesse());
  c.speicher.setze([ITEM], ['frei:a'], true, 'nutzer');
  assert.ok(fs.existsSync(path.join(e, 'x.sqlite')));
  const n = tagsBereich(ctx, {});
  assert.deepEqual(n.speicher.tagsVon(ITEM), []);
});
