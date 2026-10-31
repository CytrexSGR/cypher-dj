// 1.8 Slice 1: reine Teile der Take-Übernahme. Rohdatei (f32 verschränkt, 48 kHz, Stereo) -> WAV (IEEE float, Kopf 58 Byte wie kern/include/cypherdj/wav.h),
// und der Clip auf der Spur nach der Ersetzen-Regel (Spec 1.8 R7) mit den vorhandenen Befehlen, damit ein Verlaufseintrag entsteht.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fuehreListeAus } from './befehle.ts';
import { INTERNE_EINGAENGE, sucheSpur, type AudioClip, type Projekt } from './modell.ts';

export class TakeFehler extends Error {
  readonly grund: string;
  constructor(grund: string, text = '') { super(text ? `${grund}: ${text}` : grund); this.grund = grund; }
}
const RATE = 48000;

export function eingangsCode(name: string): number {
  const i = (INTERNE_EINGAENGE as readonly string[]).indexOf(name);
  if (i < 0) throw new TakeFehler('eingang_fehlt', name);
  return 11 + i;
}

export function wavKopf(frames: number): Buffer {
  const daten = frames * 8;
  const k = Buffer.alloc(58);
  k.write('RIFF', 0, 'ascii'); k.writeUInt32LE(50 + daten, 4); k.write('WAVE', 8, 'ascii');
  k.write('fmt ', 12, 'ascii'); k.writeUInt32LE(18, 16); k.writeUInt16LE(3, 20); k.writeUInt16LE(2, 22); k.writeUInt32LE(RATE, 24);
  k.writeUInt32LE(RATE * 8, 28); k.writeUInt16LE(8, 32); k.writeUInt16LE(32, 34); k.writeUInt16LE(0, 36);
  k.write('fact', 38, 'ascii'); k.writeUInt32LE(4, 42); k.writeUInt32LE(frames, 46);
  k.write('data', 50, 'ascii'); k.writeUInt32LE(daten, 54);
  return k;
}

// Streamt Rohdatei -> WAV (nie ersetzen: Öffnen mit 'wx') und rechnet die sha256 über die ganze WAV. Sync: eine Aufnahme ist nach dem Ende abgeschlossen.
export function schreibeWavAusF32(quelle: string, ziel: string): { frames: number; sha256: string } {
  const frames = Math.floor(fs.statSync(quelle).size / 8);
  // R1: RIFF-Größe ist 32 Bit (ab 3 h 6 min); vor dem Öffnen, es bleibt keine leere Datei
  if (50 + frames * 8 > 0xFFFFFFFF) throw new TakeFehler('take_zu_lang', `${frames} Frames`);
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  const aus = fs.openSync(ziel, 'wx');
  const ein = fs.openSync(quelle, 'r');
  try {
    const h = crypto.createHash('sha256');
    const kopf = wavKopf(frames);
    h.update(kopf);
    fs.writeSync(aus, kopf);
    const puf = Buffer.allocUnsafe(1 << 20);
    let rest = frames * 8;
    while (rest > 0) {
      const n = fs.readSync(ein, puf, 0, Math.min(puf.length, rest), null);
      if (n <= 0) break;
      h.update(puf.subarray(0, n));
      fs.writeSync(aus, puf, 0, n);
      rest -= n;
    }
    fs.fsyncSync(aus);
    return { frames, sha256: h.digest('hex') };
  } catch (e) { fs.rmSync(ziel, { force: true }); throw e; }   // R1: keine halbe WAV zurücklassen ('wx': die Datei ist unsere)
  finally { fs.closeSync(ein); fs.closeSync(aus); }
}

// Review MINOR 5 (Slice 6): dasselbe in Stücken von 1 MiB über fs.promises, die Ereignisschleife bleibt frei (bei 600 s sind es 4 x 230 MB)
export async function schreibeWavAusF32Stueckweise(quelle: string, ziel: string): Promise<{ frames: number; sha256: string }> {
  const frames = Math.floor(fs.statSync(quelle).size / 8);
  if (50 + frames * 8 > 0xFFFFFFFF) throw new TakeFehler('take_zu_lang', `${frames} Frames`);
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  const aus = await fs.promises.open(ziel, 'wx');
  try {
    const ein = await fs.promises.open(quelle, 'r');
    try {
      const h = crypto.createHash('sha256');
      const kopf = wavKopf(frames);
      h.update(kopf);
      await aus.write(kopf);
      const puf = Buffer.allocUnsafe(1 << 20);
      let rest = frames * 8;
      while (rest > 0) {
        const { bytesRead: n } = await ein.read(puf, 0, Math.min(puf.length, rest), null);
        if (n <= 0) break;
        h.update(puf.subarray(0, n));
        await aus.write(puf, 0, n);
        rest -= n;
      }
      await aus.sync();
      return { frames, sha256: h.digest('hex') };
    } finally { await ein.close(); }
  } catch (e) { await aus.close().catch(() => {}); fs.rmSync(ziel, { force: true }); throw e; }
  finally { await aus.close().catch(() => {}); }
}

export interface TakeAngabe { spurId: string; startBeat: number; laengeBeats: number; sha256: string; pfadHinweis: string; name: string }
const EPS = 1e-9;
const lauf = (p: Projekt, b: unknown): Projekt => fuehreListeAus(p, [b]).projekt;

// Der Take ersetzt den Bereich [start, start + länge): überlappende Clips werden an den Rändern geteilt, was ganz darin liegt, entfällt, dann kommt der Take.
export function nehmeTakeAuf(projekt: Projekt, a: TakeAngabe): Projekt {
  if (!sucheSpur(projekt, a.spurId)) throw new TakeFehler('veraltet_spur', a.spurId);
  const von = a.startBeat, bis = a.startBeat + a.laengeBeats;
  const clipsDerSpur = (p: Projekt) => sucheSpur(p, a.spurId)!.clips;
  const schneidet = (c: { start_beat: number; laenge_beats: number }, t: number) => c.start_beat < t - EPS && c.start_beat + c.laenge_beats > t + EPS;
  const ueberlappt = (c: { start_beat: number; laenge_beats: number }) => c.start_beat < bis - EPS && c.start_beat + c.laenge_beats > von + EPS;
  let p = structuredClone(projekt);
  // Loop-Clips lassen sich nicht teilen (clip_teilen); sie dürfen nur ganz überdeckt oder unberührt sein
  for (const c of clipsDerSpur(p)) {
    if (c.loop_beats != null && (schneidet(c, von) || schneidet(c, bis))) throw new TakeFehler('ersetzen_loop', c.id);
  }
  for (const t of [von, bis]) {   // erst teilen, dann löschen
    const c = clipsDerSpur(p).find((x) => schneidet(x, t));
    if (c) p = lauf(p, { befehl: 'clip_teilen', clip_id: c.id, beat: t });
  }
  for (const c of clipsDerSpur(p).filter((x) => ueberlappt(x))) p = lauf(p, { befehl: 'clip_loeschen', clip_id: c.id });
  p = lauf(p, { befehl: 'clip_neu', spur_id: a.spurId, art: 'audio', start_beat: von, laenge_beats: a.laengeBeats,
    sha256: a.sha256, pfad_hinweis: a.pfadHinweis, name: a.name });
  return p;
}
export type { AudioClip };
