// 1.14 comping (spec R6): which main-lane clip is a copy of a take-lane clip. Pure functions, no project access.
// Page mirror in public/production/takes.js (branch comping-seite); tests/project_comping_takes.test.mjs runs this side on the shared fixtures.
import { isDeepStrictEqual } from 'node:util';
import type { AudioClip, MidiClip } from './model.ts';

export const TAKE_KOPIE_EPS = 1e-6;   // beats, spec R6 (splits round to 1e-9 per step)

// A warp counts only while it is switched on; a clip with `warp.an === false` is an unwarped clip.
const warpAn = (c: AudioClip): NonNullable<AudioClip['warp']> | null => (c.warp && c.warp.an ? c.warp : null);

// True when `main` plays the same material as `take` at the same place on the take's own timeline: same sha, and
// main.start_beat - take.start_beat equals the shift of the content (offset_s in beats, or versatz_beats for warped clips).
// Warped clips need equal markers; a warp on one side only is no copy; loop clips never count. Ranges are not compared here.
export function istTakeKopie(main: AudioClip, take: AudioClip, bpm: number): boolean {
  if (main?.art !== 'audio' || take?.art !== 'audio') return false;
  if (main.quelle?.sha256 !== take.quelle?.sha256) return false;
  if (main.loop_beats != null || take.loop_beats != null) return false;
  const abstand = main.start_beat - take.start_beat;
  const wm = warpAn(main), wt = warpAn(take);
  if ((wm === null) !== (wt === null)) return false;
  if (wm && wt) {
    return JSON.stringify(wm.marker) === JSON.stringify(wt.marker) && Math.abs(abstand - (wm.versatz_beats - wt.versatz_beats)) <= TAKE_KOPIE_EPS;
  }
  return Math.abs(abstand - ((main.offset_s - take.offset_s) * bpm) / 60) <= TAKE_KOPIE_EPS;
}

// Fields the no-op rule of comp_waehlen does not compare: the identity, the timeline (checked by istTakeKopie through the R6 relation), the fades
// (they belong to the cut), name and entstehung (labels, not sound), the source (sha is checked by istTakeKopie, the path hint is only a hint)
// and the derived decode state.
const ZEIT_FELDER: ReadonlySet<string> = new Set(
  ['id', 'name', 'entstehung', 'start_beat', 'laenge_beats', 'offset_s', 'fade_ein_beats', 'fade_aus_beats',
    'quelle', 'dekodiert', 'warp']);

// A copy that also sounds the same: istTakeKopie plus every other field of the clip (stumm, gain_db, and whatever AudioClip
// gets later) equal, and for warped clips every warp field except versatz_beats (istTakeKopie decides that one).
export function klingtGleich(main: AudioClip, take: AudioClip, bpm: number): boolean {
  if (!istTakeKopie(main, take, bpm)) return false;
  const rest = (c: AudioClip): Record<string, unknown> => Object.fromEntries(Object.entries(c).filter(([k]) => !ZEIT_FELDER.has(k)));
  if (!isDeepStrictEqual(rest(main), rest(take))) return false;
  const wm = warpAn(main), wt = warpAn(take);
  return wm === null || wt === null || isDeepStrictEqual({ ...wm, versatz_beats: 0 }, { ...wt, versatz_beats: 0 });
}

// Strand 7 (D10): MIDI takes. Notes as absolute tuples [beat, ton, vel, laenge], sorted. A loop clip is unrolled over its span.
export type AbsNote = [number, number, number, number];
export function absoluteNoten(c: MidiClip): AbsNote[] {
  const aus: AbsNote[] = [];
  const ende = c.start_beat + c.laenge_beats;
  const l = c.loop_beats ?? null;
  for (let k = 0; ; k++) {
    const schub = l === null ? 0 : k * l;
    if (l === null ? k > 0 : schub >= c.laenge_beats - 1e-9) break;
    for (const n of c.noten) {
      const b = c.start_beat + schub + n.beat;
      if (n.beat >= (l ?? c.laenge_beats) - 1e-9 || b >= ende - 1e-9) continue;
      aus.push([b, n.ton, n.vel, n.laenge]);
    }
  }
  return aus;
}
const nachNote = (a: AbsNote, b: AbsNote): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3];
// The notes of `clips` with onset in [von, bis), lengths cut at `bis` (and at the end of their own clip), sorted
export function notenImBereich(clips: readonly MidiClip[], von: number, bis: number): AbsNote[] {
  const aus: AbsNote[] = [];
  for (const c of clips) {
    const ende = Math.min(bis, c.start_beat + c.laenge_beats);
    for (const [b, ton, vel, laenge] of absoluteNoten(c)) {
      if (b >= von - 1e-9 && b < bis - 1e-9) aus.push([b, ton, vel, Math.min(laenge, ende - b)]);
    }
  }
  return aus.sort(nachNote);
}
export const notenGleich = (x: readonly AbsNote[], y: readonly AbsNote[]): boolean =>
  x.length === y.length && x.every((a, i) => a.every((v, k) => Math.abs(v - y[i][k]) <= TAKE_KOPIE_EPS));

// True when the main clip holds, over its own span, the same absolute notes the take holds there (beat, ton, vel, laenge; lengths cut at the
// end of the main clip). Used for the page highlight; ids, names and envelopes are not compared.
export function istMidiTakeKopie(main: MidiClip, take: MidiClip): boolean {
  if (main?.art !== 'midi' || take?.art !== 'midi') return false;
  const von = main.start_beat, bis = main.start_beat + main.laenge_beats;
  return notenGleich(notenImBereich([main], von, bis), notenImBereich([take], von, bis));
}
