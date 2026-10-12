// Test-Katalog wie cypher-mediathek/mediathek/katalog.py (DDL wörtlich; Vertragstest gegen die echte Datei: Task 4.4)
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const ksha = (n) => crypto.createHash('sha256').update(`katalog-${n}`).digest('hex');
export const DDL = `
CREATE TABLE stand(schluessel TEXT PRIMARY KEY, wert TEXT NOT NULL);
CREATE TABLE katalog(id INTEGER PRIMARY KEY, typ TEXT NOT NULL, werk_id INTEGER, sha TEXT NOT NULL, shas TEXT NOT NULL,
  titel TEXT, kuenstler TEXT, mix TEXT, bpm REAL, camelot TEXT, energie REAL, genre TEXT, pack TEXT, instrument TEXT,
  kategorie TEXT, takte REAL, schutz TEXT, label TEXT, jahr TEXT, release TEXT, katalognummer TEXT, isrc TEXT, remixer TEXT,
  dauer_s REAL, pfad TEXT, ordner TEXT, name TEXT, alle TEXT);
CREATE VIRTUAL TABLE katalog_fts USING fts5(titel, kuenstler, mix, genre, label, pack, instrument, kategorie, jahr, ordner,
  name, release, katalognummer, isrc, remixer, alle, content='katalog', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE INDEX k_sha ON katalog(sha);`;
const SPALTEN = ['typ', 'werk_id', 'sha', 'shas', 'titel', 'kuenstler', 'mix', 'bpm', 'camelot', 'energie', 'genre', 'pack',
  'instrument', 'kategorie', 'takte', 'schutz', 'label', 'jahr', 'release', 'katalognummer', 'isrc', 'remixer',
  'dauer_s', 'pfad', 'ordner', 'name', 'alle'];

// Zeilen: Objekte mit Spaltennamen; fehlende Spalten NULL, sha/shas aus n
export function baueKatalog(dir, zeilen, stand = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const datei = path.join(dir, 'katalog.sqlite');
  const db = new DatabaseSync(datei);
  db.exec(DDL);
  const ins = db.prepare(`INSERT INTO katalog(${SPALTEN.join(',')}) VALUES (${SPALTEN.map(() => '?').join(',')})`);
  for (const z of zeilen) {
    const v = { ...z, sha: z.sha ?? ksha(z.n), shas: z.shas ?? z.sha ?? ksha(z.n) };
    if (v.pfad && v.ordner === undefined) v.ordner = path.dirname(v.pfad);
    if (v.pfad && v.name === undefined) v.name = path.basename(v.pfad, path.extname(v.pfad));
    ins.run(...SPALTEN.map((s) => v[s] ?? null));
  }
  db.exec(`INSERT INTO katalog_fts(katalog_fts) VALUES('rebuild')`);
  for (const [k, w] of Object.entries({ schema: '1', host: os.hostname(), gebaut_am: '2026-10-10T17:00:00+00:00', quelle_mtime: '0', ...stand }))
    db.prepare('INSERT INTO stand VALUES (?, ?)').run(k, w);
  db.close();
  return datei;
}

// Standard-Bestand für die Tests: 3 Tracks, 3 Loops, 4 Samples; Dateien unter dir/daten (manche fehlen absichtlich)
export function standardKatalog(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-katalog-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const d = path.join(dir, 'daten');
  const datei = (rel) => { const p = path.join(d, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); return p; };
  const zeilen = [
    { n: 1, typ: 'track', werk_id: 1, titel: 'Tech Wolf', kuenstler: 'Alpha', bpm: 128, camelot: '8A', energie: 7, genre: 'Techno (Peak Time / Driving)', label: 'Drumcode', release: 'Wolf EP', isrc: 'GBAAA2600001', katalognummer: 'DC300', alle: 'Alpha Alphaville Collective Tech Wolf Drumcode Wolf EP', dauer_s: 305, pfad: datei('Beatport/wolf.mp3') },
    { n: 2, typ: 'track', werk_id: 2, titel: 'House Thing', kuenstler: 'Beta', bpm: 122, camelot: '5B', energie: 5, genre: 'House', dauer_s: 200, pfad: path.join(d, 'Beatport/fehlt.mp3') },
    { n: 3, typ: 'track', werk_id: 3, titel: 'Acid Rain', kuenstler: 'Gamma', bpm: 140, camelot: '9A', energie: 9, genre: 'Hard Techno', dauer_s: 330, pfad: datei('Elektro Techno/acid.mp3') },
    { n: 11, typ: 'loop', bpm: 126, takte: 2, pack: 'Deep Tech', dauer_s: 3.81, pfad: datei('Loops/Deep Tech/DT_126_Groove.wav') },
    { n: 12, typ: 'loop', bpm: 128, takte: 4, pack: 'Vengeance', camelot: '8A', dauer_s: 7.5, pfad: datei('Loops/Vengeance/VEC_128_Bass.wav') },
    { n: 13, typ: 'loop', bpm: null, takte: null, pack: 'Live Pack', schutz: 'ableton', dauer_s: 4, pfad: datei('Ableton/Live Pack/Break.aif') },
    { n: 21, typ: 'oneshot', instrument: 'kick', pack: 'Battery 4', dauer_s: 0.4, pfad: datei('Drums/Kick/Kick 01.wav') },
    { n: 22, typ: 'oneshot', instrument: 'kick', pack: 'Battery 4', dauer_s: 0.6, pfad: datei('Drums/Kick/Kick 02.wav') },
    { n: 23, typ: 'oneshot', instrument: 'snare', pack: 'Maschine 2', dauer_s: 0.3, pfad: datei('Drums/Snare/Snare Tight.wav') },
    { n: 24, typ: 'oneshot', instrument: null, pack: null, dauer_s: 2.2, pfad: datei('FX/Riser.wav') },
  ];
  return { datei: baueKatalog(dir, zeilen), dir, daten: d };
}
