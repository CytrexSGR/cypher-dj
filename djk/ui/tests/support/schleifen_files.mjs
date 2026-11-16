// Hand-written loop chunks for the sample player tests: WAV with a `smpl` chunk, AIFF / AIFF-C with `INST` and `MARK`.
import fs from 'node:fs';
import path from 'node:path';

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const chunkLE = (id, daten) => Buffer.concat([Buffer.from(id, 'latin1'), u32(daten.length), daten, daten.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);

/** A mono 16 bit WAV of `frames` frames; `schleifen` = [[start, endInclusive], ...] written as a `smpl` chunk before or after the data chunk
 *  (`null`: no chunk). `smplLaenge` cuts the chunk data to that many bytes (a broken chunk). */
export function wavMitSchleife(pfad, { rate = 48000, frames = 6000, schleifen = [], smplNach = false, smplLaenge = null, hz = 220, stille = 0 } = {}) {
  const fmt = Buffer.alloc(16); fmt.writeUInt16LE(1, 0); fmt.writeUInt16LE(1, 2); fmt.writeUInt32LE(rate, 4); fmt.writeUInt32LE(rate * 2, 8); fmt.writeUInt16LE(2, 12); fmt.writeUInt16LE(16, 14);
  const pcm = Buffer.alloc(frames * 2);
  for (let i = stille; i < frames; i++) pcm.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * (i - stille) / rate) * 16000), i * 2);
  const teile = [chunkLE('fmt ', fmt)];
  let smpl = null;
  if (schleifen !== null) {
    const kopf = Buffer.alloc(36); kopf.writeUInt32LE(60, 12); kopf.writeUInt32LE(schleifen.length, 28);
    const loops = schleifen.map(([s, e]) => { const b = Buffer.alloc(24); b.writeUInt32LE(s, 8); b.writeUInt32LE(e, 12); return b; });
    smpl = Buffer.concat([kopf, ...loops]);
    if (smplLaenge !== null) smpl = smpl.subarray(0, smplLaenge);
  }
  if (smpl && !smplNach) teile.push(chunkLE('smpl', smpl));
  teile.push(chunkLE('data', pcm));
  if (smpl && smplNach) teile.push(chunkLE('smpl', smpl));
  const rumpf = Buffer.concat([Buffer.from('WAVE', 'latin1'), ...teile]);
  fs.mkdirSync(path.dirname(pfad), { recursive: true });
  fs.writeFileSync(pfad, Buffer.concat([Buffer.from('RIFF', 'latin1'), u32(rumpf.length), rumpf]));
}

const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const chunkBE = (id, daten) => Buffer.concat([Buffer.from(id, 'latin1'), u32be(daten.length), daten, daten.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
/** 80 bit extended float of an integer rate. */
function erweitert(rate) {
  const b = Buffer.alloc(10);
  const e = Math.floor(Math.log2(rate));
  b.writeUInt16BE(16383 + e, 0);
  b.writeBigUInt64BE(BigInt(rate) << BigInt(63 - e), 2);
  return b;
}

/** A mono 16 bit AIFF (or AIFF-C when `komp` names the compression type, e.g. 'sowt' or 'NONE') of `frames` frames.
 *  `inst`: {modus, anfang, ende} (play mode and marker ids of the sustain loop, INST), `marken`: [[id, position], ...] (MARK). */
export function aiffMitSchleife(pfad, { rate = 44100, frames = 6000, komp = null, inst = null, marken = null, hz = 220 } = {}) {
  const k = Buffer.alloc(2); k.writeUInt16BE(1);
  const f = Buffer.alloc(4); f.writeUInt32BE(frames);
  const bits = Buffer.alloc(2); bits.writeUInt16BE(16);
  const comm = [k, f, bits, erweitert(rate)];
  if (komp) comm.push(Buffer.from(komp, 'latin1'), Buffer.from([4, 110, 111, 110, 101]));   // type + pstring "none"
  const pcm = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(Math.sin(2 * Math.PI * hz * i / rate) * 16000);
    if (komp === 'sowt') pcm.writeInt16LE(v, i * 2); else pcm.writeInt16BE(v, i * 2);
  }
  const teile = [chunkBE('COMM', Buffer.concat(comm))];
  if (marken) {
    const n = Buffer.alloc(2); n.writeUInt16BE(marken.length);
    const m = [n];
    for (const [id, pos] of marken) { const b = Buffer.alloc(8); b.writeUInt16BE(id, 0); b.writeUInt32BE(pos, 2); b[6] = 1; b[7] = 120; m.push(b); }   // pstring "x" (even length)
    teile.push(chunkBE('MARK', Buffer.concat(m)));
  }
  if (inst) {
    const b = Buffer.alloc(20); b[0] = 60; b[3] = 127; b[5] = 127; b.writeUInt16BE(inst.modus, 8); b.writeUInt16BE(inst.anfang, 10); b.writeUInt16BE(inst.ende, 12);
    teile.push(chunkBE('INST', b));
  }
  teile.push(chunkBE('SSND', Buffer.concat([Buffer.alloc(8), pcm])));
  const rumpf = Buffer.concat([Buffer.from(komp ? 'AIFC' : 'AIFF', 'latin1'), ...teile]);
  fs.mkdirSync(path.dirname(pfad), { recursive: true });
  fs.writeFileSync(pfad, Buffer.concat([Buffer.from('FORM', 'latin1'), u32be(rumpf.length), rumpf]));
}
