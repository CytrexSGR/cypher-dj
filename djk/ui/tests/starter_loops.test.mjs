// Task 12 of the base-for-new-users plan: the starter loops, written by `python -m starter --nur loops` into a throw-away
// HOME, are listed by the page's own reader (loops.ts leseLoops) as loadable. Needs cargo and numpy (CYPHERDJ_PYTHON or python3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saubereUmgebung } from './support/environment.mjs';
import { leseLoops } from '../loops.ts';

const DJK = path.resolve(import.meta.dirname, '..', '..');
const PYTHON = process.env.CYPHERDJ_PYTHON || 'python3';

const lauf = (env) => spawnSync(PYTHON, ['-m', 'starter', '--nur', 'loops'], { cwd: DJK, env, encoding: 'utf8' });

test('starter loops are listed loadable by leseLoops and a second run keeps them', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-starter-loops-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = saubereUmgebung(dir);
  const r = lauf(env);
  assert.equal(r.status, 0, r.stderr);
  const ordner = path.join(env.HOME, '.config', 'cypherdj', 'loops');
  const liste = leseLoops(ordner);
  assert.deepEqual(liste.map((l) => [l.name, l.beats, l.ladbar, l.grund]), [
    ['starter-909-groove', 8, true, ''],
    ['starter-neuro-bass', 16, true, ''],
    ['starter-poly-chords', 16, true, ''],
  ]);
  for (const l of liste) assert.match(l.quelle, /^starter:/);
  const vorher = fs.readFileSync(path.join(ordner, 'starter-neuro-bass', 'loop.f32'));
  const r2 = lauf(env);
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /kept loop starter-neuro-bass/);
  assert.ok(fs.readFileSync(path.join(ordner, 'starter-neuro-bass', 'loop.f32')).equals(vorher));
});
