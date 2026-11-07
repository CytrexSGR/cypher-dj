// Package 1.9 U4 (T4.5, AK-O1): the measurements behind "bright", "dark", "aggressive", "soft", "tight" and "deep" on a rendered WAV, kept apart from the
// acceptance script so that tests/pruef_richtung_messen.test.mjs can calibrate them on synthetic signals.
//   schwerpunktHz(x, rate)              spectral centroid (Hz) of the mean power spectrum (Hann frames of 4096, hop 2048, bin 0 left out)
//   bandAnteilDb(x, rate, lo, hi)       share (dB) of the power in [lo, hi) Hz of the mean power spectrum, 0 dB = all of it
//   abklingAnteilDb(x, rate, bpm)       share (dB) of the energy that falls into the last half of each 16th note (of all 16ths together)
//   abklingHochDb(x, rate, bpm, fc)     the same share for the signal above fc (second order high-pass, default 1 kHz): the decay of the brightness
//   messeDatei(pfad, bpm)               the four numbers of a stereo or mono WAV (mono mix of the channels); refuses silence
//   bewegung(wort, vorher, nachher)     the move of the quantity of a word and whether it reaches the minimum of spec 4.3
// The quantity and minimum of each word are in MESSUNG (spec 4.3): bright/dark centroid +-10 %, aggressive/soft share 1-5 kHz +-1.5 dB, deep share below
// 120 Hz +1 dB. tight: spec 4.3 gave the late-half share of ALL energy, -2 dB; the RB-338 decay only shapes the filter envelope, that share moved 0.002 dB at every
// strength (u4-abnahme-1), so the gate is the late-half share of the energy above 1 kHz, -0.3 dB (ledger D57). The spec quantity is still printed (abkling_db).
import { spektrum } from './i19_spektrum.mjs';
import { leseWav } from './w1_wav.mjs';

const N = 4096, HOP = 2048;

// mean power per bin (amplitude of `spektrum` squared) over all frames that carry signal
function leistung(x) {
  const p = new Float64Array(N / 2);
  let frames = 0;
  const rahmen = new Float64Array(N);
  for (let o = 0; o + N <= x.length; o += HOP) {
    let e = 0;
    for (let i = 0; i < N; i++) { rahmen[i] = x[o + i]; e += rahmen[i] * rahmen[i]; }
    if (e < 1e-14) continue;                                  // digital silence between notes does not pull the mean
    const m = spektrum(rahmen);
    for (let k = 0; k < N / 2; k++) p[k] += m[k] * m[k];
    frames++;
  }
  if (frames === 0) throw new Error('silent: no frame of the signal carries energy');
  return p;
}

export function schwerpunktHz(x, rate) {
  const p = leistung(x);
  let z = 0, n = 0;
  for (let k = 1; k < p.length; k++) { z += ((k * rate) / N) * p[k]; n += p[k]; }
  return z / n;
}

export function bandAnteilDb(x, rate, lo, hi) {
  const p = leistung(x);
  let band = 0, alle = 0;
  for (let k = 1; k < p.length; k++) {
    const f = (k * rate) / N;
    alle += p[k];
    if (f >= lo && f < hi) band += p[k];
  }
  return 10 * Math.log10(Math.max(band, 1e-30) / alle);
}

export function abklingAnteilDb(x, rate, bpm) {
  const s = Math.round((60 / bpm / 4) * rate), halb = Math.floor(s / 2);
  let spaet = 0, alle = 0;
  for (let o = 0; o + s <= x.length; o += s) {
    for (let i = 0; i < s; i++) { const e = x[o + i] * x[o + i]; alle += e; if (i >= halb) spaet += e; }
  }
  if (alle < 1e-14) throw new Error('silent: no energy in any 16th');
  return 10 * Math.log10(Math.max(spaet, 1e-30) / alle);
}

// second order Butterworth high-pass (RBJ biquad), direct form 1
function hochpass(x, fc, rate) {
  const w0 = (2 * Math.PI * fc) / rate, c = Math.cos(w0), a = Math.sin(w0) / Math.SQRT2, a0 = 1 + a;
  const b0 = (1 + c) / 2 / a0, b1 = -(1 + c) / a0, b2 = b0, a1 = (-2 * c) / a0, a2 = (1 - a) / a0;
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    y[i] = v; x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
  }
  return y;
}
export const abklingHochDb = (x, rate, bpm, fc = 1000) => abklingAnteilDb(hochpass(x, fc, rate), rate, bpm);

export function messeDatei(pfad, bpm) {
  const w = leseWav(pfad);
  const n = w.l.length, x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.5 * (w.l[i] + w.r[i]);
  const rate = w.rate ?? 48000;
  let spitze = 0;
  for (let i = 0; i < n; i++) spitze = Math.max(spitze, Math.abs(x[i]));
  if (spitze < 1e-4) throw new Error(`${pfad}: silent (peak ${spitze})`);
  return { rate, frames: n, spitze, schwerpunkt_hz: schwerpunktHz(x, rate), band_1_5k_db: bandAnteilDb(x, rate, 1000, 5000),
    band_unter_120_db: bandAnteilDb(x, rate, 0, 120), abkling_db: abklingAnteilDb(x, rate, bpm), abkling_hoch_db: abklingHochDb(x, rate, bpm) };
}

// feld: key of messeDatei; vorzeichen: the direction the word must move it; min: the gate of spec 4.3 (einheit 'prozent' = relative, 'db' = difference)
export const MESSUNG = {
  bright: { feld: 'schwerpunkt_hz', vorzeichen: 1, min: 10, einheit: 'prozent' },
  dark: { feld: 'schwerpunkt_hz', vorzeichen: -1, min: 10, einheit: 'prozent' },
  aggressive: { feld: 'band_1_5k_db', vorzeichen: 1, min: 1.5, einheit: 'db' },
  soft: { feld: 'band_1_5k_db', vorzeichen: -1, min: 1.5, einheit: 'db' },
  tight: { feld: 'abkling_hoch_db', vorzeichen: -1, min: 0.3, einheit: 'db' },
  deep: { feld: 'band_unter_120_db', vorzeichen: 1, min: 1, einheit: 'db' },
};

// 1.9 U5 (Surge, spec 4.3): same quantities and minimums; tight is the late-half share of ALL energy, -2 dB of the spec (the Surge amp envelope shapes
// the tail, the RB-338 decay did not); no `deep` word.
export const MESSUNG_SURGE = {
  bright: MESSUNG.bright, dark: MESSUNG.dark, aggressive: MESSUNG.aggressive, soft: MESSUNG.soft,
  tight: { feld: 'abkling_db', vorzeichen: -1, min: 2, einheit: 'db' },
};

export function bewegung(wort, vorher, nachher, tabelle = MESSUNG) {
  const m = Object.hasOwn(tabelle, wort) ? tabelle[wort] : undefined;
  if (!m) throw new Error(`no measurement for ${wort}`);
  const wert = m.einheit === 'prozent' ? (nachher[m.feld] / vorher[m.feld] - 1) * 100 : nachher[m.feld] - vorher[m.feld];
  return { feld: m.feld, einheit: m.einheit === 'prozent' ? '%' : 'dB', wert, min: m.min, ok: m.vorzeichen * wert >= m.min };
}
