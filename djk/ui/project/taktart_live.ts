// The live studio counts bars of the open project's time signature n/4 (plan studio-taktart, phase 1).
// With no project open, or an invalid meter, the studio counts 4.
import { taktartOk } from './model.ts';

export const TAKT_STANDARD = 4;

// Beats per bar of a project meter value (`taktart` of the project): n of a valid [n, 4], else 4.
export function takteProLive(taktart: unknown): number {
  return taktartOk(taktart) ? (taktart as [number, number])[0] : TAKT_STANDARD;
}

// Region of new live content (SEQ pattern clips, live loop): 16 bars, so the region end is a bar line (4/4: 64 beats).
export function liveBeats(proTakt: number): number {
  return 16 * proTakt;
}
