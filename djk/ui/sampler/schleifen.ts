// Sample player stage 2b, strand S: the sustain loop points a source file carries. Headers only, nothing is decoded; a file without loop data, with a type
// this reader does not know or with broken data has no loop.
//   WAV   chunk `smpl`: the first loop (start, end in sample frames; the end is inclusive, so the exclusive end is dwEnd + 1)
//   AIFF  chunk `INST`: the sustain loop (play mode != 0) names a begin and an end marker; their positions are in the chunk `MARK`. AIFF-C is read when its
//         compression is NONE, sowt, twos or fl32 (the headers do not differ); the positions are used as written.
import fs from 'node:fs';

/** A loop in the frames of the source file: `start` .. `ende` (exclusive), and the sample rate of the file. */
export type Schleife = { rate: number; start: number; ende: number };

const KETTE_MAX = 64;          // chunks looked at per file
const CHUNK_MAX = 1 << 20;     // largest chunk read into memory (the loop chunks are tiny)
const LAENGE_MIN = 64;         // the engine needs loop_b >= loop_a + 64
const AIFC_OK = new Set(['NONE', 'sowt', 'twos', 'fl32', 'FL32', 'in24', 'in32']);

const lies = (fd: number, pos: number, n: number): Buffer | null => {
  if (n < 0 || n > CHUNK_MAX) return null;
  const b = Buffer.alloc(n);
  try { return fs.readSync(fd, b, 0, n, pos) === n ? b : null; } catch { return null; }
};

/** The 80 bit extended float of an AIFF `COMM` chunk as a number (0 when it is not a plain positive rate). */
function erweitert(b: Buffer, o: number): number {
  const se = b.readUInt16BE(o), e = se & 0x7fff;
  const mant = Number(b.readBigUInt64BE(o + 2));
  if (se & 0x8000 || e === 0 || e === 0x7fff) return 0;
  const r = mant * 2 ** (e - 16383 - 63);
  return Number.isFinite(r) ? r : 0;
}

function wav(fd: number, groesse: number): Schleife | null {
  let rate = 0, pos = 12, smpl: Buffer | null = null;
  for (let i = 0; i < KETTE_MAX && pos + 8 <= groesse; i++) {
    const k = lies(fd, pos, 8);
    if (!k) return null;
    const id = k.toString('latin1', 0, 4), n = k.readUInt32LE(4);
    if (id === 'fmt ') { const f = lies(fd, pos + 8, Math.min(n, 16)); if (f && f.length >= 8) rate = f.readUInt32LE(4); }
    else if (id === 'smpl') smpl = lies(fd, pos + 8, Math.min(n, 36 + 24));
    if (rate > 0 && smpl) break;
    pos += 8 + n + (n & 1);
  }
  if (!smpl || smpl.length < 36 + 24 || !(rate > 0) || smpl.readUInt32LE(28) < 1) return null;
  const start = smpl.readUInt32LE(36 + 8), ende = smpl.readUInt32LE(36 + 12) + 1;
  return ende - start >= 1 ? { rate, start, ende } : null;
}

function aiff(fd: number, groesse: number, aifc: boolean): Schleife | null {
  let rate = 0, inst: Buffer | null = null, mark: Buffer | null = null, pos = 12;
  for (let i = 0; i < KETTE_MAX && pos + 8 <= groesse; i++) {
    const k = lies(fd, pos, 8);
    if (!k) return null;
    const id = k.toString('latin1', 0, 4), n = k.readUInt32BE(4);
    if (id === 'COMM') {
      const c = lies(fd, pos + 8, Math.min(n, 22));
      if (!c || c.length < 18) return null;
      if (aifc && (c.length < 22 || !AIFC_OK.has(c.toString('latin1', 18, 22)))) return null;
      rate = erweitert(c, 8);
    } else if (id === 'INST') inst = lies(fd, pos + 8, Math.min(n, 20));
    else if (id === 'MARK') mark = lies(fd, pos + 8, n);
    if (rate > 0 && inst && mark) break;
    pos += 8 + n + (n & 1);
  }
  if (!(rate > 0) || !inst || inst.length < 20 || !mark || mark.length < 2) return null;
  if (inst.readUInt16BE(8) === 0) return null;                 // no sustain loop
  const anfang = inst.readUInt16BE(10), ende = inst.readUInt16BE(12);
  const marken = new Map<number, number>();
  let o = 2;
  for (let m = mark.readUInt16BE(0); m > 0 && o + 7 <= mark.length; m--) {
    marken.set(mark.readUInt16BE(o), mark.readUInt32BE(o + 2));
    const l = mark[o + 6];
    o += 6 + 1 + l + ((l + 1) & 1);
  }
  const a = marken.get(anfang), b = marken.get(ende);
  return a !== undefined && b !== undefined && b > a ? { rate, start: a, ende: b } : null;
}

/** The first loop of a WAV or AIFF/AIFF-C file, or null (no loop data, broken data, unknown type, unreadable). */
export function liesSchleife(pfad: string): Schleife | null {
  let fd = -1;
  try {
    fd = fs.openSync(pfad, 'r');
    const groesse = fs.fstatSync(fd).size;
    const kopf = lies(fd, 0, 12);
    if (!kopf) return null;
    const rahmen = kopf.toString('latin1', 0, 4), art = kopf.toString('latin1', 8, 12);
    if (rahmen === 'RIFF' && art === 'WAVE') return wav(fd, groesse);
    if (rahmen === 'FORM' && (art === 'AIFF' || art === 'AIFC')) return aiff(fd, groesse, art === 'AIFC');
    return null;
  } catch { return null; } finally { if (fd >= 0) { try { fs.closeSync(fd); } catch { /* nothing to do */ } } }
}

/** The loop of a zone in pack frames, or null. `s` is the loop in the source file, `abgeschnitten` the number of leading frames (at 48 kHz) that were trimmed from
 *  the decoded file, `a` and `b` the zone in the pack. Kept only when `a <= loop_a` and `loop_a + 64 <= loop_b <= b`. */
export function schleifeImPack(s: Schleife | null, z: { a: number; b: number; abgeschnitten: number }): [number, number] | null {
  if (!s || !(s.rate > 0)) return null;
  const f = (x: number): number => Math.round(x * 48000 / s.rate) - z.abgeschnitten + z.a;
  const la = f(s.start), lb = f(s.ende);
  return Number.isInteger(la) && Number.isInteger(lb) && z.a <= la && la + LAENGE_MIN <= lb && lb <= z.b ? [la, lb] : null;
}
