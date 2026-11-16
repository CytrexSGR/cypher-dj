// Sampler C: root detection of a region of a cut (YIN on the mono sum) and the root proposal (C-D5, C-D6).
import { tonartWurzel } from '../project/live.ts';

/** From this confidence on the detected note is proposed as the root. */
export const TON_SCHWELLE = 0.6;

export type Erkannt = { note: number | null; hz: number | null; konfidenz: number };

const SR = 48000;
const W = 2048;                 // analysis window in frames
const LAG_MIN = 24;             // 2000 Hz
const LAG_MAX = 1200;           // 40 Hz
const MAX_FRAMES = 8;           // analysis frames per region
const SCHRITT_MIN = 256;        // an analysis frame needs this much room to the previous one
const YIN_SCHWELLE = 0.15;
const STILL_RMS = 0.001;
const KEINE: Erkannt = { note: null, hz: null, konfidenz: 0 };

/** YIN pitch of the region [a, b) (frames) of interleaved stereo `daten`: the median over up to 8 analysis frames, after the attack (min(480, 10 % of the region)
 *  frames) has been skipped. `konfidenz` = mean clarity of the voiced frames x (voiced frames within +-50 cents of the median / analysis frames); 0 and no note
 *  when the region is too short (needs W + 1200 frames after the skip) or silent. A region reaching past the data is cut to the data. */
export function erkenneGrundton(daten: Float32Array, a: number, b: number): Erkannt {
  const von = Math.max(0, Math.floor(a)), bis = Math.min(Math.floor(b), Math.floor(daten.length / 2));
  const laenge = bis - von;
  if (!(laenge > 0)) return { ...KEINE };
  const start = von + Math.min(480, Math.floor(0.1 * laenge));
  const spanne = bis - start - (W + LAG_MAX);   // room for the analysis frame starts
  if (spanne < 0) return { ...KEINE };
  const n = Math.min(MAX_FRAMES, 1 + Math.floor(spanne / SCHRITT_MIN));
  const x = new Float64Array(W + LAG_MAX + 1);
  const d = new Float64Array(LAG_MAX + 2);       // d'(tau), index = tau
  const hzListe: number[] = [], klarheit: number[] = [];
  for (let k = 0; k < n; k++) {
    const p = start + (n === 1 ? 0 : Math.round(k * spanne / (n - 1)));
    for (let i = 0; i < x.length; i++) x[i] = i + p < bis ? 0.5 * (daten[2 * (p + i)] + daten[2 * (p + i) + 1]) : 0;
    let e = 0;
    for (let i = 0; i < W; i++) e += x[i] * x[i];
    if (Math.sqrt(e / W) < STILL_RMS) continue;
    // cumulative mean normalised difference
    let summe = 0;
    d[0] = 1;
    for (let tau = 1; tau <= LAG_MAX; tau++) {
      let s = 0;
      for (let i = 0; i < W; i++) { const v = x[i] - x[i + tau]; s += v * v; }
      summe += s;
      d[tau] = summe > 0 ? s * tau / summe : 1;
    }
    let tau = -1;
    for (let t = LAG_MIN; t <= LAG_MAX; t++) {
      if (d[t] < YIN_SCHWELLE) { tau = t; while (tau < LAG_MAX && d[tau + 1] < d[tau]) tau++; break; }
    }
    if (tau < 0) { tau = LAG_MIN; for (let t = LAG_MIN + 1; t <= LAG_MAX; t++) if (d[t] < d[tau]) tau = t; }
    let feinTau = tau;
    if (tau > LAG_MIN && tau < LAG_MAX) {
      const nenner = 2 * (d[tau - 1] - 2 * d[tau] + d[tau + 1]);
      if (nenner !== 0) feinTau = tau + (d[tau - 1] - d[tau + 1]) / nenner;
    }
    hzListe.push(SR / feinTau);
    klarheit.push(Math.min(1, Math.max(0, 1 - d[tau])));
  }
  if (hzListe.length === 0) return { ...KEINE };
  const sortiert = [...hzListe].sort((p, q) => p - q), m = sortiert.length >> 1;
  const hz = sortiert.length % 2 ? sortiert[m] : 0.5 * (sortiert[m - 1] + sortiert[m]);
  const nah = hzListe.filter((f) => Math.abs(1200 * Math.log2(f / hz)) <= 50).length;
  const konfidenz = klarheit.reduce((s, c) => s + c, 0) / klarheit.length * (nah / n);
  return { note: Math.round(69 + 12 * Math.log2(hz / 440)), hz, konfidenz };
}

/** The root to propose: the detected note from TON_SCHWELLE on; else the tonic of the cut's key (Camelot, `tonartWurzel` + 9 for a minor key `nA`) in the octave of C3
 *  (note 60..71); else C3. */
export function grundVorschlag(e: Erkannt, tonart?: string): { note: number; quelle: 'erkannt' | 'tonart' | 'vorgabe' } {
  if (e.note !== null && e.konfidenz >= TON_SCHWELLE) return { note: e.note, quelle: 'erkannt' };
  const w = tonartWurzel(tonart);
  if (w !== null) return { note: 60 + (w + (/A\s*$/i.test(tonart as string) ? 9 : 0)) % 12, quelle: 'tonart' };
  return { note: 60, quelle: 'vorgabe' };
}
