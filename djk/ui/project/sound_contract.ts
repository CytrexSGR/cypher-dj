// ANALYZE window, slice 1: the contract of the route answer `POST /proj/analyse` (pure module, no imports).
// Types, band grid, thresholds, shape check and the hand reduction. Every lane (analysis, route, window, hand) builds against this file
// and against tests/fixtures/analyse_antwort.json. Minus infinity in dB is written as DB_BODEN (-200), as in loudness.ts.

export type QuelleArt = 'spur' | 'gruppe' | 'return' | 'master';
export interface AnalyseQuelle { art: QuelleArt; id?: string }            // id required except for master
export interface Lautheitswerte { lufs_i: number | null; lufs_s_max: number | null; lufs_m_max: number | null; lra: number | null;
  true_peak_dbtp: number | null; spitze_db: number | null; rms_db: number | null; crest_db: number | null }
// pegel_db: power of L plus R in the band (mid plus side), dB re a full-scale sine like the spectrum, mean over the non-silent frames, DB_BODEN when empty.
// A band without energy has korrelation 0 and breite_db DB_BODEN; read korrelation only where pegel_db carries a level.
export interface StereoBand { hz_von: number; hz_bis: number; korrelation: number; breite_db: number; pegel_db: number }
export interface Stereo { korrelation: number; korrelation_min: number; breite_db: number; baender: StereoBand[] }   // 4 bands
export interface Spektrum { hz: number[]; mittel_db: number[]; max_db: number[] }
export interface Zeitbild { spalten: number; zeilen: number; sek_je_spalte: number; db_min: number; db_max: number; daten: string }
export interface Messung { quelle: AnalyseQuelle; name: string; stumm: boolean; lautheit: Lautheitswerte; stereo: Stereo; spektrum: Spektrum;
  zeitbild: Zeitbild }
export interface UeberdeckungsBand { hz: number; quelle_db: number; vergleich_db: number; anteil: number }
export interface Schwerpunkt { hz_von: number; hz_bis: number; anteil: number }
export interface Ueberdeckung { baender: UeberdeckungsBand[]; schwerpunkte: Schwerpunkt[] }
export type HinweisArt = 'bass_nicht_mono' | 'true_peak' | 'resonanz' | 'ueberdeckung_tief';
export interface Hinweis { art: HinweisArt; text: string; hz?: number }
export interface AnalyseAntwort { rev: number; von_beat: number; bis_beat: number; dauer_s: number; tempo_bpm: number;
  quelle: Messung; vergleich?: Messung; ueberdeckung?: Ueberdeckung; hinweise: Hinweis[] }
export type HandMessung = Omit<Messung, 'zeitbild'>;
export type HandAntwort = Omit<AnalyseAntwort, 'quelle' | 'vergleich'> & { quelle: HandMessung; vergleich?: HandMessung };

export const RATE = 48000, FFT_N = 8192, HOP = 2048, MAX_SPALTEN = 2048, KORR_FENSTER = 19200;
export const DB_BODEN = -200, ZEITBILD_DB_MIN = -90, ZEITBILD_DB_MAX = 0, STILLE_DB = -90;
export const ANALYSE_MAX_BEATS = 1024;
export const SCHWELLEN = { bassMono: 0.5, bassHz: 120, truePeak: -1, resonanzDb: 9, naeheDb: 9, pegelMinDb: -60, schwerpunkt: 0.5, tiefHz: 250 } as const;
export const STEREO_BAENDER: readonly [number, number][] = [[0, 120], [120, 500], [500, 4000], [4000, 24000]];

const BAENDER = 120, TERZ_BAENDER = 30, K0 = -53;   // 1/12 bands k = -53..66 around A4 = 440 Hz
const HINWEIS_ARTEN: readonly string[] = ['bass_nicht_mono', 'true_peak', 'resonanz', 'ueberdeckung_tief'];
const QUELLEN_ARTEN: readonly string[] = ['spur', 'gruppe', 'return', 'master'];

// Edge j lies half a semitone below the centre of band j; the same expression serves both neighbours, so edges touch exactly.
const kante = (j: number): number => 440 * 2 ** ((j + K0 - 0.5) / 12);

export const ZWOELFTEL_HZ: readonly number[] = Array.from({ length: BAENDER }, (_, n) => 440 * 2 ** ((n + K0) / 12));
export const TERZ_HZ: readonly number[] = Array.from({ length: TERZ_BAENDER }, (_, m) => 440 * 2 ** ((-51.5 + 4 * m) / 12));

// Edges of 1/12 band n (0..119).
export function zwoelftelKanten(n: number): [number, number] { return [kante(n), kante(n + 1)]; }
// Edges of 1/3 band m (0..29): the outer edges of its four semitone bands.
export function terzKanten(m: number): [number, number] { return [kante(4 * m), kante(4 * m + 4)]; }

// 120 -> 30 levels by power sum of four; a level at DB_BODEN or below adds nothing, an all-floor third stays DB_BODEN.
export function terzVon(db12: readonly number[]): number[] {
  const aus: number[] = [];
  for (let m = 0; m < TERZ_BAENDER; m++) {
    let p = 0;
    for (let i = 4 * m; i < 4 * m + 4; i++) { const d = db12[i]; if (Number.isFinite(d) && d > DB_BODEN) p += 10 ** (d / 10); }
    aus.push(p > 0 ? Math.max(DB_BODEN, 10 * Math.log10(p)) : DB_BODEN);
  }
  return aus;
}

// 'spur:s1', 'master', '' for undefined (key of selectors and of the answer cache).
export function quellenSchluessel(q: AnalyseQuelle | undefined): string {
  if (!q) return '';
  return q.id === undefined ? q.art : `${q.art}:${q.id}`;
}

// '62 Hz', '3.0 kHz', '16 kHz' (as bandText in public/spectrum.js).
export function hzText(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// Decoded byte count of a base64 string (no Buffer, so the module also runs in a browser).
const base64Bytes = (b: string): number => Math.floor((b.length * 3) / 4) - (b.endsWith('==') ? 2 : b.endsWith('=') ? 1 : 0);

function pruefeMessung(m: unknown, p: string, fehler: string[]): void {
  if (!obj(m)) { fehler.push(`${p}: not an object`); return; }
  const q = m.quelle;
  if (!obj(q) || !QUELLEN_ARTEN.includes(q.art as string)) fehler.push(`${p}.quelle.art: unknown`);
  else if ((q.art !== 'master') !== (typeof q.id === 'string')) fehler.push(`${p}.quelle.id: required except for master`);
  if (typeof m.name !== 'string') fehler.push(`${p}.name: not a string`);
  if (typeof m.stumm !== 'boolean') fehler.push(`${p}.stumm: not a boolean`);
  const l = m.lautheit;
  if (!obj(l)) fehler.push(`${p}.lautheit: not an object`);
  else for (const k of ['lufs_i', 'lufs_s_max', 'lufs_m_max', 'lra', 'true_peak_dbtp', 'spitze_db', 'rms_db', 'crest_db']) {
    if (l[k] !== null && !num(l[k])) fehler.push(`${p}.lautheit.${k}: not a number or null`);
    else if (m.stumm === true && l[k] !== null) fehler.push(`${p}.lautheit.${k}: must be null when stumm`);
  }
  const s = m.stereo;
  if (!obj(s)) fehler.push(`${p}.stereo: not an object`);
  else {
    for (const k of ['korrelation', 'korrelation_min']) if (!num(s[k]) || s[k] < -1 || s[k] > 1) fehler.push(`${p}.stereo.${k}: not a number in -1..1`);
    if (!num(s.breite_db)) fehler.push(`${p}.stereo.breite_db: not a number`);
    if (!Array.isArray(s.baender) || s.baender.length !== STEREO_BAENDER.length) fehler.push(`${p}.stereo.baender: need ${STEREO_BAENDER.length} bands`);
    else s.baender.forEach((b: unknown, i: number) => {
      if (!obj(b)) { fehler.push(`${p}.stereo.baender[${i}]: not an object`); return; }
      if (!num(b.hz_von) || !num(b.hz_bis)) fehler.push(`${p}.stereo.baender[${i}].hz_von/hz_bis: not numbers`);
      if (!num(b.korrelation) || b.korrelation < -1 || b.korrelation > 1) fehler.push(`${p}.stereo.baender[${i}].korrelation: not a number in -1..1`);
      if (!num(b.breite_db)) fehler.push(`${p}.stereo.baender[${i}].breite_db: not a number`);
      if (!num(b.pegel_db)) fehler.push(`${p}.stereo.baender[${i}].pegel_db: not a number`);
    });
  }
  const sp = m.spektrum;
  let zeilen = -1;
  if (!obj(sp)) fehler.push(`${p}.spektrum: not an object`);
  else {
    for (const k of ['hz', 'mittel_db', 'max_db']) {
      const a = sp[k];
      if (!Array.isArray(a) || a.length !== BAENDER || !a.every(num)) fehler.push(`${p}.spektrum.${k}: need ${BAENDER} numbers`);
    }
    if (Array.isArray(sp.hz)) zeilen = sp.hz.length;
  }
  const z = m.zeitbild;
  if (!obj(z)) fehler.push(`${p}.zeitbild: not an object`);
  else {
    if (!Number.isInteger(z.spalten) || (z.spalten as number) < 1 ||
      (z.spalten as number) > MAX_SPALTEN) fehler.push(`${p}.zeitbild.spalten: not an integer in 1..${MAX_SPALTEN}`);
    if (z.zeilen !== zeilen) fehler.push(`${p}.zeitbild.zeilen: must equal spektrum.hz.length (${zeilen})`);
    if (!num(z.sek_je_spalte) || z.sek_je_spalte <= 0) fehler.push(`${p}.zeitbild.sek_je_spalte: not a positive number`);
    if (z.db_min !== ZEITBILD_DB_MIN || z.db_max !== ZEITBILD_DB_MAX) fehler.push(`${p}.zeitbild.db_min/db_max: must be ${ZEITBILD_DB_MIN}/${ZEITBILD_DB_MAX}`);
    if (typeof z.daten !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(z.daten)) fehler.push(`${p}.zeitbild.daten: not base64`);
    else if (Number.isInteger(z.spalten) && Number.isInteger(z.zeilen) && base64Bytes(z.daten) !== (z.spalten as number) * (z.zeilen as number)) {
      fehler.push(`${p}.zeitbild.daten: length is not spalten * zeilen bytes`);
    }
  }
}

// Shape check of a route answer; [] = valid. Messages name the offending field path.
export function pruefeAntwort(j: unknown): string[] {
  const fehler: string[] = [];
  if (!obj(j)) return ['answer: not an object'];
  for (const k of ['rev', 'von_beat', 'bis_beat', 'dauer_s', 'tempo_bpm']) if (!num(j[k])) fehler.push(`${k}: not a number`);
  pruefeMessung(j.quelle, 'quelle', fehler);
  if (j.vergleich !== undefined) pruefeMessung(j.vergleich, 'vergleich', fehler);
  if (j.ueberdeckung !== undefined) {
    const u = j.ueberdeckung;
    if (!obj(u)) fehler.push('ueberdeckung: not an object');
    else {
      if (!Array.isArray(u.baender) || u.baender.length !== TERZ_BAENDER) fehler.push(`ueberdeckung.baender: need ${TERZ_BAENDER} bands`);
      else u.baender.forEach((b: unknown, i: number) => {
        if (!obj(b) || !num(b.hz) || !num(b.quelle_db) || !num(b.vergleich_db) || !num(b.anteil) || b.anteil < 0 ||
          b.anteil > 1) fehler.push(`ueberdeckung.baender[${i}]: bad band`);
      });
      if (!Array.isArray(u.schwerpunkte) || u.schwerpunkte.length > 3) fehler.push('ueberdeckung.schwerpunkte: need an array of at most 3');
      else u.schwerpunkte.forEach((s: unknown, i: number) => {
        if (!obj(s) || !num(s.hz_von) || !num(s.hz_bis) || !num(s.anteil)) fehler.push(`ueberdeckung.schwerpunkte[${i}]: bad range`);
      });
    }
  }
  if (!Array.isArray(j.hinweise)) fehler.push('hinweise: not an array');
  else j.hinweise.forEach((h: unknown, i: number) => {
    if (!obj(h)) { fehler.push(`hinweise[${i}]: not an object`); return; }
    if (!HINWEIS_ARTEN.includes(h.art as string)) fehler.push(`hinweise[${i}].art: unknown`);
    if (typeof h.text !== 'string') fehler.push(`hinweise[${i}].text: not a string`);
    if (h.hz !== undefined && !num(h.hz)) fehler.push(`hinweise[${i}].hz: not a number`);
  });
  return fehler;
}

function handMessung(m: Messung, fein: boolean): HandMessung {
  const { zeitbild: _weg, ...rest } = structuredClone(m);
  if (!fein) rest.spektrum = { hz: [...TERZ_HZ], mittel_db: terzVon(m.spektrum.mittel_db), max_db: terzVon(m.spektrum.max_db) };
  return rest;
}

// The hand answer: no time picture; spectrum reduced to 1/3 octave unless fein. The input is not changed.
export function fuerHand(a: AnalyseAntwort, fein: boolean): HandAntwort {
  const { quelle, vergleich, ...rest } = structuredClone(a);
  const aus: HandAntwort = { ...rest, quelle: handMessung(quelle, fein) };
  if (vergleich) aus.vergleich = handMessung(vergleich, fein);
  return aus;
}
