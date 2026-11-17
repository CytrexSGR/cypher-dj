// Live picture of the master output (GET /analyse/live): reads the last frames of the audio ring (INTERFACES section 6.1, read only, no mmap)
// and measures spectrum, stereo, peaks, true peak and momentary loudness. Pure except for the ring read.
import fs from 'node:fs';
import { StreifenAnalysator } from './sound_measurement.ts';
import { LIVE_FRAMES, LIVE_LAUTHEIT_FRAMES, STILLE_DB, DB_BODEN, type Stereo } from './sound_contract.ts';

const KOPF = 64, KANAELE = 4, CAP = 65536, RATE = 48000, FRAME_BYTES = KANAELE * 4;

// Returns the last `frames` frames of master L and R as interleaved stereo, oldest first, and the write counter w they end at.
// null: no file, wrong size or header, fewer than `frames` frames written, or the writer lapped the read twice.
export function leseBusRing(pfad: string, frames: number): { w: number; daten: Float32Array } | null {
  let fd = -1;
  try {
    fd = fs.openSync(pfad, 'r');
    if (fs.fstatSync(fd).size !== KOPF + CAP * FRAME_BYTES || frames < 1 || frames > CAP) return null;
    const kopf = Buffer.alloc(KOPF);
    if (fs.readSync(fd, kopf, 0, KOPF, 0) < KOPF) return null;
    if (kopf.toString('ascii', 0, 4) !== 'CDJB' || kopf.readUInt32LE(4) !== 1 || kopf.readUInt32LE(8) !== RATE
      || kopf.readUInt32LE(12) !== KANAELE || kopf.readUInt32LE(16) !== CAP) return null;
    const liesW = (): number => { fs.readSync(fd, kopf, 0, 8, 32); return Number(kopf.readBigUInt64LE(0)); };
    const roh = Buffer.alloc(frames * FRAME_BYTES);
    for (let versuch = 0; versuch < 2; versuch++) {
      const w = liesW();
      if (w < frames) return null;
      const start = (w - frames) % CAP;
      const ersteFrames = Math.min(frames, CAP - start);
      fs.readSync(fd, roh, 0, ersteFrames * FRAME_BYTES, KOPF + start * FRAME_BYTES);
      if (ersteFrames < frames) fs.readSync(fd, roh, ersteFrames * FRAME_BYTES, (frames - ersteFrames) * FRAME_BYTES, KOPF);
      if (liesW() - w > CAP - frames) continue;   // the writer may have overwritten the oldest frames while reading
      const daten = new Float32Array(frames * 2);
      for (let i = 0; i < frames; i++) { daten[2 * i] = roh.readFloatLE(i * FRAME_BYTES); daten[2 * i + 1] = roh.readFloatLE(i * FRAME_BYTES + 4); }
      return { w, daten };
    }
    return null;
  } catch { return null; } finally { if (fd >= 0) try { fs.closeSync(fd); } catch { /* ignore */ } }
}

// 4x oversampling: 12 taps per phase, Hann-windowed sinc, phase 0 is the sample itself.
const OS_TAPS = 12;
const OS_PHASEN: Float64Array[] = [1, 2, 3].map((p) => {
  const h = new Float64Array(OS_TAPS);
  for (let k = 0; k < OS_TAPS; k++) {
    const t = (k - (OS_TAPS / 2 - 1)) - p / 4;   // tap k looks at x[i + k - 5]
    h[k] = (t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t)) * 0.5 * (1 + Math.cos(Math.PI * t / (OS_TAPS / 2)));
  }
  return h;
});

function echtspitze(daten: Float32Array, von: number, bis: number): number {
  let m = 0;
  for (let c = 0; c < 2; c++) {
    for (let i = von; i < bis; i++) {
      const a = Math.abs(daten[2 * i + c]); if (a > m) m = a;
      if (i - 5 < von || i + 6 >= bis) continue;
      for (const h of OS_PHASEN) {
        let s = 0;
        for (let k = 0; k < OS_TAPS; k++) s += daten[2 * (i + k - 5) + c] * h[k];
        const b = Math.abs(s); if (b > m) m = b;
      }
    }
  }
  return m;
}

const K_SHELF = { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [1, -1.69065929318241, 0.73248077421585] };
const K_HOCH = { b: [1, -2, 1], a: [1, -1.99004745483398, 0.99007225036621] };

// K-weighted mean square of one channel over the frames [ab, n); the frames before `ab` only settle the filters.
function kQuadrat(daten: Float32Array, c: number, n: number, ab: number): number {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0, z1 = 0, z2 = 0, summe = 0;
  const [sb0, sb1, sb2] = K_SHELF.b, [, sa1, sa2] = K_SHELF.a, [hb0, hb1, hb2] = K_HOCH.b, [, ha1, ha2] = K_HOCH.a;
  for (let i = 0; i < n; i++) {
    const x = daten[2 * i + c];
    const y = sb0 * x + sb1 * x1 + sb2 * x2 - sa1 * y1 - sa2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    const z = hb0 * y + hb1 * u1 + hb2 * u2 - ha1 * z1 - ha2 * z2;
    u2 = u1; u1 = y; z2 = z1; z1 = z;
    if (i >= ab) summe += z * z;
  }
  return summe / (n - ab);
}

const dbVon = (p: number): number => (p > 0 ? Math.max(DB_BODEN, 10 * Math.log10(p)) : DB_BODEN);

export function messeLive(daten: Float32Array): { stumm: boolean; spektrum: { hz: number[]; db: number[] }; stereo: Stereo; spitze_db: number; rms_db: number;
  true_peak_dbtp: number; lufs_m: number | null } {
  const n = daten.length / 2;
  const von = n - LIVE_FRAMES;
  const an = new StreifenAnalysator(LIVE_FRAMES);
  an.schiebe(daten.subarray(2 * von));
  const m = an.ende();
  const stumm = m.spitze_db <= STILLE_DB;
  const tp = echtspitze(daten, von, n);
  const true_peak_dbtp = Math.max(m.spitze_db, tp > 0 ? 20 * Math.log10(tp) : DB_BODEN);
  let lufs_m: number | null = null;
  if (!stumm) {
    const ab = n - LIVE_LAUTHEIT_FRAMES;
    const l = -0.691 + dbVon(kQuadrat(daten, 0, n, ab) + kQuadrat(daten, 1, n, ab));
    lufs_m = l < -70 ? null : l;
  }
  return { stumm, spektrum: { hz: m.spektrum.hz, db: m.spektrum.mittel_db }, stereo: m.stereo, spitze_db: m.spitze_db, rms_db: m.rms_db,
    true_peak_dbtp: stumm ? DB_BODEN : true_peak_dbtp, lufs_m };
}
