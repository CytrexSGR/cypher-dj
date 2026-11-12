// Panel drawings: pure geometry for the envelope, LFO shape and filter response displays (panel.js turns the points into SVG paths).
// The envelope is exact (instruments/modular_dsp/src/adsr.rs: attack linear, decay and release one-pole exponential, times are seconds to -60 dB).
// The filter curve is a MODEL: a 2-pole resonator or a 4-pole ladder style cascade, not the measured response of the circuit in the graph.
// Every function returns [[x, y], ...] in a box of `breite` x `hoehe` pixels, y growing downwards. No DOM.

const MIN_STUFE = 4;           // px: the shortest drawn stage of an envelope
const SUSTAIN_ANTEIL = 0.2;    // share of the width kept for the sustain plateau (its length is not a time)
const DB60 = 3;                // -60 dB = 10^-3: the exponential stages reach it after their time
const num = (x, vorgabe = 0) => (Number.isFinite(x) ? x : vorgabe);

/** ADSR outline. a, d, r in seconds, s 0..1. The time axis is scaled to a + d + r; each stage gets at least 4 px, the sustain plateau a fixed share. */
export function huellPunkte({ a, d, s, r }, breite, hoehe) {
  const t = [Math.max(0, num(a)), Math.max(0, num(d)), Math.max(0, num(r))];
  const sus = Math.min(1, Math.max(0, num(s)));
  const verfuegbar = breite * (1 - SUSTAIN_ANTEIL), summe = t[0] + t[1] + t[2];
  let w = t.map((x) => Math.max(MIN_STUFE, summe > 0 ? (verfuegbar * x) / summe : verfuegbar / 3));
  const ueber = w.reduce((p, x) => p + x, 0) - verfuegbar;
  if (ueber > 0) {   // the minimum widths pushed the sum over: take the excess from the stages above the minimum
    const gross = w.filter((x) => x > MIN_STUFE).reduce((p, x) => p + x - MIN_STUFE, 0);
    if (gross > 0) w = w.map((x) => (x > MIN_STUFE ? MIN_STUFE + ((x - MIN_STUFE) * (gross - ueber)) / gross : x));
  }
  const y = (pegel) => hoehe * (1 - pegel);
  const x1 = w[0], x2 = x1 + w[1], x3 = breite - w[2];
  const p = [[0, hoehe], [x1, 0]];
  const N = 24;
  for (let i = 1; i < N; i++) { const q = i / N; p.push([x1 + w[1] * q, y(sus + (1 - sus) * 10 ** (-DB60 * q))]); }
  p.push([x2, y(sus)], [Math.max(x2, x3), y(sus)]);
  for (let i = 1; i < N; i++) { const q = i / N; p.push([Math.max(x2, x3) + (breite - Math.max(x2, x3)) * q, y(sus * 10 ** (-DB60 * q))]); }
  p.push([breite, hoehe]);
  return p;
}

const SH_STUFEN = [0.7, -0.4, 0.2, -0.9, 0.9, -0.1, -0.6, 0.5, 0.0, -0.8, 0.4, -0.3, 0.8, -0.5, 0.1, -0.7];
const bruch = (x) => x - Math.floor(x);
/** Value -1..1 of one LFO period at phase t (0..1) for a glyph name. */
function lfoWert(form, t) {
  switch (form) {
    case 'saw': return 2 * t - 1;
    case 'ramp': return 1 - 2 * t;
    case 'tri': return 1 - 2 * Math.abs(2 * bruch(t + 0.25) - 1);
    case 'sine': return Math.sin(2 * Math.PI * t);
    case 'square': return t < 0.5 ? 1 : -1;
    case 'pulse': return t < 0.25 ? 1 : -1;
    case 'noise': return SH_STUFEN[Math.min(15, Math.floor(t * 16))];
    case 'sh': default: return SH_STUFEN[Math.min(7, Math.floor(t * 8)) * 2 % 16];
  }
}
/** One period of an LFO shape, 64 points. form: saw|tri|sine|square|sh (also ramp, pulse, noise from the glyph set); unknown names draw a flat line. */
export function lfoPunkte(form, breite, hoehe) {
  const bekannt = ['saw', 'ramp', 'tri', 'sine', 'square', 'pulse', 'noise', 'sh'].includes(form);
  return Array.from({ length: 64 }, (_, i) => {
    const t = i / 63;
    return [breite * t, hoehe * (0.5 - 0.5 * (bekannt ? lfoWert(form, t) : 0))];
  });
}

// ---- filter model ----
const kmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const kbetrag = (a) => Math.hypot(a[0], a[1]);
/** Model magnitude in dB of a filter at frequency f. cutoff in Hz, reso 0..1. 2 pole: resonator with Q 0.7..10; 4 pole: ladder cascade 1/((1+s)^4 + k), k up to 3.9. */
export function filterDb({ cutoff, reso, art, pole }, f) {
  const fc = Math.min(20000, Math.max(20, num(cutoff, 1000))), g = Math.min(1, Math.max(0, num(reso)));
  const w = f / fc, s = [0, w];   // s = j w / wc
  let zaehler, nenner;
  if (pole === 4) {
    const e = [1, w], e2 = kmul(e, e), e4 = kmul(e2, e2);
    nenner = [e4[0] + 3.9 * g, e4[1]];
    const s2 = kmul(s, s), s4 = kmul(s2, s2);
    zaehler = art === 'hp' ? s4 : art === 'bp' ? [4 * s2[0], 4 * s2[1]] : [1, 0];   // bp: |4 s^2| is 1 at w = 1 without resonance
  } else {
    const q = 0.7 + 9.3 * g * g;
    const s2 = kmul(s, s);
    nenner = [1 + s2[0], s[1] / q];
    zaehler = art === 'hp' ? s2 : art === 'bp' ? [0, w / q] : [1, 0];
  }
  const betrag = kbetrag(zaehler) / Math.max(1e-12, kbetrag(nenner));
  return 20 * Math.log10(Math.max(1e-6, betrag));
}

const F_MIN = 20, F_MAX = 20000, DB_OBEN = 24, DB_UNTEN = -48;
/** Response curve over 20 Hz .. 20 kHz (log axis), +24 dB at the top edge, -48 dB at the bottom; 0 dB sits at one third of the height. */
export function filterPunkte(p, breite, hoehe, n = 96) {
  return Array.from({ length: n }, (_, i) => {
    const q = i / (n - 1), db = Math.min(DB_OBEN, Math.max(DB_UNTEN, filterDb(p, F_MIN * (F_MAX / F_MIN) ** q)));
    return [breite * q, hoehe * (DB_OBEN - db) / (DB_OBEN - DB_UNTEN)];
  });
}
/** x of the cutoff on the same axis (for the marker line). */
export const cutoffX = (cutoff, breite) => breite * Math.log(Math.min(F_MAX, Math.max(F_MIN, Number.isFinite(cutoff) ? cutoff : F_MIN)) / F_MIN) / Math.log(F_MAX / F_MIN);   // NaN draws at the left edge, never NaN
/** y of 0 dB on the same axis. */
export const nullDbY = (hoehe) => hoehe * DB_OBEN / (DB_OBEN - DB_UNTEN);
