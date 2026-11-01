// Automation slice 2, target acceptance (pruef/abnahme_a2.mjs): material. Two steady sines (440 Hz and 660 Hz, amplitude 0.3, 48 kHz, 40 s, stereo, identical in both
// channels) and a catalog with one entry each. Two frequencies let one recording tell the two tracks apart (solo, isolation); the level of a track is a pure function of
// fader, pan, mute and solo. The sources are generated, nothing outside --ziel is read or written.
// Usage: node pruef/a2_aufbau.mjs --ziel /dev/shm/a2-ziel [--instanz e]
//   --instanz: removes the entries of the invented shas ksha(1), ksha(2) from the decode cache of that test instance (the cache is keyed by sha).
// Output: one JSON line {katalog, sha_a, sha_b, wav_a, wav_b, dauer_s, amplitude, freq_a, freq_b}
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { schreibeWav } from './w1_wav.mjs';
import { baueKatalog, ksha } from '../tests/hilfen/katalog.mjs';

const { values: opt } = parseArgs({ options: { ziel: { type: 'string' }, instanz: { type: 'string' } } });
if (!opt.ziel) { process.stderr.write('usage: node pruef/a2_aufbau.mjs --ziel <folder> [--instanz a..f]\n'); process.exit(2); }
if (opt.instanz !== undefined && !/^[a-f]$/.test(opt.instanz)) { process.stderr.write(`--instanz '${opt.instanz}': one letter a to f\n`); process.exit(2); }
const AMPLITUDE = 0.3, DAUER_S = 40, FRAMES = DAUER_S * 48000, FREQ_A = 440, FREQ_B = 660;
fs.mkdirSync(opt.ziel, { recursive: true });
const wav = (name, f) => {
  const pfad = path.join(opt.ziel, name), ton = new Float32Array(2 * FRAMES);
  for (let i = 0; i < FRAMES; i++) ton[2 * i] = ton[2 * i + 1] = AMPLITUDE * Math.sin(2 * Math.PI * f * i / 48000);
  schreibeWav(pfad, ton);
  return pfad;
};
const wavA = wav('sinus-440.wav', FREQ_A), wavB = wav('sinus-660.wav', FREQ_B);
const vorhanden = path.join(opt.ziel, 'katalog.sqlite');
const katalog = fs.existsSync(vorhanden) ? vorhanden : baueKatalog(opt.ziel, [
  { n: 1, typ: 'track', werk_id: 1, titel: 'A2 sine 440', bpm: 120, dauer_s: DAUER_S, pfad: wavA },
  { n: 2, typ: 'track', werk_id: 2, titel: 'A2 sine 660', bpm: 120, dauer_s: DAUER_S, pfad: wavB }]);
if (opt.instanz) for (const n of [1, 2]) fs.rmSync(path.join(process.env.HOME, '.cache', `cypherdj-${opt.instanz}`, 'arr', 'audio', `${ksha(n)}.f32`), { force: true });
process.stdout.write(`${JSON.stringify({ katalog, sha: ksha(1), sha_a: ksha(1), sha_b: ksha(2), wav_a: wavA, wav_b: wavB, dauer_s: DAUER_S, amplitude: AMPLITUDE, freq_a: FREQ_A, freq_b: FREQ_B })}\n`);
