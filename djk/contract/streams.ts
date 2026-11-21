// Shared stream, alias and recording tables of the Baukasten instrument streams (slice S18, container core V4).
// One place for every whitelist: page server, djk-hand, djk-muster, the multi-stream erzeuger and the recording
// inputs read it. Hand-written (not generated from osc.json). Checked by tests/test_streams_table.py against
// pult_table.h (generated from pult.json). Erasable TypeScript only (constants, no enum), so .mjs files and node
// type stripping can import it.
//
// Streams are no mixer channels any more (the "stream = mixer index - 3" rule is gone). Stream n is stream buffer n
// of the core (1..16). Each container (deck/1, deck/2, pad/1, pad/2 = A..D) has its own channel strip; a stream
// reaches the console through the container that plays it. Streams 4 and 8 stay unused (the production service and
// the cue-only input); 11..16 are reserved.
//
// A3, why the BK streams announce a MIDI target: a `bk:` stream is removed by sending `bk:` with an empty name,
// which makes the core replay the stream's last stored non-bk target (net_erz.cpp). A stream that never announced
// a kit or MIDI target could not drop its graph again. midi_aus_3 and midi_aus_4 have no consumer, so a stream
// parked on them is silent: that is the "removed" state of a graph.
//
// Recording codes (`/k/rec/spur` eingang): erz/N -> 10 + N is the stream buffer of stream N. 21, 22, 23, 24 are the
// container inputs C, D, A, B (keys pad/1, pad/2, deck/1, deck/2; 21 and 22 keep their numbers, D-V10). 20 stays
// "master before the fader (later)". 14 and 18 are refused.

import { PULT_ALIAS_STROEME } from './pult.ts';

/** Stream number -> alias path of the Strudel track of that stream (page server), for every stream that can carry a
 *  Baukasten instrument graph or a pattern. The values are alias paths, not mixer channels. */
export const STROM_KANAL = {
  1: 'erz/1',
  2: 'erz/2',
  3: 'erz/3',
  5: 'erz/5',
  6: 'erz/6',
  7: 'erz/7',
  9: 'erz/9',
  10: 'erz/10',
} as const;

/** All stream numbers of STROM_KANAL, ascending. Not a copy: pult.json alias_stroeme (generated into pult.ts) is the one list. */
export const ALLE_STROEME = PULT_ALIAS_STROEME;

/** Streams that can hold a `bk:` instrument graph (stream 1 is the drum kit and cannot). */
export const INSTRUMENT_STROEME = [2, 3, 5, 6, 7, 9, 10] as const;

/** Streams served by the ONE multi-stream erzeuger process (generator_bk.mjs, a single kern subscriber slot). */
export const BK_STROEME = [5, 6, 7, 9, 10] as const;

/** MIDI target each BK stream announces at start (A3). */
export const STROM_MIDI_ZIEL = {
  5: 'midi:3:1',
  6: 'midi:3:2',
  7: 'midi:3:3',
  9: 'midi:4:1',
  10: 'midi:4:2',
} as const;

/** Recording input code of the core (`/k/rec/spur` eingang). Keys `erz/N` mean the stream buffer of stream N; keys
 *  `pad/1`, `pad/2`, `deck/1`, `deck/2` mean the container input C, D, A, B. */
export const REC_EINGANG = {
  'erz/1': 11,
  'erz/2': 12,
  'erz/3': 13,
  'erz/5': 15,
  'erz/6': 16,
  'erz/7': 17,
  'pad/1': 21,
  'pad/2': 22,
  'deck/1': 23,
  'deck/2': 24,
} as const;

/** Internal inputs a project audio track can record (A10), in the order of REC_EINGANG. */
export const INTERNE_EINGAENGE = [
  'erz/1',
  'erz/2',
  'erz/3',
  'erz/5',
  'erz/6',
  'erz/7',
  'pad/1',
  'pad/2',
  'deck/1',
  'deck/2',
] as const;

/** Alias path of a stream (erz/<n>), or null when the stream is not in the table. */
export function kanalVonStrom(strom: number): string | null {
  return (STROM_KANAL as Record<number, string>)[strom] ?? null;
}

/** Stream of an alias path, or null (erz/4, erz/8, container paths, anything unknown). */
export function stromVonKanal(kanal: string): number | null {
  for (const s of ALLE_STROEME) if ((STROM_KANAL as Record<number, string>)[s] === kanal) return s;
  return null;
}

/** True for the streams that need the multi-stream erzeuger (and whose pattern folder carries a heartbeat). */
export function istBkStrom(strom: number): boolean {
  return (BK_STROEME as readonly number[]).includes(strom);
}
