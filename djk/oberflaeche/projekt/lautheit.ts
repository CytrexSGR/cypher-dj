// D1 S3: Lautheit der fertigen Export-WAV (Konzept-Review R9, von der Spec-Schreiberin für S3 angenommen): integrierte Lautheit (LUFS-I),
// Lautheitsbereich (LRA) und True Peak (dBTP) offline per ffmpeg-Filter ebur128 (peak=true), kein Kern-Code. Fehlt ffmpeg oder scheitert
// es, sind die drei Felder null und `loudness_fehler` nennt den Grund; der Export selbst gilt trotzdem (die WAV ist geschrieben).
// Gemessen 2026-10-15 mit ffmpeg 6.1.1: die Zusammenfassung steht nach „Summary:“ auf stderr; Stille ergibt I −70.0 LUFS (Gate-Boden von
// ffmpeg) und Peak -inf dBFS, das hier wie spitze_db als −200 erscheint (JSON kennt kein −∞).
import { spawn } from 'node:child_process';

export interface Lautheit { lufs_i: number | null; lra: number | null; true_peak_dbtp: number | null; loudness_fehler?: string }

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

const NULL = { lufs_i: null, lra: null, true_peak_dbtp: null };

export function messeLautheit(datei: string, ffmpeg: string[] = ['ffmpeg'], zeitlimitMs = 120_000): Promise<Lautheit> {
  return new Promise((ok) => {
    const k = spawn('nice', ['-n', '19', ...ffmpeg, '-nostdin', '-hide_banner', '-nostats', '-i', datei,
      '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '', abgelaufen = false;
    k.stderr.on('data', (b: Buffer) => { err = (err + b.toString('utf8')).slice(-65536); });
    const uhr = setTimeout(() => { abgelaufen = true; k.kill('SIGKILL'); }, zeitlimitMs);
    k.once('error', (e) => { clearTimeout(uhr); ok({ ...NULL, loudness_fehler: `ffmpeg_fehlt: ${e.message}` }); });
    k.once('close', (rc) => {
      clearTimeout(uhr);
      if (abgelaufen) return ok({ ...NULL, loudness_fehler: `zeitlimit: ${zeitlimitMs} ms` });
      // nice meldet 127, wenn das Programm fehlt (GNU coreutils), 126, wenn es nicht ausführbar ist
      if (rc === 127 || rc === 126) return ok({ ...NULL, loudness_fehler: `ffmpeg_fehlt: ${ffmpeg[0]}` });
      const letzte = err.split('\n').map((z) => z.trim()).filter(Boolean).at(-1) ?? '';
      if (rc !== 0) return ok({ ...NULL, loudness_fehler: `ffmpeg_fehler: Rückgabe ${rc}: ${letzte.slice(0, 200)}` });
      const m = leseEbur128(err);
      ok(m ?? { ...NULL, loudness_fehler: 'ffmpeg_ausgabe: keine ebur128-Zusammenfassung' });
    });
  });
}
