// Paket 1.13 Warp, Slice 4: Material für die Zielabnahme (pruef/abnahme_w4.mjs). Fünf Quellen als WAV (Float 32 Bit, 48 kHz, Stereo) und ein Prüf-Katalog, nach dem Muster von
// w3a_aufbau.mjs und w3b_aufbau.mjs. Die Quellen kommen aus pruef/w4_signal.mjs:
//   a   Klickspur 125 BPM auf 1/16, 8 Beats (3,84 s), Ein-Sample-Klicks, erster Klick bei Frame 960 (20 ms: im Inneren der Einheit, nicht auf der Grenze), Loop mit takte 2   (Z1, Z4)
//   a2  Schlagspur, sonst wie a                                                                                                                                         (Z2, Z3)
//   b   Klickspur 128 BPM auf 1/4, 64 Beats (30 s), ±20 ms Zittern (Saat 3), Loop mit takte 16; erster Klick bei 0,5 Beat (11 250 Frames): liegt der Clip auf start_beat 0,5,
//       fällt jeder Klick ohne Zittern auf einen Beat des Projekts, und start_beat 0,5 ist kein Vielfaches von 1/4 (D13)                                                  (Z4, Z5a, Z6, Z7)
//   b2  Burstspur: wie b, aber Rausch-Burst mit 1 ms linearem Anstieg statt Klick (derselbe Zitter-Satz)                                                                  (Z5b)
//   s   Sinus 440 Hz, 8 Beats bei 125 BPM, Loop mit takte 2 (Negativ-Kontrolle Transienten)                                                                               (Z4)
// Der Prüf-Katalog hat je Quelle einen Loop-Eintrag (bpm, takte, dauer_s): der Auto-Warp bildet die ganze Datei exakt auf takte · 4 Beats ab.
// Nur unter /tmp oder /dev/shm (nie der echte Bestand). Aufruf: node pruef/w4_aufbau.mjs --ziel /dev/shm/w4-ziel [--instanz a]
//   --instanz: löscht die Einträge der erfundenen shas im Dekodier-Cache dieser Prüfinstanz (~/.cache/cypherdj-<i>/arr/audio/<sha>.f32), sonst spielt die Abnahme fremdes Material.
// Ausgabe (JSON): { katalog, mediathek, analyse, shas: {a,a2,b,b2,s}, wav: {...}, bpm: {...}, beats: {...}, dauer_s: {...}, lagen: {a,a2,b,b2} (Frames), zittern_ms, seed }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { schreibeWav } from './w1_wav.mjs';
import { baueKatalog, ksha } from '../tests/hilfen/katalog.mjs';
import { baueMarken } from '../tests/hilfen/karte.mjs';
import { klickSpur, schlagSpur, burstSpur, sinusSpur } from './w4_signal.mjs';

const SR = 48000;
// Quellen: Name → { n (Katalog-n, weit weg von w3a), bpm, beats, signal }
const BASIS = 40;
export const QUELLEN = {
  a: { n: BASIS + 1, bpm: 125, beats: 8, takte: 2, erzeuge: (frames) => klickSpur({ bpm: 125, schlaege: 32, raster: 0.25, zittern_ms: 0, seed: 1, vorlauf: 960, frames }) },
  a2: { n: BASIS + 2, bpm: 125, beats: 8, takte: 2, erzeuge: (frames) => schlagSpur({ bpm: 125, schlaege: 32, raster: 0.25, zittern_ms: 0, seed: 1, vorlauf: 960, frames }) },
  b: { n: BASIS + 3, bpm: 128, beats: 64, takte: 16, erzeuge: (frames) => klickSpur({ bpm: 128, schlaege: 64, raster: 1, zittern_ms: 20, seed: 3, vorlauf: 11250, frames }) },
  b2: { n: BASIS + 4, bpm: 128, beats: 64, takte: 16, erzeuge: (frames) => burstSpur({ bpm: 128, schlaege: 64, raster: 1, zittern_ms: 20, seed: 3, vorlauf: 11250, frames }) },
  s: { n: BASIS + 5, bpm: 125, beats: 8, takte: 2, erzeuge: (frames) => sinusSpur({ frames, hz: 440 }) },
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values: opt } = parseArgs({ options: { ziel: { type: 'string' }, instanz: { type: 'string' } } });
  if (!opt.ziel) { process.stderr.write('Aufruf: node pruef/w4_aufbau.mjs --ziel <Ordner> [--instanz a]\n'); process.exit(2); }
  if (!/^\/(tmp|dev\/shm)\//.test(path.resolve(opt.ziel))) { process.stderr.write('--ziel nur unter /tmp oder /dev/shm (nie der echte Bestand)\n'); process.exit(2); }
  if (opt.instanz !== undefined && !/^[a-i]$/.test(opt.instanz)) { process.stderr.write(`--instanz '${opt.instanz}': ein Buchstabe a bis i\n`); process.exit(2); }
  const ziel = path.resolve(opt.ziel);
  fs.mkdirSync(ziel, { recursive: true });
  const wav = {}, shas = {}, bpm = {}, beats = {}, dauer = {}, lagen = {}, zeilen = [];
  for (const [name, q] of Object.entries(QUELLEN)) {
    const frames = Math.round(q.beats * 60 / q.bpm * SR);          // die Datei ist genau takte · 4 Beats lang: der Auto-Warp bildet sie auf takte · 4 Beats ab
    const { daten, lagen: l } = q.erzeuge(frames);
    wav[name] = path.join(ziel, `w4-${name}.wav`);
    schreibeWav(wav[name], daten, 2, SR);
    shas[name] = ksha(q.n); bpm[name] = q.bpm; beats[name] = q.beats; dauer[name] = frames / SR; lagen[name] = l;
    zeilen.push({ n: q.n, typ: 'loop', bpm: q.bpm, takte: q.takte, dauer_s: frames / SR, pfad: wav[name], pack: 'W4 Abnahme' });
  }
  for (const d of ['katalog.sqlite', 'mediathek.sqlite']) fs.rmSync(path.join(ziel, d), { force: true });   // wiederholbar
  const katalog = baueKatalog(ziel, zeilen);
  const mediathek = baueMarken(path.join(ziel, 'mediathek.sqlite'), []);
  const analyse = path.join(ziel, 'analyse');
  fs.mkdirSync(analyse, { recursive: true });
  if (opt.instanz) {
    const cache = path.join(process.env.HOME, '.cache', `cypherdj-${opt.instanz}`, 'arr', 'audio');
    for (const sha of Object.values(shas)) for (const ende of ['.f32', '.transienten.json']) fs.rmSync(path.join(cache, `${sha}${ende}`), { force: true });
  }
  process.stdout.write(`${JSON.stringify({ katalog, mediathek, analyse, shas, wav, bpm, beats, dauer_s: dauer, lagen, zittern_ms: 20, seed: 3 })}\n`);
}
