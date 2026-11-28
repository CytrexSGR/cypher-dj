// ANALYZE window, slice 1: the pure, streaming analysis of one rendered strip (no I/O).
// FFT, spectrum, time picture, stereo and peaks; masking between two strips and objective hints.
import { Buffer } from 'node:buffer';
import {
  RATE, FFT_N, HOP, MAX_SPALTEN, KORR_FENSTER, FFT_TIEF, TIEF_HZ, DB_BODEN, ZEITBILD_DB_MIN, ZEITBILD_DB_MAX, STILLE_DB, STEREO_BAENDER,
  ZWOELFTEL_HZ, TERZ_HZ, SCHWELLEN, zwoelftelKanten, terzKanten, terzVon, hzText,
} from './sound_contract.ts';
import type { Stereo, Spektrum, Zeitbild, Messung, Ueberdeckung, UeberdeckungsBand, Schwerpunkt, Hinweis } from './sound_contract.ts';
import { tonName } from '../public/production/pianoroll.js';

const BAENDER = ZWOELFTEL_HZ.length;   // 120
const TERZ = BAENDER / 4;              // 30
const DF = RATE / FFT_N;

// In-place radix-2 FFT; the length must be a power of two.
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const a = re[i]; re[i] = re[j]; re[j] = a; const b = im[i]; im[i] = im[j]; im[j] = b; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, half = len >> 1;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

// Column raster of a range of `frames` sample frames: one frame per column, at most MAX_SPALTEN columns.
// A range so long that the hop exceeds the FFT window (more than about 2048 * 8192 frames, 6 min at 48 kHz) is only sampled: every column looks at one window
// of 8192 frames, the frames between the columns are not seen by the spectrum, the time picture and the band stereo values (peak, rms and the
// broadband correlation still cover every frame).
export function rasterVon(frames: number): { hop: number; spalten: number } {
  if (frames < FFT_N) return { hop: HOP, spalten: 1 };
  const f = Math.floor((frames - FFT_N) / HOP) + 1;
  if (f <= MAX_SPALTEN) return { hop: HOP, spalten: f };
  const hop = Math.ceil((frames - FFT_N) / (MAX_SPALTEN - 1));
  return { hop, spalten: Math.floor((frames - FFT_N) / hop) + 1 };
}

export interface Teilmessung {
  stumm: boolean; spitze_db: number; rms_db: number; crest_db: number;
  stereo: Stereo; spektrum: Spektrum; zeitbild: Zeitbild;
  spaltenTerz: Float32Array; spalten: number;   // spalten x 30 dB values, column after column
}

// The bands are band integrals, not line levels: every FFT bin splits its power over the 1/12 bands by overlap, so a full-scale sine reads 0 dB only when its
// main lobe fits into the band. The short window (Hann 8192: lobe about 23 Hz) is wider than a band below about 250 Hz (55 Hz: -5.5 dB in its own band),
// so the mean and maximum spectrum below TIEF_HZ come from a long window (Hann 32768: lobe about 6 Hz) whenever the range is long enough; measured with
// it: 27.5 Hz -2.3 dB, 41.2 Hz -1.1 dB, 55 Hz -0.2 dB, 82 Hz and above 0.0 dB for notes on the A440 grid (a tone between two bands splits over both).
// The sum of the band powers stays exactly 0 dB. The time picture, the masking and a range shorter than the long window keep the short one.
// Lazily built tables: Hann window, share of every FFT bin in every 1/12 band, stereo band of every bin.
interface Tabellen { w: Float64Array; sw2: number; start: Int32Array; band: Int32Array; anteil: Float64Array; stereoBand: Int8Array }
let TAB: Tabellen | null = null;
function tabellen(): Tabellen {
  if (TAB) return TAB;
  const w = new Float64Array(FFT_N);
  let sw2 = 0;
  for (let i = 0; i < FFT_N; i++) { w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FFT_N); sw2 += w[i] * w[i]; }
  const kanten: number[] = [zwoelftelKanten(0)[0]];
  for (let j = 0; j < BAENDER; j++) kanten.push(zwoelftelKanten(j)[1]);
  const start = new Int32Array(FFT_N / 2 + 2), band: number[] = [], anteil: number[] = [];
  const stereoBand = new Int8Array(FFT_N / 2 + 1).fill(-1);
  for (let k = 0; k <= FFT_N / 2; k++) {
    start[k] = band.length;
    const lo = (k - 0.5) * DF, hi = (k + 0.5) * DF;
    for (let j = 0; j < BAENDER; j++) {
      const o = Math.min(hi, kanten[j + 1]) - Math.max(lo, kanten[j]);
      if (o > 0) { band.push(j); anteil.push(o / DF); }
    }
    const f = k * DF;
    // like the spectrum bands the stereo values start at the lowest band edge (20 Hz): the bins below it (DC, rumble) count in no band
    STEREO_BAENDER.forEach(([a, b], i) => { if (f >= Math.max(a, kanten[0]) && f < b) stereoBand[k] = i; });
  }
  start[FFT_N / 2 + 1] = band.length;
  TAB = { w, sw2, start, band: Int32Array.from(band), anteil: Float64Array.from(anteil), stereoBand };
  return TAB;
}

// The long window of the low bands: Hann over FFT_TIEF frames and the share of its bins in the 1/12 bands whose centre lies below TIEF_HZ.
interface TiefTabellen { w: Float64Array; sw2: number; start: Int32Array; band: Int32Array; anteil: Float64Array; kMax: number; baender: number }
let TABT: TiefTabellen | null = null;
function tabellenTief(): TiefTabellen {
  if (TABT) return TABT;
  const df = RATE / FFT_TIEF, w = new Float64Array(FFT_TIEF);
  let sw2 = 0;
  for (let i = 0; i < FFT_TIEF; i++) { w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FFT_TIEF); sw2 += w[i] * w[i]; }
  const baender = ZWOELFTEL_HZ.findIndex((hz) => hz >= TIEF_HZ);
  const kMax = Math.ceil(zwoelftelKanten(baender - 1)[1] / df) + 1;
  const start = new Int32Array(kMax + 2), band: number[] = [], anteil: number[] = [];
  for (let k = 0; k <= kMax; k++) {
    start[k] = band.length;
    const lo = (k - 0.5) * df, hi = (k + 0.5) * df;
    for (let j = 0; j < baender; j++) {
      const [a, b] = zwoelftelKanten(j), o = Math.min(hi, b) - Math.max(lo, a);
      if (o > 0) { band.push(j); anteil.push(o / df); }
    }
  }
  start[kMax + 1] = band.length;
  TABT = { w, sw2, start, band: Int32Array.from(band), anteil: Float64Array.from(anteil), kMax, baender };
  return TABT;
}

const dbVon = (p: number): number => (p > 0 ? Math.max(DB_BODEN, 10 * Math.log10(p / 0.5)) : DB_BODEN);
const klemmeK = (x: number): number => Math.max(-1, Math.min(1, x));
const korr = (lr: number, ll: number, rr: number): number => (ll > 0 && rr > 0 ? klemmeK(lr / Math.sqrt(ll * rr)) : 0);
function breite(side: number, mid: number): number {
  if (!(side > 0)) return DB_BODEN;
  if (!(mid > 0)) return -DB_BODEN;
  return Math.max(DB_BODEN, Math.min(-DB_BODEN, 10 * Math.log10(side / mid)));
}

export class StreifenAnalysator {
  private readonly frames: number;
  private readonly hop: number;
  private readonly spalten: number;
  private readonly t = tabellen();
  private readonly ringL = new Float64Array(FFT_N);
  private readonly ringR = new Float64Array(FFT_N);
  private readonly re = new Float64Array(FFT_N);
  private readonly im = new Float64Array(FFT_N);
  private readonly bandP = new Float64Array(BAENDER);
  private readonly sumP = new Float64Array(BAENDER);
  private readonly maxP = new Float64Array(BAENDER);
  private readonly db12 = new Array<number>(BAENDER).fill(DB_BODEN);
  private readonly bytes: Uint8Array;
  private readonly terz: Float32Array;
  private nichtStille = 0;
  private spalte = 0;
  private gesehen = 0;
  private spitze = 0;
  private sLL = 0; private sRR = 0; private sLR = 0; private sMM = 0; private sSS = 0;
  private wLL = 0; private wRR = 0; private wLR = 0; private wN = 0;
  private korrMin = Infinity;
  // stereo bands from FFT frames: LR, LL, RR, MM, SS per band
  private readonly bLR = new Float64Array(4); private readonly bLL = new Float64Array(4); private readonly bRR = new Float64Array(4);
  private readonly bMM = new Float64Array(4); private readonly bSS = new Float64Array(4);
  private readonly bPow = new Float64Array(4);   // power of mid plus side per stereo band, summed over the non-silent frames
  // the long window for the low bands (only for ranges of at least FFT_TIEF frames): the mid signal and the frame energy in rings
  private readonly tief: { t: TiefTabellen; hop: number; ringM: Float64Array; ringE: Float64Array; re: Float64Array; im: Float64Array;
    sumP: Float64Array; maxP: Float64Array; bandP: Float64Array } | null = null;
  private tiefFrames = 0;
  private tiefEnergie = 0;

  constructor(frames: number) {
    this.frames = frames;
    const r = rasterVon(frames);
    this.hop = r.hop; this.spalten = r.spalten;
    this.bytes = new Uint8Array(this.spalten * BAENDER);
    this.terz = new Float32Array(this.spalten * TERZ).fill(DB_BODEN);
    if (frames >= FFT_TIEF) {
      const t = tabellenTief();
      this.tief = { t, hop: 4 * this.hop, ringM: new Float64Array(FFT_TIEF), ringE: new Float64Array(FFT_TIEF), re: new Float64Array(FFT_TIEF),
        im: new Float64Array(FFT_TIEF), sumP: new Float64Array(t.baender), maxP: new Float64Array(t.baender), bandP: new Float64Array(t.baender) };
    }
  }

  // Interleaved stereo, any block length.
  schiebe(block: Float32Array): void {
    const n = block.length >> 1, { ringL, ringR } = this;
    for (let i = 0; i < n; i++) {
      const l = block[2 * i], r = block[2 * i + 1];
      const al = Math.abs(l), ar = Math.abs(r);
      if (al > this.spitze) this.spitze = al;
      if (ar > this.spitze) this.spitze = ar;
      const m = (l + r) / 2, s = (l - r) / 2;
      this.sLL += l * l; this.sRR += r * r; this.sLR += l * r; this.sMM += m * m; this.sSS += s * s;
      this.wLL += l * l; this.wRR += r * r; this.wLR += l * r;
      if (++this.wN === KORR_FENSTER) this.schliesseFenster();
      const pos = this.gesehen % FFT_N;
      ringL[pos] = l; ringR[pos] = r;
      const tf = this.tief;
      if (tf) {
        const pt = this.gesehen % FFT_TIEF, e = (l * l + r * r) / 2;
        this.tiefEnergie += e - tf.ringE[pt];
        tf.ringM[pt] = m; tf.ringE[pt] = e;
      }
      this.gesehen++;
      if (tf && this.gesehen >= FFT_TIEF && (this.gesehen - FFT_TIEF) % tf.hop === 0) this.frameTief();
      if (this.gesehen >= FFT_N && (this.gesehen - FFT_N) % this.hop === 0 && this.spalte < this.spalten) this.frame(FFT_N);
    }
  }

  private schliesseFenster(): void {
    if (dbVon((this.wLL + this.wRR) / (2 * this.wN)) >= STILLE_DB)   // silent = both channels, so L = -R still counts
      this.korrMin = Math.min(this.korrMin, korr(this.wLR, this.wLL, this.wRR));
    this.wLL = this.wRR = this.wLR = 0; this.wN = 0;
  }

  // One FFT frame of the last `echt` frames (a short range is zero padded at the end of the window).
  private frame(echt: number): void {
    const { t, re, im, ringL, ringR, bandP } = this;
    const col = this.spalte++;
    const first = this.gesehen >= FFT_N ? this.gesehen % FFT_N : 0;   // ring index of the oldest frame
    let e = 0;
    for (let i = 0; i < FFT_N; i++) {
      if (i < echt) {
        const p = (first + i) % FFT_N;
        re[i] = ringL[p] * t.w[i]; im[i] = ringR[p] * t.w[i];
        e += (ringL[p] * ringL[p] + ringR[p] * ringR[p]) / 2;
      } else { re[i] = 0; im[i] = 0; }
    }
    if (dbVon(e / Math.max(1, echt)) < STILLE_DB) return;   // silent frame: zero column, floor in the third-octave values
    fft(re, im);
    this.nichtStille++;
    bandP.fill(0);
    const sk = 2 / (FFT_N * t.sw2);
    for (let k = 0; k <= FFT_N / 2; k++) {
      const nk = (FFT_N - k) % FFT_N;
      const lr = (re[k] + re[nk]) / 2, li = (im[k] - im[nk]) / 2;
      const rr = (im[k] + im[nk]) / 2, ri = -(re[k] - re[nk]) / 2;
      const mr = (lr + rr) / 2, mi = (li + ri) / 2, sr = (lr - rr) / 2, si = (li - ri) / 2;
      const mm = mr * mr + mi * mi;
      const pk = mm * sk * (k === 0 || k === FFT_N / 2 ? 0.5 : 1);
      for (let q = t.start[k]; q < t.start[k + 1]; q++) bandP[t.band[q]] += pk * t.anteil[q];
      const sb = t.stereoBand[k];
      if (sb >= 0 && k > 0) {
        this.bLR[sb] += lr * rr + li * ri; this.bLL[sb] += lr * lr + li * li; this.bRR[sb] += rr * rr + ri * ri;
        const ss = sr * sr + si * si;
        this.bMM[sb] += mm; this.bSS[sb] += ss;
        this.bPow[sb] += (mm + ss) * sk;
      }
    }
    for (let j = 0; j < BAENDER; j++) {
      this.sumP[j] += bandP[j];
      if (bandP[j] > this.maxP[j]) this.maxP[j] = bandP[j];
      const d = dbVon(bandP[j]);
      this.db12[j] = d;
      this.bytes[col * BAENDER + j] = Math.max(0, Math.min(255, Math.round((d - ZEITBILD_DB_MIN) / (ZEITBILD_DB_MAX - ZEITBILD_DB_MIN) * 255)));
    }
    this.terz.set(terzVon(this.db12), col * TERZ);
  }

  // One long frame of the mid signal: the power of the low 1/12 bands. A silent frame is skipped like a short one.
  private frameTief(): void {
    const tf = this.tief!, { t, re, im, ringM, bandP } = tf;
    if (dbVon(Math.max(0, this.tiefEnergie) / FFT_TIEF) < STILLE_DB) return;
    const first = this.gesehen % FFT_TIEF;
    for (let i = 0; i < FFT_TIEF; i++) { re[i] = ringM[(first + i) % FFT_TIEF] * t.w[i]; im[i] = 0; }
    fft(re, im);
    this.tiefFrames++;
    bandP.fill(0);
    const sk = 2 / (FFT_TIEF * t.sw2);
    for (let k = 0; k <= t.kMax; k++) {
      const pk = (re[k] * re[k] + im[k] * im[k]) * sk * (k === 0 ? 0.5 : 1);
      for (let q = t.start[k]; q < t.start[k + 1]; q++) bandP[t.band[q]] += pk * t.anteil[q];
    }
    for (let j = 0; j < t.baender; j++) { tf.sumP[j] += bandP[j]; if (bandP[j] > tf.maxP[j]) tf.maxP[j] = bandP[j]; }
  }

  ende(): Teilmessung {
    if (this.frames < FFT_N && this.spalte === 0) this.frame(this.gesehen);
    const spitze_db = this.spitze > 0 ? Math.max(DB_BODEN, 20 * Math.log10(this.spitze)) : DB_BODEN;
    const rms_db = this.gesehen > 0 ? 10 * Math.log10(Math.max((this.sLL + this.sRR) / (2 * this.gesehen), 1e-20)) : DB_BODEN;
    const stumm = spitze_db <= STILLE_DB;
    const nf = this.nichtStille;
    const spektrum: Spektrum = { hz: [...ZWOELFTEL_HZ], mittel_db: [], max_db: [] };
    for (let j = 0; j < BAENDER; j++) {
      spektrum.mittel_db.push(stumm || nf === 0 ? DB_BODEN : dbVon(this.sumP[j] / nf));
      spektrum.max_db.push(stumm ? DB_BODEN : dbVon(this.maxP[j]));
    }
    // the low bands from the long window: the mean replaces the short one, the maximum is the higher of the two (a short hit reads higher in the
    // short window, a held note in the long one)
    const tf = this.tief;
    if (tf && !stumm && this.tiefFrames > 0) {
      for (let j = 0; j < tf.t.baender; j++) {
        spektrum.mittel_db[j] = dbVon(tf.sumP[j] / this.tiefFrames);
        spektrum.max_db[j] = Math.max(spektrum.max_db[j], dbVon(tf.maxP[j]));
      }
    }
    const ganz = korr(this.sLR, this.sLL, this.sRR);
    const stereo: Stereo = stumm
      ? { korrelation: 0, korrelation_min: 0, breite_db: DB_BODEN,
          baender: STEREO_BAENDER.map(([a, b]) => ({ hz_von: a, hz_bis: b, korrelation: 0, breite_db: DB_BODEN, pegel_db: DB_BODEN })) }
      : { korrelation: ganz, korrelation_min: Number.isFinite(this.korrMin) ? this.korrMin : ganz, breite_db: breite(this.sSS, this.sMM),
          baender: STEREO_BAENDER.map(([a, b], i) => ({ hz_von: a, hz_bis: b, korrelation: korr(this.bLR[i], this.bLL[i], this.bRR[i]),
            breite_db: breite(this.bSS[i], this.bMM[i]),
            pegel_db: nf > 0 ? dbVon(this.bPow[i] / nf) : DB_BODEN })) };
    if (stumm) { this.bytes.fill(0); this.terz.fill(DB_BODEN); }
    const zeitbild: Zeitbild = { spalten: this.spalten, zeilen: BAENDER, sek_je_spalte: this.hop / RATE,
      db_min: ZEITBILD_DB_MIN, db_max: ZEITBILD_DB_MAX, daten: Buffer.from(this.bytes).toString('base64') };
    return { stumm, spitze_db, rms_db, crest_db: spitze_db - rms_db, stereo, spektrum, zeitbild, spaltenTerz: this.terz, spalten: this.spalten };
  }
}

// ---- masking and hints ----

// Share of the time columns in which both strips are above -60 dB and within 9 dB of each other, per 1/3 octave band.
// Both come from the same raster; the shorter one decides if they differ.
export function ueberdeckung(q: Teilmessung, v: Teilmessung): Ueberdeckung {
  const spalten = Math.min(q.spalten, v.spalten);
  const mq = terzVon(q.spektrum.mittel_db), mv = terzVon(v.spektrum.mittel_db);
  const baender: UeberdeckungsBand[] = [];
  for (let m = 0; m < TERZ; m++) {
    let n = 0;
    for (let c = 0; c < spalten; c++) {
      const a = q.spaltenTerz[c * TERZ + m], b = v.spaltenTerz[c * TERZ + m];
      if (a > SCHWELLEN.pegelMinDb && b > SCHWELLEN.pegelMinDb && Math.abs(a - b) <= SCHWELLEN.naeheDb) n++;
    }
    baender.push({ hz: TERZ_HZ[m], quelle_db: mq[m], vergleich_db: mv[m], anteil: spalten > 0 ? n / spalten : 0 });
  }
  const laeufe: Schwerpunkt[] = [];
  for (let m = 0; m < TERZ;) {
    if (baender[m].anteil < SCHWELLEN.schwerpunkt) { m++; continue; }
    let e = m, summe = 0;
    while (e < TERZ && baender[e].anteil >= SCHWELLEN.schwerpunkt) summe += baender[e++].anteil;
    laeufe.push({ hz_von: terzKanten(m)[0], hz_bis: terzKanten(e - 1)[1], anteil: summe / (e - m) });
    m = e;
  }
  // stable sort: runs are in ascending frequency, so ties keep the lower one first
  laeufe.sort((a, b) => b.anteil - a.anteil);
  return { baender, schwerpunkte: laeufe.slice(0, 3) };
}

// Nearest semitone name, house convention (60 = C3).
export function notenName(hz: number): string {
  return tonName(Math.round(69 + 12 * Math.log2(hz / 440)));
}

// The resonance bands of a source: a narrow peak that stands SCHWELLEN.resonanzDb over the median of the six bands on each side, at most three, strongest
// first. `n` is the index in the 1/12 octave raster, `d` the height over the median (dB). The resonance hints and the tame proposal share it.
function resonanzBaender(m: Messung): { n: number; d: number }[] {
  const db = m.spektrum.mittel_db, res: { n: number; d: number }[] = [];
  for (let n = 0; n < db.length; n++) {
    if (!(db[n] > SCHWELLEN.pegelMinDb)) continue;
    const nachbarn: number[] = [];
    for (let j = Math.max(0, n - 6); j <= Math.min(db.length - 1, n + 6); j++) if (j !== n) nachbarn.push(db[j]);
    nachbarn.sort((a, b) => a - b);
    const h = nachbarn.length >> 1;
    const median = nachbarn.length % 2 ? nachbarn[h] : (nachbarn[h - 1] + nachbarn[h]) / 2;
    const d = db[n] - median;
    if (d < SCHWELLEN.resonanzDb) continue;
    if ((n > 0 && db[n - 1] > db[n]) || (n < db.length - 1 && db[n + 1] >= db[n])) continue;   // a local peak (plateaus count once)
    res.push({ n, d });
  }
  res.sort((a, b) => b.d - a.d);
  return res.slice(0, 3);
}

// Objective findings about one source: bass_nicht_mono, true_peak, resonanz. A silent source has none.
export function hinweiseQuelle(m: Messung): Hinweis[] {
  if (m.stumm) return [];
  const aus: Hinweis[] = [];
  const bass = m.stereo.baender[0];
  // The band carries energy when the power of L plus R below 120 Hz is above -60 dB (a bass in full antiphase has no mid left).
  if (bass && bass.korrelation < SCHWELLEN.bassMono && bass.pegel_db > SCHWELLEN.pegelMinDb) {
    aus.push({ art: 'bass_nicht_mono', text: `${m.name}: the bass below ${SCHWELLEN.bassHz} Hz is not mono (correlation ${bass.korrelation.toFixed(2)})` });
  }
  const tp = m.lautheit.true_peak_dbtp;
  if (tp !== null && tp > SCHWELLEN.truePeak) aus.push({ art: 'true_peak',
    text: `${m.name}: true peak ${tp.toFixed(1)} dBTP is above ${SCHWELLEN.truePeak} dBTP` });
  for (const { n, d } of resonanzBaender(m)) {
    const hz = ZWOELFTEL_HZ[n];
    aus.push({ art: 'resonanz', hz, text: `${m.name}: narrow peak at ${hzText(hz)} (${notenName(hz)}), ${d.toFixed(1)} dB above its octave` });
  }
  return aus;
}

// ueberdeckung_tief for every Schwerpunkt that starts below 250 Hz.
export function hinweiseUeberdeckung(q: Messung, v: Messung, u: Ueberdeckung): Hinweis[] {
  return u.schwerpunkte.filter((s) => s.hz_von < SCHWELLEN.tiefHz).map((s) => ({
    art: 'ueberdeckung_tief' as const,
    hz: Math.sqrt(s.hz_von * s.hz_bis),
    text: `${q.name} and ${v.name} mask each other from ${hzText(s.hz_von)} to ${hzText(s.hz_bis)} (${Math.round(s.anteil * 100)} % of the time)`,
  }));
}

// ---- masking over all strip pairs (strand 5 slice 6) ----

/** One sounding strip as the masking analysis sees it. `pegel_db` orders the strips (RMS) and decides which of a pair is the quieter one.
 *  `pos`: where a proposed EQ stage goes in the chain of that strip (default 0); `null` = the chain is full, the conflict is listed without a proposal. */
export interface MaskierungTeil { id: string; name?: string; m: Teilmessung; pegel_db: number; pos?: number | null }
export interface MaskierungOptionen {
  /** Extension point for slice 2 (dynamic EQ Pro bands): true proposes `d<m>/dyn` 1 with the band's mean level as threshold instead of a static cut.
   *  Off until slice 2 is merged: the rows `d<m>/*` do not exist before. */
  dynamisch?: boolean;
  /** The EQ band that carries the proposal (1..8; 4 is a Bell by default). */
  band?: number;
}
export interface MaskierungBefehl { befehl: 'insert_setzen'; strang_id: string; pos: number; art: 'eq'; werte: Record<string, number> }
export interface MaskierungVorschlag { strang_id: string; befehle: MaskierungBefehl[]; hz: number; q: number; gain_db: number }
export interface MaskierungPaar {
  a: string; b: string; hz_von: number; hz_bis: number; anteil: number; breite_okt: number; score: number;
  /** The quieter strip of the pair, where the cut goes. */
  leiser: string;
  vorschlag: MaskierungVorschlag | null;
}
export const MASKIERUNG_MAX_STRANG = 24;
export const MASKIERUNG_CUT_DB = -3;

// Pairs of the (at most 24 loudest) strips: per pair the run of `ueberdeckung` with the best score (share of the time x width in octaves), then the
// `max` best pairs, each with a Bell cut on the quieter strip of the pair, centred on the run (geometric centre), Q = centre / bandwidth clamped 0.7..6.
// A silent strip never takes part. Ties keep the input order (stable).
export function maskierungPaare(teile: MaskierungTeil[], max = 5, o: MaskierungOptionen = {}): MaskierungPaar[] {
  const band = Math.min(8, Math.max(1, Math.round(o.band ?? 4)));
  const klingt = teile.map((t, i) => ({ t, i })).filter(({ t }) => !t.m.stumm && t.pegel_db > SCHWELLEN.pegelMinDb);
  klingt.sort((x, y) => y.t.pegel_db - x.t.pegel_db || x.i - y.i);
  const laut = klingt.slice(0, MASKIERUNG_MAX_STRANG).map(({ t }) => t);
  const aus: MaskierungPaar[] = [];
  for (let i = 0; i < laut.length; i++) {
    for (let j = i + 1; j < laut.length; j++) {
      const lauter = laut[i], leiser = laut[j];   // sorted: i is at least as loud as j
      const u = ueberdeckung(leiser.m, lauter.m);
      let beste: { s: Schwerpunkt; breite: number; score: number } | null = null;
      for (const s of u.schwerpunkte) {
        const breite = Math.log2(s.hz_bis / s.hz_von);
        const score = s.anteil * breite;
        if (!beste || score > beste.score) beste = { s, breite, score };
      }
      if (!beste) continue;
      const { s } = beste;
      const mitte = Math.sqrt(s.hz_von * s.hz_bis);
      const q = Math.min(6, Math.max(0.7, mitte / (s.hz_bis - s.hz_von)));
      const im = u.baender.filter((b) => b.hz >= s.hz_von && b.hz <= s.hz_bis);
      const pegel = im.length ? im.reduce((x, b) => x + b.quelle_db, 0) / im.length : DB_BODEN;
      const runde = (x: number, n: number): number => Math.round(x * 10 ** n) / 10 ** n;
      const hz = runde(mitte, 1), qr = runde(q, 2);
      let vorschlag: MaskierungVorschlag | null = null;
      if (leiser.pos !== null) {
        const werte: Record<string, number> = { [`b${band}/an`]: 1, [`b${band}/typ`]: 0,
          [`b${band}/freq`]: hz, [`b${band}/q`]: qr, [`b${band}/gain`]: MASKIERUNG_CUT_DB };
        if (o.dynamisch) {   // slice 2: the cut works only above the mean level of the band
          werte[`d${band}/dyn`] = 1; werte[`d${band}/schwelle`] = runde(pegel, 1);
        }
        vorschlag = { strang_id: leiser.id, hz, q: qr, gain_db: MASKIERUNG_CUT_DB,
          befehle: [{ befehl: 'insert_setzen', strang_id: leiser.id, pos: leiser.pos ?? 0, art: 'eq', werte }] };
      }
      aus.push({ a: lauter.id, b: leiser.id, hz_von: s.hz_von, hz_bis: s.hz_bis, anteil: s.anteil, breite_okt: beste.breite, score: beste.score,
        leiser: leiser.id, vorschlag });
    }
  }
  aus.sort((x, y) => y.score - x.score);   // stable
  return aus.slice(0, Math.max(0, max));
}

// ---- tame resonances (strand 5 slice 5) ----

export interface ResonanzBand { hz: number; q: number; schwelle_db: number; bereich_db: number }
export const RESONANZ_Q = 8, RESONANZ_BEREICH_DB = -6, RESONANZ_SCHWELLE_ABZUG_DB = 3, RESONANZ_KETTE_MAX = 5;
/** Where the bands go: `kette` = stages in the chain of the strip (5 = full); `eq` = the strip's EQ stage that takes the bands (see resonanzBefehle) with
 *  its free band numbers (1..8), null = the strip has no EQ with a free band. */
export interface ResonanzStrang { id: string; kette: number; eq?: { insert_id: string; frei: number[] } | null }
export type ResonanzBefehl =
  | { befehl: 'insert_setzen'; strang_id: string; pos: number; art: 'eq'; werte: Record<string, number> }
  | { befehl: 'insert_param_setzen'; insert_id: string; param: string; wert: number };

const rundeAuf = (x: number, n: number): number => Math.round(x * 10 ** n) / 10 ** n;
const zwischen = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** At most three dynamic Bell bands for the resonances of a source: Q 8, range -6 dB, threshold = the level of the band minus 3 dB (the peak sits in its
 *  own 1/12 octave band, so that is what the detector at the band sees). A silent source has none. Strongest resonance first. */
export function resonanzVorschlag(m: Messung): ResonanzBand[] {
  if (m.stumm) return [];
  return resonanzBaender(m).map(({ n }) => ({ hz: rundeAuf(zwischen(ZWOELFTEL_HZ[n], 10, 22000), 1), q: RESONANZ_Q,
    schwelle_db: rundeAuf(zwischen(m.spektrum.mittel_db[n] - RESONANZ_SCHWELLE_ABZUG_DB, -60, 0), 1), bereich_db: RESONANZ_BEREICH_DB }));
}

const bandWerte = (b: number, r: ResonanzBand): [string, number][] => [
  [`b${b}/an`, 1], [`b${b}/typ`, 0], [`b${b}/freq`, r.hz], [`b${b}/gain`, 0], [`b${b}/q`, r.q],
  [`d${b}/dyn`, 1], [`d${b}/schwelle`, r.schwelle_db], [`d${b}/bereich`, r.bereich_db]];
function paramBefehle(baender: ResonanzBand[], eq: { insert_id: string; frei: number[] }): ResonanzBefehl[] {
  return baender.flatMap((r, i) => bandWerte(eq.frei[i], r).map(([param, wert]) => (
    { befehl: 'insert_param_setzen' as const, insert_id: eq.insert_id, param, wert })));
}

/** The ready command list for `proj_aendern` (one undo step): the bands go to free bands of the strip's EQ when it has enough, else into a new EQ stage at
 *  position 0 (bands 1.., if the chain has room), else into the free bands of the EQ as far as they go. Always Bell with `dyn` 1. `null` = nothing fits
 *  (chain full, no free band) or there are no bands. */
export function resonanzBefehle(baender: ResonanzBand[], strang: ResonanzStrang): ResonanzBefehl[] | null {
  if (!baender.length) return null;
  const eq = strang.eq && strang.eq.frei.length ? strang.eq : null;
  if (eq && eq.frei.length >= baender.length) return paramBefehle(baender, eq);
  if (strang.kette < RESONANZ_KETTE_MAX) {
    const werte: Record<string, number> = {};
    baender.forEach((r, i) => { for (const [k, v] of bandWerte(i + 1, r)) werte[k] = v; });
    return [{ befehl: 'insert_setzen', strang_id: strang.id, pos: 0, art: 'eq', werte }];
  }
  return eq ? paramBefehle(baender.slice(0, eq.frei.length), eq) : null;
}
