// Server side helpers of the command audio_noten_raster (note editor slice 2, D10 and D11): the clip grid (source seconds <-> project beats, a port of
// the `raster` of public/production/notes_adapter.js) and the nearest pitch of a key for a float pitch. Pure functions, no project writes.
import { beatBeiQuelle, quellSekunde, type Marker } from './warp.ts';
import { klassen, tonartOk } from '../public/harmonie.js';
import type { AudioClip } from './model.ts';

export type ClipRaster = { hoerbarS: [number, number]; beatBeiS: (s: number) => number; sBeiBeat: (b: number) => number };

/** The grid of an audio clip: warped clips follow their markers (and `versatz_beats`),
 *  unwarped ones the project tempo and `offset_s`. Beats are project beats. */
export function clipRaster(clip: AudioClip, bpm: number): ClipRaster {
  const marker: readonly Marker[] | null = clip.warp?.an === true && Array.isArray(clip.warp.marker) && clip.warp.marker.length >= 2 ? clip.warp.marker : null;
  if (marker !== null) {
    const versatz = clip.warp?.versatz_beats ?? 0;
    return {
      hoerbarS: [quellSekunde(marker, versatz), quellSekunde(marker, versatz + clip.laenge_beats)],
      beatBeiS: (s) => clip.start_beat + beatBeiQuelle(marker, s) - versatz,
      sBeiBeat: (b) => quellSekunde(marker, b - clip.start_beat + versatz),
    };
  }
  const o = clip.offset_s ?? 0;
  return {
    hoerbarS: [o, o + (clip.laenge_beats * 60) / bpm],
    beatBeiS: (s) => clip.start_beat + ((s - o) * bpm) / 60,
    sBeiBeat: (b) => o + ((b - clip.start_beat) * 60) / bpm,
  };
}

/** The grid line nearest to beat `b` (steps of `schritt` beats from beat 0); exactly between two lines the later one (round half up) */
export const naechsteLinie = (b: number, schritt: number): number => Math.floor(b / schritt + 0.5 + 1e-9) * schritt;

type Tonart = { grundton: number; skala: string };

/** The pitch of the key nearest to the float pitch `ton` among the whole numbers within +-12 (0..127); a tie goes to the one nearer to `qton`, then down.
 * Without a key the nearest semitone. */
export function naechsteStufe(ton: number, tonart: Tonart | null | undefined, qton: number): number {
  const k = tonart && tonartOk(tonart) ? (klassen(tonart) as Set<number>) : null;
  let best = NaN, bd = Infinity;
  const mitte = Math.round(ton);
  for (let m = Math.max(0, mitte - 12); m <= Math.min(127, mitte + 12); m++) {
    if (k !== null && !k.has(((m % 12) + 12) % 12)) continue;
    const d = Math.abs(m - ton);
    const besser = d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && (Math.abs(m - qton) < Math.abs(best - qton) - 1e-9));
    if (besser) { best = m; bd = d; }
  }
  return Number.isNaN(best) ? ton : best;
}
