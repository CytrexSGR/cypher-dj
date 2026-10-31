// Paket 1.13 Warp, Slice 3a: Testhelfer für die Quellen des Auto-Warps. Karte im Format der Nachtanalyse (material.json, INTERFACES.md:1202), Marken-Tabelle
// wie cypher-mediathek/mediathek/leser2.py (marke(inhalt_sha256, quelle, art, nummer, start_s, laenge_s, bpm, name)).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// n Schläge, Karten-Beat i·schritt, Quellzeit t0 + i·schritt·60/bpm (schritt 2 = tempo_vielfaches 2)
export function karteLinear(n, { t0 = 0.5, bpm = 120, schritt = 1 } = {}) {
  const dt = 60 / bpm;
  return Array.from({ length: n }, (_, i) => [Math.round((t0 + i * dt * schritt) * 1e6) / 1e6, i * schritt]);
}

// Legt <ablage>/<sha[:16]>/material.json an. quellSha: die sha im Dokument (Gegenprobe-Fehlerfall: eine andere als der Ordner)
export function schreibeKarte(ablage, sha, { karte, eins = 0, unsicher = false, ohneUnsicherFeld = false, dauer_s = 300, schema = 1, quellSha = sha } = {}) {
  const dir = path.join(ablage, sha.slice(0, 16));
  fs.mkdirSync(dir, { recursive: true });
  const raster = { werkzeug: 'beat_this', erste_eins_quell_beat: eins, ...(ohneUnsicherFeld ? {} : { erste_eins_unsicher: unsicher }) };
  fs.writeFileSync(path.join(dir, 'material.json'), JSON.stringify({ schema, material_id: sha.slice(0, 16), titel: 't',
    quelle: { datei: 'original.mp3', sr: 44100, kanaele: 2, dauer_s, sha256: quellSha }, tempo_karte_quelle: karte, raster }));
  return dir;
}

// Legt eine Mediathek-Datei nur mit der Tabelle marke an (der Server liest sonst nichts daraus)
export function baueMarken(datei, zeilen) {
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  const db = new DatabaseSync(datei);
  db.exec('CREATE TABLE marke(inhalt_sha256 TEXT, quelle TEXT, art TEXT, nummer INTEGER, start_s REAL, laenge_s REAL, bpm REAL, name TEXT)');
  const ins = db.prepare('INSERT INTO marke VALUES (?,?,?,?,?,?,?,?)');
  for (const z of zeilen) ins.run(z.sha, z.quelle ?? 'traktor', z.art ?? 'grid', z.nummer ?? 0, z.start_s, z.laenge_s ?? null, z.bpm ?? null, z.name ?? 'AutoGrid');
  db.close();
  return datei;
}

// Slice 3b: ein Material im Bestand des Decks (bestand/<sha[:16]>/): material.json wie die Ablage (schreibeKarte), dazu die Fassungen
// (fassungen/<bpm·1000>_r<n>/fassung.json) und optional Zeilen für korrekturen.jsonl (Objekte, Felder wie INTERFACES.md §13.3)
export function schreibeBestand(bestand, sha, { fassungen = ['128000_r1'], korrekturen = [], ...karteOpt } = {}) {
  const dir = schreibeKarte(bestand, sha, karteOpt);
  for (const f of fassungen) {
    fs.mkdirSync(path.join(dir, 'fassungen', f), { recursive: true });
    fs.writeFileSync(path.join(dir, 'fassungen', f, 'fassung.json'), '{}');
  }
  if (korrekturen.length) {
    const voll = (z) => ({ zeit: '2026-10-09T20:33:30', von: 'andreas', art: 'eins', fassung: '128000_r1', ab_quell_beat: 0, bis_quell_beat: null,
      versatz_ms: null, nr: null, text: 'Test', ...z });
    fs.writeFileSync(path.join(dir, 'korrekturen.jsonl'), korrekturen.map((z) => JSON.stringify(voll(z))).join('\n') + '\n');
  }
  return dir;
}
