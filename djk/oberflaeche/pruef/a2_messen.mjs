// Measurement arithmetic of the automation slice 2 target acceptance (pruef/abnahme_a2.mjs). Pure functions, calibrated in tests/pruef_a2_messen.test.mjs
// (every negative control turns red there). Level work builds on pruef/a1_messen.mjs; this file adds what slice 2 needs: amplitudes of several sines at once
// (solo, isolation), the pan law, the stereo onset, the spectral centroid and a monotony check.
import { SR } from './a1_messen.mjs';

// Pan law of the core (kern arr_ausgang.cpp pan_gain): constant power, theta = (pan + 1) * pi / 4, left = cos, right = sin
export function panGesetz(pan) {
  const p = Math.min(1, Math.max(-1, pan)), th = (p + 1) * Math.PI / 4;
  return { l: Math.cos(th), r: Math.sin(th) };
}
// The linear law that the core's pan mutation uses (CYPHERDJ_MUTATION_ARR_PAN_LINEAR); only for the calibration of the instrument
export function panLinear(pan) {
  const p = Math.min(1, Math.max(-1, pan));
  return { l: 0.5 * (1 - p), r: 0.5 * (1 + p) };
}

// Amplitudes of several sines at once: least-squares fit of a_k*sin + b_k*cos for every frequency over the window of n frames CENTRED on `mitte`
// (absolute frame as phase). Exact for pure sines of any window length when the frequencies differ by more than about one over the window.
// Returns the amplitude per frequency, in the order of `freqs`.
export function amplituden(l, mitte, n, freqs) {
  const von = Math.max(0, Math.round(mitte - n / 2)), bis = Math.min(l.length, Math.round(mitte - n / 2) + n);
  const m = 2 * freqs.length;
  const A = Array.from({ length: m }, () => new Float64Array(m + 1));
  const w = freqs.map((f) => 2 * Math.PI * f / SR), basis = new Float64Array(m);
  for (let i = von; i < bis; i++) {
    for (let k = 0; k < freqs.length; k++) { basis[2 * k] = Math.sin(w[k] * i); basis[2 * k + 1] = Math.cos(w[k] * i); }
    for (let r = 0; r < m; r++) { for (let c = 0; c < m; c++) A[r][c] += basis[r] * basis[c]; A[r][m] += basis[r] * l[i]; }
  }
  for (let c = 0; c < m; c++) {   // Gauss with partial pivoting
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-9) return freqs.map(() => 0);
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = c + 1; r < m; r++) { const f = A[r][c] / A[c][c]; for (let k = c; k <= m; k++) A[r][k] -= f * A[c][k]; }
  }
  const x = new Float64Array(m);
  for (let r = m - 1; r >= 0; r--) { let s = A[r][m]; for (let k = r + 1; k < m; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  return freqs.map((_, k) => Math.hypot(x[2 * k], x[2 * k + 1]));
}
export const amplitudeF = (l, mitte, n, f) => amplituden(l, mitte, n, [f])[0];
export const dbVon = (a, ref) => 20 * Math.log10(Math.max(a, 1e-12) / ref);

// First frame where either channel is audible (more than 1 % of full scale)
export function einsatzStereo(l, r) { for (let i = 0; i < l.length; i++) if (Math.abs(l[i]) > 0.01 || Math.abs(r[i]) > 0.01) return i; return -1; }

// De-interleave a stereo Float32Array
export function kanaele(st) {
  const l = new Float32Array(st.length >> 1), r = new Float32Array(st.length >> 1);
  for (let i = 0; i < l.length; i++) { l[i] = st[2 * i]; r[i] = st[2 * i + 1]; }
  return { l, r };
}

// Spectral centroid in Hz of the n frames from `von` (n a power of two): Hann window, radix-2 FFT, magnitude-weighted mean frequency from 20 Hz to 20 kHz
export function schwerpunkt(x, von, n = 16384) {
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = (x[von + i] ?? 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n));
  for (let i = 1, j = 0; i < n; i++) {   // bit reversal
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  let s = 0, g = 0;
  for (let k = Math.ceil(20 * n / SR); k <= Math.floor(20000 * n / SR); k++) { const m = Math.hypot(re[k], im[k]); s += m * k * SR / n; g += m; }
  return g > 0 ? s / g : 0;
}

// Monotony: smallest step of the series in the wanted direction (+1 rising, -1 falling), relative to the series mean. Positive = strictly monotonic in that direction.
export function kleinsterSchritt(reihe, richtung = 1) {
  const mittel = reihe.reduce((s, x) => s + x, 0) / reihe.length;
  let m = Infinity;
  for (let i = 1; i < reihe.length; i++) m = Math.min(m, richtung * (reihe[i] - reihe[i - 1]) / mittel);
  return m;
}
