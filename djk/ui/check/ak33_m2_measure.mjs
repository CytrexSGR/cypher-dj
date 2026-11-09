// AK33 M2 measuring tools (pure functions, calibrated in tests/check_ak33_m2.test.mjs).
//  - klickLagen: centre of energy of every Hann burst (sub-sample), the position the ear takes as "the click"
//  - beatBeiQuelle / erwarteteLagen: where the warp map puts source click k (piecewise linear marker list [[quell_s, beat], ...])
//  - nahtMass: seam artefact measure on a steady tone: residual of a one-sinusoid fit per 10 ms window, relative to the window level (dB)
import { klicks } from './w1_wav.mjs';

export function klickLagen(x, { halb = 200, abstand = 10000 } = {}) {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  if (!(m > 0)) return [];
  return klicks(x, 0.3 * m, abstand).map((p) => {
    let s = 0, sw = 0;
    for (let i = Math.max(0, p - halb); i <= Math.min(x.length - 1, p + halb); i++) { const e = x[i] * x[i]; s += e; sw += e * i; }
    return sw / s;
  });
}
// Beat of the clip at source second s (markers sorted by source second; outside the first/last segment the edge segment is continued, like W(b))
export function beatBeiQuelle(marker, s) {
  let i = 0;
  while (i < marker.length - 2 && s > marker[i + 1][0]) i++;
  const [s0, b0] = marker[i], [s1, b1] = marker[i + 1];
  return b0 + (s - s0) * (b1 - b0) / (s1 - s0);
}
// Project seconds per source second at source second s (local slope of the warp map times the length of a project beat): 120/128 here. RE-PITCH compresses the burst
// by this factor, so its onset foot (56 samples before the centre) moves by 56 * (1 - rho); COMPLEX and TONES keep the transient.
export function dehnung(marker, s, bpm) {
  let i = 0;
  while (i < marker.length - 2 && s > marker[i + 1][0]) i++;
  return (marker[i + 1][1] - marker[i][1]) / (marker[i + 1][0] - marker[i][0]) * 60 / bpm;
}
// Expected export sample of the source clicks k = 1..63 (source second k * quellBeat): beat from the map, plus the clip start, at `framesProBeat`
export function erwarteteLagen(marker, startBeat, framesProBeat, vonBeat = 0, quellBeat = 0.5, n = 63) {
  return Array.from({ length: n }, (_, j) => (startBeat + beatBeiQuelle(marker, (j + 1) * quellBeat) - vonBeat) * framesProBeat);
}
// Deviation (measured - expected) in samples; the two lists must have the same length (otherwise a click is missing or doubled: n differs and max is Infinity)
export function abweichungen(gemessen, erwartet) {
  if (gemessen.length !== erwartet.length) return { n: gemessen.length, soll: erwartet.length, max: Infinity, d: [] };
  const d = gemessen.map((g, i) => g - erwartet[i]);
  return { n: d.length, soll: erwartet.length, max: Math.max(...d.map(Math.abs)), d };
}
// Verdict of one click case (K0/K1/K2): every one of the expected clicks is there (the deviation list has the expected length) and the largest deviation is within the limit.
// GRENZE: limit in samples per warp mode (RE-PITCH 1.5, COMPLEX and TONES 24 = D6, Andreas 2026-11-04). Pure, so the calibration test can feed it a map that is 30 samples off.
export const GRENZE = { repitch: 1.5, complex: 24, tones: 24 };
export const klickUrteil = (abw, grenze, nSoll = 63) => abw.n === nSoll && abw.max <= grenze;
// Least-squares sine fit in x[a, a+n) at frequency f: returns residual rms and signal rms
function fit(x, a, n, f, sr) {
  let ss = 0, cc = 0, sc = 0, xs = 0, xc = 0, xx = 0;
  const w = 2 * Math.PI * f / sr;
  for (let i = 0; i < n; i++) { const s = Math.sin(w * (a + i)), c = Math.cos(w * (a + i)), v = x[a + i]; ss += s * s; cc += c * c; sc += s * c; xs += v * s; xc += v * c; xx += v * v; }
  const det = ss * cc - sc * sc, A = (xs * cc - xc * sc) / det, B = (xc * ss - xs * sc) / det;
  const res = xx - (A * xs + B * xc);
  return { res: Math.sqrt(Math.max(0, res) / n), sig: Math.sqrt(xx / n), f };
}
// Residual (dB relative to the level) per window; the frequency is searched around fNenn (+-spanne Hz, step 0.5 Hz) because RE-PITCH changes it
export function nahtMass(x, von, bis, { fenster = 480, schritt = 240, fNenn = 440, spanne = 6, sr = 48000 } = {}) {
  const aus = [];
  for (let a = von; a + fenster <= bis; a += schritt) {
    let best = null;
    for (let f = fNenn - spanne; f <= fNenn + spanne + 1e-9; f += 0.5) { const r = fit(x, a, fenster, f, sr); if (best === null || r.res < best.res) best = r; }
    aus.push({ a, db: 20 * Math.log10(best.res / (best.sig + 1e-12) + 1e-9), f: best.f, pegel_db: 20 * Math.log10(best.sig + 1e-12) });
  }
  return aus;
}
export const median = (v) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };
// Largest sample-to-sample step: inside [mitte - nah, mitte + nah] and (as the reference) in [mitte - fern, mitte - nah2] and [mitte + nah2, mitte + fern].
// A steady sine of amplitude A and frequency f never steps more than 2 pi f A / sr, a discontinuity (click) steps much more. Unlike the sine fit this is blind to a
// slow change of frequency (RE-PITCH changes the pitch with the segment tempo), which is exactly why both are used.
export function sprungMass(x, mitte, { nah = 4800, nah2 = 7200, fern = 96000 } = {}) {
  let nahMax = 0, fernMax = 0, nahBei = mitte;
  for (let i = Math.max(1, mitte - fern); i < Math.min(x.length, mitte + fern); i++) {
    const d = Math.abs(x[i] - x[i - 1]), a = Math.abs(i - mitte);
    if (a <= nah) { if (d > nahMax) { nahMax = d; nahBei = i; } } else if (a > nah2 && d > fernMax) fernMax = d;
  }
  return { nah_max: nahMax, fern_max: fernMax, verhaeltnis: nahMax / fernMax, bei_samples_von_naht: nahBei - mitte };
}

// --- test signals (shared by ak33_m2_setup.mjs and the calibration tests)
const SR = 48000, N = 32 * SR, HALB = 72;
export const klickSignal = () => {
  const x = new Float32Array(2 * N);
  for (let k = 1; k <= 63; k++) {
    const c = 24000 * k;
    for (let n = -HALB; n <= HALB; n++) { const v = 0.8 * 0.5 * (1 + Math.cos(Math.PI * n / (HALB + 1))) * Math.cos(2 * Math.PI * 1000 * n / SR); x[2 * (c + n)] = x[2 * (c + n) + 1] = v; }
  }
  return x;
};
export const tonSignal = (sprungS) => {
  const x = new Float32Array(2 * N), s0 = sprungS === undefined ? Infinity : Math.round(sprungS * SR) + 27;   // +27: the flip must sit where the sine is near a crest (step 0.6), at 10.05 s the sine is exactly 0 and a flip there steps nothing
  for (let i = 0; i < N; i++) x[2 * i] = x[2 * i + 1] = (i >= s0 ? -1 : 1) * 0.3 * Math.sin(2 * Math.PI * 440 * i / SR);
  return x;
};

// Onset foot of each click: the last sample before the energy peak where the 0.5 ms RMS envelope is below `anteil` of the burst peak. The foot is what a
// level-based onset detector (and the D6 limit of 24 samples) sees, the centre of energy is what klickLagen gives. Both are reported; the foot of the SOURCE burst
// (the same function on the source signal) is the reference, so the instrument's own offset cancels.
export function klickFuesse(x, { halb = 400, anteil = 0.2, fenster = 24, abstand = 10000 } = {}) {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  if (!(m > 0)) return [];
  const q = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) q[i + 1] = q[i] + x[i] * x[i];
  const env = (i) => Math.sqrt((q[Math.min(x.length, i + fenster / 2)] - q[Math.max(0, i - fenster / 2)]) / fenster);
  return klicks(x, 0.3 * m, abstand).map((p) => {
    let pk = 0, pi = p;
    for (let i = Math.max(0, p - halb); i <= Math.min(x.length - 1, p + halb); i++) { const e = env(i); if (e > pk) { pk = e; pi = i; } }
    let j = pi;
    while (j > 0 && pi - j < 2 * halb && env(j) >= anteil * pk) j--;
    return j + 1;
  });
}
