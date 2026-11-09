// 1.8 T6: pure measuring helpers of check/acceptance_rec4.mjs (count-in clicks, punch edges, seams, running start). No I/O, tested in tests/pruef_rec4_messen.test.mjs.
// Click finding and the verdict on click positions come from rec_measure.mjs (klickOrte, urteilKlicks); here are the parts that are specific to slice 4.
import crypto from 'node:crypto';

export const RATE = 48000;

// Samples per project beat at `bpm` (not rounded: 127 BPM gives 22677.165...).
export const samplesProBeat = (bpm) => RATE * 60 / bpm;
// The core's sample_at for a beat distance: rounded to a whole sample (arr_metronom.cpp: std::llround).
export const sampleBei = (beat, bpm) => Math.round(beat * samplesProBeat(bpm));

// AK18: the wanted positions of the 4N count-in clicks and of `danach` clicks after the entry, in the frame of a capture whose sample counter is the core's:
// click i sits on sample_at(entry - (4N - i) beats), then the whole chain of the output (`vorhalt`: limiter, channel latency, PDC) later. i = 0 .. 4N - 1 are the
// count-in clicks, 4N .. 4N + danach - 1 the running metronome from the entry on (the count-in has no click on the entry itself).
export function zaehlSoll(entry, takte, bpm, vorhalt, danach = 0) {
  const n = 4 * takte, spb = samplesProBeat(bpm), soll = [];
  for (let i = 0; i < n + danach; i++) soll.push(Math.round(entry + (i - n) * spb) + vorhalt);
  return soll;
}

// Number of found clicks before the entry (strictly before the first running click): the count-in must hold exactly 4N, no more, no less.
export function klicksVorEinsatz(orte, entry, vorhalt, bpm) {
  const grenze = entry + vorhalt - samplesProBeat(bpm) / 2;
  return orte.filter((o) => o < grenze).length;
}

// Largest sample-to-sample step |x[i+1] - x[i]| inside [von, bis) (indices clipped to the array).
export function groessterSchritt(x, von, bis) {
  let m = 0;
  for (let i = Math.max(0, von); i + 1 < Math.min(x.length, bis); i++) m = Math.max(m, Math.abs(x[i + 1] - x[i]));
  return m;
}

// AK20: the step at a seam against the largest step of the material (windows around the seams excluded by the caller).
export function urteilNaht(schrittNaht, schrittMaterial) {
  return { ok: schrittNaht <= schrittMaterial, schrittNaht, schrittMaterial, verhaeltnis: schrittMaterial > 0 ? schrittNaht / schrittMaterial : Infinity };
}

// sha256 over the raw bytes of x[von, bis) (float32 as stored): equal hashes mean bit-equal audio.
export function shaFenster(x, von, bis) {
  const a = Math.max(0, von), b = Math.min(x.length, bis);
  const v = x.subarray(a, Math.max(a, b));
  return crypto.createHash('sha256').update(Buffer.from(v.buffer, v.byteOffset, v.byteLength)).digest('hex');
}

// AK21: the first bar line strictly after `beat` (a running start begins at the next bar quantum point).
export const naechsterTakt = (beat) => 4 * (Math.floor(beat / 4 + 1e-9) + 1);

// Position inside the bar (0 <= x < 4) and whether it is far enough from both bar lines (`rand` beats) to name the next bar without doubt.
export const taktLage = (beat) => ((beat % 4) + 4) % 4;
export const weitVonTaktlinie = (beat, rand = 0.5) => { const x = taktLage(beat); return x >= rand && x <= 4 - rand; };

// Accent test of a metronome click: the first click of a bar has the full level, the others half. `ref` is the level of an accented click.
export const istAkzent = (spitze, ref) => spitze >= 0.75 * ref;

// A steady sine for the seam material (Z3): amplitude a, frequency f, `frames` samples, phase counted from sample 0 (`phase` in radians).
// At 120 BPM a bar line is a whole number of periods of 440 and 1000 Hz, so two sines without a phase offset are both 0 there and the cut would be no jump at all.
export function sinus(frames, f, a, phase = 0) {
  const x = new Float32Array(frames);
  for (let i = 0; i < frames; i++) x[i] = a * Math.sin(2 * Math.PI * f * i / RATE + phase);
  return x;
}
