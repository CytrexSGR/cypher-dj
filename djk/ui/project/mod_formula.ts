// Strand 6 task 2.1: the shared modulation formula (D6). The page carries the same two functions in public/mod_display.js (= project/mod_formula.ts);
// the reference vectors are djk/contract/mod_ref.json ("versatz").

/** The offset a modulator adds to its target, in the unit of the depth: bipolar tiefe * out, unipolar tiefe * (out + 1) / 2. out is -1..1 (the
 *  core's `/zustand/mod` value before depth); the envelope follower's output is 0..1 and always unipolar, the caller maps it to -1..1 first. */
export function modVersatz(out: number, tiefe: number, uni: boolean): number {
  return uni ? tiefe * (out + 1) / 2 : tiefe * out;
}

/** The value the target takes: base plus the summed offsets, clamped once to the target range (D3, D9). */
export function modWert(basis: number, versatz: number, bereich: { min: number; max: number }): number {
  return Math.min(bereich.max, Math.max(bereich.min, basis + versatz));
}
