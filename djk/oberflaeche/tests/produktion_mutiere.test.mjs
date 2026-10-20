// D1 V1: das Mutationswerkzeug pruef/mutiere.mjs selbst (rot unter echter Mutation, Exit 1 bei überlebender Mutation,
// Exit 1 bei rotem Grundlauf oder mehrdeutigem Suchtext, Datei immer wiederhergestellt). Arbeitet in einem tmp-Ordner.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MUTIERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'pruef', 'mutiere.mjs');
function aufbau() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-mutiere-'));
  fs.writeFileSync(path.join(d, 'mod.mjs'), 'export const doppelt = (x) => x * 2; // Kommentar\n');
  fs.writeFileSync(path.join(d, 'mod.test.mjs'), "import assert from 'node:assert/strict';\nimport { doppelt } from './mod.mjs';\nassert.equal(doppelt(3), 6);\n");
  return d;
}
const lauf = (d, suche, ersetze) => spawnSync(process.execPath, [MUTIERE, path.join(d, 'mod.mjs'), suche, ersetze, '--', process.execPath, path.join(d, 'mod.test.mjs')], { encoding: 'utf8' });

test('V1 mutiere: echte Mutation macht den Test rot → Exit 0, Datei wiederhergestellt', () => {
  const d = aufbau();
  const vorher = fs.readFileSync(path.join(d, 'mod.mjs'), 'utf8');
  const r = lauf(d, 'x * 2', 'x * 3');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /MUTATION ROT/);
  assert.equal(fs.readFileSync(path.join(d, 'mod.mjs'), 'utf8'), vorher);
});

test('V1 mutiere: harmlose Mutation (Kommentar) überlebt → Exit 1 (Negativ-Kontrolle)', () => {
  const d = aufbau();
  const r = lauf(d, '// Kommentar', '// anders');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /MUTATION ÜBERLEBT/);
});

test('V1 mutiere: Suchtext nicht genau einmal oder Grundlauf rot → Exit 1', () => {
  const d = aufbau();
  assert.match(lauf(d, 'gibtsnicht', 'x').stderr, /kommt 0-mal/);
  fs.writeFileSync(path.join(d, 'mod.test.mjs'), "import assert from 'node:assert/strict';\nassert.equal(1, 2);\n");
  const r = lauf(d, 'x * 2', 'x * 3');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Grundlauf ohne Mutation ist nicht grün/);
});

// Fix 12: stirbt der Elternprozess per Signal (Strg+C im Terminal, kill, Zeitlimit des Aufrufers), während die Mutation in der Datei steht,
// stellt mutiere die Datei trotzdem her. Nicht garantiert ist es bei SIGKILL und Stromausfall: das steht im Kopf von mutiere.mjs.
const warteBis = async (f, ms = 8000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('Zeit abgelaufen'); await new Promise((r) => setTimeout(r, 25)); } };
for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`V1 mutiere: ${signal} während der Mutation stellt die Datei her`, async () => {
    const d = aufbau();
    const datei = path.join(d, 'mod.mjs'), vorher = fs.readFileSync(datei, 'utf8');
    // Der Prüfling ist grün, solange die Datei heil ist, und hängt 30 s, sobald die Mutation drinsteht
    fs.writeFileSync(path.join(d, 'haengt.mjs'), "import { doppelt } from './mod.mjs';\nif (doppelt(3) !== 6) await new Promise((r) => setTimeout(r, 30000));\n");
    const kind = spawn(process.execPath, [MUTIERE, datei, 'x * 2', 'x * 3', '--', process.execPath, path.join(d, 'haengt.mjs')], { stdio: 'ignore' });
    const ende = new Promise((ok) => kind.on('exit', (code, sig) => ok({ code, sig })));
    try {
      await warteBis(() => fs.readFileSync(datei, 'utf8') !== vorher);              // die Mutation steht in der Datei
      kind.kill(signal);
      const r = await Promise.race([ende, new Promise((ok) => setTimeout(() => ok('haengt'), 8000))]);
      assert.notEqual(r, 'haengt', 'mutiere beendet sich auf das Signal');
      assert.equal(fs.readFileSync(datei, 'utf8'), vorher, 'Datei wiederhergestellt');
      assert.notEqual(r.code, 0, 'ein abgebrochener Lauf ist kein Erfolg');
    } finally { kind.kill('SIGKILL'); fs.writeFileSync(datei, vorher); }
  });
}
