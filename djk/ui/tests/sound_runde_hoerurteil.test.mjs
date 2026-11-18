// FIND SOUND rework, task 0: the fixture of the listening verdict of 2026-11-18 (tests/fixtures/klang_runde_hoerurteil.json, recorded with the real offline
// render by tests/support/sound_runde_record.mjs). The module "base" is not available outside the studio, so the fixture comes from the closest project
// built from the fm-bass graph; the positive control says whether it reproduces what was heard and measured. Calibration tests (task 1) skip when it does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MERKMALE } from '../project/sound_runde_contract.ts';

const F = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'klang_runde_hoerurteil.json'), 'utf8'));

test('the fixture has A and six candidates with finite values and the positive control is recorded truthfully', () => {
  assert.equal(F.a_deterministisch, true, 'two renders of A give the same vector');
  assert.equal(F.kandidaten.length, 6);
  assert.deepEqual(F.kandidaten.map((k) => k.schritt), ['normal', 'normal', 'normal', 'grob', 'grob', 'grob']);
  for (const e of [F.a, ...F.kandidaten]) {
    assert.deepEqual(Object.keys(e.merkmale).sort(), [...MERKMALE].sort());
    assert.ok(Object.values(e.merkmale).every(Number.isFinite));
    assert.equal(e.bild30.length, 30);
    assert.ok(e.bild30.every(Number.isFinite));
  }
  const dm = (i, n) => F.kandidaten[i].merkmale[n] - F.a.merkmale[n];
  const ok = Math.abs(dm(0, 'hoehen') - 6.0) <= 1.5 && Math.abs(dm(2, 'pegel') + 1.0) <= 0.7
    && Math.abs(dm(3, 'pegel') - 1.4) <= 0.7 && Math.abs(dm(5, 'pegel') - 1.3) <= 0.7;
  assert.equal(F.kontrolle.ok, ok, 'the recorded control matches the values');
  console.log(`# positive control ${ok ? 'holds' : 'FAILS'}: highs ${dm(0, 'hoehen').toFixed(2)} dB (want 6.0 +-1.5), levels ${dm(2, 'pegel').toFixed(2)} / ${dm(3, 'pegel').toFixed(2)} / ${dm(5, 'pegel').toFixed(2)} dB (want -1.0 / +1.4 / +1.3 +-0.7)`);
});

test('the old normal step (Brightness 1 -> 1.36) reads strong in highs, the verdict said inaudible', () => {
  assert.ok(F.kandidaten[0].merkmale.hoehen - F.a.merkmale.hoehen > 3, 'the measure of yesterday counts it as a large change');
});
