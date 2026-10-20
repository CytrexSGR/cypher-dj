// Start-Rauchtest für main() (Plan 2026-10-15-d1-s1, Task 6): die Unit startet `node server.ts` (cypherdj-oberflaeche.service,
// RestartPreventExitStatus=2). Geprüft: Ports aus CYPHERDJ_INSTANZ (versatz, Z2), Startzeile, sauberes Ende auf SIGTERM (0),
// Startfehler → Exit 2 mit „oberflaeche: Startfehler: …“ (falsche Instanz, falscher Schalter, belegter Port).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { K, TEST_INSTANZ, belegeTestInstanz } from './hilfen/instanz.mjs';

belegeTestInstanz();
const SERVER = path.join(import.meta.dirname, '..', 'server.ts');

function starte(t, args = [], env = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-start-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const voll = ['--bestand', d, '--arbeitsbestand', path.join(d, 'ab'), '--loops', path.join(d, 'loops'), '--welle-cache', path.join(d, 'welle'),
    '--sammlungen', path.join(d, 'sets'), '--muster-ordner', path.join(d, 'muster'), '--muster-bibliothek', path.join(d, 'mb'), '--muster-sets', path.join(d, 'ms'),
    '--mediathek', path.join(d, 'gibt-es-nicht.sqlite'), '--katalog', path.join(d, 'gibt-es-nicht-k.sqlite'), '--digitalout', path.join(d, 'nix'), ...args];
  const p = spawn(process.execPath, [SERVER, ...voll], { env: { ...process.env, CYPHERDJ_INSTANZ: TEST_INSTANZ, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let aus = '', err = '';
  p.stdout.on('data', (x) => { aus += x; }); p.stderr.on('data', (x) => { err += x; });
  const ende = new Promise((r) => p.once('exit', (code, signal) => r({ code, signal })));
  t.after(async () => { if (p.exitCode === null && p.signalCode === null) { p.kill('SIGKILL'); await ende; } });
  return { p, ende, aus: () => aus, err: () => err };
}
async function bisZeile(s, ms = 8000) { for (let t = 0; t < ms && !/oberflaeche: http/.test(s.aus()); t += 50) await new Promise((r) => setTimeout(r, 50)); return s.aus(); }

test('main(): Ports aus der Instanz (47300/47100/47150/47200 + 1000·k), /konfig antwortet, SIGTERM endet mit 0', { timeout: 20000 }, async (t) => {
  const s = starte(t);
  const zeile = await bisZeile(s);
  assert.match(zeile, new RegExp(`^oberflaeche: http://127\\.0\\.0\\.1:${47300 + K}/ kern ${47100 + K} abo ${47150 + K} leitstand ws ${47200 + K} `), `${zeile} ${s.err()}`);
  const k = await (await fetch(`http://127.0.0.1:${47300 + K}/konfig`)).json();
  assert.equal(k.leitstand_ws, `ws://127.0.0.1:${47200 + K}/`);
  s.p.kill('SIGTERM');
  assert.deepEqual(await s.ende, { code: 0, signal: null });
});

test('main(): Startfehler enden mit 2 und nennen den Grund (Instanz z, --kern-pruefmodus vielleicht, Port belegt)', { timeout: 20000 }, async (t) => {   // Zeitgrenze: ein Mutant, der trotz belegtem Port startet, soll rot werden, nicht hängen
  const z = starte(t, [], { CYPHERDJ_INSTANZ: 'z' });
  assert.equal((await z.ende).code, 2);
  assert.match(z.err(), /^oberflaeche: Startfehler: CYPHERDJ_INSTANZ=z: erlaubt sind a bis i/);
  const pm = starte(t, ['--kern-pruefmodus', 'vielleicht']);
  assert.equal((await pm.ende).code, 2);
  assert.match(pm.err(), /--kern-pruefmodus vielleicht: erlaubt sind an oder aus/);
  const halter = net.createServer();
  await new Promise((ok) => halter.listen(47300 + K, '127.0.0.1', ok));
  t.after(() => new Promise((r) => halter.close(r)));
  const belegt = starte(t);
  assert.equal((await belegt.ende).code, 2, `belegter Port: ${belegt.err()}`);
  assert.match(belegt.err(), /Startfehler: .*EADDRINUSE/);
});

// D1 S3 (Auftrag 14 e: Browser-Probe gegen den echten Server, isoliert): --proj-wurzel und --arr-ordner geben dem Bereich proj Projektwurzel und
// Arbeitsordner (sonst die Vorgaben der Instanz: ~/cypherdj-projekte…, kern.toml arr_ordner). Ein Projekt, das POST /proj/neu anlegt, liegt dort.
test('main(): --proj-wurzel und --arr-ordner legen Projekte und Wiedergaben in die übergebenen Ordner', { timeout: 20000 }, async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-start-proj-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const s = starte(t, ['--proj-wurzel', path.join(d, 'proj'), '--arr-ordner', path.join(d, 'arr')]);
  await bisZeile(s);
  const r = await fetch(`http://127.0.0.1:${47300 + K}/proj/neu`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Start Probe' }) });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.ok(fs.existsSync(path.join(d, 'proj', j.slug, 'project.json')), 'Projekt in --proj-wurzel');
  assert.ok(fs.readdirSync(path.join(d, 'arr')).some((x) => /^wiedergabe-\d+\.json$/.test(x)), 'Wiedergabe in --arr-ordner');
  assert.ok(fs.existsSync(path.join(d, 'arr.zaehler')), 'Zählerdatei neben dem Arbeitsordner (Spec 6.31)');
  s.p.kill('SIGTERM');
  assert.deepEqual(await s.ende, { code: 0, signal: null });
});
