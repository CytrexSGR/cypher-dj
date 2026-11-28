import { BK_INSERT_OPTIONAL, BK_REGLER_MIN, BK_REGLER_ZAHL } from './modular.ts';
import { INSERT_ARTEN } from './insert_key.ts';
import { PRESET_ID } from '../presets/preset_id.ts';
import type { Punkt } from './lane.ts';
import { SCHLUESSEL_DJ, SCHLUESSEL_NUR_ZEILE } from './key_table.ts';
import { SEGMENT_BPM_MAX, SEGMENT_BPM_MIN } from './warp.ts';
import { audioNotenPruefung } from './notes_contract.ts';
import { huellkurvenPruefung } from './envelope.ts';
import { insertSpaeterNamen } from './insert_spaeter.ts';
import { seqSichtPruefung } from './seq.ts';
import { stiftFehler } from '../steckfeld.ts';
import { type InsertTraeger, makroVon } from './model_ids.ts';
import {
  AUTO_FORMEN, AUTO_ZIELE, BEATS_LOOP, BEATS_RASTER, BK_GRAPH_NAME, BK_PARAMETER, type BlendZiel, type Clip, DEKODIERT, DETUNE_MAX,
  type DekodiertZustand, ENTSTEHUNG_CODE_MAX, ENTSTEHUNG_GRAPH, FADER_MAX, FADER_MIN, FARBE, FORMAT, FORMAT_ALT2, GAIN_MAX, GAIN_MIN,
  GESAMT_CT_MAX, GESAMT_CT_MIN, GLIED_GAIN_MAX, GLIED_GAIN_MIN, GLIED_ID, type Geraet, HALL_FELDER, ID, INSERT_ARTEN_AKTIV, type Insert,
  type InsertPoolArt, KENNUNG_MAX, KIT_NAME, type KettenZiel, LOOP_MIN, type Lane, MAKRO_NAME_MAX, MAX_BEAT, MAX_GLIEDER, MAX_GRUPPEN,
  MAX_INS, MAX_INSERTS_PRO_STRANG, MAX_LANES_PRO_SPUR, MAX_LANE_PUNKTE, MAX_LATENZ_EXTRA, MAX_MAKROS, MAX_MARKER, MAX_RACK, MAX_RETURNS,
  MAX_SPUREN, MAX_VARIATIONEN, MAX_ZEILEN, type Marker, type MidiClip, type Note, type PluginZiel, RB_PARAMETER, type Rack,
  type RackGeraet, type Return, SAMPLERATE, SCHLUESSEL_QUELLEN, SHA, SURGE_NAME, SURGE_PARAMETER_MAX, type SchluesselQuelle, type Send,
  type SendZiel, type Spur, TAKE_ID, TAKE_NAME_MAX, TEMPO_MAX, TEMPO_MIN, TRANSPOSE_MAX, TRANSPOSE_MIN, type Take, VARIATION_NAME_MAX,
  VERBUND_ID, WARP_MODI, WARP_QUELLEN, WIRT_SLOTS, type Warp, ZIEL_BEREICH, type Ziel, type ZielBereich, fxPruefung, ganz, glieder,
  insertWertNamen, insertWertParameter, istGeraetZiel, istObjekt, istPatchName, makroFaehig, musterPruefung, passtGeraetZiel, zahl,
} from './model_types.ts';

// --- Prüfung --------------------------------------------------------------------------------------------------------
type Ergebnis<T> = { wert: T } | { fehler: string };
export class Fehl extends Error {}
export const werfe = (wo: string, was: string): never => { throw new Fehl(`${wo}: ${was}`); };

export function felder(o: unknown, wo: string, pflicht: string[], optional: string[] = []): Record<string, unknown> {
  if (!istObjekt(o)) return werfe(wo, 'Objekt erwartet');
  for (const k of pflicht) if (!(k in o)) werfe(`${wo}.${k}`, 'fehlt');
  for (const k of Object.keys(o)) if (!pflicht.includes(k) && !optional.includes(k)) werfe(`${wo}.${k}`, 'unbekanntes Feld');
  return o;
}
export const zahlIn = (x: unknown, wo: string, min: number, max: number, istGanz = false): number => {
  if (!zahl(x) || x < min || x > max || (istGanz && !ganz(x))) werfe(wo, `${istGanz ? 'ganze ' : ''}Zahl ${min}..${max} erwartet`);
  return x as number;
};
export const boolean = (x: unknown, wo: string): boolean => (typeof x === 'boolean' ? x : werfe(wo, 'true/false erwartet'));
export const text = (x: unknown, wo: string, max: number): string => (
  typeof x === 'string' && x.length >= 1 && x.length <= max ? x : werfe(wo, `Text 1..${max} Zeichen erwartet`));

export function beatsPruefung(x: unknown): { grund: string; text: string } | null {
  const ab = (grund: string, text: string) => ({ grund, text });
  if (!istObjekt(x)) return ab('argument_ungueltig', 'warp.beats: Objekt erwartet');
  for (const k of Object.keys(x)) if (!['raster', 'loop', 'huelle'].includes(k)) return ab('argument_unbekannt', `warp.beats.${k}`);
  if (!(BEATS_RASTER as readonly unknown[]).includes(x.raster)) return ab('argument_ungueltig', `warp.beats.raster: ${BEATS_RASTER.join(' | ')} erwartet`);
  if (!(BEATS_LOOP as readonly unknown[]).includes(x.loop)) return ab('argument_ungueltig', `warp.beats.loop: ${BEATS_LOOP.join(' | ')} erwartet`);
  if (!ganz(x.huelle) || x.huelle < 0 || x.huelle > 100) return ab('argument_ungueltig', 'warp.beats.huelle: ganze Zahl 0..100 erwartet');
  return null;
}

// S15: check of an entstehung object (model and commands share it): null = valid, else the reason (the command's reason) and a text.
export function entstehungPruefung(x: unknown): { grund: string; text: string } | null {
  const ab = (grund: string, text: string) => ({ grund, text });
  if (!istObjekt(x)) return ab('argument_ungueltig', 'entstehung: object expected');
  const pflicht = ['art', 'strom', 'graph', 'regler', 'code', 'bpm'];
  for (const k of Object.keys(x)) if (!pflicht.includes(k)) return ab('argument_unbekannt', `entstehung.${k}`);
  for (const k of pflicht) if (!(k in x)) return ab('argument_ungueltig', `entstehung.${k}: missing`);
  if (x.art !== 'strom') return ab('argument_ungueltig', "entstehung.art: 'strom' expected");
  if (x.strom !== 2 && x.strom !== 3) return ab('argument_ungueltig', 'entstehung.strom: 2 or 3 expected');
  if (typeof x.graph !== 'string' || !ENTSTEHUNG_GRAPH.test(x.graph)) {
    return ab('argument_ungueltig', 'entstehung.graph: graph name expected (a-z 0-9 _ -, 1..32)');
  }
  if (!Array.isArray(x.regler) || x.regler.length < BK_REGLER_MIN || x.regler.length > BK_REGLER_ZAHL || !x.regler.every((v) => zahl(v) && v >= 0 && v <= 1)) {
    return ab('argument_ungueltig', `entstehung.regler: ${BK_REGLER_MIN}..${BK_REGLER_ZAHL} numbers 0..1 expected`);
  }
  if (typeof x.code !== 'string' || x.code.length < 1 || x.code.length > ENTSTEHUNG_CODE_MAX) {
    return ab('argument_ungueltig', `entstehung.code: text of 1..${ENTSTEHUNG_CODE_MAX} characters expected`);
  }
  if (!zahl(x.bpm) || x.bpm < TEMPO_MIN || x.bpm > TEMPO_MAX) return ab('argument_ungueltig', `entstehung.bpm: number ${TEMPO_MIN}..${TEMPO_MAX} expected`);
  return null;
}

// Prüfung eines Warp-Objekts (Modell und Befehle teilen sie): null = gültig, sonst Grund (der Befehls-Grund) und Text.
export function warpPruefung(w: unknown): { grund: string; text: string } | null {
  const ab = (grund: string, text: string) => ({ grund, text });
  if (!istObjekt(w)) return ab('argument_ungueltig', 'warp: Objekt erwartet');
  const pflicht = ['an', 'modus', 'marker', 'versatz_beats', 'quelle', 'transpose_st', 'detune_ct'];
  for (const k of Object.keys(w)) if (!pflicht.includes(k) && k !== 'eins_unsicher' && k !== 'beats') return ab('argument_unbekannt', `warp.${k}`);
  for (const k of pflicht) if (!(k in w)) return ab('argument_ungueltig', `warp.${k}: fehlt`);
  if (typeof w.an !== 'boolean') return ab('argument_ungueltig', 'warp.an: true oder false erwartet');
  if ('eins_unsicher' in w && typeof w.eins_unsicher !== 'boolean') {
    return ab('argument_ungueltig', 'warp.eins_unsicher: true oder false erwartet');
  }
  if ('beats' in w) { const f = beatsPruefung(w.beats); if (f) return f; }
  if (!(WARP_MODI as readonly unknown[]).includes(w.modus)) return ab('warp_modus', `warp.modus: ${WARP_MODI.join(' | ')} erwartet`);
  if (!(WARP_QUELLEN as readonly unknown[]).includes(w.quelle)) {
    return ab('argument_ungueltig', `warp.quelle: ${WARP_QUELLEN.join(' | ')} erwartet`);
  }
  if (!zahl(w.versatz_beats) || Math.abs(w.versatz_beats) > MAX_BEAT) {
    return ab('argument_ungueltig', `warp.versatz_beats: Zahl von −${MAX_BEAT} bis ${MAX_BEAT} erwartet`);
  }
  if (!ganz(w.transpose_st) || w.transpose_st < TRANSPOSE_MIN || w.transpose_st > TRANSPOSE_MAX) {
    return ab('argument_ungueltig', `warp.transpose_st: ganze Zahl ${TRANSPOSE_MIN}..${TRANSPOSE_MAX} erwartet`);
  }
  if (!zahl(w.detune_ct) || Math.abs(w.detune_ct) > DETUNE_MAX) {
    return ab('argument_ungueltig', `warp.detune_ct: Zahl ${-DETUNE_MAX}..${DETUNE_MAX} erwartet`);
  }
  if ((w.modus === 'repitch' || w.modus === 'beats') && (w.transpose_st !== 0 || w.detune_ct !== 0)) {   // D6b: BEATS wie RE-PITCH
    return ab('transpose_repitch', 'RE-PITCH und BEATS folgen dem Tempo; Transpose und Detune gibt es dort nicht');
  }
  const gesamt = w.transpose_st * 100 + w.detune_ct;
  if (gesamt < GESAMT_CT_MIN || gesamt > GESAMT_CT_MAX) {
    return ab('argument_ungueltig', `warp: transpose_st · 100 + detune_ct ${GESAMT_CT_MIN}..${GESAMT_CT_MAX} Cent`);
  }
  const m = w.marker;
  if (!Array.isArray(m) || m.length < 2 || m.length > MAX_MARKER) return ab('warp_marker', `warp.marker: 2 bis ${MAX_MARKER} Marker erwartet`);
  for (let i = 0; i < m.length; i++) {
    const p = m[i];
    if (!Array.isArray(p) || p.length !== 2 || !zahl(p[0]) || !zahl(p[1])) return ab('warp_marker', `warp.marker[${i}]: [quell_s, beat] erwartet`);
    if (p[0] < 0 || p[0] > 1e7) return ab('warp_marker', `warp.marker[${i}]: quell_s 0..1e7 erwartet`);
    if (Math.abs(p[1]) > MAX_BEAT) return ab('warp_marker', `warp.marker[${i}]: beat von −${MAX_BEAT} bis ${MAX_BEAT} erwartet`);
    if (i > 0 && !(p[0] > m[i - 1][0] && p[1] > m[i - 1][1])) {
      return ab('warp_marker', `warp.marker[${i}]: quell_s und beat müssen streng steigen`);
    }
    // so sieht sie der Kern (Frames = quell_s · 48 000, Beat minus Versatz): zwei Doubles, die danach gleich sind, lehnt er mit format ab
    if (i > 0 && !(p[0] * SAMPLERATE > m[i - 1][0] * SAMPLERATE && p[1] - w.versatz_beats > m[i - 1][1] - w.versatz_beats)) {
      return ab('warp_marker', `warp.marker[${i}]: nach der Umrechnung (Frames, Beat minus Versatz) nicht mehr streng steigend`);
    }
  }
  for (let i = 0; i + 1 < m.length; i++) {
    const bpm = 60 * (m[i + 1][1] - m[i][1]) / (m[i + 1][0] - m[i][0]);
    if (!(bpm >= SEGMENT_BPM_MIN && bpm <= SEGMENT_BPM_MAX)) {
      return ab('warp_faktor', `warp.marker[${i}]: Segment-Tempo ${Math.round(bpm * 100) / 100} BPM, erlaubt ${SEGMENT_BPM_MIN}..${SEGMENT_BPM_MAX}`);
    }
  }
  return null;
}

// 1.12 slice 6: the target of a chain lane. `insert.<stage id>.<param>` (the parameter name has at most one `/`, as `b1/freq`) or `rack.m1` .. `rack.m4`.
const KETTEN_ZIEL = /^(?:insert\.([A-Za-z][A-Za-z0-9_-]{0,31})\.([a-z0-9_]{1,16}(?:\/[a-z0-9_]{1,16})?)|rack\.m([1-4]))$/;
export const istKettenZiel = (z: unknown): z is KettenZiel => typeof z === 'string' && KETTEN_ZIEL.test(z);
/** a chain target taken apart: the stage and parameter, or the macro number 1..4 */
export function zerlegeKettenZiel(z: string): { insert: string; param: string } | { makro: number } | null {
  const m = KETTEN_ZIEL.exec(z);
  if (!m) return null;
  return m[3] !== undefined ? { makro: Number(m[3]) } : { insert: m[1], param: m[2] };
}
/** the strip's own target of a chain lane: the stage must be in its chain and a continuous parameter of a built-in kind (not `an`, not `sc`, not a host
 *  stage), or the strip must have a rack (the macro value is 0..1). Null = the target does not exist on this strip. */
export function kettenZielBereich(strang: { inserts?: Insert[]; rack?: Rack }, ziel: string): ZielBereich | null {
  const z = zerlegeKettenZiel(ziel);
  if (!z) return null;
  if ('makro' in z) return strang.rack ? { min: 0, max: 1, nurSprung: false } : null;
  const st = (strang.inserts ?? []).find((x) => x.id === z.insert);
  if (!st || st.art === 'host' || z.param === 'sc') return null;
  const q = INSERT_ARTEN[st.art as InsertPoolArt].parameter.find((x) => x.name === z.param);
  return q && makroFaehig(st.art as InsertPoolArt, z.param) ? { min: q.min, max: q.max, nurSprung: false } : null;
}
const SEND_ZIEL = /^send\.([A-Za-z][A-Za-z0-9_-]{0,31})$/;
export const istSendZiel = (z: unknown): z is SendZiel => typeof z === 'string' && SEND_ZIEL.test(z);
/** the return id a send target names, or null */
export const sendZielVon = (z: string): string | null => SEND_ZIEL.exec(z)?.[1] ?? null;
export const sendZielName = (returnId: string): SendZiel => `send.${returnId}`;
/** the dB range of a send lane = the range of send_setzen (-200 is silence) */
export const SEND_BEREICH: ZielBereich = { min: FADER_MIN, max: FADER_MAX, nurSprung: false };
/** the send lane targets a strip may be offered: one per send it has, in the order of the sends (by return number). The page lists exactly these. */
export const sendZiele = (strang: { sends?: Send[] }): SendZiel[] => (strang.sends ?? []).map((x) => sendZielName(x.id));
/** the range of a send target on this strip: it exists while the strip has a send into that return (null = it does not) */
export const sendZielBereich = (strang: { sends?: Send[] }, ziel: string): ZielBereich | null => {
  const id = sendZielVon(ziel);
  return id !== null && (strang.sends ?? []).some((x) => x.id === id) ? SEND_BEREICH : null;
};
// Strand 2 slice 1: a plugin parameter of a host stage. The index has no leading zeros, so one parameter has one target string.
const PLUGIN_ZIEL = /^plugin\.([A-Za-z][A-Za-z0-9_-]{0,31})\.(0|[1-9][0-9]{0,4})$/;   // equal public/production/lanes.js
export const istPluginZiel = (z: unknown): z is PluginZiel => typeof z === 'string' && PLUGIN_ZIEL.test(z);
/** a plugin target taken apart: the host stage id and the parameter index, or null */
export const pluginZielVon = (z: string): { insert: string; index: number } | null => {
  const m = PLUGIN_ZIEL.exec(z);
  return m ? { insert: m[1], index: Number(m[2]) } : null;
};
// per host stage; plugin lanes never reach the core, so ARR_KLANES_MAX does not bound them (plan strand 2 section 0.3). Equal public/production/lanes.js
export const MAX_PLUGIN_LANEN = 16;
export const PLUGIN_BEREICH: ZielBereich = { min: 0, max: 1, nurSprung: false };
/** the range of a plugin target on this strip: it exists while the strip carries a host stage of that id (null = it does not) */
export const pluginZielBereich = (strang: { inserts?: Insert[] }, ziel: string): ZielBereich | null => {
  const z = pluginZielVon(ziel);
  return z && (strang.inserts ?? []).some((x) => x.id === z.insert && x.art === 'host') ? PLUGIN_BEREICH : null;
};
/** the plugin lanes of a strip that drive the host stage `insertId` */
export const pluginLanen = (strang: { automation?: Lane[] }, insertId: string): Lane[] =>
  (strang.automation ?? []).filter((l) => pluginZielVon(l.ziel)?.insert === insertId);
/** the range of any lane target on a strip: a device target of the fixed table, or a chain, send or plugin target of this strip (null = does not exist) */
export function zielBereichVon(ziel: string, strang?: { inserts?: Insert[]; rack?: Rack; sends?: Send[] }): ZielBereich | null {
  if (Object.hasOwn(ZIEL_BEREICH, ziel)) return ZIEL_BEREICH[ziel as Ziel];
  if (istBlendZiel(ziel)) return BLEND_BEREICH;
  if (istSendZiel(ziel)) return strang ? sendZielBereich(strang, ziel) : null;
  if (istPluginZiel(ziel)) return strang ? pluginZielBereich(strang, ziel) : null;
  return strang ? kettenZielBereich(strang, ziel) : null;
}
export const istBlendZiel = (z: unknown): z is BlendZiel => typeof z === 'string' && z.startsWith('blend:') && ID.test(z.slice(6));
export const BLEND_BEREICH: ZielBereich = { min: 0, max: 1, nurSprung: false };
// Decision 7: the equal-power law of a blend value 0..1 as the two track faders in dB (0 = original 0 dB and new closed, 1 = the other way round,
// between them cos and sin); "closed" is -200 (the fader floor). `trim` is the level offset of the new path (Gruppe.neu_trim_db): the new fader at
// blend 1 sits at `trim`, so the new path is as loud as the original at 0 dB; the fader maximum caps it.
export const NEU_TRIM_MIN = -60, NEU_TRIM_MAX = 24;
export function blendFader(wert: number, trim = 0): { original: number; neu: number } {
  const w = Math.min(1, Math.max(0, wert)) * Math.PI / 2;
  const db = (x: number): number => (x < 1e-10 ? -200 : Math.max(-200, Math.round(20 * Math.log10(x) * 1e6) / 1e6));
  const neu = db(Math.sin(w));
  return { original: db(Math.cos(w)), neu: neu <= -200 ? -200 : Math.min(FADER_MAX, Math.max(-200, Math.round((neu + trim) * 1e6) / 1e6)) };
}
// the two tracks a stem group blends: its audio track (the original) and its instrument track (the new path); null while the group lacks either
export function blendPfad(p: { spuren: Spur[] }, gruppeId: string): { original: Spur; neu: Spur } | null {
  const kinder = p.spuren.filter((s) => s.ausgang?.id === gruppeId);
  const original = kinder.find((s) => s.art === 'audio'), neu = kinder.find((s) => s.art === 'instrument');
  return original && neu ? { original, neu } : null;
}
export const kettenLanen_ = (st: { automation?: Lane[] }): number => (st.automation ?? []).filter((l) => istKettenZiel(l.ziel)).length;
/** the lanes of a strip that drive its chain or rack */
export const kettenLanen = (strang: { automation?: Lane[] }): Lane[] => (strang.automation ?? []).filter((l) => istKettenZiel(l.ziel));
// Prüfung einer Lane (Modell und Befehle teilen sie): null = gültig, sonst Grund (der Befehls-Grund) und Text.
// `strang` (1.12 slice 6): the strip that carries the lane; a chain target needs it (the stage and its parameter are looked up there)
export function lanePruefung(l: unknown, strang?: { inserts?: Insert[]; rack?: Rack; sends?: Send[] }): { grund: string; text: string } | null {
  const ab = (grund: string, text: string) => ({ grund, text });
  if (!istObjekt(l)) return ab('argument_ungueltig', 'lane: Objekt erwartet');
  for (const k of Object.keys(l)) if (k !== 'id' && k !== 'ziel' && k !== 'punkte' && k !== 'gesperrt') return ab('argument_unbekannt', `lane.${k}`);
  for (const k of ['id', 'ziel', 'punkte']) if (!(k in l)) return ab('argument_ungueltig', `lane.${k}: fehlt`);
  if (typeof l.id !== 'string' || !ID.test(l.id)) return ab('argument_ungueltig', 'lane.id: ID erwartet');
  let bereich: ZielBereich | undefined;
  if (istKettenZiel(l.ziel)) {
    const b = strang ? kettenZielBereich(strang, l.ziel) : null;
    if (!b) return ab('ziel_unbekannt', `lane.ziel: ${l.ziel} is no stage parameter or macro of this strip`);
    bereich = b;
  } else if (istBlendZiel(l.ziel)) {
    bereich = BLEND_BEREICH;
  } else if (istSendZiel(l.ziel)) {
    const b = strang ? sendZielBereich(strang, l.ziel) : null;
    if (!b) return ab('ziel_unbekannt', `lane.ziel: ${l.ziel}: this strip has no send into the return ${sendZielVon(l.ziel)}`);
    bereich = b;
  } else if (istPluginZiel(l.ziel)) {
    const b = strang ? pluginZielBereich(strang, l.ziel) : null;
    if (!b) return ab('ziel_unbekannt', `lane.ziel: ${l.ziel}: this strip has no host stage ${pluginZielVon(l.ziel)!.insert}`);
    bereich = b;
  } else if (!(AUTO_ZIELE as readonly unknown[]).includes(l.ziel)) {
    return ab('ziel_unbekannt',
      `lane.ziel: ${AUTO_ZIELE.join(' | ')} or insert.<id>.<param> or rack.m1..m4 or send.<return id> or plugin.<host stage id>.<index> expected`);
  }
  if ('gesperrt' in l && l.gesperrt !== true) return ab('argument_ungueltig', 'lane.gesperrt: true expected (an unlocked lane has no key)');
  return punktePruefung(l.punkte, l.ziel as string, bereich);
}
// E2: a point on a mute/solo lane without `form` is `sprung`; fader, pan and geraet.* points are left as they are
export function normalisiereLane(l: Lane): void {
  if (Object.hasOwn(ZIEL_BEREICH, l.ziel) && ZIEL_BEREICH[l.ziel as Ziel].nurSprung) for (const q of l.punkte) q.form ??= 'sprung';
}
// the one range rule of a lane value (used by the lane check below and by the take entry of the session): switches take 0 or 1 only
export const wertImBereich = (ziel: string, wert: unknown, bereich: ZielBereich = ZIEL_BEREICH[ziel as Ziel]): boolean => {
  const { min, max, nurSprung } = bereich;
  return typeof wert === 'number' && Number.isFinite(wert) && wert >= min && wert <= max && (!nurSprung || wert === 0 || wert === 1);
};
export function punktePruefung(pk: unknown, ziel: string, bereich: ZielBereich = ZIEL_BEREICH[ziel as Ziel]): { grund: string; text: string } | null {
  const ab = (grund: string, text: string) => ({ grund, text });
  if (!Array.isArray(pk) || pk.length < 1) return ab('punkte_ungueltig', 'punkte: mindestens ein Punkt erwartet (use auto_loeschen)');
  if (pk.length > MAX_LANE_PUNKTE) return ab('zu_gross', `punkte: höchstens ${MAX_LANE_PUNKTE} je Lane`);
  const { min, max, nurSprung } = bereich;
  let gleich = 0;
  for (let i = 0; i < pk.length; i++) {
    const x = pk[i];
    if (!istObjekt(x)) return ab('argument_ungueltig', `punkte[${i}]: Objekt erwartet`);
    for (const k of Object.keys(x)) if (k !== 'beat' && k !== 'wert' && k !== 'form') return ab('argument_unbekannt', `punkte[${i}].${k}`);
    if (!zahl(x.beat) || x.beat < 0 || x.beat > MAX_BEAT) return ab('argument_ungueltig', `punkte[${i}].beat: Zahl 0..${MAX_BEAT} erwartet`);
    if (!zahl(x.wert) || !wertImBereich(ziel, x.wert, bereich)) {
      return ab('argument_ungueltig', `punkte[${i}].wert: ${nurSprung ? '0 or 1' : `number ${min}..${max}`} expected`);
    }
    if ('form' in x && !(AUTO_FORMEN as readonly unknown[]).includes(x.form)) {
      return ab('argument_ungueltig', `punkte[${i}].form: ${AUTO_FORMEN.join(' | ')} erwartet`);
    }
    if (nurSprung && 'form' in x && x.form !== 'sprung') return ab('punkte_ungueltig', `punkte[${i}].form: ${ziel} points are always sprung`);
    if (i > 0) {
      const v = pk[i - 1] as Record<string, number>;
      if (x.beat < v.beat) return ab('punkte_ungueltig', `punkte[${i}].beat: aufsteigend erwartet`);
      gleich = x.beat === v.beat ? gleich + 1 : 0;
      if (gleich >= 2) return ab('punkte_ungueltig', `punkte[${i}].beat: höchstens zwei Punkte am gleichen Beat`);
    }
  }
  return null;
}

// MidiClip.zeilen: {"<pitch>": {schritte?: 1..128, swing?: 1..100, richtung?: "pendel"}}, at most MAX_ZEILEN entries, no entry without a field,
// never an empty object
function pruefeZeilen(x: unknown, wo: string): void {
  if (!istObjekt(x) || Array.isArray(x)) werfe(wo, 'object expected');
  const ks = Object.keys(x as object);
  if (ks.length < 1 || ks.length > MAX_ZEILEN) werfe(wo, `1..${MAX_ZEILEN} entries expected (absent when there are none)`);
  for (const k of ks) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(k) || Number(k) > 127) werfe(`${wo}.${k}`, 'pitch 0..127 as the key expected');
    const o = felder((x as Record<string, unknown>)[k], `${wo}.${k}`, [], ['schritte', 'swing', 'richtung']);
    if (Object.keys(o).length === 0) werfe(`${wo}.${k}`, 'an entry without a field does not exist');
    if ('schritte' in o) zahlIn(o.schritte, `${wo}.${k}.schritte`, 1, 128, true);
    if ('swing' in o) zahlIn(o.swing, `${wo}.${k}.swing`, 1, 100, true);
    if ('richtung' in o && o.richtung !== 'pendel') werfe(`${wo}.${k}.richtung`, '"pendel" expected');
  }
}

function pruefeNote(n: unknown, wo: string): Note {
  const o = felder(n, wo, ['id', 'beat', 'laenge', 'ton', 'vel'], ['chance', 'wdh', 'versatz', 'spalte', 'platz']);
  if ('spalte' in o) zahlIn(o.spalte, `${wo}.spalte`, 2, 8, true);
  if ('platz' in o) zahlIn(o.platz, `${wo}.platz`, 1, 32, true);
  if ('chance' in o) zahlIn(o.chance, `${wo}.chance`, 1, 99, true);
  if ('wdh' in o) zahlIn(o.wdh, `${wo}.wdh`, 2, 8, true);
  if ('versatz' in o) { zahlIn(o.versatz, `${wo}.versatz`, -95, 95, true); if (o.versatz === 0) werfe(`${wo}.versatz`,
    'whole number -95..95 without 0 expected'); }
  if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${wo}.id`, 'ID erwartet');
  zahlIn(o.beat, `${wo}.beat`, 0, MAX_BEAT);
  if (!zahl(o.laenge) || o.laenge <= 0 || o.laenge > MAX_BEAT) werfe(`${wo}.laenge`, 'Zahl > 0 erwartet');
  zahlIn(o.ton, `${wo}.ton`, 0, 127, true); zahlIn(o.vel, `${wo}.vel`, 1, 127, true);
  return o as unknown as Note;
}

// 1.16 rest (F8): a preset origin is a register id
const presetIdIn = (x: unknown, wo: string): void => {
  if (typeof x !== 'string' || !PRESET_ID.test(x)) werfe(wo, 'preset id <werk|nutzer>:<geraet>/<slug> expected');
};
// 1.9 U7: the zone pair [lo, hi] of a rack member, whole numbers lo <= hi inside min..max
function pruefeZone(x: unknown, wo: string, min: number, max: number): void {
  if (!Array.isArray(x) || x.length !== 2) werfe(wo, 'pair [lo, hi] expected');
  const [lo, hi] = x as unknown[];
  zahlIn(lo, `${wo}[0]`, min, max, true); zahlIn(hi, `${wo}[1]`, min, max, true);
  if ((lo as number) > (hi as number)) werfe(wo, `lo <= hi expected (${lo} > ${hi})`);
}
function pruefeRackGeraet(g: unknown, wo: string, neu2: boolean): RackGeraet {
  const r = felder(g, wo, ['art', 'glieder', 'kette']);
  if (!neu2) werfe(`${wo}.art`, `rack devices exist only from ${FORMAT} on`);
  zahlIn(r.kette, `${wo}.kette`, 0, 127, true);
  if (!Array.isArray(r.glieder) || r.glieder.length < 1 || r.glieder.length > MAX_GLIEDER) werfe(`${wo}.glieder`, `1..${MAX_GLIEDER} members expected`);
  const ids = new Set<string>();
  (r.glieder as unknown[]).forEach((gx, i) => {
    const w = `${wo}.glieder[${i}]`;
    const m = felder(gx, w, ['id', 'geraet'], ['ton', 'vel', 'kette', 'gain_db']);
    if (typeof m.id !== 'string' || !GLIED_ID.test(m.id)) werfe(`${w}.id`, 'member id g1..g4 expected');
    if (ids.has(m.id)) werfe(`${w}.id`, `duplicate (${m.id})`);
    ids.add(m.id);
    if (istObjekt(m.geraet) && m.geraet.art === 'rack') werfe(`${w}.geraet`, 'a rack does not nest');
    if (istObjekt(m.geraet) && m.geraet.art === 'wirt' && 'parameter' in m.geraet) {
      werfe(`${w}.geraet.parameter`, 'surge member parameters are not mirrored in 1.9');
    }
    if (istObjekt(m.geraet) && m.geraet.art === 'wirt' && m.geraet.name === 'plugin') werfe(`${w}.geraet`, 'a plugin instrument is no rack member');
    if (istObjekt(m.geraet) && m.geraet.art === 'wirt' && 'patch' in m.geraet) werfe(`${w}.geraet.patch`, 'a surge member does not take a patch in 1.9');
    pruefeGeraet(m.geraet, `${w}.geraet`, neu2, true);
    if ('ton' in m) pruefeZone(m.ton, `${w}.ton`, 0, 127);
    if ('vel' in m) pruefeZone(m.vel, `${w}.vel`, 1, 127);
    if ('kette' in m) pruefeZone(m.kette, `${w}.kette`, 0, 127);
    if ('gain_db' in m) zahlIn(m.gain_db, `${w}.gain_db`, GLIED_GAIN_MIN, GLIED_GAIN_MAX);
  });
  return r as unknown as RackGeraet;
}
// plan 1.11 task 17: the device of a plugin instrument track (format /2 only, like the other devices that came after /1)
function pruefePluginGeraet(g: Record<string, unknown>, wo: string, neu2: boolean): Geraet {
  if (!neu2) werfe(`${wo}.name`, `unbekanntes Feld (Plugin-Instrumente gibt es erst ab ${FORMAT})`);
  const o = felder(g, wo, ['art', 'name', 'slot', 'plugin', 'zustand']);
  zahlIn(o.slot, `${wo}.slot`, 1, WIRT_SLOTS, true);
  pruefeHostPlugin(o.plugin, `${wo}.plugin`);
  if (typeof o.zustand !== 'string' || !/^plugins\/s[0-9]+\.carxs$/.test(o.zustand)) werfe(`${wo}.zustand`, 'plugins/<track id>.carxs expected');
  return o as unknown as Geraet;
}
export function pruefeGeraet(g: unknown, wo: string, neu2: boolean, imGlied = false): Geraet {
  if (!istObjekt(g)) return werfe(wo, 'Objekt erwartet');
  if (g.art === 'rack') return pruefeRackGeraet(g, wo, neu2);
  if (g.art === 'intern') {
    if (g.name === 'kit') {                                                    // 1.9 (L25): /2 only, like takes and warp
      const k = felder(g, wo, ['art', 'name', 'kit']);
      if (!neu2) werfe(`${wo}.name`, `kit devices exist only from ${FORMAT} on`);
      if (typeof k.kit !== 'string' || !KIT_NAME.test(k.kit)) werfe(`${wo}.kit`, 'kit name expected ([a-z0-9_-], 1..32 characters)');
      return k as unknown as Geraet;
    }
    if (g.name === 'bk') {                                                     // Baukasten S20
      const b = felder(g, wo, ['art', 'name', 'graph', 'parameter'], ['preset', 'stifte']);
      if ('preset' in b) presetIdIn(b.preset, `${wo}.preset`);
      if ('stifte' in b) {   // Kraken patch field: /2 only, a track device only (a rack member plays the graph defaults)
        if (!neu2) werfe(`${wo}.stifte`, `unbekanntes Feld (Steckfeld-Stifte gibt es erst ab ${FORMAT})`);
        if (imGlied) werfe(`${wo}.stifte`, 'pins are not stored on a rack member (it plays the graph default pins)');
        const f = stiftFehler(b.stifte);
        if (f !== null) werfe(`${wo}.stifte`, f);
      }
      if (typeof b.graph !== 'string' || !BK_GRAPH_NAME.test(b.graph)) werfe(`${wo}.graph`, 'graph name expected ([a-z0-9_-], 1..32 characters)');
      if (!istObjekt(b.parameter)) werfe(`${wo}.parameter`, 'Objekt erwartet');
      for (const [k, v] of Object.entries(b.parameter as Record<string, unknown>)) {
        if (!BK_PARAMETER.includes(k)) werfe(`${wo}.parameter.${k}`, `unknown knob (allowed: ${BK_PARAMETER.join(', ')})`);
        zahlIn(v, `${wo}.parameter.${k}`, 0, 1);
      }
      return b as unknown as Geraet;
    }
    const o = felder(g, wo, ['art', 'name', 'parameter'], ['preset']);
    if (o.name !== 'rb338') werfe(`${wo}.name`, 'rb338, bk or kit expected');
    if ('preset' in o) presetIdIn(o.preset, `${wo}.preset`);
    if (!istObjekt(o.parameter)) werfe(`${wo}.parameter`, 'Objekt erwartet');
    for (const [k, v] of Object.entries(o.parameter as Record<string, unknown>)) {
      if (!RB_PARAMETER.includes(k)) werfe(`${wo}.parameter.${k}`, `unbekannter Parameter (erlaubt: ${RB_PARAMETER.join(', ')})`);
      zahlIn(v, `${wo}.parameter.${k}`, 0, 1);
    }
    return o as unknown as Geraet;
  }
  if (g.art === 'wirt') {
    if (istObjekt(g) && g.name === 'plugin') return pruefePluginGeraet(g, wo, neu2);
    const o = felder(g, wo, ['art', 'name', 'slot'], ['parameter', 'patch']);
    if (o.name !== 'surge') werfe(`${wo}.name`, 'surge erwartet');
    zahlIn(o.slot, `${wo}.slot`, 1, WIRT_SLOTS, true);
    if ('patch' in o) {                                                        // optional like parameter: the format stays /2, a /1 file never carries it
      if (!neu2) werfe(`${wo}.patch`, `unbekanntes Feld (Surge-Patch gibt es erst ab ${FORMAT})`);
      if (!istPatchName(o.patch)) werfe(`${wo}.patch`, 'library name of a Surge patch expected');
    }
    if ('parameter' in o) {                                                    // 1.9 U5: /2 only, like takes, warp and kit devices
      if (!neu2) werfe(`${wo}.parameter`, `unbekanntes Feld (Surge-Parameter gibt es erst ab ${FORMAT})`);
      if (!istObjekt(o.parameter) || Array.isArray(o.parameter)) werfe(`${wo}.parameter`, 'Objekt erwartet');
      const eintraege = Object.entries(o.parameter as Record<string, unknown>);
      if (eintraege.length > SURGE_PARAMETER_MAX) werfe(`${wo}.parameter`, `at most ${SURGE_PARAMETER_MAX} entries`);
      for (const [k, v] of eintraege) {
        if (!SURGE_NAME.test(k)) werfe(`${wo}.parameter.${k}`, 'Surge parameter name expected ([a-z][a-z0-9_], 1..48 characters)');
        if (!zahl(v)) werfe(`${wo}.parameter.${k}`, 'endliche Zahl erwartet');
      }
    }
    return o as unknown as Geraet;
  }
  return werfe(`${wo}.art`, 'intern, wirt or rack expected');
}

export function pruefeFreeze(f: unknown, wo: string): void {
  const o = felder(f, wo, ['datei', 'frames', 'kennung', 'sha256'], ['von_beat']);
  if (typeof o.datei !== 'string' || !o.datei || o.datei.startsWith('/') || o.datei.split('/').includes('..')) {
    werfe(`${wo}.datei`, 'relativer Pfad im Arbeitsordner erwartet');
  }
  zahlIn(o.frames, `${wo}.frames`, 1, 2 ** 40, true);
  zahlIn(o.kennung, `${wo}.kennung`, 0, KENNUNG_MAX, true);
  if (typeof o.sha256 !== 'string' || !SHA.test(o.sha256)) werfe(`${wo}.sha256`, '64 Hex-Zeichen (klein) erwartet');
  if ('von_beat' in o) zahlIn(o.von_beat, `${wo}.von_beat`, 0, MAX_BEAT);
}

function pruefeLoop(o: Record<string, unknown>, wo: string): void {
  if (!('loop_beats' in o) || o.loop_beats === null) return;
  if (!zahl(o.loop_beats) || o.loop_beats < LOOP_MIN || o.loop_beats > (o.laenge_beats as number) + 1e-9) {
    werfe(`${wo}.loop_beats`, 'null oder Zahl von 1/16 bis laenge_beats erwartet');
  }
}

// 1.12 slice 5 (D7): clip envelopes, /2 only; spur (when known) for the RB-338 rule of geraet.* envelopes
function pruefeHuellkurven(o: Record<string, unknown>, wo: string, warpErlaubt: boolean, spur: { art: string; geraet?: unknown } | null): void {
  if (!('huellkurven' in o)) return;
  if (!warpErlaubt) werfe(`${wo}.huellkurven`, `unknown field (huellkurven exist only from ${FORMAT} on)`);
  const f = huellkurvenPruefung(o.huellkurven, o as { art: string; laenge_beats: number }, spur);
  if (f) werfe(`${wo}.huellkurven`, f.text);
}
export function pruefeClip(c: unknown, wo: string, spurArt: string, warpErlaubt: boolean, spur: { art: string; geraet?: unknown } | null = null): Clip {
  if (!istObjekt(c)) return werfe(wo, 'Objekt erwartet');
  if (c.art !== (spurArt === 'audio' ? 'audio' : 'midi')) werfe(`${wo}.art`, `passt nicht zur ${spurArt}-Spur`);
  const basis = ['id', 'art', 'name', 'start_beat', 'laenge_beats'];
  if (c.art === 'audio') {
    const o = felder(c, wo, [...basis, 'quelle', 'dekodiert', 'offset_s', 'gain_db', 'fade_ein_beats', 'fade_aus_beats'],
      ['loop_beats', 'warp', 'stumm', 'entstehung', 'huellkurven', 'audio_noten']);
    if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${wo}.id`, 'ID erwartet');
    text(o.name, `${wo}.name`, 80);
    zahlIn(o.start_beat, `${wo}.start_beat`, 0, MAX_BEAT);
    if (!zahl(o.laenge_beats) || o.laenge_beats <= 0 || o.laenge_beats > MAX_BEAT) werfe(`${wo}.laenge_beats`, 'Zahl > 0 erwartet');
    const q = felder(o.quelle, `${wo}.quelle`, ['sha256', 'pfad_hinweis']);
    if (typeof q.sha256 !== 'string' || !SHA.test(q.sha256)) werfe(`${wo}.quelle.sha256`, '64 Hex-Zeichen (klein) erwartet');
    if (typeof q.pfad_hinweis !== 'string' || q.pfad_hinweis.length > 4096) werfe(`${wo}.quelle.pfad_hinweis`, 'Text erwartet');
    if (!DEKODIERT.includes(o.dekodiert as DekodiertZustand)) werfe(`${wo}.dekodiert`, `${DEKODIERT.join('|')} erwartet`);
    zahlIn(o.offset_s, `${wo}.offset_s`, 0, 1e7); zahlIn(o.gain_db, `${wo}.gain_db`, GAIN_MIN, GAIN_MAX);
    const ein = zahlIn(o.fade_ein_beats, `${wo}.fade_ein_beats`, 0, MAX_BEAT), aus = zahlIn(o.fade_aus_beats, `${wo}.fade_aus_beats`, 0, MAX_BEAT);
    if (ein + aus > (o.laenge_beats as number) + 1e-9) werfe(`${wo}.fade`, 'Ein- plus Ausblende länger als der Clip');
    pruefeLoop(o, wo);
    if (o.stumm !== undefined && typeof o.stumm !== 'boolean') werfe(`${wo}.stumm`, 'true oder false erwartet');
    if ('warp' in o) {                                          // in /1 ist jedes warp-Feld unbekannt, auch null (N4-6)
      if (!warpErlaubt) werfe(`${wo}.warp`, `unbekanntes Feld (Warp gibt es erst ab ${FORMAT})`);
      const f = o.warp === null ? null : warpPruefung(o.warp);
      if (f) werfe(`${wo}.warp`, f.text);
    }
    if ('entstehung' in o) {                                    // S15: like warp, /2 only
      if (!warpErlaubt) werfe(`${wo}.entstehung`, `unbekanntes Feld (entstehung gibt es erst ab ${FORMAT})`);
      const f = entstehungPruefung(o.entstehung);
      if (f) werfe(`${wo}.entstehung`, f.text);
    }
    if ('audio_noten' in o) {                                   // note editor: like entstehung, /2 and /3 only (an older build refuses it as an unknown field)
      if (!warpErlaubt) werfe(`${wo}.audio_noten`, `unbekanntes Feld (audio_noten gibt es erst ab ${FORMAT_ALT2})`);
      const f = audioNotenPruefung(o.audio_noten);
      if (f) werfe(`${wo}.audio_noten`, f.text);
    }
    pruefeHuellkurven(o, wo, warpErlaubt, spur);
    return o as unknown as Clip;
  }
  const o = felder(c, wo, [...basis, 'noten'], ['loop_beats', 'naechste_noten_id', 'huellkurven', 'muster', 'seq', 'zeilen', 'verbund', 'fx']);
  if ('verbund' in o) {                                         // tracker patterns: /2 only, like seq
    if (!warpErlaubt) werfe(`${wo}.verbund`, `unknown field (verbund exists only from ${FORMAT} on)`);
    if (typeof o.verbund !== 'string' || !VERBUND_ID.test(o.verbund)) werfe(`${wo}.verbund`, 'v<1..9 digits> expected');
  }
  if ('fx' in o) {                                              // tracker effect commands: /2 only, like verbund
    if (!warpErlaubt) werfe(`${wo}.fx`, `unknown field (fx exists only from ${FORMAT} on)`);
    const f = fxPruefung(o.fx);
    if (f) werfe(`${wo}.fx`, f.text);
  }
  if ('zeilen' in o) pruefeZeilen(o.zeilen, `${wo}.zeilen`);
  if ('seq' in o) {                                             // SEQ view descriptor: like muster, /2 only
    if (!warpErlaubt) werfe(`${wo}.seq`, `unknown field (seq exists only from ${FORMAT} on)`);
    const f = seqSichtPruefung(o.seq);
    if (f) werfe(`${wo}.seq`, f.text);
  }
  if ('muster' in o) {                                          // strudel-clip: like huellkurven, /2 only
    if (!warpErlaubt) werfe(`${wo}.muster`, `unknown field (muster exists only from ${FORMAT} on)`);
    const f = musterPruefung(o.muster);
    if (f) werfe(`${wo}.muster`, f.text);
  }
  if ('naechste_noten_id' in o) zahlIn(o.naechste_noten_id, `${wo}.naechste_noten_id`, 1, Number.MAX_SAFE_INTEGER, true);
  if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${wo}.id`, 'ID erwartet');
  text(o.name, `${wo}.name`, 80);
  zahlIn(o.start_beat, `${wo}.start_beat`, 0, MAX_BEAT);
  if (!zahl(o.laenge_beats) || o.laenge_beats <= 0 || o.laenge_beats > MAX_BEAT) werfe(`${wo}.laenge_beats`, 'Zahl > 0 erwartet');
  pruefeLoop(o, wo);
  if (!Array.isArray(o.noten)) werfe(`${wo}.noten`, 'Liste erwartet');
  const ids = new Set<string>();
  (o.noten as unknown[]).forEach((n, i) => {
    const note = pruefeNote(n, `${wo}.noten[${i}]`);
    if (ids.has(note.id)) werfe(`${wo}.noten[${i}].id`, `doppelt (${note.id})`);
    ids.add(note.id);
  });
  pruefeHuellkurven(o, wo, warpErlaubt, spur);
  return o as unknown as MidiClip;
}

// 1.10 slice 3: sends of a track or group (only /2): a non-empty list, one entry per return, db > -200 up to +6, the id syntax checked here and the
// reference to an existing return in pruefeAlles
export function pruefeSends(x: unknown, wo: string, erlaubt: boolean): Send[] {
  if (!erlaubt) return werfe(wo, `unbekanntes Feld (Sends gibt es erst ab ${FORMAT})`);
  if (!Array.isArray(x) || x.length < 1) return werfe(wo, 'nicht leere Liste erwartet (fehlt bei keinem Send)');
  if (x.length > MAX_RETURNS) werfe(wo, `höchstens ${MAX_RETURNS} Sends`);
  const ids = new Set<string>();
  x.forEach((sx, i) => {
    const o = felder(sx, `${wo}[${i}]`, ['id', 'db']);
    if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${wo}[${i}].id`, 'ID erwartet');
    if (ids.has(o.id as string)) werfe(`${wo}[${i}].id`, `doppelt (${o.id})`);
    ids.add(o.id as string);
    if (!zahl(o.db) || o.db <= FADER_MIN || o.db > FADER_MAX) {
      werfe(`${wo}[${i}].db`, `Zahl über ${FADER_MIN} bis ${FADER_MAX} erwartet (${FADER_MIN} entfernt den Eintrag)`);
    }
  });
  return x as Send[];
}

// 1.10 slice 5: the structural key of a stage, closed fields. Form only: the number ranges and the DJ list; the references are checked in pruefeAlles,
// the rules (zyklus, spaet, quelle)
// by the commands (project/routing_rules.ts).
function pruefeSchluessel(x: unknown, wo: string, art: InsertPoolArt, hatSc: boolean): void {
  if (art !== 'komp' && art !== 'eq' && art !== 'mb' && art !== 'host') {
    werfe(wo, 'unknown field (only the compressor, the EQ, the multiband and a host stage have a key)');
  }
  if (hatSc) werfe(wo, 'sc and key exclude each other (a stage has one key at most)');
  const k = felder(x, wo, ['quelle', 'nr', 'punkt']);
  if (!(SCHLUESSEL_QUELLEN as readonly unknown[]).includes(k.quelle)) werfe(`${wo}.quelle`, `${SCHLUESSEL_QUELLEN.join(' | ')} expected`);
  if (k.punkt !== 'pre' && k.punkt !== 'post') werfe(`${wo}.punkt`, 'pre | post expected');
  const quelle = k.quelle as SchluesselQuelle;
  const max = quelle === 'spur' ? MAX_SPUREN : quelle === 'grp' ? MAX_GRUPPEN : quelle === 'ret' ? MAX_RETURNS : 0;
  if (max > 0) zahlIn(k.nr, `${wo}.nr`, 1, max, true);
  else {                                                  // DJ input: only what the generated rules list as 'ja', and its point is 'post'
    zahlIn(k.nr, `${wo}.nr`, 1, 99, true);
    const nr = k.nr as number;
    if (!SCHLUESSEL_DJ.some((e) => e.quelle === quelle && nr >= e.von && nr <= e.bis && e.antwort === 'ja')) werfe(wo, `${quelle}/${nr} cannot be a key`);
    if (k.punkt !== 'post') werfe(`${wo}.punkt`, 'a DJ input has the point post only');
  }
  if (SCHLUESSEL_NUR_ZEILE.some((z) => z.quelle === quelle && z.punkt === k.punkt)) {
    werfe(wo, `${quelle} ${k.punkt} is the row sc, not a key (one writer per pair)`);
  }
}

// plan 1.11 task 7: the identity and files of a host stage. The path may hold any character but a control character (it travels on a command line as
// <format>:<path>#<uid>), the uid any printable text
// but '#' (a VST3 class id or a plugin label such as "A/B Tester x2 Mono"; it may be empty for LV2, where the path is the URI).
export const HOST_PFAD_ZEICHEN = /^[^\u0000-\u001f\u007f]{1,1024}$/;
export const HOST_UID_ZEICHEN = /^[^\u0000-\u001f\u007f#]{0,256}$/;   // any printable text but '#': the spec is split at the LAST '#'
function pruefeHostPlugin(x: unknown, wo: string): void {
  const pl = felder(x, wo, ['format', 'pfad', 'uid', 'name']);
  if (pl.format !== 'vst3' && pl.format !== 'lv2') werfe(`${wo}.format`, 'vst3 | lv2 erwartet');
  if (typeof pl.pfad !== 'string' || !HOST_PFAD_ZEICHEN.test(pl.pfad)) werfe(`${wo}.pfad`, 'Pfad ohne Steuerzeichen erwartet');
  if (typeof pl.uid !== 'string' || !HOST_UID_ZEICHEN.test(pl.uid) || (pl.format === 'vst3' && pl.uid === '')) werfe(`${wo}.uid`, 'uid erwartet');
  text(pl.name, `${wo}.name`, 128);
}
function pruefeHostFelder(o: Record<string, unknown>, w: string): void {
  pruefeHostPlugin(o.plugin, `${w}.plugin`);
  if (o.zustand !== `plugins/${String(o.id)}.carxs`) werfe(`${w}.zustand`, `plugins/<id>.carxs erwartet`);
  if (Object.keys(o.werte as object).length) werfe(`${w}.werte`, 'eine Host-Stufe hat keine Werte');
  if ('latenz_extra' in o) zahlIn(o.latenz_extra, `${w}.latenz_extra`, 1, MAX_LATENZ_EXTRA, true);   // 0 is stored as an absent field
  if ('regler' in o) pruefePluginRegler(o.regler, `${w}.regler`);
  if ('sc' in o) werfe(`${w}.sc`, 'unbekanntes Feld (nur der Kompressor hat einen Zeilenschlüssel)');
  if ('key' in o) pruefeSchluessel(o.key, `${w}.key`, 'host', false);   // strand 2 task 3.4: the plugin's inputs 3 and 4 (the command checks the index)
}
// strand 2 task 2.2: the knobs of a host stage. regler[m-1] is the plugin parameter index that knob m (core row plug/<slot>/k<m>) drives, null = knob m
// is free. At most MAX_PLUGIN_REGLER entries, no index twice, canonical form: never empty, never a trailing null (absent = no knobs, so an untouched
// stage keeps its bytes). The knob moves reach the plugin through the page server, never through the core.
export const MAX_PLUGIN_REGLER = 16;
export const MAX_PLUGIN_INDEX = 99999;
function pruefePluginRegler(x: unknown, wo: string): void {
  if (!Array.isArray(x) || x.length < 1 || x.length > MAX_PLUGIN_REGLER) werfe(wo, `list of 1..${MAX_PLUGIN_REGLER} entries expected`);
  const arr = x as unknown[];
  if (arr[arr.length - 1] === null) werfe(wo, 'no trailing null (an unassigned last knob is left out)');
  const da = new Set<number>();
  arr.forEach((v, i) => {
    if (v === null) return;
    zahlIn(v, `${wo}[${i}]`, 0, MAX_PLUGIN_INDEX, true);
    if (da.has(v as number)) werfe(`${wo}[${i}]`, `index ${String(v)} has another knob already`);
    da.add(v as number);
  });
}

// 1.10 slice 4: the chain of a strip (only /2): a non-empty list of at most MAX_INSERTS_PRO_STRANG stages with closed fields. Uniqueness of IDs and
// slots over the whole project is checked in pruefeAlles.
export function pruefeInserts(x: unknown, wo: string, erlaubt: boolean): Insert[] {
  if (!erlaubt) return werfe(wo, `unbekanntes Feld (Inserts gibt es erst ab ${FORMAT})`);
  if (!Array.isArray(x) || x.length < 1) return werfe(wo, 'nicht leere Liste erwartet (fehlt bei keiner Stufe)');
  if (x.length > MAX_INSERTS_PRO_STRANG) werfe(wo, `höchstens ${MAX_INSERTS_PRO_STRANG} Stufen`);
  x.forEach((ix, i) => {
    const w = `${wo}[${i}]`;
    const o = felder(ix, w, ['id', 'art', 'slot', 'an', 'werte'], ['sc', 'key', 'preset', 'plugin', 'zustand', 'latenz_extra', 'graph', 'regler']);
    if ('preset' in o) presetIdIn(o.preset, `${w}.preset`);
    if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${w}.id`, 'ID erwartet');
    if (o.art !== 'host' && !(INSERT_ARTEN_AKTIV as readonly unknown[]).includes(o.art)) {
      werfe(`${w}.art`, `${[...INSERT_ARTEN_AKTIV, 'host'].join(' | ')} erwartet`);
    }
    if (o.art === 'host') pruefeHostFelder(o, w);
    else for (const k of ['plugin', 'zustand', 'latenz_extra', 'regler']) if (k in o) werfe(`${w}.${k}`, 'unbekanntes Feld (nur eine Host-Stufe)');
    zahlIn(o.slot, `${w}.slot`, 1, MAX_INS[o.art as string], true);
    boolean(o.an, `${w}.an`);
    if (o.art === 'bk') {   // arr-bk: the graph is part of the stage
      if (typeof o.graph !== 'string' || !BK_GRAPH_NAME.test(o.graph)) werfe(`${w}.graph`, 'graph name expected ([a-z0-9_-], 1..32 characters)');
    } else if ('graph' in o) werfe(`${w}.graph`, 'unknown field (only a bk stage carries a graph)');
    const art = o.art as InsertPoolArt;
    if (art === 'host') { felder(o.werte, `${w}.werte`, []); return; }
    // a bk stage: k9..k64 are optional (an older project stores k1..k8 only, see modular.ts)
    const opt = art === 'bk' ? BK_INSERT_OPTIONAL : insertSpaeterNamen(art);   // bk k9..k64; eq dynamic bands and saett kurve/decke (insert_spaeter.ts)
    const ws = felder(o.werte, `${w}.werte`, insertWertNamen(art).filter((n) => !opt.includes(n)), [...opt]);
    for (const q of insertWertParameter(art)) if (q.name in ws) zahlIn(ws[q.name], `${w}.werte.${q.name}`, q.min, q.max, q.ganz);
    if ('sc' in o) {
      if (art !== 'komp' && art !== 'eq' && art !== 'mb') werfe(`${w}.sc`, 'unbekanntes Feld (nur Kompressor, EQ und Multiband haben einen Schlüssel)');
      zahlIn(o.sc, `${w}.sc`, 1, MAX_SPUREN, true);   // 0 is stored as an absent key
    }
    if ('key' in o) pruefeSchluessel(o.key, `${w}.key`, art, 'sc' in o);
  });
  return x as Insert[];
}

// 1.10 slice 4c: the rack of a strip, closed fields. The references into the chain, the uniqueness of the slot and the limits are checked in pruefeAlles.
export function pruefeRack(x: unknown, wo: string): Rack {
  const o = felder(x, wo, ['slot', 'namen', 'makros', 'werte'], ['variationen']);
  zahlIn(o.slot, `${wo}.slot`, 1, MAX_RACK, true);
  if ('variationen' in o) {
    const v = o.variationen;
    if (!Array.isArray(v) || v.length < 1 || v.length > MAX_VARIATIONEN) werfe(`${wo}.variationen`, `1..${MAX_VARIATIONEN} variations expected`);
    const namen = new Set<string>();
    (v as unknown[]).forEach((e, i) => {
      const w = `${wo}.variationen[${i}]`;
      const vo = felder(e, w, ['name', 'werte']);
      if (typeof vo.name !== 'string' || vo.name.length < 1 || vo.name.length > VARIATION_NAME_MAX) {
        werfe(`${w}.name`, `text 1..${VARIATION_NAME_MAX} characters expected`);
      }
      if (namen.has(vo.name as string)) werfe(`${w}.name`, `duplicate (${vo.name as string})`);
      namen.add(vo.name as string);
      if (!Array.isArray(vo.werte) || vo.werte.length !== MAX_MAKROS) werfe(`${w}.werte`, `${MAX_MAKROS} numbers expected`);
      (vo.werte as unknown[]).forEach((n, k) => zahlIn(n, `${w}.werte[${k}]`, 0, 1));
    });
  }
  if (!Array.isArray(o.namen) || o.namen.length !== MAX_MAKROS) werfe(`${wo}.namen`, `${MAX_MAKROS} Texte erwartet`);
  o.namen.forEach((n, i) => {
    if (typeof n !== 'string' || n.length > MAKRO_NAME_MAX) werfe(`${wo}.namen[${i}]`, `Text 0..${MAKRO_NAME_MAX} Zeichen erwartet`);
  });
  if (!Array.isArray(o.werte) || o.werte.length !== MAX_MAKROS) werfe(`${wo}.werte`, `${MAX_MAKROS} Zahlen erwartet`);
  o.werte.forEach((v, i) => zahlIn(v, `${wo}.werte[${i}]`, 0, 1));
  if (!Array.isArray(o.makros) || o.makros.length !== MAX_MAKROS) werfe(`${wo}.makros`, `${MAX_MAKROS} Makros erwartet`);
  o.makros.forEach((m, i) => {
    const mo = felder(m, `${wo}.makros[${i}]`, ['ziel']);
    if (!Array.isArray(mo.ziel)) werfe(`${wo}.makros[${i}].ziel`, 'Liste erwartet');
    mo.ziel.forEach((z, k) => {
      const wz = `${wo}.makros[${i}].ziel[${k}]`;
      const zo = istObjekt(z) && 'glied' in z ? felder(z, wz, ['glied', 'param', 'von', 'bis']) : felder(z, wz, ['insert', 'param', 'von', 'bis']);
      if ('glied' in zo) {
        if (typeof zo.glied !== 'string' || !GLIED_ID.test(zo.glied)) werfe(`${wz}.glied`, 'member id g1..g4 expected');
      } else if (typeof zo.insert !== 'string' || !ID.test(zo.insert)) werfe(`${wz}.insert`, 'ID erwartet');
      if (typeof zo.param !== 'string') werfe(`${wo}.makros[${i}].ziel[${k}].param`, 'Text erwartet');
      if (!zahl(zo.von)) werfe(`${wo}.makros[${i}].ziel[${k}].von`, 'Zahl erwartet');
      if (!zahl(zo.bis)) werfe(`${wo}.makros[${i}].ziel[${k}].bis`, 'Zahl erwartet');
    });
  });
  return x as Rack;
}

export function pruefeReturn(g: unknown, wo: string): Return {
  const o = felder(g, wo, ['id', 'nr', 'name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'hall'], ['pre', 'inserts', 'rack', 'automation', 'loopdeck',
    'strudel', 'gruppe']);
  if ('strudel' in o) {
    const l = felder(o.strudel, `${wo}.strudel`, ['art']);
    if (l.art !== 'hall' && l.art !== 'delay') werfe(`${wo}.strudel.art`, 'hall or delay expected');
    if ('loopdeck' in o) werfe(`${wo}.strudel`, 'a return belongs to a loop deck or to the strudel module, not both');
  }
  if ('gruppe' in o && (typeof o.gruppe !== 'string' || !ID.test(o.gruppe))) werfe(`${wo}.gruppe`, 'ID expected');
  if ('loopdeck' in o) {
    const l = felder(o.loopdeck, `${wo}.loopdeck`, ['platz', 'art']);
    if (l.platz !== 1 && l.platz !== 2) werfe(`${wo}.loopdeck.platz`, '1 or 2 expected');
    if (l.art !== 'hall' && l.art !== 'delay') werfe(`${wo}.loopdeck.art`, 'hall or delay expected');
  }
  if ('pre' in o && o.pre !== true) werfe(`${wo}.pre`, 'true erwartet (fehlt bei post)');
  if ('inserts' in o) pruefeInserts(o.inserts, `${wo}.inserts`, true);   // returns exist only in /2
  if ('rack' in o) pruefeRack(o.rack, `${wo}.rack`);
  // after the chain and rack checks: it looks them up
  if ('automation' in o) pruefeLanen(o.automation, wo, o as { inserts?: Insert[]; rack?: Rack }, undefined, 'return');
  if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${wo}.id`, 'ID erwartet');
  zahlIn(o.nr, `${wo}.nr`, 1, MAX_RETURNS, true);
  text(o.name, `${wo}.name`, 80);
  if (typeof o.farbe !== 'string' || !FARBE.test(o.farbe)) werfe(`${wo}.farbe`, '#rrggbb erwartet');
  zahlIn(o.fader_db, `${wo}.fader_db`, FADER_MIN, FADER_MAX); zahlIn(o.pan, `${wo}.pan`, -1, 1);
  boolean(o.mute, `${wo}.mute`); boolean(o.solo, `${wo}.solo`);
  const h = felder(o.hall, `${wo}.hall`, ['an', ...HALL_FELDER]);
  boolean(h.an, `${wo}.hall.an`);
  for (const k of HALL_FELDER) zahlIn(h[k], `${wo}.hall.${k}`, 0, 1);
  return o as unknown as Return;
}

export function pruefeTake(t: unknown, wo: string, warpErlaubt: boolean, spurArt = 'audio'): Take {
  const o = felder(t, wo, ['id', 'name', 'clips'], ['art']);
  if (typeof o.id !== 'string' || !TAKE_ID.test(o.id)) werfe(`${wo}.id`, 't<n> expected');
  text(o.name, `${wo}.name`, TAKE_NAME_MAX);
  if ('art' in o && o.art !== 'original') werfe(`${wo}.art`, "'original' expected");
  if (!Array.isArray(o.clips)) werfe(`${wo}.clips`, 'list expected');
  (o.clips as unknown[]).forEach((c, i) => pruefeClip(c, `${wo}.clips[${i}]`, spurArt, warpErlaubt));
  return o as unknown as Take;
}

// The lane list of a strip (a track, group, return or the master): not empty, at most MAX_LANES_PRO_SPUR, every lane valid on THIS strip, no target twice.
// slice 2 (E3, 1.12): geraet.* only on tracks whose device owns the parameter (`geraet`; slice 7: RB-338 or bk);
// 1.12 slice 6: a chain target needs its stage or rack on this strip, and the
// parameter of a stage a macro drives has one writer (the macro), so it takes no lane (param_gemappt)
// Return fader lane (return automation slice 2): a return also takes its own `fader` lane (the volume of the return strip); the master and a group take no
// volume curve and no other device target, only chain lanes (and a stem group its blend lane)
export type StrangArt = 'spur' | 'return' | 'gruppe' | 'master';
type LaneStrang = { inserts?: Insert[]; rack?: Rack; sends?: Send[] };
export function pruefeLanen(automation: unknown, wo: string, strang: LaneStrang, geraet: unknown, art: StrangArt = 'spur'): void {
  const istSpur = art === 'spur';
  if (!Array.isArray(automation) || automation.length < 1) werfe(`${wo}.automation`, 'non-empty list expected (absent when there is no lane)');
  // plugin lanes never reach the core: they count against MAX_PLUGIN_LANEN per host stage (below), not against the strip's MAX_LANES_PRO_SPUR
  const kernLanen = (automation as unknown[]).filter((l) => !istPluginZiel((l as { ziel?: unknown } | null)?.ziel)).length;
  if (kernLanen > MAX_LANES_PRO_SPUR) werfe(`${wo}.automation`, `at most ${MAX_LANES_PRO_SPUR} lanes per track`);
  const ziele = new Set<unknown>();
  (automation as unknown[]).forEach((lx, i) => {
    const f = lanePruefung(lx, strang);
    if (f) werfe(`${wo}.automation[${i}]`, f.text);
    const ziel = (lx as Lane).ziel;
    if (istBlendZiel(ziel)) {
      if (istSpur || ziel !== `blend:${(strang as { id?: string }).id}`) {
        werfe(`${wo}.automation[${i}].ziel`, `${ziel}: only on the stem group it names (ziel_unbekannt)`);
      }
    } else if (!istSpur && !istKettenZiel(ziel) && !istPluginZiel(ziel) && !(art === 'return' && ziel === 'fader')) {   // (a send lane is a track's)
      werfe(`${wo}.automation[${i}].ziel`, ziel === 'fader'
        ? 'fader: the master and groups take no volume curve (ziel_unbekannt)'
        : `${ziel}: a group or master takes insert and rack lanes only, a return insert, rack and fader lanes (ziel_unbekannt)`);
    }
    if (istGeraetZiel(ziel) && !passtGeraetZiel(ziel, geraet)) {
      werfe(`${wo}.automation[${i}].ziel`, `${ziel}: only on a track with the device it belongs to (RB-338 parameters, bk k1 to k64)`);
    }
    const k = zerlegeKettenZiel(ziel);
    if (k && 'insert' in k && makroVon(strang as InsertTraeger, k.insert, k.param)) {
      werfe(`${wo}.automation[${i}].ziel`, `${ziel}: the parameter is driven by a rack macro (param_gemappt)`);
    }
    if (ziele.has(ziel)) werfe(`${wo}.automation[${i}].ziel`, `doppelt (${ziel})`);
    ziele.add(ziel);
  });
  for (const st of strang.inserts ?? []) {
    if (st.art === 'host' && pluginLanen({ automation: automation as Lane[] }, st.id).length > MAX_PLUGIN_LANEN) {
      werfe(`${wo}.automation`, `at most ${MAX_PLUGIN_LANEN} plugin lanes per host stage (${st.id}, plugin_lanen_voll)`);
    }
  }
}
