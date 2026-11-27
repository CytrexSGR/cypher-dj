import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { kompiliere } from '../src/compile.mjs';
import { Planer } from '../src/planner.mjs';
import { schreibeMuster, leseVersatz } from '../src/pattern_storage.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = { name: 't', note: new Map(), bank: new Map() };
const wert = (m, z) => m.queryArc(z, z + 1).filter((h) => h.hasOnset()).map((h) => String(h.value.s ?? h.value));
const planer = () => new Planer({ strom: 1, kit: { midi: true }, sende: () => {}, jetztUs: () => 0 });

test('versatz 2: cycle 10 yields what cycle 8 yields without it', () => {
  const ohne = kompiliere('s("<a b c d>")').muster;
  const p = planer();
  p.setze(kompiliere('s("<a b c d>")').muster, -Infinity, 2);
  const mit = p.plan.at(-1).muster;
  assert.deepEqual(wert(mit, 10), wert(ohne, 8));
  assert.notDeepEqual(wert(mit, 10), wert(ohne, 10));
});

test('a later pattern without versatz resets it', () => {
  const p = planer();
  p.setze(kompiliere('s("<a b c d>")').muster, -Infinity, 2);
  p.setze(kompiliere('s("<a b c d>")').muster, 4);
  assert.deepEqual(wert(p.plan.at(-1).muster, 10), wert(kompiliere('s("<a b c d>")').muster, 10));
});

test('anchor of .rein stays the switch bar, not shifted', () => {
  // compiled in inner time (anker - versatz) then .late(versatz): ramp starts at outer cycle 8
  const m = kompiliere('s("hh*4").rein(4)', { anker: 8 - 2 }).muster.late(2);
  const g = (z) => m.queryArc(z, z + 1).filter((h) => h.hasOnset()).map((h) => Number(h.value.gain));
  assert.equal(Math.max(...g(7)), 0);
  assert.equal(g(8)[0], 0);
  assert.ok(Math.abs(g(12)[0] - 1) < 1e-9);
});

test('schreibeMuster writes versatz into strom1.von.json only when set; leseVersatz reads it', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'versatz-'));
  schreibeMuster(d, 's("a")', 'cypher', 1, () => true, 3);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'strom1.von.json'), 'utf8')), { von: 'cypher', zeit: 1, versatz: 3 });
  assert.equal(leseVersatz(d), 3);
  schreibeMuster(d, 's("b")', 'cypher', 2);
  assert.equal(leseVersatz(d), 0);
  assert.ok(schreibeMuster(d, 's("b")', 'cypher', 2, () => true, 1.5).fehler);
});

test('djk-muster --versatz=-5 (one argv entry, negative) exits 0 and writes versatz -5', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'versatz-neg-'));
  const werkzeug = path.join(path.dirname(fileURLToPath(import.meta.url)), '../djk-muster');
  const r = spawnSync(process.execPath, [werkzeug, '--ziel', path.join(d, 'strom1.js'), '--von', 'andreas', '--als-andreas', '--versatz=-5', '--text', 's("a")'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(leseVersatz(d), -5);
});
