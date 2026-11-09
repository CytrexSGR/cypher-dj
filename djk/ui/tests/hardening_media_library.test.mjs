// Hardening tests for media_library.ts (read-only access to the foreign mediathek.sqlite, sound search, progress parsing).
// Covers what tests/media_library.test.mjs and tests/prepare_progress.test.mjs leave out: an empty and a missing or
// corrupt database, Unicode and umlauts in titles, packs and search text, LIKE characters as text, title ordering with
// umlauts and ties, the ALLE_MAX boundary (exact versus estimated total), the IN-block boundary (BLOCK = 300), duplicate and
// ambiguous material ids, duplicate Traktor list entries, path traversal shaped ids, reads while another connection holds an
// open write transaction (WAL), parseBpm/parseLimit edge input, and progress lines / /proc stat lines with hostile content.
//
// All data is synthetic (tests/fixtures/hardening/media_library_db.mjs).
//
// Mutation check (how "demonstrably fails" was verified): the last test loads broken copies of media_library.ts through
// tests/fixtures/hardening/mutant.mjs (code-point title order instead of localeCompare, LIKE characters not escaped,
// Traktor list entries not de-duplicated, string handling removed from the progress JSON scanner, first instead of last
// ")" in /proc stat lines) and asserts that the check functions used by the normal tests reject them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as echt from '../media_library.ts';
import { baueMediathek, sha, mid, HOST } from './fixtures/hardening/media_library_db.mjs';
import { ladeMutante, tmpDir } from './fixtures/hardening/mutant.mjs';

const fehler = (code, name) => (e) => e instanceof Error && e.code === code && e.fehler === name;
const track = (n, titel, extra = {}) => ({ n, werk: n, ...extra, felder: { typ: 'track', titel, ...(extra.felder ?? {}) } });
const keinVorb = () => null;

// ---- check functions (normal tests and mutation checks) ----
function ordnungsDb(t) {
  return baueMediathek(tmpDir(t), [
    track(1, 'Zebra'), track(2, 'Äpfel'), track(3, 'apfel'), track(4, 'Öl'), track(5, 'Oel'), track(6, 'Apfel'),
    { n: 7, werk: 7, felder: { typ: 'track', kuenstler: 'Ohne Titel' } },
  ]);
}
function pruefeOrdnung(m, datei) {
  const r = new m.Mediathek(datei).suche({}, new Set(), keinVorb);
  // German base collation: no title ('') first, umlauts next to their base letter, equal base → ascending work id
  assert.deepEqual(r.treffer.map((x) => x.werk_id), [7, 2, 3, 6, 5, 4, 1]);
  assert.equal(r.gesamt_genau, true);
}

function maskenDb(t) {
  const d = tmpDir(t);
  const w = path.join(d, 'wurzel_mit_%_');
  return baueMediathek(d, [
    { n: 1, werk: null, felder: { typ: 'oneshot', pack: 'a_b' }, pfad: path.join(w, 'eins.wav'), wurzel: w },
    { n: 2, werk: null, felder: { typ: 'oneshot', pack: 'axb' }, pfad: path.join(w, 'zwei.wav'), wurzel: w },
    { n: 3, werk: null, felder: { typ: 'oneshot', pack: '50%' }, pfad: path.join(w, 'drei.wav'), wurzel: w },
    { n: 4, werk: null, felder: { typ: 'oneshot', pack: '500' }, pfad: path.join(w, 'vier.wav'), wurzel: w },
    { n: 5, werk: null, felder: { typ: 'oneshot', pack: 'back\\slash' }, pfad: path.join(w, 'fuenf.wav'), wurzel: w },
  ]);
}
function pruefeMaske(m, datei) {
  const mt = new m.Mediathek(datei);
  const packs = (text, extra = {}) => mt.klaenge({ text, ...extra }).treffer.map((x) => x.pack).sort();
  assert.deepEqual(packs('_'), ['a_b'], '_ is a character');
  assert.deepEqual(packs('%'), ['50%'], '% is a character');
  assert.deepEqual(packs('\\'), ['back\\slash'], 'backslash is a character');
  assert.deepEqual(packs(''), ['50%', '500', 'a_b', 'axb', 'back\\slash'], 'empty text is no filter');
  assert.deepEqual(mt.klaenge({ pack: '_' }).treffer.map((x) => x.pack), ['a_b']);
}

function listenDb(t) {
  const datei = baueMediathek(tmpDir(t), [track(1, 'Eins'), track(2, 'Zwei'), track(3, 'Drei')]);
  const db = new DatabaseSync(datei);
  db.exec(`INSERT INTO liste VALUES (1,'traktor','Ärger',NULL),(2,'traktor','Leer',NULL),(3,'m3u','Fremd',NULL),(4,'traktor','Alpha',NULL)`);
  const le = db.prepare('INSERT INTO listen_eintrag VALUES (?,?,?)');
  // positions out of insertion order, one track twice, one entry without content
  le.run(1, 3, sha(1)); le.run(1, 1, sha(2)); le.run(1, 2, sha(1)); le.run(1, 4, null); le.run(1, 5, sha(3)); le.run(1, 6, sha(2));
  le.run(2, 1, null); le.run(3, 1, sha(1)); le.run(4, 1, sha(3));
  db.close();
  return datei;
}
function pruefeListen(m, datei) {
  const mt = new m.Mediathek(datei);
  assert.deepEqual(mt.listen().map((l) => [l.id, l.name, l.n]), [[4, 'Alpha', 1], [1, 'Ärger', 5]], 'only Traktor lists with content; n counts entries with content');
  assert.deepEqual(mt.listeMids(1), { name: 'Ärger', mids: [mid(2), mid(1), mid(3)] }, 'by position, each material once, first occurrence wins');
  assert.throws(() => mt.listeMids(3), fehler(404, 'liste_unbekannt'), 'm3u lists are not Traktor lists');
  assert.throws(() => mt.listeMids(99), fehler(404, 'liste_unbekannt'));
}

function stat(pid, comm, ticks) {
  return `${pid} (${comm}) S 1 1 1 0 -1 4194304 0 0 0 0 ${ticks.join(' ')} 20 0 1 0 100 0 0`;
}
function pruefeCpu(m) {
  const ich = process.pid;
  const lies = (p) => {
    if (p === `/proc/${ich}/stat`) return stat(ich, 'node) R 9 9 9 9 9 9 9 9 9 9 9 (evil', [10, 20, 30, 40]);
    if (p === '/proc/999999/stat') return stat(999999, 'kind', [5, 5, 5, 5]);
    if (p.startsWith(`/proc/${ich}/task/`)) return `999999 ${ich} 999999\n`;   // cycle and duplicate
    throw new Error(`ENOENT ${p}`);
  };
  assert.equal(m.cpuTicksBaum(ich, lies), 100 + 20, 'own ticks after the LAST ")", child once, cycle ignored');
  assert.equal(m.cpuTicksBaum(ich, () => 'kaputt'), null, 'unparseable stat → null');
  assert.equal(m.cpuTicksBaum(123456789, () => { throw new Error('weg'); }), null);
}

function pruefeFortschritt(m) {
  const P = '@@fortschritt ';
  const a = m.liesFortschrittsZeichen(`${P}{"stufe":2,"von":5,"name":"Größe } {\\" ä","prozent":12.5,"teil":"a\\\\b"} Rest } mit Klammer`);
  assert.deepEqual(a, [{ stufe: 2, von: 5, name: 'Größe } {" ä', prozent: 12.5, teil: 'a\\b' }]);
  const b = m.liesFortschrittsZeichen(`Müll ${P}{"stufe":1,"von":2,"name":"x"}${P}{"stufe":2,"von":2,"name":"🎵","prozent":"50"}`);
  assert.deepEqual(b.map((x) => [x.stufe, x.name, x.prozent]), [[1, 'x', null], [2, '🎵', null]], 'two messages in one line; prozent must be a number');
}

// ---- empty, missing and corrupt database ----
test('mediathek hardening: an empty database answers every query with empty results', (t) => {
  const mt = new echt.Mediathek(baueMediathek(tmpDir(t), []));
  assert.deepEqual(mt.suche({ text: 'x', camelot: '8A', bpm: [1, 2], genre: 'g' }, new Set(), keinVorb), { treffer: [], gesamt: 0, gesamt_genau: true });
  assert.deepEqual(mt.suche({}, new Set(), keinVorb), { treffer: [], gesamt: 0, gesamt_genau: true });
  assert.deepEqual(mt.klaenge({}), { treffer: [], gesamt: 0 });
  const k = mt.karte();
  assert.deepEqual(k.packs, []);
  for (const v of Object.values(k.je_typ)) assert.deepEqual(v, { gesamt: 0, werkstatt: 0, nur_live: 0 });
  assert.deepEqual(mt.listen(), []);
  assert.deepEqual(mt.angaben([]), []);
  assert.deepEqual(mt.angaben([sha(1)]), []);
  assert.equal(mt.felder([mid(1)], new Set()).size, 0);
  assert.equal(mt.pfadVon(sha(1)), null);
  assert.throws(() => mt.quelle(mid(1), new Set()), fehler(404, 'unbekannt'));
  assert.throws(() => mt.anschluss(mid(1), { fenster: 6, energie: 'gleich', limit: 5 }, new Set(), keinVorb), fehler(404, 'material_unbekannt'));
});

test('mediathek hardening: missing file is 503 for every query; a corrupt file throws instead of returning data', (t) => {
  const d = tmpDir(t);
  const fehlt = new echt.Mediathek(path.join(d, 'nicht-da.sqlite'));
  for (const f of [() => fehlt.suche({}, new Set(), keinVorb), () => fehlt.klaenge({}), () => fehlt.karte(), () => fehlt.listen(), () => fehlt.angaben([sha(1)]),
    () => fehlt.felder([mid(1)], new Set()), () => fehlt.pfadVon(sha(1)), () => fehlt.quelle(mid(1), new Set())]) {
    assert.throws(f, fehler(503, 'mediathek_fehlt'));
  }
  assert.equal(fehlt.stand(), 0, 'stand() of a missing file is 0, no throw');
  // A corrupt file is no MediathekFehler: server.ts mediathekFehler() maps any other error to 500 mediathek_abfrage.
  // What matters here: it throws an Error (no hang, no garbage result), and the file is not modified (read only).
  for (const [name, inhalt] of [['leer', ''], ['text', 'kein sqlite '.repeat(500)], ['halb', fs.readFileSync(baueMediathek(path.join(d, 'g'), [track(1, 'A')])).subarray(0, 3000)]]) {
    const p = path.join(d, `${name}.sqlite`); fs.writeFileSync(p, inhalt);
    const vorher = fs.readFileSync(p);
    assert.throws(() => new echt.Mediathek(p).suche({}, new Set(), keinVorb), Error, name);
    assert.deepEqual(fs.readFileSync(p), vorher, `${name}: untouched`);
  }
});

// ---- Unicode ----
test('mediathek hardening: umlauts in titles and search text match when the case is the same; NFC search finds NFC titles', (t) => {
  const mt = new echt.Mediathek(baueMediathek(tmpDir(t), [
    track(1, 'Über Haus', { felder: { kuenstler: 'Björk', genre: 'Hörspiel' } }), track(2, 'Grüße aus Köln'), track(3, 'Plain'),
  ]));
  const titel = (a) => mt.suche(a, new Set(), keinVorb).treffer.map((x) => x.titel);
  assert.deepEqual(titel({ text: 'Über' }), ['Über Haus']);
  assert.deepEqual(titel({ text: 'ÜBER' }), ['Über Haus'], 'ASCII letters fold, the umlaut is the same');
  assert.deepEqual(titel({ text: 'björk' }), ['Über Haus']);
  assert.deepEqual(titel({ text: 'grüße' }), ['Grüße aus Köln']);
  assert.deepEqual(titel({ text: 'KöLN' }), ['Grüße aus Köln'], 'same-case umlaut, other letters in any case');
  assert.deepEqual(titel({ genre: 'hörspiel' }), ['Über Haus']);
});

test('mediathek hardening: a lower-case umlaut finds an upper-case umlaut (search and sounds)',
  (t) => {
    const d = tmpDir(t);
    const mt = new echt.Mediathek(baueMediathek(d, [
      track(1, 'Über Haus'), track(3, 'Grüße aus Köln'),
      { n: 2, werk: null, felder: { typ: 'oneshot', pack: 'Übersteuert' }, pfad: path.join(d, 'k.wav'), wurzel: d },
    ]));
    assert.deepEqual(mt.suche({ text: 'über' }, new Set(), keinVorb).treffer.map((x) => x.titel), ['Über Haus']);
    assert.deepEqual(mt.suche({ text: 'KÖLN' }, new Set(), keinVorb).treffer.map((x) => x.titel), ['Grüße aus Köln']);
    assert.deepEqual(mt.klaenge({ text: 'über' }).treffer.map((x) => x.pack), ['Übersteuert']);
    assert.deepEqual(mt.klaenge({ text: 'Über' }).treffer.map((x) => x.pack), ['Übersteuert']);
  });

test('mediathek hardening: quelle() builds the title from artist, title and mix with umlauts and emoji intact', (t) => {
  const d = tmpDir(t);
  const datei = path.join(d, 'Jóga ü.flac'); fs.writeFileSync(datei, 'x');
  const mt = new echt.Mediathek(baueMediathek(d, [
    { n: 1, werk: 1, felder: { typ: 'track', titel: 'Jóga 🎵', kuenstler: 'Björk', mix: 'Ümläut Mix' }, pfad: datei },
    { n: 2, werk: 2, felder: { typ: 'track' }, pfad: datei.replace('Jóga', 'Ohne') },
  ]));
  fs.writeFileSync(datei.replace('Jóga', 'Ohne'), 'x');
  assert.deepEqual(mt.quelle(mid(1), new Set()), { pfad: datei, titel: 'Björk – Jóga 🎵 - Ümläut Mix' });
  assert.equal(mt.quelle(mid(2), new Set()).titel, 'Ohne ü', 'no tags: file name without extension');
});

// ---- LIKE characters ----
test('mediathek hardening: %, _ and \\ in sound search and pack filter are characters, not wildcards', (t) => pruefeMaske(echt, maskenDb(t)));

test('mediathek hardening: % and _ in the track search are characters too', (t) => {
  const mt = new echt.Mediathek(baueMediathek(tmpDir(t), [track(1, '100% Pure'), track(2, '1000 Pure'), track(3, 'a_b'), track(4, 'axb')]));
  const titel = (text) => mt.suche({ text }, new Set(), keinVorb).treffer.map((x) => x.titel);
  assert.deepEqual(titel('100%'), ['100% Pure']);
  assert.deepEqual(titel('_'), ['a_b']);
  assert.deepEqual(titel('%'), ['100% Pure']);
});

// ---- order ----
test('mediathek hardening: titles sort in German base order, ties by work id, no title first', (t) => pruefeOrdnung(echt, ordnungsDb(t)));

// ---- huge input and boundaries ----
test('mediathek hardening: ALLE_MAX boundary — 1500 works give an exact total, 1501 an estimated one; limit is respected', (t) => {
  const d = tmpDir(t);
  const viele = (n) => Array.from({ length: n }, (_, i) => track(i + 1, `T${String(n - i).padStart(5, '0')}`));
  const genau = new echt.Mediathek(baueMediathek(path.join(d, 'a'), viele(1500))).suche({ limit: 7 }, new Set(), keinVorb);
  assert.deepEqual([genau.gesamt, genau.gesamt_genau, genau.treffer.length], [1500, true, 7]);
  assert.deepEqual(genau.treffer.map((x) => x.titel), ['T00001', 'T00002', 'T00003', 'T00004', 'T00005', 'T00006', 'T00007'], 'exact: sorted by title');
  const grob = new echt.Mediathek(baueMediathek(path.join(d, 'b'), viele(1501))).suche({ limit: 7 }, new Set(), keinVorb);
  assert.deepEqual([grob.gesamt, grob.gesamt_genau, grob.treffer.length], [1501, false, 7]);
  assert.equal(new echt.Mediathek(baueMediathek(path.join(d, 'c'), viele(3))).suche({ limit: 100000 }, new Set(), keinVorb).treffer.length, 3);
  assert.equal(new echt.Mediathek(baueMediathek(path.join(d, 'e'), viele(3))).suche({ limit: -5 }, new Set(), keinVorb).treffer.length, 1, 'limit clamps to at least 1');
});

test('mediathek hardening: felder() across the IN-block boundary (650 mids), with invalid, duplicate and ambiguous mids', (t) => {
  const p = 'abcdefabcdef0000';
  const objekte = Array.from({ length: 650 }, (_, i) => ({ n: i + 1, werk: null, felder: { typ: 'loop', titel: `L${i + 1} äöü` } }));
  objekte.push({ n: 9001, sha: `${p}${'1'.repeat(48)}`, werk: null, felder: { typ: 'loop', titel: 'erste' } });
  objekte.push({ n: 9002, sha: `${p}${'2'.repeat(48)}`, werk: null, felder: { typ: 'loop', titel: 'zweite' } });
  const mt = new echt.Mediathek(baueMediathek(tmpDir(t), objekte));
  const mids = [...Array.from({ length: 650 }, (_, i) => mid(i + 1)), mid(1), mid(2), 'ABCDEF0000000000', '../../../etc/pa', p, ''];
  const f = mt.felder(mids, new Set());
  assert.equal(f.size, 650, 'every unique valid mid, nothing else');
  assert.equal(f.get(mid(650)).titel, 'L650 äöü');
  assert.equal(f.has(p), false, 'ambiguous prefix: absent');
  assert.equal(f.get(mid(1)).typ, 'loop');
});

// ---- duplicates ----
test('mediathek hardening: Traktor lists — order by position, duplicates once, foreign and empty lists hidden', (t) => pruefeListen(echt, listenDb(t)));

test('mediathek hardening: quelle() with an ambiguous prefix is 404 material_id_mehrdeutig; malformed ids are 400', (t) => {
  const p = '1234567890abcdef';
  const mt = new echt.Mediathek(baueMediathek(tmpDir(t), [
    { n: 1, sha: `${p}${'a'.repeat(48)}`, werk: 1, felder: { typ: 'track', titel: 'A' } },
    { n: 2, sha: `${p}${'b'.repeat(48)}`, werk: 2, felder: { typ: 'track', titel: 'B' } },
  ]));
  assert.throws(() => mt.quelle(p, new Set()), fehler(404, 'material_id_mehrdeutig'));
  for (const s of ['../../etc/passwd', '1234567890ABCDEF', '1234567890abcde', '1234567890abcdef0', '%%%%%%%%%%%%%%%%']) {
    assert.throws(() => mt.quelle(s, new Set()), fehler(400, 'material_id_ungueltig'), JSON.stringify(s));
    assert.throws(() => mt.anschluss(s, { fenster: 6, energie: 'gleich', limit: 5 }, new Set(), keinVorb), fehler(400, 'material_id_ungueltig'));
  }
  for (const s of ['../../../etc/passwd', `${p}${'a'.repeat(48)}/..`, `${p.toUpperCase()}${'A'.repeat(48)}`]) assert.equal(mt.pfadVon(s), null);
});

test('mediathek hardening: pfadVon prefers an existing file, then the first by path; foreign hosts are ignored', (t) => {
  const d = tmpDir(t);
  const da = path.join(d, 'z-da.wav'); fs.writeFileSync(da, 'x');
  const datei = baueMediathek(d, [{ n: 1, werk: null, felder: { typ: 'oneshot' }, pfad: path.join(d, 'a-weg.wav') }]);
  const db = new DatabaseSync(datei);
  db.prepare('INSERT INTO fundort(host, pfad, inhalt_sha256) VALUES (?,?,?)').run(HOST, da, sha(1));
  db.prepare('INSERT INTO fundort(host, pfad, inhalt_sha256) VALUES (?,?,?)').run('fremder-host', path.join(d, '0-fremd.wav'), sha(1));
  db.close();
  fs.writeFileSync(path.join(d, '0-fremd.wav'), 'x');
  assert.equal(new echt.Mediathek(datei).pfadVon(sha(1)), da);
  fs.rmSync(da);
  assert.equal(new echt.Mediathek(datei).pfadVon(sha(1)), path.join(d, 'a-weg.wav'), 'nothing exists: first local path by name');
});

// ---- concurrent access ----
test('mediathek hardening: reads work while another connection holds an open write transaction (WAL), and see the commit afterwards', (t) => {
  const datei = baueMediathek(tmpDir(t), [track(1, 'Alt')], { wal: true });
  const schreiber = new DatabaseSync(datei);
  t.after(() => { try { schreiber.close(); } catch { /* closed */ } });
  schreiber.exec('BEGIN IMMEDIATE');
  schreiber.prepare('INSERT INTO werk VALUES (2, ?, ?)').run('test', 'w2');
  schreiber.prepare('INSERT INTO objekt(inhalt_sha256, werk_id, dauer_s) VALUES (?,?,?)').run(sha(2), 2, 1);
  for (const [f, w] of [['typ', 'track'], ['titel', 'Neu']]) schreiber.prepare('INSERT INTO angabe(inhalt_sha256, feld, wert, quelle, erhoben_am) VALUES (?,?,?,?,?)').run(sha(2), f, w, 'tag', '2026-01-01');
  const mt = new echt.Mediathek(datei);
  assert.deepEqual(mt.suche({}, new Set(), keinVorb).treffer.map((x) => x.titel), ['Alt'], 'uncommitted rows are invisible, no SQLITE_BUSY');
  const s0 = mt.stand();
  schreiber.exec('COMMIT');
  assert.deepEqual(mt.suche({}, new Set(), keinVorb).treffer.map((x) => x.titel), ['Alt', 'Neu'], 'the next query opens afresh and sees the commit');
  assert.ok(mt.stand() >= s0);
});

// ---- parseBpm / parseLimit ----
test('mediathek hardening: parseBpm accepts comma decimals, padding and reversed ranges; rejects signs, exponents and non-ASCII digits', () => {
  assert.deepEqual(echt.parseBpm('128,5'), [128.5, 128.5]);
  assert.deepEqual(echt.parseBpm('  130 - 120.5 '), [120.5, 130]);
  assert.deepEqual(echt.parseBpm('0'), [0, 0]);
  for (const s of ['', ' ', '-5', '+5', '1e3', '120-', '-120', '120--130', '120 130', '١٢٠', '１２０', '120bpm', '12,5,5', 'NaN', 'Infinity', '120\u0000']) {
    assert.throws(() => echt.parseBpm(s), fehler(400, 'bpm_ungueltig'), JSON.stringify(s));
  }
});

test('mediathek hardening: parseLimit falls back for junk and clamps to 1..200', () => {
  const faelle = [[null, 50], ['', 50], ['abc', 50], ['Infinity', 50], ['NaN', 50], ['0', 1], ['-3', 1], ['1', 1], ['12.9', 12], ['200', 200], ['201', 200], ['1e9', 200], ['0x10', 16]];
  for (const [ein, aus] of faelle) assert.equal(echt.parseLimit(ein), aus, JSON.stringify(ein));
});

test('mediathek hardening: a whitespace-only limit falls back to the default like an empty one',
  () => {
    assert.equal(echt.parseLimit(' '), echt.LIMIT_VORGABE);
    assert.equal(echt.parseLimit('\t'), echt.LIMIT_VORGABE);
  });

// ---- progress lines and /proc ----
test('mediathek hardening: progress lines with braces, quotes, escapes and Unicode inside strings are read correctly', () => pruefeFortschritt(echt));

test('mediathek hardening: progress lines — truncated, nested, huge and hostile input never throw', () => {
  const P = '@@fortschritt ';
  assert.deepEqual(echt.liesFortschrittsZeichen(`${P}{"stufe":1,"von":2,"name":"abgeschnitten`), []);
  assert.deepEqual(echt.liesFortschrittsZeichen(`${P}`), []);
  assert.deepEqual(echt.liesFortschrittsZeichen(`${P}null`), []);
  assert.deepEqual(echt.liesFortschrittsZeichen(`${P}{"stufe":1.5,"von":2,"name":"x"}`), [], 'stufe must be an integer');
  assert.deepEqual(echt.liesFortschrittsZeichen(`${P}{"stufe":1,"von":2,"name":{"x":1}}`), [], 'name must be a string');
  assert.deepEqual(echt.liesFortschrittsZeichen(`${P}{"stufe":1,"von":2,"name":"n","x":{"y":{"z":"}"}}}`).length, 1, 'nested objects with } in strings');
  assert.deepEqual(echt.liesFortschrittsZeichen(`${P}{"__proto__":{"stufe":1},"von":1,"name":"p"}`), [], 'prototype keys do not supply stufe');
  const t0 = performance.now();
  assert.deepEqual(echt.liesFortschrittsZeichen(`${P}{"stufe":1,"von":1,"name":"${'ä'.repeat(500_000)}"}`)[0].name.length, 500_000);
  assert.deepEqual(echt.liesFortschrittsZeichen(`${P}${'{'.repeat(200_000)}`), []);
  assert.deepEqual(echt.liesFortschrittsZeichen(P.repeat(50_000)), []);
  assert.ok(performance.now() - t0 < 3000, 'linear, no backtracking blow-up');
});

test('mediathek hardening: cpuTicksBaum parses a command name with ")" and spaces, counts a child once despite a cycle', () => pruefeCpu(echt));

// ---- mutation checks ----
test('mediathek hardening, mutation check: the checks above reject broken copies of media_library.ts', async (t) => {
  const cp = await ladeMutante(t, 'media_library.ts', [["(x.f.titel ?? '').localeCompare(y.f.titel ?? '', 'de', { sensitivity: 'base' })",
    "((x.f.titel ?? '') < (y.f.titel ?? '') ? -1 : (x.f.titel ?? '') > (y.f.titel ?? '') ? 1 : 0)"]]);
  assert.throws(() => pruefeOrdnung(cp, ordnungsDb(t)), assert.AssertionError, 'code-point order puts Äpfel after Zebra');
  const ohneMaske = await ladeMutante(t, 'media_library.ts', [['(c) => `\\\\${c}`', '(c) => c']]);
  assert.throws(() => pruefeMaske(ohneMaske, maskenDb(t)), assert.AssertionError, 'unescaped _ and % are wildcards');
  const ohneSet = await ladeMutante(t, 'media_library.ts', [['[...new Set(z.map((r) => r.inhalt_sha256.slice(0, 16)))]', 'z.map((r) => r.inhalt_sha256.slice(0, 16))']]);
  assert.throws(() => pruefeListen(ohneSet, listenDb(t)), assert.AssertionError, 'duplicates stay in the list');
  const ohneStr = await ladeMutante(t, 'media_library.ts', [[String.raw`if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }`, '']]);
  assert.throws(() => pruefeFortschritt(ohneStr), assert.AssertionError, 'a } inside a string ends the object early');
  const ersteKlammer = await ladeMutante(t, 'media_library.ts', [["st.slice(st.lastIndexOf(')') + 2)", "st.slice(st.indexOf(')') + 2)"]]);
  assert.throws(() => pruefeCpu(ersteKlammer), assert.AssertionError, 'the first ) is inside the command name');
});
