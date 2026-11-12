// Task 3 of the base-for-new-users plan: djk/starter/render_project.ts renders a small project offline through the export path.
// The real render runs from CYPHERDJ_RENDER (a missing program is a failure here, never a skip); the kit comes from a throw-away HOME
// that the test fills with the starter itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saubereUmgebung } from './support/environment.mjs';

const DJK = path.resolve(import.meta.dirname, '..', '..');
const WERKZEUG = path.join(DJK, 'starter', 'render_project.ts');
const ATTRAPPE = path.join(import.meta.dirname, 'support', 'render_mock.mjs');
// Default as in paths.ts renderProgramm(): the kern build folder of this checkout. A missing program stays a failure, never a skip.
const RENDER = process.env.CYPHERDJ_RENDER || path.join(import.meta.dirname, '..', '..', 'core', 'build', 'cypherdj-render');

const tmp = (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-starter-render-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};

function projekt(kit) {
  const noten = [];
  let n = 0;
  const note = (beat, ton) => noten.push({ id: `n${++n}`, beat, laenge: 0.25, ton, vel: 100 });
  for (let b = 0; b < 16; b++) {
    note(b, 36);
    if (b % 4 === 1 || b % 4 === 3) note(b, 39);
    note(b + 0.5, 42);
  }
  return {
    format: 'cypherdj-projekt/2', name: 'Proof', rev: 1, wiedergabe_rev: 1, tempo_bpm: 128, taktart: [4, 4],
    loop: { an: false, von_beat: 0, bis_beat: 16 }, metronom: { an: false, pegel_db: -12, ziel: 'master' },
    gruppen: [], master: { fader_db: 0 },
    spuren: [{ id: 's1', nr: 1, name: 'Drums', farbe: '#e0563b', art: 'instrument', geraet: { art: 'intern', name: 'kit', kit },
      fader_db: 0, pan: 0, mute: false, solo: false, von: 'andreas',
      clips: [{ id: 'c1', art: 'midi', name: 'beat', start_beat: 0, laenge_beats: 16, noten }] }],
  };
}

const lauf = (env, args) => spawnSync(process.execPath, [WERKZEUG, ...args], { env, encoding: 'utf8' });
const zeile = (r) => JSON.parse(r.stdout.trim().split('\n').at(-1));

function wavRms(datei) {
  const b = fs.readFileSync(datei);
  let pos = 12, fmt = null, daten = null;
  while (pos + 8 <= b.length) {
    const k = b.toString('latin1', pos, pos + 4), g = b.readUInt32LE(pos + 4);
    if (k === 'fmt ') fmt = { format: b.readUInt16LE(pos + 8), kanaele: b.readUInt16LE(pos + 10), bits: b.readUInt16LE(pos + 22) };
    if (k === 'data') daten = b.subarray(pos + 8, pos + 8 + g);
    pos += 8 + g + (g & 1);
  }
  assert.equal(fmt.format, 3); assert.equal(fmt.bits, 32);
  const f = new Float32Array(daten.buffer.slice(daten.byteOffset, daten.byteOffset + daten.length - (daten.length % 4)));
  let s = 0;
  for (const x of f) s += x * x;
  return 20 * Math.log10(Math.sqrt(s / f.length));
}

// Starter kits into a throw-away HOME, once for the real-render tests.
function mitStarter(t) {
  const dir = tmp(t);
  const env = saubereUmgebung(dir);
  const kits = path.join(dir, 'kits'), bk = path.join(dir, 'modular');
  fs.mkdirSync(env.HOME, { recursive: true });
  const py = process.env.CYPHERDJ_PYTHON ?? 'python3';
  const r = spawnSync('bash', [path.join(DJK, 'start', 'djk-starter'), '--nur', 'kits'],
    { env: { ...env, CYPHERDJ_PYTHON: py, CYPHERDJ_KIT_ORDNER: kits, CYPHERDJ_BK_ORDNER: bk }, encoding: 'utf8' });
  assert.equal(r.status, 0, `starter: ${r.stdout}\n${r.stderr}`);
  return { dir, env, kits, bk };
}

test('real render: kit starter plays 16 beats at 128 BPM, audible and not clipped', { timeout: 600_000 }, (t) => {
  assert.ok(RENDER && fs.existsSync(RENDER), `CYPHERDJ_RENDER must point at a built cypherdj-render (got ${RENDER})`);
  const { dir, env, kits, bk } = mitStarter(t);
  const pj = path.join(dir, 'p.json'), aus = path.join(dir, 'aus.wav');
  fs.writeFileSync(pj, JSON.stringify(projekt('starter')));
  const r = lauf({ ...env, CYPHERDJ_RENDER: RENDER },
    ['--projekt', pj, '--aus', aus, '--von-beat', '0', '--bis-beat', '16', '--kit-ordner', kits, '--bk-ordner', bk]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const z = zeile(r);
  assert.equal(z.datei, aus);
  assert.equal(z.frames, 360000);
  assert.ok(z.spitze_db <= -0.1, `spitze_db ${z.spitze_db}`);
  assert.ok(z.rms_db > -60, `rms_db ${z.rms_db}`);
  assert.ok(Math.abs(z.rms_db - wavRms(aus)) < 0.01, 'rms_db is the RMS of the written file');
  console.log(`# measured: frames ${z.frames} rms_db ${z.rms_db} spitze_db ${z.spitze_db}`);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.startsWith('djk-')), [], 'no work folder left in the test dir');
});

test('real render: a kit that does not exist gives 4 with the render reason', { timeout: 600_000 }, (t) => {
  assert.ok(RENDER && fs.existsSync(RENDER), 'CYPHERDJ_RENDER must point at a built cypherdj-render');
  const { dir, env, kits, bk } = mitStarter(t);
  const pj = path.join(dir, 'p.json'), aus = path.join(dir, 'aus.wav');
  fs.writeFileSync(pj, JSON.stringify(projekt('fehlt')));
  const r = lauf({ ...env, CYPHERDJ_RENDER: RENDER },
    ['--projekt', pj, '--aus', aus, '--von-beat', '0', '--bis-beat', '16', '--kit-ordner', kits, '--bk-ordner', bk]);
  assert.equal(r.status, 4, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /fehlt|kit/i);
  console.log('# reason: ' + r.stderr.trim().split('\n').at(-1));
  assert.equal(fs.existsSync(aus), false);
});

test('invalid project gives 2 with the pruefeProjekt reason; unreadable json too', (t) => {
  const dir = tmp(t), env = saubereUmgebung(dir);
  const pj = path.join(dir, 'p.json');
  const kaputt = projekt('starter'); kaputt.format = 'quatsch';
  fs.writeFileSync(pj, JSON.stringify(kaputt));
  const r = lauf({ ...env, CYPHERDJ_RENDER: ATTRAPPE },
    ['--projekt', pj, '--aus', path.join(dir, 'a.wav'), '--von-beat', '0', '--bis-beat', '4']);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /format/);
  fs.writeFileSync(pj, '{nicht json');
  assert.equal(lauf({ ...env, CYPHERDJ_RENDER: ATTRAPPE },
    ['--projekt', pj, '--aus', path.join(dir, 'a.wav'), '--von-beat', '0', '--bis-beat', '4']).status, 2);
});

test('missing render program gives 3', (t) => {
  const dir = tmp(t), env = saubereUmgebung(dir);
  const pj = path.join(dir, 'p.json');
  fs.writeFileSync(pj, JSON.stringify(projekt('starter')));
  const r = lauf({ ...env, CYPHERDJ_RENDER: path.join(dir, 'gibt-es-nicht') },
    ['--projekt', pj, '--aus', path.join(dir, 'a.wav'), '--von-beat', '0', '--bis-beat', '4']);
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /cypherdj-render/);
});

test('attrappe: the command line and the environment carry the export path settings; --nur mutes the others', (t) => {
  const dir = tmp(t), env = saubereUmgebung(dir);
  const pj = path.join(dir, 'p.json'), prot = path.join(dir, 'prot.jsonl'), aus = path.join(dir, 'a.wav');
  const p = projekt('starter');
  p.spuren.push({ ...structuredClone(p.spuren[0]), id: 's2', nr: 2, name: 'Zwei', clips: [] });
  fs.writeFileSync(pj, JSON.stringify(p));
  const kits = path.join(dir, 'k'), bk = path.join(dir, 'b');
  const e = { ...env, CYPHERDJ_RENDER: ATTRAPPE, RENDER_ATTRAPPE_PROTOKOLL: prot, RENDER_ATTRAPPE_MISCHUNG: '1' };
  const r = lauf(e, ['--projekt', pj, '--aus', aus, '--von-beat', '0', '--bis-beat', '4', '--kit-ordner', kits, '--bk-ordner', bk]);
  assert.equal(r.status, 0, r.stderr);
  const a = JSON.parse(fs.readFileSync(prot, 'utf8').trim().split('\n')[0]);
  assert.ok(a.argv.includes('--ohne-zustand'));
  assert.ok(a.argv.includes('--spur-regler'));
  assert.equal(a.argv[a.argv.indexOf('--abgriff') + 1], 'produktion');
  assert.equal(zeile(r).frames, 4 * 60 / 128 * 48000);
  // environment: the attrappe does not log it, so a second probe reads it through a wrapper program
  const sonde = path.join(dir, 'sonde.mjs');
  fs.writeFileSync(sonde, `#!/usr/bin/env node
import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(path.join(dir, 'env.json'))}, JSON.stringify({ kit: process.env.CYPHERDJ_KIT_ORDNER, bk: process.env.CYPHERDJ_BK_ORDNER }));
await import(${JSON.stringify(ATTRAPPE)});
`);
  fs.chmodSync(sonde, 0o755);
  fs.rmSync(aus, { force: true });
  const r2 = lauf({ ...e, CYPHERDJ_RENDER: sonde }, ['--projekt', pj, '--aus', aus, '--von-beat', '0', '--bis-beat', '4', '--kit-ordner', kits, '--bk-ordner', bk]);
  assert.equal(r2.status, 0, r2.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'env.json'), 'utf8')), { kit: kits, bk });
  // --nur s1: the mixer file silences track 2
  fs.rmSync(aus, { force: true }); fs.rmSync(prot, { force: true });
  const r3 = lauf(e, ['--projekt', pj, '--aus', aus, '--von-beat', '0', '--bis-beat', '4', '--nur', 's1']);
  assert.equal(r3.status, 0, r3.stderr);
  const regler = JSON.parse(fs.readFileSync(prot, 'utf8').trim().split('\n')[0]).regler;
  assert.equal(regler['spur/1/mute'], 0);
  assert.equal(regler['spur/2/mute'], 1);
  const r4 = lauf(e, ['--projekt', pj, '--aus', path.join(dir, 'b.wav'), '--von-beat', '0', '--bis-beat', '4', '--nur', 'gibts-nicht']);
  assert.equal(r4.status, 2, r4.stderr);
});

test('the work folder is removed after a failed render', (t) => {
  const dir = tmp(t), env = saubereUmgebung(dir);
  const pj = path.join(dir, 'p.json');
  fs.writeFileSync(pj, JSON.stringify(projekt('starter')));
  const tmpDir = path.join(dir, 'tmpdir'); fs.mkdirSync(tmpDir);
  const r = lauf({ ...env, TMPDIR: tmpDir, CYPHERDJ_RENDER: ATTRAPPE, RENDER_ATTRAPPE_RC: '4' },
    ['--projekt', pj, '--aus', path.join(dir, 'a.wav'), '--von-beat', '0', '--bis-beat', '4']);
  assert.equal(r.status, 4, r.stderr);
  assert.deepEqual(fs.readdirSync(tmpDir), []);
});
