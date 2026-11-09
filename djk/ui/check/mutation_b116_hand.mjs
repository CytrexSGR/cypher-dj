// Mutation probe of package 1.16 rest U5: the six hand tools (djk/hand/hand.ts). One mutant per rule; the named test of
// djk/hand/tests/hand_presets.test.mjs must turn red, then the file is restored. Usage: node check/mutation_b116_hand.mjs [--nur name,...]
import { fuehreAus } from './mutation_run.mjs';

const H = '../hand/hand.ts', T = '../hand/tests/hand_presets.test.mjs', TE = '../hand/tests/hand_presets_real.test.mjs';   // TE needs the test instance e: run under its locks

export const MUTANTEN = [
  { name: 'schema_gedriftet', test: T, erwartet: 'presets_suchen: the input schema equals GET /presets/suche/schema', datei: H,
    alt: 'inputSchema: SUCHE.input_schema as Json,', neu: "inputSchema: { type: 'object', properties: {} },",
    was: 'the search tool carries its own loose schema instead of the server definition' },
  { name: 'id_nicht_geprueft', test: T, erwartet: 'presets_lesen: a register id becomes GET', datei: H,
    alt: "if (typeof p.id !== 'string' || !PRESET_ID.test(p.id)) return fehlerAntwort(400, 'preset_id_ungueltig', 'a preset id looks like werk:komp/drum-bus or nutzer:rb338/my-bass (<werk|nutzer>:<geraet>/<slug>)');\n      const [, herkunft",
    neu: "const [, herkunft",
    was: 'presets_lesen sends a malformed id (and crashes on the match)' },
  { name: 'werte_und_ziel_erlaubt', test: T, erwartet: 'presets_speichern: werte', datei: H,
    alt: 'if (hatW === hatZ) return', neu: 'if (false) return',
    was: 'presets_speichern accepts both or neither of werte and ziel' },
  { name: 'ziel_mit_geraet', test: T, erwartet: 'presets_speichern: werte', datei: H,
    alt: "if (p.geraet !== undefined || p.graph !== undefined) return fehlerAntwort(400, 'geraet_aus_ziel'", neu: "if (false) return fehlerAntwort(400, 'geraet_aus_ziel'",
    was: 'a geraet given next to ziel is passed on silently' },
  { name: 'details_verloren', test: T, erwartet: 'presets_speichern: refused vocabulary words come back with erlaubt', datei: H,
    alt: 'detail: r.j.detail, details: r.j.details, ziel', neu: 'detail: r.j.detail, ziel',
    was: 'the tool error drops details, so the allowed words never reach me' },
  { name: 'plan_ablehnung_weiter', test: T, erwartet: 'presets_anwenden: a refused plan (kein_ziel) sends NO', datei: H,
    alt: 'if (plan.code !== 200) return plan;', neu: '',
    was: 'a refused plan is not returned as the refusal' },
  { name: 'rev_fehlt', test: T, erwartet: 'presets_anwenden weg proj: POST /presets/anwenden, then ONE /proj/aendern', datei: H,
    alt: "const r = await mitRev(p, '/proj/aendern', { label: pl.label, befehle: pl.befehle });", neu: "const r = await http('POST', '/proj/aendern?antwort=kurz', { label: pl.label, befehle: pl.befehle });",
    was: 'the proj plan is sent without a rev' },
  { name: 'regler_stopp_fehlt', test: T, erwartet: 'presets_anwenden weg regler: one POST /regler', datei: H,
    alt: 'if (r.code >= 400 || (q && FEHL_STATUS.has(q.status))) {\n        return { code: r.code >= 400', neu: 'if (false) {\n        return { code: r.code >= 400',
    was: 'the regler way continues after a refused request' },
  { name: 'regler_http_stopp_fehlt', test: T, erwartet: 'an HTTP refusal of /regler also stops', datei: H,
    alt: 'if (r.code >= 400 || (q && FEHL_STATUS', neu: 'if ((q && FEHL_STATUS',
    was: 'an HTTP refusal of /regler is not a stop' },
  { name: 'uebersprungen_verloren', test: T, erwartet: 'presets_anwenden weg proj: POST /presets/anwenden, then ONE /proj/aendern', datei: H,
    alt: 'uebersprungen: pl.uebersprungen ?? [], hinweise', neu: 'uebersprungen: [], hinweise',
    was: 'the answer drops the parameters the target could not carry' },
  { name: 'kollektion_loeschen_route', test: T, erwartet: 'kollektion_aendern: neu, posten, umbenennen, loeschen each hit their route', datei: H,
    alt: "http('POST', `/kollektionen/${slug}/loeschen`, {})", neu: "http('POST', `/kollektionen/${slug}/delete`, {})",
    was: 'loeschen goes to a route that does not exist' },
  { name: 'kollektion_argumente', test: T, erwartet: 'kollektion_aendern: neu, posten, umbenennen, loeschen each hit their route', datei: H,
    alt: "if (p.hinzu === undefined && p.weg === undefined) return fehlt('hinzu and/or weg');", neu: '',
    was: 'posten without hinzu or weg is sent' },
  // the same rules against the real page server (core stand-in, instance e)
  { name: 'echt_rev_fehlt', test: TE, erwartet: 'apply a factory preset to an rb338 track', datei: H,
    alt: "const r = await mitRev(p, '/proj/aendern', { label: pl.label, befehle: pl.befehle });", neu: "const r = await http('POST', '/proj/aendern?antwort=kurz', { label: pl.label, befehle: pl.befehle });",
    was: 'the proj plan is sent without a rev to the real server' },
  { name: 'echt_quelle_fehlt', test: TE, erwartet: 'save by the hand carries autor cypher', datei: H,
    alt: "const QUELLE = { 'x-djk-quelle': 'cypher' };", neu: 'const QUELLE = {};',
    was: 'the hand sends no source header: the saved preset is not marked as hers and she may delete collections of Andreas' },
  { name: 'echt_plan_ablehnung_weiter', test: TE, erwartet: 'apply a factory preset to an rb338 track', datei: H,
    alt: 'if (plan.code !== 200) return plan;', neu: '',
    was: 'a refused plan (hall) is not returned as the refusal' },
];

process.exit(fuehreAus(MUTANTEN) ? 1 : 0);
