// 1.8 Slice 1: reine Teile der Take-Übernahme. Rohdatei (f32 verschränkt, 48 kHz, Stereo) -> WAV (IEEE float, Kopf 58 Byte wie kern/include/cypherdj/wav.h),
// und der Clip auf der Spur nach der Ersetzen-Regel (Spec 1.8 R7) mit den vorhandenen Befehlen, damit ein Verlaufseintrag entsteht.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BefehlFehler, fuehreListeAus, pruefeGrenzen, teileClipsAn } from './befehle.ts';
import { MAX_CLIPS, MAX_TAKES_PRO_SPUR, neueId, sucheSpur, type AudioClip, type Clip, type Projekt } from './modell.ts';
import { istTakeKopie, klingtGleich, TAKE_KOPIE_EPS } from './takes.ts';
import { REC_EINGANG } from '../../vertrag/stroeme.ts';

export class TakeFehler extends Error {
  readonly grund: string;
  constructor(grund: string, text = '') { super(text ? `${grund}: ${text}` : grund); this.grund = grund; }
}
const RATE = 48000;

export function eingangsCode(name: string): number {
  const code = (REC_EINGANG as Record<string, number>)[name];   // S18: explicit table, no longer 11 + index (erz/4 and erz/8 have no tap)
  if (code === undefined) throw new TakeFehler('eingang_fehlt', name);
  return code;
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
export const ORIGINAL_NAME = 'Original';   // 1.14 comping (spec R3): the lane that keeps what a recording overwrote

// 1.14 comping (spec R3): the take replaces the range [start, start + length) of the main lane as before, but nothing is lost any more.
// The take clip also goes into a take lane (the newest one without a clip in the range, else a new "Take <n>"). Overlapped main clips are cut at the
// range edges (shared with comp_waehlen); parts inside that are copies of a take clip (R6) are dropped, all others move into the Original lane.
// Pure: the input is never touched; every failure throws before anything is returned (takes_voll, zu_gross, ersetzen_loop, veraltet_spur).
export function nehmeTakeAuf(projekt: Projekt, a: TakeAngabe): Projekt {
  if (!sucheSpur(projekt, a.spurId)) throw new TakeFehler('veraltet_spur', a.spurId);
  try { return nehme(projekt, a); } catch (e) {
    if (e instanceof BefehlFehler && e.grund === 'zu_gross') throw new TakeFehler('zu_gross', e.detail);   // MAX_CLIPS: report the reason
    throw e;
  }
}
function nehme(projekt: Projekt, a: TakeAngabe): Projekt {
  const von = a.startBeat, bis = a.startBeat + a.laengeBeats;
  const schneidet = (c: { start_beat: number; laenge_beats: number }, t: number) => c.start_beat < t - EPS && c.start_beat + c.laenge_beats > t + EPS;
  const ueberlappt = (c: { start_beat: number; laenge_beats: number }) => c.start_beat < bis - EPS && c.start_beat + c.laenge_beats > von + EPS;
  let p = structuredClone(projekt);
  let spur = sucheSpur(p, a.spurId)!;
  // Loop clips cannot be split (clip_teilen); they may only be covered completely or untouched
  for (const c of spur.clips) {
    if (c.loop_beats != null && (schneidet(c, von) || schneidet(c, bis))) throw new TakeFehler('ersetzen_loop', c.id);
  }
  teileClipsAn(p, spur, [von, bis]);
  // what the range overwrites: a part that is a copy of a take clip (inside its range) is dropped, every other part is kept in the Original lane
  const alleTakeClips = (spur.takes ?? []).flatMap((t) => t.clips);
  const istKopie = (c: Clip): boolean => c.art === 'audio' && alleTakeClips.some((t) => klingtGleich(c, t, p.tempo_bpm)
    && c.start_beat >= t.start_beat - TAKE_KOPIE_EPS && c.start_beat + c.laenge_beats <= t.start_beat + t.laenge_beats + TAKE_KOPIE_EPS);
  const drin = spur.clips.filter(ueberlappt);
  const zuOriginal = drin.filter((c) => !istKopie(c)) as AudioClip[];
  // lane choice: the newest take lane (never the Original lane) without a clip in the range, else a new one
  const takeLanes = (spur.takes ?? []).filter((t) => t.art === undefined);
  const neueste = takeLanes.at(-1);
  const wiederverwenden = neueste !== undefined && !neueste.clips.some(ueberlappt);
  const hatOriginal = (spur.takes ?? []).some((t) => t.art === 'original');
  const noetig = (wiederverwenden ? 0 : 1) + (zuOriginal.length > 0 && !hatOriginal ? 1 : 0);
  if ((spur.takes ?? []).length + noetig > MAX_TAKES_PRO_SPUR) throw new TakeFehler('takes_voll', `${(spur.takes ?? []).length} lanes + ${noetig}`);
  const verschoben = structuredClone(zuOriginal);
  spur.clips = spur.clips.filter((c) => !drin.includes(c));
  if (!wiederverwenden) p = lauf(p, { befehl: 'take_neu', spur_id: a.spurId });
  if (verschoben.length > 0 && !hatOriginal) {
    p = lauf(p, { befehl: 'take_neu', spur_id: a.spurId, name: ORIGINAL_NAME });
    sucheSpur(p, a.spurId)!.takes!.at(-1)!.art = 'original';
  }
  spur = sucheSpur(p, a.spurId)!;
  const original = spur.takes?.find((t) => t.art === 'original');
  if (original) {
    original.clips.push(...verschoben);
    original.clips.sort((x, y) => x.start_beat - y.start_beat);
  }
  // MAX_CLIPS counts main and take clips; the recording adds two (main and take lane). Named here so the reason is zu_gross, not a model error.
  const vorhanden = p.spuren.reduce((n, x) => n + x.clips.length + (x.takes ?? []).reduce((m, t) => m + t.clips.length, 0), 0);
  if (vorhanden + 2 > MAX_CLIPS) throw new TakeFehler('zu_gross', `${vorhanden + 2} clips (at most ${MAX_CLIPS})`);
  const vorher = new Set(spur.clips.map((c) => c.id));
  p = lauf(p, { befehl: 'clip_neu', spur_id: a.spurId, art: 'audio', start_beat: von, laenge_beats: a.laengeBeats,
    sha256: a.sha256, pfad_hinweis: a.pfadHinweis, name: a.name });
  spur = sucheSpur(p, a.spurId)!;
  const haupt = spur.clips.find((c) => !vorher.has(c.id)) as AudioClip;
  const lane = spur.takes!.filter((t) => t.art === undefined).at(-1)!;
  lane.clips.push({ ...structuredClone(haupt), id: neueId(p, 'clip') });
  pruefeGrenzen(p);
  return p;
}
export type { AudioClip };
