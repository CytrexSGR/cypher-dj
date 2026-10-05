// Sets (Plan 2026-10-03-sets-mit-tracks): Datei-Ebene ohne Server
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Sammlungen, slugVon, SammlungFehler } from '../sammlung.ts';

const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-sets-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const M1 = '0021a3a9c077b9d5', M2 = '66d2f6fe1cb9e5f3';

test('Sammlung: anlegen → Datei mit Schema, Slug aus Name, zweiter gleicher Name bekommt -2', (t) => {
  const d = tmp(t); const s = new Sammlungen(d);
  assert.equal(slugVon('Back Yard – Größe 1!'), 'back-yard-groesse-1');
  assert.equal(slugVon('Import'), 'import-set');
  assert.equal(s.lege('Back Yard'), 'back-yard');
  assert.equal(s.lege('Back Yard'), 'back-yard-2');
  const j = JSON.parse(fs.readFileSync(path.join(d, 'back-yard', 'set.json'), 'utf8'));
  assert.equal(j.schema, 1); assert.equal(j.name, 'Back Yard'); assert.deepEqual(j.posten, []); assert.equal(j.ablauf, null);
  assert.deepEqual(s.liste().map((x) => x.slug), ['back-yard', 'back-yard-2']);
});

test('Sammlung: Track hinzufügen, gleicher Track nochmal → schon_drin, falsche Eingaben → Fehler', (t) => {
  const s = new Sammlungen(tmp(t)); const slug = s.lege('A');
  assert.deepEqual(s.legeHinzu(slug, 'track', M1), { id: 'p1', schon_drin: false });
  assert.deepEqual(s.legeHinzu(slug, 'track', M2, 'Opener'), { id: 'p2', schon_drin: false });
  assert.deepEqual(s.legeHinzu(slug, 'track', M1), { id: 'p1', schon_drin: true });
  assert.deepEqual(s.lies(slug).posten, [{ id: 'p1', art: 'track', material_id: M1 }, { id: 'p2', art: 'track', material_id: M2, notiz: 'Opener' }]);
  assert.throws(() => s.legeHinzu(slug, 'kit', M1), (e) => e instanceof SammlungFehler && e.fehler === 'art_unbekannt');
  assert.throws(() => s.legeHinzu(slug, 'track', 'xyz'), (e) => e.fehler === 'material_id_ungueltig');
  assert.throws(() => s.lies('gibt-es-nicht'), (e) => e.code === 404);
  assert.throws(() => s.lies('../etc'), (e) => e.fehler === 'slug_ungueltig');
});

test('Sammlung: kaputte set.json wird gelistet, nicht verworfen, Datei bleibt unangetastet', (t) => {
  const d = tmp(t); const s = new Sammlungen(d);
  fs.mkdirSync(path.join(d, 'kaputt')); fs.writeFileSync(path.join(d, 'kaputt', 'set.json'), '{nein');
  assert.deepEqual(s.liste(), [{ slug: 'kaputt', name: 'kaputt', posten: 0, fehler: 'json_kaputt' }]);
  assert.throws(() => s.lies('kaputt'), (e) => e.code === 409 && e.fehler === 'json_kaputt');
  assert.equal(fs.readFileSync(path.join(d, 'kaputt', 'set.json'), 'utf8'), '{nein');
});

import { stapel, hole, post, tmpMt, mid } from './hilfen/mediathek.mjs';
test('Sets-Routen: anlegen, listen, Track hinzufügen, ansehen mit Feldern und Status; fremde Origin → 403', async (t) => {
  const m = tmpMt(t);
  const sets = tmp(t);
  const s = await stapel(t, { mediathek: m.db, sammlungen: sets });
  assert.deepEqual(await post(s.url, '/sammlungen', { name: 'Back Yard' }), { code: 201, j: { slug: 'back-yard' } });
  assert.equal((await post(s.url, '/sammlungen', { name: '' })).j.fehler, 'name_ungueltig');
  assert.deepEqual((await hole(s.url, '/sammlungen')).j, [{ slug: 'back-yard', name: 'Back Yard', posten: 0 }]);
  assert.deepEqual(await post(s.url, '/sammlungen/back-yard/posten', { art: 'track', material_id: mid(5) }), { code: 201, j: { id: 'p1' } });
  assert.equal((await post(s.url, '/sammlungen/back-yard/posten', { art: 'track', material_id: mid(5) })).j.schon_drin, true);
  const g = await hole(s.url, '/sammlungen/back-yard');
  assert.equal(g.code, 200);
  assert.equal(g.j.posten[0].kuenstler, 'Gamma'); assert.equal(g.j.posten[0].bpm, 140); assert.equal(g.j.posten[0].status, 'prepare');
  assert.equal((await hole(s.url, '/sammlungen/nix')).code, 404);
  const fremd = await post(s.url, '/sammlungen', { name: 'X' }, { origin: 'http://evil.example' });
  assert.equal(fremd.code, 403);
});

import { uebersicht } from '../sammlung.ts';
test('uebersicht: Dauer, BPM min/max/median, Keys, Genres, Status gezählt; leere Felder zählen nicht', () => {
  const u = uebersicht([
    { status: 'ready', dauer_s: 300, bpm: 124, camelot: '8A', genre: 'Techno' },
    { status: 'prepare', dauer_s: 200.5, bpm: 130, camelot: '8A', genre: 'Tech House' },
    { status: 'missing', dauer_s: null, bpm: null, camelot: null, genre: null },
  ]);
  assert.deepEqual(u, { tracks: 3, dauer_s: 500.5, bpm: { min: 124, max: 130, median: 127 }, camelot: { '8A': 2 },
    genre: { Techno: 1, 'Tech House': 1 }, status: { ready: 1, prepare: 1, missing: 1 } });
  assert.equal(uebersicht([]).bpm, null);
});
test('Sammlung: entfernen und löschen (Papierkorb, nicht weg)', (t) => {
  const d = tmp(t); const s = new Sammlungen(d); const slug = s.lege('B');
  s.legeHinzu(slug, 'track', M1); s.legeHinzu(slug, 'track', M2);
  s.entferne(slug, 'p1');
  assert.deepEqual(s.lies(slug).posten.map((p) => p.id), ['p2']);
  assert.throws(() => s.entferne(slug, 'p9'), (e) => e.code === 404 && e.fehler === 'posten_unbekannt');
  s.loesche(slug);
  assert.equal(fs.existsSync(path.join(d, slug)), false);
  assert.equal(fs.readdirSync(path.join(d, '.papierkorb')).filter((n) => n.startsWith('b-')).length, 1);
  assert.deepEqual(s.liste(), []);
});
test('Sets-Routen: Übersicht in der Ansicht, entfernen, löschen', async (t) => {
  const m = tmpMt(t); const sets = tmp(t);
  const s = await stapel(t, { mediathek: m.db, sammlungen: sets });
  await post(s.url, '/sammlungen', { name: 'C' });
  await post(s.url, '/sammlungen/c/posten', { art: 'track', material_id: mid(5) });
  await post(s.url, '/sammlungen/c/posten', { art: 'track', material_id: mid(3) });
  const g = await hole(s.url, '/sammlungen/c');
  assert.deepEqual(g.j.uebersicht.status, { prepare: 1, missing: 1 });
  assert.equal(g.j.uebersicht.tracks, 2);
  assert.deepEqual(await post(s.url, '/sammlungen/c/posten/entfernen', { id: 'p2' }), { code: 200, j: { ok: true } });
  assert.deepEqual(await post(s.url, '/sammlungen/c/loeschen', {}), { code: 200, j: { ok: true } });
  assert.equal((await hole(s.url, '/sammlungen/c')).code, 404);
});

import { baueEinleser, warte, sha } from './hilfen/mediathek.mjs';
import { DatabaseSync } from 'node:sqlite';
test('Sets: alles vorbereiten reiht nur prepare-Posten ein, höchstens 2 zugleich, der Rest wartet und läuft nach', async (t) => {
  const m = tmpMt(t); const sets = tmp(t);
  // dritter vorbereitbarer Track: Werk 9 / Objekt 9 mit eigener Datei (nur in diesem Test)
  const neun = path.join(m.daten, 'neun.mp3'); fs.writeFileSync(neun, 'x');
  const db = new DatabaseSync(m.db);
  db.prepare('INSERT INTO werk VALUES (9, ?, ?)').run('test', 'w9');
  db.prepare('INSERT INTO objekt(inhalt_sha256, werk_id, dauer_s, erstmals_gesehen) VALUES (?, 9, 120, ?)').run(sha(9), '2026-01-01');
  db.prepare('INSERT INTO angabe(inhalt_sha256, feld, wert, quelle, erhoben_am) VALUES (?, ?, ?, ?, ?)').run(sha(9), 'typ', 'track', 'tag', '2026-01-01');
  db.prepare('INSERT INTO fundort(host, pfad, inhalt_sha256, erreichbar) VALUES (?, ?, ?, 1)').run(os.hostname(), neun, sha(9));
  db.close();
  const e = baueEinleser(m.dir, { schlaf: 1 });
  const s = await stapel(t, { mediathek: m.db, sammlungen: sets, python: e.skript });
  await post(s.url, '/sammlungen', { name: 'D' });
  for (const n of [5, 2, 3, 9]) await post(s.url, '/sammlungen/d/posten', { art: 'track', material_id: mid(n) });
  // mid(5) prepare, mid(2) prepare (eigene Datei a2 da, nicht im Bestand), mid(3) missing.
  // NICHT mid(1): dessen eigener Fundort fehlt (nur das Geschwister a2 hat eine Datei) → missing.
  assert.deepEqual(await post(s.url, '/sammlungen/d/vorbereiten', {}), { code: 202, j: { eingereiht: 3 } });
  const st = (await hole(s.url, '/sammlungen/d')).j.posten.map((p) => p.status);
  assert.deepEqual([st[0], st[1], st[3]].sort(), ['laeuft', 'laeuft', 'wartet'], JSON.stringify(st));   // zwei laufen, einer wartet
  assert.equal(st[2], 'missing');
  for (let i = 0; i < 80 && e.laeufe().length < 3; i++) await warte(100);   // der Wartende läuft nach (Timer 2 s)
  assert.equal(e.laeufe().length, 3);
});

test('Traktor-Import: nur Traktor-Listen mit Inhalt, Import legt Set in Listen-Reihenfolge ohne Doppel an', async (t) => {
  const m = tmpMt(t); const sets = tmp(t);
  const s = await stapel(t, { mediathek: m.db, sammlungen: sets });
  assert.deepEqual((await hole(s.url, '/mediathek/listen')).j, [{ id: 1, name: 'Back Yard', n: 3 }]);
  assert.deepEqual(await post(s.url, '/sammlungen/import', { liste_id: 1 }), { code: 201, j: { slug: 'back-yard', posten: 2 } });
  assert.deepEqual((await hole(s.url, '/sammlungen/back-yard')).j.posten.map((p) => p.material_id), [mid(5), mid(1)]);
  assert.equal((await post(s.url, '/sammlungen/import', { liste_id: 3 })).code, 404);
});
