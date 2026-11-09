// Hardening tests for collection.ts (lists/sets as <ordner>/<slug>/set.json, written atomically under a per-list lock).
// Covers what tests/collection.test.mjs and tests/collection_listen.test.mjs leave out: slugs from umlauts, Unicode, empty and
// huge names; path traversal through every slug parameter; directories and symlinks that are no lists; corrupt and
// truncated set.json files (synthetic fixtures in tests/fixtures/hardening/sets/); duplicate names and duplicate posten;
// many posten and long notes; concurrent creation of equally named lists from several processes; order stability of
// liste(), verschiebe() and the posten ids; and uebersicht() on empty and large input.
//
// Mutation check (how "demonstrably fails" was verified): the last test loads broken copies of collection.ts through
// tests/fixtures/hardening/mutant.mjs (slug check removed from datei(), umlaut transliteration removed, slug length cap
// removed, duplicate detection removed) and asserts that the check functions used by the normal tests reject them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as echt from '../collection.ts';
import { ladeMutante, tmpDir, MODULE_DIR } from './fixtures/hardening/mutant.mjs';

const FIX = path.join(import.meta.dirname, 'fixtures', 'hardening', 'sets');
const fehler = (code, name) => (e) => e instanceof Error && e.code === code && e.fehler === name;
const M = (n) => n.toString(16).padStart(16, '0');
// every file and directory below `wurzel`, relative (to prove that nothing was written outside the list folder)
const baum = (wurzel) => fs.readdirSync(wurzel, { recursive: true }).map(String).sort();

// ---- check functions (normal tests and mutation checks) ----
function pruefeSlugs(m) {
  const faelle = {
    'Größe Über': 'groesse-ueber', 'ÄÖÜ äöü': 'aeoeue-aeoeue', 'ẞ Straße': 'ss-strasse', 'Café Crème': 'cafe-creme',
    '../../etc/passwd': 'etc-passwd', '..': 'set', '': 'set', '   ': 'set', '😀🎵': 'set', 'import': 'import-set', 'IMPORT!': 'import-set',
    'Set #1 (Warm-Up)': 'set-1-warm-up', 'a\u0000b': 'a-b', 'C:\\Users\\x': 'c-users-x', 'Ⅻ ﬁx': 'xii-fix',
  };
  for (const [ein, aus] of Object.entries(faelle)) assert.equal(m.slugVon(ein), aus, `slugVon(${JSON.stringify(ein)})`);
  for (const ein of ['a'.repeat(500), 'ä'.repeat(100), `${'x'.repeat(47)} y`, '-'.repeat(60) + 'z', 'Ⅻ'.repeat(30)]) {
    const s = m.slugVon(ein);
    assert.ok(m.SLUG.test(s), `slugVon(${JSON.stringify(ein.slice(0, 12))}…) = ${s} is a valid slug`);
    assert.ok(s.length <= 48);
  }
}

function pruefeTraversal(m, t) {
  const d = tmpDir(t);
  const ordner = path.join(d, 'listen');
  const s = new m.Sammlungen(ordner);
  const echtSlug = s.lege('Echt');
  fs.writeFileSync(path.join(d, 'set.json'), '{"schema":1,"name":"outside","angelegt":"","notiz":"","posten":[],"ablauf":null}');
  const vorher = baum(d);
  for (const slug of ['..', '../listen/echt', '.', '', 'a/../echt', 'echt/', '/etc', 'Echt', '.papierkorb', 'x'.repeat(49), 'echt\u0000', 'echt\n', '-echt', 'é']) {
    const ok400 = fehler(400, 'slug_ungueltig');
    assert.throws(() => s.lies(slug), ok400, `lies(${JSON.stringify(slug)})`);
    assert.throws(() => s.legeHinzu(slug, 'track', M(1)), ok400, `legeHinzu(${JSON.stringify(slug)})`);
    assert.throws(() => s.verschiebe(slug, 'p1', 0), ok400);
    assert.throws(() => s.benenne(slug, 'X'), ok400);
    assert.throws(() => s.entferne(slug, 'p1'), ok400);
    assert.throws(() => s.loesche(slug), ok400);
  }
  assert.deepEqual(baum(d), vorher, 'nothing created, moved or removed');
  assert.equal(s.lies(echtSlug).name, 'Echt');
}

function pruefeDoppelte(m, t) {
  const s = new m.Sammlungen(tmpDir(t));
  const slug = s.lege('Doppelt');
  const a = s.legeHinzu(slug, 'track', M(1));
  for (let i = 0; i < 5; i++) assert.deepEqual(s.legeHinzu(slug, 'track', M(1)), { id: a.id, schon_drin: true });
  assert.equal(s.legeHinzu(slug, 'loop', M(1)).schon_drin, false, 'same material as another kind is another posten');
  assert.equal(s.legeHinzu(slug, 'muster', 'eigen:acid').schon_drin, false);
  assert.equal(s.legeHinzu(slug, 'muster', 'eigen:acid').schon_drin, true);
  assert.equal(s.lies(slug).posten.length, 3);
}

// ---- slugs ----
test('sammlung hardening: slugs from umlauts, ß, ligatures, traversal and empty names are valid and readable', () => pruefeSlugs(echt));

test('sammlung hardening: 2000 random Unicode names always give a valid slug and a list that can be read back', (t) => {
  const s = new echt.Sammlungen(tmpDir(t));
  let x = 7;
  const r = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x; };
  const zeichen = ['a', 'Z', 'ä', 'Ö', 'ß', ' ', '-', '/', '.', '\\', '😀', '日', 'я', '\u0301', '%', '_', '"', '\u0000', '\t'];
  for (let i = 0; i < 2000; i++) {
    const name = Array.from({ length: 1 + (r() % 40) }, () => zeichen[r() % zeichen.length]).join('');
    assert.ok(echt.SLUG.test(echt.slugVon(name)), JSON.stringify(name));
    if (i % 20 === 0 && name.trim().length > 0 && name.trim().length <= 80) assert.equal(s.lies(s.lege(name)).name, name.trim());
  }
});

test('sammlung hardening: a name in NFD (macOS input) gives the same slug as in NFC',
  () => {
    assert.equal(echt.slugVon('Ba\u0308r'), echt.slugVon('B\u00e4r'));
    assert.equal(echt.slugVon('U\u0308ber'), 'ueber');
  });

test('sammlung hardening: name length limits count UTF-16 units; 80 is the edge, whitespace is trimmed first', (t) => {
  const s = new echt.Sammlungen(tmpDir(t));
  assert.equal(s.lies(s.lege(`  ${'n'.repeat(80)}  `)).name, 'n'.repeat(80));
  assert.throws(() => s.lege('n'.repeat(81)), fehler(400, 'name_ungueltig'));
  assert.equal(s.lies(s.lege('😀'.repeat(40))).name, '😀'.repeat(40));
  assert.throws(() => s.lege('😀'.repeat(41)), fehler(400, 'name_ungueltig'));
  assert.throws(() => s.lege(' \t\n '), fehler(400, 'name_ungueltig'));
  assert.throws(() => s.lege(null), fehler(400, 'name_ungueltig'));
  const slug = s.lege('Kurz');
  assert.throws(() => s.benenne(slug, 'x'.repeat(81)), fehler(400, 'name_ungueltig'));
  s.benenne(slug, '  Grüße 🎵  ');
  assert.equal(s.lies(slug).name, 'Grüße 🎵');
});

// ---- path traversal ----
test('sammlung hardening: traversal and malformed slugs are 400 in every method and touch no file', (t) => pruefeTraversal(echt, t));

test('sammlung hardening: liste() skips symlinks, files, hidden and upper-case directories', (t) => {
  const d = tmpDir(t);
  const ordner = path.join(d, 'listen'), fremd = path.join(d, 'fremd');
  const s = new echt.Sammlungen(ordner);
  s.lege('Echt');
  fs.mkdirSync(fremd); fs.copyFileSync(path.join(FIX, 'gut_unicode.json'), path.join(fremd, 'set.json'));
  fs.symlinkSync(fremd, path.join(ordner, 'link'));
  for (const n of ['Gross', '.versteckt', '-strich']) { fs.mkdirSync(path.join(ordner, n)); fs.copyFileSync(path.join(FIX, 'gut_unicode.json'), path.join(ordner, n, 'set.json')); }
  fs.writeFileSync(path.join(ordner, 'datei'), 'x');
  fs.mkdirSync(path.join(ordner, 'ohne-json'));
  s.loesche(s.lege('Weg'));
  assert.deepEqual(s.liste().map((e) => e.slug), ['echt']);
});

// ---- corrupt files ----
test('sammlung hardening: truncated, empty, null and array set.json are listed as json_kaputt and refuse changes unchanged', (t) => {
  const ordner = tmpDir(t);
  const s = new echt.Sammlungen(ordner);
  const namen = ['abgeschnitten', 'leer', 'null', 'array', 'bom'];
  for (const n of namen) { fs.mkdirSync(path.join(ordner, n)); fs.copyFileSync(path.join(FIX, `${n}.json`), path.join(ordner, n, 'set.json')); }
  assert.deepEqual(s.liste().map((e) => [e.slug, e.fehler]), namen.slice().sort().map((n) => [n, 'json_kaputt']));
  for (const n of ['abgeschnitten', 'leer', 'bom']) {
    const vorher = fs.readFileSync(path.join(ordner, n, 'set.json'));
    assert.throws(() => s.lies(n), fehler(409, 'json_kaputt'));
    assert.throws(() => s.legeHinzu(n, 'track', M(1)), fehler(409, 'json_kaputt'));
    assert.throws(() => s.verschiebe(n, 'p1', 0), fehler(409, 'json_kaputt'));
    assert.throws(() => s.benenne(n, 'Neu'), fehler(409, 'json_kaputt'));
    assert.throws(() => s.entferne(n, 'p1'), fehler(409, 'json_kaputt'));
    assert.deepEqual(fs.readFileSync(path.join(ordner, n, 'set.json')), vorher, `${n}: file unchanged`);
    assert.equal(fs.existsSync(path.join(ordner, n, '.sperre')), false, `${n}: lock released`);
  }
});

test('sammlung hardening: a set.json that parses but has an unknown art or no posten array is refused with a SammlungFehler',
  (t) => {
    const ordner = tmpDir(t);
    const s = new echt.Sammlungen(ordner);
    for (const n of ['art_unbekannt', 'art_prototyp', 'posten_text']) {
      fs.mkdirSync(path.join(ordner, n.replace('_', '-'))); fs.copyFileSync(path.join(FIX, `${n}.json`), path.join(ordner, n.replace('_', '-'), 'set.json'));
    }
    for (const slug of ['art-unbekannt', 'art-prototyp', 'posten-text']) {
      assert.throws(() => s.legeHinzu(slug, 'track', M(1)), (e) => e instanceof echt.SammlungFehler, slug);
    }
    assert.equal(s.liste().find((e) => e.slug === 'posten-text').fehler, 'json_kaputt');
  });

test('sammlung hardening: a valid fixture with umlauts and emoji round-trips; ids continue after the highest, not the count', (t) => {
  const ordner = tmpDir(t);
  const s = new echt.Sammlungen(ordner);
  fs.mkdirSync(path.join(ordner, 'gut')); fs.copyFileSync(path.join(FIX, 'gut_unicode.json'), path.join(ordner, 'gut', 'set.json'));
  assert.deepEqual(s.liste(), [{ slug: 'gut', name: 'Größe Über 🎵', art: 'set', posten: 2 }]);
  assert.equal(s.legeHinzu('gut', 'oneshot', M(3)).id, 'p8');
  s.benenne('gut', 'Größer 🎶');
  const j = JSON.parse(fs.readFileSync(path.join(ordner, 'gut', 'set.json'), 'utf8'));
  assert.equal(j.name, 'Größer 🎶');
  assert.deepEqual(j.posten.map((p) => p.id), ['p7', 'p2', 'p8']);
});

// ---- duplicates ----
test('sammlung hardening: duplicate posten are recognised per kind, repeated adds return the same id', (t) => pruefeDoppelte(echt, t));

test('sammlung hardening: 30 lists with the same name get distinct slugs in creation order', (t) => {
  const s = new echt.Sammlungen(tmpDir(t));
  const slugs = Array.from({ length: 30 }, () => s.lege('Gleich'));
  assert.deepEqual(slugs, ['gleich', ...Array.from({ length: 29 }, (_, i) => `gleich-${i + 2}`)]);
  assert.deepEqual(s.liste().map((e) => e.slug), slugs.slice().sort((a, b) => a.localeCompare(b)));
});

test('sammlung hardening: the 1000th list with the same 48-character name still gets a valid slug',
  (t) => {
    const ordner = tmpDir(t);
    const s = new echt.Sammlungen(ordner);
    const name = 'a'.repeat(48);
    fs.mkdirSync(path.join(ordner, name));
    for (let i = 2; i < 1000; i++) fs.mkdirSync(path.join(ordner, `${name.slice(0, 44)}-${i}`));
    const slug = s.lege(name);
    assert.ok(echt.SLUG.test(slug));
    assert.equal(s.lies(slug).name, name);
  });

// ---- huge input ----
test('sammlung hardening: 1500 posten, a 10 000-character note and moves to the extremes stay consistent', (t) => {
  const s = new echt.Sammlungen(tmpDir(t));
  const slug = s.lege('Gross');
  for (let i = 1; i <= 1500; i++) s.legeHinzu(slug, 'track', M(i), i === 1 ? 'ü'.repeat(10_000) : undefined);
  let l = s.lies(slug);
  assert.equal(l.posten.length, 1500);
  assert.equal(new Set(l.posten.map((p) => p.id)).size, 1500);
  assert.equal(l.posten[0].notiz, 'ü'.repeat(200), 'note capped at 200');
  s.verschiebe(slug, 'p1', 1e9); s.verschiebe(slug, 'p1500', -1e9); s.verschiebe(slug, 'p750', Number.NaN); s.verschiebe(slug, 'p2', Infinity);
  l = s.lies(slug);
  assert.deepEqual([l.posten[0].id, l.posten[1].id, l.posten.at(-2).id, l.posten.at(-1).id], ['p750', 'p1500', 'p1', 'p2']);
  assert.equal(l.posten.length, 1500);
  assert.equal(new Set(l.posten.map((p) => p.id)).size, 1500, 'moves neither lose nor duplicate posten');
});

test('sammlung hardening: a note cut at 200 does not split an emoji into a lone surrogate',
  (t) => {
    const s = new echt.Sammlungen(tmpDir(t));
    const slug = s.lege('Notiz');
    s.legeHinzu(slug, 'track', M(1), `${'a'.repeat(199)}😀`);
    assert.equal(s.lies(slug).posten[0].notiz.isWellFormed(), true);
  });

// ---- order stability ----
test('sammlung hardening: verschiebe keeps the relative order of all other posten', (t) => {
  const s = new echt.Sammlungen(tmpDir(t));
  const slug = s.lege('Reihe');
  for (let i = 1; i <= 8; i++) s.legeHinzu(slug, 'track', M(i));
  const ids = () => s.lies(slug).posten.map((p) => p.id);
  s.verschiebe(slug, 'p5', 1);
  assert.deepEqual(ids(), ['p1', 'p5', 'p2', 'p3', 'p4', 'p6', 'p7', 'p8']);
  s.verschiebe(slug, 'p5', 6);
  assert.deepEqual(ids(), ['p1', 'p2', 'p3', 'p4', 'p6', 'p7', 'p5', 'p8']);
  s.verschiebe(slug, 'p8', 2.9);
  assert.deepEqual(ids(), ['p1', 'p2', 'p8', 'p3', 'p4', 'p6', 'p7', 'p5'], 'fractional positions are floored');
  s.entferne(slug, 'p3');
  assert.equal(s.legeHinzu(slug, 'track', M(99)).id, 'p9', 'a new id follows the highest');
});

// ---- trash ----
test('sammlung hardening: deleting a recreated list twice within one millisecond keeps both in the trash',
  (t) => {
    const s = new echt.Sammlungen(tmpDir(t));
    for (let i = 0; i < 50; i++) { s.lege('Wieder'); s.loesche('wieder'); }
    assert.deepEqual(s.liste(), []);
    assert.equal(fs.readdirSync(path.join(s.ordnerPfad, '.papierkorb')).length, 50);
  });

// ---- concurrency ----
test('sammlung hardening: four processes creating 15 equally named lists each get 60 distinct, readable lists', async (t) => {
  const ordner = tmpDir(t);
  const url = pathToFileURL(path.join(MODULE_DIR, 'collection.ts')).href;
  const code = `import { Sammlungen } from ${JSON.stringify(url)}; const s = new Sammlungen(process.argv[1]);
    const aus = []; for (let i = 0; i < 15; i++) aus.push(s.lege('Parallel Grüße')); console.log(JSON.stringify(aus));`;
  const lauf = () => new Promise((ok, f) => {
    const p = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', code, ordner], { stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '', e = '';
    p.stdout.on('data', (d) => { o += d; }); p.stderr.on('data', (d) => { e += d; });
    p.once('exit', (c) => (c === 0 ? ok(JSON.parse(o)) : f(new Error(`rc ${c}: ${e}`))));
  });
  const alle = (await Promise.all([lauf(), lauf(), lauf(), lauf()])).flat();
  assert.equal(alle.length, 60);
  assert.equal(new Set(alle).size, 60, 'no two processes got the same slug');
  const s = new echt.Sammlungen(ordner);
  assert.equal(s.liste().filter((e) => e.name === 'Parallel Grüße' && !e.fehler).length, 60);
  assert.deepEqual(fs.readdirSync(ordner).filter((n) => n.includes('.tmp-')), [], 'no temp files left');
});

// ---- uebersicht ----
test('sammlung hardening: uebersicht on empty, single, even, unsorted and 10 000 posten', () => {
  const p = (bpm, extra = {}) => ({ status: 'ready', dauer_s: 60, bpm, camelot: null, genre: null, ...extra });
  assert.deepEqual(echt.uebersicht([]), { tracks: 0, dauer_s: 0, bpm: null, camelot: {}, genre: {}, status: {} });
  assert.deepEqual(echt.uebersicht([p(0)]).bpm, { min: 0, max: 0, median: 0 }, 'bpm 0 is a value, not missing');
  assert.deepEqual(echt.uebersicht([p(130), p(null), p(120), p(125), p(140)]).bpm, { min: 120, max: 140, median: 127.5 });
  const viele = Array.from({ length: 10_000 }, (_, i) => p(100 + (i % 41), { dauer_s: 0.1, camelot: `${(i % 12) + 1}A`, genre: i % 2 ? 'Hörspiel' : '' }));
  const u = echt.uebersicht(viele);
  assert.equal(u.dauer_s, 1000);
  assert.equal(u.bpm.median, 120);
  assert.equal(Object.values(u.camelot).reduce((a, b) => a + b, 0), 10_000);
  assert.deepEqual(u.genre, { Hörspiel: 5000 }, 'empty genre is not counted');
});

// ---- mutation checks ----
test('sammlung hardening, mutation check: the checks above reject broken copies of collection.ts', async (t) => {
  const ohneSlugPruefung = await ladeMutante(t, 'collection.ts', [["if (!SLUG.test(slug)) throw new SammlungFehler(400, 'slug_ungueltig');\n    return path.join", 'return path.join']]);
  assert.throws(() => pruefeTraversal(ohneSlugPruefung, t), assert.AssertionError, 'without the slug check ../ reaches the parent folder');
  const ohneUmlaut = await ladeMutante(t, 'collection.ts', [[".replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')", '']]);
  assert.throws(() => pruefeSlugs(ohneUmlaut), assert.AssertionError, 'without transliteration Größe becomes grosse');
  const ohneDeckel = await ladeMutante(t, 'collection.ts', [[".replace(/^-+|-+$/g, '').slice(0, 48);", ".replace(/^-+|-+$/g, '');"]]);
  assert.throws(() => pruefeSlugs(ohneDeckel), assert.AssertionError, 'without the cap a long name is no valid slug');
  const ohneDoppel = await ladeMutante(t, 'collection.ts', [['if (da) return { id: da.id, schon_drin: true };', '']]);
  assert.throws(() => pruefeDoppelte(ohneDoppel, t), assert.AssertionError, 'without duplicate detection the same track is added again');
});
