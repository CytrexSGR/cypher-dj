// Export delivery engine: derives WAV / FLAC / MP3 files with a chosen bit depth, sample rate and dither from the float master
// (WAV, 48 kHz, 32 bit float) with ffmpeg. The caller is schreibeAbgaben in areas/proj/output.ts (POST /proj/export with `abgabe`);
// the release tags of a delivery file come from abgabeTags (project field `abgabe_meta`). ffmpeg runs as an argument vector
// (no shell) under `nice -n 19`, like messeLautheit in loudness.ts. A target file is never replaced: write `<ziel>.<pid>.teil`,
// hard-link it to the target, remove the `.teil`.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import type { AbgabeMeta, Projekt } from './model.ts';

export type AbgabeFormat = 'wav' | 'flac' | 'mp3';
export interface Abgabe { format: AbgabeFormat; rate_hz: 44100 | 48000 | 88200 | 96000; bits?: 16 | 24 | 32; dither?: 'tpdf' | 'aus'; kbps?: 192 | 256 | 320 }
export const ABGABE_MAX = 4;
export class AbgabeFehler extends Error {}   // message = English text for the user

const FELDER = new Set(['format', 'rate_hz', 'bits', 'dither', 'kbps']);
const RATEN = [44100, 48000, 88200, 96000];
const BITS: Record<string, number[]> = { wav: [16, 24, 32], flac: [16, 24] };
const KBPS = [192, 256, 320];

function eine(v: unknown, i: number, nur?: readonly AbgabeFormat[]): Abgabe {
  const n = `abgabe[${i}]`;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new AbgabeFehler(`${n} must be an object`);
  const e = v as Record<string, unknown>;
  for (const k of Object.keys(e)) if (!FELDER.has(k)) throw new AbgabeFehler(`${n}.${k} is not a known field`);
  const format = e.format;
  if (format !== 'wav' && format !== 'flac' && format !== 'mp3') throw new AbgabeFehler(`${n}.format must be wav, flac or mp3`);
  if (nur && !nur.includes(format)) throw new AbgabeFehler(`${n}.format ${format} is not allowed here (allowed: ${nur.join(', ')})`);
  const rate = e.rate_hz === undefined ? 44100 : e.rate_hz;
  const raten = format === 'mp3' ? [44100, 48000] : RATEN;
  if (typeof rate !== 'number' || !raten.includes(rate)) throw new AbgabeFehler(`${n}.rate_hz must be one of ${raten.join(', ')} for ${format}`);
  const a = { format, rate_hz: rate } as Abgabe;
  if (format === 'mp3') {
    if (e.bits !== undefined) throw new AbgabeFehler(`${n}.bits does not apply to mp3`);
    if (e.dither !== undefined) throw new AbgabeFehler(`${n}.dither does not apply to mp3`);
    const k = e.kbps === undefined ? 320 : e.kbps;
    if (typeof k !== 'number' || !KBPS.includes(k)) throw new AbgabeFehler(`${n}.kbps must be one of ${KBPS.join(', ')}`);
    a.kbps = k as Abgabe['kbps'];
    return a;
  }
  if (e.kbps !== undefined) throw new AbgabeFehler(`${n}.kbps applies to mp3 only`);
  const bits = e.bits === undefined ? 24 : e.bits;
  if (typeof bits !== 'number' || !BITS[format].includes(bits)) throw new AbgabeFehler(`${n}.bits must be one of ${BITS[format].join(', ')} for ${format}`);
  a.bits = bits as Abgabe['bits'];
  if (bits === 16) {
    const d = e.dither === undefined ? 'tpdf' : e.dither;
    if (d !== 'tpdf' && d !== 'aus') throw new AbgabeFehler(`${n}.dither must be tpdf or aus`);
    a.dither = d;
  } else if (e.dither !== undefined) throw new AbgabeFehler(`${n}.dither exists at 16 bit only`);
  return a;
}

/** Validates and fills defaults; throws AbgabeFehler naming the field. `nur` limits the formats. */
export function leseAbgaben(v: unknown, nur?: readonly AbgabeFormat[]): Abgabe[] {
  if (!Array.isArray(v)) throw new AbgabeFehler('abgabe must be an array');
  if (v.length < 1 || v.length > ABGABE_MAX) throw new AbgabeFehler(`abgabe must have 1 to ${ABGABE_MAX} entries`);
  const r = v.map((x, i) => eine(x, i, nur));
  const namen = new Set<string>();
  r.forEach((a, i) => {
    const n = abgabeName('x.wav', a);
    if (namen.has(n)) throw new AbgabeFehler(`abgabe[${i}] yields the same file name as an earlier entry`);
    namen.add(n);
  });
  return r;
}

const NOTEN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Tags of one delivery file: title (meta or project name), release fields, ISRC, tempo and key where the format has a place for them. */
export function abgabeTags(p: Projekt, format: AbgabeFormat): Record<string, string> {
  const m: AbgabeMeta = p.abgabe_meta ?? {};
  const t: Record<string, string> = { title: m.titel ?? p.name };
  if (m.kuenstler !== undefined) t.artist = m.kuenstler;
  if (m.album !== undefined) t.album = m.album;
  if (m.genre !== undefined) t.genre = m.genre;
  if (m.jahr !== undefined) t.date = String(m.jahr);
  if (m.isrc !== undefined) {
    t[format === 'mp3' ? 'TSRC' : 'ISRC'] = m.isrc;
    if (format === 'wav') { t.originator = 'cypher-dj'; t.originator_reference = m.isrc; }
  }
  if (format === 'flac') t.BPM = String(Math.round(p.tempo_bpm * 100) / 100);
  if (format === 'mp3') t.TBPM = String(Math.round(p.tempo_bpm));
  const k = p.tonart;
  if (format !== 'wav' && k && (k.skala === 'major' || k.skala === 'minor')) {
    t[format === 'mp3' ? 'TKEY' : 'INITIALKEY'] = `${NOTEN[k.grundton]}${k.skala === 'minor' ? 'm' : ''}`;
  }
  return t;
}

/** Full path next to the master: <master without .wav>.<tag>.<ext>. */
export function abgabeName(masterDatei: string, a: Abgabe): string {
  const k = `${Math.floor(a.rate_hz / 1000)}k`;
  const tag = a.format === 'mp3' ? `${a.kbps}kbps-${k}` : `${a.bits === 32 ? '32float' : `${a.bits}bit`}-${k}`;
  return `${masterDatei.replace(/\.wav$/i, '')}.${tag}.${a.format}`;
}

/** ffmpeg arguments after the program name. */
export function abgabeArgumente(a: Abgabe, quelle: string, ziel: string, tags?: Readonly<Record<string, string>>): string[] {
  const dither = a.format !== 'mp3' && a.bits === 16 && a.dither === 'tpdf' ? ':dither_method=triangular' : '';
  const r = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', quelle, '-map_metadata', '-1',
    '-af', `aresample=${a.rate_hz}:resampler=soxr:precision=28${dither}`];
  if (a.format === 'wav') r.push('-c:a', a.bits === 16 ? 'pcm_s16le' : a.bits === 24 ? 'pcm_s24le' : 'pcm_f32le', '-f', 'wav');
  else if (a.format === 'flac') {
    const tiefe = a.bits === 16 ? ['-sample_fmt', 's16'] : ['-sample_fmt', 's32', '-bits_per_raw_sample', '24'];
    r.push('-c:a', 'flac', '-compression_level', '8', ...tiefe, '-f', 'flac');
  }
  else r.push('-c:a', 'libmp3lame', '-b:a', `${a.kbps}k`, '-id3v2_version', '3', '-f', 'mp3');
  const t = Object.entries(tags ?? {});
  for (const [k, v] of t) r.push('-metadata', `${k}=${v}`);
  if (a.format === 'wav' && t.length) r.push('-write_bext', '1');
  r.push(ziel);
  return r;
}

const KEIN_LINK = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV']);
/**
 * Puts the finished temporary file `teil` under its final name `ziel` without ever replacing a file: a hard link, and a copy with COPYFILE_EXCL
 * where the file system has no hard links (FAT32, exFAT) or the link crosses devices. EEXIST and every other error are thrown as they are.
 * Asynchronous, so a large master on a slow drive does not block the server. A half copy that this call made is removed, a file that was
 * there before never. The caller removes `teil`. `link` and `kopie` are injectable for tests.
 */
export async function legeAb(teil: string, ziel: string, link: (a: string, b: string) => Promise<void> = fs.promises.link,
  kopie: (a: string, b: string, m: number) => Promise<void> = fs.promises.copyFile): Promise<void> {
  try { await link(teil, ziel); } catch (e) {
    if (!KEIN_LINK.has((e as NodeJS.ErrnoException).code ?? '')) throw e;
    const davor = fs.existsSync(ziel);
    try { await kopie(teil, ziel, fs.constants.COPYFILE_EXCL); } catch (c) {
      if (!davor && (c as NodeJS.ErrnoException).code !== 'EEXIST') fs.rmSync(ziel, { force: true });
      throw c;
    }
  }
}

/** Converts quelle (WAV 48 kHz float32) into ziel; never replaces ziel; throws AbgabeFehler. */
export async function wandle(o: { quelle: string; ziel: string; abgabe: Abgabe; tags?: Readonly<Record<string, string>>;
  ffmpeg?: string[]; zeitlimitMs?: number; abbruch?: AbortSignal }): Promise<void> {
  const ffmpeg = o.ffmpeg ?? ['ffmpeg'], zeitlimitMs = o.zeitlimitMs ?? 300_000;
  if (fs.existsSync(o.ziel)) throw new AbgabeFehler(`${o.ziel} already exists`);
  if (o.abbruch?.aborted) throw new AbgabeFehler('conversion aborted');
  const teil = `${o.ziel}.${process.pid}.teil`;
  try {
    fs.rmSync(teil, { force: true });
    await new Promise<void>((ok, nein) => {
      const k = spawn('nice', ['-n', '19', ...ffmpeg, ...abgabeArgumente(o.abgabe, o.quelle, teil, o.tags)], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '', grund: string | null = null;
      k.stderr.on('data', (b: Buffer) => { err = (err + b.toString('utf8')).slice(-65536); });
      const stopp = (g: string): void => { grund ??= g; k.kill('SIGKILL'); };
      const uhr = setTimeout(() => stopp(`conversion timed out after ${zeitlimitMs} ms`), zeitlimitMs);
      const ab = (): void => stopp('conversion aborted');
      o.abbruch?.addEventListener('abort', ab, { once: true });
      const fertig = (): void => { clearTimeout(uhr); o.abbruch?.removeEventListener('abort', ab); };
      k.once('error', (e) => { fertig(); nein(new AbgabeFehler(`ffmpeg could not be started: ${e.message}`)); });
      k.once('close', (rc) => {
        fertig();
        if (grund) return nein(new AbgabeFehler(grund));
        // nice reports 127 when the program is missing (GNU coreutils), 126 when it is not executable
        if (rc === 127 || rc === 126) return nein(new AbgabeFehler('ffmpeg is not installed'));
        const letzte = (err.split('\n').map((z) => z.trim()).filter(Boolean).at(-1) ?? '').slice(0, 200);
        if (rc !== 0) return nein(new AbgabeFehler(`ffmpeg failed (exit ${rc}): ${letzte}`));
        ok();
      });
      if (o.abbruch?.aborted) ab();
    });
    try { await legeAb(teil, o.ziel); }   // never replace: link and copy fail when the target exists
    catch (e) { throw new AbgabeFehler(`${o.ziel} could not be written: ${(e as Error).message}`); }
  } finally {
    fs.rmSync(teil, { force: true });
  }
}
