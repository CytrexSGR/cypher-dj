// The four factory samples of the `amiga` device (amiga-quadrat, amiga-dreieck, amiga-saege, amiga-rauschen as raw stereo float32 files in the sample folder
// of the graphs). Byte for byte the same files as djk/instruments/modular_dsp/build_amiga_samples.py writes (and src/proben.rs): 8 bit integers divided by 128,
// the same value in both channels; the noise is the 15 bit shift register of the NES. Without them no `amiga` graph translates, so the page server makes sure
// they exist: at the start of the sampler area, before a bank is made and before a tracker module is made from a template.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { graphenOrdner } from '../graphs.ts';
import { instanz } from '../paths.ts';

const N_RAUSCHEN = 4096;

const quadrat = (): number[] => Array.from({ length: 32 }, (_, i) => (i < 16 ? 93 : -93));
const dreieck = (): number[] => Array.from({ length: 32 }, (_, i) => -90 + 12 * (i < 16 ? i : 31 - i));
const saege = (): number[] => Array.from({ length: 32 }, (_, i) => -93 + 6 * i);
function rauschen(): number[] {
  let reg = 1;
  const aus: number[] = [];
  for (let i = 0; i < N_RAUSCHEN; i++) {
    const a = Math.floor(110 * (N_RAUSCHEN - i) * (N_RAUSCHEN - i) / (N_RAUSCHEN * N_RAUSCHEN));   // all integers: exact below 2^53
    aus.push(reg & 1 ? 0 - a : a);   // 0 - a: no negative zero (the script has integers)
    reg = (reg >> 1) | (((reg ^ (reg >> 1)) & 1) << 14);
  }
  return aus;
}

/** Pure. The bytes of one factory file: stereo float32 little endian, both channels `v / 128`. */
function stereo(werte: number[]): Buffer {
  const f = new Float32Array(werte.length * 2);
  werte.forEach((v, i) => { f[2 * i] = v / 128; f[2 * i + 1] = v / 128; });
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}

/** Pure. The factory files by name: the same bytes as build_amiga_samples.py. */
export function werksProben(): Record<string, Buffer> {
  return { 'amiga-quadrat.f32': stereo(quadrat()), 'amiga-dreieck.f32': stereo(dreieck()), 'amiga-saege.f32': stereo(saege()), 'amiga-rauschen.f32': stereo(rauschen()) };
}

/** Writes the factory files that are missing from `ordner` (created when needed); a file that exists is never touched. Returns the names written. */
export function sichereWerksProben(ordner: string): string[] {
  const geschrieben: string[] = [];
  let alle: Record<string, Buffer> | undefined;
  for (const name of ['amiga-quadrat.f32', 'amiga-dreieck.f32', 'amiga-saege.f32', 'amiga-rauschen.f32']) {
    const ziel = path.join(ordner, name);
    if (fs.existsSync(ziel)) continue;
    alle ??= werksProben();
    fs.mkdirSync(ordner, { recursive: true });
    const tmp = `${ziel}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    try { fs.writeFileSync(tmp, alle[name]); fs.renameSync(tmp, ziel); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
    geschrieben.push(name);
  }
  return geschrieben;
}

/** The same for the sample folder of the graphs the core reads. A test instance (a..i) without its own graph folder (CYPHERDJ_BK_ORDNER) leaves the real folder
 *  alone: [] then. Never throws (a read-only folder is the core's problem, not the server's). */
export function sichereWerksProbenImStandardOrdner(): string[] {
  if (instanz() !== '' && (process.env.CYPHERDJ_BK_ORDNER ?? '') === '') return [];
  try { return sichereWerksProben(path.join(graphenOrdner(), 'samples')); } catch { return []; }
}
