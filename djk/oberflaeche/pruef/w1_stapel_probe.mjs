// Paket 1.13 Warp, Slice 1: pruef/abnahme_w1.mjs gegen die Kern-Attrappe (Prüfstapel, Instanz c (CYPHERDJ_PROBE_INSTANZ), kein Ton, kein Kern): prüft nur den Weg Seite → Server →
// Katalog → Wiedergabe → Befehle → proj_warp → Verlauf → Undo. Der Export rendert in der Attrappe ein Prüfsignal (440 Hz, Klicks im festen Raster); die Audio-Punkte Z2 bis Z5 müssen hier FEHL sein
// (das ist der Instrument-Check: die Messung sieht ein ungewarptes Signal als Fehler), Z1, Z6 und NK müssen OK sein. Aufruf: node pruef/w1_stapel_probe.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { starteStapel } from './stapel.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const INSTANZ = process.env.CYPHERDJ_PROBE_INSTANZ ?? 'c';   // Prüfinstanz des Stapels (nie g, h, i); eine laufende Suite auf derselben Instanz sperrt
process.env.CYPHERDJ_TEST_INSTANZ = INSTANZ;
const fix = fs.mkdtempSync(path.join(os.tmpdir(), 'w1-stapel-'));
const aufbau = JSON.parse(execFileSync('node', [path.join(HIER, 'w1_aufbau.mjs'), '--ziel', fix], { encoding: 'utf8' }));
fs.writeFileSync(path.join(fix, 'aufbau.json'), JSON.stringify(aufbau));
const proj = { wurzel: path.join(fix, 'proj'), arbeitsordner: path.join(fix, 'arr') };
const { baueMediathek } = await import('../tests/hilfen/mediathek.mjs');
const mt = baueMediathek(path.join(fix, 'mt'));
const s = await starteStapel(path.join(fix, 'stapel'), INSTANZ, { CYPHERDJ_RENDER: path.join(HIER, '..', 'tests', 'hilfen', 'render_attrappe.mjs') },
  { serverArgs: ['--katalog', aufbau.katalog, '--mediathek', mt.db, '--welle-cache', path.join(fix, 'welle')], proj });
let rc = 1;
try {
  // asynchron: das Zähl-Relais des Stapels läuft in DIESEM Prozess, ein spawnSync hielte es an und der Kern-Attrappe käme nichts zurück
  const r = await new Promise((ok) => {
    const p = spawn('node', [path.join(HIER, 'abnahme_w1.mjs'), '--url', s.url.replace(/\/$/, ''), '--aufbau', path.join(fix, 'aufbau.json'), '--instanz', INSTANZ,
      '--ausgabe', path.join(fix, 'bericht')], { stdio: ['ignore', 'pipe', 'inherit'] });
    let aus = '';
    p.stdout.on('data', (d) => { aus += d; });
    p.once('exit', () => ok({ stdout: aus }));
  });
  process.stdout.write(r.stdout);
  const ok = (k) => new RegExp(`^OK   ${k}\\b`, 'm').test(r.stdout), fehl = (k) => new RegExp(`^FEHL ${k}\\b`, 'm').test(r.stdout);
  const erwartet = ['Z1', 'Z6a', 'Z6b', 'Z6c', 'NK1', 'NK2'].every(ok) && ['Z2', 'Z3', 'Z4', 'Z5'].every(fehl);
  process.stdout.write(`\nAttrappe: Weg ${erwartet ? 'OK (Z1, Z6, NK grün; Z2 bis Z5 rot wegen des Prüfsignals der Attrappe, wie erwartet)' : 'UNERWARTET, Ausgabe oben'}\n`);
  rc = erwartet ? 0 : 1;
} finally {
  await s.stoppe();
  fs.rmSync(fix, { recursive: true, force: true });
}
process.exit(rc);
