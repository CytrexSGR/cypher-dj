// The catalog djk-bibliothek builds is read by the page (catalog.ts): lists, tree, search, material id, schema check.
// The builder runs as a spawned process with a clean environment (HOME inside tmp, no CYPHERDJ_* variable).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Katalog, katalogVorgabe } from '../catalog.ts';
import { saubereUmgebung } from './support/environment.mjs';

const DJK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OBERFLAECHE = path.join(DJK, 'ui');
const PYTHON = process.env.CYPHERDJ_PYTHON || 'python3';
const kannBauen = spawnSync(PYTHON, ['-c', 'import bibliothek.katalog_bau'], { cwd: DJK, env: { ...saubereUmgebung(os.tmpdir()), PYTHONPATH: DJK } }).status === 0;

function wav(n, frames = 400) {
  const b = Buffer.alloc(44 + frames * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + frames * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) b.writeInt16LE(i === 0 ? n : (n * 37 + i * 11) % 2000 - 1000, 44 + i * 2);
  return b;
}

const BAUE = `
import sys, json
from pathlib import Path
from bibliothek.konfig import Konfig, Wurzel
from bibliothek.merkmale import MerkmalCache
from bibliothek.katalog_bau import baue
w, ziel, cache = sys.argv[1:4]
r = baue(Path(ziel), Konfig(1, [Wurzel(Path(w), 'auto')]), MerkmalCache(Path(cache)), False, lambda n: None)
print(json.dumps(r.zeilen))
`;

test('djk-bibliothek catalog: the page reads lists, tree, search and material id', { skip: !kannBauen && 'python has no bibliothek dependencies (set CYPHERDJ_PYTHON)' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-biblkat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const wurzel = path.join(dir, 'musik');
  for (const [rel, n, frames] of [['Loops/DT_126_Groove.wav', 1, 8000], ['Loops/Bass 124bpm.wav', 2, 8000], ['Drums/Kick 01.wav', 3, 400], ['Drums/Snare 01.wav', 4, 400]]) {
    fs.mkdirSync(path.dirname(path.join(wurzel, rel)), { recursive: true });
    fs.writeFileSync(path.join(wurzel, rel), wav(n, frames));
  }
  // a tagged track: a FLAC is not needed, a long WAV with the word Wolf in its name is found through the name
  fs.mkdirSync(path.join(wurzel, 'Music'), { recursive: true });
  fs.writeFileSync(path.join(wurzel, 'Music', 'Alpha - Tech Wolf.wav'), wav(5, 8000 * 70));
  const ziel = path.join(dir, 'ziel', 'katalog.sqlite');
  const env = { ...saubereUmgebung(dir), PYTHONPATH: DJK };
  const aus = execFileSync(PYTHON, ['-c', BAUE, wurzel, ziel, path.join(dir, 'cache.sqlite')], { cwd: DJK, env, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(aus), { track: 1, loop: 2, oneshot: 2 });

  const k = new Katalog(ziel);  // catalog.ts:89 schema check runs inside every call
  const loops = k.seite('loop', {}, 'name', false, 0, 100);
  assert.equal(loops.gesamt, 2);
  assert.deepEqual(loops.zeilen.map((z) => z.name), ['Bass 124bpm', 'DT_126_Groove']);
  assert.match(loops.gebaut_am, /^\d{4}-\d\d-\d\dT/);
  const baum = k.baum('oneshot');
  assert.deepEqual(baum.facetten.pack, [{ wert: 'Drums', n: 2 }]);
  assert.deepEqual(baum.facetten.instrument.map((f) => f.wert).sort(), ['kick', 'snare']);
  const treffer = k.seite('track', { text: 'Wolf' }, 'titel', false, 0, 100);
  assert.equal(treffer.gesamt, 1);
  const z = treffer.zeilen[0];
  assert.equal(z.pfad, path.join(wurzel, 'Music', 'Alpha - Tech Wolf.wav'));
  assert.equal(k.eintragMid(z.sha.slice(0, 16)).sha, z.sha);
  assert.equal(k.seite('oneshot', { text: 'kick' }, 'name', false, 0, 100).gesamt, 1);
});

test('djk-bibliothek: katalog_ziel equals katalogVorgabe(MEDIATHEK_VORGABE) in three environments', { skip: !kannBauen && 'python has no bibliothek dependencies (set CYPHERDJ_PYTHON)' }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-biblziel-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const NODE = `import { katalogVorgabe } from './catalog.ts'; import { MEDIATHEK_VORGABE } from './media_library.ts'; process.stdout.write(katalogVorgabe(MEDIATHEK_VORGABE));`;
  const PY = `import os; from bibliothek.konfig import katalog_ziel; print(katalog_ziel(os.environ), end='')`;
  for (const extra of [{}, { CYPHERDJ_MEDIATHEK: '/x/m.sqlite' }, { CYPHERDJ_MEDIATHEK: '/x/m.sqlite', CYPHERDJ_KATALOG: '/y/k.sqlite' }]) {
    const env = { ...saubereUmgebung(dir), ...extra };
    const ts = execFileSync(process.execPath, ['--input-type=module', '-e', NODE], { cwd: OBERFLAECHE, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const py = execFileSync(PYTHON, ['-c', PY], { cwd: DJK, env: { ...env, PYTHONPATH: DJK }, encoding: 'utf8' });
    assert.equal(py, ts, JSON.stringify(extra));
  }
  assert.equal(typeof katalogVorgabe, 'function');
});

// Kanban t_747a905b: '..' behind a symlinked folder is resolved by the kernel, as the builder does (kanonisch), not textually
test('katalogVorgabe resolves a link before .. like the builder does', (t) => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'katalogpfad-')));
  t.after(() => fs.rmSync(tmp, { recursive: true }));
  fs.mkdirSync(path.join(tmp, 'echt', 'sub'), { recursive: true });
  fs.symlinkSync(path.join(tmp, 'echt', 'sub'), path.join(tmp, 'link'));
  const alt = process.env.CYPHERDJ_KATALOG;
  delete process.env.CYPHERDJ_KATALOG;
  try {
    assert.equal(katalogVorgabe(`${tmp}/link/../m.sqlite`)  /* a string, path.join would collapse the .. */, path.join(tmp, 'echt', 'katalog.sqlite'));
    assert.equal(katalogVorgabe(path.join(tmp, 'echt', 'm.sqlite')), path.join(tmp, 'echt', 'katalog.sqlite'));
    assert.equal(katalogVorgabe(path.join(tmp, 'gibt-es-nicht', 'm.sqlite')), path.join(tmp, 'gibt-es-nicht', 'katalog.sqlite'));
  } finally { if (alt !== undefined) process.env.CYPHERDJ_KATALOG = alt; }
});
