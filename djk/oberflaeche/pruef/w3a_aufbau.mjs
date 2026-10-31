// Paket 1.13 Warp, Slice 3a: Material für die Zielabnahme (pruef/abnahme_w3a.mjs). Aus den fertigen Dateien von proben/07-werkstatt-zerleger/b_out (AK10): drift_quelle.wav
// (Klick-Track, 120 s, Tempokurve 127,5 → 128,5 BPM ± 0,5) und drift_timemap.txt (255 Zeilen „Quell-Sample Ziel-Sample“; Quell-Sample = Schlag k der Quelle). Daraus eine
// Ablage mit zwei Karten (dieselbe Datei, zwei Katalog-Einträge: Eins bei Karten-Beat 0 sicher, Eins bei 2 unsicher), ein Katalog mit allen Fällen von AK20 und eine
// Mediathek-Datei mit einem Traktor-Raster. Die Quelle wird nur gelesen. Aufruf: node pruef/w3a_aufbau.mjs --ziel /tmp/w3a-ziel [--instanz a]
//   --instanz: löscht die Einträge der erfundenen shas ksha(1..7) im Dekodier-Cache dieser Prüfinstanz (~/.cache/cypherdj-<i>/arr/audio/<sha>.f32). Der Cache ist nach sha
//   geschlüsselt; liegen dort Einträge aus früheren Tests mit denselben ksha, spielt die Abnahme fremdes Material (Task 21 Lauf 1: 7 statt 250 Anschläge). Der Betrieb hat keine Instanz und bleibt unberührt.
//   Ausgabe: JSON {katalog, mediathek, analyse, wav, shas, dauer_s, schlaege_s}
// Danach startet die Hauptinstanz die Prüfinstanz a (Task 21): CYPHERDJ_KATALOG, CYPHERDJ_MEDIATHEK, CYPHERDJ_ANALYSE, CYPHERDJ_PYTHON gesetzt, djk-start --instanz a --arr1; nie den Betrieb.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { schreibeWav } from './w1_wav.mjs';
import { baueKatalog, ksha } from '../tests/hilfen/katalog.mjs';
import { baueMarken, schreibeKarte } from '../tests/hilfen/karte.mjs';

const { values: opt } = parseArgs({ options: { ziel: { type: 'string' }, instanz: { type: 'string' } } });
if (!opt.ziel) { process.stderr.write('Aufruf: node pruef/w3a_aufbau.mjs --ziel <Ordner>\n'); process.exit(2); }
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const B_OUT = path.join(REPO, 'proben', '07-werkstatt-zerleger', 'b_out');
const WAV = path.join(B_OUT, 'drift_quelle.wav'), MAP = path.join(B_OUT, 'drift_timemap.txt');
for (const f of [WAV, MAP]) if (!fs.existsSync(f)) { process.stderr.write(`fehlt: ${f}\n`); process.exit(2); }
fs.mkdirSync(opt.ziel, { recursive: true });
if (opt.instanz !== undefined && !/^[a-i]$/.test(opt.instanz)) { process.stderr.write(`--instanz '${opt.instanz}': ein Buchstabe a bis i\n`); process.exit(2); }
// drift_quelle.wav ist PCM 24 Bit (xxd -l 48: Format 1, 2 Kanäle, 48000 Hz, 24 Bit); leseWav (w1_wav.mjs) kann nur Format 1/16 Bit und Format 3/32 Bit und würde mit
// „Format 1/24 Bit nicht unterstützt“ abbrechen. Gebraucht wird nur die Dauer: aus dem Kopf (fmt- und data-Chunk), die Datei wird nicht dekodiert.
function wavDauer(pfad) {
  const fd = fs.openSync(pfad, 'r'), kopf = Buffer.alloc(4096);
  try {
    fs.readSync(fd, kopf, 0, kopf.length, 0);
    let fmt = null;
    for (let o = 12; o + 8 <= kopf.length;) {
      const id = kopf.toString('latin1', o, o + 4), n = kopf.readUInt32LE(o + 4);
      if (id === 'fmt ') fmt = { kanaele: kopf.readUInt16LE(o + 10), rate: kopf.readUInt32LE(o + 12), bits: kopf.readUInt16LE(o + 22) };
      if (id === 'data' && fmt) return Math.min(n, fs.fstatSync(fd).size - (o + 8)) / (fmt.kanaele * fmt.bits / 8) / fmt.rate;
      o += 8 + n + (n % 2);
    }
  } finally { fs.closeSync(fd); }
  throw new Error(`${pfad}: kein fmt- und data-Chunk im Kopf`);
}
const dauer = wavDauer(WAV);   // 121 s (5 808 000 Frames)
// Fall 8 (Analyse auf Abruf) trägt die ECHTE sha256 der Datei: die Werkstatt legt die Karte unter <sha[:16]>/material.json mit quelle.sha256 = echte sha ab
// (kette.py:239-240), der Server fragt mit der sha des Katalogs. Mit einer erfundenen sha (ksha(8)) käme die Karte nie an.
const echteSha = crypto.createHash('sha256').update(fs.readFileSync(WAV)).digest('hex');
const schlaege = fs.readFileSync(MAP, 'utf8').trim().split('\n').map((z) => Number(z.split(/\s+/)[0]) / 48000);   // Quellsekunden der 255 Schläge
if (schlaege.length !== 255) { process.stderr.write(`drift_timemap.txt hat ${schlaege.length} Zeilen statt 255\n`); process.exit(2); }
const karte = schlaege.map((s, k) => [s, k]);
const analyse = path.join(opt.ziel, 'analyse');
schreibeKarte(analyse, ksha(1), { karte, eins: 0, unsicher: false, dauer_s: dauer });
schreibeKarte(analyse, ksha(2), { karte, eins: 2, unsicher: true, dauer_s: dauer });
// kurze Dateien für die übrigen Fälle von AK20 (3,84 s)
const kurz = path.join(opt.ziel, 'kurz.wav'), ton = new Float32Array(2 * 184320);
for (let i = 0; i < 184320; i++) ton[2 * i] = ton[2 * i + 1] = 0.3 * Math.sin(2 * Math.PI * 440 * i / 48000);
schreibeWav(kurz, ton);
const katalog = baueKatalog(opt.ziel, [
  { n: 1, typ: 'track', werk_id: 1, titel: 'Drift (Eins 0)', bpm: 128, dauer_s: dauer, pfad: WAV },
  { n: 2, typ: 'track', werk_id: 2, titel: 'Drift (Eins 2)', bpm: 128, dauer_s: dauer, pfad: WAV },
  { n: 3, typ: 'track', werk_id: 3, titel: 'Traktor', bpm: 125, dauer_s: 100, pfad: kurz },
  { n: 4, typ: 'loop', bpm: 125, takte: 2, dauer_s: 3.84, pfad: kurz },
  { n: 5, typ: 'track', werk_id: 5, titel: 'Nur BPM', bpm: 125, dauer_s: 30, pfad: kurz },
  { n: 6, typ: 'loop', dauer_s: 3.84, pfad: kurz },
  { n: 7, typ: 'oneshot', instrument: 'kick', dauer_s: 0.5, pfad: kurz },
  { n: 8, typ: 'track', werk_id: 8, titel: 'Lang ohne Karte', bpm: 128, dauer_s: dauer, pfad: WAV, sha: echteSha },   // Analyse auf Abruf: keine Karte in der Ablage
]);
const mediathek = baueMarken(path.join(opt.ziel, 'mediathek.sqlite'), [{ sha: ksha(3), start_s: 0.0575918, bpm: 125 }]);
const shas = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [n, ksha(n)]));
if (opt.instanz) {
  const cache = path.join(process.env.HOME, '.cache', `cypherdj-${opt.instanz}`, 'arr', 'audio');
  for (const n of [1, 2, 3, 4, 5, 6, 7]) fs.rmSync(path.join(cache, `${ksha(n)}.f32`), { force: true });
}
shas[8] = echteSha;
process.stdout.write(`${JSON.stringify({ katalog, mediathek, analyse, wav: WAV, shas, dauer_s: dauer, schlaege_s: schlaege })}\n`);
