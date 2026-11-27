// Streaming loudness meter of the master output for GET /analyse/pegel: ITU-R BS.1770 / EBU R128 at 48 kHz, pure, no I/O.
// Keeps filter states and block history across calls, so it reads only the frames written since the last read:
// momentary (400 ms) and short-term (3 s) loudness, true peak (4x oversampled, with held max) and stereo correlation (400 ms).
import { K_SHELF, K_HOCH, OS_PHASEN, OS_TAPS } from './sound_live.ts';
import { DB_BODEN, STILLE_DB } from './sound_contract.ts';

const MAX_BLOECKE = 216000;                           // 6 h of 100 ms gating blocks above the absolute gate
const ABS_TOR = 10 ** ((-70 + 0.691) / 10);          // absolute gate of BS.1770-4 (-70 LUFS) as a block power
const RATE = 48000, BLOCK = 4800, N_M = 4, N_S = 30, HIST = OS_TAPS - 1;   // 11 frames of history for the interpolation taps

const r1 = (x: number): number => Math.round(x * 10) / 10;
const r2 = (x: number): number => Math.round(x * 100) / 100;
const dbAmp = (a: number): number => (a > 0 ? Math.max(DB_BODEN, 20 * Math.log10(a)) : DB_BODEN);

export class MasterPegel {
  private fz = new Float64Array(8);                    // per channel (2): shelf x1 x2 y1 y2, high-pass u1 u2 z1 z2 -> 4 + 4 values
  private fzR = new Float64Array(8);
  private n = 0;                                       // frames in the partial sub-block
  private qL = 0; private qR = 0;                      // K-weighted squares of the partial sub-block
  private sLR = 0; private sLL = 0; private sRR = 0;   // raw sums of the partial sub-block
  private leistung: number[] = [];                     // last 30 sub-block powers
  private korr: [number, number, number][] = [];       // last 4 raw sums
  private hist = new Float32Array(0);                  // last frames of the previous call (interleaved)
  private tp = DB_BODEN; private tpMax = DB_BODEN;
  private still = true;
  private frames = 0;
  private bloecke = new Float64Array(4096);           // 400 ms gating-block powers for the integrated loudness
  private nBloecke = 0; private voll = false;
  private lueckeFrames = 0;

  private leereFenster(): void {
    this.fz.fill(0); this.fzR.fill(0);
    this.n = 0; this.qL = this.qR = this.sLR = this.sLL = this.sRR = 0;
    this.leistung = []; this.korr = [];
    this.hist = new Float32Array(0);
  }

  zuruecksetzen(): void {
    this.leereFenster();
    this.tp = DB_BODEN; this.tpMax = DB_BODEN; this.frames = 0;
    this.nBloecke = 0; this.voll = false; this.lueckeFrames = 0;
  }

  schiebe(daten: Float32Array, luecke = 0): void {
    if (luecke > 0) { this.leereFenster(); this.lueckeFrames += luecke; }
    const nf = Math.floor(daten.length / 2);
    this.frames += nf;
    let spitze = 0;
    const [sb0, sb1, sb2] = K_SHELF.b, [, sa1, sa2] = K_SHELF.a, [hb0, hb1, hb2] = K_HOCH.b, [, ha1, ha2] = K_HOCH.a;
    for (let i = 0; i < nf; i++) {
      const l = daten[2 * i], r = daten[2 * i + 1];
      const al = Math.abs(l), ar = Math.abs(r);
      if (al > spitze) spitze = al;
      if (ar > spitze) spitze = ar;
      this.qL += this.kGewicht(this.fz, l, sb0, sb1, sb2, sa1, sa2, hb0, hb1, hb2, ha1, ha2);
      this.qR += this.kGewicht(this.fzR, r, sb0, sb1, sb2, sa1, sa2, hb0, hb1, hb2, ha1, ha2);
      this.sLR += l * r; this.sLL += l * l; this.sRR += r * r;
      if (++this.n === BLOCK) {
        this.leistung.push(this.qL / BLOCK + this.qR / BLOCK);
        if (this.leistung.length > N_S) this.leistung.shift();
        if (this.leistung.length >= N_M) this.blockDazu();
        this.korr.push([this.sLR, this.sLL, this.sRR]);
        if (this.korr.length > N_M) this.korr.shift();
        this.n = 0; this.qL = this.qR = this.sLR = this.sLL = this.sRR = 0;
      }
    }
    // true peak: history + new frames; frames whose taps reach into the future wait for the next call
    const nh = this.hist.length / 2;
    const buf = new Float32Array(this.hist.length + daten.length);
    buf.set(this.hist, 0); buf.set(daten, this.hist.length);
    const len = nh + nf;
    let m = spitze;
    for (let c = 0; c < 2; c++) {
      for (let i = 5; i + 6 < len; i++) {
        for (const h of OS_PHASEN) {
          let s = 0;
          for (let k = 0; k < OS_TAPS; k++) s += buf[2 * (i + k - 5) + c] * h[k];
          const b = Math.abs(s); if (b > m) m = b;
        }
      }
    }
    this.hist = buf.slice(Math.max(0, len - HIST) * 2);
    this.tp = dbAmp(m);
    if (this.tp > this.tpMax) this.tpMax = this.tp;
    this.still = nf === 0 || dbAmp(spitze) <= STILLE_DB;
  }

  // only blocks above the absolute gate are kept: BS.1770-4 discards the others anyway, and silence must not fill the cap
  private blockDazu(): void {
    if (this.voll) return;
    let p = 0;
    for (const x of this.leistung.slice(-N_M)) p += x;
    p /= N_M;
    if (!(p > ABS_TOR)) return;
    if (this.nBloecke >= MAX_BLOECKE) { this.voll = true; return; }
    if (this.nBloecke === this.bloecke.length) { const g = new Float64Array(this.bloecke.length * 2); g.set(this.bloecke); this.bloecke = g; }
    this.bloecke[this.nBloecke++] = p;
    if (this.nBloecke >= MAX_BLOECKE) this.voll = true;
  }

  // BS.1770-4 gating: absolute -70 LUFS, then 10 LU below the absolute-gated loudness
  private lufsI(): number | null {
    const abs = ABS_TOR;
    let sum = 0, n = 0;
    for (let i = 0; i < this.nBloecke; i++) { const b = this.bloecke[i]; if (b > abs) { sum += b; n++; } }
    if (n === 0) return null;
    const rel = (sum / n) * 0.1;
    let s2 = 0, n2 = 0;
    for (let i = 0; i < this.nBloecke; i++) { const b = this.bloecke[i]; if (b > abs && b > rel) { s2 += b; n2++; } }
    if (n2 === 0) return null;
    return r1(-0.691 + 10 * Math.log10(s2 / n2));
  }

  private kGewicht(z: Float64Array, x: number, sb0: number, sb1: number, sb2: number, sa1: number, sa2: number,
    hb0: number, hb1: number, hb2: number, ha1: number, ha2: number): number {
    const y = sb0 * x + sb1 * z[0] + sb2 * z[1] - sa1 * z[2] - sa2 * z[3];
    z[1] = z[0]; z[0] = x; z[3] = z[2]; z[2] = y;
    const o = hb0 * y + hb1 * z[4] + hb2 * z[5] - ha1 * z[6] - ha2 * z[7];
    z[5] = z[4]; z[4] = y; z[7] = z[6]; z[6] = o;
    return o * o;
  }

  private lufs(anzahl: number): number | null {
    if (this.leistung.length < anzahl) return null;
    let p = 0;
    for (const x of this.leistung.slice(-anzahl)) p += x;
    p /= anzahl;
    if (!(p > 0)) return null;
    const l = -0.691 + 10 * Math.log10(p);
    return l < -70 ? null : r1(l);
  }

  stand(): {
    stumm: boolean; lufs_m: number | null; lufs_s: number | null; tp_dbtp: number; tp_max_dbtp: number; korrelation: number | null;
    dauer_s: number; lufs_i: number | null; lufs_i_voll: boolean; luecke_s: number;
  } {
    let korrelation: number | null = null;
    if (this.korr.length >= N_M) {
      let lr = 0, ll = 0, rr = 0;
      for (const [a, b, c] of this.korr) { lr += a; ll += b; rr += c; }
      if (ll * rr >= 1e-12) korrelation = r2(Math.max(-1, Math.min(1, lr / Math.sqrt(ll * rr))));
    }
    return {
      stumm: this.still, lufs_m: this.lufs(N_M), lufs_s: this.lufs(N_S),
      tp_dbtp: r1(this.tp), tp_max_dbtp: r1(this.tpMax), korrelation, dauer_s: r1(this.frames / RATE),
      lufs_i: this.lufsI(), lufs_i_voll: this.voll, luecke_s: r1(this.lueckeFrames / RATE),
    };
  }
}
