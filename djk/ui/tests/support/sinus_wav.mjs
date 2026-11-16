// Small PCM WAV files for the sample player tests: a sine at a known pitch, 16 bit, any rate and channel count, optional leading silence.
import fs from 'node:fs';
import path from 'node:path';

export function sinusWav(pfad, { hz = 220, sekunden = 1, rate = 44100, kanaele = 1, stille = 0, pegel = 0.5, stumm = false } = {}) {
  const n = Math.round(sekunden * rate), s0 = Math.round(stille * rate), bytes = n * kanaele * 2;
  const b = Buffer.alloc(44 + bytes);
  b.write('RIFF', 0); b.writeUInt32LE(36 + bytes, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(kanaele, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * kanaele * 2, 28); b.writeUInt16LE(kanaele * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(bytes, 40);
  for (let i = 0; i < n; i++) {
    const v = stumm || i < s0 ? 0 : Math.round(Math.sin(2 * Math.PI * hz * (i - s0) / rate) * pegel * 32767);
    for (let c = 0; c < kanaele; c++) b.writeInt16LE(v, 44 + (i * kanaele + c) * 2);
  }
  fs.mkdirSync(path.dirname(pfad), { recursive: true });
  fs.writeFileSync(pfad, b);
}
