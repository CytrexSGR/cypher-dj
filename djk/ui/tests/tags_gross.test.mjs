// The tag store at the size of the real catalogue (90,000 items, generated here, nothing committed). The gate asserts shapes and counts:
// query plans without a full scan of item_tag / relation, 40 of 40 exact names found, the scan in slices. Times are only RECORDED
// (set TAGS_GROSS_AUSGABE to a json path), never asserted: a loaded machine must not fail the gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TagSpeicher, anweisungen, ERBE_DATEI } from '../tags/store.ts';
import { bezuegeBereit } from '../tags/bezuege.ts';
import { baueGross, itemId, itemName } from './support/tags_gross.mjs';

const N = 90000;
const zeiten = {};
const zeit = (name, f) => { const t = performance.now(); const r = f(); zeiten[name] = Math.round((performance.now() - t) * 10) / 10; return r; };

let dir, pfad, speicher;
test.before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tags-gross-'));
  pfad = path.join(dir, 'tags.sqlite');
  zeit('aufbau_fixture_ms', () => baueGross(pfad, N));
  speicher = new TagSpeicher({ pfad });
});
test.after(() => {
  speicher?.schliesse();
  fs.rmSync(dir, { recursive: true, force: true });
  if (process.env.TAGS_GROSS_AUSGABE) fs.writeFileSync(process.env.TAGS_GROSS_AUSGABE, JSON.stringify({ items: N, zeiten }, null, 2));
});

const VOLLSCAN = /^SCAN (item_tag|relation)\b/;
const plan = (d, sql) => d.prepare('EXPLAIN QUERY PLAN ' + sql).all().map((r) => r.detail);

test('the inheritance statements for a batch of 500 targets never scan all of item_tag or relation', () => {
  const d = new DatabaseSync(pfad);
  try {
    d.exec('CREATE TEMP TABLE erbe_ziel(item TEXT PRIMARY KEY)');
    d.exec(`INSERT INTO erbe_ziel SELECT id FROM item WHERE id LIKE 'datei:%' LIMIT 500`);
    d.exec(`INSERT OR IGNORE INTO erbe_ziel SELECT id FROM item WHERE id LIKE 'kit:%'`);
    const ungeprueft = [];
    let t = performance.now();
    for (const st of anweisungen(fs.readFileSync(ERBE_DATEI, 'utf8'))) {
      if (/^(INSERT|CREATE TEMP TABLE \w+ AS)/i.test(st)) {
        const sel = /^INSERT/i.test(st) ? st : st.replace(/^CREATE TEMP TABLE \w+(\([^)]*\))? AS/i, '').trim();
        const voll = plan(d, sel).filter((z) => VOLLSCAN.test(z));
        if (voll.length > 0) ungeprueft.push(`${st.slice(0, 60).replace(/\s+/g, ' ')} -> ${voll.join(' | ')}`);
      }
      d.exec(st);
    }
    zeiten.erbe_statements_500_ziele_ms = Math.round(performance.now() - t);
    assert.deepEqual(ungeprueft, []);
  } finally { d.close(); }
});

test('an incremental scan batch of 40 loops (one inheritance run) on the big store', () => {
  const saetze = [];
  for (let i = 0; i < 40; i++) saetze.push({ eigner: `loop:neu${i}`, name: `neu${i}`, relationen: [['made_from', `loop:neu${i}`, itemId(i * 2)]] });
  zeit('scan_batch_40_loops_ms', () => speicher.anwendeBezuege(saetze));
  zeiten.ms_pro_neue_einheit = Math.round(zeiten.scan_batch_40_loops_ms / 40 * 100) / 100;
  assert.ok(speicher.tagsVon('loop:neu0').some((x) => x.tag.startsWith('genre:')), 'the genre of source 0 is inherited');
  // and removing them again leaves nothing behind
  speicher.anwendeBezuege(saetze.map((s) => ({ eigner: s.eigner, relationen: [] })));
  assert.deepEqual(speicher.tagsVon('loop:neu0'), []);
});

test('tag search: the queries it runs never scan all of item_tag or relation, and the answer is right', () => {
  const sqls = [];
  const orig = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function (sql) { sqls.push(sql); return orig.call(this, sql); };
  let a, b, c, e;
  try {
    a = zeit('suche_selten_tag_ms', () => speicher.suche({ tags: ['frei:fav 3', 'typ:kick'] }));
    b = zeit('suche_haeufiger_tag_ms', () => speicher.suche({ tags: ['typ:kick', 'energie:3'], limit: 100 }));
    c = zeit('suche_tempo_ms', () => speicher.suche({ tags: ['tempo:104'] }));
    e = zeit('suche_art_ms', () => speicher.suche({ tags: [], art: 'kit' }));
    zeit('suche_text_und_tag_ms', () => speicher.suche({ tags: ['genre:techno'], text: 'garage 0001' }));
    zeit('suche_nur_neueste_ms', () => speicher.suche({ tags: [] }));
  } finally { DatabaseSync.prototype.prepare = orig; }
  assert.ok(a.length > 0 && a.every((x) => x.tags.includes('frei:fav 3') && x.tags.includes('typ:kick')));
  assert.equal(b.length, 100);
  assert.ok(c.every((x) => x.tags.includes('tempo:104')));
  assert.equal(e.length, 60);
  const d = new DatabaseSync(pfad);
  try {
    const voll = [];
    for (const sql of new Set(sqls.filter((s) => /^\s*SELECT/i.test(s) && !/count\(\*\)/i.test(s)))) for (const z of plan(d, sql)) if (VOLLSCAN.test(z)) voll.push(`${sql.slice(0, 80).replace(/\s+/g, ' ')} -> ${z}`);
    assert.deepEqual(voll, []);
  } finally { d.close(); }
});

test('text search covers the whole store: 40 of 40 exact names are found, results are capped, not the search space', () => {
  let gefunden = 0;
  const t = performance.now();
  for (let k = 0; k < 40; k++) {
    const i = k < 20 ? k * 3 + 1 : N - 1 - (k - 20) * 4000;   // the oldest and the newest part of the store
    const r = speicher.suche({ tags: [], text: itemName(i) });
    if (r.some((x) => x.item === itemId(i))) gefunden++;
  }
  zeiten.text_suche_ms_je_name = Math.round((performance.now() - t) / 40 * 10) / 10;
  assert.equal(gefunden, 40);
  const viele = speicher.suche({ tags: [], text: 'garage', limit: 500 });
  assert.equal(viele.length, 500);
  assert.ok(speicher.suche({ tags: [], text: 'kick' }).length > 0, 'a tag word matches too');
});

test('the scan runs in slices and the request that starts it does not wait for it', async () => {
  const lp = Array.from({ length: 3000 }, (_, i) => ({ name: `s${i}`, sig: '1', lies: () => ({ sha: (i + 1).toString(16).padStart(64, '0') }) }));
  const leer = { presets: () => [], kits: () => [], projekte: () => [], loops: () => lp };
  const b = bezuegeBereit(speicher, leer, { scheibeMs: 5 });
  const vorher = speicher.suche({ tags: [], art: 'loop', text: 's2999' }).length;
  const t = performance.now();
  b.frisch();
  zeiten.frisch_blockiert_ms = Math.round((performance.now() - t) * 100) / 100;
  assert.equal(speicher.suche({ tags: [], text: 's2999' }).length, vorher, 'nothing is written inside the call');
  let maxLuecke = 0, last = performance.now(), fertig = false;
  b.fertig().then(() => { fertig = true; });
  while (!fertig) { await new Promise((ok) => setImmediate(ok)); const n = performance.now(); maxLuecke = Math.max(maxLuecke, n - last); last = n; }
  zeiten.scan_laengste_luecke_ms = Math.round(maxLuecke);
  zeiten.scan_scheiben = b.scheiben();
  assert.ok(b.scheiben() > 1, `${b.scheiben()} slices`);
  assert.equal(speicher.suche({ tags: [], text: 's2999' }).length, 1);
  b.stopp();
});
