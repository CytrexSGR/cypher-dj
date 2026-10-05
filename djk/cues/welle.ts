// Wellenform in drei Bändern (tief/mitte/hoch), Spitze und RMS je 10 ms, wie die farbige 3-Band-Anzeige in rekordbox.
// Dekodieren: ffmpeg (mono, 24 kHz, f32). Bänder: Linkwitz-Riley 4. Ordnung (je zwei Butterworth-Biquads),
// Übergänge 200 Hz und 2 500 Hz. Die MP3 wird nur gelesen (ffmpeg -i, kein Schreibziel außer stdout).
// Cache-Datei (.welle): 32 Byte Kopf + je Rahmen 6 Byte [tiefSpitze, tiefRms, mitteSpitze, mitteRms, hochSpitze, hochRms],
//   Wert = round(255 · sqrt(min(1, x))) mit x linear (Vollaussteuerung 1.0).
// CLI (Vorrechnen im Hintergrund, vom Server mit nice -n 19 gestartet): node welle.ts <mp3> <ziel.welle>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RATE = 24000;
export const RAHMEN = 240; // 10 ms
export const UEBERGANG_TIEF = 200;
export const UEBERGANG_HOCH = 2500;
const MAGIE = 0x574b4a44; // "DJKW" little endian
const VERSION = 1;
export const KOPF = 32;

class Biquad {
  b0: number; b1: number; b2: number; a1: number; a2: number; x1 = 0; x2 = 0; y1 = 0; y2 = 0;
  constructor(art: 'tp' | 'hp', f: number, rate: number) {
    const w = 2 * Math.PI * f / rate;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * Math.SQRT1_2);
    const a0 = 1 + al;
    if (art === 'tp') { this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0; }
    else { this.b0 = (1 + c) / 2 / a0; this.b1 = -(1 + c) / a0; this.b2 = this.b0; }
    this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0;
  }
  f(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// Nimmt Samples in Stücken an und liefert Rahmen (Float, linear)
export class Baender {
  private t = [new Biquad('tp', UEBERGANG_TIEF, RATE), new Biquad('tp', UEBERGANG_TIEF, RATE)];
  private m = [new Biquad('hp', UEBERGANG_TIEF, RATE), new Biquad('hp', UEBERGANG_TIEF, RATE), new Biquad('tp', UEBERGANG_HOCH, RATE), new Biquad('tp', UEBERGANG_HOCH, RATE)];
  private h = [new Biquad('hp', UEBERGANG_HOCH, RATE), new Biquad('hp', UEBERGANG_HOCH, RATE)];
  private n = 0;
  private acc = new Float64Array(6); // Spitze t, Quadratsumme t, Spitze m, Summe m, Spitze h, Summe h
  rahmen: number[] = []; // flach, 6 je Rahmen
  samples = 0;
  fuettere(x: Float32Array): void {
    const { t, m, h, acc } = this;
    for (let i = 0; i < x.length; i++) {
      const s = x[i];
      const a = t[1].f(t[0].f(s));
      const b = m[3].f(m[2].f(m[1].f(m[0].f(s))));
      const c = h[1].f(h[0].f(s));
      const aa = Math.abs(a), bb = Math.abs(b), cc = Math.abs(c);
      if (aa > acc[0]) acc[0] = aa; acc[1] += a * a;
      if (bb > acc[2]) acc[2] = bb; acc[3] += b * b;
      if (cc > acc[4]) acc[4] = cc; acc[5] += c * c;
      if (++this.n === RAHMEN) this.schliesse();
    }
    this.samples += x.length;
  }
  private schliesse(): void {
    const { acc, n } = this;
    if (n === 0) return;
    this.rahmen.push(acc[0], Math.sqrt(acc[1] / n), acc[2], Math.sqrt(acc[3] / n), acc[4], Math.sqrt(acc[5] / n));
    acc.fill(0);
    this.n = 0;
  }
  ende(): { rahmen: number; dauer_s: number; werte: Float32Array } {
    this.schliesse();
    return { rahmen: this.rahmen.length / 6, dauer_s: this.samples / RATE, werte: Float32Array.from(this.rahmen) };
  }
}

export function quantisiere(v: number): number { return Math.round(255 * Math.sqrt(Math.min(1, Math.max(0, v)))); }
export function entquantisiere(q: number): number { return (q / 255) ** 2; }

export function kodiere(w: { rahmen: number; dauer_s: number; werte: Float32Array }): Buffer {
  const b = Buffer.alloc(KOPF + w.rahmen * 6);
  b.writeUInt32LE(MAGIE, 0); b.writeUInt16LE(VERSION, 4); b.writeUInt16LE(6, 6);
  b.writeUInt32LE(w.rahmen, 8); b.writeUInt32LE(RATE, 12); b.writeUInt32LE(RAHMEN, 16); b.writeFloatLE(w.dauer_s, 20);
  b.writeUInt16LE(UEBERGANG_TIEF, 24); b.writeUInt16LE(UEBERGANG_HOCH, 26);
  for (let i = 0; i < w.werte.length; i++) b[KOPF + i] = quantisiere(w.werte[i]);
  return b;
}

export function dekodiereKopf(b: Buffer): { rahmen: number; rate: number; rahmen_samples: number; dauer_s: number } {
  if (b.length < KOPF || b.readUInt32LE(0) !== MAGIE || b.readUInt16LE(4) !== VERSION) throw new Error('keine Wellenform-Datei');
  const rahmen = b.readUInt32LE(8);
  if (b.length !== KOPF + rahmen * 6) throw new Error('Wellenform-Datei unvollständig');
  return { rahmen, rate: b.readUInt32LE(12), rahmen_samples: b.readUInt32LE(16), dauer_s: b.readFloatLE(20) };
}

// Dekodiert mit ffmpeg und rechnet die Bänder; wirft bei unlesbarer Datei (ffmpeg rc != 0 oder keine Samples)
export function rechne(datei: string, { nice = false }: { nice?: boolean } = {}): Promise<{ rahmen: number; dauer_s: number; werte: Float32Array }> {
  return new Promise((ok, fehler) => {
    if (!fs.existsSync(datei)) { fehler(new Error(`Datei fehlt: ${datei}`)); return; }
    const arg = ['-nostdin', '-v', 'error', '-i', datei, '-map', '0:a:0', '-ac', '1', '-ar', String(RATE), '-f', 'f32le', 'pipe:1'];
    const p = nice ? spawn('nice', ['-n', '19', 'ffmpeg', ...arg], { stdio: ['ignore', 'pipe', 'pipe'] }) : spawn('ffmpeg', arg, { stdio: ['ignore', 'pipe', 'pipe'] });
    const b = new Baender();
    let rest = Buffer.alloc(0);
    let err = '';
    p.stdout.on('data', (d: Buffer) => {
      const alles = rest.length ? Buffer.concat([rest, d]) : d;
      const n = Math.floor(alles.length / 4);
      b.fuettere(new Float32Array(alles.buffer.slice(alles.byteOffset, alles.byteOffset + n * 4)));
      rest = Buffer.from(alles.subarray(n * 4));
    });
    p.stderr.on('data', (d) => { err += d; });
    p.once('error', fehler);
    p.once('close', (rc) => {
      if (rc !== 0) { fehler(new Error(`ffmpeg rc ${rc}: ${err.trim().slice(0, 300)}`)); return; }
      const e = b.ende();
      if (e.rahmen === 0) { fehler(new Error(`keine Samples: ${err.trim().slice(0, 300)}`)); return; }
      ok(e);
    });
  });
}

// Atomar schreiben: erst .tmp-<pid>, dann umbenennen (halbe Dateien gibt es nie im Cache)
export function schreibeAtomar(ziel: string, daten: Buffer | string): void {
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  const tmp = `${ziel}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tmp, daten);
  fs.renameSync(tmp, ziel);
}

export async function rechneUndCache(datei: string, ziel: string, opt: { nice?: boolean } = {}): Promise<Buffer> {
  const w = await rechne(datei, opt);
  const b = kodiere(w);
  schreibeAtomar(ziel, b);
  return b;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [datei, ziel] = process.argv.slice(2);
  rechneUndCache(datei, ziel).then(() => process.exit(0), (e: Error) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
}
