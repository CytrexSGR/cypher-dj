// Fixture of the tag end-to-end probe: a catalogue of 200 mixed rows (100 loops, 40 one-shots, 58 tracks, 2 MIDI rows) in the format of
// bibliothek/catalog_build.py (its DDL is used through Python, not copied), real short wav files for 30 loops, and the Python hook run.
// Python is the venv of djk/workshop (DJK_PYTHON overrides; a worktree without its own venv uses the one of the main checkout).
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DJK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// A worktree lives at <main checkout>/.claude/worktrees/<name>; the main checkout is derived from the repo path, not hard-coded.
const HAUPT = DJK.includes(`${path.sep}.claude${path.sep}worktrees${path.sep}`) ? path.join(DJK.split(`${path.sep}.claude${path.sep}worktrees${path.sep}`)[0], 'djk') : DJK;
const VENV = [path.join(DJK, 'workshop/.venv/bin/python'), path.join(HAUPT, 'workshop/.venv/bin/python')];
export const PYTHON = process.env.DJK_PYTHON ?? VENV.find((p) => fs.existsSync(p)) ?? 'python3';
export const sha = (n) => crypto.createHash('sha256').update(`tags-e2e-${n}`).digest('hex');
export const itemVon = (n) => `datei:${sha(n)}`;

const SR = 44100;
function wav(pfad, samples) {
  const daten = Buffer.alloc(44 + samples.length * 2);
  daten.write('RIFF', 0); daten.writeUInt32LE(36 + samples.length * 2, 4); daten.write('WAVEfmt ', 8); daten.writeUInt32LE(16, 16);
  daten.writeUInt16LE(1, 20); daten.writeUInt16LE(1, 22); daten.writeUInt32LE(SR, 24); daten.writeUInt32LE(SR * 2, 28); daten.writeUInt16LE(2, 32); daten.writeUInt16LE(16, 34);
  daten.write('data', 36); daten.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => daten.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32000), 44 + i * 2));
  fs.writeFileSync(pfad, daten);
}
// three kinds of signal: a decaying 55 Hz sine (a kick for the rules), a noise burst through a crude high-pass (a hat), a steady 440 Hz tone
function signal(art, sekunden = 1) {
  const n = Math.floor(SR * sekunden);
  const aus = new Float32Array(n);
  let zufall = 12345, vor = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if (art === 'kick') aus[i] = 0.9 * Math.sin(2 * Math.PI * 55 * t) * Math.exp(-t * 4);
    else if (art === 'hat') { zufall = (zufall * 1103515245 + 12345) & 0x7fffffff; const r = zufall / 0x3fffffff - 1; aus[i] = 0.5 * (r - vor) * Math.exp(-t * 20); vor = r; }
    else aus[i] = 0.4 * Math.sin(2 * Math.PI * 440 * t);
  }
  return aus;
}

const KLASSEN = ['kick', 'bass', 'pad', 'snare', 'synth'];
const GENRES = ['Techno', 'House', 'Deep House', 'Trance'];

// Returns { dir, katalog, tags, zeilen, loops }. Loops 0..99: every 5th has no bpm, every 3rd a catalogue instrument; the first 30 loops
// without an instrument get a real wav.
export async function baueFixture(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tags-e2e-'))) {
  const audio = path.join(dir, 'audio');
  fs.mkdirSync(audio, { recursive: true });
  const zeilen = [];
  let n = 0, mitWav = 0;
  const neu = (z) => { const r = { n: n++, sha: sha(n - 1), shas: '[]', ...z }; zeilen.push(r); return r; };
  for (let i = 0; i < 100; i++) {
    const instrument = i % 3 === 0 ? KLASSEN[(i / 3) % KLASSEN.length] : null;
    const r = neu({ typ: 'loop', name: `loop ${i}`, titel: '', pfad: path.join(audio, `loop${i}.wav`), bpm: i % 5 === 0 ? null : 120 + (i % 40), camelot: i % 4 === 0 ? `${1 + (i % 12)}${i % 8 === 0 ? 'A' : 'B'}` : null,
      energie: i % 7 === 0 ? 6 : null, instrument, genre: GENRES[i % GENRES.length] });
    if (instrument === null && mitWav < 30) { wav(r.pfad, signal(['kick', 'hat', 'ton'][mitWav % 3])); r.wav = ['kick', 'hat', 'ton'][mitWav % 3]; mitWav++; }
  }
  for (let i = 0; i < 40; i++) neu({ typ: 'oneshot', name: `shot ${i}`, titel: '', pfad: path.join(audio, `shot${i}.wav`), bpm: null, camelot: null, energie: null, instrument: i % 2 ? 'snare' : null, genre: null });
  for (let i = 0; i < 58; i++) neu({ typ: 'track', name: `track ${i}`, titel: `Track ${i}`, pfad: path.join(audio, `track${i}.flac`), bpm: 124 + (i % 10), camelot: `${1 + (i % 12)}A`, energie: 1 + (i % 9), instrument: null, genre: GENRES[i % GENRES.length] });
  for (let i = 0; i < 2; i++) neu({ typ: 'midi', name: `midi ${i}`, titel: '', pfad: path.join(audio, `m${i}.mid`), bpm: null, camelot: null, energie: null, instrument: null, genre: null });
  const katalog = path.join(dir, 'katalog.sqlite');
  const code = `
import json, sqlite3, sys
from bibliothek import katalog_bau
zeilen = json.load(sys.stdin)
db = sqlite3.connect(sys.argv[1])
db.executescript(katalog_bau.DDL)
db.execute("INSERT INTO stand VALUES ('erbauer', ?)", (katalog_bau.ERBAUER,))
for z in zeilen:
    z.pop('n', None); z.pop('wav', None)
    db.execute("INSERT INTO katalog(%s) VALUES (%s)" % (",".join(z), ",".join("?" * len(z))), list(z.values()))
db.commit()
`;
  await python(['-c', code, katalog], JSON.stringify(zeilen));
  return { dir, katalog, tags: path.join(dir, 'tags.sqlite'), zeilen, loops: zeilen.filter((z) => z.typ === 'loop') };
}

export function python(args, stdin = '', env = {}) {
  return new Promise((ok, fehl) => {
    const k = execFile(PYTHON, args, { cwd: DJK, env: { ...process.env, ...env }, maxBuffer: 1 << 24, timeout: 600000 }, (e, aus, err) => {
      if (e && typeof e.code !== 'number') return fehl(e);
      ok({ code: e ? e.code : 0, aus, err });
    });
    k.stdin.end(stdin);
  });
}

// The hook exactly as the job starts it (without ionice: the test scope is already memory-capped; the hook calls os.nice(19) itself)
export const hook = (f, extra = []) => python(['-m', 'bibliothek.tags_measure', '--katalog', f.katalog, '--tags', f.tags, ...extra], '', { CYPHERDJ_KATALOG: f.katalog });

// klasse_aus of the real wav files, as the Python rules see them (the expected `typ:` of loops without a catalogue instrument)
export async function klassenDerWavs(pfade) {
  const code = `
import json, sys
from pathlib import Path
from bibliothek import tags_merkmale as tm
aus = {}
for p in json.load(sys.stdin):
    m = tm.merkmale_von(Path(p))
    aus[p] = tm.klasse_aus(m, 'loop') if m else None
print(json.dumps(aus))
`;
  const r = await python(['-c', code], JSON.stringify(pfade));
  return JSON.parse(r.aus);
}
