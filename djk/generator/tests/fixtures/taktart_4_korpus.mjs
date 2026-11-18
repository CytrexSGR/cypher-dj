// Corpus of the 4/4 golden (plan studio-taktart T1): patterns, kits, windows and the two helpers that turn the code under test into JSON.
import { kompiliere } from '../../src/compile.mjs';
import { ereignisse } from '../../src/window.mjs';
import { Planer } from '../../src/planner.mjs';

export const KIT = { name: 't', note: new Map([['bd:0', 0], ['hh:0', 1], ['hh:1', 2]]), bank: new Map([['bd', 1], ['hh', 2]]) };
export const MIDI = { midi: true };

export const KORPUS = [
  ['s("bd*4")', KIT], ['s("bd hh")', KIT], ['note("c3 e3 g3 b3")', MIDI], ['s("bd*4").slow(2)', KIT],
  ['stack(s("bd*4"), s("hh*8"))', KIT], ['silence', KIT], ['s("bd ~ ~ bd").fast(2)', KIT], ['note("[c3,e3,g3]")', MIDI],
  ['note("c3 e3").slow(3)', MIDI], ['note("c3@3 e3")', MIDI], ['s("hh*16").gain(0.5)', KIT], ['s("bd:0 hh:1")', KIT],
];
export const FENSTER = [[0, 4], [4, 12], [10.5, 21]];
export const PLANER_MUSTER = [0, 4];   // indices into KORPUS whose Planer.takt(0..3) bundles are recorded

export function fensterAusgabe() {
  return KORPUS.map(([text, kit]) => {
    const muster = kompiliere(text).muster;
    return { text, fenster: FENSTER.map(([a, b]) => {
      const r = ereignisse([{ ab: 0, muster, nr: 1 }], kit, a, b);
      return { a, b, evs: r.evs, unbekannt: [...r.unbekannt], felder: [...r.felder] };
    }) };
  });
}

export function planerAusgabe(neu = (o) => new Planer(o)) {
  return PLANER_MUSTER.map((i) => {
    const [text, kit] = KORPUS[i];
    const bundles = [];
    const p = neu({ strom: 1, kit, sende: (b) => bundles.push(b.toString('hex')), jetztUs: () => 0 });
    p.setze(kompiliere(text).muster, -Infinity);
    for (let n = 0; n < 4; n++) p.takt(n);
    return { text, bundles };
  });
}
