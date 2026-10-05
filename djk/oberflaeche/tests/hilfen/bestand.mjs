// Kleiner Bestand für Prüfungen (60m-Nachtrag): index.sqlite wie Werkstatt 15 (§13.4), je Fassung fassung.json und
// basis.f32 (Stereo float32, leise Sinuswelle, keine NaN). kaputt: 'sha' (Prüfsumme falsch), 'kurz' (Datei 8 Bytes zu
// kurz, frames stimmt nicht), 'ohne_audio' (basis.f32 fehlt), 'ohne_json' (fassung.json fehlt), 'json' (unlesbar),
// 'fremd' (fassung.json gehört zu einem anderen Material). stems: true → analyse_quelle = stems, vier Stems unter
// stems/<name>.f32 (§13.1), basis.f32 bleibt daneben. datei / stem_datei: {name: pfad}: Pfad, wie er in fassung.json
// steht (auch bösartig, '../..' oder absolut); die Audiodaten liegen an der Stelle, auf die er relativ zum
// Fassungsordner zeigt, mit passender Größe und sha256, damit nur die Pfadprüfung die Kopie aufhalten kann.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function audio(frames, seed = 1) {
  const f = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) { const v = 0.1 * Math.sin((i * (seed + 1)) / 20); f[2 * i] = v; f[2 * i + 1] = v; }
  return Buffer.from(f.buffer);
}

export function baueBestand(dir, eintraege) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'index.sqlite'));
  db.exec(`CREATE TABLE material(material_id TEXT PRIMARY KEY, titel TEXT, herkunft_art TEXT, erzeugt_am TEXT,
  quelle_bpm REAL, dauer_s REAL, lufs REAL, camelot TEXT, stimmung_cent REAL, tore_ok INTEGER, nur_fuer_andreas INTEGER, pfad TEXT);
  CREATE TABLE fassung(material_id TEXT, basis_bpm REAL, fassung INTEGER, frames INTEGER, stems INTEGER, schuesse INTEGER,
  lufs REAL, tore_ok INTEGER, PRIMARY KEY(material_id, basis_bpm, fassung));`);
  let seed = 0;
  for (const e of eintraege) {
    const frames = e.frames ?? 48000;
    db.prepare('INSERT INTO material VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(e.material_id, e.titel, 'test', null, 124, frames / 48000,
      -14, '8A', 0, 0, 0, '');
    db.prepare('INSERT INTO fassung VALUES (?,?,?,?,?,?,?,?)').run(e.material_id, 128, 1, frames, e.stems ? 1 : 0, 0, -14, 0);
    const ordner = path.join(dir, e.material_id, 'fassungen', '128000_r1');
    fs.mkdirSync(ordner, { recursive: true });
    const a = audio(frames, ++seed);
    const sha = crypto.createHash('sha256').update(a).digest('hex');
    const datei = e.datei ?? 'basis.f32';
    const stems = {};
    for (const n of e.stems ? ['drums', 'bass', 'vocals', 'other'] : []) {
      const sa = audio(frames, 10 * seed + Object.keys(stems).length + 1);
      const rel = e.stem_datei?.[n] ?? `stems/${n}.f32`;
      const ziel = path.resolve(ordner, rel);
      fs.mkdirSync(path.dirname(ziel), { recursive: true });
      fs.writeFileSync(ziel, sa);
      stems[n] = { datei: rel, frames, sha256: crypto.createHash('sha256').update(sa).digest('hex') };
    }
    const fj = { schema: 1, material_id: e.kaputt === 'fremd' ? 'f00000000000ffff' : e.material_id, basis_bpm: 128.0, fassung: 1,
      korrekturen_bis_zeile: 0, datei, frames, sha256: e.kaputt === 'sha' ? '0'.repeat(64) : sha,
      erster_schlag_frame: 0, beats: (frames / 48000) * (128 / 60), erste_eins_quell_beat: 0,
      analyse_quelle: e.stems ? 'stems' : 'basis', stems, schuesse: [], headroom_db: -12, lautheit: { lufs_integriert: -14 } };
    if (e.kaputt !== 'ohne_json') fs.writeFileSync(path.join(ordner, 'fassung.json'), e.kaputt === 'json' ? '{"schema": 1, ' : JSON.stringify(fj, null, 1));
    if (e.kaputt !== 'ohne_audio') {
      const ziel = path.resolve(ordner, datei);
      fs.mkdirSync(path.dirname(ziel), { recursive: true });
      fs.writeFileSync(ziel, e.kaputt === 'kurz' ? a.subarray(0, a.length - 8) : a);
    }
  }
  db.close();
  return dir;
}
