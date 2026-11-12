// Task 14 of the base-for-new-users plan: the demo project of the starter pack, rendered for real through the export path.
// The kit and the graphs come from a throw-away HOME that the test fills with the starter itself (kits and graphs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saubereUmgebung } from './support/environment.mjs';

const DJK = path.resolve(import.meta.dirname, '..', '..');
const WERKZEUG = path.join(DJK, 'starter', 'render_project.ts');
// Default as in paths.ts renderProgramm(): the kern build folder of this checkout. A missing program stays a failure, never a skip.
const RENDER = process.env.CYPHERDJ_RENDER || path.join(import.meta.dirname, '..', '..', 'core', 'build', 'cypherdj-render');

// RMS windows of each track alone (target +-2 dB): the bass and the chords carry the mix, the drums stay the loudest
const FENSTER = { Drums: [-25, -21], Bass: [-28, -22], Acid: [-33, -27], Chords: [-34, -28] };

test('real render of the demo: the mix and each track alone are audible, the mix is not clipped', { timeout: 1_800_000 }, (t) => {
  assert.ok(RENDER && fs.existsSync(RENDER), `CYPHERDJ_RENDER must point at a built cypherdj-render (got ${RENDER})`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-starter-demo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = saubereUmgebung(dir);
  fs.mkdirSync(env.HOME, { recursive: true });
  const kits = path.join(dir, 'kits'), bk = path.join(dir, 'modular');
  const py = process.env.CYPHERDJ_PYTHON ?? 'python3';
  const e = { ...env, CYPHERDJ_PYTHON: py, CYPHERDJ_KIT_ORDNER: kits, CYPHERDJ_BK_ORDNER: bk };
  for (const stufe of ['graphen', 'kits', 'demo']) {
    const r = spawnSync('bash', [path.join(DJK, 'start', 'djk-starter'), '--nur', stufe], { env: e, encoding: 'utf8' });
    assert.equal(r.status, 0, `starter ${stufe}: ${r.stdout}\n${r.stderr}`);
  }
  const pj = path.join(env.HOME, 'cypherdj-projekte', 'demo', 'project.json');
  assert.ok(fs.existsSync(pj), 'the demo project is in the throw-away HOME');
  const projekt = JSON.parse(fs.readFileSync(pj, 'utf8'));
  const render = (aus, nur) => {
    const args = [WERKZEUG, '--projekt', pj, '--aus', aus, '--von-beat', '0', '--bis-beat', '64', '--kit-ordner', kits, '--bk-ordner', bk];
    if (nur) args.push('--nur', nur);
    const r = spawnSync(process.execPath, args, { env: { ...e, CYPHERDJ_RENDER: RENDER }, encoding: 'utf8' });
    assert.equal(r.status, 0, `${nur ?? 'mix'}: ${r.stdout}\n${r.stderr}`);
    return JSON.parse(r.stdout.trim().split('\n').at(-1));
  };
  const mix = render(path.join(dir, 'mix.wav'));
  console.log(`# measured mix: frames ${mix.frames} rms_db ${mix.rms_db} spitze_db ${mix.spitze_db}`);
  assert.equal(mix.frames, 64 * 60 / 128 * 48000);
  assert.ok(mix.spitze_db <= -3 && mix.spitze_db >= -9, `mix spitze_db ${mix.spitze_db}`);
  assert.ok(mix.rms_db >= -19 && mix.rms_db <= -15, `mix rms_db ${mix.rms_db}`);
  // no graph of the demo may have a latency: the core refuses one on a project track (arr_playback.cpp:789), so a render that
  // succeeds for every track alone is the proof (synth-neuro, latency 69 samples, failed here).
  for (const s of projekt.spuren) {
    const z = render(path.join(dir, `${s.id}.wav`), s.id);
    console.log(`# measured ${s.name}: rms_db ${z.rms_db} spitze_db ${z.spitze_db}`);
    assert.ok(z.rms_db > -60, `${s.name} alone: rms_db ${z.rms_db}`);
    const [lo, hi] = FENSTER[s.name];
    assert.ok(z.rms_db >= lo && z.rms_db <= hi, `${s.name} alone: rms_db ${z.rms_db} outside ${lo}..${hi}`);
    assert.ok(z.spitze_db <= -0.1, `${s.name} alone: spitze_db ${z.spitze_db}`);
  }
});
