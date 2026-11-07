// Measurement arithmetic of the automation slice 5 target acceptance (pruef/abnahme_a5.mjs). Pure functions, calibrated in tests/pruef_a5_messen.test.mjs
// (every negative control turns red there). Level work builds on pruef/a2_messen.mjs (least-squares amplitude of a known sine); this file adds the level of a
// stereo pair relative to a reference, the fundamental of a harmonic tone (the RB-338 notes of the transpose check) and the level of a stretch of recording.
import { SR } from './a1_messen.mjs';
import { amplituden } from './a2_messen.mjs';

// Gain of the track in dB against the reference amplitude `ref`: sqrt(L^2 + R^2) of the amplitudes at `freq` in the window of n frames centred on `mitte`.
// The pan law is constant power, so sqrt(L^2 + R^2) is the fader gain whatever the pan is.
export function pegelDb(l, r, mitte, n, ref, freq) {
  const a = Math.hypot(amplituden(l, mitte, n, [freq])[0], amplituden(r, mitte, n, [freq])[0]);
  return 20 * Math.log10(Math.max(a, 1e-12) / ref);
}

// Fundamental frequency in Hz of x[von, von + n): the lag of the highest normalised autocorrelation peak between SR/fmax and SR/fmin, refined by a parabola
// through the peak. An octave error is avoided by taking the FIRST local maximum above 0.9 of the global maximum. Returns 0 for a silent window.
export function grundfrequenz(x, von, n, fmin = 40, fmax = 600) {
  const lagMin = Math.floor(SR / fmax), lagMax = Math.min(Math.ceil(SR / fmin), Math.floor(n / 2));
  let e0 = 0;
  for (let i = von; i < von + n && i < x.length; i++) e0 += x[i] * x[i];
  if (!(e0 > 1e-12)) return 0;
  const ac = new Float64Array(lagMax + 2);
  for (let lag = lagMin - 1; lag <= lagMax + 1; lag++) {
    let s = 0;
    const m = Math.min(von + n, x.length) - lag;
    for (let i = von; i < m; i++) s += x[i] * x[i + lag];
    ac[lag] = s / e0;
  }
  let best = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag++) best = Math.max(best, ac[lag]);
  for (let lag = lagMin; lag <= lagMax; lag++) {
    if (ac[lag] >= 0.9 * best && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) {
      const a = ac[lag - 1], b = ac[lag], c = ac[lag + 1], d = a - 2 * b + c;
      const off = d === 0 ? 0 : 0.5 * (a - c) / d;
      return SR / (lag + off);
    }
  }
  return 0;
}

// Level in dBFS of x[von, bis) as rms of one channel (-Infinity for exact silence)
export function rmsDbfs(x, von, bis) {
  let s = 0, n = 0;
  for (let i = Math.max(0, von); i < Math.min(x.length, bis); i++) { s += x[i] * x[i]; n++; }
  return n && s > 0 ? 10 * Math.log10(s / n) : -Infinity;
}

// The interval in semitones between two frequencies
export const halbtoene = (f1, f2) => 12 * Math.log2(f2 / f1);
