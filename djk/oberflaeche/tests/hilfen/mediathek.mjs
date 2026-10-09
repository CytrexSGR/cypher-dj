// Gemeinsame Test-Hilfen für Mediathek und Sets (aus tests/mediathek.test.mjs herausgezogen, Plan sets-mit-tracks 1.1)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Oberflaeche } from '../../server.ts';
import { baueBestand } from './bestand.mjs';
import { schreibeLeerenRing } from './ring.mjs';
export const HIER = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HIER, '..', '..', '..', '..');
export const K = 8000; // Instanz h
export const HOST = os.hostname();
export const warte = (ms) => new Promise((r) => setTimeout(r, ms));
export const sha = (n) => crypto.createHash('sha256').update(`objekt-${n}`).digest('hex');
export const mid = (n) => sha(n).slice(0, 16);

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS werk(werk_id INTEGER PRIMARY KEY, schluessel_art TEXT NOT NULL, schluessel TEXT NOT NULL,
  UNIQUE(schluessel_art, schluessel));
CREATE TABLE IF NOT EXISTS objekt(inhalt_sha256 TEXT PRIMARY KEY, klang_sha256 TEXT, werk_id INTEGER REFERENCES werk, bytes INTEGER,
  dauer_s REAL, format TEXT, samplerate INTEGER, kanaele INTEGER, erstmals_gesehen TEXT);
CREATE TABLE IF NOT EXISTS fundort(host TEXT NOT NULL, pfad TEXT NOT NULL, inhalt_sha256 TEXT REFERENCES objekt,
  wurzel TEXT, laufwerk TEXT, groesse INTEGER, mtime REAL, zuletzt_gesehen TEXT, erreichbar INTEGER,
  PRIMARY KEY(host, pfad));
CREATE INDEX IF NOT EXISTS fundort_sha ON fundort(inhalt_sha256);
CREATE TABLE IF NOT EXISTS angabe(id INTEGER PRIMARY KEY, inhalt_sha256 TEXT NOT NULL, feld TEXT NOT NULL,
  wert TEXT NOT NULL, quelle TEXT NOT NULL, quelle_ref TEXT, erhoben_am TEXT NOT NULL, ersetzt_durch INTEGER);
CREATE INDEX IF NOT EXISTS angabe_akt ON angabe(inhalt_sha256, feld) WHERE ersetzt_durch IS NULL;
CREATE TABLE IF NOT EXISTS marke(inhalt_sha256 TEXT, quelle TEXT, art TEXT, nummer INTEGER, start_s REAL,
  laenge_s REAL, bpm REAL, name TEXT);
CREATE TABLE IF NOT EXISTS liste(id INTEGER PRIMARY KEY, quelle TEXT, name TEXT, pfad TEXT);
CREATE TABLE IF NOT EXISTS listen_eintrag(liste_id INTEGER, position INTEGER, inhalt_sha256 TEXT);
CREATE TABLE IF NOT EXISTS abruf(quelle TEXT, schluessel TEXT, status TEXT, versuche INTEGER DEFAULT 0,
  naechster_versuch TEXT, letzte_meldung TEXT, PRIMARY KEY(quelle, schluessel));
CREATE TABLE IF NOT EXISTS rang(quelle TEXT PRIMARY KEY, rang INTEGER);
CREATE VIEW IF NOT EXISTS aktuell AS
  SELECT a.inhalt_sha256, a.feld, a.wert, a.quelle, a.erhoben_am FROM angabe a JOIN rang r ON r.quelle = a.quelle
  WHERE a.ersetzt_durch IS NULL AND a.id = (
    SELECT a2.id FROM angabe a2 JOIN rang r2 ON r2.quelle = a2.quelle
    WHERE a2.inhalt_sha256 = a.inhalt_sha256 AND a2.feld = a.feld AND a2.ersetzt_durch IS NULL
    ORDER BY r2.rang, a2.erhoben_am DESC LIMIT 1);
`;

// 4 Werke: 1 = zwei Objekte (a1 beatport/Rang 2, a2 andreas/Rang 0; Datei nur bei a2), 2 = House-Track mit fehlender Datei
// (zweiter Fundort auf FREMDEM Host, dessen Pfad existiert), 3 = Loop (typ loop, darf nie erscheinen), 4 = Track mit
// Shell-Zeichen im Titel und vorhandener Datei.
export function baueMediathek(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const daten = path.join(dir, 'musik'); fs.mkdirSync(daten);
  const dateien = { a2: path.join(daten, 'wolf.mp3'), fremd: path.join(daten, 'fremd.mp3'), v4: path.join(daten, 'vier.flac') };
  for (const p of Object.values(dateien)) fs.writeFileSync(p, 'x');
  const db = new DatabaseSync(path.join(dir, 'mediathek.sqlite'));
  db.exec(SCHEMA);
  for (const [q, r] of [['andreas', 0], ['werkstatt', 1], ['beatport', 2], ['tag', 6]]) db.prepare('INSERT INTO rang VALUES (?,?)').run(q, r);
  fs.mkdirSync(path.join(daten, 'Zwerg_live/Core Library/Samples/Multisamples/Grand Piano'), { recursive: true });
  fs.writeFileSync(path.join(daten, 'Zwerg_live/Core Library/Samples/Multisamples/Grand Piano/GrandPiano C3 mf.aif'), 'x');
  for (let w = 1; w <= 4; w++) db.prepare('INSERT INTO werk VALUES (?,?,?)').run(w, 'test', `w${w}`);
  const obj = (n, werk, dauer, erst) => db.prepare('INSERT INTO objekt(inhalt_sha256, werk_id, dauer_s, erstmals_gesehen) VALUES (?,?,?,?)').run(sha(n), werk, dauer, erst);
  obj(1, 1, 301.5, '2026-01-01'); obj(2, 1, 305.0, '2026-02-01'); obj(3, 2, 200.0, '2026-01-01'); obj(4, 3, 4.0, '2026-01-01'); obj(5, 4, 180.0, '2026-01-01');
  let id = 0;
  const ang = (n, feld, wert, quelle, am) => db.prepare('INSERT INTO angabe(id, inhalt_sha256, feld, wert, quelle, erhoben_am) VALUES (?,?,?,?,?,?)').run(++id, sha(n), feld, wert, quelle, am);
  // Werk 1: titel von beatport (Rang 2) am Objekt 1 und von andreas (Rang 0) am Objekt 2 → Rang gewinnt über Objekte
  ang(1, 'typ', 'track', 'tag', '2026-01-01'); ang(2, 'typ', 'track', 'tag', '2026-01-01');
  ang(1, 'titel', 'Techno Wolf', 'beatport', '2026-03-01'); ang(2, 'titel', 'Tech Wolf (Edit)', 'andreas', '2026-01-02');
  ang(1, 'kuenstler', 'Alpha', 'beatport', '2026-03-01');
  ang(1, 'bpm', '126', 'beatport', '2026-03-01'); ang(2, 'bpm', '127.5', 'beatport', '2026-03-05');   // Gleichstand im Rang → jüngstes gewinnt
  ang(1, 'camelot', '8A', 'beatport', '2026-03-01');
  ang(1, 'genre', 'Techno', 'tag', '2026-01-01'); ang(2, 'genre', 'Tech House', 'tag', '2026-05-01');  // Gleichstand → 2026-05
  ang(2, 'mix', 'Extended Mix', 'beatport', '2026-03-01');
  // Werk 2
  ang(3, 'typ', 'track', 'tag', '2026-01-01'); ang(3, 'titel', 'House Thing', 'beatport', '2026-03-01'); ang(3, 'kuenstler', 'Beta', 'beatport', '2026-03-01');
  ang(3, 'bpm', '122', 'beatport', '2026-03-01'); ang(3, 'camelot', '5B', 'beatport', '2026-03-01'); ang(3, 'genre', 'House', 'tag', '2026-01-01');
  // Werk 3: Loop
  ang(4, 'typ', 'loop', 'tag', '2026-01-01'); ang(4, 'titel', 'Tech Loop', 'beatport', '2026-03-01'); ang(4, 'bpm', '126', 'beatport', '2026-03-01');
  // Werk 4
  ang(5, 'typ', 'track', 'tag', '2026-01-01'); ang(5, 'titel', '$(touch PWNED); "x" \'y\'', 'beatport', '2026-03-01'); ang(5, 'kuenstler', 'Gamma', 'beatport', '2026-03-01');
  ang(5, 'bpm', '140', 'beatport', '2026-03-01'); ang(5, 'camelot', '1A', 'beatport', '2026-03-01');
  // Klänge (Plan klaenge T1): 11 = oneshot Ableton-geschützt, 12 = oneshot offen mit Datei, 13 = impuls, 14 = loop; ohne Werk
  obj(11, null, 1.5, '2026-01-01'); obj(12, null, 2.0, '2026-01-01'); obj(13, null, 0.8, '2026-01-01'); obj(14, null, 7.5, '2026-01-01');
  const wz = path.join(daten, 'Zwerg_live');   // Wurzel mit Suchwort ('live', '_') im Präfix: die Textsuche darf es nicht treffen
  const kp = { 11: path.join(wz, 'Packs/Upright/Samples/Piano C3.aif'), 12: path.join(wz, 'Core Library/Samples/Multisamples/Grand Piano/GrandPiano C3 mf.aif'),
    13: path.join(wz, 'Core Library/Convolution Reverb/IRs/Plate.aif'), 14: path.join(wz, 'loops/dark-pad-01.wav') };
  ang(11, 'typ', 'oneshot', 'tag', '2026-01-01'); ang(11, 'pack', 'Upright', 'tag', '2026-01-01'); ang(11, 'kategorie', 'Samples', 'tag', '2026-01-01'); ang(11, 'schutz', 'ableton', 'tag', '2026-01-01');
  ang(12, 'typ', 'oneshot', 'tag', '2026-01-01'); ang(12, 'pack', 'Multisamples', 'tag', '2026-01-01'); ang(12, 'kategorie', 'Grand Piano', 'tag', '2026-01-01'); ang(12, 'instrument', 'piano', 'tag', '2026-01-01');
  ang(13, 'typ', 'impuls', 'tag', '2026-01-01'); ang(13, 'pack', 'Convolution Reverb', 'tag', '2026-01-01');
  ang(14, 'typ', 'loop', 'tag', '2026-01-01'); ang(14, 'bpm', '128', 'tag', '2026-01-01'); ang(14, 'camelot', '8A', 'tag', '2026-01-01'); ang(14, 'titel', 'Dark Pad 01', 'tag', '2026-01-01');
  const fund = (n, host, pfad) => db.prepare('INSERT INTO fundort(host, pfad, inhalt_sha256, erreichbar) VALUES (?,?,?,1)').run(host, pfad, sha(n));
  fund(1, HOST, path.join(daten, 'gibt-es-nicht-a1.mp3')); fund(2, HOST, dateien.a2);
  fund(3, HOST, path.join(daten, 'gibt-es-nicht-w2.mp3')); fund(3, 'anderer-host', dateien.fremd);
  fund(5, HOST, dateien.v4);
  for (const n of [11, 12, 13, 14]) { fund(n, HOST, kp[n]); db.prepare('UPDATE fundort SET wurzel = ? WHERE pfad = ?').run(wz, kp[n]); }
  // 15 = Klang NUR auf fremdem Host: darf in /klaenge und in der Karte nicht vorkommen
  obj(15, null, 1.0, '2026-01-01'); ang(15, 'typ', 'oneshot', 'tag', '2026-01-01'); ang(15, 'pack', 'Fremdpack', 'tag', '2026-01-01'); fund(15, 'anderer-host', '/zz/Fremdklang.wav');
  fund(11, 'anderer-host', '/zz/Piano C3 Kopie.aif');
  db.exec(`INSERT INTO liste VALUES (1,'traktor','Back Yard',NULL),(2,'traktor','_LOOPS',NULL),(3,'m3u','Mixed',NULL)`);
  const le = db.prepare('INSERT INTO listen_eintrag VALUES (?,?,?)');
  le.run(1, 1, sha(5)); le.run(1, 2, sha(1)); le.run(1, 3, sha(5)); le.run(3, 1, sha(3));
  db.close();
  return { dir, db: path.join(dir, 'mediathek.sqlite'), dateien, daten };
}

// Attrappen-Einleser: protokolliert seine Argumente (eins je Zeile, Trenner ---) und gibt die JSON-Zeile aus
export function baueEinleser(dir, { schlaf = 0, ausgabe = '{"status":"neu","material_id":"x"}', rc = 0 } = {}) {
  const log = path.join(dir, 'einleser.log'), skript = path.join(dir, 'python-attrappe.sh');
  fs.writeFileSync(skript, `#!/bin/sh\nprintf '%s\\n' "$@" >> '${log}'\nprintf -- '---\\n' >> '${log}'\n${schlaf ? `sleep ${schlaf}\n` : ''}echo 'rauschen vor der Zeile'\necho '${ausgabe}'\nexit ${rc}\n`, { mode: 0o755 });
  return { skript, log, laeufe: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('---\n').filter(Boolean) : []) };
}

export async function stapel(t, { mediathek, python, bestand, einleserModul, sammlungen, loops } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-mt-'));
  const ab = path.join(fs.mkdtempSync('/dev/shm/djk-mt-test-'), 'material');
  fs.mkdirSync(ab, { recursive: true });
  const att = spawn(process.execPath, [path.join(REPO, 'djk/vertrag/attrappe_kern.mjs'), '--frisch', '--arbeitsbestand', ab,
    '--zustand', path.join(tmp, 'zustand.json')], { env: { ...process.env, CYPHERDJ_INSTANZ: 'h' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, f) => { att.stdout.once('data', ok); att.once('exit', (c) => f(new Error(`attrappe rc ${c}`))); });
  const huellen = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'djk-huellen-')), 'huellen'); schreibeLeerenRing(path.dirname(huellen) + '/huellen');
  const tmpd = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `djk-${n}-`));
  const bestandDir = bestand ?? baueBestand(path.join(tmp, 'bestand'), []);
  const log = [];
  const o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand: bestandDir, arbeitsbestand: ab,
    kernPruefmodus: true, loops: loops ?? tmpd('loops'), kits: tmpd('kits'), welleCache: tmpd('welle'), musterOrdner: tmpd('muster'), hotcueOrdner: tmpd('hc'),
    rasterOrdner: tmpd('raster'), huellen, wirtOrdner: tmpd('wirt'), mediathek, python, einleserModul, sammlungen, log: (z) => log.push(z) });
  await o.starte();
  for (let i = 0; i < 100 && o.kern.zustand !== 'verbunden'; i++) await warte(20);
  assert.equal(o.kern.zustand, 'verbunden');
  t.after(async () => { await o.stoppe(); const zu = new Promise((r) => att.once('exit', r)); att.kill('SIGTERM'); await zu; fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(path.dirname(ab), { recursive: true, force: true }); });
  return { o, log, url: `http://127.0.0.1:${47300 + K}`, bestandDir };
}

export const hole = (url, pfad) => fetch(url + pfad).then(async (r) => ({ code: r.status, j: await r.json() }));
export const post = (url, pfad, daten, kopf = {}) => fetch(url + pfad, { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(daten) })
  .then(async (r) => ({ code: r.status, j: await r.json() }));
export const ids = (r) => r.j.treffer.map((x) => x.werk_id);
export const tmpMt = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-mtdb-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return baueMediathek(d); };
