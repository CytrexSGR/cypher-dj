// Measurement arithmetic of the automation slice 1 target acceptance (check/acceptance_a1.mjs). Pure functions, calibrated in tests/check_a1_measure.test.mjs
// (every negative control turns red there). The material is a steady sine of FREQ Hz at SR frames per second; all positions are frame indices of the master recording.
export const SR = 48000;
export const FREQ = 440;
const W = 2 * Math.PI * FREQ / SR;

// Amplitude of the sine in the window of n frames CENTRED on `mitte` (frame index; the window is [mitte - n/2, mitte + n/2)). Least-squares fit of a*sin + b*cos at FREQ with
// the absolute frame as phase: exact for a pure sine of any window length (no need for whole periods), and the gain is read in the middle of the window.
export function amplitude(l, mitte, n) {
  const von = Math.round(mitte - n / 2);
  let ss = 0, cc = 0, sc = 0, xs = 0, xc = 0;
  for (let i = Math.max(0, von); i < Math.min(l.length, von + n); i++) {
    const s = Math.sin(W * i), c = Math.cos(W * i);
    ss += s * s; cc += c * c; sc += s * c; xs += l[i] * s; xc += l[i] * c;
  }
  const det = ss * cc - sc * sc;
  if (!(det > 1e-9)) return 0;
  const a = (xs * cc - xc * sc) / det, b = (xc * ss - xs * sc) / det;
  return Math.hypot(a, b);
}
export const amplitudeDb = (l, mitte, n, ref) => 20 * Math.log10(Math.max(amplitude(l, mitte, n), 1e-12) / ref);

// First frame where the recording is audible: more than 1 % of full scale
export function einsatz(l) { for (let i = 0; i < l.length; i++) if (Math.abs(l[i]) > 0.01) return i; return -1; }
// The same for a source of any level: the threshold is 4 % of the peak of the first 20000 frames after the first non-zero sample (the absolute 1 % above would
// fire several samples late for a quiet source and shift the whole time base)
export function einsatzRel(l) {
  let i0 = 0;
  while (i0 < l.length && Math.abs(l[i0]) < 1e-7) i0++;
  let m = 0;
  for (let i = i0; i < Math.min(l.length, i0 + 20000); i++) m = Math.max(m, Math.abs(l[i]));
  for (let i = i0; i < l.length; i++) if (Math.abs(l[i]) > 0.04 * m) return i;
  return -1;
}
export const beatSample = (beat, schlag) => Math.round(beat * schlag);

// Value of a lane (piecewise linear in dB, points {beat, wert}; two points at one beat are a jump: from that beat the right one holds)
export function linie(punkte, beat) {
  if (beat <= punkte[0].beat) return punkte[0].wert;
  for (let i = 1; i < punkte.length; i++) {
    const a = punkte[i - 1], b = punkte[i];
    if (beat < b.beat) return b.beat === a.beat ? b.wert : a.wert + (b.wert - a.wert) * (beat - a.beat) / (b.beat - a.beat);
  }
  return punkte[punkte.length - 1].wert;
}

// Largest level step (dB) between neighbouring windows of n frames from `von` (a window start) to `bis`
export function schrittMax(l, von, bis, n, ref) {
  let m = 0, vor = null;
  for (let s = von; s + n <= bis; s += n) {
    const d = amplitudeDb(l, s + n / 2, n, ref);
    if (vor !== null) m = Math.max(m, Math.abs(d - vor));
    vor = d;
  }
  return m;
}

// Gain trace: level in dB at every `schritt` frames from `von` to `bis` (window centres), windows of n frames
export function verstaerkungsSpur(l, von, bis, schritt, n, ref) {
  const aus = [];
  for (let f = von + Math.ceil(n / 2); f < bis; f += schritt) aus.push({ frame: f, db: amplitudeDb(l, f, n, ref), lin: amplitude(l, f, n) / ref });
  return aus;
}

// Length of a linear gain blend from g0 to g1 (linear gains): fit a line to the points between 20 % and 80 % of the way and extend it to g0 and g1. The window smear is
// symmetric around the 50 % crossing, so the width of the blend stays correct where the first and last point above a threshold would be too wide.
// spur: [{frame, lin}]; returns {frames, mitte} or null when fewer than 3 points lie in the blend.
export function blendeBreite(spur, g0, g1) {
  const d = g1 - g0, lo = g0 + 0.2 * d, hi = g0 + 0.8 * d;
  const p = spur.filter((e) => (d > 0 ? e.lin >= lo && e.lin <= hi : e.lin <= lo && e.lin >= hi));
  if (p.length < 3) return null;
  const n = p.length, mx = p.reduce((s, e) => s + e.frame, 0) / n, my = p.reduce((s, e) => s + e.lin, 0) / n;
  let sxy = 0, sxx = 0;
  for (const e of p) { sxy += (e.frame - mx) * (e.lin - my); sxx += (e.frame - mx) ** 2; }
  const steigung = sxy / sxx;
  if (!steigung) return null;
  return { frames: Math.abs(d / steigung), mitte: mx + (g0 + d / 2 - my) / steigung };
}
