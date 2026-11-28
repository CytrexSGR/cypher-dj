// The + INSERT entries of a strip (pure) and the DOM part: the chip and its menu.
import { ARTEN, HOST_ART, MAX_ART, MAX_PLAETZE, GLUE_VORLAGEN, anzahl, frei, straenge, neuerInsertBefehl, insertLabels } from '../production/inserts.js';
import { MAX_HOST } from '../production/limits.js';
import { pluginGrund } from '../production/devices_browser.js';
import { duckKicks, duckBefehl } from '../production/key_choice.js';
import { knopfEl } from './blocks.js';

const PLUS_ARTEN = [['komp', 'Compressor'], ['eq', 'EQ'], ['saett', 'Saturator'], ['lim', 'Limiter']];
const PLUS_MISCH = [['gate', 'Gate'], ['mb', 'Multiband'], ['trans', 'Transient shaper'], ['bild', 'Imager']];   // after the Utility when the list has one
export const PLUS_VOLL_TEXT = `The strip holds ${MAX_PLAETZE} stages`;
export const MASTER_VOLL_TEXT = 'The master chain has five stages';   // MAX_PLAETZE = 5
/** The values of a fresh Cypher Clipper: the Hard clip curve, no drive, no output gain, ceiling -0.3 dB, knee 3 dB, fully wet (old stages keep knee 0). */
export const KLIPPER_WERTE = { kurve: 2, drive: 0, out: 0, decke: -0.3, knie: 3, mix: 1 };
/** The insert_setzen of a Clipper (a saturator stage with the Hard clip curve) at `pos` (default: the end of the chain), or null (pool or chain full). */
export function klipperBefehl(p, strangId, pos) {
  const b = neuerInsertBefehl(p, strangId, 'saett');
  return b ? { ...b, ...(pos !== undefined ? { pos } : {}), werte: { ...KLIPPER_WERTE } } : null;
}
/** The CLIP button of the master strip: {insert: the clipper on the master (a saturator with a curve above Tanh) or null, befehl: the insert that adds one before the first
 *  limiter (or at the end), grund: why it cannot be added}. */
export function masterClipZustand(p) {
  const kette = p?.master?.inserts ?? [];
  const insert = kette.find((i) => i.art === 'saett' && Number(i.werte?.kurve) > 0) ?? null;
  if (insert) return { insert, befehl: null, grund: '' };
  if (kette.length >= MAX_PLAETZE) return { insert: null, befehl: null, grund: MASTER_VOLL_TEXT };
  const l = kette.findIndex((i) => i.art === 'lim');
  const befehl = klipperBefehl(p, 'master', l < 0 ? kette.length : l);
  return { insert: null, befehl, grund: befehl ? '' : ARTEN.saett.voll };
}
export { GLUE_VORLAGEN };   // the recipes live in inserts.js (the face needs them too); plus.js is their menu side
/** The insert_setzen of a Cypher Glue stage (a compressor stage in glue mode with the recipe `vorlage`: bus, drums, master or smash) at `pos` (default: the end of the chain), or null (pool or chain full). */
export function glueBefehl(p, strangId, pos, vorlage = 'bus') {
  const b = neuerInsertBefehl(p, strangId, 'komp'), v = GLUE_VORLAGEN[vorlage];
  return b && v ? { ...b, ...(pos !== undefined ? { pos } : {}), werte: { ...v.werte, glue: 1 } } : null;
}
/** The GLUE button of the master strip: {insert: the glue compressor on the master (glue 1) or null, befehl: the insert that adds one (Master recipe) before the first clipper
 *  (a saturator with a curve above Tanh) or limiter, else at the end, grund: why it cannot be added}. */
export function masterGlueZustand(p) {
  const kette = p?.master?.inserts ?? [];
  const insert = kette.find((i) => i.art === 'komp' && Number(i.werte?.glue) >= 0.5) ?? null;
  if (insert) return { insert, befehl: null, grund: '' };
  if (kette.length >= MAX_PLAETZE) return { insert: null, befehl: null, grund: MASTER_VOLL_TEXT };
  const l = kette.findIndex((i) => (i.art === 'saett' && Number(i.werte?.kurve) > 0) || i.art === 'lim');
  const befehl = glueBefehl(p, 'master', l < 0 ? kette.length : l, 'master');
  return { insert: null, befehl, grund: befehl ? '' : ARTEN.komp.voll };
}
/** The values of a fresh De-esser (strand 5 slice 2): an EQ stage with band 6 only, a High shelf at 6 kHz that cuts 8 dB above -30 dB (1 ms attack, 60 ms release). */
export const DEESSER_WERTE = { 'b6/an': 1, 'b6/typ': 2, 'b6/freq': 6000, 'b6/gain': 0, 'b6/q': 0.707, 'd6/dyn': 1, 'd6/schwelle': -30, 'd6/bereich': -8, dyn_attack: 1, dyn_release: 60 };
/** The insert_setzen of a De-esser (an EQ stage with the dynamic shelf above) at the end of the chain, or null (pool or chain full). */
export function deesserBefehl(p, strangId) {
  const b = neuerInsertBefehl(p, strangId, 'eq');
  return b ? { ...b, werte: { ...DEESSER_WERTE } } : null;
}
/**
 * The entries of the "+" menu: [{text, befehl | null, grund?, label?} | {gruppe: true, text}]; befehl is null (with the reason) when the strip is full, the
 * pool of that kind is empty or a plugin is blocked. `opt` (all optional, `{}` is the STUDIO list): util adds Utility after Limiter (Gate and Multiband follow in both lists); zaehler appends
 * " used/max" to the kinds and plugins; plugins is the GET /plugins list (effects only); duck is the kick list of `duckKicks` (the caller checks that the
 * strip is a track with a free compressor).
 */
export function plusEintraege(p, strangId, graphen, opt = {}) {
  const strang = straenge(p).find((s) => s.id === strangId);
  const voll = !strang || strang.inserts.length >= MAX_PLAETZE;
  const mitZahl = (text, art) => (opt.zaehler ? `${text} ${anzahl(p, art)}/${art === 'host' ? MAX_HOST : MAX_ART[art]}` : text);
  const eintrag = (text, art, graph) => {
    const t = mitZahl(text, art);
    const b = voll ? null : neuerInsertBefehl(p, strangId, art);
    if (!b) return { text: t, befehl: null, grund: voll ? PLUS_VOLL_TEXT : ARTEN[art].voll };
    return { text: t, befehl: art === 'bk' ? { ...b, graph } : b };
  };
  const arten = opt.util ? [...PLUS_ARTEN, ['utility', 'Utility'], ...PLUS_MISCH] : [...PLUS_ARTEN, ...PLUS_MISCH];
  const klipper = () => {   // strand 5 slice 1: a saturator stage that starts as a Hard clip at -0.3 dB
    const t = mitZahl('Clipper', 'saett');
    const b = voll ? null : klipperBefehl(p, strangId);
    return b ? { text: t, befehl: b, label: `Add Clipper to ${strang.name}` } : { text: t, befehl: null, grund: voll ? PLUS_VOLL_TEXT : ARTEN.saett.voll };
  };
  const glue = () => {   // strand 13 slice 1: a compressor stage in glue mode, the Bus recipe
    const t = mitZahl('Glue', 'komp');
    const b = voll ? null : glueBefehl(p, strangId);
    return b ? { text: t, befehl: b, label: `Add Glue to ${strang.name}` } : { text: t, befehl: null, grund: voll ? PLUS_VOLL_TEXT : ARTEN.komp.voll };
  };
  const deesser = () => {   // strand 5 slice 2: an EQ stage that starts as a dynamic high shelf
    const t = mitZahl('De-esser', 'eq');
    const b = voll ? null : deesserBefehl(p, strangId);
    return b ? { text: t, befehl: b, label: `Add De-esser to ${strang.name}` } : { text: t, befehl: null, grund: voll ? PLUS_VOLL_TEXT : ARTEN.eq.voll };
  };
  const aus = [
    ...arten.flatMap(([art, text]) => (art === 'komp' ? [eintrag(text, art), glue()] : art === 'saett' ? [eintrag(text, art), klipper()] : art === 'eq' ? [eintrag(text, art), deesser()] : [eintrag(text, art)])),
    ...(graphen ?? []).filter((g) => g?.art === 'effekt' && typeof g.name === 'string').map((g) => eintrag(g.name, 'bk', g.name)),
  ];
  const effekte = (opt.plugins ?? []).filter((e) => e?.art === 'effekt');
  if (effekte.length > 0) {
    aus.push({ gruppe: true, text: 'Plugins' });
    for (const e of effekte) {
      const text = mitZahl(e.name, 'host');
      const grund = voll ? PLUS_VOLL_TEXT : pluginGrund(e) || (anzahl(p, 'host') >= MAX_HOST ? HOST_ART.voll : '');
      aus.push(grund
        ? { text, befehl: null, grund }
        : { text, befehl: { befehl: 'insert_setzen', strang_id: strangId, pos: (strang.inserts ?? []).length, art: 'host', plugin_id: e.id }, label: `Add ${e.name} to ${strang.name}` });
    }
  }
  if ((opt.duck ?? []).length > 0 && strang) {
    aus.push({ gruppe: true, text: 'Duck by Kick' });
    for (const k of opt.duck) {
      const text = `Track ${k.nr} ${k.name}`;
      aus.push(voll ? { text, befehl: null, grund: PLUS_VOLL_TEXT } : { text, befehl: duckBefehl(strangId, k.id), label: `Duck ${strang.name} by ${k.name}` });
    }
  }
  return aus;
}

// ---- the DOM part: the "+ INSERT" chip and its menu (`werk` is the state of one mounted dock, see dock.js) ----------------------------------------------
export async function plusMenue(werk, id, anker) {
  const { host } = werk;
  const s = werk.strangVon(id);
  if (!s) return;
  const graphen = await werk.quelle.graphen(true);
  const o = host.plusOptionen ?? {};
  const opt = { util: !!o.util, zaehler: !!o.zaehler };
  if (o.plugins) {
    const r = await host.holeGet('/plugins');
    const liste = Array.isArray(r?.j) ? r.j : r?.j?.plugins;   // GET /plugins answers {plugins, scan}; a failed fetch leaves the group out
    if (r?.status === 200 && Array.isArray(liste)) opt.plugins = liste;
  }
  const p0 = host.projekt();
  if (o.duck && s.art === 'spur' && p0 && frei(p0, 'komp') > 0) opt.duck = duckKicks(p0, id);
  const vorher = new Set(s.inserts.map((i) => i.id)), name = s.name;
  const schreibe = async (label, befehl) => {
    if (!(await host.aendere(label, [befehl]))) return;
    const neu = werk.strangVon(id)?.inserts.find((i) => !vorher.has(i.id));
    if (neu) host.oeffneStufe?.(id, neu.id); else if (werk.returnVon(id)) host.oeffneStufe?.(id, 'hall');
  };
  const punkte = [
    ...(werk.returnVon(id)?.hall?.an === false ? [{ text: 'Hall', aktion: () => schreibe(`Hall on return ${werk.returnVon(id).name}`, { befehl: 'return_aendern', return_id: id, hall: { an: true } }) }] : []),
    ...plusEintraege(host.projekt(), id, graphen, opt).map((e) => (e.gruppe ? e : { text: e.text, aus: e.befehl === null, titel: e.grund,
      aktion: () => schreibe(e.label ?? (e.befehl.art === 'bk' ? `Add ${e.befehl.graph} to ${name}` : insertLabels(name, s.inserts.length + 1, e.befehl.art).neu), e.befehl) })),
  ];
  const q = anker.getBoundingClientRect();
  host.oeffneMenue(punkte, q.left, q.bottom);
}
export function plusKnopf(werk, strangId) {
  const b = knopfEl('w-chip-teil w-chip-plus', 'karte-plus', werk.T.plus, werk.T.plusTitel);
  if ((werk.strangVon(strangId)?.inserts.length ?? 0) >= MAX_PLAETZE) { b.disabled = true; b.title = PLUS_VOLL_TEXT; }
  b.addEventListener('click', (e) => { e.stopPropagation?.(); plusMenue(werk, strangId, b); });
  return b;
}
