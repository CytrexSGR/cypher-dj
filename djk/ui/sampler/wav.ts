// Sampler A1: read the audio of a module track. The WAVs of the module store are float32 stereo 48 kHz (project/recording.ts wavKopf); anything else is
// refused, nothing is converted. The chunk walk handles the `fact` chunk of that header and any other chunk before `data`.
import fs from 'node:fs';
import { SchnittFehler } from './schnitt.ts';

/** Reads `pfad` (IEEE float, 2 channels, 48 000 Hz, 32 bit) and returns the interleaved samples. With `maxFrames` a longer file is refused (`zu_lang`)
 *  before its data is read. Unreadable or other formats: `format_falsch`; a missing file: `quelle_unbekannt`. */
export function leseWavF32(pfad: string, maxFrames?: number): { daten: Float32Array; frames: number } {
  const falsch = (t: string): SchnittFehler => new SchnittFehler(422, 'format_falsch', `${pfad}: ${t}`);
  let fd: number;
  try { fd = fs.openSync(pfad, 'r'); } catch { throw new SchnittFehler(404, 'quelle_unbekannt', `audio file is missing: ${pfad}`); }
  try {
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
        const frames = n / 8;
        if (maxFrames !== undefined && frames > maxFrames) throw new SchnittFehler(413, 'zu_lang', `${frames} frames, at most ${maxFrames} (60 s) allowed`);
        const daten = new Float32Array(frames * 2);
        const ziel = new Uint8Array(daten.buffer);
        let got = 0;
        while (got < n) {
          const r = fs.readSync(fd, ziel, got, n - got, pos + got);
          if (r <= 0) throw falsch('file ends inside the data chunk');
          got += r;
        }
        return { daten, frames };
      }
      pos += n + (n % 2);   // chunks are padded to an even size
    }
  } finally { fs.closeSync(fd); }
}
