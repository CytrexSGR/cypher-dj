// Measurement arithmetic of the comping 1.14 target acceptance (pruef/abnahme_c14.mjs). Pure functions, calibrated in tests/pruef_c14_messen.test.mjs
// (every negative
// control turns red there). Positions are frame indices of a recording or an export at 48 kHz. Builds on pruef/a2_messen.mjs (least-squares sine fit).
import { amplituden } from './a2_messen.mjs';
import { SR } from './a1_messen.mjs';

export { SR };
export const schlagFrames = (bpm) => 60 * SR / bpm;   // frames per beat (not an integer at 127 BPM)

// The source sample i of a steady sine of frequency f, amplitude amp and start phase `phase`, as float32 (the file stores float32)
export const sinusQuelle = (f, amp = 0.3, phase = 0) => (i) => Math.fround(amp * Math.sin(2 * Math.PI * f * i / SR + phase));

// Which of `freqs` sounds in each window of n frames (window centres from `von` to `bis` every `schritt` frames): [{frame, amps, dom}] with dom the index
// of the largest amplitude
export function frequenzJeFenster(x, von, bis, n, schritt, freqs) {
  const aus = [];
  for (let m = von + Math.ceil(n / 2); m < bis - n / 2; m += schritt) {
    const amps = amplituden(x, m, n, freqs);
    aus.push({ frame: m, amps, dom: amps.indexOf(Math.max(...amps)) });
  }
  return aus;
}

// Phase-free correlation of the window [von, von + n) with a sine of frequency f: the square root of the energy share that a*sin + b*cos at f explains (1
// = the window is
// that sine, about 0 = another frequency or silence). For a steady sine this is the largest normalised cross-correlation over all lags.
export function korrelation(x, von, n, f) {
  let e = 0;
  for (let i = von; i < von + n; i++) e += x[i] * x[i];
  if (!(e > 1e-12)) return 0;
  const a = amplituden(x, von + n / 2, n, [f])[0];
  return Math.min(1, Math.sqrt((a * a / 2) * n / e));
}

// Seam mask of an export of `frames` frames: 1 within +-(ms + rand) of every boundary in `grenzenBeats` (the fade of a comp edge is 4 ms long on both sides)
export function nahtMaske(frames, bpm, grenzenBeats, ms = 4, rand = 2) {
  const maske = new Uint8Array(frames), halb = Math.round(ms * SR / 1000) + rand;
  for (const b of grenzenBeats) {
    const m = Math.round(b * schlagFrames(bpm));
    for (let i = Math.max(0, m - halb); i < Math.min(frames, m + halb); i++) maske[i] = 1;
  }
  return maske;
}

// Largest |x| in [von, bis) and the same in dBFS (-Infinity for exact silence)
export function spitze(x, von, bis) { let m = 0; for (let i = von; i < bis; i++) m = Math.max(m, Math.abs(x[i])); return m; }
export const dbfs = (a) => (a > 0 ? 20 * Math.log10(a) : -Infinity);

// First run of at least `minLauf` silent frames (|x| <= eps) that starts in [ab, bis): {von} the first silent frame, {bis} the first audible frame after
// it. null if none.
export function stilleLauf(x, ab, bis, eps = 1e-9, minLauf = 64) {
  let i = ab;
  while (i < bis) {
    if (Math.abs(x[i]) > eps) { i++; continue; }
    let j = i;
    while (j < x.length && Math.abs(x[j]) <= eps) j++;
    if (j - i >= minLauf) return { von: i, bis: j };
    i = j;
  }
  return null;
}

// Offset (candidates `versaetze`, in frames) at which gain * quelle(i + delta) matches x best over the unmasked frames of [von, bis): the one with the smallest
// largest deviation. Returns {delta, maxAbw, frames}; frames = number of compared frames. An offset of +-1 at 127 BPM is the rounding of the clip start.
export function besterVersatz(x, quelle, gain, von, bis, maske, versaetze) {
  let beste = null;
  for (const d of versaetze) {
    let m = 0, n = 0;
    for (let i = von; i < bis; i++) {
      if (maske?.[i]) continue;
      m = Math.max(m, Math.abs(x[i] - gain * quelle(i + d)));
      n++;
    }
    if (beste === null || m < beste.maxAbw) beste = { delta: d, maxAbw: m, frames: n };
  }
  return beste;
}
export const bereich = (von, bis) => Array.from({ length: bis - von + 1 }, (_, i) => von + i);

// First window centre in [von, bis) at which the new frequency sounds louder than the old one (windows of n frames every `schritt` frames) and the old one
// was louder
// before. Returns the frame, or -1 when there is no such change. This is the instant of an audition toggle in the master recording.
export function wechselFrame(x, von, bis, fAlt, fNeu, n = 480, schritt = 48) {
  let altWarLauter = false;
  for (const w of frequenzJeFenster(x, von, bis, n, schritt, [fAlt, fNeu])) {
    if (w.amps[0] > w.amps[1]) altWarLauter = true;
    else if (altWarLauter) return w.frame;
  }
  return -1;
}
// Wall-clock instant (ms) of frame f of a recording of n frames whose last frame was read at tEndMs (the recorder returns when the last frame is in; its read
// interval of 20 ms is the resolution of this anchor).
export const wandMs = (f, n, tEndMs) => tEndMs - (n - f) / (SR / 1000);
// Latency of a toggle in ms: from the request (tPostMs) to the frame wf at which the new frequency sounds in the recording
export const latenzMs = (wf, n, tEndMs, tPostMs) => wandMs(wf, n, tEndMs) - tPostMs;
// Gain by which a recording x carries the source over [von, bis) at source offset delta: least squares g = <x, q> / <q, q>
export function verstaerkung(x, quelle, von, bis, delta = 0) {
  let xq = 0, qq = 0;
  for (let i = von; i < bis; i++) { const q = quelle(i + delta); xq += x[i] * q; qq += q * q; }
  return qq > 0 ? xq / qq : 0;
}
export function medianMax(werte) {
  const s = [...werte].sort((a, b) => a - b), n = s.length;
  return { median: n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2, max: s[n - 1], min: s[0], n };
}

// Index of the first byte at which two buffers differ, -1 when they are identical (and as long as each other: a length difference is a difference)
export function ersterUnterschied(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}
