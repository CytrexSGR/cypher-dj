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

// RMS windows of each track alone over the whole 128 beats (measured on the render of 2026-11-15, +-2 dB): the drums are the loudest track,
// bass, acid and pad sit 2 to 5 dB under (the pad plays quietly from bar 5 and is pulled up in the break, the acid from bar 13, the bass from bar 9).
const FENSTER = { Drums: [-26, -22], Bass: [-28, -24], Acid: [-29, -25], Pad: [-31, -27] };
// first bar (1-based) in which a track is audible: the arrangement of demo_build.py
const EINSATZ = { Drums: 1, Bass: 9, Acid: 13, Pad: 5 };
const TAKT_FRAMES = 4 * 60 / 128 * 48000;   // 90 000 frames per 4/4 bar at 128 BPM

// reads a 32-bit float WAV into {kanaele, daten: Float32Array interleaved}
function liesWav(datei) {
  const b = fs.readFileSync(datei);
  let pos = 12, daten = null, kanaele = 2;
  while (pos + 8 <= b.length) {
    const k = b.toString('latin1', pos, pos + 4), g = b.readUInt32LE(pos + 4);
    if (k === 'fmt ') kanaele = b.readUInt16LE(pos + 10);
    if (k === 'data') daten = new Float32Array(b.buffer.slice(b.byteOffset + pos + 8, b.byteOffset + pos + 8 + g - (g % 4)));
    pos += 8 + g + (g & 1);
  }
  assert.ok(daten, `${datei}: no data chunk`);
  return { kanaele, daten };
}
// RMS in dB over the bars [von, bis) (0-based bar numbers), all channels
function rmsTakte(w, von, bis) {
  const a = von * TAKT_FRAMES * w.kanaele, e = Math.min(w.daten.length, bis * TAKT_FRAMES * w.kanaele);
  let s = 0;
  for (let i = a; i < e; i++) s += w.daten[i] * w.daten[i];
  return s > 0 ? 10 * Math.log10(s / (e - a)) : -200;
}
const summe = (...ws) => ({ kanaele: ws[0].kanaele, daten: ws[0].daten.map((_, i) => ws.reduce((x, w) => x + w.daten[i], 0)) });

test('real render of the demo: the mix and each track alone are audible, the mix is not clipped', { timeout: 1_800_000 }, (t) => {
  assert.ok(RENDER && fs.existsSync(RENDER), `CYPHERDJ_RENDER must point at a built cypherdj-render (got ${RENDER})`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-starter-demo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = saubereUmgebung(dir);
  fs.mkdirSync(env.HOME, { recursive: true });
  const kits = path.join(dir, 'kits'), bk = path.join(dir, 'baukasten');
  const py = process.env.CYPHERDJ_PYTHON ?? 'python3';
  const e = { ...env, CYPHERDJ_PYTHON: py, CYPHERDJ_KIT_ORDNER: kits, CYPHERDJ_BK_ORDNER: bk };
  for (const stufe of ['graphen', 'kits', 'demo']) {
    const r = spawnSync('bash', [path.join(DJK, 'start', 'djk-starter'), '--nur', stufe], { env: e, encoding: 'utf8' });
    assert.equal(r.status, 0, `starter ${stufe}: ${r.stdout}\n${r.stderr}`);
  }
  const pj = path.join(env.HOME, 'cypherdj', 'werke', 'projekte', 'demo', 'project.json');
  assert.ok(fs.existsSync(pj), 'the demo project is in the throw-away HOME');
  const projekt = JSON.parse(fs.readFileSync(pj, 'utf8'));
  const render = (aus, nur) => {
    const args = [WERKZEUG, '--projekt', pj, '--aus', aus, '--von-beat', '0', '--bis-beat', '128', '--kit-ordner', kits, '--bk-ordner', bk];
    if (nur) args.push('--nur', nur);
    const r = spawnSync(process.execPath, args, { env: { ...e, CYPHERDJ_RENDER: RENDER }, encoding: 'utf8' });
    assert.equal(r.status, 0, `${nur ?? 'mix'}: ${r.stdout}\n${r.stderr}`);
    return JSON.parse(r.stdout.trim().split('\n').at(-1));
  };
  const mix = render(path.join(dir, 'mix.wav'));
  console.log(`# measured mix: frames ${mix.frames} rms_db ${mix.rms_db} spitze_db ${mix.spitze_db}`);
  assert.equal(mix.frames, 128 * 60 / 128 * 48000);
  assert.equal(mix.frames, 2_880_000);
  assert.ok(mix.spitze_db <= -3 && mix.spitze_db >= -9, `mix spitze_db ${mix.spitze_db}`);
  // sections of the one mix render: intro 1-8, build 9-16, break 17-20, drop 21-32
  const w = liesWav(mix.datei);
  const intro = rmsTakte(w, 0, 8), aufbau = rmsTakte(w, 8, 16), pause = rmsTakte(w, 16, 20), drop = rmsTakte(w, 20, 32);
  console.log(`# measured sections rms_db: intro ${intro.toFixed(2)} build ${aufbau.toFixed(2)} break ${pause.toFixed(2)} drop ${drop.toFixed(2)}`);
  assert.ok(drop >= -19 && drop <= -15, `drop rms ${drop}`);
  assert.ok(intro <= drop - 4, `intro ${intro} must be 4 dB under the drop ${drop}`);
  assert.ok(pause <= drop - 6, `break ${pause} must be clearly (6 dB) under the drop ${drop}`);
  assert.ok(aufbau <= drop - 2, `build ${aufbau} must be under the drop ${drop}`);
  // no graph of the demo may have a latency: the core refuses one on a project track (arr_playback.cpp:787); a render that succeeds
  // for every track alone is the proof (synth-neuro, latency 69 samples, fails here, which is why the bass is not synth-neuro).
  const solo = {};
  for (const s of projekt.spuren) {
    const z = render(path.join(dir, `${s.id}.wav`), s.id);
    console.log(`# measured ${s.name}: rms_db ${z.rms_db} spitze_db ${z.spitze_db}`);
    assert.ok(z.rms_db > -60, `${s.name} alone: rms_db ${z.rms_db}`);
    const [lo, hi] = FENSTER[s.name];
    assert.ok(z.rms_db >= lo && z.rms_db <= hi, `${s.name} alone: rms_db ${z.rms_db} outside ${lo}..${hi}`);
    assert.ok(z.spitze_db <= -0.1, `${s.name} alone: spitze_db ${z.spitze_db}`);
    solo[s.name] = liesWav(z.datei);
    // entry bar: the first bar above -50 dB
    const takt = Array.from({ length: 32 }, (_, i) => rmsTakte(solo[s.name], i, i + 1)).findIndex((v) => v > -50) + 1;
    console.log(`# entry bar ${s.name}: ${takt}`);
    assert.equal(takt, EINSATZ[s.name], `${s.name} enters in bar ${takt}`);
  }
  // the break really drops out: the drums are silent in bars 18 and 19 (the kick tail of bar 17 may still ring), the bass is gone
  assert.ok(rmsTakte(solo.Drums, 17, 18) < -70, 'drums silent in bar 18');
  assert.ok(rmsTakte(solo.Bass, 16, 20) < -100, 'no bass in the break');
  // level per track group in the drop: Drums against Music (Bass + Acid + Pad), neither buries the other
  const gd = rmsTakte(solo.Drums, 20, 32), gm = rmsTakte(summe(solo.Bass, solo.Acid, solo.Pad), 20, 32);
  console.log(`# group levels in the drop rms_db: Drums ${gd.toFixed(2)} Music ${gm.toFixed(2)}`);
  assert.ok(Math.abs(gd - gm) <= 6, `groups ${gd} / ${gm}`);
});
