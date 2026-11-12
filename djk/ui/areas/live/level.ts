// Plan live-module, final round: the level offset of a new instrument path. The new Drums/Bass tracks come out of the Baukasten instruments much louder than
// the stem they replace (measured: +13 dB rms for Bastille Drums at the same fader), so a blend from 0 to 1 would jump. After the MIDI is built, the original
// track and the new track are each rendered alone, offline, in a child process of the render program (cypherdj-render, nice 19, the way merge renders: the
// tracks at 0 dB and centred, the groups neutral) and their rms is compared. The difference is stored as `neu_trim_db` on the stem group.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { instanz as instanzVorgabe, renderProgramm } from '../../paths.ts';
import { mergeRegler, mergeWiedergabe } from '../../project/merge.ts';
import { rendere } from '../../project/render.ts';
import { NEU_TRIM_MAX, NEU_TRIM_MIN, type Projekt } from '../../project/model.ts';
import type { ProjZugang } from '../proj/area.ts';

// rms in dB (full scale) of one track rendered alone at 0 dB; throws when the render fails
export type PegelMesser = (p: Projekt, spurId: string) => Promise<number>;
const STILLE_DB = -80;                // below this a track has no level to compare (a silent stem, a failed instrument)

// rms in dB of a WAV file (float32 or 16 bit PCM, all channels together)
export function rmsDbVonWav(datei: string): number {
  const b = fs.readFileSync(datei);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let fmt = 0, bits = 0, daten: Buffer | null = null;
  for (let o = 12; o + 8 <= b.length;) {
    const id = b.toString('ascii', o, o + 4), n = b.readUInt32LE(o + 4);
    if (id === 'fmt ') { fmt = b.readUInt16LE(o + 8); bits = b.readUInt16LE(o + 22); }
    if (id === 'data') { daten = b.subarray(o + 8, Math.min(b.length, o + 8 + n)); break; }
    o += 8 + n + (n % 2);
  }
  if (!daten || !((fmt === 3 && bits === 32) || (fmt === 1 && bits === 16))) throw new Error(`WAV format ${fmt}/${bits} is not supported`);
  const breite = bits / 8, anzahl = Math.floor(daten.length / breite);
  let s = 0;
  for (let i = 0; i < anzahl; i++) {
    const v = fmt === 3 ? daten.readFloatLE(i * 4) : daten.readInt16LE(i * 2) / 32768;
    s += v * v;
  }
  return anzahl === 0 ? -200 : 10 * Math.log10(Math.max(s / anzahl, 1e-20));
}

export interface PegelOptionen {
  programm?: () => string[]; instanz?: () => string; vonBeat?: number; bisBeat?: number; zeitlimitMs?: number;
}
// The real measure: one offline render per track through the same path as the merge (the instance's arrangement folder, a numbered playback file)
export function renderPegelMesser(zugang: Pick<ProjZugang, 'schreibeWiedergabe' | 'arbeitsordner'>, o: PegelOptionen = {}): PegelMesser {
  return async (p, spurId) => {
    const q = structuredClone(p);
    const s = q.spuren.find((x) => x.id === spurId);
    if (!s) throw new Error(`track ${spurId} is not in the project`);
    s.fader_db = 0; s.pan = 0; s.mute = false; s.solo = false;
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'cdj-pegel-'));
    const aus = path.join(ordner, 'pegel.wav'), regler = path.join(ordner, 'regler.json');
    let w: { nr: number; datei: string } | null = null;
    try {
      w = zugang.schreibeWiedergabe(mergeWiedergabe(q, [spurId]));
      fs.writeFileSync(regler, JSON.stringify(mergeRegler(q, [spurId])));
      const von = o.vonBeat ?? 0, bis = o.bisBeat ?? 32;
      await rendere({ programm: (o.programm ?? (() => [renderProgramm()]))(), nr: w.nr, von_beat: von, bis_beat: bis, bpm: q.tempo_bpm, aus,
        arbeitsordner: zugang.arbeitsordner(), spurRegler: regler, ohneZustand: true, instanz: (o.instanz ?? instanzVorgabe)(),
        zeitlimitMs: o.zeitlimitMs ?? Math.ceil(4 * (bis - von) * 60_000 / q.tempo_bpm) + 60_000, abgriff: 'produktion' });
      return rmsDbVonWav(aus);
    } finally {
      if (w) fs.rmSync(w.datei, { force: true });
      fs.rmSync(ordner, { recursive: true, force: true });
    }
  };
}

// The offset of the new path for one stem: original rms minus new rms in dB (0.1 dB steps), capped to the model's range. Throws with the reason when a
// track is silent or the render fails.
export async function pegelVersatz(mess: PegelMesser, p: Projekt, originalId: string, neuId: string): Promise<number> {
  const orig = await mess(p, originalId), neu = await mess(p, neuId);
  if (orig < STILLE_DB) throw new Error(`the original stem is silent (${orig.toFixed(1)} dB)`);
  if (neu < STILLE_DB) throw new Error(`the new path is silent (${neu.toFixed(1)} dB)`);
  return Math.min(NEU_TRIM_MAX, Math.max(NEU_TRIM_MIN, Math.round((orig - neu) * 10) / 10));
}
