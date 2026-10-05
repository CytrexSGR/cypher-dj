import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { schreibeMuster, leseMusterStand, setzeAutonom, autonomAn, schreibeStatus } from '../src/muster_ablage.mjs';

const ordner = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ablage-'));

test('schreibeMuster: gültig → strom1.js + strom1.von.json atomar, keine Reste', () => {
  const d = ordner();
  const r = schreibeMuster(d, 's("bd*4")', 'andreas', 1000);
  assert.deepEqual(r, { ok: true });
  assert.equal(fs.readFileSync(path.join(d, 'strom1.js'), 'utf8'), 's("bd*4")\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'strom1.von.json'), 'utf8')), { von: 'andreas', zeit: 1000 });
  assert.deepEqual(fs.readdirSync(d).sort(), ['strom1.js', 'strom1.von.json']);
});

test('schreibeMuster: Fehler mit Zeile, nichts geschrieben', () => {
  const d = ordner();
  schreibeMuster(d, 's("bd*4")', 'cypher', 1);
  const r = schreibeMuster(d, 's("bd*4")\n  .gain(', 'andreas', 2);
  assert.match(r.fehler, /^Zeile 2: /);
  assert.equal(fs.readFileSync(path.join(d, 'strom1.js'), 'utf8'), 's("bd*4")\n');
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'strom1.von.json'), 'utf8')).von, 'cypher');
});

test('leseMusterStand: Text, von, Status; fehlende Dateien → leer statt Wurf', () => {
  const d = ordner();
  assert.deepEqual(leseMusterStand(d), { text: '', von: null, zeit: null, status: null, autonom: true });
  schreibeMuster(d, 's("hh*8")', 'cypher', 5);
  schreibeStatus(d, { nr: 3, ab_beat: 64, fehler: null }, 6);
  assert.deepEqual(leseMusterStand(d), { text: 's("hh*8")', von: 'cypher', zeit: 5, status: { nr: 3, ab_beat: 64, fehler: null, zeit: 6 }, autonom: true });
});

test('AUTO (Andreas 2026-09-28): ohne Datei an, Schalter hält, bis er umgelegt wird', () => {
  const d = ordner();
  assert.equal(autonomAn(d), true);
  setzeAutonom(d, false, 10);
  assert.equal(autonomAn(d), false);
  assert.equal(leseMusterStand(d).autonom, false);
  setzeAutonom(d, true, 20);
  assert.equal(autonomAn(d), true);
});
