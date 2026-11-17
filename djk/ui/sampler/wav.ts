// Sampler A1: read the audio of a module track. The WAVs of the module store are float32 stereo 48 kHz (project/recording.ts wavKopf); anything else is
// refused, nothing is converted. The chunk walk handles the `fact` chunk of that header and any other chunk before `data`.
import fs from 'node:fs';
import { SchnittFehler } from './schnitt.ts';

type Daten = { pos: number; n: number };

/** Walks the chunks of an open file up to `data`; refuses everything but float32 stereo 48 kHz. Returns where the samples start and how many bytes they take. */
function kopfLesen(fd: number, pfad: string): Daten {
  const falsch = (t: string): SchnittFehler => new SchnittFehler(422, 'format_falsch', `${pfad}: ${t}`);
  const groesse = fs.fstatSync(fd).size;
  const lies = (n: number, pos: number): Buffer => {
    const b = Buffer.alloc(n);
    let got = 0;
    while (got < n) {
      const r = fs.readSync(fd, b, got, n - got, pos + got);
      if (r <= 0) break;
      got += r;
    }
    return b.subarray(0, got);
  };
  const kopf = lies(12, 0);
  if (kopf.length < 12 || kopf.toString('ascii', 0, 4) !== 'RIFF' || kopf.toString('ascii', 8, 12) !== 'WAVE') throw falsch('not a RIFF/WAVE file');
  let pos = 12, fmtOk = false;
  for (;;) {
    const c = lies(8, pos);
    if (c.length < 8) throw falsch('no data chunk');
    const id = c.toString('ascii', 0, 4), n = c.readUInt32LE(4);
    pos += 8;
    if (id === 'fmt ') {
      const f = lies(Math.min(n, 40), pos);
      if (f.length < 16) throw falsch('fmt chunk too short');
      const [tag, kanaele, rate, bits] = [f.readUInt16LE(0), f.readUInt16LE(2), f.readUInt32LE(4), f.readUInt16LE(14)];
      if (tag !== 3 || kanaele !== 2 || rate !== 48000 || bits !== 32) {
        throw falsch(`expected float32 stereo 48000 Hz, got format ${tag}, ${kanaele} channel(s), ${rate} Hz, ${bits} bit`);
      }
      fmtOk = true;
    } else if (id === 'data') {
      if (!fmtOk) throw falsch('data chunk before the fmt chunk');
      if (pos + n > groesse) throw falsch(`data chunk of ${n} bytes runs past the end of the file`);
      if (n === 0 || n % 8 !== 0) throw falsch(`data chunk of ${n} bytes is not a whole number of stereo float32 frames`);
      return { pos, n };
    }
    pos += n + (n % 2);   // chunks are padded to an even size
  }
}

const oeffne = (pfad: string): number => {
  try { return fs.openSync(pfad, 'r'); } catch { throw new SchnittFehler(404, 'quelle_unbekannt', `audio file is missing: ${pfad}`); }
};

const fuelle = (fd: number, ziel: Uint8Array, von: number, pfad: string): void => {
  let got = 0;
  while (got < ziel.length) {
    const r = fs.readSync(fd, ziel, got, ziel.length - got, von + got);
    if (r <= 0) throw new SchnittFehler(422, 'format_falsch', `${pfad}: file ends inside the data chunk`);
    got += r;
  }
};

/** Reads `pfad` (IEEE float, 2 channels, 48 000 Hz, 32 bit) and returns the interleaved samples. With `maxFrames` a longer file is refused (`zu_lang`)
 *  before its data is read. Unreadable or other formats: `format_falsch`; a missing file: `quelle_unbekannt`. */
export function leseWavF32(pfad: string, maxFrames?: number): { daten: Float32Array; frames: number } {
  const fd = oeffne(pfad);
  try {
    const { pos, n } = kopfLesen(fd, pfad);
    const frames = n / 8;
    if (maxFrames !== undefined && frames > maxFrames) throw new SchnittFehler(413, 'zu_lang', `${frames} frames, at most ${maxFrames} (60 s) allowed`);
    const daten = new Float32Array(frames * 2);
    fuelle(fd, new Uint8Array(daten.buffer), pos, pfad);
    return { daten, frames };
  } finally { fs.closeSync(fd); }
}

/** Reads the same files as `leseWavF32` but hands the samples to `f` in blocks of `blockFrames` frames (interleaved; the last block may be shorter).
 *  The block array is reused between calls: copy what must outlive `f`. Returns the number of frames. Same refusals as `leseWavF32` (no length limit). */
export function leseWavF32Bloecke(pfad: string, blockFrames: number, f: (block: Float32Array) => void): number {
  const fd = oeffne(pfad);
  try {
    const { pos, n } = kopfLesen(fd, pfad);
    const frames = n / 8;
    const puffer = new Float32Array(Math.max(1, Math.floor(blockFrames)) * 2);
    for (let von = 0; von < frames; von += puffer.length / 2) {
      const k = Math.min(puffer.length / 2, frames - von);
      const block = puffer.subarray(0, k * 2);
      fuelle(fd, new Uint8Array(block.buffer, block.byteOffset, block.byteLength), pos + von * 8, pfad);
      f(block);
    }
    return frames;
  } finally { fs.closeSync(fd); }
}
