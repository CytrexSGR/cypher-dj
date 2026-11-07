// Hardening tests for katalog.ts (read-only browser catalog, katalog.sqlite).
// Covers what tests/katalog.test.mjs leaves out: an empty catalog, a large catalog with many equal sort keys (paging must
// return every row exactly once, in a stable order), Unicode and umlauts in text, folder and facet filters, prototype names
// as sort keys and facets, path-traversal shaped inputs, ambiguous material ids (duplicate 16-character prefixes), a catalog
// replaced by rename between two queries, and empty, random, truncated and partly overwritten catalog files.
//
// All catalog data is synthetic (built per test with tests/hilfen/katalog.mjs). Corrupt files are derived from such a
// synthetic catalog at run time.
//
// Mutation check (how "demonstrably fails" was verified): the last test loads broken copies of katalog.ts through
// tests/fixtures/haertung/mutante.mjs (no id tie-break in ORDER BY, `in` instead of Object.hasOwn for sort keys, ambiguous
// mid accepted, LIKE characters not escaped) and asserts that the check functions used by the normal tests reject them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as echt from '../katalog.ts';
import { baueKatalog, ksha } from './hilfen/katalog.mjs';
import { ladeMutante, tmpDir } from './fixtures/haertung/mutante.mjs';

const fehler = (code, name) => (e) => e instanceof Error && e.code === code && e.fehler === name;
const istKatalogFehler = (e) => e?.constructor?.name === 'KatalogFehler' && typeof e.code === 'number';

// ---- check functions (normal tests and mutation checks) ----

// 600 rows with the same title and no BPM, inserted in an order that differs from the expected tie order: every sort,
// both directions, paged with an odd page size, must return each id exactly once and equal keys by ascending id.
function stabilerKatalog(t) {
  const d = tmpDir(t);
  const zeilen = [];
  for (let i = 0; i < 600; i++) zeilen.push({ n: i, typ: 'track', titel: i % 3 === 0 ? 'Same' : 'same', kuenstler: 'X', genre: i % 2 ? 'A' : 'B', energie: i % 2 ? 5 : 9 });
  return baueKatalog(d, zeilen);
}
function pruefeStabil(m, datei) {
  const k = new m.Katalog(datei);
  for (const sort of ['titel', 'bpm', 'genre', 'kuenstler', 'energie', 'camelot']) {
    for (const ab of [false, true]) {
      const alle = [];
      for (let s = 0; ; s++) {
        const r = k.seite('track', {}, sort, ab, s, 7);
        assert.equal(r.gesamt, 600);
        if (r.zeilen.length === 0) break;
        alle.push(...r.zeilen);
      }
      const ids = alle.map((z) => z.id);
      assert.equal(new Set(ids).size, 600, `sort ${sort} ${ab ? 'desc' : 'asc'}: every row exactly once over all pages`);
      // within one key value, ids ascend (the documented tie-break `k.id`)
      for (let i = 1; i < alle.length; i++) {
        const schl = (z) => JSON.stringify([String(z[sort === 'dauer' ? 'dauer_s' : sort] ?? '').toLowerCase()]);
        if (schl(alle[i]) === schl(alle[i - 1])) assert.ok(alle[i].id > alle[i - 1].id, `sort ${sort} ${ab ? 'desc' : 'asc'}: tie at index ${i} not by ascending id`);
      }
    }
  }
}

function pruefeSortPrototyp(m, datei) {
  const k = new m.Katalog(datei);
  for (const sort of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    assert.throws(() => k.seite('track', {}, sort, false, 0, 10), fehler(400, 'sort_ungueltig'), `sort=${sort}`);
  }
}

function mehrdeutigerKatalog(t) {
  const d = tmpDir(t);
  const p = 'abcdef0123456789';
  return { p, datei: baueKatalog(d, [
    { n: 1, typ: 'loop', sha: `${p}${'1'.repeat(48)}`, name: 'erste' },
    { n: 2, typ: 'loop', sha: `${p}${'2'.repeat(48)}`, name: 'zweite' },
    // track whose sibling objects share one 16-character prefix: also ambiguous
    { n: 3, typ: 'track', titel: 'T3', sha: ksha(3), shas: `${ksha(3)} fedcba9876543210${'a'.repeat(48)}` },
    { n: 4, typ: 'track', titel: 'T4', sha: ksha(4), shas: `${ksha(4)} fedcba9876543210${'b'.repeat(48)}` },
    { n: 5, typ: 'oneshot', name: 'eindeutig', sha: `0123456789abcdef${'c'.repeat(48)}` },
  ]) };
}
function pruefeMehrdeutig(m, { p, datei }) {
  const k = new m.Katalog(datei);
  assert.equal(k.eintragMid(p), null, 'two objects share the material id prefix: ambiguous → null');
  assert.equal(k.eintragVonMid(p), null);
  assert.equal(k.eintragVonMid('fedcba9876543210'), null, 'two tracks list an object with this prefix: ambiguous → null');
  assert.equal(k.eintragMid('0123456789abcdef').name, 'eindeutig');
  assert.equal(k.eintragVonMid('0123456789abcdef').name, 'eindeutig');
  assert.equal(k.eintrag(`${p}${'2'.repeat(48)}`).name, 'zweite', 'the full sha is never ambiguous');
}

function maskenKatalog(t) {
  const d = tmpDir(t);
  return baueKatalog(d, [
    { n: 1, typ: 'loop', pfad: '/m/50%/a.wav' }, { n: 2, typ: 'loop', pfad: '/m/500/b.wav' },
    { n: 3, typ: 'loop', pfad: '/m/a_b/c.wav' }, { n: 4, typ: 'loop', pfad: '/m/axb/d.wav' },
    { n: 5, typ: 'loop', pfad: '/m/back\\slash/e.wav' }, { n: 6, typ: 'loop', pfad: '/m/backXslash/f.wav' },
    { n: 7, typ: 'loop', pfad: '/m/Ärger_Ü/g.wav' }, { n: 8, typ: 'loop', pfad: '/m/ärgerxü/h.wav' },
  ]);
}
function pruefeMaske(m, datei) {
  const k = new m.Katalog(datei);
  const namen = (text) => k.seite('loop', { text }, 'name', false, 0, 50).zeilen.map((z) => z.name).sort();
  assert.deepEqual(namen('folder:50%'), ['a'], '% is a character, not a wildcard');
  assert.deepEqual(namen('folder:a_b'), ['c'], '_ is a character, not a wildcard');
  assert.deepEqual(namen('folder:"back\\slash"'), ['e'], 'backslash is a character');
  assert.deepEqual(namen('folder:ärger_ü'), ['g'], 'Unicode case folding plus a literal _');
}

// ---- empty catalog ----
test('katalog hardening: an empty catalog gives empty pages, an empty tree and null lookups, never an error', (t) => {
  const k = new echt.Katalog(baueKatalog(tmpDir(t), []));
  for (const typ of echt.KATALOG_TYPEN) {
    const r = k.seite(typ, {}, echt.SORT_VORGABE[typ], false, 0, 100);
    assert.deepEqual([r.zeilen, r.gesamt], [[], 0]);
    const b = k.baum(typ);
    assert.deepEqual(b.ordner, []);
    for (const f of echt.FACETTEN[typ]) assert.deepEqual(b.facetten[f], []);
  }
  assert.equal(k.seite('track', { text: 'irgendwas folder:x' }, 'titel', false, 0, 10).gesamt, 0);
  assert.equal(k.eintrag('0'.repeat(64)), null);
  assert.equal(k.eintragMid('0'.repeat(16)), null);
  assert.equal(k.eintragVonMid('0'.repeat(16)), null);
});

// ---- corrupt files ----
test('katalog hardening: empty, random, truncated catalog and one without stand rows → 503, never a raw SQLite error', (t) => {
  const d = tmpDir(t);
  const gut = baueKatalog(path.join(d, 'gut'), Array.from({ length: 2000 }, (_, i) => ({ n: i, typ: 'track', titel: `T${i} ${'y'.repeat(200)}` })));
  const roh = fs.readFileSync(gut);
  const datei = (name, inhalt) => { const p = path.join(d, name); fs.writeFileSync(p, inhalt); return p; };
  const faelle = {
    leer: datei('leer.sqlite', ''),
    zufall: datei('zufall.sqlite', Buffer.from(Array.from({ length: 8192 }, (_, i) => (i * 7919) % 251))),
    text: datei('text.sqlite', 'SQLite format 3\u0000 but then nothing useful\n'.repeat(50)),
    kopf: datei('kopf.sqlite', roh.subarray(0, 100)),
  };
  for (const anteil of [0.05, 0.3, 0.6, 0.95]) faelle[`gekuerzt_${anteil}`] = datei(`gekuerzt_${anteil}.sqlite`, roh.subarray(0, Math.floor(roh.length * anteil)));
  for (const [name, p] of Object.entries(faelle)) {
    const k = new echt.Katalog(p);
    assert.throws(() => k.seite('track', {}, 'titel', false, 0, 5), fehler(503, 'katalog_kaputt'), `${name}: seite`);
    assert.throws(() => k.baum('track'), fehler(503, 'katalog_kaputt'), `${name}: baum`);
    assert.throws(() => k.eintrag(ksha(1)), fehler(503, 'katalog_kaputt'), `${name}: eintrag`);
  }
  // stand table present but without schema row → schema error, not a crash
  const ohneSchema = baueKatalog(path.join(d, 'ohne'), [{ n: 1, typ: 'track', titel: 'A' }], { schema: '' });
  assert.throws(() => new echt.Katalog(ohneSchema).seite('track', {}, 'titel', false, 0, 5), fehler(503, 'katalog_schema'));
});

test('katalog hardening: a catalog with an overwritten page in the middle → 503 katalog_kaputt',
  (t) => {
    const d = tmpDir(t);
    const gut = baueKatalog(d, Array.from({ length: 3000 }, (_, i) => ({ n: i, typ: 'track', titel: `T${i} ${'y'.repeat(300)}` })));
    const b = fs.readFileSync(gut);
    const o = Math.floor((b.length * 0.3) / 4096) * 4096;
    b.fill(0xab, o, o + 4096);
    const p = path.join(d, 'kaputt.sqlite'); fs.writeFileSync(p, b);
    const k = new echt.Katalog(p);
    assert.throws(() => k.seite('track', {}, 'titel', false, 0, 5), (e) => istKatalogFehler(e) && e.code === 503);
    assert.throws(() => k.baum('track'), (e) => istKatalogFehler(e) && e.code === 503);
  });

test('katalog hardening: a directory at the catalog path → 503, not a raw SQLite error',
  (t) => {
    const d = tmpDir(t);
    const p = path.join(d, 'katalog.sqlite'); fs.mkdirSync(p);
    assert.throws(() => new echt.Katalog(p).seite('track', {}, 'titel', false, 0, 5), (e) => istKatalogFehler(e) && e.code === 503);
  });

// ---- replaced while in use ----
test('katalog hardening: a catalog replaced by rename between two queries is read fresh (open per query)', (t) => {
  const d = tmpDir(t);
  const p = baueKatalog(path.join(d, 'a'), [{ n: 1, typ: 'track', titel: 'Alt' }]);
  const neu = baueKatalog(path.join(d, 'b'), [{ n: 2, typ: 'track', titel: 'Neu' }, { n: 3, typ: 'track', titel: 'Neuer' }], { gebaut_am: '2026-11-01T00:00:00+00:00' });
  const k = new echt.Katalog(p);
  assert.deepEqual(k.seite('track', {}, 'titel', false, 0, 10).zeilen.map((z) => z.titel), ['Alt']);
  fs.renameSync(neu, p);
  const r = k.seite('track', {}, 'titel', false, 0, 10);
  assert.deepEqual(r.zeilen.map((z) => z.titel), ['Neu', 'Neuer']);
  assert.equal(r.gebaut_am, '2026-11-01T00:00:00+00:00');
  fs.rmSync(p);
  assert.throws(() => k.seite('track', {}, 'titel', false, 0, 10), fehler(503, 'katalog_fehlt'), 'removed between queries: 503, no stale handle');
});

// ---- large catalog, order stability ----
test('katalog hardening: 600 equal keys, paged by 7 in both directions: every row once, ties by ascending id', (t) => pruefeStabil(echt, stabilerKatalog(t)));

test('katalog hardening: 5000 rows, page beyond the end, limit 1, and a 20 000-character search stay correct', (t) => {
  const d = tmpDir(t);
  const k = new echt.Katalog(baueKatalog(d, Array.from({ length: 5000 }, (_, i) => ({ n: i, typ: 'loop', bpm: 100 + (i % 50), pfad: `/m/p${i % 10}/l${String(i).padStart(4, '0')}.wav` }))));
  assert.equal(k.seite('loop', {}, 'name', false, 4999, 1).zeilen[0].name, 'l4999');
  assert.deepEqual(k.seite('loop', {}, 'name', false, 50, 100).zeilen, []);
  assert.equal(k.seite('loop', { ordner: '/m/p3' }, 'name', false, 0, 1).gesamt, 500);
  assert.equal(k.seite('loop', { bpm: [149, 149] }, 'name', false, 0, 1).gesamt, 100);
  const t0 = performance.now();
  assert.equal(k.seite('loop', { text: 'l'.repeat(20_000) }, 'name', false, 0, 10).gesamt, 0);
  assert.ok(performance.now() - t0 < 5000);
  assert.equal(k.baum('loop').ordner.length, 10);
});

// ---- Unicode ----
test('katalog hardening: umlauts in text search match with and without diacritics, any case, NFC or NFD', (t) => {
  const d = tmpDir(t);
  const k = new echt.Katalog(baueKatalog(d, [
    { n: 1, typ: 'track', titel: 'Über Alles', kuenstler: 'Björk' },
    { n: 2, typ: 'track', titel: 'Übermut', kuenstler: 'Ärzte' },        // NFD in the catalog
    { n: 3, typ: 'track', titel: 'Straße', kuenstler: 'Ğ' },
    { n: 4, typ: 'track', titel: 'Other', kuenstler: 'Nobody' },
  ]));
  const titel = (text) => k.seite('track', { text }, 'titel', false, 0, 10).zeilen.map((z) => z.titel.normalize('NFC')).sort();
  for (const q of ['über', 'Über', 'ÜBER', 'uber', 'über']) assert.deepEqual(titel(q), ['Über Alles', 'Übermut'], `query ${JSON.stringify(q)}`);
  assert.deepEqual(titel('artist:bjork'), ['Über Alles']);
  assert.deepEqual(titel('artist:ÄRZTE'), ['Übermut']);
  assert.deepEqual(titel('straße'), ['Straße']);
  // a lone surrogate never reaches SQLite as broken UTF-8 syntax: no error, it acts as a separator ("a" prefix: Alles, Ärzte)
  assert.deepEqual(titel('a\ud800'), ['Über Alles', 'Übermut']);
});

test('katalog hardening: facet values with umlauts, emoji and whitespace variants are one exact value each', (t) => {
  const d = tmpDir(t);
  const k = new echt.Katalog(baueKatalog(d, [
    { n: 1, typ: 'track', genre: 'Hörspiel' }, { n: 2, typ: 'track', genre: ' Hörspiel ' }, { n: 3, typ: 'track', genre: 'hörspiel' },
    { n: 4, typ: 'track', genre: '🎵 Ambient' }, { n: 5, typ: 'track', genre: '   ' },
  ]));
  const b = k.baum('track');
  assert.deepEqual(b.facetten.genre, [{ wert: 'Hörspiel', n: 2 }, { wert: '', n: 1 }, { wert: 'hörspiel', n: 1 }, { wert: '🎵 Ambient', n: 1 }]);
  for (const { wert, n } of b.facetten.genre) assert.equal(k.seite('track', { facette: { feld: 'genre', wert } }, 'titel', false, 0, 10).gesamt, n, `tree count and filter agree for ${JSON.stringify(wert)}`);
});

test('katalog hardening: a facet value of only tabs, newlines or no-break spaces is the empty value like "   "',
  (t) => {
    const k = new echt.Katalog(baueKatalog(tmpDir(t), [
      { n: 1, typ: 'track', genre: '\t' }, { n: 2, typ: 'track', genre: '\n' }, { n: 3, typ: 'track', genre: '\u00a0' }, { n: 4, typ: 'track', genre: null },
    ]));
    assert.deepEqual(k.baum('track').facetten.genre, [{ wert: '', n: 4 }]);
    assert.equal(k.seite('track', { facette: { feld: 'genre', wert: '' } }, 'titel', false, 0, 10).gesamt, 4);
  });

// ---- prototype names and path-shaped inputs ----
test('katalog hardening: Object prototype names are neither sort keys nor facets', (t) => {
  const datei = baueKatalog(tmpDir(t), [{ n: 1, typ: 'track', titel: 'A' }]);
  pruefeSortPrototyp(echt, datei);
  const k = new echt.Katalog(datei);
  for (const feld of ['constructor', '__proto__', 'toString', 'genre; DROP TABLE katalog']) {
    assert.throws(() => k.seite('track', { facette: { feld, wert: 'x' } }, 'titel', false, 0, 10), fehler(400, 'facette_ungueltig'), `facet ${feld}`);
  }
});

test('katalog hardening: path traversal shaped sha, mid and folder inputs are rejected or match nothing', (t) => {
  const d = tmpDir(t);
  const k = new echt.Katalog(baueKatalog(d, [{ n: 1, typ: 'loop', pfad: '/m/Loops/a.wav' }, { n: 2, typ: 'loop', pfad: '/m/Other/b.wav' }]));
  for (const s of ['../../../etc/passwd', `${'a'.repeat(63)}/`, `${'A'.repeat(64)}`, `${'a'.repeat(64)}\u0000`, '']) {
    assert.throws(() => k.eintrag(s), fehler(400, 'sha_ungueltig'), JSON.stringify(s));
  }
  for (const s of ['../../etc/passw', 'ABCDEF0123456789', '%%%%%%%%%%%%%%%%', '________________']) {
    assert.equal(k.eintragMid(s), null);
    assert.throws(() => k.eintragVonMid(s), fehler(400, 'mid_ungueltig'));
  }
  const n = (ordner) => k.seite('loop', { ordner }, 'name', false, 0, 10).gesamt;
  assert.equal(n('/m/Loops/../Other'), 0, 'no path normalisation: the string is compared, not resolved');
  assert.equal(n('/m/Loops/..'), 0);
  assert.equal(n('/m'), 2);
  assert.equal(n('/m/'), 0, 'a trailing slash is a different folder string (the tree never sends one)');
  assert.equal(n('%'), 0, 'the folder filter is a prefix compare, not LIKE');
});

// ---- duplicates ----
test('katalog hardening: duplicate material id prefixes are ambiguous (null), full shas are not', (t) => pruefeMehrdeutig(echt, mehrdeutigerKatalog(t)));

test('katalog hardening: LIKE characters and umlauts in folder: text are literal and Unicode folded', (t) => pruefeMaske(echt, maskenKatalog(t)));

test('katalog hardening: camelotNachbarn rejects Unicode digits, signs and padding variants', () => {
  for (const k of ['١٢A', '１A', '+1A', '-1A', '1.0A', ' 1 A', '1AB', '', '0B', '13A']) {
    assert.throws(() => echt.camelotNachbarn(k), fehler(400, 'camelot_ungueltig'), JSON.stringify(k));
  }
  assert.deepEqual(echt.camelotNachbarn(' 01a '), ['1A', '12A', '2A', '1B'], 'leading zero and lower case are accepted and normalised');
});

// ---- mutation checks ----
test('katalog hardening, mutation check: the checks above reject broken copies of katalog.ts', async (t) => {
  const stabil = stabilerKatalog(t);
  const ohneId = await ladeMutante(t, 'katalog.ts', [["${ab ? 'DESC' : 'ASC'} NULLS LAST, k.id LIMIT", "${ab ? 'DESC' : 'ASC'} NULLS LAST, k.id DESC LIMIT"]]);
  assert.throws(() => pruefeStabil(ohneId, stabil), assert.AssertionError, 'ties by descending id break the documented order');
  const proto = await ladeMutante(t, 'katalog.ts', [['Object.hasOwn(SORTIERUNG[typ], sort) ?', '(sort in SORTIERUNG[typ]) ?']]);
  assert.throws(() => pruefeSortPrototyp(proto, stabil), assert.AssertionError, '`in` sees constructor and lets SQL fail with a raw error');
  const mehr = await ladeMutante(t, 'katalog.ts', [['return z.length === 1 ? { ...z[0] } : null; }', 'return z.length >= 1 ? { ...z[0] } : null; }']]);
  assert.throws(() => pruefeMehrdeutig(mehr, mehrdeutigerKatalog(t)), assert.AssertionError, 'an ambiguous prefix must not pick one object');
  const ohneMaske = await ladeMutante(t, 'katalog.ts', [[".replace(/[\\\\%_]/g, '\\\\$&')", '']]);
  assert.throws(() => pruefeMaske(ohneMaske, maskenKatalog(t)), assert.AssertionError, 'unescaped % and _ are wildcards');
});
