// Automation slice 1, target acceptance (check/acceptance_a1.mjs): material. A steady 440 Hz sine (amplitude 0.3, 48 kHz, 40 s, stereo) and a catalog with one entry for it,
// so the level of the track meter is a pure function of the fader (base value and lane). The source is generated, nothing outside --ziel is read or written.
// Usage: node check/a1_setup.mjs --ziel /tmp/a1-ziel [--instanz e]
//   --instanz: removes the entry of the invented sha ksha(1) from the decode cache of that test instance (the cache is keyed by sha; an entry left by an earlier test would play foreign material).
// Output: one JSON line {katalog, sha, wav, dauer_s, amplitude}
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { schreibeWav } from './w1_wav.mjs';
import { baueKatalog, ksha } from '../tests/support/catalog.mjs';

const { values: opt } = parseArgs({ options: { ziel: { type: 'string' }, instanz: { type: 'string' } } });
if (!opt.ziel) { process.stderr.write('usage: node check/a1_setup.mjs --ziel <folder> [--instanz a..f]\n'); process.exit(2); }
if (opt.instanz !== undefined && !/^[a-f]$/.test(opt.instanz)) { process.stderr.write(`--instanz '${opt.instanz}': one letter a to f\n`); process.exit(2); }
const AMPLITUDE = 0.3, DAUER_S = 40, FRAMES = DAUER_S * 48000;
fs.mkdirSync(opt.ziel, { recursive: true });
const wav = path.join(opt.ziel, 'sinus.wav'), ton = new Float32Array(2 * FRAMES);
for (let i = 0; i < FRAMES; i++) ton[2 * i] = ton[2 * i + 1] = AMPLITUDE * Math.sin(2 * Math.PI * 440 * i / 48000);
schreibeWav(wav, ton);
// a second, ten times quieter copy (catalog entry 2) for level-dependence diagnoses (Z2 seam)
const wavLeise = path.join(opt.ziel, 'sinus-leise.wav');
for (let i = 0; i < FRAMES; i++) ton[2 * i] = ton[2 * i + 1] = AMPLITUDE / 10 * Math.sin(2 * Math.PI * 440 * i / 48000);
schreibeWav(wavLeise, ton);
// idempotent: an existing catalog (possibly open in a running test instance) is kept, it is built from the same lines
const vorhanden = path.join(opt.ziel, 'katalog.sqlite');
const katalog = fs.existsSync(vorhanden) ? vorhanden : baueKatalog(opt.ziel, [{ n: 1, typ: 'track', werk_id: 1, titel: 'A1 sine', bpm: 120, dauer_s: DAUER_S, pfad: wav }, { n: 2, typ: 'track', werk_id: 2, titel: 'A1 sine quiet', bpm: 120, dauer_s: DAUER_S, pfad: wavLeise }]);
if (opt.instanz) for (const n of [1, 2]) fs.rmSync(path.join(process.env.HOME, '.cache', `cypherdj-${opt.instanz}`, 'arr', 'audio', `${ksha(n)}.f32`), { force: true });
process.stdout.write(`${JSON.stringify({ katalog, sha: ksha(1), sha_leise: ksha(2), wav, wav_leise: wavLeise, dauer_s: DAUER_S, amplitude: AMPLITUDE })}\n`);
