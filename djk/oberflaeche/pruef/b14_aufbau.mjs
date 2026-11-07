// Package 1.14 slice 4 (bounce) target acceptance (pruef/abnahme_b14.mjs, U5b): material. Only generated test signals, nothing outside --ziel is read or
// written (except the decode-cache entries of the invented shas, see below). 48 kHz, 40 s, stereo, identical in both channels:
//   klick-120.wav  a 2-sample impulse of 0.5 on every beat at 120 BPM (frame 24000 * k), for the null tests and the tempo limit (onsets)
//   sinus-220.wav  a 220 Hz sine of amplitude 0.2 with start phase 0.7 rad (no clip edge on a whole beat falls on a zero crossing)
//   sinus-440/660/880.wav  the c14 sines (amplitude 0.3, phase 0.7, sinusQuelle of pruef/c14_messen.mjs) for the take lanes (case T)
//   stille.wav     40 s of digital silence (case NK2)
// and a catalog with the entries 1..6 (ksha(1) .. ksha(6) of tests/hilfen/katalog.mjs).
// Usage: node pruef/b14_aufbau.mjs --ziel /dev/shm/b14-ziel --instanz <b|d|e>
//   --instanz: removes the entries of ksha(1..6) from the decode cache ~/.cache/cypherdj-<instanz>/arr/audio (the cache is keyed by sha), as c14 does.
//   Other letters are refused (exit 2): the real-core acceptance runs on b, d or e only (the c14 rule).
// Output: one JSON line {katalog, dauer_s, wavs: {name: {pfad, sha, n}}, ...}
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { schreibeWav } from './w1_wav.mjs';
import { baueKatalog, ksha } from '../tests/hilfen/katalog.mjs';
import { sinusQuelle } from './c14_messen.mjs';

let opt;
try { ({ values: opt } = parseArgs({ options: { ziel: { type: 'string' }, instanz: { type: 'string' } } })); } catch (e) {
  process.stderr.write(`${e.message}\n`); process.exit(2);
}
if (!opt.ziel || !opt.instanz) { process.stderr.write('usage: node pruef/b14_aufbau.mjs --ziel <folder> --instanz <b|d|e>\n'); process.exit(2); }
if (!/^[bde]$/.test(opt.instanz)) { process.stderr.write(`--instanz '${opt.instanz}': only b, d or e\n`); process.exit(2); }
const SR = 48000, DAUER_S = 40, FRAMES = DAUER_S * SR, BPM = 120;
fs.mkdirSync(opt.ziel, { recursive: true });
const wav = (name, quelle) => {
  const pfad = path.join(opt.ziel, name), ton = new Float32Array(2 * FRAMES);
  for (let i = 0; i < FRAMES; i++) ton[2 * i] = ton[2 * i + 1] = quelle(i);
  schreibeWav(pfad, ton);
  return pfad;
};
const SCHLAG = 60 * SR / BPM;                                         // 24000 frames per beat at 120 BPM
const klick = (i) => (i % SCHLAG === 0 || i % SCHLAG === 1 ? 0.5 : 0);
const MATERIAL = [
  ['klick-120.wav', klick, 'B14 click 120'],
  ['sinus-220.wav', sinusQuelle(220, 0.2, 0.7), 'B14 sine 220'],
  ['sinus-440.wav', sinusQuelle(440, 0.3, 0.7), 'B14 sine 440'],
  ['sinus-660.wav', sinusQuelle(660, 0.3, 0.7), 'B14 sine 660'],
  ['sinus-880.wav', sinusQuelle(880, 0.3, 0.7), 'B14 sine 880'],
  ['stille.wav', () => 0, 'B14 silence'],
];
const wavs = {};
MATERIAL.forEach(([name, quelle], i) => { wavs[name.replace(/\.wav$/, '')] = { pfad: wav(name, quelle), sha: ksha(i + 1), n: i + 1 }; });
const vorhanden = path.join(opt.ziel, 'katalog.sqlite');
const katalog = fs.existsSync(vorhanden) ? vorhanden : baueKatalog(opt.ziel, MATERIAL.map(([name, , titel], i) => (
  { n: i + 1, typ: 'track', werk_id: i + 1, titel, bpm: BPM, dauer_s: DAUER_S, pfad: path.join(opt.ziel, name) })));
const cache = path.join(process.env.HOME, '.cache', `cypherdj-${opt.instanz}`, 'arr', 'audio');
for (let n = 1; n <= MATERIAL.length; n++) fs.rmSync(path.join(cache, `${ksha(n)}.f32`), { force: true });
process.stdout.write(`${JSON.stringify({ katalog, dauer_s: DAUER_S, bpm: BPM, schlag_frames: SCHLAG, instanz: opt.instanz, cache, wavs })}\n`);
