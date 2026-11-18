// SEQ scenes: the bar target of a scene launch. taktBeats() is the ONE bar length of the scene code (it follows the open project's meter n/4, card t_d0a9ccbe).
import { vorlaufBeats } from '../../tempo_ramp.ts';
import { takteProLive } from '../../project/taktart_live.ts';

export const taktBeats = (taktart?: unknown): number => takteProLive(taktart);

export interface ZielEingang {
  kBeat: number;      // the CURRENT core beat (newest /uhr)
  offset: number;     // core beat minus project beat, from one same-block pair of /uhr and /zustand/arr
  bpm: number;
  loopVon: number;    // project beats
  loopBis: number;
  loopAn: boolean;
  laeuft: boolean;    // the arrangement plays
  taktart?: unknown;  // the open project's [n, 4]; absent or invalid = 4
}

const EPS = 1e-9;

// The CORE beat of the next project bar that is at least vorlaufBeats(bpm) ahead of kBeat; null = the transport does not play (apply at once).
// Seam rule: a bar target behind the loop end becomes the loop end itself when the loop length is not a whole number of bars (the bar grid
// shifts after the seam); with a whole-bar loop the grid carries over and the target stays (the core beat K is continuous over the seam).
export function szenenZielBeat(p: ZielEingang): number | null {
  if (!p.laeuft) return null;
  const takt = taktBeats(p.taktart);
  const frueh = p.kBeat + vorlaufBeats(p.bpm) - p.offset;          // earliest safe project beat, as if there were no seam
  let ziel = Math.ceil(frueh / takt - EPS) * takt;
  if (p.loopAn && ziel > p.loopBis + EPS && frueh <= p.loopBis + EPS) {
    const laenge = p.loopBis - p.loopVon, rest = laenge / takt;
    if (Math.abs(rest - Math.round(rest)) > EPS) ziel = p.loopBis;
  }
  return ziel + p.offset;
}
