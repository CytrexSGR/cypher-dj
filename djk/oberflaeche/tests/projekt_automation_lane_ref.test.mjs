// Automation Slice 1, task 5 (AK26 part): the server evaluation laneWert (projekt/lane.ts) against the reference file kern/tests/daten/lane_ref.json,
// which kern/tests/daten/erzeuge_lane_ref.py writes independently of all three implementations (core C++, server TS, page JS).
// The generator is reproducible: run twice it yields the same bytes, and they are the committed bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { laneWert } from '../projekt/lane.ts';

const DATEN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'kern', 'tests', 'daten');
const REF = path.join(DATEN, 'lane_ref.json');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

test('S1 T5.1 laneWert equals the reference file at 1000 pairs (relative 1e-4)', () => {
  const ref = JSON.parse(fs.readFileSync(REF, 'utf8'));
  assert.equal(ref.paare.length, 1000);
  let mute = 0, schlecht = [];
  for (const pr of ref.paare) {
    const ist = laneWert(ref.lanes[pr.lane], pr.beat, 'fader');
    if (pr.wert <= -120) mute++;
    if (!(Math.abs(ist - pr.wert) <= 1e-4 * Math.max(1, Math.abs(pr.wert)))) schlecht.push({ lane: pr.lane, beat: pr.beat, ist, soll: pr.wert });
  }
  assert.deepEqual(schlecht.slice(0, 5), []);
  assert.ok(mute > 10, `positive control: the file holds mute cases (${mute})`);
});

test('S1 T5.2 negative control: a deliberately wrong evaluation is caught by the same file', () => {
  const ref = JSON.parse(fs.readFileSync(REF, 'utf8'));
  // jump read as linear: must differ at some pair
  const falsch = (punkte, beat) => laneWert(punkte.map((p) => ({ ...p, form: p.form === 'sprung' ? 'linear' : p.form })), beat, 'fader');
  const abw = ref.paare.filter((pr) => Math.abs(falsch(ref.lanes[pr.lane], pr.beat) - pr.wert) > 1e-4 * Math.max(1, Math.abs(pr.wert)));
  assert.ok(abw.length > 5, `the file sees a jump read as linear (${abw.length} pairs differ)`);
});

test('S1 T5.3 the generator is reproducible: twice the same sha256, and the committed file', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'laneref-'));
  try {
    const a = path.join(d, 'a.json'), b = path.join(d, 'b.json');
    execFileSync('python3', ['-I', path.join(DATEN, 'erzeuge_lane_ref.py'), a]);
    execFileSync('python3', ['-I', path.join(DATEN, 'erzeuge_lane_ref.py'), b]);
    assert.equal(sha(a), sha(b));
    assert.equal(sha(a), sha(REF), 'the committed file is what the script writes');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
