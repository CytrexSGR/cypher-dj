# Hardening report: UI server library and browser modules

Date: 2026-11-02. Scope: `djk/oberflaeche/` modules `katalog.ts`, `sammlung.ts`, `suchtext.ts`, `mediathek.ts`,
`welle_cache.ts`. No existing file was changed. New files only:

| File | Purpose |
|---|---|
| `tests/haertung_suchtext.test.mjs` | 13 tests (1 todo bug) |
| `tests/haertung_katalog.test.mjs` | 16 tests (3 todo bugs) |
| `tests/haertung_sammlung.test.mjs` | 19 tests (5 todo bugs) |
| `tests/haertung_mediathek.test.mjs` | 21 tests (2 todo bugs) |
| `tests/haertung_welle_cache.test.mjs` | 16 tests (3 todo bugs) |
| `tests/fixtures/haertung/mutante.mjs` | loads a deliberately broken copy of a module (see "Mutation checks") |
| `tests/fixtures/haertung/mediathek_db.mjs` | builder for a synthetic `mediathek.sqlite` (copy of the test DDL, no import of `server.ts`) |
| `tests/fixtures/haertung/sets/*.json` | synthetic `set.json` files: truncated, empty, `null`, array, BOM, unknown art, prototype art, posten as text, valid with umlauts/emoji |

All data is synthetic: catalogs are built per test with `tests/hilfen/katalog.mjs`, the mediathek with the new builder,
corrupt files are derived from those at run time, and `ffmpeg`/`welle.py` are replaced by small shell scripts written per
test. No real audio, catalog or mediathek data is used.

## Mutation checks ("demonstrably fails against a broken copy")

Each file ends with a test `… mutation check: the checks above reject broken copies of <module>`. It loads a copy of the
real module with exact text replacements (`tests/fixtures/haertung/mutante.mjs`: every replaced text must occur exactly
once, relative imports point to the real neighbour modules, the copy lives in a temp folder) and asserts that the same
check functions the normal tests use throw an `AssertionError` against it. The check therefore runs on every suite run;
if the module is refactored so that a mutation no longer applies, the mutation test fails loudly instead of silently
testing nothing.

| Module | Mutations that the checks reject |
|---|---|
| suchtext.ts | quote doubling removed from `term()`; duplicate detection removed; `Object.hasOwn(SPALTE, feld)` replaced by a plain lookup (`constructor:` becomes a column) |
| katalog.ts | tie-break `k.id` turned to `k.id DESC`; `Object.hasOwn` for sort keys replaced by `in`; ambiguous material id accepted (`>= 1` instead of `=== 1`); LIKE escaping removed from `maske()` |
| sammlung.ts | slug check removed from `datei()` (traversal reaches the parent folder); umlaut transliteration removed; 48-character cap removed; duplicate posten detection removed |
| mediathek.ts | code-point title order instead of `localeCompare('de')`; LIKE escaping removed from `maskiere()`; Traktor list entries not de-duplicated; string handling removed from the progress JSON scanner; first instead of last `)` in `/proc/<pid>/stat` |
| welle_cache.ts | shared run map not filled (12 requests start 12 runs); decoder started even while one runs (overlap); `LOOP_NAME` check removed (`../geheim` reaches a foreign loop) |

In addition, every todo test below was checked the other way round: with the proposed fixes applied to a scratch copy of
the module folder, all 14 todo tests pass (see "Verification of the proposed fixes").

## What the tests cover

- **suchtext.ts**: empty, whitespace-only and control-only input; field prefix without value; dangling quotes; 100 000
  distinct words and a 200 000-character word (time bound); `MAX_TERME` boundary with folder filters; umlauts, ß, Cyrillic,
  CJK, combining marks; upper-case and umlaut field prefixes; duplicates and first-occurrence order; order stability;
  traversal-shaped `folder:` values; prototype names as prefixes; 3000 seeded random inputs (quotes, colons, operators,
  NUL/C0/DEL, emoji, zero-width space) checked by a small parser that every FTS term is one quoted string.
- **katalog.ts**: empty catalog for all types; empty, random, text, header-only and truncated (5 %, 30 %, 60 %, 95 %)
  catalog files; missing schema row; a page overwritten in the middle; a directory at the catalog path; catalog replaced by
  rename between two queries and removed afterwards; 600 equal sort keys paged by 7 in both directions for six sort keys
  (each row once, ties by ascending id); 5000 rows, page beyond the end, a 20 000-character search; umlaut search in NFC
  and NFD, with and without diacritics, any case; lone surrogate; facet values with umlauts, emoji, spaces, tabs, NBSP;
  prototype names as sort keys and facets; traversal-shaped sha, mid and folder values; duplicate 16-character prefixes;
  `%`, `_`, `\` and umlauts in `folder:`; `camelotNachbarn` with Unicode digits, signs and padding.
- **sammlung.ts**: slugs from umlauts, ß, ligatures, roman numerals, traversal and empty names; 2000 seeded random Unicode
  names; NFD names; name length at 80 UTF-16 units; 14 malformed or traversal slugs against every method, with a file-tree
  comparison proving that nothing was created, moved or removed; symlinks, files, hidden and upper-case directories in the
  list folder; corrupt fixtures (listed as `json_kaputt`, every change refused, file bytes unchanged, lock released);
  unknown art; id continuation after the highest id; duplicates per kind; 30 and 1000 equally named lists; 1500 posten and
  a 10 000-character note; moves to ±1e9, NaN, Infinity and fractions; repeated delete in the trash; four processes creating
  60 equally named lists at the same time; `uebersicht` on empty, single, even and 10 000 entries.
- **mediathek.ts**: empty database for every query; missing database (503) and corrupt databases (throws, file unchanged);
  umlauts in titles, artists, genres, packs and the composed title of `quelle()`; `%`, `_`, `\` in track and sound search;
  German title order with ties and missing titles; `ALLE_MAX` boundary (1500 exact, 1501 estimated); 650 material ids across
  the `BLOCK = 300` boundary with invalid, duplicate and ambiguous ids; Traktor lists with positions out of order, duplicate
  and empty entries; ambiguous and traversal-shaped ids for `quelle`, `anschluss`, `pfadVon`; local versus foreign host
  paths; reads while another connection holds an open WAL write transaction; `parseBpm`/`parseLimit` edge input; progress
  lines with braces and escapes in strings, nested and truncated JSON, 500 000-character names, 200 000 `{` and 50 000
  prefixes (time bound); `/proc/<pid>/stat` with `)` and spaces in the command name and a cycle in the children list.
- **welle_cache.ts**: traversal, Unicode and over-long loop names; loop key change with content; malformed fassung ids
  and numbers; corrupt `fassung.json` (empty, truncated, array, string, `{}`, missing `sha256`, missing file); fassung.json
  with traversal in `datei` or `sha256`; `dateiQuelle` with umlauts and emoji in the file name; `zeitlimitVorgabe` for
  missing, zero, negative, NaN and absurd durations; 12 concurrent requests for one key; parallel keys; a failing run with
  three waiters and the retry; one decoder at a time with the newest waiting job only; five requests sharing one decoder;
  abort before start and while waiting (no leftovers); cached files with Unicode names; an empty cached file; start-up cleanup
  with dead and live PIDs, old and new `.neu`, unrelated names and a directory with a matching name.

## Bugs found

Every bug has a test marked `{ todo: 'bug: …' }`, so the suite stays green. Diffs are against the current files and were
verified (see below). Severity is my estimate.

### 1. mediathek.ts — case-insensitive search folds ASCII only (medium)

- Input: title `Über Haus`, `suche({ text: 'über' })`; sound with pack `Übersteuert`, `klaenge({ text: 'über' })` or `'Über'`.
- Expected: the track and the sound are found (ASCII letters already match in any case: `tech` finds `Tech Wolf`).
- Actual: nothing found. `kandidaten()` uses SQLite `LIKE`, `klaenge()` uses SQLite `lower()`; both fold ASCII only.
  In `klaenge()` the query is lower-cased in JS but the data is not, so a word starting with an upper-case umlaut can never
  be found. The same affects `genre`, NFD-stored tags and `KÖLN` versus `Köln`. `katalog.ts` already solved this with a
  `klein()` SQL function (S4 review 2).
- Test: `mediathek hardening: a lower-case umlaut finds an upper-case umlaut (search and sounds)`.
- Note: `klein()` is a JS function per row on a `NOT INDEXED` scan; the 300 ms budget of `suche()` should be re-measured on
  the real mediathek before taking this fix.

### 2. katalog.ts — damage behind the stand table surfaces as a raw SQLite error (low)

- Input: a valid catalog with one 4 KiB page at 30 % overwritten; `seite('track', …)` and `baum('track')`.
- Expected: `KatalogFehler(503, 'katalog_kaputt')`, as for an empty, random or truncated file.
- Actual: `Error: database disk image is malformed` → server answers 500 `katalog_abfrage`.
- Test: `katalog hardening: a catalog with an overwritten page in the middle → 503 katalog_kaputt`.

### 3. katalog.ts — a directory at the catalog path is a raw error (low)

- Input: `CYPHERDJ_KATALOG` (or the default path) is a directory.
- Expected: 503 `katalog_kaputt`. Actual: `oeffne()` only checks `existsSync`; `new DatabaseSync()` throws
  `ERR_SQLITE_ERROR disk I/O error` → 500.
- Test: `katalog hardening: a directory at the catalog path → 503, not a raw SQLite error`.

### 4. katalog.ts — facet whitespace other than U+0020 is not "empty" (low)

- Input: `genre` values `"\t"`, `"\n"`, `" "` and `NULL`.
- Expected (comment above `facetteWert`: "NULL, '' und Leerraum → NULL"): one facet value `''` with n = 4.
- Actual: SQLite `trim(x)` strips spaces only; three extra facet values that render as blanks.
- Test: `katalog hardening: a facet value of only tabs, newlines or no-break spaces is the empty value like "   "`.

### 5. sammlung.ts — a set.json that parses but has the wrong shape crashes changes (medium)

- Input: `set.json` with `"art": "mixtape"` (for example written by a newer version), `"art": "constructor"`, or
  `"posten": "p1,p2"`; then `legeHinzu(slug, 'track', mid)`.
- Expected: a `SammlungFehler` (409 `json_kaputt`), as for a syntactically broken file.
- Actual: `TypeError: Cannot read properties of undefined (reading 'includes')` → 500; `liste()` reports
  `posten: 5` for the posten string (its length).
- Test: `sammlung hardening: a set.json that parses but has an unknown art or no posten array is refused with a SammlungFehler`.

### 6. sammlung.ts — deleting the same slug twice within one millisecond fails (low)

- Input: `lege('Wieder'); loesche('wieder')` repeated quickly (50 times in the test).
- Expected: every copy lands in `.papierkorb`. Actual: the second rename to `.papierkorb/wieder-<same ms>` fails with a raw
  `ENOTEMPTY`; the list stays. Reproduced 111 of 200 times in a loop.
- Test: `sammlung hardening: deleting a recreated list twice within one millisecond keeps both in the trash`.

### 7. sammlung.ts — NFD names lose their umlauts in the slug (low)

- Input: `slugVon('Bär')` (macOS input method, NFD). Expected: `baer` like NFC `Bär`. Actual: `bar`: the ä/ö/ü
  replacement runs before normalisation, NFKD then strips the combining mark.
- Test: `sammlung hardening: a name in NFD (macOS input) gives the same slug as in NFC`.

### 8. sammlung.ts — the 1000th equally named list with a long name fails (low)

- Input: a 48-character name whose slugs `<basis>`, `<44 chars>-2` … `-999` exist; `lege(name)`.
- Expected: a valid slug. Actual: `<44 chars>-1000` has 49 characters, `schreibe()` throws 400 `slug_ungueltig` after the
  directory was created; an empty directory is left behind.
- Test: `sammlung hardening: the 1000th list with the same 48-character name still gets a valid slug`.

### 9. sammlung.ts — a note cut at 200 can split an emoji (low)

- Input: `legeHinzu(slug, 'track', mid, 'a'.repeat(199) + '😀')`. Expected: a well-formed string. Actual: the stored note
  ends in a lone `\ud83d` (`String.slice` counts UTF-16 units).
- Test: `sammlung hardening: a note cut at 200 does not split an emoji into a lone surrogate`.

### 10. welle_cache.ts — absurd durations time out at once (medium)

- Input: `dauerS = 1e8` (a corrupt duration tag; the catalog value goes straight into `dateiQuelle`).
- Expected: a long time limit; the waveform is computed. Actual: `zeitlimitVorgabe(1e8)` = 10 000 030 000 ms, above the
  `setTimeout` maximum (2^31−1 ms); Node clamps it to 1 ms (`TimeoutOverflowWarning`), kills the decoder immediately, answers
  504 and negative-caches the key for 10 minutes. Any `dauerS` above about 21 474 536 s (≈ 248 days) triggers it.
- Test: `welle_cache hardening: an absurd duration (corrupt tag: 1e8 s) gives a long time limit, not an immediate timeout`.

### 11. welle_cache.ts — fassungQuelle trusts fassung.json (low, defence in depth)

- Input: `fassung.json` = `null`; = `{"sha256": "<64 hex>", "datei": "../../../fremd.f32"}`; = `{"sha256": "/../../../../tmp/entwischt"}`.
- Expected: 404 `fassung_fehlt` for all three.
- Actual: `null` → raw `TypeError` (500); the `datei` value is joined unchecked, so the waveform is computed from a file
  outside the version folder; the `sha256` value becomes part of the cache file name, so the cache target
  (`<cache>/fassung-/../../../../tmp/entwischt.welle`) resolves outside the cache folder and `welle.py` would write there.
  The file is written by our own tools, so this matters only for damaged or foreign data. The fix assumes `sha256` is always
  64 lower-case hex characters, as its name says; please confirm against the writer in the workshop before applying.
- Test: `welle_cache hardening: fassung.json cannot point outside the version folder or the cache, and "null" is 404`.

### 12. welle_cache.ts — an empty file in the cache is served forever (low)

- Input: a 0-byte `<key>.welle` in the cache folder (possible after a power cut: `renameSync` without `fsync` on ext4).
- Expected: recomputed. Actual: `hole()` checks only `existsSync`, returns the empty file on every request; the page can
  never draw that waveform until someone deletes the file.
- Test: `welle_cache hardening: an empty file in the cache (crash after rename without fsync) is recalculated, not served forever`.

### 13. suchtext.ts — NFC and NFD spellings count as two terms (low)

- Input: `suchTerme('Über Über')`. Expected: one term. Actual: two; duplicate detection uses `toLowerCase()`
  without NFC, so each spelling uses up the `MAX_TERME` budget (FTS itself already matches both).
- Test: `suchtext hardening: NFC and NFD spellings of the same word count as one term`.

### 14. mediathek.ts — a whitespace-only limit gives one result (low)

- Input: `parseLimit(' ')` (for example `?limit=%20`). Expected: the default 50 like `parseLimit('')`.
  Actual: `Number(' ')` is 0 → clamped to 1.
- Test: `mediathek hardening: a whitespace-only limit falls back to the default like an empty one`.

## Proposed minimal fixes

Not applied (the task forbids changing existing files). One diff per module:

```diff
--- a/djk/oberflaeche/suchtext.ts
+++ b/djk/oberflaeche/suchtext.ts
@@ -24,7 +24,7 @@
   const neu = (t: { spalte: string | null; wert: string }): void => {   // gleiche Terme zählen einmal (S4-Review 3)
-    const k = `${t.spalte ?? ''}\u0001${t.wert.toLowerCase()}`;
+    const k = `${t.spalte ?? ''}\u0001${t.wert.normalize('NFC').toLowerCase()}`;
     if (!gesehen.has(k)) { gesehen.add(k); terme.push(t); }
```

```diff
--- a/djk/oberflaeche/katalog.ts
+++ b/djk/oberflaeche/katalog.ts
@@ -14,7 +14,7 @@
-const facetteWert = (feld: string, pre = ''): string => `nullif(trim(${pre}${feld}), '')`;
+const facetteWert = (feld: string, pre = ''): string => `nullif(trim(${pre}${feld}, ' ' || char(9, 10, 11, 12, 13, 160)), '')`;
@@ -57,6 +57,8 @@
 const SHA = /^[0-9a-f]{64}$/;
+// damage behind the stand table only shows up in a later query
+const kaputt = (e: unknown): boolean => !(e instanceof KatalogFehler) && /malformed|not a database/i.test((e as Error).message);
@@ -68,7 +70,8 @@
     if (!this.vorhanden()) throw new KatalogFehler(503, 'katalog_fehlt');
-    const db = new DatabaseSync(this.pfad, { readOnly: true });
+    let db: DatabaseSync;
+    try { db = new DatabaseSync(this.pfad, { readOnly: true }); } catch { throw new KatalogFehler(503, 'katalog_kaputt'); }
@@ -115,6 +118,7 @@
     } catch (e) {
       // FTS-Syntaxfehler sollte es durch das Quoten nicht geben; falls doch, ist es ein 400 und kein 500
+      if (kaputt(e)) throw new KatalogFehler(503, 'katalog_kaputt');
       if (!(e instanceof KatalogFehler) && f.text && /fts5|unterminated|syntax error|malformed match/i.test((e as Error).message)) throw new KatalogFehler(400, 'suche_ungueltig');
@@ -134,7 +138,7 @@
       return { ordner: ordner.map((o) => ({ pfad: o.pfad, n: o.n })), facetten, gebaut_am: stand.gebaut_am ?? '' };
-    } finally { db.close(); }
+    } catch (e) { if (kaputt(e)) throw new KatalogFehler(503, 'katalog_kaputt'); throw e; } finally { db.close(); }
```

```diff
--- a/djk/oberflaeche/sammlung.ts
+++ b/djk/oberflaeche/sammlung.ts
@@ -28,7 +28,7 @@
 export function slugVon(name: string): string {
-  const s = name.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
+  const s = name.normalize('NFC').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
@@ -91,7 +91,7 @@
-      try { const s = JSON.parse(fs.readFileSync(p, 'utf8')) as Sammlung; aus.push({ slug: d.name, name: String(s.name), art: s.art ?? 'set', posten: s.posten.length }); }
+      try { const s = this.lies(d.name); aus.push({ slug: d.name, name: String(s.name), art: s.art ?? 'set', posten: s.posten.length }); }
@@ -100,7 +100,10 @@
     if (!fs.existsSync(p)) throw new SammlungFehler(404, 'unbekannt');
-    try { return JSON.parse(fs.readFileSync(p, 'utf8')) as Sammlung; } catch { throw new SammlungFehler(409, 'json_kaputt'); }
+    let s: Sammlung;
+    try { s = JSON.parse(fs.readFileSync(p, 'utf8')) as Sammlung; } catch { throw new SammlungFehler(409, 'json_kaputt'); }
+    if (!s || typeof s !== 'object' || !Array.isArray(s.posten) || !Object.hasOwn(ERLAUBT, s.art ?? 'set')) throw new SammlungFehler(409, 'json_kaputt');
+    return s;
@@ -113,7 +116,7 @@
-      slug = `${basis.slice(0, 44)}-${i}`;
+      slug = `${basis.slice(0, Math.min(44, 47 - String(i).length))}-${i}`;
@@ -133,7 +136,7 @@
-      ...(art === 'loop' || art === 'oneshot' ? { quelle: 'mediathek' as const } : {}), ...(notiz ? { notiz: String(notiz).slice(0, 200) } : {}) });
+      ...(art === 'loop' || art === 'oneshot' ? { quelle: 'mediathek' as const } : {}), ...(notiz ? { notiz: String(notiz).slice(0, 200).replace(/[\uD800-\uDBFF]$/, '') } : {}) });
@@ -170,6 +173,8 @@
     fs.mkdirSync(korb, { recursive: true });
-    fs.renameSync(p, path.join(korb, `${slug}-${Date.now()}`));
+    let ziel = path.join(korb, `${slug}-${Date.now()}`);
+    for (let i = 2; fs.existsSync(ziel); i++) ziel = path.join(korb, `${slug}-${Date.now()}-${i}`);
+    fs.renameSync(p, ziel);
```

```diff
--- a/djk/oberflaeche/mediathek.ts
+++ b/djk/oberflaeche/mediathek.ts
@@ -51,7 +51,7 @@
-const wenig = (s: string): string => s.toLowerCase();
+const wenig = (s: string): string => s.normalize('NFC').toLowerCase();
@@ -62,7 +62,7 @@
 export function parseLimit(roh: string | null): number {
-  const n = roh === null || roh === '' ? NaN : Math.floor(Number(roh));
+  const n = roh === null || roh.trim() === '' ? NaN : Math.floor(Number(roh));
@@ -131,7 +131,10 @@
     if (!this.vorhanden()) throw new MediathekFehler(503, 'mediathek_fehlt');
-    return new DatabaseSync(this.pfad, { readOnly: true });
+    const db = new DatabaseSync(this.pfad, { readOnly: true });
+    // SQLite lower() and LIKE fold ASCII only: compare Unicode-folded like katalog.ts klein()
+    db.function('klein', { deterministic: true }, (x) => (x == null ? null : wenig(String(x))));
+    return db;
@@ -241,10 +244,10 @@
-    if (a.text) sets.push(hole(`a.feld IN ('titel','kuenstler','mix') AND a.wert LIKE ? ESCAPE '\\'`, maskiere(a.text)));
+    if (a.text) sets.push(hole(`a.feld IN ('titel','kuenstler','mix') AND klein(a.wert) LIKE ? ESCAPE '\\'`, maskiere(wenig(a.text))));
@@
-    if (a.genre) sets.push(hole(`a.feld = 'genre' AND a.wert LIKE ? ESCAPE '\\'`, maskiere(a.genre)));
+    if (a.genre) sets.push(hole(`a.feld = 'genre' AND klein(a.wert) LIKE ? ESCAPE '\\'`, maskiere(wenig(a.genre))));
@@ -377,12 +380,12 @@ klaenge()
-        const m = maskiere(a.text.toLowerCase());
-        w.push(`(lower(substr(f.pfad, coalesce(length(f.wurzel), 0) + 1)) LIKE ? ESCAPE '\\' OR lower(k.pack) LIKE ? ESCAPE '\\' OR lower(k.kategorie) LIKE ? ESCAPE '\\' OR lower(k.instrument) LIKE ? ESCAPE '\\' OR lower(k.titel) LIKE ? ESCAPE '\\')`);
+        const m = maskiere(wenig(a.text));
+        w.push(`(klein(substr(f.pfad, coalesce(length(f.wurzel), 0) + 1)) LIKE ? ESCAPE '\\' OR klein(k.pack) LIKE ? ESCAPE '\\' OR klein(k.kategorie) LIKE ? ESCAPE '\\' OR klein(k.instrument) LIKE ? ESCAPE '\\' OR klein(k.titel) LIKE ? ESCAPE '\\')`);
@@
-      if (a.pack) { w.push(`lower(k.pack) LIKE ? ESCAPE '\\'`); par.push(maskiere(a.pack.toLowerCase())); }
-      if (a.camelot) { w.push(`lower(k.camelot) = ?`); par.push(a.camelot.toLowerCase()); }
+      if (a.pack) { w.push(`klein(k.pack) LIKE ? ESCAPE '\\'`); par.push(maskiere(wenig(a.pack))); }
+      if (a.camelot) { w.push(`klein(k.camelot) = ?`); par.push(wenig(a.camelot)); }
@@ -391,9 +394,9 @@
-        const m = maskiere(a.text.toLowerCase());
-        cand += ` INTERSECT SELECT inhalt_sha256 FROM (SELECT inhalt_sha256 FROM fundort WHERE host = ? AND lower(substr(pfad, coalesce(length(wurzel), 0) + 1)) LIKE ? ESCAPE '\\'
-          UNION SELECT inhalt_sha256 FROM angabe WHERE ersetzt_durch IS NULL AND feld IN ('pack','kategorie','instrument','titel') AND lower(wert) LIKE ? ESCAPE '\\')`;
+        const m = maskiere(wenig(a.text));
+        cand += ` INTERSECT SELECT inhalt_sha256 FROM (SELECT inhalt_sha256 FROM fundort WHERE host = ? AND klein(substr(pfad, coalesce(length(wurzel), 0) + 1)) LIKE ? ESCAPE '\\'
+          UNION SELECT inhalt_sha256 FROM angabe WHERE ersetzt_durch IS NULL AND feld IN ('pack','kategorie','instrument','titel') AND klein(wert) LIKE ? ESCAPE '\\')`;
```

```diff
--- a/djk/oberflaeche/welle_cache.ts
+++ b/djk/oberflaeche/welle_cache.ts
@@ -26,10 +26,12 @@
   const ordner = path.join(bestand, material, 'fassungen', `${Math.round(basisBpm * 1000)}_r${fassung}`);
-  let j: { datei?: string; sha256?: string };
+  let j: { datei?: unknown; sha256?: unknown } | null;
   try { j = JSON.parse(fs.readFileSync(path.join(ordner, 'fassung.json'), 'utf8')); } catch { throw new WelleFehler(404, 'fassung_fehlt'); }
-  const datei = path.join(ordner, j.datei ?? 'basis.f32');
-  if (!fs.existsSync(datei) || !j.sha256) throw new WelleFehler(404, 'fassung_fehlt');
+  const name = typeof j?.datei === 'string' ? j.datei : 'basis.f32';
+  if (!j || typeof j.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(j.sha256) || name !== path.basename(name)) throw new WelleFehler(404, 'fassung_fehlt');
+  const datei = path.join(ordner, name);
+  if (!fs.existsSync(datei)) throw new WelleFehler(404, 'fassung_fehlt');
   return { datei, schluessel: `fassung-${j.sha256}` };
@@ -50,7 +52,7 @@
-export const zeitlimitVorgabe = (dauerS?: number): number => Math.round((30 + 0.1 * (dauerS && dauerS > 0 ? dauerS : 3600)) * 1000);
+export const zeitlimitVorgabe = (dauerS?: number): number => Math.min(2 ** 31 - 1, Math.round((30 + 0.1 * (dauerS && dauerS > 0 ? dauerS : 3600)) * 1000));
@@ -92,7 +94,7 @@
     const ziel = path.join(this.ordner, `${q.schluessel}.welle`);
-    if (fs.existsSync(ziel)) return ziel;
+    if ((fs.statSync(ziel, { throwIfNoEntry: false })?.size ?? 0) > 0) return ziel;
```

### Verification of the proposed fixes

All diffs above were applied to a scratch copy of `djk/oberflaeche` (outside the repository, sibling folders linked to the
real ones). Result in that copy:

- all 14 todo tests pass (the test runner still lists them as todo, each with ✔);
- the existing tests of the touched modules still pass: `katalog`, `sammlung`, `sammlung_listen`, `suchtext`,
  `mediathek`, `welle`, `vorbereiten_fortschritt` plus all `haertung_*` files: 209 tests, 195 pass, 0 fail, 14 todo
  (all passing);
- the mutation checks still reject their broken copies (the replaced texts are untouched by the fixes).

On the unchanged repository, the same seven existing files give 124 tests, 124 pass.

## Observations (no todo test, for a decision)

- `suchtext.ts`: the token pattern accepts umlauts in field prefixes (`[A-Za-zäöüÄÖÜ]+:`), but no column alias has one, so
  `künstler:Björk` is searched as the literal word `künstler:Björk` (the test documents this). An alias `künstler` next to
  `kuenstler` would match what German users type.
- `katalog.ts`: title and artist sort use `COLLATE NOCASE` (ASCII only), so `Äpfel` sorts after `Zebra` in the browser,
  while `mediathek.ts suche()` sorts German-aware. A filter `ordner` with a trailing slash matches nothing (the tree never
  sends one).
- `sammlung.ts`: after removing the posten with the highest id, the next new posten gets that id again (`p3` removed, next
  add is `p3`). A second browser tab still holding the old `p3` would then move or remove the new posten.
- `mediathek.ts`: a corrupt `mediathek.sqlite` throws a raw SQLite error; `server.ts mediathekFehler()` turns it into
  500 `mediathek_abfrage`, which is acceptable for a foreign database but differs from the 503 `katalog_kaputt` of the catalog.

## Full suite result

Command: `node --test --test-concurrency=1 tests/*.test.mjs` (`npm test`) in `djk/oberflaeche`, Node v22.23.4, cloud
container, 2026-11-02, duration 26 min.

```
# tests 2294
# pass 2212
# fail 26
# cancelled 23
# skipped 19
# todo 14
```

- The new files: 85 tests, 71 pass, 14 todo (the bugs above), 0 fail.
- The 26 failures and 23 cancellations are all in existing files that this branch does not touch (the branch only adds
  files; `git diff --stat` against the base commit shows insertions only): `proj_stems` (25), `loop_import` (11),
  `stroeme_server` (2), `stapel` (2), `proj_render_lautheit` (2), `proj_warp_hand_sitzung` (2), `proj_stems_route`,
  `proj_lautheit_route`, `proj_fix_b4_leistung`, `schutznetz`, `server` (1 each). Causes seen in the output: `rubberband`
  is not installed in the container (`ionice: failed to execute rubberband`), a timing budget missed under load (B4/F6:
  note median 51.7 ms against 50 ms), and process-group and server start tests that need the real machine. A rerun of
  `stroeme_server`, `proj_lautheit_route`, `proj_warp_hand_sitzung` and `schutznetz` alone also fails (5 of 31), so these
  are environment failures, not interference from the new tests. They should be checked on the real host.
