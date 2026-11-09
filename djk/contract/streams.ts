// Shared stream <-> mixer-channel table of the Baukasten instrument streams (slice S18). One place for every
// whitelist: page server, djk-hand, djk-muster, the multi-stream erzeuger and the recording inputs read it.
// Hand-written (not generated from osc.json). Checked against the kern sources by tests/test_stroeme_tabelle.py.
// Erasable TypeScript only (constants, no enum), so .mjs files and node type stripping can import it.
//
// A2, the one integer rule: stream = mixer index - 3 (mixer.h: erz/1..8 = 4..11, pad/1..2 = 12, 13). So erz/N is
// stream N and pad/1, pad/2 are streams 9 and 10. Streams 4 and 8 stay unused, like their channels (erz/4 belongs
// to the production, erz/8 is the cue-only input; the kern refuses both as stream targets).
//
// A3, why the new streams announce a MIDI target: a `bk:` stream is removed by sending `bk:` with an empty name,
// which makes the kern replay the stream's last stored non-bk target (net_erz.cpp). A stream that never announced
// a kit or MIDI target could not drop its graph again. midi_aus_3 and midi_aus_4 have no consumer, so a stream
// parked on them is silent: that is the "removed" state of a graph.
//
// A9, why the recording codes look like this: erz/N -> 10 + N, pad/N -> 20 + N. 20 stays "master before the fader
// (later)". 14 (erz/4) and 18 (erz/8) are refused. 18/19 for the pads would read as erz/8 and erz/9.

/** Stream number -> mixer channel, for every stream that can carry a Baukasten instrument graph or a pattern. */
export const STROM_KANAL = {
  1: 'erz/1',
  2: 'erz/2',
  3: 'erz/3',
  5: 'erz/5',
  6: 'erz/6',
  7: 'erz/7',
  9: 'pad/1',
  10: 'pad/2',
} as const;

/** All stream numbers of STROM_KANAL, ascending. */
export const ALLE_STROEME = [1, 2, 3, 5, 6, 7, 9, 10] as const;

/** Streams whose channel can hold a `bk:` instrument graph (erz/1 is the drum kit and cannot). */
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

/** Recording input code of the kern (`/k/rec/spur` eingang) per internal channel (A9). */
export const REC_EINGANG = {
  'erz/1': 11,
  'erz/2': 12,
  'erz/3': 13,
  'erz/5': 15,
  'erz/6': 16,
  'erz/7': 17,
  'pad/1': 21,
  'pad/2': 22,
} as const;

/** Internal channels a project audio track can record (A10), in the order of REC_EINGANG. */
export const INTERNE_EINGAENGE = ['erz/1', 'erz/2', 'erz/3', 'erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2'] as const;

/** Channel of a stream, or null when the stream is not in the table. */
export function kanalVonStrom(strom: number): string | null {
  return (STROM_KANAL as Record<number, string>)[strom] ?? null;
}

/** Stream of a channel, or null (erz/4, erz/8, decks, anything unknown). */
export function stromVonKanal(kanal: string): number | null {
  for (const s of ALLE_STROEME) if ((STROM_KANAL as Record<number, string>)[s] === kanal) return s;
  return null;
}

/** True for the streams that need the multi-stream erzeuger (and whose pattern folder carries a heartbeat). */
export function istBkStrom(strom: number): boolean {
  return (BK_STROEME as readonly number[]).includes(strom);
}
