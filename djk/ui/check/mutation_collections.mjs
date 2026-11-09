// Mutation probe of package 1.16 rest U4 (T4.6): collections store and routes. One mutant per rule; the named test must turn red, then the
// file is restored. Usage: node check/mutation_collections.mjs [--nur doppelt_erlaubt,...]
import { fuehreAus } from './mutation_run.mjs';

const S = 'collections/store.ts', B = 'collections/area.ts';
const TS = 'tests/collections_store.test.mjs', TB = 'tests/collections_area.test.mjs';
const REGEL = "quelle === 'cypher' && !(alt !== null && alt.autor === 'cypher')";

export const MUTANTEN = [
  { name: 'doppelt_erlaubt', test: TS, erwartet: 'store: create, add mixed items', datei: S,
    alt: 'if (!da.has(s)) { da.add(s); posten.push(x); }', neu: 'posten.push(x);', was: 'an item already there is added again' },
  { name: 'rechte_aus', test: TS, erwartet: 'rights (K2)', datei: S, alt: REGEL, neu: 'false', was: 'the Cypher check never refuses' },
  { name: 'kaputt_ist_frei', test: TS, erwartet: 'rights (K2)', datei: S, alt: REGEL, neu: "quelle === 'cypher' && alt !== null && alt.autor !== 'cypher'",
    was: 'an unreadable file counts as free for Cypher' },
  { name: 'nicht_atomar', test: TS, erwartet: 'atomic write', datei: S,
    alt: 'const tmp = this.temp(p, k);\n    try { fs.renameSync(tmp, p); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }',
    neu: "fs.writeFileSync(p, JSON.stringify(k, null, 1) + '\\n');", was: 'the file is written in place instead of temp + rename' },
  { name: 'prefix_offen', test: TB, erwartet: 'routes: one Bereich kollektionen', datei: B,
    alt: "p === '/kollektionen' || p.startsWith('/kollektionen/')", neu: "p.startsWith('/kollektionen')", was: 'the prefix also takes /kollektionenx' },
  { name: 'umbenennen_behaelt_marke', test: TS, erwartet: 'rename by Andreas takes the Cypher mark', datei: S,
    alt: "...(quelle === 'cypher' && _a === 'cypher' ? { autor: 'cypher' as const } : {})", neu: '...(_a ? { autor: _a } : {})',
    was: 'a rename by Andreas keeps the Cypher mark (the old copy of autor)' },
];

process.exit(fuehreAus(MUTANTEN) ? 1 : 0);
