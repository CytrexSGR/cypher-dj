// AK33 M2: calibrated test material for "a dragged warp marker is click-free and the other markers stay on the grid".
//   clicks64.wav   64 beats at 120 BPM (32 s, 48 kHz stereo float): a Hann-windowed 1 kHz burst (145 samples, cosine carrier, amplitude 0.8) centred EXACTLY on
//                  source sample 24000 * k for k = 1..63 (beat k of the source, none at beat 0 so no click sits on index 0). The centre of energy of each burst is
//                  therefore known to the sample; this is the signal the earlier acceptance runs used for the 24-sample limit (D6), not a one-sample click.
//   tone64.wav     steady 440 Hz sine, amplitude 0.3, 32 s (seam measurement: a warp without artefacts leaves a steady tone)
//   tonesprung64.wav  the same tone with a 180 degree phase flip 27 samples after source second 10.05 (the source point the drag puts on beat 20), where the sine is
//                  near a crest: the positive control, a seam that the measurement MUST see
// Catalog: three loops (bpm 120, takte 16, 32 s), so Auto-Warp "takte" gives two markers (0,0) and (32 s, beat 64).
// Call: node check/ak33_m2_setup.mjs --ziel /dev/shm/b1-ziel/m2 [--instanz e]   Output: JSON {katalog, sha_klick, sha_ton, sha_sprung, dauer_s}
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { schreibeWav } from './w1_wav.mjs';
import { baueKatalog, ksha } from '../tests/support/catalog.mjs';

const { values: opt } = parseArgs({ options: { ziel: { type: 'string' }, instanz: { type: 'string' } } });
if (!opt.ziel || !/^\/(tmp|dev\/shm)\//.test(path.resolve(opt.ziel))) { process.stderr.write('Call: --ziel <folder under /tmp or /dev/shm> [--instanz e]\n'); process.exit(2); }
fs.mkdirSync(opt.ziel, { recursive: true });
import { klickSignal, tonSignal } from './ak33_m2_measure.mjs';
if (import.meta.url === `file://${process.argv[1]}`) {
  const p = (n) => path.join(opt.ziel, n);
  schreibeWav(p('clicks64.wav'), klickSignal()); schreibeWav(p('tone64.wav'), tonSignal()); schreibeWav(p('tonesprung64.wav'), tonSignal(10.05));
  const katalog = baueKatalog(opt.ziel, [
    { n: 11, typ: 'loop', bpm: 120, takte: 16, pack: 'AK33', dauer_s: 32, pfad: p('clicks64.wav') },
    { n: 12, typ: 'loop', bpm: 120, takte: 16, pack: 'AK33', dauer_s: 32, pfad: p('tone64.wav') },
    { n: 13, typ: 'loop', bpm: 120, takte: 16, pack: 'AK33', dauer_s: 32, pfad: p('tonesprung64.wav') },
  ]);
  if (opt.instanz) for (const n of [11, 12, 13]) fs.rmSync(path.join(process.env.HOME, '.cache', `cypherdj-${opt.instanz}`, 'arr', 'audio', `${ksha(n)}.f32`), { force: true });
  process.stdout.write(`${JSON.stringify({ katalog, sha_klick: ksha(11), sha_ton: ksha(12), sha_sprung: ksha(13), dauer_s: 32 })}\n`);
}
