// Paket 1.13 Warp, Slice 1: kleine Messwerkzeuge für die Abnahme am Ziel (pruef/abnahme_w1.mjs): WAV (IEEE float 32 Bit) schreiben und lesen,
// Klicks finden, Frequenz aus Nulldurchgängen. Rein, ohne Netz und Datei außer lese/schreibe; getestet in tests/w1_wav.test.mjs.
import fs from 'node:fs';

// RIFF/WAVE, Format 3 (IEEE float), 32 Bit, kanaele Kanäle; `daten` ist ein Float32Array verschränkt
export function schreibeWav(pfad, daten, kanaele = 2, rate = 48000) {
  const bytes = daten.length * 4, kopf = Buffer.alloc(44);
  kopf.write('RIFF', 0); kopf.writeUInt32LE(36 + bytes, 4); kopf.write('WAVE', 8); kopf.write('fmt ', 12); kopf.writeUInt32LE(16, 16);
  kopf.writeUInt16LE(3, 20); kopf.writeUInt16LE(kanaele, 22); kopf.writeUInt32LE(rate, 24); kopf.writeUInt32LE(rate * kanaele * 4, 28);
  kopf.writeUInt16LE(kanaele * 4, 32); kopf.writeUInt16LE(32, 34); kopf.write('data', 36); kopf.writeUInt32LE(bytes, 40);
  fs.writeFileSync(pfad, Buffer.concat([kopf, Buffer.from(daten.buffer, daten.byteOffset, bytes)]));
}
// Liest eine WAV (Format 1 mit 16 Bit oder Format 3 mit 32 Bit): l = linker, r = zweiter Kanal (bei Mono derselbe Puffer), je Float32Array.
// Chunks werden gesucht, nicht angenommen.
export function leseWav(pfad) {
  const b = fs.readFileSync(pfad);
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') throw new Error(`${pfad}: kein RIFF/WAVE`);
  let fmt = null, daten = null;
  for (let o = 12; o + 8 <= b.length;) {
    const id = b.toString('latin1', o, o + 4), n = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(o + 8), kanaele: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === 'data') { daten = b.subarray(o + 8, Math.min(b.length, o + 8 + n)); break; }
    o += 8 + n + (n % 2);
  }
  if (!fmt || !daten) throw new Error(`${pfad}: fmt oder data fehlt`);
  const bytesProFrame = fmt.kanaele * fmt.bits / 8, frames = Math.floor(daten.length / bytesProFrame), l = new Float32Array(frames);
  const r = fmt.kanaele >= 2 ? new Float32Array(frames) : l, byteProKanal = fmt.bits / 8;   // r: zweiter Kanal (Slice 6), bei Mono derselbe Puffer wie l
  const lies = (o) => (fmt.format === 3 && fmt.bits === 32 ? daten.readFloatLE(o) : fmt.format === 1 && fmt.bits === 16 ? daten.readInt16LE(o) / 32768 : NaN);
  for (let i = 0; i < frames; i++) {
    const o = i * bytesProFrame;
    l[i] = lies(o);
    if (r !== l) r[i] = lies(o + byteProKanal);
  }
  if (Number.isNaN(l[0])) throw new Error(`${pfad}: Format ${fmt.format}/${fmt.bits} Bit nicht unterstützt`);
  return { l, r, rate: fmt.rate, frames };
}
// Sample-Stellen der Klicks: lokale Spitzen über der Schwelle, mindestens `abstand` Samples auseinander (die stärkere gewinnt).
// Die Ränder zählen mit (jenseits des Rands ist Stille): der Export beginnt auf dem Einsatz-Sample, ein Klick auf Index 0 oder auf dem letzten Index ist ein Klick.
export function klicks(x, schwelle = 0.2, abstand = 2000) {
  const aus = [];
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a < schwelle || a < (i > 0 ? Math.abs(x[i - 1]) : 0) || a < (i < x.length - 1 ? Math.abs(x[i + 1]) : 0)) continue;
    const letzte = aus.at(-1);
    if (letzte !== undefined && i - letzte < abstand) { if (a > Math.abs(x[letzte])) aus[aus.length - 1] = i; continue; }
    aus.push(i);
  }
  return aus;
}
// Frequenz in Hz aus steigenden Nulldurchgängen (linear interpoliert) von x[a, b)
export function frequenz(x, a, b, rate = 48000) {
  let erst = -1, letzt = -1, n = 0;
  for (let i = a + 1; i < b; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      const t = i - 1 + (-x[i - 1]) / (x[i] - x[i - 1]);
      if (erst < 0) erst = t;
      letzt = t; n++;
    }
  }
  return n < 2 ? 0 : (n - 1) * rate / (letzt - erst);
}
export const cent = (f, soll) => 1200 * Math.log2(f / soll);
