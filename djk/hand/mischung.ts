// Task 7.2: pure functions of the `mischung` hand tool (mix check over N bars): averaging, genre target, chroma, key match, verdict.
import { TERZ_HZ, ZWOELFTEL_HZ, terzVon, DB_BODEN } from '../ui/project/sound_contract.ts';

export interface Ziele { v: number; grob: boolean; quelle: string; anker_hz: number[]; ziele: Record<string, number[]> }
export const REGIONEN = ['sub', 'bass', 'mitte', 'praesenz', 'luft'] as const;
export type Region = typeof REGIONEN[number];
export const KLASSEN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

const gueltig = (d: number): boolean => Number.isFinite(d) && d > -120;

// Power mean per band over samples of equal length (levels in dB).
export function mittle(proben: readonly (readonly number[])[]): number[] {
  if (proben.length === 0) return [];
  const n = proben[0].length;
  const aus: number[] = [];
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const s of proben) { const d = s[i]; if (Number.isFinite(d) && d > DB_BODEN) p += 10 ** (d / 10); }
    aus.push(p > 0 ? Math.max(DB_BODEN, 10 * Math.log10(p / proben.length)) : DB_BODEN);
  }
  return aus;
}

// Target anchors (dB re 1 kHz) interpolated log-linear onto the 1/3 octave centres; clamped outside the anchors.
export function zielAufTerz(anker_hz: readonly number[], werte: readonly number[]): number[] {
  return TERZ_HZ.map((hz) => {
    if (hz <= anker_hz[0]) return werte[0];
    const last = anker_hz.length - 1;
    if (hz >= anker_hz[last]) return werte[last];
    let k = 0;
    while (anker_hz[k + 1] < hz) k++;
    const t = Math.log(hz / anker_hz[k]) / Math.log(anker_hz[k + 1] / anker_hz[k]);
    return werte[k] + t * (werte[k + 1] - werte[k]);
  });
}

export function regionVon(hz: number): Region {
  return hz < 60 ? 'sub' : hz < 250 ? 'bass' : hz < 2000 ? 'mitte' : hz < 6000 ? 'praesenz' : 'luft';
}

// Level-matched difference to the target: the mean offset over 60 Hz..10 kHz is removed, so only the shape is judged.
// Positive = the mix has more than the target. Returns per-band differences and the mean per region.
export function gegenZiel(terz: readonly number[], ziel: readonly number[]): { versatz_db: number; diff: number[]; regionen: Record<Region, number | null> } {
  const roh = terz.map((d, i) => (gueltig(d) ? d - ziel[i] : NaN));
  const im = roh.filter((d, i) => Number.isFinite(d) && TERZ_HZ[i] >= 60 && TERZ_HZ[i] <= 10000);
  const versatz = im.length > 0 ? im.reduce((a, b) => a + b, 0) / im.length : 0;
  const diff = roh.map((d) => (Number.isFinite(d) ? d - versatz : NaN));
  const regionen = {} as Record<Region, number | null>;
  for (const r of REGIONEN) {
    const v = diff.filter((d, i) => Number.isFinite(d) && regionVon(TERZ_HZ[i]) === r);
    regionen[r] = v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }
  return { versatz_db: versatz, diff, regionen };
}

// Pitch-class energy from the 120-band spectrum, bands 110 Hz..4 kHz; class of band i is (9 + i - 53) mod 12 (A4 = band 53 = A). Sums to 1 (or all 0).
export function chroma(db120: readonly number[]): number[] {
  const c = new Array<number>(12).fill(0);
  for (let i = 0; i < db120.length && i < ZWOELFTEL_HZ.length; i++) {
    const hz = ZWOELFTEL_HZ[i], d = db120[i];
    if (hz < 110 || hz > 4000 || !gueltig(d)) continue;
    c[(((9 + i - 53) % 12) + 12) % 12] += 10 ** (d / 10);
  }
  const s = c.reduce((a, b) => a + b, 0);
  return s > 0 ? c.map((x) => x / s) : c;
}

const KS_DUR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MOLL = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const TON: Record<string, number> = { C: 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4, F: 5, 'F#': 6, GB: 6, G: 7, 'G#': 8, AB: 8, A: 9, 'A#': 10, BB: 10, B: 11 };
const CAM_DUR = [11, 6, 1, 8, 3, 10, 5, 0, 7, 2, 9, 4];   // Camelot 1B..12B -> tonic pitch class
const CAM_MOLL = [8, 3, 10, 5, 0, 7, 2, 9, 4, 11, 6, 1];  // Camelot 1A..12A

// 'Am', 'F#', 'C# minor', 'Bb major', Camelot '8A'/'8B' -> {tonika 0..11, moll}; null when not understood.
export function parseTonart(s: string): { tonika: number; moll: boolean } | null {
  const t = s.trim();
  const cam = /^(\d{1,2})([AaBb])$/.exec(t);
  if (cam) {
    const n = Number(cam[1]);
    if (n < 1 || n > 12) return null;
    const moll = cam[2].toUpperCase() === 'A';
    return { tonika: (moll ? CAM_MOLL : CAM_DUR)[n - 1], moll };
  }
  const m = /^([A-Ga-g])([#b]?)\s*(m|min|minor|moll|maj|major|dur)?$/.exec(t);
  if (!m) return null;
  const name = m[1].toUpperCase() + (m[2] === 'b' ? 'B' : m[2]);
  const tonika = TON[name];
  if (tonika === undefined) return null;
  const q = m[3] ?? '';
  return { tonika, moll: q === 'm' || q === 'min' || q === 'minor' || q === 'moll' };
}

function korr(a: readonly number[], b: readonly number[]): number {
  const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}

// Krumhansl profile correlation of the chroma with the given key, clamped to 0..1 (0.8 is a clean fit, below 0.5 the key does not show).
export function tonartPasst(chr: readonly number[], tonart: string): { name: string; passt: number; staerkste: string[] } | null {
  const k = parseTonart(tonart);
  if (!k) return null;
  const profil = k.moll ? KS_MOLL : KS_DUR;
  const dreh = Array.from({ length: 12 }, (_, i) => profil[(((i - k.tonika) % 12) + 12) % 12]);
  const r = korr(chr, dreh);
  const staerkste = chr.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v).slice(0, 3).map((x) => KLASSEN[x.i]);
  return { name: KLASSEN[k.tonika] + (k.moll ? 'm' : ''), passt: Math.max(0, Math.min(1, r)), staerkste };
}

export interface UrteilEin { peak_db: number | null; regionen: Partial<Record<Region, number | null>>; tonart?: { name: string; passt: number } | null; ziel?: string }

// One line: hot peak, regions off by more than 3 dB (with sign), key match below 0.5; else ok.
export function urteil(e: UrteilEin): string {
  const teile: string[] = [];
  if (e.peak_db !== null && e.peak_db > -1) teile.push(`peak too hot (${e.peak_db.toFixed(1)} dB)`);
  for (const r of REGIONEN) {
    const d = e.regionen[r];
    if (d !== null && d !== undefined && Math.abs(d) > 3) teile.push(`${r} ${d > 0 ? 'over' : 'under'} by ${Math.abs(d).toFixed(1)} dB`);
  }
  if (e.tonart && e.tonart.passt < 0.5) teile.push(`key ${e.tonart.name} does not show (${e.tonart.passt.toFixed(2)})`);
  const bezug = e.ziel ? ` (target ${e.ziel}, rough)` : '';
  return teile.length > 0 ? teile.join('; ') + bezug : 'ok' + bezug;
}
