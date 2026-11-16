// Sampler A1 task 3: the offline render of a generated device against the loop it was cut from (end of slice 1).
// Skipped unless CYPHERDJ_RENDER names a built cypherdj-render. Source: a synthetic 4-beat loop of 16 decaying noise bursts, or, with
// SAMPLER_PROBE_LOOP=<name>, that library loop from ~/.config/cypherdj/loops (read only; every file this test writes lives in a temp folder).
// The pattern is the cut in its original order (spurBefehl) on a workbench track at 0 dB; the render of beats 0..beats must give the cut back.
// Sampler A2 task 8 adds two tests on the same path: a break cut at its hits (method anschlag) plays in its original order like the grid cut, and a PITCH
// value on one step (a clip envelope on geraet.k3, latched by `rastet`) acts on the hit of that step and on no other.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt } from '../project/model.ts';
import { loopOrdnerVorgabe } from '../loops.ts';
import { legeSchnitt } from '../sampler/schnitt.ts';
import { spurBefehl } from '../sampler/device.ts';
import { leseWavF32 } from '../sampler/wav.ts';
import { saubereUmgebung } from './support/environment.mjs';

const WERKZEUG = path.resolve(import.meta.dirname, '..', '..', 'starter', 'render_project.ts');
const RENDER = process.env.CYPHERDJ_RENDER;
const SONDE = process.env.SAMPLER_PROBE_LOOP;
const LAG_MAX = 512;
// The mixer pans a stereo track at the centre with a constant-power law: 0.7071 on both sides, exactly -3.0103 dB (measured: the device without
// filter and crush renders at correlation 1.0000 and -3.01 dB). The level comparison takes it out; the raw difference is printed too.
const PAN_MITTE_DB = 20 * Math.log10(Math.SQRT1_2);
const RAMPE = 480;   // frames at the end of a slice that the release and the end fade may shape: 10 ms

const tmp = (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'smp-t3-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const ordner = (dir) => {
  const d = { ordner: path.join(dir, 'sampler'), bk: path.join(dir, 'bk'), loops: path.join(dir, 'loops'), module: path.join(dir, 'module') };
  for (const p of Object.values(d)) fs.mkdirSync(p);
  return d;
};

// 16 bursts of decaying noise, one per 1/16 note of a 4-beat loop at 128 BPM (frames = beats * 22500); the two channels carry different noise.
// The noise is band-limited (two one-pole low-passes at about 2.5 kHz, like a real hit): the device's Cutoff stays at 20 kHz, where its 2-pole low-pass
// is -3 dB and shifts the phase, so white noise (correlation 0.76 at the same level, measured) is not a fair source for a "reproduces the loop" test.
function schreibeSyntheseLoop(ordner, name) {
  const beats = 4, frames = beats * 22500, scheibe = frames / 16, f = new Float32Array(frames * 2);
  let z = 0x2545f491;
  const rand = () => { z ^= z << 13; z >>>= 0; z ^= z >>> 17; z ^= z << 5; z >>>= 0; return z / 2147483648 - 1; };
  const zust = [[0, 0], [0, 0]];
  let spitze = 0;
  for (let i = 0; i < frames; i++) {
    const g = Math.exp(-(i % scheibe) / 1200);   // 25 ms time constant: the tail is below -80 dB long before the next burst
    for (let c = 0; c < 2; c++) {
      zust[c][0] += 0.3 * (rand() - zust[c][0]);
      zust[c][1] += 0.3 * (zust[c][0] - zust[c][1]);
      f[2 * i + c] = g * zust[c][1];
      spitze = Math.max(spitze, Math.abs(f[2 * i + c]));
    }
  }
  for (let i = 0; i < f.length; i++) f[i] *= 0.7 / spitze;   // peak 0.7, below the 1.0 where Crush clamps
  fs.mkdirSync(path.join(ordner, name), { recursive: true });
  fs.writeFileSync(path.join(ordner, name, 'loop.f32'), Buffer.from(f.buffer));
  fs.writeFileSync(path.join(ordner, name, 'loop.json'), JSON.stringify({ schema: 1, bpm: 128, beats, frames, datei: 'loop.f32', quelle: 'test', erstellt: '2026-11-16T10:00:00Z' }));
}

// interleaved stereo x (reference) and y (render): correlation and RMS level over the overlap at lag `l` (y[i + l] against x[i])
function vergleich(x, y, l) {
  const n = Math.min(x.length / 2, y.length / 2 - Math.max(l, 0)) - Math.max(-l, 0);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = Math.max(-l, 0); i < n + Math.max(-l, 0); i++) {
    for (let c = 0; c < 2; c++) {
      const a = x[2 * i + c], b = y[2 * (i + l) + c];
      sxy += a * b; sxx += a * a; syy += b * b;
    }
  }
  return { k: sxy / Math.sqrt(sxx * syy), n };
}
function besterLag(x, y) {
  let best = { k: -2, l: 0 };
  for (let l = -LAG_MAX; l <= LAG_MAX; l++) {
    const { k } = vergleich(x, y, l);
    if (k > best.k) best = { k, l };
  }
  return best;
}
const rmsDb = (f) => { let s = 0; for (const v of f) s += v * v; return 10 * Math.log10(s / f.length); };

// The module: 128 BPM, loop 0..beats, the cut in its original order on a workbench track, fader 0 dB (a new track starts at -6). `huellkurven` go into
// the pattern's one command (werkbank_spur_neu) as the page writes them. Renders beats 0..beats of it offline with the cut's own graph folder.
function rendereSchnitt(dir, d, s, huellkurven) {
  let p = { ...neuesProjekt('Sampler render'), werkbank: { schema: 1 } };
  const { befehl, fit } = spurBefehl(s, { projektBpm: 128 });
  assert.equal(fit, 0.5, 'a loop at 128 BPM in a project at 128 BPM needs no FIT');
  if (huellkurven) befehl.huellkurven = huellkurven;
  p = fuehreListeAus(p, [{ befehl: 'tempo_setzen', bpm: 128 }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: s.beats }, befehl]).projekt;
  p = fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: p.spuren[0].id, fader_db: 0 }]).projekt;
  const g = pruefeProjekt(JSON.parse(JSON.stringify(p)));
  assert.ok('projekt' in g, JSON.stringify(g));
  const pj = path.join(dir, 'project.json'), aus = path.join(dir, 'aus.wav');
  fs.writeFileSync(pj, JSON.stringify(g.projekt));
  const env = saubereUmgebung(dir);
  fs.mkdirSync(env.HOME, { recursive: true });
  const r = spawnSync(process.execPath, [WERKZEUG, '--projekt', pj, '--aus', aus, '--von-beat', '0', '--bis-beat', String(s.beats), '--bk-ordner', d.bk],
    { env: { ...env, CYPHERDJ_RENDER: RENDER }, encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const z = JSON.parse(r.stdout.trim().split('\n').at(-1));
  assert.equal(z.frames, s.frames, 'the render is exactly one loop long');
  return { z, y: leseWavF32(aus).daten };
}
const schnittAudio = (d, s) => new Float32Array(fs.readFileSync(path.join(d.bk, 'samples', `smp-${s.id}.f32`)).buffer.slice(0));

// Compares the render with the cut (best lag, level without the pan law, worst slice) and prints the line the measurement tables are made of.
function messeSchnitt(s, x, y, z, titel) {
  assert.ok(rmsDb(x) > -80, 'the source loop is silent: nothing to compare');
  const { k, l } = besterLag(x, y);
  const roh = rmsDb(y) - rmsDb(x);
  const dB = roh - PAN_MITTE_DB;
  // largest per-slice relative difference (render without the pan law) outside the last RAMPE frames of every slice, at the best lag
  let schlecht = { i: -1, rel: 0 };
  for (let i = 0; i < s.grenzen.length - 1; i++) {
    const von = s.grenzen[i], bis = Math.max(von + 1, s.grenzen[i + 1] - RAMPE);
    let diff = 0, ref = 0;
    for (let f = von; f < bis; f++) {
      const q = f + l;
      if (q < 0 || q >= s.frames) continue;
      for (let c = 0; c < 2; c++) { const a = x[2 * f + c], b = y[2 * q + c] / Math.SQRT1_2; diff += (a - b) * (a - b); ref += a * a; }
    }
    const rel = ref > 0 ? Math.sqrt(diff / ref) : 0;
    if (rel > schlecht.rel) schlecht = { i, rel };
  }
  console.log(`# loop ${titel}: slices ${s.grenzen.length - 1}, frames ${s.frames}, lag ${l} frames, correlation ${k.toFixed(5)}, `
    + `level ${rmsDb(x).toFixed(2)} dB (cut) ${rmsDb(y).toFixed(2)} dB (render) diff ${roh.toFixed(2)} dB raw, ${dB.toFixed(2)} dB without the centre pan law, worst slice ${schlecht.i + 1} relative error ${schlecht.rel.toFixed(4)}, render peak ${z.spitze_db} dB`);
  return { k, l, dB };
}

test('the original order of a cut renders back to the loop (correlation, level, lag)', { skip: RENDER ? false : 'CYPHERDJ_RENDER not set', timeout: 900_000 }, (t) => {
  assert.ok(fs.existsSync(RENDER), `CYPHERDJ_RENDER must point at a built cypherdj-render (got ${RENDER})`);
  const dir = tmp(t);
  const d = ordner(dir);
  let loopName = SONDE;
  if (SONDE) d.loops = loopOrdnerVorgabe('');   // the library of the user, read only
  else { loopName = 'bursts'; schreibeSyntheseLoop(d.loops, loopName); }

  const s = legeSchnitt({ quelle: { art: 'loop', ref: loopName } }, d);
  const x = schnittAudio(d, s);
  assert.equal(x.length, s.frames * 2);

  const { z, y } = rendereSchnitt(dir, d, s);
  const { k, dB } = messeSchnitt(s, x, y, z, SONDE ? `${loopName} (library)` : 'synthetic bursts');
  assert.ok(Math.abs(dB) <= 1, `level ${dB} dB`);
  assert.ok(k >= 0.98, `correlation ${k}`);
});

// A break: eight band-limited noise bursts at irregular frames (off the 1/16 grid, 4 beats at 128 BPM) of different strength, each decaying with a 25 ms time
// constant, different noise on the two channels. The first burst sits at frame 0, which the detector cannot see (it needs a run-in): the first slice has it.
const BRUCH = [[0, 1], [11000, 0.35], [22500, 1], [30100, 0.55], [45000, 1], [61000, 0.3], [75500, 1], [83000, 0.5]];
function schreibeBruchLoop(ordnerPfad, name) {
  const beats = 4, frames = beats * 22500, f = new Float32Array(frames * 2);
  let z = 0x2545f491;
  const rand = () => { z ^= z << 13; z >>>= 0; z ^= z >>> 17; z ^= z << 5; z >>>= 0; return z / 2147483648 - 1; };
  const zust = [[0, 0], [0, 0]];
  let spitze = 0, b = 0;
  for (let i = 0; i < frames; i++) {
    while (b + 1 < BRUCH.length && i >= BRUCH[b + 1][0]) b++;
    const g = BRUCH[b][1] * Math.exp(-(i - BRUCH[b][0]) / 1200);
    for (let c = 0; c < 2; c++) {
      zust[c][0] += 0.3 * (rand() - zust[c][0]);
      zust[c][1] += 0.3 * (zust[c][0] - zust[c][1]);
      f[2 * i + c] = g * zust[c][1];
      spitze = Math.max(spitze, Math.abs(f[2 * i + c]));
    }
  }
  for (let i = 0; i < f.length; i++) f[i] *= 0.7 / spitze;
  fs.mkdirSync(path.join(ordnerPfad, name), { recursive: true });
  fs.writeFileSync(path.join(ordnerPfad, name, 'loop.f32'), Buffer.from(f.buffer));
  fs.writeFileSync(path.join(ordnerPfad, name, 'loop.json'), JSON.stringify({ schema: 1, bpm: 128, beats, frames, datei: 'loop.f32', quelle: 'test', erstellt: '2026-11-16T10:00:00Z' }));
}

test('a break cut at its hits plays in its original order', { skip: RENDER ? false : 'CYPHERDJ_RENDER not set', timeout: 900_000 }, (t) => {
  assert.ok(fs.existsSync(RENDER), `CYPHERDJ_RENDER must point at a built cypherdj-render (got ${RENDER})`);
  const dir = tmp(t);
  const d = ordner(dir);
  let loopName = SONDE;
  if (SONDE) d.loops = loopOrdnerVorgabe('');   // the library of the user, read only
  else { loopName = 'break'; schreibeBruchLoop(d.loops, loopName); }

  const s = legeSchnitt({ quelle: { art: 'loop', ref: loopName }, methode: 'anschlag' }, d);
  assert.equal(s.methode, 'anschlag');
  assert.ok(s.grenzen.length - 1 >= 7, `the cut has ${s.grenzen.length - 1} slices`);
  if (!SONDE) {   // the hits of the synthetic break: the markers sit on its bursts, not on the 1/16 grid
    for (const [i, [f]] of BRUCH.slice(1).entries()) assert.ok(Math.abs(s.grenzen[i + 1] - f) <= 64, `marker ${i + 1} at ${s.grenzen[i + 1]}, burst at ${f}`);
    assert.ok(s.guete.some((g) => g.raster_abstand_beats !== 0), 'a hit cut has markers off the grid');
  }
  const x = schnittAudio(d, s);
  const { z, y } = rendereSchnitt(dir, d, s);
  const { k, dB } = messeSchnitt(s, x, y, z, `${SONDE ? `${loopName} (library)` : 'synthetic break'} at its hits`);
  assert.ok(Math.abs(dB) <= 1, `level ${dB} dB`);
  assert.ok(k >= 0.98, `correlation ${k}`);
});

// A 480 Hz sine over 4 beats (period 100 frames, the same on both channels): the rate of a hit is readable from its zero crossings
function schreibeSinus(ordnerPfad, name) {
  const beats = 4, frames = beats * 22500, f = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) f[2 * i] = f[2 * i + 1] = 0.7 * Math.sin(2 * Math.PI * 480 * i / 48000);
  fs.mkdirSync(path.join(ordnerPfad, name), { recursive: true });
  fs.writeFileSync(path.join(ordnerPfad, name, 'loop.f32'), Buffer.from(f.buffer));
  fs.writeFileSync(path.join(ordnerPfad, name, 'loop.json'), JSON.stringify({ schema: 1, bpm: 128, beats, frames, datei: 'loop.f32', quelle: 'test', erstellt: '2026-11-16T10:00:00Z' }));
}
// frequency in Hz of the left channel over frames [von, bis): rising zero crossings, linearly interpolated, first to last
function nulldurchgangHz(y, von, bis) {
  const t = [];
  for (let i = von + 1; i < bis; i++) {
    const a = y[2 * (i - 1)], b = y[2 * i];
    if (a < 0 && b >= 0) t.push(i - 1 - a / (b - a));
  }
  assert.ok(t.length >= 3, `only ${t.length} rising zero crossings in frames ${von}..${bis}`);
  return (t.length - 1) / (t.at(-1) - t[0]) * 48000;
}

test('a PITCH step acts on its own hit and not on the one before', { skip: RENDER ? false : 'CYPHERDJ_RENDER not set', timeout: 900_000 }, (t) => {
  assert.ok(fs.existsSync(RENDER), `CYPHERDJ_RENDER must point at a built cypherdj-render (got ${RENDER})`);
  const dir = tmp(t);
  const d = ordner(dir);
  schreibeSinus(d.loops, 'sinus');
  const s = legeSchnitt({ quelle: { art: 'loop', ref: 'sinus' }, optionen: { scheiben: 16 } }, d);
  assert.equal(s.grenzen.length, 17);
  // Step 4 (beat 1) plays +12 st and step 5 (beat 1.25) -12 st: a jump of 24 st between two neighbouring 1/16 steps. The envelope holds offsets from the
  // Pitch knob at 0.5 (0 st) over the range -12..+12 st: +0.5 is +12, -0.5 is -12. Every other step has offset 0 (the pattern of pitchPunkte).
  const huell = [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0 }, { beat: 1, wert: 0.5, form: 'sprung' }, { beat: 1.25, wert: -0.5, form: 'sprung' }, { beat: 1.5, wert: 0, form: 'sprung' }] }];
  const { z, y } = rendereSchnitt(dir, d, s, huell);
  // the render's lag: the first hit is the unpitched start of the sine, its first frame above 0.02 is at frame 1 of the source (0.7 * sin(2 pi / 100) = 0.044)
  let lag = 0;
  while (lag < 2000 && Math.abs(y[2 * lag]) < 0.02) lag++;
  assert.ok(lag < 2000, 'the render is silent');
  lag -= 1;
  const f = Array.from({ length: 16 }, (_, k) => nulldurchgangHz(y, lag + s.grenzen[k] + 960, lag + s.grenzen[k] + 2400));
  const soll = Array.from({ length: 16 }, (_, k) => (k === 4 ? 960 : k === 5 ? 240 : 480));
  console.log(`# pitch per step: lag ${lag} frames, render peak ${z.spitze_db} dB, frequency of each hit over frames 960..2400 after its start (Hz): ${f.map((v, k) => `${k}:${v.toFixed(1)}`).join(' ')}`);
  console.log(`# pitch per step: expected ${soll.join(' ')}`);
  for (let k = 0; k < 16; k++) assert.ok(Math.abs(f[k] / soll[k] - 1) < 0.02, `hit ${k}: ${f[k].toFixed(2)} Hz, expected ${soll[k]}`);
});
