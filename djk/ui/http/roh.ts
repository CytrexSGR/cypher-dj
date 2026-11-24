// Raw request bodies: the one reader for uploads that are not JSON (browser plan 1; the kit and project zip routes reuse it).
//   rohKopfAbweisung(q, port)         the protection of a raw POST: x-djk-roh, Content-Type, own origin (in that order)
//   rohLaenge(q)                      the declared Content-Length or null
//   rohInTeilDatei(strom, o)          size cap, free space, streaming to a temp file in the target folder, sha256 while streaming
//   rohBenennen(teil, ordner, name)   gives the finished temp file its final unique name (stem-2.ext), never overwriting
// Errors are RohFehler (HTTP code, reason code); a temp file never survives an error or an abort.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ROH_MAX_BYTES = 2 * 2 ** 30;

export class RohFehler extends Error {
  readonly code: number; readonly grund: string; readonly detail?: string;
  constructor(code: number, grund: string, detail?: string) { super(grund); this.code = code; this.grund = grund; this.detail = detail; }
}

interface Kopf { headers: Record<string, string | string[] | undefined> }
/** The protection of a raw POST. null = allowed. port = the page's own port (the origin may be 127.0.0.1 or localhost on it). */
export function rohKopfAbweisung(q: Kopf, port: number): RohFehler | null {
  if (q.headers['x-djk-roh'] !== '1') return new RohFehler(403, 'roh_ohne_kopf');
  if (!String(q.headers['content-type'] ?? '').toLowerCase().startsWith('application/octet-stream')) return new RohFehler(415, 'nur_roh');
  const herkunft = q.headers.origin;
  if (herkunft !== undefined && herkunft !== `http://127.0.0.1:${port}` && herkunft !== `http://localhost:${port}`) return new RohFehler(403, 'fremde_herkunft');
  return null;
}

/** Declared Content-Length of a request, null when absent or not a number. */
export function rohLaenge(q: Kopf): number | null {
  const v = q.headers['content-length'];
  if (typeof v !== 'string' || !/^\d+$/.test(v)) return null;
  return Number(v);
}

export interface RohOptionen {
  ordner: string;                                   // created on demand; the temp file lives here
  laenge: number | null;                            // declared length, checked before anything is read
  maxBytes?: number;                                // default 2 GiB
  freierPlatz?: (ordner: string) => number;         // default: statfs of the folder
  sha256?: boolean;                                 // hash the bytes from the same stream
}
export interface RohErgebnis { teil: string; bytes: number; sha256?: string }

const freiStandard = (ordner: string): number => { const s = fs.statfsSync(ordner); return Number(s.bavail) * Number(s.bsize); };

/** Streams `strom` into `<ordner>/.<random>.teil`. Resolves with the temp path; the caller renames it (rohBenennen) or removes it. */
export async function rohInTeilDatei(strom: AsyncIterable<Buffer | string>, o: RohOptionen): Promise<RohErgebnis> {
  const max = o.maxBytes ?? ROH_MAX_BYTES;
  if (o.laenge !== null && o.laenge > max) throw new RohFehler(413, 'datei_zu_gross');
  fs.mkdirSync(o.ordner, { recursive: true });
  if (o.laenge !== null && (o.freierPlatz ?? freiStandard)(o.ordner) < o.laenge) throw new RohFehler(507, 'platte_voll');
  const teil = path.join(o.ordner, `.${crypto.randomBytes(6).toString('hex')}.teil`);
  const hash = o.sha256 ? crypto.createHash('sha256') : null;
  let bytes = 0;
  const fh = await fs.promises.open(teil, 'wx');
  try {
    try {
      for await (const stueck of strom) {
        const b = typeof stueck === 'string' ? Buffer.from(stueck) : stueck;
        bytes += b.length;
        if (bytes > max) throw new RohFehler(413, 'datei_zu_gross');
        hash?.update(b);
        let ab = 0;
        while (ab < b.length) {   // a short write is retried; no progress is an error
          const { bytesWritten } = await fh.write(b, ab, b.length - ab);
          if (bytesWritten <= 0) throw new RohFehler(507, 'platte_voll');
          ab += bytesWritten;
        }
      }
    } catch (e) {
      if (e instanceof RohFehler) throw e;
      if ((e as NodeJS.ErrnoException)?.code === 'ENOSPC') throw new RohFehler(507, 'platte_voll');
      throw new RohFehler(400, 'upload_abgebrochen');
    }
    if (bytes === 0) throw new RohFehler(400, 'quelle_leer');
    if (o.laenge !== null && bytes !== o.laenge) throw new RohFehler(400, 'upload_abgebrochen');
  } catch (e) {
    await fh.close().catch(() => {});
    fs.rmSync(teil, { force: true });
    throw e;
  }
  await fh.close();
  return { teil, bytes, ...(hash ? { sha256: hash.digest('hex') } : {}) };
}

/** The final path for `name` in `ordner`: name, then stem-2.ext, stem-3.ext. Hard link then unlink of the temp file, so an existing file is never replaced. */
export function rohBenennen(teil: string, ordner: string, name: string): string {
  const ext = path.extname(name), stamm = name.slice(0, name.length - ext.length);
  try {
    for (let n = 1; ; n++) {
      const ziel = path.join(ordner, n === 1 ? name : `${stamm}-${n}${ext}`);
      try { fs.linkSync(teil, ziel); return ziel; }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    }
  } finally { fs.rmSync(teil, { force: true }); }
}
