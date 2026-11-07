// Synthetic mediathek database for tests/haertung_mediathek.test.mjs.
// The DDL is a copy of the SCHEMA in tests/hilfen/mediathek.mjs (that module imports server.ts and takes the test-instance
// lock on import, which these pure library tests do not need). No real catalog or audio data: titles, hashes and paths
// are made up per test.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const HOST = os.hostname();
export const sha = (n) => crypto.createHash('sha256').update(`haertung-objekt-${n}`).digest('hex');
export const mid = (n) => sha(n).slice(0, 16);

export const DDL = `
CREATE TABLE werk(werk_id INTEGER PRIMARY KEY, schluessel_art TEXT NOT NULL, schluessel TEXT NOT NULL, UNIQUE(schluessel_art, schluessel));
CREATE TABLE objekt(inhalt_sha256 TEXT PRIMARY KEY, klang_sha256 TEXT, werk_id INTEGER REFERENCES werk, bytes INTEGER,
  dauer_s REAL, format TEXT, samplerate INTEGER, kanaele INTEGER, erstmals_gesehen TEXT);
CREATE TABLE fundort(host TEXT NOT NULL, pfad TEXT NOT NULL, inhalt_sha256 TEXT REFERENCES objekt,
  wurzel TEXT, laufwerk TEXT, groesse INTEGER, mtime REAL, zuletzt_gesehen TEXT, erreichbar INTEGER, PRIMARY KEY(host, pfad));
CREATE INDEX fundort_sha ON fundort(inhalt_sha256);
CREATE TABLE angabe(id INTEGER PRIMARY KEY, inhalt_sha256 TEXT NOT NULL, feld TEXT NOT NULL,
  wert TEXT NOT NULL, quelle TEXT NOT NULL, quelle_ref TEXT, erhoben_am TEXT NOT NULL, ersetzt_durch INTEGER);
CREATE INDEX angabe_akt ON angabe(inhalt_sha256, feld) WHERE ersetzt_durch IS NULL;
CREATE TABLE marke(inhalt_sha256 TEXT, quelle TEXT, art TEXT, nummer INTEGER, start_s REAL, laenge_s REAL, bpm REAL, name TEXT);
CREATE TABLE liste(id INTEGER PRIMARY KEY, quelle TEXT, name TEXT, pfad TEXT);
CREATE TABLE listen_eintrag(liste_id INTEGER, position INTEGER, inhalt_sha256 TEXT);
CREATE TABLE abruf(quelle TEXT, schluessel TEXT, status TEXT, versuche INTEGER DEFAULT 0, naechster_versuch TEXT, letzte_meldung TEXT, PRIMARY KEY(quelle, schluessel));
CREATE TABLE rang(quelle TEXT PRIMARY KEY, rang INTEGER);
CREATE VIEW aktuell AS
  SELECT a.inhalt_sha256, a.feld, a.wert, a.quelle, a.erhoben_am FROM angabe a JOIN rang r ON r.quelle = a.quelle
  WHERE a.ersetzt_durch IS NULL AND a.id = (
    SELECT a2.id FROM angabe a2 JOIN rang r2 ON r2.quelle = a2.quelle
    WHERE a2.inhalt_sha256 = a.inhalt_sha256 AND a2.feld = a.feld AND a2.ersetzt_durch IS NULL
    ORDER BY r2.rang, a2.erhoben_am DESC LIMIT 1);
`;

// Builder: `werke` = [{ n, werk, felder: {titel, ...}, pfad?, host?, wurzel?, dauer? }]; werk null = sound without work.
// Returns the database path and a few helpers. Everything is written in one transaction (thousands of rows stay fast).
export function baueMediathek(dir, objekte = [], { wal = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const datei = path.join(dir, 'mediathek.sqlite');
  const db = new DatabaseSync(datei);
  if (wal) db.exec('PRAGMA journal_mode = WAL');
  db.exec(DDL);
  db.exec('BEGIN');
  for (const [q, r] of [['andreas', 0], ['werkstatt', 1], ['beatport', 2], ['tag_mik', 3], ['tag', 6], ['analyse', 7]]) db.prepare('INSERT INTO rang VALUES (?,?)').run(q, r);
  const werk = db.prepare('INSERT OR IGNORE INTO werk VALUES (?,?,?)');
  const obj = db.prepare('INSERT INTO objekt(inhalt_sha256, werk_id, dauer_s, erstmals_gesehen) VALUES (?,?,?,?)');
  const ang = db.prepare('INSERT INTO angabe(inhalt_sha256, feld, wert, quelle, erhoben_am) VALUES (?,?,?,?,?)');
  const fund = db.prepare('INSERT INTO fundort(host, pfad, inhalt_sha256, wurzel, erreichbar) VALUES (?,?,?,?,1)');
  for (const o of objekte) {
    const s = o.sha ?? sha(o.n);
    if (o.werk != null) werk.run(o.werk, 'test', `w${o.werk}`);
    obj.run(s, o.werk ?? null, o.dauer ?? 100, o.erst ?? '2026-01-01');
    for (const [feld, wert] of Object.entries(o.felder ?? {})) if (wert != null) ang.run(s, feld, String(wert), o.quelle ?? 'tag', o.am ?? '2026-01-01');
    if (o.pfad) fund.run(o.host ?? HOST, o.pfad, s, o.wurzel ?? null);
  }
  db.exec('COMMIT');
  db.close();
  return datei;
}
