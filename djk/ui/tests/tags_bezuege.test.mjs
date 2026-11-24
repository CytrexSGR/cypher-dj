// Provenance relations: the lazy scan (tags/bezuege.ts), the reported relations (TagSpeicher.meldeBezug) and the stems hook.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { TagSpeicher } from '../tags/store.ts';
import { TagFehler } from '../tags/model.ts';
import { bezuegeBereit } from '../tags/bezuege.ts';
import { Stems } from '../areas/proj/stems.ts';

const sha = (n) => n.toString(16).padStart(64, '0');
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bezug-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const DJK = path.resolve(import.meta.dirname, '..', '..');
const PYTHON = [path.join(DJK, 'workshop/.venv/bin/python'), 'python3'].find((p) => p === 'python3' || fs.existsSync(p));

// A store, a scan with fake readers and a clock the test moves
function aufbau(t, quellen = {}, opt = {}) {
  const pfad = path.join(tmp(t), 'tags.sqlite');
  const speicher = new TagSpeicher({ pfad });
  t.after(() => speicher.schliesse());
  const uhr = { jetzt: 1_000_000 };
  const log = [];
  const leer = { presets: () => [], kits: () => [], projekte: () => [], loops: () => [] };
  const b = bezuegeBereit(speicher, { ...leer, ...quellen }, { jetzt: () => uhr.jetzt, log: (z) => log.push(z), ...opt });
  const lauf = async () => { b.frisch(); await b.fertig(); };
  const weiter = async () => { uhr.jetzt += 31_000; await lauf(); };
  const sql = (s, ...p) => { const d = new DatabaseSync(pfad); try { return d.prepare(s).all(...p).map((r) => ({ ...r })); } finally { d.close(); } };
  return { pfad, speicher, b, uhr, log, weiter, lauf, sql };
}
const beziehungen = (z) => z.sql('SELECT von, art, nach, herkunft FROM relation ORDER BY von, art, nach').map((r) => `${r.von} ${r.art} ${r.nach} [${r.herkunft}]`);
const wirksam = (z, item) => z.speicher.tagsVon(item).map((x) => `${x.tag}/${x.herkunft}`);

const preset = (slug, extra = {}) => ({ id: `nutzer:rb338/${slug}`, name: slug, geraet: 'rb338', sig: '1',
  beschreibung: { art: 'bass', unterart: 'sub', charakter: ['dark'], genre: ['techno'], einsatz: ['drop'], energie: 4 }, tags: ['fat bass'], ...extra });

test('a preset gets derived tags (quelle preset) and made_from its device', async (t) => {
  const z = aufbau(t, { presets: () => [preset('wob')] });
  await z.lauf();
  const id = 'preset:nutzer:rb338/wob';
  assert.deepEqual(wirksam(z, id), ['charakter:dark/abgeleitet', 'einsatz:drop/abgeleitet', 'energie:4/abgeleitet', 'frei:fat bass/abgeleitet', 'genre:techno/abgeleitet', 'typ:bass/abgeleitet']);
  assert.deepEqual(z.sql("SELECT DISTINCT quelle FROM item_tag WHERE item = ?", id).map((r) => r.quelle), ['preset']);
  assert.deepEqual(beziehungen(z), [`${id} made_from geraet:rb338 [scan]`]);
});

test('preset tags survive a Python erbe and schreibe_gemessen (they are not erbe rows)', async (t) => {
  const z = aufbau(t, { presets: () => [preset('wob')] });
  await z.lauf();
  const vorher = z.sql("SELECT item, tag, herkunft, quelle FROM item_tag WHERE quelle = 'preset' ORDER BY tag");
  assert.equal(vorher.length, 6);
  const py = spawnSync(PYTHON, ['-c', `
from pathlib import Path
from bibliothek import tags_speicher as ts
con = ts.oeffne(Path(${JSON.stringify(z.pfad)}))
ts.schreibe_gemessen(con, 'datei:${sha(9)}', 'loop', 'x', 'k', [('tempo:128', None)])
ts.erbe(con)
con.close()`], { cwd: DJK, encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  assert.deepEqual(z.sql("SELECT item, tag, herkunft, quelle FROM item_tag WHERE quelle = 'preset' ORDER BY tag"), vorher);
});

test('a manual removal survives a rescan; an edited preset replaces only the derived rows', async (t) => {
  let p = preset('wob');
  const z = aufbau(t, { presets: () => [p] });
  await z.lauf();
  const id = 'preset:nutzer:rb338/wob';
  z.speicher.setze([id], ['genre:techno'], false, 'nutzer');
  assert.ok(!wirksam(z, id).includes('genre:techno/abgeleitet'));
  z.speicher.setze([id], ['frei:mine'], true, 'nutzer');
  p = preset('wob', { sig: '2', beschreibung: { art: 'bass', unterart: 'sub', charakter: ['bright'], genre: ['techno'], einsatz: ['drop'], energie: 2 }, tags: [] });
  await z.weiter();
  const w = wirksam(z, id);
  assert.ok(!w.some((x) => x.startsWith('genre:')), 'the manual removal still hides genre:techno');
  assert.ok(w.includes('charakter:bright/abgeleitet') && !w.includes('charakter:dark/abgeleitet'), w.join());
  assert.ok(w.includes('energie:2/abgeleitet') && !w.includes('energie:4/abgeleitet'));
  assert.ok(w.includes('frei:mine/nutzer'), 'the manual tag stays');
  assert.ok(!w.some((x) => x.startsWith('frei:fat')), 'the old derived free tag is gone');
});

test('a kit is made_from the files it names; datei:<sha>/2 counts, schnitt: forms are skipped without an error; typ comes through inheritance', async (t) => {
  const z = aufbau(t, { kits: () => [
    { name: 'k1', sig: '1', lies: () => ({ quelle: [`datei:${sha(1)}/2`, `datei:${sha(2)}`, 'schnitt:7/1', 'datei:zz', ''] }) },
  ] });
  z.speicher.setze([`datei:${sha(1)}`], ['typ:kick'], true, 'nutzer');
  await z.lauf();
  assert.deepEqual(beziehungen(z), [`kit:k1 made_from datei:${sha(1)} [scan]`, `kit:k1 made_from datei:${sha(2)} [scan]`]);
  assert.deepEqual(z.log.filter((x) => /fehler/.test(x.typ)), []);
  assert.ok(wirksam(z, 'kit:k1').includes('typ:kick/abgeleitet'), wirksam(z, 'kit:k1').join());
});

test('a project gets four kinds of used_in; after the clip is removed and the project rescanned its row is gone', async (t) => {
  let clips = [sha(1)];
  const z = aufbau(t, { projekte: () => [{ slug: 'song', sig: String(clips.length), lies: () => ({ clips, zellen: [sha(2)], presets: ['nutzer:rb338/wob'], kits: ['k1'], takes: ['take-1-1.wav'], exporte: ['song-20261123-101010.wav'] }) }] });
  await z.lauf();
  assert.deepEqual(beziehungen(z), [
    `datei:${sha(1)} used_in projekt:song [scan]`, `datei:${sha(2)} used_in projekt:song [scan]`,
    'export:song/song-20261123-101010.wav made_from projekt:song [scan]',
    'kit:k1 used_in projekt:song [scan]', 'preset:nutzer:rb338/wob used_in projekt:song [scan]',
    'take:song/take-1-1.wav made_from projekt:song [scan]']);
  clips = [];
  await z.weiter();
  assert.ok(!beziehungen(z).some((r) => r.startsWith(`datei:${sha(1)} `)));
  assert.ok(beziehungen(z).some((r) => r.startsWith(`datei:${sha(2)} `)));
});

test('a loop made_from a track with a measured genre gets the genre as an effective derived tag', async (t) => {
  const z = aufbau(t, { loops: () => [{ name: 'lp', sig: '1', lies: () => ({ sha: sha(5) }) }] });
  const d = new DatabaseSync(z.pfad); d.close();
  z.speicher.setze([`datei:${sha(5)}`], ['frei:seed'], true, 'nutzer');
  const db = new DatabaseSync(z.pfad);
  db.prepare("INSERT INTO item_tag(item, tag, herkunft, quelle, an, zeit) VALUES (?, 'genre:techno', 'gemessen', 'messen', 1, 1)").run(`datei:${sha(5)}`);
  db.close();
  await z.lauf();
  assert.deepEqual(beziehungen(z), [`loop:lp made_from datei:${sha(5)} [scan]`]);
  assert.ok(wirksam(z, 'loop:lp').includes('genre:techno/abgeleitet'), wirksam(z, 'loop:lp').join());
});

test('frisch() twice within 30 s scans once; after 30 s it scans again; a running scan is not restarted', async (t) => {
  let n = 0;
  const z = aufbau(t, { loops: () => { n++; return []; } });
  z.b.frisch(); z.b.frisch();   // the second call finds the first one running
  await z.b.fertig();
  assert.equal(n, 1);
  z.uhr.jetzt += 29_000; await z.lauf();
  assert.equal(n, 1);
  z.uhr.jetzt += 2_000; await z.lauf();
  assert.equal(n, 2);
});

test('1000 sources are read in several time slices off the call; unchanged ones are not read again', async (t) => {
  let gelesen = 0;
  const lp = Array.from({ length: 1000 }, (_, i) => ({ name: `l${i}`, sig: '1', lies: () => { gelesen++; return { sha: sha(i + 1) }; } }));
  const z = aufbau(t, { loops: () => lp });
  z.b.frisch();
  assert.equal(gelesen, 0, 'frisch() itself reads nothing: the work runs after the call returned');
  assert.equal(fs.existsSync(z.pfad), false, 'the store is not even created inside the call');
  await z.b.fertig();
  assert.equal(gelesen, 1000);
  assert.ok(z.b.scheiben() >= 20, `${z.b.scheiben()} slices`);
  await z.weiter();
  assert.equal(gelesen, 1000, 'the stored signatures say nothing changed');
  assert.equal(z.sql("SELECT count(*) AS n FROM relation WHERE herkunft = 'scan'")[0].n, 1000);
});

test('a stopped scan takes no further slice and writes nothing more', async (t) => {
  const lp = Array.from({ length: 500 }, (_, i) => ({ name: `l${i}`, sig: '1', lies: () => ({ sha: sha(i + 1) }) }));
  const z = aufbau(t, { loops: () => lp });
  z.b.frisch(); z.b.stopp();
  await z.b.fertig();
  assert.equal(fs.existsSync(z.pfad), false);
});

test('changing a preset or kit signature leaves the project\'s used_in rows alone (owner of a scan row)', async (t) => {
  let ps = '1', ks = '1';
  const z = aufbau(t, {
    presets: () => [preset('wob', { sig: ps })],
    kits: () => [{ name: 'k1', sig: ks, lies: () => ({ quelle: [`datei:${sha(1)}`] }) }],
    projekte: () => [{ slug: 'song', sig: 'p1', lies: () => ({ clips: [sha(2)], zellen: [], presets: ['nutzer:rb338/wob'], kits: ['k1'], takes: [], exporte: [] }) }],
  });
  await z.lauf();
  const vorher = beziehungen(z);
  assert.ok(vorher.includes('preset:nutzer:rb338/wob used_in projekt:song [scan]'), vorher.join('\n'));
  assert.ok(vorher.includes('kit:k1 used_in projekt:song [scan]'));
  ps = '2'; ks = '2';   // the project signature does not change: its rows would never come back if the other scans deleted them
  await z.weiter();
  assert.deepEqual(beziehungen(z), vorher);
  ks = '3';
  await z.weiter();
  assert.deepEqual(beziehungen(z), vorher);
});

test('a relation two sources wrote stays until both let go', async (t) => {
  let a = [`datei:${sha(1)}`], b = [`datei:${sha(1)}`];
  const z = aufbau(t, { kits: () => [{ name: 'a', sig: String(a), lies: () => ({ quelle: a }) }, { name: 'b', sig: String(b), lies: () => ({ quelle: b }) }] });
  await z.lauf();
  assert.equal(beziehungen(z).length, 2);
  a = []; await z.weiter();
  assert.deepEqual(beziehungen(z), [`kit:b made_from datei:${sha(1)} [scan]`]);
});

test('schema lift: a v1 store loses its owner-less scan rows and scan signatures, nothing else', (t) => {
  const pfad = path.join(tmp(t), 'tags.sqlite');
  const s1 = new TagSpeicher({ pfad }); s1.setze([`datei:${sha(3)}`], ['frei:x'], true, 'nutzer'); s1.schliesse();
  const d = new DatabaseSync(pfad);
  d.exec("PRAGMA user_version = 1");
  d.exec("DROP TABLE scan_eigner");
  d.exec(`INSERT INTO relation(von, art, nach, herkunft) VALUES ('kit:x', 'made_from', 'datei:${sha(1)}', 'scan'), ('kit:x', 'made_from', 'datei:${sha(2)}', 'melde')`);
  d.exec("INSERT INTO stand VALUES ('scan_kit', '{}'), ('anderes', 'x')");
  d.close();
  const s2 = new TagSpeicher({ pfad }); s2.tagsVon(`datei:${sha(3)}`); s2.setze([`datei:${sha(3)}`], ['frei:y'], true, 'nutzer'); s2.schliesse();
  const e = new DatabaseSync(pfad);
  assert.deepEqual(e.prepare('SELECT herkunft FROM relation').all().map((r) => r.herkunft), ['melde']);
  assert.deepEqual(e.prepare('SELECT schluessel FROM stand').all().map((r) => r.schluessel), ['anderes']);
  assert.equal(e.prepare('PRAGMA user_version').get().user_version, 2);
  e.close();
});

test('a source that disappears loses its own scan rows but not the reported ones', async (t) => {
  let lp = [{ name: 'lp', sig: '1', lies: () => ({ sha: sha(5) }) }];
  const z = aufbau(t, { loops: () => lp });
  await z.lauf();
  z.speicher.meldeBezug('made_from', 'loop:lp', `datei:${sha(6)}`);
  lp = [];
  await z.weiter();
  assert.deepEqual(beziehungen(z), [`loop:lp made_from datei:${sha(6)} [melde]`]);
});

test('an unreadable project or kit is skipped with a logged line, the rest is scanned', async (t) => {
  const z = aufbau(t, {
    kits: () => [{ name: 'kaputt', sig: '1', lies: () => { throw new Error('kit.json unlesbar'); } }, { name: 'gut', sig: '1', lies: () => ({ quelle: [`datei:${sha(1)}`] }) }],
    projekte: () => [{ slug: 'defekt', sig: '1', lies: () => { throw new Error('project.json unlesbar'); } }],
  });
  await z.lauf();
  assert.deepEqual(beziehungen(z), [`kit:gut made_from datei:${sha(1)} [scan]`]);
  assert.equal(z.log.filter((x) => x.typ === 'tags_scan_uebersprungen').length, 2, JSON.stringify(z.log));
});

test('meldeBezug is idempotent, validates both ids, creates missing items and runs the inheritance', (t) => {
  const z = aufbau(t);
  const s = z.speicher;
  s.setze([`datei:${sha(1)}`], ['genre:house'], true, 'nutzer');
  assert.equal(s.meldeBezug('made_from', `datei:${sha(2)}`, `datei:${sha(1)}`, { name: 'stem bass' }), true);
  assert.equal(s.meldeBezug('made_from', `datei:${sha(2)}`, `datei:${sha(1)}`), false);
  assert.deepEqual(beziehungen(z), [`datei:${sha(2)} made_from datei:${sha(1)} [melde]`]);
  assert.equal(z.sql('SELECT name FROM item WHERE id = ?', `datei:${sha(2)}`)[0].name, 'stem bass');
  assert.ok(wirksam(z, `datei:${sha(2)}`).includes('genre:house/abgeleitet'));
  assert.throws(() => s.meldeBezug('made_from', 'datei:xx', `datei:${sha(1)}`), TagFehler);
  assert.throws(() => s.meldeBezug('used_in', `datei:${sha(1)}`, 'projekt:Bad Slug'), TagFehler);
  assert.throws(() => s.meldeBezug('similar_to', `datei:${sha(1)}`, `datei:${sha(2)}`), TagFehler);
  assert.equal(z.sql('SELECT count(*) AS n FROM relation')[0].n, 1);
});

// The stems hook: the real Stems class needs a Python that can import the werkstatt; without one these two are skipped
import { OHNE_GPU } from './support/stems_voraussetzung.mjs';
import { aufbau as projAufbau } from './support/output_setup.mjs';
import { warteBis } from './support/proj_context.mjs';
import { pythonVorgabe } from '../server.ts';
import { REPO_PFADE } from '../paths.ts';

async function stemsLauf(t, bezug) {
  const r = await projAufbau(t, {});
  const stems = new Stems(r.ctx, r.zugang, { python: pythonVorgabe(), cwd: REPO_PFADE.werkstatt, zusatzArgs: ['--trenner', 'identitaet'], killMs: 2000, ...(bezug === 'aus' ? {} : { bezug }) });
  t.after(() => stems.schliesse());
  stems.ereignis('/zustand/kern', { generation: 1, quantum: 256, ki_gestoppt: 0 });
  assert.equal(stems.starte({ clip_id: 'c1' }, 'andreas').code, 200);
  const stand = () => r.s.aktuell().j.stems;
  assert.ok(await warteBis(() => stand() && stand().zustand !== 'laeuft', 60000));
  return { ...r, stand };
}

test('stems: an injected store records made_from and used_in; undefined behaves as before; a throwing store never fails the placement', { skip: OHNE_GPU }, async (t) => {
  const aufrufe = [];
  const z = await stemsLauf(t, (art, von, nach) => { aufrufe.push([art, von, nach]); });
  assert.equal(z.stand().zustand, 'fertig', JSON.stringify(z.stand()));
  const slug = z.offen().slug;
  const arten = aufrufe.map((a) => a[0]);
  assert.ok(arten.includes('made_from') && arten.includes('used_in'), JSON.stringify(aufrufe));
  assert.ok(aufrufe.every((a) => /^datei:[0-9a-f]{64}$/.test(a[1])) && aufrufe.filter((a) => a[0] === 'used_in').every((a) => a[2] === `projekt:${slug}`));
  assert.equal(z.projekt().spuren.length > 1, true);

  const y = await stemsLauf(t, 'aus');
  assert.equal(y.stand().zustand, 'fertig');

  const x = await stemsLauf(t, () => { throw new Error('store down'); });
  assert.equal(x.stand().zustand, 'fertig', 'the placement does not fail');
  assert.ok(x.projekt().spuren.length > 1);
});
