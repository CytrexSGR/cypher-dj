// Plan 2026-09-27 Task 8: der Prozess meldet den Strom an (/erz/strom kit:t), folgt /uhr und schickt je Takt die
// nächsten zwei Takte; eine neue Musterdatei wirkt am nächsten Takt; nach /e/neustart meldet er den Strom neu an.
import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { kodiere, dekodiere } from '../../vertrag/attrappe_kern/osc.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

test('Strom anmelden, zwei Takte voraus, Musterwechsel, Neustart', { timeout: 20000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'erz-'));
  fs.mkdirSync(path.join(tmp, 'kits/t'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'kits/t/kit.json'), JSON.stringify({ schema: 1, name: 't', klaenge: [
    { note: 0, name: 'bd:0', datei: 'bd_0.f32', frames: 1 }, { note: 1, name: 'hh:0', datei: 'hh_0.f32', frames: 1 }] }));
  const muster = path.join(tmp, 'strom1.js');
  fs.writeFileSync(muster, 's("bd*4")');
  const kern = dgram.createSocket('udp4');
  await new Promise((r) => kern.bind(0, '127.0.0.1', r));
  const eingang = [];
  let abo = null;
  kern.on('message', (b, rinfo) => { const m = dekodiere(b); eingang.push(m); if (m.adresse === '/k/hallo') abo = m.werte[1]; });
  const p = spawn(process.execPath, ['--permission', `--allow-fs-read=${path.resolve(HIER, '../..')}`,
    `--allow-fs-read=${process.env.HOME}/strudel`, `--allow-fs-read=${tmp}`, `--allow-fs-write=${tmp}`,
    path.join(HIER, '../erzeuger.mjs'), '--kern-port', String(kern.address().port), '--abo-port', '0',
    '--kit-ordner', path.join(tmp, 'kits'), '--kit', 't', '--muster', muster], { stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  p.stderr.on('data', (d) => { log += d; });
  t.after(() => { p.kill('SIGTERM'); kern.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
  for (let i = 0; i < 100 && !abo; i++) await warte(50);
  assert.ok(abo, `kein /k/hallo: ${log}`);
  // Uhr: 128 BPM, Beat 6,0 jetzt (mono_ns aus derselben Uhr wie process.hrtime)
  const bpm = 128;
  const uhr = (beat) => kern.send(kodiere('/uhr', 'hhddd', [0n, process.hrtime.bigint(), beat, bpm, 0]), abo, '127.0.0.1');
  uhr(6.0);
  await warte(300);
  const strom = eingang.find((m) => m.adresse === '/erz/strom');
  assert.deepEqual(strom?.werte.slice(1), ['erzeuger', 1, 'kit:t', 'erz/1']);
  const fenster = () => eingang.filter((m) => m.bundle).map((b) => ({ ab: b.elemente[0].werte[4], bis: b.elemente[0].werte[5],
    evs: b.elemente.slice(1).map((e) => [e.werte[4], e.werte[3]]) }));
  const f0 = fenster();
  assert.deepEqual([f0[0].ab, f0[0].bis], [8, 16]);                 // Takt 1 (Beat 4..8) läuft: Takte 2 und 3
  assert.deepEqual(f0[0].evs.map((e) => e[0]), [8, 9, 10, 11, 12, 13, 14, 15]);
  // Musterwechsel: die Datei ersetzt (atomar), gilt ab dem nächsten Takt nach „jetzt“ (Beat ≈ 6,6 → 8)
  fs.writeFileSync(`${muster}.neu`, 's("hh*2")');
  fs.renameSync(`${muster}.neu`, muster);
  await warte(600);
  const f1 = fenster().slice(f0.length);
  assert.ok(f1.length >= 1, `kein Wechsel-Fenster: ${log}`);
  assert.equal(f1[0].ab, 8);
  assert.deepEqual(f1[0].evs, [[8, 1], [10, 1], [12, 1], [14, 1]]);
  const st = JSON.parse(fs.readFileSync(path.join(tmp, 'status.json'), 'utf8'));   // Plan 2 T6
  assert.equal(st.ab_beat, 8);
  assert.ok(st.nr >= 2);
  assert.equal(st.fehler, null);
  // Review F11: ein kaputtes Muster schreibt den Fehler mit Zeile in status.json, ab_beat null
  fs.writeFileSync(`${muster}.neu`, 's("hh*2"');
  fs.renameSync(`${muster}.neu`, muster);
  await warte(600);
  const sf = JSON.parse(fs.readFileSync(path.join(tmp, 'status.json'), 'utf8'));
  assert.match(sf.fehler ?? '', /^Zeile 1: /);
  assert.equal(sf.ab_beat, null);
  // Kern neu gestartet: Strom neu anmelden
  const vorher = eingang.filter((m) => m.adresse === '/erz/strom').length;
  kern.send(kodiere('/e/neustart', 'ih', [1, 0n]), abo, '127.0.0.1');
  await warte(300);
  assert.equal(eingang.filter((m) => m.adresse === '/erz/strom').length, vorher + 1);
  assert.match(log, /Muster 2 gilt ab Beat 8/);
});
