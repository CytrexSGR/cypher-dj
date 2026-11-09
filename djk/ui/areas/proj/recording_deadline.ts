// 1.8 S4b.1a (D7, D8): how long the server waits for the receipts of a recording start that does not answer at once.
// A count-in of N bars, the quant of the transport start and the wait for the next bar of a running transport all delay receipt 2 (the entry). The default
// wait of warteQuittung (400 ms, at most 4 s) is shorter than that for 2 or 4 bars at 120 BPM, so the horizon is computed from what the core was asked to do.
// With count-in 0 in a stopped transport (the slice 1 path) the caller does not use this function at all and every call stays as it was.
export interface FristAngabe {
  bpm: number;                     // tempo the start runs at
  quant: 0 | 1 | 2;                // quant of the transport start: 0 at once, 1 next beat, 2 next bar
  vorzaehlerTakte: number;         // count-in in bars (0, 1, 2, 4); the caller passes 0 for a running start (the core ignores it, D7)
  laufend: boolean;                // the take starts inside a running transport
  loopBeats: number | null;        // length of the loop brace when it is on, else null
}
const QUANT_BEATS = [0, 1, 4] as const;
const REST_MS = 4000;              // transport and receipt path, as the old fixed cap
export function quittungsFristMs(a: FristAngabe): number {
  // running: the next bar is at most 4 beats away; with the loop brace on the bar may lie behind the seam, then the take waits for the seam of the next pass
  const laufendBeats = !a.laufend ? 0 : a.loopBeats === null ? 4 : 4 + a.loopBeats;
  return (QUANT_BEATS[a.quant] + 4 * a.vorzaehlerTakte + laufendBeats) * 60000 / a.bpm + REST_MS;
}
