// Paket 1.13 Warp, Slice 1: Material für die Zielabnahme (pruef/abnahme_w1.mjs): zwei 125-BPM-Loops zu zwei Takten (3,84 s, 48 kHz Stereo Float) und ein
// Katalog, der sie als loop mit bpm 125, takte 2, dauer_s 3.84 führt.
//   klick125.wav   ein Klick (ein Sample, 0,8) auf jedem der 8 Beats, 1000 Frames hinter dem Beat-Anfang (Abstand 23 040 Frames). Nicht auf dem Beat selbst: der Export beginnt
//                  auf dem Einsatz-Sample, ein Klick auf Frame 0 läge auf Index 0 des WAV, am Rand, wo jede Messung und jede Einblende am empfindlichsten ist (Prüfung 2, MAJOR 1)
//   sinus125.wav   Sinus 1000 Hz, Pegel 0,4
// Aufruf: node pruef/w1_aufbau.mjs --ziel /tmp/w1-ziel      Ausgabe: JSON {katalog, sha_klick, sha_sinus, dauer_s, klick_vor_frames}
// Danach startet die Hauptinstanz die Prüfinstanz mit diesem Katalog (CYPHERDJ_KATALOG=<katalog> djk-start ..., Task 15 Step 0), nie den Betrieb und nie g, h, i.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { schreibeWav } from './w1_wav.mjs';
import { baueKatalog, ksha } from '../tests/hilfen/katalog.mjs';

const { values: opt } = parseArgs({ options: { ziel: { type: 'string' } } });
if (!opt.ziel) { process.stderr.write('Aufruf: node pruef/w1_aufbau.mjs --ziel <Ordner>\n'); process.exit(2); }
fs.mkdirSync(opt.ziel, { recursive: true });
const FRAMES = 8 * 23040, FPB = 23040, VOR = 1000;   // VOR: Abstand des Klicks hinter dem Beat-Anfang in Frames
const klick = new Float32Array(2 * FRAMES), sinus = new Float32Array(2 * FRAMES);
for (let k = 0; k < 8; k++) klick[2 * (k * FPB + VOR)] = klick[2 * (k * FPB + VOR) + 1] = 0.8;
for (let i = 0; i < FRAMES; i++) sinus[2 * i] = sinus[2 * i + 1] = 0.4 * Math.sin(2 * Math.PI * 1000 * i / 48000);
const pfadKlick = path.join(opt.ziel, 'klick125.wav'), pfadSinus = path.join(opt.ziel, 'sinus125.wav');
schreibeWav(pfadKlick, klick); schreibeWav(pfadSinus, sinus);
const katalog = baueKatalog(opt.ziel, [
  { n: 1, typ: 'loop', bpm: 125, takte: 2, pack: 'W1', dauer_s: FRAMES / 48000, pfad: pfadKlick },
  { n: 2, typ: 'loop', bpm: 125, takte: 2, pack: 'W1', dauer_s: FRAMES / 48000, pfad: pfadSinus },
]);
process.stdout.write(`${JSON.stringify({ katalog, sha_klick: ksha(1), sha_sinus: ksha(2), dauer_s: FRAMES / 48000, klick_vor_frames: VOR })}\n`);
