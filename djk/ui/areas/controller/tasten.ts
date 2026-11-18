// Keys follow the focus (plan addendum N1). The MIDI keys of every `midi_ein` place play the project tracks whose MIDI arm is set in the core
// (core/src/core_hand.cpp, Arrangement::live_note). The track in front gets that arm as SESSION state of the page server: it is never project
// data (no revision, no undo entry, nothing in the project file) and the owner's own arms stay untouched. The controller area (sequences.ts) decides
// the track and puts it into the TastenArm; the reconciler of the recording area (proj/recording.ts) reads it and sends /k/rec/spur for it.
import { WIRT_SLOTS, type Spur } from '../../project/model.ts';

export interface TastenArm {
  /** The id of the project track that holds the focus arm, or null. */
  spur(): string | null;
  /** Names the track (or null: none). Listeners are called when the value changed. */
  setze(id: string | null): void;
  /** The reconciler registers here to be told about a change. */
  beiAenderung(f: () => void): void;
}

export function neuerTastenArm(): TastenArm {
  let id: string | null = null;
  const hoerer: (() => void)[] = [];
  return {
    spur: () => id,
    setze(neu) { if (neu === id) return; id = neu; for (const f of hoerer) f(); },
    beiAenderung(f) { hoerer.push(f); },
  };
}

/**
 * Whether the core has a note sink for the track, so that a live note plays something. Mirrors `Arrangement::senke_fuer` (core/src/arr_notes.cpp):
 * an internal device (Baukasten bk, kit, rb338) and a rack have a sink, a host track only with a slot 1..WIRT_SLOTS, an audio track none.
 */
export function tastenSenke(spur: Pick<Spur, 'art' | 'geraet'>): boolean {
  if (spur.art !== 'instrument' || !spur.geraet) return false;
  const g = spur.geraet;
  if (g.art === 'intern' || g.art === 'rack') return true;
  return g.art === 'wirt' && Number.isInteger(g.slot) && g.slot >= 1 && g.slot <= WIRT_SLOTS;
}
