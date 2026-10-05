// MVP 2 (ADR 025, SCHNITTSTELLEN §4.9): Loop-Bibliothek für die Seite. Ordner je Instanz wie im Kern (main.cpp):
// Vorgabe ~/.config/cypherdj/loops, Prüfinstanz <i> /dev/shm/cypherdj-<i>/loops. Gelistet wird, was der Kern laden
// würde: Name [a-z0-9_-]{1,32} (halbe .<name>.neu-Ordner nicht), schema 1, beats 1/2/4/8/16/32 (alte Dateien: takte 1/2/4/8 als beats = 4 · takte, wie der Kern).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface LoopEintrag { name: string; beats: number; quelle: string; erstellt: string; ladbar: boolean; grund: string }

// Warum der Kern diesen Loop ablehnen würde (loop.cpp lade_loop: bpm 128, frames = beats · 22 500, loop.f32 mit
// frames · 8 Bytes); '' = ladbar. Text englisch, er steht auf der Seite.
function loopGrund(dir: string, name: string, j: Record<string, unknown>, beats: number): string {
  if (j.bpm !== 128) return `bpm ${String(j.bpm)}, expected 128`;
  if (j.frames !== beats * 22500) return `frames ${String(j.frames)}, expected ${beats * 22500} for ${beats} beat(s)`;
  if (j.datei !== 'loop.f32') return 'datei is not loop.f32';
  let bytes = -1;
  try { bytes = fs.statSync(path.join(dir, name, 'loop.f32')).size; } catch { return 'loop.f32 is missing'; }
  if (bytes !== beats * 22500 * 8) return `loop.f32 has ${bytes} bytes, expected ${beats * 22500 * 8}`;
  return '';
}

export const LOOP_NAME = /^[a-z0-9_-]{1,32}$/;

export function loopOrdnerVorgabe(instanz: string): string {
  return instanz ? `/dev/shm/cypherdj-${instanz}/loops` : path.join(os.homedir(), '.config', 'cypherdj', 'loops');
}

export function leseLoops(dir: string): LoopEintrag[] {
  if (!fs.existsSync(dir)) return [];
  const aus: LoopEintrag[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!LOOP_NAME.test(name)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, name, 'loop.json'), 'utf8')) as Record<string, unknown>;
      const beats = j.beats !== undefined ? j.beats as number : [1, 2, 4, 8].includes(j.takte as number) ? 4 * (j.takte as number) : 0;
      if (j.schema !== 1 || ![1, 2, 4, 8, 16, 32].includes(beats)) continue;
      const grund = loopGrund(dir, name, j, beats);
      aus.push({ name, beats, quelle: String(j.quelle ?? ''), erstellt: String(j.erstellt ?? ''), ladbar: grund === '', grund });
    } catch { /* unlesbar: nicht in der Liste */ }
  }
  return aus;
}

// Plan Grid (D6): Versatz des Rasters im Loop, aus und in loop.json (übrige Felder bleiben, atomar).
export function leseLoopVersatz(dir: string, name: string): { versatz: number; frames: number } | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, name, 'loop.json'), 'utf8')) as Record<string, unknown>;
    const frames = Number(j.frames), v = j.versatz_frames;
    if (!Number.isInteger(frames) || frames <= 0) return null;
    return { frames, versatz: typeof v === 'number' && Number.isInteger(v) && Math.abs(v) < frames ? v : 0 };
  } catch {
    return null;
  }
}
export function schreibeLoopVersatz(dir: string, name: string, v: number): void {
  const datei = path.join(dir, name, 'loop.json');
  const j = JSON.parse(fs.readFileSync(datei, 'utf8')) as Record<string, unknown>;
  j.versatz_frames = v;
  const tmp = `${datei}.${process.pid}.neu`;
  fs.writeFileSync(tmp, JSON.stringify(j));
  fs.renameSync(tmp, datei);
}

// Deck-Loop → Loop der Bibliothek: Ausschnitt der Fassung (Stereo float32, 8 Byte je Frame) ab startFrame, frames lang;
// außerhalb der Datei Stille. Atomar über .<name>.neu (leseLoops überspringt halbe Ordner).
export function schreibeLoopAusFassung(o: { basis: string; dir: string; name: string; startFrame: number; frames: number;
  bpm: number; beats: number; herkunft: Record<string, unknown> }): void {
  const buf = Buffer.alloc(o.frames * 8);
  const fd = fs.openSync(o.basis, 'r');
  try {
    const gesamt = fs.fstatSync(fd).size / 8;
    const von = Math.max(0, o.startFrame), bis = Math.min(gesamt, o.startFrame + o.frames);
    if (bis > von) fs.readSync(fd, buf, (von - o.startFrame) * 8, (bis - von) * 8, von * 8);
  } finally { fs.closeSync(fd); }
  const tmp = path.join(o.dir, `.${o.name}.neu`), ziel = path.join(o.dir, o.name);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'loop.f32'), buf);
  const jetzt = new Date(), z = (n: number) => String(n).padStart(2, '0');
  fs.writeFileSync(path.join(tmp, 'loop.json'), JSON.stringify({ schema: 1, name: o.name, beats: o.beats, bpm: o.bpm, frames: o.frames,
    datei: 'loop.f32', quelle: 'deck', erstellt: `${jetzt.getFullYear()}-${z(jetzt.getMonth() + 1)}-${z(jetzt.getDate())} ${z(jetzt.getHours())}:${z(jetzt.getMinutes())}`,
    herkunft: o.herkunft }));
  fs.renameSync(tmp, ziel);
}
