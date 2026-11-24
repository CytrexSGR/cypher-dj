// verwandt and saved-search counts at the size of the real catalogue (90,000 items, generated here). Asserts plans and answers; times are
// only RECORDED (set TAGS_VERWANDT_AUSGABE to a json path), never asserted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TagSpeicher } from '../tags/store.ts';
import { baueGross, itemId } from './support/tags_gross.mjs';

const N = 90000;
const zeiten = {};
const zeit = (name, f) => { const t = performance.now(); const r = f(); zeiten[name] = Math.round((performance.now() - t) * 10) / 10; return r; };
let dir, pfad, speicher;
test.before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tags-vgross-'));
  pfad = path.join(dir, 'tags.sqlite');
  baueGross(pfad, N);
  // keys for every item that has a tempo (the fixture has none), and similar_to rows for a few thousand
  const d = new DatabaseSync(pfad);
  d.exec('BEGIN');
  const tag = d.prepare("INSERT INTO item_tag(item, tag, herkunft, quelle, an, wert, zeit) VALUES (?, ?, 'gemessen', 'messen', 1, NULL, 1)");
  const sim = d.prepare("INSERT OR IGNORE INTO relation(von, art, nach, herkunft, wert, zeit) VALUES (?, 'similar_to', ?, 'messen', ?, 1)");
  for (let i = 0; i < N; i += 4) tag.run(itemId(i), `tonart:${1 + (i / 4 * 7) % 12}${(i / 4) % 2 ? 'A' : 'B'}`);
  for (let i = 0; i < 4000; i++) for (let k = 1; k <= 5; k++) sim.run(itemId(i), itemId((i * 13 + k * 101) % N), k / 10);
  d.exec('COMMIT'); d.exec('ANALYZE'); d.close();
  speicher = new TagSpeicher({ pfad });
});
test.after(() => {
  speicher?.schliesse();
  fs.rmSync(dir, { recursive: true, force: true });
  if (process.env.TAGS_VERWANDT_AUSGABE) fs.writeFileSync(process.env.TAGS_VERWANDT_AUSGABE, JSON.stringify({ items: N, zeiten }, null, 2));
});

test('verwandt on the big store: relation lists, passt_zu typical and worst case', () => {
  let bester;
  // the first loop with tempo and key
  for (let i = 0; i < N; i += 12) { if (speicher.tagsVon(itemId(i)).some((x) => x.tag.startsWith('tonart:'))) { bester = itemId(i); break; } }
  assert.ok(bester);
  const v = zeit('verwandt_typisch_ms', () => speicher.verwandt(bester));
  assert.ok(v.passt_zu.length > 0 && v.passt_zu.length <= 20, String(v.passt_zu.length));
  const viel = zeit('verwandt_passt_max_100_ms', () => speicher.verwandt(bester, { passt_max: 100 }));
  assert.equal(viel.passt_zu.length, 100);
  zeit('verwandt_aehnlich_ms', () => assert.equal(speicher.verwandt(itemId(0)).aehnlich.length, 5));
  zeit('verwandt_gemacht_aus_kit_ms', () => assert.equal(speicher.verwandt('kit:k0').gemacht_aus.length, 8));
  zeit('verwandt_daraus_ms', () => assert.ok(speicher.verwandt(itemId(0)).daraus.length >= 1));
  // worst case: a tempo at the edge of the range where few neighbours match -> all tempo tags in the span are probed
  const rand = itemId(4 * 12 * 3);
  zeit('verwandt_nur_ein_treffer_moeglich_ms', () => speicher.verwandt(rand, { passt_max: 100 }));
});

test('the passt_zu probe and saved-search count plan: no full scan of item_tag or relation', () => {
  const sqls = [];
  const orig = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function (sql) { sqls.push(sql); return orig.call(this, sql); };
  try {
    speicher.verwandt(itemId(0), { passt_max: 100 });
    speicher.zaehle({ tags: ['typ:kick', 'tempo:128'], text: 'garage' });
    speicher.zaehle({ tags: ['genre:techno'] });
  } finally { DatabaseSync.prototype.prepare = orig; }
  const d = new DatabaseSync(pfad);
  try {
    const gesehen = new Set();
    for (const sql of sqls) {
      if (!/relation|item_tag|wirksam/.test(sql) || gesehen.has(sql)) continue;
      gesehen.add(sql);
      const n = (sql.match(/\?/g) ?? []).length;
      const plan = d.prepare('EXPLAIN QUERY PLAN ' + sql).all(...Array(n).fill('typ:kick')).map((r) => r.detail);
      assert.deepEqual(plan.filter((z) => /^SCAN (item_tag|relation)\b/.test(z)), [], sql.slice(0, 90) + ' -> ' + plan.join(' | '));
    }
    assert.ok(gesehen.size >= 6);
  } finally { d.close(); }
});

test('saved-search counts on the big store', () => {
  speicher.merke('kicks', ['typ:kick', 'energie:3'], '', '');
  speicher.merke('rare', ['frei:fav 3', 'typ:kick'], '', '');
  speicher.merke('common', ['genre:techno'], '', '');
  speicher.merke('texty', [], 'garage 0001', '');
  // one call counts inside its time budget; the rest follows with the next calls, then everything is cached until the store changes
  let l, aufrufe = 0;
  do { aufrufe++; l = zeit(`gespeichert_aufruf_${aufrufe}_ms`, () => speicher.gespeichert()); } while (l.some((x) => x.anzahl === null) && aufrufe < 10);
  zeiten.gespeichert_aufrufe_bis_vollstaendig = aufrufe;
  assert.ok(aufrufe >= 2, 'the budget really splits the counting on the big store');
  zeit('gespeichert_gecacht_ms', () => speicher.gespeichert());
  assert.deepEqual(l.map((x) => x.name), ['common', 'kicks', 'rare', 'texty']);
  assert.equal(l.find((x) => x.name === 'common').anzahl, 9999, 'capped');
  assert.ok(l.find((x) => x.name === 'rare').anzahl > 0);
  assert.equal(l.find((x) => x.name === 'texty').anzahl, speicher.suche({ tags: [], text: 'garage 0001', limit: 500 }).length);
});
