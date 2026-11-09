// Mutation probe of package 1.16 rest U1 (T1.6): Cypher's preset rights, the author mark and the Baukasten graph. One mutant per
// rule; the named test must turn red, then the file is restored. Usage: node check/mutation_presets_rights.mjs [--nur rechte_aus,...]
import { fuehreAus } from './mutation_run.mjs';

const S = 'presets/store.ts', M = 'presets/model.ts';
const BEREICH = 'tests/presets_area.test.mjs', SPEICHER = 'tests/presets_store.test.mjs';

export const MUTANTEN = [
  { name: 'rechte_aus', test: BEREICH, erwartet: 'rights: Cypher overwriting, renaming or deleting an unmarked preset', datei: S,
    alt: "quelle === 'cypher' && !(alt !== null && alt.autor === 'cypher')", neu: 'false',
    was: 'the Cypher check never refuses' },
  { name: 'kaputt_ist_frei', test: BEREICH, erwartet: 'rights: a damaged unmarked file', datei: S,
    alt: "quelle === 'cypher' && !(alt !== null && alt.autor === 'cypher')", neu: "quelle === 'cypher' && alt !== null && alt.autor !== 'cypher'",
    was: 'an unreadable file passes the rule (alt null counts as free)' },
  { name: 'loesche_ohne_lesen', test: SPEICHER, erwartet: 'rights in the store', datei: S,
    alt: "try { alt = this.lies('nutzer', g, slug); } catch (x) { if (!(x instanceof PresetFehler) || x.code !== 409) throw x; }", neu: '',
    was: 'loesche does not read the file, so the mark is never seen' },
  { name: 'autor_nie', test: SPEICHER, erwartet: 'author mark: a save by Cypher writes autor cypher', datei: S,
    alt: "...(quelle === 'cypher' ? { autor: 'cypher' as const } : {}), angelegt", neu: 'angelegt',
    was: 'the author mark is never written' },
  { name: 'graph_egal', test: SPEICHER, erwartet: 'baukasten graph: required for baukasten', datei: M,
    alt: "if (roh === undefined) throw new PresetFehler(400, 'graph_fehlt');", neu: 'if (roh === undefined) return {};',
    was: 'a Baukasten preset without graph is accepted' },
  { name: 'umbenennen_behaelt_marke', test: SPEICHER, erwartet: 'rename by Andreas takes the Cypher mark', datei: S,
    alt: "...(quelle === 'cypher' && p.autor === 'cypher' ? { autor: 'cypher' as const } : {}), name: n", neu: "...(p.autor ? { autor: p.autor } : {}), name: n",
    was: 'a rename by Andreas keeps the Cypher mark (the old copy of autor)' },
];

process.exit(fuehreAus(MUTANTEN) ? 1 : 0);
