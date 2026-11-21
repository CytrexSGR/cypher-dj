// The page's channel catalogue (container core, lane U). The only page module besides pult.js that may name a container path or an erz alias
// as a literal. Every list is derived from the generated pult module (contract/pult.json), so a copy cannot drift. Leaf module: imports only pult.js.
import {
  pultContainerPfad, pultContainerPlayer, pultBusPfad, PULT_ALIAS_STROEME, pultAliasSuffixe, pultMixIndex, containerVonPfad,
} from './pult.js';

const BUCHSTABEN = ['A', 'B', 'C', 'D'];

/** The four containers (places) A..D: path of the channel strip, player (deck identity) and place number. */
export const CONTAINER = pultContainerPfad.map((pfad, i) => ({ id: BUCHSTABEN[i], pfad, player: pultContainerPlayer[i], platz: i + 1 }));
export const BUSSE = pultBusPfad;
/** The stream numbers a Strudel module may carry (the alias streams of pult.json). */
export const STROEME = PULT_ALIAS_STROEME;
/** The control suffixes of an `erz/<n>` alias onto the Strudel track of stream n. */
export const ALIAS_SUFFIXE = pultAliasSuffixe;

/** Path of the player (deck identity) n: `deck/<n>`, the base of transport, hot cue and loop rows. A player is not a strip: strips are the containers. */
export const playerKanal = (n) => `deck/${n}`;
/** Letter of the container whose strip is `pfad` (or a control below it), else null. */
export function containerName(pfad) { const p = containerVonPfad(pfad); return p ? CONTAINER[p - 1].id : null; }
/** Place 1..4 of a container path (or a control below it), else null. */
export const platzVonPfad = (pfad) => containerVonPfad(pfad);
export function pfadVonPlatz(platz) {
  if (!Number.isInteger(platz) || platz < 1 || platz > CONTAINER.length) throw new RangeError(`place ${platz}: 1..${CONTAINER.length}`);
  return CONTAINER[platz - 1].pfad;
}
/** The alias base of stream n: `erz/<n>` (resolved to the Strudel track by the page server). */
export const stromKanal = (n) => `erz/${n}`;
/** Stream number of an alias base `erz/<n>` of the stream list, else null. */
export function stromVonKanal(kanal) {
  const m = /^erz\/(\d+)$/.exec(kanal ?? '');
  const n = m ? Number(m[1]) : null;
  return n !== null && STROEME.includes(n) ? n : null;
}
/** Wire index of a strip (containers 0..3, buses 4..7, master 8): komp/sc and gate/sc are index + 1, the spectrum selector too. */
export const fxIndex = (pfad) => pultMixIndex(pfad);
/** Tabs of the effects panel: MASTER, the containers, SENDS, BUS. */
export const fxReiter = () => [{ id: 'master', text: 'MASTER' }, ...CONTAINER.map((c) => ({ id: c.pfad, text: c.id })), { id: 'sends', text: 'SENDS' }, { id: 'bus', text: 'BUS' }];
/** Channels that take a graph knob row `<kanal>/bk/<k>`: the containers (effect graph) and the stream aliases that take an instrument. */
export const bkKanaele = () => [...CONTAINER.map((c) => c.pfad), ...STROEME.map(stromKanal)];

// ---- the Strudel module rows (U5): pure, no DOM ----
const STROM_NAMEN = { 1: 'DRUMS', 2: 'BASS', 3: 'MELODY' };
/** Name of a stream row: the three default roles keep their names, every other stream is `S<n>`. */
export const stromName = (n) => STROM_NAMEN[n] ?? `S${n}`;
/** Streams a module shows: 1, 2, 3 as defaults, every `strom` track of the strudel group, and the streams opened by hand (`extra`), ascending. */
export function stromListe(projekt, extra = []) {
  const gruppen = new Set((projekt?.gruppen ?? []).filter((g) => g.strudel).map((g) => g.id));
  const aus = new Set([1, 2, 3, ...extra]);
  for (const s of projekt?.spuren ?? []) if (s.art === 'strom' && Number.isInteger(s.strom) && gruppen.has(s.gruppe)) aus.add(s.strom);
  return [...aus].sort((a, b) => a - b);
}
/** The `strom` track of stream n in the strudel group, or null. */
export function stromSpur(projekt, n) {
  const gruppen = new Set((projekt?.gruppen ?? []).filter((g) => g.strudel).map((g) => g.id));
  return (projekt?.spuren ?? []).find((s) => s.art === 'strom' && s.strom === n && gruppen.has(s.gruppe)) ?? null;
}
/** The read mirror carries the mixer rows of a stream that has a generator; none, no generator (silent). */
export const hatErzeuger = (regler, n) => ['fader', 'pegel'].some((t) => Number.isFinite(regler?.[`${stromKanal(n)}/${t}`]));
/** The internal inputs a project audio track can record, in the order of INTERNE_EINGAENGE (contract/streams.ts; tests/proj_inputs_s18.test.mjs binds the
 *  two): the stream buffers of streams 1..7 that have a tap (the streams 9 and 10 have none), the loop containers C, D, then the players A, B. */
export const recEingaenge = () => [
  ...STROEME.filter((n) => n <= 7).map((n) => ({ wert: stromKanal(n), text: n > 3 ? `${stromKanal(n)} (bk)` : stromKanal(n) })),
  ...CONTAINER.filter((c) => c.player > 2).map((c) => ({ wert: c.pfad, text: `${c.pfad} (L${c.player - 2})` })),
  ...CONTAINER.filter((c) => c.player <= 2).map((c) => ({ wert: c.pfad, text: `${c.pfad} (${c.id})` })),
];
