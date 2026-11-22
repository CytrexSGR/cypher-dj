// Slice boundaries of an audio cell (session view S1b task B3, index 2.1): where the cell is cut into slots. Pure; the route
// POST /session/scheiben (areas/live/session.ts) feeds it the cell length and the transients of the source in cell beats.
import { SAMPLERATE, ZELL_SCHEIBEN_MAX, type ZellScheiben } from './model.ts';

const SCHRITT: Record<'1/16' | '1/8' | 'takt', number> = { '1/16': 0.25, '1/8': 0.5, takt: 4 };
export const SCHEIBE_MIN_ABSTAND = 0.125;   // beats: transients closer than this to the previous boundary collapse into it

// Boundaries in cell beats: strictly rising, the first is 0, all below `beats`, at most ZELL_SCHEIBEN_MAX. `transientenBeats` are cell beats
// (ascending) or null when the source is not decoded. Over the cap the closest pair merges (the right boundary goes) until 64 remain.
export function scheibenGrenzen(teilung: ZellScheiben['teilung'], beats: number, transientenBeats: number[] | null): number[] {
  const g: number[] = [0];
  if (!(beats > 0)) return g;
  if (teilung === 'transienten') {
    for (const t of transientenBeats ?? []) {
      if (typeof t === 'number' && Number.isFinite(t) && t < beats && t - g[g.length - 1] >= SCHEIBE_MIN_ABSTAND) g.push(t);
    }
  } else {
    const s = SCHRITT[teilung];
    for (let k = 1; k * s < beats; k++) g.push(k * s);
  }
  while (g.length > ZELL_SCHEIBEN_MAX) {
    let best = 1;
    for (let i = 2; i < g.length; i++) if (g[i] - g[i - 1] < g[best] - g[best - 1]) best = i;
    g.splice(best, 1);
  }
  return g;
}

// Length of a cell in beats from its decoded frames and the source tempo. One definition for the translator (a cell with slices or envelopes and no
// `beats`) and for POST /session/scheiben (an einmal cell without `beats`), so both agree on the length.
export function zellBeatsAusFrames(frames: number, bpm: number): number {
  return frames / SAMPLERATE * bpm / 60;
}
