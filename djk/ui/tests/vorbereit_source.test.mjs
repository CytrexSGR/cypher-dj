// Deck prepare from the own catalog (Task 17): without a media library database the source file comes from the catalog
// djk-bibliothek built; with one, the media library answers exactly as before. Builder runs as a spawned process in tmp.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Katalog } from '../catalog.ts';
import { Mediathek, MediathekFehler } from '../media_library.ts';
import { vorbereitQuelle } from '../vorbereit_source.ts';
import { saubereUmgebung } from './support/environment.mjs';
import { stapel, post, hole, baueEinleser, warte } from './support/media_library.mjs';

const DJK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PYTHON = process.env.CYPHERDJ_PYTHON || 'python3';
const kannBauen = spawnSync(PYTHON, ['-c', 'import bibliothek.katalog_bau'], { cwd: DJK, env: { ...saubereUmgebung(os.tmpdir()), PYTHONPATH: DJK } }).status === 0;
const SKIP = !kannBauen && 'python has no bibliothek dependencies (set CYPHERDJ_PYTHON)';

function wav(n, frames = 400) {
  const b = Buffer.alloc(44 + frames * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + frames * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) b.writeInt16LE(i === 0 ? n : (n * 37 + i * 11) % 2000 - 1000, 44 + i * 2);
  return b;
}
const BAUE = `
import sys
from pathlib import Path
from bibliothek.konfig import Konfig, Wurzel
from bibliothek.merkmale import MerkmalCache
from bibliothek.katalog_bau import baue
w, ziel, cache = sys.argv[1:4]
baue(Path(ziel), Konfig(1, [Wurzel(Path(w), 'auto')]), MerkmalCache(Path(cache)), False, lambda n: None)
`;
// A catalog of a track, a loop and a one-shot, built by djk-bibliothek into tmp.
function baueWelt(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-vq-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const wurzel = path.join(dir, 'musik');
  for (const [rel, n, frames] of [['Loops/DT_126_Groove.wav', 1, 8000], ['Drums/Kick 01.wav', 3, 400], ['Music/Alpha - Tech Wolf.wav', 5, 8000 * 70], ['Music/Beta - Other.wav', 6, 8000 * 70]]) {
    fs.mkdirSync(path.dirname(path.join(wurzel, rel)), { recursive: true });
    fs.writeFileSync(path.join(wurzel, rel), wav(n, frames));
  }
  const ziel = path.join(dir, 'ziel', 'katalog.sqlite');
  execFileSync(PYTHON, ['-c', BAUE, wurzel, ziel, path.join(dir, 'cache.sqlite')], { cwd: DJK, env: { ...saubereUmgebung(dir), PYTHONPATH: DJK } });
  const k = new Katalog(ziel);
  const z = (typ, text) => k.seite(typ, { text }, typ === 'track' ? 'titel' : 'name', false, 0, 10).zeilen[0];
  return { dir, wurzel, ziel, k, track: z('track', 'Wolf'), loop: z('loop', 'Groove'), kein: new Mediathek(path.join(dir, 'gibt-es-nicht', 'mediathek.sqlite')) };
}
const fehler = (f) => { try { f(); } catch (e) { return e; } assert.fail('no error'); };
const mid = (z) => z.sha.slice(0, 16);
const leer = new Set();

test('no media library: a track gives its path and Artist – Title', { skip: SKIP }, (t) => {
  const w = baueWelt(t);
  const q = vorbereitQuelle(w.kein, w.k, mid(w.track), leer);
  assert.equal(q.pfad, path.join(w.wurzel, 'Music', 'Alpha - Tech Wolf.wav'));
  assert.equal(q.titel, [w.track.kuenstler, w.track.titel].filter(Boolean).join(' – ') || 'Alpha - Tech Wolf');
  assert.ok(q.titel.length > 0);
  assert.equal(q.vorhanden, undefined);
});

test('no media library: invalid mid 400, unknown 404, loop 409', { skip: SKIP }, (t) => {
  const w = baueWelt(t);
  const e = fehler(() => vorbereitQuelle(w.kein, w.k, 'xyz', leer));
  assert.ok(e instanceof MediathekFehler); assert.deepEqual([e.code, e.fehler], [400, 'material_id_ungueltig']);
  const u = fehler(() => vorbereitQuelle(w.kein, w.k, '0123456789abcdef', leer));
  assert.deepEqual([u.code, u.fehler], [404, 'unbekannt']);
  const l = fehler(() => vorbereitQuelle(w.kein, w.k, mid(w.loop), leer));
  assert.deepEqual([l.code, l.fehler], [409, 'kein_track']);
});

test('no media library: file deleted 409 datei_fehlt, unreadable 409 datei_nicht_lesbar', { skip: SKIP }, (t) => {
  const w = baueWelt(t);
  fs.chmodSync(w.track.pfad, 0o000);
  t.after(() => { try { fs.chmodSync(w.track.pfad, 0o644); } catch { /* gone */ } });
  if (process.getuid?.() !== 0) { const n = fehler(() => vorbereitQuelle(w.kein, w.k, mid(w.track), leer)); assert.deepEqual([n.code, n.fehler], [409, 'datei_nicht_lesbar']); }
  fs.rmSync(w.track.pfad);
  const d = fehler(() => vorbereitQuelle(w.kein, w.k, mid(w.track), leer));
  assert.deepEqual([d.code, d.fehler], [409, 'datei_fehlt']);
});

test('no media library: a path outside the catalog roots is refused, also through a symlink; nothing is prepared', { skip: SKIP }, (t) => {
  const w = baueWelt(t);
  const fremd = path.join(w.dir, 'fremd.wav'); fs.writeFileSync(fremd, wav(9, 400));
  const db = new DatabaseSync(w.ziel);
  db.prepare('UPDATE katalog SET pfad = ? WHERE sha = ?').run(fremd, w.track.sha); db.close();
  let e = fehler(() => vorbereitQuelle(w.kein, w.k, mid(w.track), leer));
  assert.deepEqual([e.code, e.fehler], [409, 'datei_ausserhalb']);
  // a link inside the root that points outside
  const link = path.join(w.wurzel, 'Music', 'link.wav'); fs.symlinkSync(fremd, link);
  const db2 = new DatabaseSync(w.ziel); db2.prepare('UPDATE katalog SET pfad = ? WHERE sha = ?').run(link, w.track.sha); db2.close();
  e = fehler(() => vorbereitQuelle(w.kein, w.k, mid(w.track), leer));
  assert.deepEqual([e.code, e.fehler], [409, 'datei_ausserhalb']);
  // a relative path with .. is no root path either
  const db3 = new DatabaseSync(w.ziel); db3.prepare('UPDATE katalog SET pfad = ? WHERE sha = ?').run(path.join(w.wurzel, '..', 'fremd.wav'), w.track.sha); db3.close();
  e = fehler(() => vorbereitQuelle(w.kein, w.k, mid(w.track), leer));
  assert.deepEqual([e.code, e.fehler], [409, 'datei_ausserhalb']);
});

test('no media library: no catalog 503 katalog_fehlt, damaged 503 katalog_kaputt, other schema 503 katalog_schema', { skip: SKIP }, (t) => {
  const w = baueWelt(t);
  const weg = fehler(() => vorbereitQuelle(w.kein, new Katalog(path.join(w.dir, 'nix.sqlite')), mid(w.track), leer));
  assert.ok(weg instanceof MediathekFehler); assert.deepEqual([weg.code, weg.fehler], [503, 'katalog_fehlt']);
  const kaputt = path.join(w.dir, 'kaputt.sqlite'); fs.writeFileSync(kaputt, 'kein sqlite');
  const k = fehler(() => vorbereitQuelle(w.kein, new Katalog(kaputt), mid(w.track), leer));
  assert.deepEqual([k.code, k.fehler], [503, 'katalog_kaputt']);
  const db = new DatabaseSync(w.ziel); db.prepare(`UPDATE stand SET wert = '9' WHERE schluessel = 'schema'`).run(); db.close();
  const s = fehler(() => vorbereitQuelle(w.kein, w.k, mid(w.track), leer));
  assert.deepEqual([s.code, s.fehler], [503, 'katalog_schema']);
});

test('no media library: two rows sharing the prefix 404 material_id_mehrdeutig; a catalog of foreign origin stays mediathek_fehlt', { skip: SKIP }, (t) => {
  const w = baueWelt(t);
  const db = new DatabaseSync(w.ziel);
  const z = db.prepare('SELECT * FROM katalog WHERE sha = ?').get(w.track.sha);
  const cols = Object.keys(z).filter((c) => c !== 'id');
  const neu = { ...z }; neu.sha = w.track.sha.slice(0, 16) + 'f'.repeat(48); neu.pfad = `${z.pfad}.2`;
  db.prepare(`INSERT INTO katalog(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => neu[c]));
  db.close();
  const e = fehler(() => vorbereitQuelle(w.kein, w.k, mid(w.track), leer));
  assert.deepEqual([e.code, e.fehler], [404, 'material_id_mehrdeutig']);
  const db2 = new DatabaseSync(w.ziel); db2.prepare(`UPDATE stand SET wert = 'cypher-mediathek' WHERE schluessel = 'erbauer'`).run(); db2.close();
  const f = fehler(() => vorbereitQuelle(w.kein, w.k, mid(w.loop), leer));
  assert.deepEqual([f.code, f.fehler], [503, 'mediathek_fehlt']);
});

test('media library present: the result is exactly what m.quelle says, the catalog is not asked', () => {
  const SENTINEL = { pfad: '/s', titel: 'S', vorhanden: 'abc' };
  const m = { vorhanden: () => true, quelle: (id, b) => { assert.equal(id, 'wasauchimmer'); assert.ok(b instanceof Set); return SENTINEL; } };
  const k = new Proxy({}, { get() { throw new Error('catalog must not be touched'); } });
  assert.equal(vorbereitQuelle(m, k, 'wasauchimmer', leer), SENTINEL);
  const wirft = { vorhanden: () => true, quelle: () => { throw new MediathekFehler(404, 'unbekannt'); } };
  assert.equal(fehler(() => vorbereitQuelle(wirft, k, 'x', leer)).fehler, 'unbekannt');
});

test('POST /mediathek/vorbereiten without media library starts the reader with --quelle <path from the catalog>', { skip: SKIP }, async (t) => {
  const w = baueWelt(t);
  const e = baueEinleser(w.dir);
  const s = await stapel(t, { mediathek: path.join(w.dir, 'gibt-es-nicht', 'mediathek.sqlite'), katalog: w.ziel, python: e.skript });
  const r = await post(s.url, '/mediathek/vorbereiten', { material_id: mid(w.track) });
  assert.deepEqual(r, { code: 202, j: { material_id: mid(w.track), status: 'laeuft' } });
  for (let i = 0; i < 100 && e.laeufe().length === 0; i++) await warte(50);
  const argv = e.laeufe()[0].split('\n').filter(Boolean);
  assert.deepEqual(argv.slice(0, 3), ['-m', 'werkstatt.single', '--quelle']);
  assert.equal(argv[3], path.join(w.wurzel, 'Music', 'Alpha - Tech Wolf.wav'));
  const l = await post(s.url, '/mediathek/vorbereiten', { material_id: mid(w.loop) });
  assert.deepEqual([l.code, l.j.fehler], [409, 'kein_track']);
  assert.equal((await hole(s.url, '/mediathek/vorbereiten?material_id=0123456789abcdef')).code, 404);
});

const setzeWurzeln = (ziel, wurzeln) => { const db = new DatabaseSync(ziel); db.prepare(`UPDATE stand SET wert = ? WHERE schluessel = 'wurzeln'`).run(JSON.stringify(wurzeln.map((pfad) => ({ pfad, typ: 'auto' })))); db.close(); };

test('no media library: a root that is a symlink (or runs through one) still accepts its files', { skip: SKIP }, (t) => {
  const w = baueWelt(t);
  const link = path.join(w.dir, 'musik-link'); fs.symlinkSync(w.wurzel, link);
  setzeWurzeln(w.ziel, [link]);
  assert.equal(vorbereitQuelle(w.kein, w.k, mid(w.track), leer).pfad, w.track.pfad);
  const ueber = path.join(w.dir, 'ueber'); fs.mkdirSync(ueber); fs.symlinkSync(w.dir, path.join(ueber, 'd'));
  setzeWurzeln(w.ziel, [path.join(ueber, 'd', 'musik')]);
  assert.equal(vorbereitQuelle(w.kein, w.k, mid(w.track), leer).pfad, w.track.pfad);
});

test('no media library: a sibling folder that shares the root name as prefix is outside', { skip: SKIP }, (t) => {
  const w = baueWelt(t);
  const boese = path.join(w.dir, 'musik-evil'); fs.mkdirSync(boese);
  const datei = path.join(boese, 'x.wav'); fs.writeFileSync(datei, wav(8, 400));
  const db = new DatabaseSync(w.ziel); db.prepare('UPDATE katalog SET pfad = ? WHERE sha = ?').run(datei, w.track.sha); db.close();
  const e = fehler(() => vorbereitQuelle(w.kein, w.k, mid(w.track), leer));
  assert.deepEqual([e.code, e.fehler], [409, 'datei_ausserhalb']);
});

test('set queue without media library, with the own catalog: "prepare all" enqueues nothing, no crash, nothing hangs', { skip: SKIP }, async (t) => {
  const w = baueWelt(t);
  const e = baueEinleser(w.dir);
  const sets = fs.mkdtempSync(path.join(w.dir, 'sets-'));
  const s = await stapel(t, { mediathek: path.join(w.dir, 'gibt-es-nicht', 'mediathek.sqlite'), katalog: w.ziel, sammlungen: sets, python: e.skript });
  await post(s.url, '/sammlungen', { name: 'D' });
  const p = await post(s.url, '/sammlungen/d/posten', { art: 'track', material_id: mid(w.track) });
  assert.equal(p.code, 201);
  const ansicht = await hole(s.url, '/sammlungen/d');
  assert.equal(ansicht.code, 200);
  const r = await post(s.url, '/sammlungen/d/vorbereiten', {});
  assert.deepEqual(r, { code: 202, j: { eingereiht: 0 } }, 'a set entry is not offered as prepare without the media library');
  await warte(2500);   // longer than the queue timer
  assert.equal(e.laeufe().length, 0);
  assert.equal((await hole(s.url, '/bestand')).code, 200, 'the server lives');
  // the single prepare route of the same track still works
  assert.equal((await post(s.url, '/mediathek/vorbereiten', { material_id: mid(w.track) })).code, 202);
});
