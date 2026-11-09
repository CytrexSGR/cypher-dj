// PRODUCTION (package 1.16 rest U7, decision S4): a preset from the PRESETS list is dragged onto a track row, a stage or a strip row. Pure functions, no DOM.
// The drag carries {id, geraet, name} (id = register id, e.g. "werk:komp/drum-bus"). presetZiel() picks the TARGET of the plan request
// (POST /presets/anwenden {id, ziel}, spec 4.2) or gives the reason why there is none. What the preset does to the target (values, skipped
// parameters, refusals such as art_nicht_aktiv, kein_ziel, graph_anders) is the server's plan; the page never maps values itself.
import { MAX_PLAETZE, freieKomp, straenge } from './inserts.js';

export const PRESET_TYP = 'application/x-djk-preset';
export const PRESET_ZIEL_TEXT = {
  keine_spur: 'Drop the preset on a track row',
  keine_stufe: 'That insert stage no longer exists',
  keine_instrumentspur: 'Instrument presets go on instrument tracks',
  geraet_passt_nicht: 'This preset belongs to another device than the target',
  nur_spur: 'Drop an instrument preset on its track in the arrangement',
  nur_kanal: 'This preset is for a DJ channel strip: apply it in the DJ view',
  kette_voll: `All ${MAX_PLAETZE} stages of this strip are used`,
  ins_voll: 'No free compressor in the project',
};
// preset device id -> the device name a track must carry
const INSTRUMENT = { rb338: 'rb338', baukasten: 'bk' };
// preset device ids that become an insert stage (komp is the only active kind; eq and saett wait for slice 4b, hall lives on returns: the server says so)
const EFFEKT = new Set(['komp', 'eq', 'saett', 'hall']);
const REGISTER_ID = /^(werk|nutzer):[a-z0-9-]+\/[a-z0-9][a-z0-9-]{0,47}$/;

/** The drag payload of a row of GET /presets, or null (a damaged file, a malformed id). */
export function presetNutzlast(e) {
  if (!e || typeof e !== 'object' || e.fehler || typeof e.geraet !== 'string' || typeof e.herkunft !== 'string') return null;
  const id = `${e.herkunft}:${e.geraet}/${e.slug}`;
  if (!REGISTER_ID.test(id)) return null;
  return { id, geraet: e.geraet, name: typeof e.name === 'string' && e.name ? e.name : e.slug };
}

const fehler = (code) => ({ fehler: code, text: PRESET_ZIEL_TEXT[code] });

/**
 * ziel is one of {spurIndex} (a track row of the arrangement), {stufe} (an insert stage id), {strang} (a strip row of the INSERTS block).
 * Returns {ziel} (spec 4.2: {art:'spur',spur_id} | {art:'insert',insert_id} | {art:'insert_neu',strang_id}) or {fehler, text}.
 */
export function presetZiel(projekt, ziel, n) {
  const g = n?.geraet;
  if (!projekt || !ziel || typeof g !== 'string') return fehler('keine_spur');
  const instrument = g in INSTRUMENT, effekt = EFFEKT.has(g);
  if (!instrument && !effekt) return fehler('nur_kanal');
  if (ziel.stufe !== undefined) {
    const s = straenge(projekt).flatMap((x) => x.inserts).find((i) => i.id === ziel.stufe);
    if (!s) return fehler('keine_stufe');
    return instrument || s.art !== g ? fehler('geraet_passt_nicht') : { ziel: { art: 'insert', insert_id: s.id } };
  }
  if (ziel.strang !== undefined) {
    const s = straenge(projekt).find((x) => x.id === ziel.strang);
    if (!s) return fehler('keine_spur');
    if (instrument) return fehler('nur_spur');
    return neueStufe(projekt, s, g);
  }
  const spur = Number.isInteger(ziel.spurIndex) ? projekt.spuren?.[ziel.spurIndex] : undefined;
  if (!spur) return fehler('keine_spur');
  if (instrument) {
    if (spur.art !== 'instrument') return fehler('keine_instrumentspur');
    return spur.geraet?.art === 'intern' && spur.geraet.name === INSTRUMENT[g] ? { ziel: { art: 'spur', spur_id: spur.id } } : fehler('geraet_passt_nicht');
  }
  const vorhanden = (spur.inserts ?? []).find((i) => i.art === g);
  if (vorhanden) return { ziel: { art: 'insert', insert_id: vorhanden.id } };
  return neueStufe(projekt, { id: spur.id, inserts: spur.inserts ?? [] }, g);
}
// a new stage at the end of a chain; capacity is checked for the compressor, the only kind that can land today (an inactive kind gets the server's reason)
function neueStufe(projekt, strang, g) {
  if (g === 'komp') {
    if (strang.inserts.length >= MAX_PLAETZE) return fehler('kette_voll');
    if (freieKomp(projekt) <= 0) return fehler('ins_voll');
  }
  return { ziel: { art: 'insert_neu', strang_id: strang.id } };
}

/**
 * SAVE CURRENT in PRODUCTION (T7.3): the tracks and stages of the open project that carry the preset device `g` (a preset device id), as
 * [{wert, text, ziel}]. `ziel` is the target of POST /presets/von_ziel (spec 4.2: only a track device or a compressor stage; the server reads
 * the values from the project). Every other device has no target here: its values live on a DJ channel and are saved from the DJ view.
 */
export function speicherZiele(projekt, g) {
  if (!projekt) return [];
  if (g === 'rb338' || g === 'baukasten') {
    const name = INSTRUMENT[g];
    return (projekt.spuren ?? []).filter((s) => s.geraet?.art === 'intern' && s.geraet.name === name)
      .map((s) => ({ wert: `spur:${s.id}`, text: `Track ${s.nr} ${s.name}${name === 'bk' ? ` (${s.geraet.graph})` : ''}`, ziel: { art: 'spur', spur_id: s.id } }));
  }
  if (g !== 'komp') return [];
  return straenge(projekt).flatMap((x) => x.inserts.map((i, pos) => ({ i, pos, x })).filter(({ i }) => i.art === 'komp')
    .map(({ i, x: str }) => ({ wert: `insert:${i.id}`, text: `${str.name}, compressor ${str.inserts.filter((k) => k.art === 'komp').indexOf(i) + 1}`, ziel: { art: 'insert', insert_id: i.id } })));
}
