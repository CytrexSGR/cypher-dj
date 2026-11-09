// Comping 1.14 target acceptance (check/acceptance_c14.mjs): material. Three steady sines, one per take (t1 440 Hz, t2 660 Hz, t3 880 Hz, amplitude 0.3, 48
// kHz, 40 s,
// stereo, identical in both channels) and a catalog with one entry each. The sines carry a start phase of 0.7 rad, so no clip boundary at a whole beat
// falls on a zero
// crossing (a sine without phase is exactly 0 at every beat of 120 BPM, which would hide the first frame of a clip). Which take sounds where is read from the
// frequency (least-squares fit, check/c14_measure.mjs). The sources are generated, nothing outside --ziel is read or written.
// Usage: node check/c14_setup.mjs --ziel /dev/shm/c14-ziel [--instanz e]
//   --instanz: removes the entries of the invented shas ksha(1), ksha(2), ksha(3) from the decode cache of that test instance (the cache is keyed by sha).
// Output: one JSON line {katalog, sha_t1, sha_t2, sha_t3, wav_t1, wav_t2, wav_t3, dauer_s, amplitude, phase, freq_t1, freq_t2, freq_t3}
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { schreibeWav } from './w1_wav.mjs';
import { baueKatalog, ksha } from '../tests/support/catalog.mjs';
import { sinusQuelle } from './c14_measure.mjs';

const { values: opt } = parseArgs({ options: { ziel: { type: 'string' }, instanz: { type: 'string' } } });
if (!opt.ziel) { process.stderr.write('usage: node check/c14_setup.mjs --ziel <folder> [--instanz a..f]\n'); process.exit(2); }
if (opt.instanz !== undefined && !/^[a-f]$/.test(opt.instanz)) { process.stderr.write(`--instanz '${opt.instanz}': one letter a to f\n`); process.exit(2); }
const AMPLITUDE = 0.3, PHASE = 0.7, DAUER_S = 40, FRAMES = DAUER_S * 48000, FREQ = [440, 660, 880];
fs.mkdirSync(opt.ziel, { recursive: true });
const wav = (name, f) => {
  const pfad = path.join(opt.ziel, name), quelle = sinusQuelle(f, AMPLITUDE, PHASE), ton = new Float32Array(2 * FRAMES);
  for (let i = 0; i < FRAMES; i++) ton[2 * i] = ton[2 * i + 1] = quelle(i);
  schreibeWav(pfad, ton);
  return pfad;
};
const wavs = FREQ.map((f) => wav(`sinus-${f}.wav`, f));
const vorhanden = path.join(opt.ziel, 'katalog.sqlite');
const katalog = fs.existsSync(vorhanden) ? vorhanden : baueKatalog(opt.ziel, FREQ.map((f, i) => (
  { n: i + 1, typ: 'track', werk_id: i + 1, titel: `C14 sine ${f}`, bpm: 120, dauer_s: DAUER_S, pfad: wavs[i] })));
if (opt.instanz) {
  for (const n of [1, 2, 3]) fs.rmSync(path.join(process.env.HOME, '.cache', `cypherdj-${opt.instanz}`, 'arr', 'audio', `${ksha(n)}.f32`), { force: true });
}
const aus = { katalog, dauer_s: DAUER_S, amplitude: AMPLITUDE, phase: PHASE };
FREQ.forEach((f, i) => { aus[`sha_t${i + 1}`] = ksha(i + 1); aus[`wav_t${i + 1}`] = wavs[i]; aus[`freq_t${i + 1}`] = f; });
process.stdout.write(`${JSON.stringify(aus)}\n`);
