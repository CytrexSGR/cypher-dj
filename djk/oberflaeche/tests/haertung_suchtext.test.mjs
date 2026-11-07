// Hardening tests for suchtext.ts (search text → FTS5 expression + folder filter).
// Covers what tests/suchtext.test.mjs leaves out: empty and huge inputs, Unicode and umlauts, duplicate terms, the
// MAX_TERME boundary, prototype keys as field prefixes, path-like folder values, order stability, and a property check that
// the FTS expression never carries syntax from the input.
//
// Mutation check (how "demonstrably fails" was verified): the last tests of this file load broken copies of suchtext.ts
// through tests/fixtures/haertung/mutante.mjs (quote doubling removed, duplicate detection removed, Object.hasOwn replaced
// by a plain property lookup) and assert that the same check functions used above reject them. They are part of the suite,
// so the verification is repeated on every run.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as echt from '../suchtext.ts';
import { ladeMutante } from './fixtures/haertung/mutante.mjs';

// One FTS term as parseSuche writes it: optional `spalte : `, then a quoted string with doubled quotes, then `*`.
const TERM = /^(?:[a-z_]+ : )?"(?:[^"]|"")*"\*$/;
function fluchtSicher(fts) {
  if (fts === null) return;
  // split on ' AND ' only outside quoted strings
  const teile = []; let akt = '', inStr = false;
  for (let i = 0; i < fts.length; i++) {
    const c = fts[i];
    if (c === '"') inStr = !inStr;
    if (!inStr && fts.startsWith(' AND ', i)) { teile.push(akt); akt = ''; i += 4; continue; }
    akt += c;
  }
  teile.push(akt);
  assert.equal(inStr, false, `unbalanced quotes in ${JSON.stringify(fts)}`);
  for (const t of teile) assert.match(t, TERM, `term ${JSON.stringify(t)} of ${JSON.stringify(fts)} is not a single quoted FTS string`);
}

// deterministic pseudo random generator (no flaky property tests)
function zufall(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const ALPHABET = ['a', 'Z', 'ä', 'Ü', 'ß', 'é', '日', 'я', '7', '"', '"', ':', '*', '(', ')', '^', '-', '+', ' ', ' ', '\t', '\u0000', '\u001f', '\u007f',
  'AND', 'OR', 'NOT', 'NEAR', 'titel:', 'artist:', 'folder:', 'ordner:', '{', '}', '\\', "'", '%', '_', '\u0308', '😀', '\u200b'];
const zufallsText = (r, n) => Array.from({ length: n }, () => ALPHABET[Math.floor(r() * ALPHABET.length)]).join('');

// ---- checks shared by the normal tests and the mutation checks ----
function pruefeFlucht(m) {
  const r = zufall(42);
  for (let i = 0; i < 3000; i++) fluchtSicher(m.parseSuche(zufallsText(r, 1 + Math.floor(r() * 30))).fts);
  fluchtSicher(m.parseSuche('a"b "c""d" titel:"x""y" ""').fts);
}
function pruefeDoppelte(m) {
  const s = m.parseSuche(Array(5000).fill('Techno').join(' '));
  assert.equal(s.fts, '"Techno"*');
  assert.equal(s.zuviele, false, '5000 copies of one word are one term, not over the cap');
  const g = m.suchTerme('acid ACID Acid aCiD');
  assert.deepEqual(g.terme, [{ spalte: null, wert: 'acid' }], 'case variants count once, the first spelling wins');
}
function pruefePrototyp(m) {
  for (const feld of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    const s = m.parseSuche(`${feld}:x`);
    assert.equal(s.fts, `"${feld}:x"*`, `${feld}: is no column, the whole token stays one word`);
  }
}

// ---- empty and degenerate input ----
test('suchtext hardening: empty, whitespace-only and control-only input gives no FTS and no folder filter', () => {
  for (const leer of ['', ' ', '\t\n\r', '\u0000\u0001\u007f\u009f', '""', '"   "', 'titel:""', 'folder:""', '-- ** ::', '😀 🎵', '\u200b']) {
    const s = echt.parseSuche(leer);
    assert.deepEqual(s, { fts: null, ordner: [], zuviele: false }, `input ${JSON.stringify(leer)}`);
  }
});

test('suchtext hardening: a field prefix without value is a plain word, a dangling quote is text', () => {
  assert.equal(echt.parseSuche('titel:').fts, '"titel:"*');
  assert.equal(echt.parseSuche('"abc').fts, '"""abc"*', 'opening quote without end: the quote is a character');
  assert.equal(echt.parseSuche('abc"').fts, '"abc"""*');
});

// ---- huge input ----
test('suchtext hardening: huge input stays fast and is capped (100 000 distinct words, one 200 000-character word)', () => {
  const t0 = performance.now();
  const viele = echt.parseSuche(Array.from({ length: 100_000 }, (_, i) => `w${i}`).join(' '));
  assert.equal(viele.zuviele, true);
  const lang = 'x'.repeat(200_000);
  const eins = echt.parseSuche(lang);
  assert.equal(eins.fts, `"${lang}"*`);
  assert.equal(eins.zuviele, false);
  const ms = performance.now() - t0;
  assert.ok(ms < 3000, `took ${ms.toFixed(0)} ms`);
});

test('suchtext hardening: MAX_TERME boundary counts terms and folder filters together', () => {
  const w = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  assert.equal(echt.MAX_TERME, 12);
  assert.equal(echt.parseSuche(w(12)).zuviele, false);
  assert.equal(echt.parseSuche(w(13)).zuviele, true);
  assert.equal(echt.parseSuche(`${w(11)} folder:a`).zuviele, false);
  assert.equal(echt.parseSuche(`${w(11)} folder:a ordner:b`).zuviele, true);
  assert.equal(echt.parseSuche(`${w(12)} folder:a folder:a`).zuviele, true, 'a repeated folder counts once, but 12 + 1 is over');
  assert.equal(echt.parseSuche(`${w(11)} folder:a folder:a`).zuviele, false);
});

// ---- Unicode ----
test('suchtext hardening: umlauts, ß, Cyrillic and CJK stay intact; uppercase and umlaut field prefixes', () => {
  assert.equal(echt.parseSuche('Größe Straße').fts, '"Größe"* AND "Straße"*');
  assert.equal(echt.parseSuche('Москва 東京').fts, '"Москва"* AND "東京"*');
  assert.equal(echt.parseSuche('TITEL:"Über Alles" Genre:Hip-Hop').fts, 'titel : "Über Alles"* AND genre : "Hip-Hop"*');
  // the token pattern accepts umlauts in prefixes, but no column name has one: künstler: is an unknown prefix (a word)
  assert.deepEqual(echt.suchTerme('künstler:Björk').terme, [{ spalte: null, wert: 'künstler:Björk' }]);
  // a combining mark alone has no letter: dropped; attached to a letter it stays part of the word
  assert.equal(echt.parseSuche('\u0308').fts, null);
  assert.equal(echt.parseSuche('u\u0308ber').fts, '"u\u0308ber"*');
});

test('suchtext hardening: NFC and NFD spellings of the same word count as one term',
  () => {
    const s = echt.suchTerme('\u00dcber U\u0308ber');
    assert.equal(s.terme.length, 1);
  });

// ---- duplicates and order ----
test('suchtext hardening: duplicates count once, first occurrence and input order are kept', () => pruefeDoppelte(echt));

test('suchtext hardening: order of terms and folders follows the input; same input gives the same output', () => {
  const ein = 'zeta artist:Alpha folder:/b mix:dub alpha folder:/a zeta';
  const a = echt.parseSuche(ein), b = echt.parseSuche(ein);
  assert.deepEqual(a, b);
  assert.equal(a.fts, '"zeta"* AND kuenstler : "Alpha"* AND mix : "dub"* AND "alpha"*');
  assert.deepEqual(a.ordner, ['/b', '/a']);
  assert.equal(echt.suchTerme('a artist:a').terme.length, 2, 'same word in another column is another term');
});

// ---- path-like folder values (no file system access, only a LIKE filter) ----
test('suchtext hardening: path traversal in folder: is kept verbatim as a filter string, never a term', () => {
  const s = echt.parseSuche('folder:../../etc ordner:"/x/../y z" folder:C:\\Windows');
  assert.equal(s.fts, null);
  assert.deepEqual(s.ordner, ['../../etc', '/x/../y z', 'C:\\Windows']);
});

// ---- prototype keys ----
test('suchtext hardening: Object prototype names are no columns (constructor:, toString: …)', () => pruefePrototyp(echt));

test('suchtext hardening: zusatz field names of the caller only apply to suchTerme, prototype names stay words there too', () => {
  assert.deepEqual(echt.suchTerme('rolle:bass constructor:x', ['rolle']).terme, [{ spalte: 'rolle', wert: 'bass' }, { spalte: null, wert: 'constructor:x' }]);
});

// ---- property: the FTS expression never carries syntax from the input ----
test('suchtext hardening: 3000 random inputs (quotes, colons, operators, control characters) give only quoted terms', () => pruefeFlucht(echt));

// ---- mutation checks ----
test('suchtext hardening, mutation check: the checks above reject broken copies of suchtext.ts', async (t) => {
  const ohneFlucht = await ladeMutante(t, 'suchtext.ts', [['w.replace(/"/g, \'""\')', 'w']]);
  assert.throws(() => pruefeFlucht(ohneFlucht), assert.AssertionError, 'without quote doubling the FTS string breaks out');
  const ohneDoppel = await ladeMutante(t, 'suchtext.ts', [['if (!gesehen.has(k)) { gesehen.add(k); terme.push(t); }', 'terme.push(t);']]);
  assert.throws(() => pruefeDoppelte(ohneDoppel), assert.AssertionError, 'without duplicate detection 5000 copies exceed the cap');
  const ohneHasOwn = await ladeMutante(t, 'suchtext.ts', [['Object.hasOwn(SPALTE, feld) ? SPALTE[feld]', 'SPALTE[feld] ? SPALTE[feld]']]);
  assert.throws(() => pruefePrototyp(ohneHasOwn), assert.AssertionError, 'a plain lookup takes constructor: as a column');
});
