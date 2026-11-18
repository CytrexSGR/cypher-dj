// What a learn table entry can drive, and how. Three kinds of target:
//  - 'regler': a continuous control (a fader, a knob, a graph knob bk/1..64): driven by a CC with art "absolut" (the capture flow learns these);
//  - 'schalter': a switch of the control table (kill, PFL, mute ...): driven by a button or pad with art "taste", a press toggles it;
//  - 'aktion': a deck action (play, cue): driven by a button or pad with art "taste", a press starts it, the release is passed on.
// The kern loader (djk/core/hand/src/mapping.cpp) takes the same strings and the same art per kind: art_passt lines 152-187.
// Deck actions: the loader also accepts loop, loop_laenge, sprung_plus, sprung_minus, nudge, tap, slip, laden, hotcue/1..8, hotcue_setzen/1..8 and
// roll/<beats>, but the kern only EXECUTES play and cue (djk/core/src/core_hand.cpp, hand_aktion, lines 194-200: every other deck action is
// counted as "ohne Wirkung"). Offering them would give a button that does nothing, so only play and cue are assignable; the rest joins
// AKTIONEN when the kern implements it.
import { reglerInfo } from '../../../conductor/src/controls_info.ts';
import { PFAD } from '../../hand_operation.ts';

export type ZielArt = 'regler' | 'schalter' | 'aktion';
export type NachrichtTyp = 'cc' | 'note';
export type EintragsArt = 'absolut' | 'taste';

/** Deck actions the kern executes, with the name a person reads. */
export const AKTIONEN: readonly { name: string; text: string }[] = [{ name: 'play', text: 'Play' }, { name: 'cue', text: 'Cue' }];
/** deck/1/play, deck/1/cue, deck/2/play ... in this order. */
export const AKTIONS_PFADE: readonly string[] = [1, 2, 3, 4].flatMap((d) => AKTIONEN.map((a) => `deck/${d}/${a.name}`));
const AKTIONS_MENGE = new Set(AKTIONS_PFADE);
const KNOPF = /\/bk\/([1-9]|[1-5][0-9]|6[0-4])$/;

/** The kind of a target path, or null when it is none of the three (unknown path, a graph knob outside bk/1..64, an action the kern does not run). */
export function zielArt(p: unknown): ZielArt | null {
  if (typeof p !== 'string') return null;
  if (PFAD.test(p) && KNOPF.test(p)) return 'regler';
  const i = reglerInfo(p);
  if (i) return i.einheit === 'schalter' ? 'schalter' : 'regler';
  return AKTIONS_MENGE.has(p) ? 'aktion' : null;
}

/**
 * The art an entry needs for this target and message, or null when the pair cannot be driven: a continuous target is a CC with "absolut";
 * a switch or action is driven by a press (CC value >= 64, or a note on) with "taste". A note on a continuous target has no value to give.
 */
export function eintragsArt(art: ZielArt, typ: NachrichtTyp): EintragsArt | null {
  if (art === 'regler') return typ === 'cc' ? 'absolut' : null;
  return 'taste';
}
