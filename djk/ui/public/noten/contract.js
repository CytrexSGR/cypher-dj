// NOTEN (note editor, N16): the adapter contract of the host-neutral editor surface. In cypher-dj the adapter talks to the project routes; a plugin
// shell would run the same modules with an adapter to its own state. Nothing in public/noten/ imports anything outside public/noten/.
// The note shape is the A1 contract (djk/contract/notes.md, audio_noten.schema.json) used as plain objects.

/**
 * @typedef {object} AudioNote  one note of `audio_noten.liste`; seconds are source seconds, pitch is float MIDI (A4 = 69)
 * @property {string} id        `t<n>`
 * @property {number} qa        detected start
 * @property {number} qe        detected end
 * @property {number} qton      detected pitch
 * @property {number} p         level 0..1
 * @property {number} [a]       target start (absent: equal to qa)
 * @property {number} [e]       target end (absent: equal to qe)
 * @property {number} [ton]     target pitch (absent: equal to qton)
 * @property {number} [vib]     vibrato factor 0..4 (absent: 1, as sung)
 * @property {number} [drift]   drift factor 0..4 (absent: 1, as sung)
 */

/**
 * @typedef {object} Sicht  everything the surface reads, in one object (read again at every redraw and every gesture)
 * @property {number} quelleS                         length of the source in seconds
 * @property {[number, number]} hoerbarS              audible range of the clip in source seconds
 * @property {AudioNote[]} noten                      the clip's list (empty when nothing was found)
 * @property {{ hopS: number, ct: ArrayLike<number> } | null} kurve   detected pitch in cents (MIDI * 100, 0 = unvoiced), one value per hop
 * @property {{ hole(s0: number, s1: number, n: number): [number, number][] } | null} welle   n (min, max) pairs in -1..1 over [s0, s1]
 * @property {{ beatBeiS(s: number): number, sBeiBeat(b: number): number, beatsProTakt: number } | null} raster   beat grid of the clip
 * @property {number} [staerke]                    strength of quantise and snap, 0..1 (absent: 1)
 * @property {((ton: number) => number) | null} rasteTonart   nearest tone of the project key for a whole MIDI pitch, null without a key
 * @property {{ zustand: string, text?: string }} render
 * @property {{ zustand: string, prozent?: number, text?: string } | null} analyse
 */

/**
 * @typedef {{ art: 'ton', ids: string[], um: number }
 *   | { art: 'zeit', ids: string[], um_s: number }
 *   | { art: 'kante', id: string, a?: number, e?: number }
 *   | { art: 'raster', ids?: string[], zeit?: string, ton?: 'halbton' | 'tonart', staerke: number }
 *   | { art: 'form', ids: string[], vib?: number, drift?: number }
 *   | { art: 'zuruecksetzen', ids?: string[] }
 *   | { art: 'erkennen', neu?: boolean }
 *   | { art: 'abbrechen' }
 *   | { art: 'entfernen' }} Op   the writes of the surface; `um` is a pitch shift in semitones added to every listed note's current target, `um_s` a time shift in seconds, `form` sets the factor of the vibrato (`vib`) and/or the drift 0..4 of the listed notes (1 = as sung), `raster` quantises starts to the raster id `zeit` and/or snaps pitch (`ton`) at `staerke`, `a` / `e` an absolute edge in source seconds
 */

/**
 * @typedef {object} Adapter  N16: the ONE object the surface reads and writes through
 * @property {() => Sicht} lies
 * @property {(op: Op) => Promise<{ ok: true } | { ok: false, grund: string, text: string }>} schreibe
 * @property {(f: () => void) => (() => void)} abonniere   calls `f` after every change of what `lies` returns; returns the unsubscribe function
 */

const MEMBER = ['lies', 'schreibe', 'abonniere'];

/** Names of the adapter members that are missing or not functions (empty array: the adapter is complete). */
export function pruefeAdapter(a) {
  if (a === null || typeof a !== 'object') return [...MEMBER];
  return MEMBER.filter((n) => typeof a[n] !== 'function');
}
