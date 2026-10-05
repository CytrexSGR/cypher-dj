import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WERKZEUG = path.join(path.dirname(fileURLToPath(import.meta.url)), '../djk-muster');
const lauf = (args, eingabe) => spawnSync(process.execPath, [WERKZEUG, ...args], { input: eingabe, encoding: 'utf8' });

test('gutes Muster: atomar abgelegt, Rückgabe 0', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-'));
  const ziel = path.join(d, 'strom1.js');
  const r = lauf(['--ziel', ziel, '--text', 's("bd*4, hh*8")']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(ziel, 'utf8'), 's("bd*4, hh*8")\n');
  assert.deepEqual(fs.readdirSync(d).sort(), ['strom1.js', 'strom1.von.json']);   // keine Reste
});

test('Fehler: Zeile genannt, Rückgabe 2, altes Muster bleibt', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-'));
  const ziel = path.join(d, 'strom1.js');
  fs.writeFileSync(ziel, 's("bd*4")\n');
  const r = lauf(['--ziel', ziel, '-'], 's("bd*4")\n  .gain(');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Zeile 2: /);
  assert.equal(fs.readFileSync(ziel, 'utf8'), 's("bd*4")\n');
});

test('--von landet in strom1.von.json (Vorgabe cypher)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-'));
  const ziel = path.join(d, 'strom1.js');
  assert.equal(lauf(['--ziel', ziel, '--text', 's("bd")']).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'strom1.von.json'), 'utf8')).von, 'cypher');
  assert.equal(lauf(['--ziel', ziel, '--von', 'sonnet', '--text', 's("hh")']).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'strom1.von.json'), 'utf8')).von, 'sonnet');
});

test('AUTO aus: Rückgabe 4, nichts geschrieben; AUTO wieder an → 0', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-'));
  const ziel = path.join(d, 'strom1.js');
  fs.writeFileSync(ziel, 's("bd")\n');
  fs.writeFileSync(path.join(d, 'autonom.json'), JSON.stringify({ an: false, zeit: Date.now() }));
  const r = lauf(['--ziel', ziel, '--text', 's("hh")']);
  assert.equal(r.status, 4);
  assert.match(r.stderr, /AUTO ist aus/);
  assert.equal(fs.readFileSync(ziel, 'utf8'), 's("bd")\n');
  fs.writeFileSync(path.join(d, 'autonom.json'), JSON.stringify({ an: true, zeit: Date.now() }));
  assert.equal(lauf(['--ziel', ziel, '--text', 's("hh")']).status, 0);   // Negativ-Kontrolle
});

test('--als-andreas (nur für den Seiten-Server): schreibt auch bei AUTO aus', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-'));
  const ziel = path.join(d, 'strom1.js');
  fs.writeFileSync(path.join(d, 'autonom.json'), JSON.stringify({ an: false, zeit: Date.now() }));
  const r = lauf(['--ziel', ziel, '--von', 'andreas', '--als-andreas', '--text', 's("cp")']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(ziel, 'utf8'), 's("cp")\n');
  assert.doesNotMatch(lauf(['--hilfe']).stdout, /als-andreas/);
});

test('Review F5: ein Muster mit offenem Timer endet sofort (rc 0, kein Hängen)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-'));
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [WERKZEUG, '--ziel', path.join(d, 'strom1.js'), '--text', 's("bd").gain((setTimeout(() => {}, 60000), 1))'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(Date.now() - t0 < 10000, `hing ${Date.now() - t0} ms`);
});

test('Review F7: AUTO geht während des Prüfens aus → nichts geschrieben, rc 4', async () => {
  const { schreibeMuster } = await import('../src/muster_ablage.mjs');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-'));
  fs.writeFileSync(path.join(d, 'strom1.js'), 's("bd")\n');
  // darf() wird NACH dem Kompilieren gefragt; hier legt das „Prüfen“ AUTO um
  const r = schreibeMuster(d, 's("hh")', 'cypher', 1, () => false);
  assert.deepEqual(r, { abgewiesen: true });
  assert.equal(fs.readFileSync(path.join(d, 'strom1.js'), 'utf8'), 's("bd")\n');
  assert.deepEqual(schreibeMuster(d, 's("hh")', 'cypher', 2, () => true), { ok: true });   // Negativ-Kontrolle
});

test('Studio S1: --strom 2 schreibt nach <basis>/erzeuger2/strom1.js, --strom 1 nach erzeuger/', () => {
  const basis = fs.mkdtempSync(path.join(os.tmpdir(), 'djkm-strom-'));
  const lauf = (strom) => spawnSync(process.execPath, [WERKZEUG, '--basis', basis, '--strom', String(strom),
    '--text', 's("bd*2")'], { encoding: 'utf8' });
  const r2 = lauf(2);
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(fs.readFileSync(path.join(basis, 'erzeuger2', 'strom1.js'), 'utf8'), 's("bd*2")\n');
  assert.equal(fs.existsSync(path.join(basis, 'erzeuger', 'strom1.js')), false, 'Strom 1 unberührt');
  assert.equal(lauf(1).status, 0);
  assert.equal(fs.existsSync(path.join(basis, 'erzeuger', 'strom1.js')), true);
  assert.equal(lauf(4).status, 2, 'nur Ströme 1..3');
  fs.rmSync(basis, { recursive: true, force: true });
});
