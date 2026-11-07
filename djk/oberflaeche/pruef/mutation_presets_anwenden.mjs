// Mutation probe of package 1.16 rest U3a (T3a.6): the rb338 mapping and the apply plan. One mutant per rule; the named test must turn
// red, then the file is restored. Usage: node pruef/mutation_presets_anwenden.mjs [--nur rb_faktor_falsch,...]
import { fuehreAus } from './mutation_lauf.mjs';

const A = 'presets/anwenden.ts', R = 'projekt/rb_abbildung.ts', T = 'tests/presets_anwenden.test.mjs';

export const MUTANTEN = [
  { name: 'rb_faktor_falsch', test: T, erwartet: 'rb338 mapping: plain → normalised', datei: R,
    alt: 'return d.art === \'linear\' ? lin : lin ** d.faktor;', neu: 'return d.art === \'linear\' ? lin : lin ** (1 / d.faktor);',
    was: 'the Schief exponent of rbNorm is inverted' },
  { name: 'extsc_still', test: T, erwartet: 'plan: komp preset on a komp stage', datei: A,
    alt: 'if (!q) { uebersprungen.push(name); continue; }', neu: 'if (!q) continue;',
    was: 'a parameter without an insert row is dropped silently' },
  { name: 'hall_erlaubt', test: T, erwartet: 'plan: refusals', datei: A,
    alt: "if (g.id === 'hall') throw new PresetFehler(409, 'kein_ziel');", neu: '',
    was: 'a hall preset is not refused' },
  { name: 'aktiv_ignoriert', test: T, erwartet: 'plan: refusals', datei: A,
    alt: "if (!(INSERT_ARTEN_AKTIV as readonly string[]).includes(art)) throw new PresetFehler(409, 'art_nicht_aktiv');\n    if (t.insert.art !== art)",
    neu: 'if (t.insert.art !== art)',
    was: 'an eq preset on an insert passes the active-kind check' },
  { name: 'graph_egal', test: T, erwartet: 'plan: baukasten preset on a bk track', datei: A,
    alt: "if (alt.graph !== preset.graph) throw new PresetFehler(409, 'graph_anders');", neu: '',
    was: 'a bk preset of another graph is applied' },
  { name: 'freeze_still', test: T, erwartet: 'plan: freeze_geht', datei: A,
    alt: "? ['freeze_geht'] : undefined;", neu: '? undefined : undefined;',
    was: 'hinweise is never set' },
];

process.exit(fuehreAus(MUTANTEN) ? 1 : 0);
