// D1 S3: Lautheit der fertigen Export-WAV (Konzept-Review R9, von der Spec-Schreiberin für S3 angenommen): integrierte Lautheit (LUFS-I),
// Lautheitsbereich (LRA) und True Peak (dBTP) offline per ffmpeg-Filter ebur128 (peak=true), kein Kern-Code. Fehlt ffmpeg oder scheitert
// es, sind die drei Felder null und `loudness_fehler` nennt den Grund; der Export selbst gilt trotzdem (die WAV ist geschrieben).
// Gemessen 2026-10-15 mit ffmpeg 6.1.1: die Zusammenfassung steht nach „Summary:“ auf stderr; Stille ergibt I −70.0 LUFS (Gate-Boden von
// ffmpeg) und Peak -inf dBFS, das hier wie spitze_db als −200 erscheint (JSON kennt kein −∞).
import { spawn } from 'node:child_process';

export interface Lautheit { lufs_i: number | null; lra: number | null; true_peak_dbtp: number | null; loudness_fehler?: string;
  lufs_s_max?: number | null; lufs_m_max?: number | null }

const zahl = (s: string): number => (/^-inf$/i.test(s) ? -200 : Number(s));

// Zusammenfassung von ebur128 lesen (die letzte, falls mehrere). null, wenn eine der drei Zahlen fehlt.
export function leseEbur128(text: string): { lufs_i: number; lra: number; true_peak_dbtp: number } | null {
  const i = text.lastIndexOf('Summary:');
  if (i < 0) return null;
  const s = text.slice(i);
  const I = /\bI:\s+(-?\d+(?:\.\d+)?|-inf)\s+LUFS/.exec(s);
  const LRA = /\bLRA:\s+(-?\d+(?:\.\d+)?)\s+LU\b/.exec(s);
  const TP = /\bPeak:\s+(-?\d+(?:\.\d+)?|-inf)\s+dBFS/.exec(s);
  if (!I || !LRA || !TP) return null;
  return { lufs_i: zahl(I[1]), lra: zahl(LRA[1]), true_peak_dbtp: zahl(TP[1]) };
}

// Analyze B1: one ebur128 frame line (`-loglevel verbose`, framelog=verbose) carries M (momentary, 400 ms) and S (short-term, 3 s); keeps the maxima.
// Values that are -inf or <= -120 (the gate floor before the first full window) are ignored. A summary line has neither key and changes nothing.
export function leseMaxima(zeile: string, stand: { s: number | null; m: number | null }): void {
  const m = /\bM:\s*(-?\d+(?:\.\d+)?|-inf)\s/.exec(zeile), s = /\bS:\s*(-?\d+(?:\.\d+)?|-inf)\s/.exec(zeile);
  const nimm = (t: string | undefined, alt: number | null): number | null => {
    if (t === undefined || /^-inf$/i.test(t)) return alt;
    const v = Number(t);
    return v <= -120 || (alt !== null && v <= alt) ? alt : v;
  };
  stand.m = nimm(m?.[1], stand.m);
  stand.s = nimm(s?.[1], stand.s);
}

const NULL = { lufs_i: null, lra: null, true_peak_dbtp: null };

export function messeLautheit(datei: string, ffmpeg: string[] = ['ffmpeg'], zeitlimitMs = 120_000,
  o: { maxima?: boolean; von_s?: number; dauer_s?: number } = {}): Promise<Lautheit> {
  return new Promise((ok) => {
    const mx = !!o.maxima;
    const k = spawn('nice', ['-n', '19', ...ffmpeg, '-nostdin', '-hide_banner', '-nostats', ...(mx ? ['-loglevel', 'verbose'] : []),
      ...(o.von_s !== undefined ? ['-ss', String(o.von_s)] : []), ...(o.dauer_s !== undefined ? ['-t', String(o.dauer_s)] : []), '-i', datei,
      '-af', `ebur128=peak=true:framelog=${mx ? 'verbose' : 'quiet'}`, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '', abgelaufen = false, rest = '';
    const stand = { s: null as number | null, m: null as number | null };
    k.stderr.on('data', (b: Buffer) => {
      const t = b.toString('utf8');
      if (mx) {   // frame lines arrive as they are written; the 64 KiB tail below would drop most of them
        const z = (rest + t).split('\n');
        rest = z.pop() ?? '';
        for (const l of z) leseMaxima(l, stand);
      }
      err = (err + t).slice(-65536);
    });
    const uhr = setTimeout(() => { abgelaufen = true; k.kill('SIGKILL'); }, zeitlimitMs);
    k.once('error', (e) => { clearTimeout(uhr); ok({ ...NULL, loudness_fehler: `ffmpeg_fehlt: ${e.message}` }); });
    k.once('close', (rc) => {
      clearTimeout(uhr);
      if (abgelaufen) return ok({ ...NULL, loudness_fehler: `zeitlimit: ${zeitlimitMs} ms` });
      // nice meldet 127, wenn das Programm fehlt (GNU coreutils), 126, wenn es nicht ausführbar ist
      if (rc === 127 || rc === 126) return ok({ ...NULL, loudness_fehler: `ffmpeg_fehlt: ${ffmpeg[0]}` });
      const letzte = err.split('\n').map((z) => z.trim()).filter(Boolean).at(-1) ?? '';
      if (rc !== 0) return ok({ ...NULL, loudness_fehler: `ffmpeg_fehler: Rückgabe ${rc}: ${letzte.slice(0, 200)}` });
      if (mx && rest) leseMaxima(rest, stand);
      const m = leseEbur128(err);
      if (m && mx) return ok({ ...m, lufs_s_max: stand.s, lufs_m_max: stand.m });
      ok(m ?? { ...NULL, loudness_fehler: 'ffmpeg_ausgabe: keine ebur128-Zusammenfassung' });
    });
  });
}

// Loudness target of an export (export delivery plan, task 3): a check, never a change of the mix. Loudness is information, the true peak ceiling
// is a warning.
export interface LautheitZiel { lufs_i?: number; true_peak_dbtp?: number }             // at least one field; lufs_i -40..0, true_peak_dbtp -20..0
export interface ZielPruefung { lufs_abstand: number | null; tp_abstand: number | null; tp_ueber: boolean | null }

// Reads the request field `ziel`; throws an Error with an English text naming the field.
export function leseZiel(v: unknown): LautheitZiel {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('ziel must be an object');
  const e = v as Record<string, unknown>;
  for (const k of Object.keys(e)) if (k !== 'lufs_i' && k !== 'true_peak_dbtp') throw new Error(`ziel.${k} is not a known field`);
  const z: LautheitZiel = {};
  for (const [k, min] of [['lufs_i', -40], ['true_peak_dbtp', -20]] as const) {
    const w = e[k];
    if (w === undefined) continue;
    if (typeof w !== 'number' || !Number.isFinite(w) || w < min || w > 0) throw new Error(`ziel.${k} must be a number from ${min} to 0`);
    z[k] = w;
  }
  if (z.lufs_i === undefined && z.true_peak_dbtp === undefined) throw new Error('ziel needs lufs_i or true_peak_dbtp');
  return z;
}

const rund1 = (x: number): number => Math.round(x * 10) / 10 + 0;   // + 0 turns -0 into 0

// Measured minus target (positive = louder than the target), rounded to 0.1. tp_ueber: false without a true peak target, null when a target is set
// and nothing was measured.
export function pruefeZiel(l: Lautheit, z: LautheitZiel): ZielPruefung {
  const abstand = (gemessen: number | null, ziel: number | undefined): number | null =>
    (ziel === undefined || gemessen === null ? null : rund1(gemessen - ziel));
  const tp = z.true_peak_dbtp;
  return { lufs_abstand: abstand(l.lufs_i, z.lufs_i), tp_abstand: abstand(l.true_peak_dbtp, tp),
    tp_ueber: tp === undefined ? false : l.true_peak_dbtp === null ? null : l.true_peak_dbtp > tp };
}
