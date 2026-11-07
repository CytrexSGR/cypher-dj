// Mutation probe of package 1.16 rest U3b (T3b.1, T3b.2): the page channel path and the plan consumer. One mutant per rule; the named
// test must turn red, then the file is restored. Usage: node pruef/mutation_b116_seite.mjs [--nur kern_komp_falsch,...]
import { fuehreAus } from './mutation_lauf.mjs';

const P = 'oeffentlich/presets.js', A = 'oeffentlich/app.js', TW = 'tests/seite_werkzeuge.test.mjs', S = 'pruef/b116_senden.mjs', TP = 'tests/presets_seite.test.mjs', TS = 'tests/b116_senden.test.mjs';

export const MUTANTEN = [
  { name: 'kern_komp_falsch', test: TP, erwartet: 'page copy kernKompAusPreset equals the server plan', datei: P,
    alt: "ratio: 'ratio', attack: 'attack'", neu: "ratio: 'verhaeltnis', attack: 'attack'",
    was: 'the page copy maps ratio to a field the server does not use' },
  { name: 'kern_geraet_pfad', test: TP, erwartet: 'page copy kernGeraetAnfragen equals the server plan', datei: P,
    alt: 'werkzeugAnfrage(`${kanal}/${p.pfad}`', neu: 'werkzeugAnfrage(`${p.pfad}`',
    was: 'the page copy of a kern device request drops the channel from the path' },
  { name: 'ziel_art_falsch', test: TP, erwartet: 'kanalPlanHolen: asks POST /presets/anwenden', datei: P,
    alt: "ziel: { art: 'kanal', kanal } }", neu: "ziel: { art: 'spur', kanal } }",
    was: 'the page asks for a track target instead of a channel target' },
  { name: 'fehler_text_leer', test: TP, erwartet: 'kanalPlanHolen: asks POST /presets/anwenden', datei: P,
    alt: 'return { ok: false, text: fehlerText(r), anfragen: [] };', neu: "return { ok: false, text: '', anfragen: [] };",
    was: 'a refusal loses the server text' },
  { name: 'id_nicht_weitergegeben', test: TP, erwartet: 'panel apply hands the register id to the host', datei: P,
    alt: 'this.host.anwenden(r.j, g, registerId(id))', neu: 'this.host.anwenden(r.j, g)',
    was: 'the panel does not hand the register id to the host' },
  { name: 'id_doppelt_gewandelt', test: TP, erwartet: 'panel apply to a channel end to end', datei: P,
    alt: "senden('/presets/anwenden', { id, ziel: { art: 'kanal', kanal } })", neu: "senden('/presets/anwenden', { id: registerId(id), ziel: { art: 'kanal', kanal } })",
    was: 'the register id is converted a second time (browser finding: "not a preset id")' },
  { name: 'geraet_ohne_bindestrich', test: TP, erwartet: 'panel apply of a hyphenated device id (kanal-limiter)', datei: P,
    alt: "([a-z0-9-]+)\\/([a-z0-9][a-z0-9-]{0,47})$/.exec", neu: "([a-z0-9]+)\\/([a-z0-9][a-z0-9-]{0,47})$/.exec",
    was: 'teileId drops the hyphen from the device group again (review MAJOR: Bus Limiter presets get a null id)' },
  { name: 'plan_ablehnung_fehlt', test: TW, erwartet: 'a server refusal of POST /presets/anwenden shows "Not applied"', datei: A,
    alt: 'if (!plan.ok) return { ok: false, text: plan.text };', neu: '',
    was: 'the glue reads the request list of a refused plan (review MINOR: no message, TypeError)' },
  { name: 'regler_stopp_fehlt', test: TW, erwartet: 'a refusal of the 2nd /regler request stops the apply', datei: A,
    alt: 'if (!r.ok) return { ok: false, text: r.text };', neu: '',
    was: 'the glue continues with the next /regler request after a refusal (review MINOR)' },
  { name: 'stopp_fehlt', test: TS, erwartet: 'stops at the first refusal', datei: S,
    alt: 'if (r.code !== 200 || r.j?.quittung?.status === 6) return', neu: 'if (r.code === 999) return',
    was: 'the consumer continues after a refused /regler request' },
  { name: 'rev_fehlt', test: TS, erwartet: 'a proj plan is one POST /proj/aendern', datei: S,
    alt: "{ rev, label: p.label, befehle: p.befehle }", neu: "{ label: p.label, befehle: p.befehle }",
    was: 'the proj request carries no rev' },
  { name: 'ablehnung_sendet', test: TS, erwartet: 'a refusal answer (4xx {fehler}) sends nothing', datei: S,
    alt: "if (abgelehnt) return { ok: false, gesendet: 0, antworten: [], grund: grundVon(abgelehnt) };", neu: '',
    was: 'a refusal answer is not stopped before the sending' },
];

process.exit(fuehreAus(MUTANTEN) ? 1 : 0);
