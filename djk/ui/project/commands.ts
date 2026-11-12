// Befehle der Projekt-API (Spec 3.4, Abschnitt „Befehle in aendern") als reine Funktionen: Projekt → {projekt, vor, zurueck,
// betrifft_wiedergabe, regler_aenderungen}. Kein Server, kein Kern, keine Datei. Eine Ablehnung ist ein BefehlFehler mit `grund`.
// Ein Befehl ist ein flaches Objekt {befehl: '<name>', ...argumente}; unbekannte Argumente werden abgelehnt (kein stilles Schlucken).
// Die Patches entstehen aus dem Vergleich der Stände vor und nach dem Befehl (patch.ts), nicht von Hand je Befehl; `zurueck` ist der
// Vergleich in der Gegenrichtung (neu → alt), nicht ein Klon samt Umkehr.
// Mixer- und Kopfbefehle (Fader, Pan, Mute, Solo, Name, Farbe, Tempo, Loop, Metronom) laufen auf einem flachen Entwurf: nur die
// berührte Spur wird flach kopiert, Clips und Noten werden geteilt, es gibt weder Volltiefen-Klon noch Wiedergabe-Vergleich. Das ist
// die Bewegung, die der Verlauf zusammenfasst (Spec 6.5); `{voll: true}` erzwingt den allgemeinen Weg (Test: beide ergeben dasselbe).
// `rev` und `wiedergabe_rev` fasst kein Befehl an: sie zählt der Verlauf (history.ts).
import {
  AUTO_ZIELE, MAX_AUTO_PUNKTE, MAX_LANE_PUNKTE, MAX_LANES_PRO_SPUR, MAX_KETTEN_LANEN,
  GERAET_PRAEFIX, BK_KNOPF_VORGABE, RB_VORGABE_NORM, istGeraetZiel, istRbGeraet, passtGeraetZiel, normalisiereLane, punktePruefung,
  istKettenZiel, zerlegeKettenZiel, kettenZielBereich, zielBereichVon, alleStraenge,
  type Lane, type Punkt, type Ziel,
  FADER_MAX, FADER_MIN, GAIN_MAX, GAIN_MIN, GRUPPE_MAX, INTERNE_EINGAENGE, LOOP_MIN, MAX_ARM_AUDIO, MAX_BEAT, MAX_CLIPS,
  MAX_GRUPPEN, MAX_NOTEN, MAX_RETURNS, MAX_SPUREN, HALL_FELDER, HALL_VORGABE,
  INSERT_ARTEN_AKTIV, insertWertParameter, type InsertPoolArt, MAX_INSERTS_PRO_STRANG, MAX_INS, alleInserts, insertVorgabe, sucheStrang,
  alleRacks, gliedMakroParam, glieder, istGliedZiel, istInsertZiel, makroFaehig, makroVon, MAKRO_NAME_MAX, MAX_MAKROS, MAX_MAKRO_ZIELE, MAX_RACK,
  MAX_VARIATIONEN, VARIATION_NAME_MAX, MUSTER_CODE_MAX,
  type Rack, type RackZiel,
  BK_GRAPH_NAME, BK_PARAMETER, KIT_NAME, RB_PARAMETER, SPUR_FARBEN,
  TEMPO_MAX, TEMPO_MIN, WIRT_SLOTS, SURGE_NAME, SURGE_PARAMETER_MAX, istPatchName,
  MAX_TAKES_PRO_SPUR, TAKE_NAME_MAX, entferneLeereTakes, type Take,
  istObjekt, kanonisch, neueId, neueNotenId, notenNummer, notenZaehler,
  pruefeFehler, spurSicht, sucheClip, sucheSpur, wiedergabeSicht, warpPruefung, entstehungPruefung, type Entstehung,
  type AudioClip, type Clip, type Glied, type RackGeraet, MAX_GLIEDER, type Gruppe, type Herkunft, type Geraet,
  type Insert, type InsertSchluessel, type InsertTraeger, type MidiClip, type Note, type Projekt, type Return, type Send, type Spur, type Warp,
  type DekodiertZustand, HOST_PFAD_ZEICHEN, HOST_UID_ZEICHEN, MAX_LATENZ_EXTRA,
  wirtSlots, AUFNAHME_VORGABE, EXTERN_MODI, VORZAEHLER_WERTE, type EingangExtern, type EingangIntern, type EingangMidi, type ProjektAufnahme, type SpurAufnahme,
} from './model.ts';
import { INSERT_ARTEN } from './insert_key.ts';
import { wendeMusterAn, musterAbdruck, type KitKlang, type MusterErgebnis, type MusterFehlschlag } from './pattern_clip.ts';
import { pruefeSchluessel, type SchluesselFrage } from './routing_rules.ts';
import { PRESET_ID } from '../presets/preset_id.ts';
import { unterschied, type Patch, pfadSegment } from './patch.ts';
import { klingtGleich, TAKE_KOPIE_EPS } from './takes.ts';
import { bkSetzen } from './modular.ts';
import { hkPunkteZahl, huellkurvePruefung, teileHuellkurve, type Huellkurve } from './envelope.ts';
import { FORMEN_EINFUEGEN, bereichVereinfacht, dehne, formBereich, formPunkte, neige, setzeForm, type FormEinfuegen } from './lane_tools.ts';
import { wendeAn as richtungAnwenden } from './direction.ts';
import { presetZuParameter } from './rb_mapping.ts';
import { MAX_WARP_PUNKTE, gainHkPunkte, relativeLanen, zaehleAusgerollt, zaehleWarpMarker } from './playback.ts';
import {
  WarpFehler, abHierGerade, einsHier, handWarp, markerAendern, tempoSkalieren, type MarkerSetze, type MarkerVerschiebe,
} from './warp.ts';

export class BefehlFehler extends Error {
  readonly grund: string;
  readonly detail: string;
  index?: number;                                  // Stelle in einer Befehlsliste (fuehreListeAus)
  constructor(grund: string, detail = '') { super(detail ? `${grund}: ${detail}` : grund); this.grund = grund; this.detail = detail; }
}
const ab = (grund: string, detail?: string): never => { throw new BefehlFehler(grund, detail); };

export interface ReglerAenderung { pfad: string; wert: number }
export interface BefehlErgebnis {
  projekt: Projekt; vor: Patch; zurueck: Patch; betrifft_wiedergabe: boolean; regler_aenderungen: ReglerAenderung[]; hinweise?: LaneHinweis[]
}
/** The answer of a command that wrote the value of a parameter on which a lane lies (an insert stage parameter, a rack macro, a Baukasten knob): the write is
 *  kept, but it is only the rest value of the parameter. While the arrangement plays, the lane drives the parameter in every block and holds its first and
 *  last value beyond its points; the value applies while the transport is stopped and after the lane is removed. `index` is the command in the list. */
export interface LaneHinweis { index: number; hinweis: 'lane_treibt'; lane_id: string; ziel: string; strang_id: string; text: string }
/** the stored value of every lane-driven parameter, keyed by strip and lane id (only chain and knob lanes: the mixer lanes have their own base value) */
function laneRuhewerte(p: Projekt): Map<string, { wert: number | undefined; lane: Lane; strangId: string }> {
  const aus = new Map<string, { wert: number | undefined; lane: Lane; strangId: string }>();
  for (const { strang, strangId } of alleStraenge(p)) {
    for (const l of strang.automation ?? []) {
      let wert: number | undefined;
      if (istKettenZiel(l.ziel)) {
        const z = zerlegeKettenZiel(l.ziel);
        if (z && 'makro' in z) wert = strang.rack?.werte[z.makro - 1];
        else if (z) wert = (strang.inserts ?? []).find((x) => x.id === z.insert)?.werte[z.param];
      } else if (/^geraet\.k([1-9]|[1-5][0-9]|6[0-4])$/.test(l.ziel)) {
        const g = (strang as Spur).geraet;
        if (g && g.art === 'intern' && g.name === 'bk') wert = g.parameter[l.ziel.slice(7)];
      } else continue;
      aus.set(`${strangId}:${l.id}`, { wert, lane: l, strangId });
    }
  }
  return aus;
}
const hatLaneRuhewerte = (p: Projekt): boolean =>
  alleStraenge(p).some(({ strang }) => (strang.automation ?? []).some((l) => istKettenZiel(l.ziel) || /^geraet\.k([1-9]|[1-5][0-9]|6[0-4])$/.test(l.ziel)));
/** the hints of one command: every lane-driven parameter whose stored value the command changed (a lane the command created or removed has none) */
function laneHinweise(vorher: Map<string, { wert: number | undefined; lane: Lane; strangId: string }> | null, nachher: Projekt, index: number): LaneHinweis[] {
  if (!vorher || vorher.size === 0) return [];
  const aus: LaneHinweis[] = [];
  for (const [k, n] of laneRuhewerte(nachher)) {
    const v = vorher.get(k);
    if (!v || v.wert === n.wert) continue;
    aus.push({ index, hinweis: 'lane_treibt', lane_id: n.lane.id, ziel: n.lane.ziel, strang_id: n.strangId,
      text: `parameter is driven by lane ${n.lane.id} (${n.lane.ziel}): saved as the rest value, it applies only while the transport is stopped `
        + 'and after the lane is removed; while the arrangement plays the lane holds its first and last value beyond its points' });
  }
  return aus;
}
export type Befehl = { befehl: string; [k: string]: unknown };

// --- Argumente --------------------------------------------------------------------------------------------------------
type Args = Record<string, any>;                   // eslint-disable-line @typescript-eslint/no-explicit-any
function erlaube(a: Args, ...namen: string[]): void {
  for (const k of Object.keys(a)) if (k !== 'befehl' && !namen.includes(k)) ab('argument_unbekannt', k);
}
const zahlOk = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
function zahl(a: Args, k: string, min: number, max: number, o: { opt?: boolean; ganz?: boolean; offenUnten?: boolean } = {}): number | undefined {
  const x = a[k];
  if (x === undefined) { if (o.opt) return undefined; return ab('argument_ungueltig', `${k}: fehlt`); }
  if (!zahlOk(x) || x > max || (o.offenUnten ? x <= min : x < min) || (o.ganz && !Number.isInteger(x))) {
    return ab('argument_ungueltig', `${k}: ${o.ganz ? 'ganze ' : ''}Zahl ${o.offenUnten ? '>' : '≥'} ${min} und ≤ ${max} erwartet`);
  }
  return x;
}
function flagge(a: Args, k: string, opt = false): boolean | undefined {
  const x = a[k];
  if (x === undefined && opt) return undefined;
  return typeof x === 'boolean' ? x : ab('argument_ungueltig', `${k}: true oder false erwartet`);
}

// 1.8 S0: the recording input of a track as the command carries it. Audio tracks take an internal tap or an external pair (mode defaults to stereo),
// instrument tracks take midi_ein_1; everything else is eingang_fehlt (the same reason the kern gives for an input it cannot tap).
function eingangVon(art: 'audio' | 'instrument', roh: unknown): EingangIntern | EingangExtern | EingangMidi {
  const e = istObjekt(roh) ? roh : ab('eingang_fehlt', 'eingang: {art: intern|extern|midi, ...} or null');
  if (art === 'audio' && e.art === 'intern' && (INTERNE_EINGAENGE as readonly unknown[]).includes(e.name)) {
    return { art: 'intern', name: e.name as EingangIntern['name'] };
  }
  if (art === 'audio' && e.art === 'extern') {
    const modus = e.modus === undefined ? 'stereo' : e.modus;
    if (e.paar !== 1 && e.paar !== 2 && e.paar !== 3 && e.paar !== 4) ab('eingang_fehlt', 'eingang: extern needs paar 1, 2, 3 or 4');
    if (!(EXTERN_MODI as readonly unknown[]).includes(modus)) ab('eingang_fehlt', 'eingang: extern modus stereo, links, rechts or summe');
    return { art: 'extern', paar: e.paar as EingangExtern['paar'], modus: modus as EingangExtern['modus'] };
  }
  if (art === 'instrument' && e.art === 'midi') return { art: 'midi' };
  return ab('eingang_fehlt', art === 'audio'
    ? 'eingang: {art: intern, name: erz/1|erz/2|erz/3|erz/5|erz/6|erz/7|pad/1|pad/2} or {art: extern, paar: 1..4, modus?} or null'
    : 'eingang: {art: midi} or null on an instrument track');
}
function text(a: Args, k: string, max: number, opt = true): string | undefined {
  const x = a[k];
  if (x === undefined && opt) return undefined;
  return typeof x === 'string' && x.trim().length >= 1 && x.length <= max ? x : ab('argument_ungueltig', `${k}: Text mit 1 bis ${max} Zeichen erwartet`);
}
// Paket 1.18, E-c (Review S2): der Gruppenname trägt keine Leerzeichen am Rand, sonst wären ' bass' und 'bass' zwei Gruppen; wie model.ts beim Laden
function gruppeArg(a: Args, opt = true): string | undefined {
  const g = text(a, 'gruppe', GRUPPE_MAX, opt);
  return g !== undefined && g.trim() !== g ? ab('argument_ungueltig', 'gruppe: ohne Leerzeichen am Rand') : g;
}
// The hall object of return_neu / return_aendern: a partial object of the Hall fields (an: true/false, the rest 0..1); writes into `ziel`
function hallArg(x: unknown, ziel: Return['hall']): void {
  if (x === undefined) return;
  if (!istObjekt(x)) ab('argument_ungueltig', 'hall: Objekt erwartet');
  for (const k of Object.keys(x)) if (k !== 'an' && !(HALL_FELDER as readonly string[]).includes(k)) ab('argument_unbekannt', `hall.${k}`);
  if (Object.keys(x).length === 0) ab('argument_ungueltig', 'hall: leeres Objekt');
  if (x.an !== undefined) { if (typeof x.an !== 'boolean') ab('argument_ungueltig', 'hall.an: true oder false erwartet'); ziel.an = x.an; }
  for (const k of HALL_FELDER) if (x[k] !== undefined) ziel[k] = zahl(x as Args, k, 0, 1)!;
}
function idArg(a: Args, k: string): string {
  const x = a[k];
  return typeof x === 'string' && x ? x : ab('argument_ungueltig', `${k}: ID erwartet`);
}
// 1.9 T10: strip, rack and variation name of the three makro_variation_* commands
function variationArgs(p: Projekt, a: Args): { rack: Rack; name: string } {
  erlaube(a, 'strang_id', 'name');
  const id = idArg(a, 'strang_id');
  const strang = sucheStrang(p, id) ?? ab('spur_unbekannt', id);
  const name = text(a, 'name', VARIATION_NAME_MAX, false)!;
  if (!strang.rack) ab('rack_unbekannt', `${id} has no rack`);
  return { rack: strang.rack!, name };
}
const spurVon = (p: Projekt, id: string): Spur => sucheSpur(p, id) ?? ab('spur_unbekannt', id);
// T4: a track that uses a production slot carries `freeze` (null or the entry), every other track carries none; a change of the sound drops the entry
const freezeFeld = (s: Spur): void => { if (wirtSlots(s).length > 0) s.freeze = null; else delete s.freeze; };
const gruppeVon = (p: Projekt, id: string): Gruppe => (p.gruppen ?? []).find((g) => g.id === id) ?? ab('gruppe_unbekannt', id);
const returnVon = (p: Projekt, id: string): Return => (p.returns ?? []).find((r) => r.id === id) ?? ab('return_unbekannt', id);
const strangKennung = (p: Projekt, strang: InsertTraeger): string =>
  strang === p.master ? 'master' : (strang as { id?: string }).id ?? '?';
// slice 4c: after a chain change the rack of the strip loses the mappings of stages that are gone; a rack with no mapping left is removed (its
// slot goes back to the pool,
// the macro rows reset through reglerAenderungen)
function rackBereinigen(strang: InsertTraeger): void {
  const rack = strang.rack;
  if (rack) {
    const da = new Set((strang.inserts ?? []).map((i) => i.id));
    const makros = rack.makros.map((m) => ({ ziel: m.ziel.filter((z) => !istInsertZiel(z) || da.has(z.insert)) }));
    if (makros.every((m) => m.ziel.length === 0)) delete strang.rack;
    else strang.rack = { ...rack, makros };
  }
  kettenLanenBereinigen(strang);
}
// 1.12 slice 6: the chain lanes of a strip go with their target: a stage that left the chain takes its parameter lanes, a rack that is gone takes its
// macro lanes. A lane on a parameter a macro now drives goes too (one writer; rack_setzen refuses a mapping onto a lane, so this is the safety net).
// Called wherever a chain or a rack changes.
function kettenLanenBereinigen(strang: InsertTraeger): void {
  if (!strang.automation) return;
  const rest = strang.automation.filter((l) => {
    if (!istKettenZiel(l.ziel)) return true;
    if (!kettenZielBereich(strang, l.ziel)) return false;
    const k = zerlegeKettenZiel(l.ziel)!;
    return 'makro' in k || !makroVon(strang, k.insert, k.param);
  });
  if (rest.length === strang.automation.length) return;
  if (rest.length > 0) strang.automation = rest; else delete strang.automation;
}
// 1.9 U8 T8 (review focus 5): keeps the macro table valid after the members or the device of a track changed. Drops every member target whose
// member is gone or whose parameter the member's device no longer allows (an RB-338 replaced by a kit keeps only gain_db); deletes `rack` when no
// target is left (a strand rack without targets is invalid). Insert targets are untouched. Called by the commands that change the members.
export function bereinigeGliedZiele(strang: InsertTraeger): void {
  const rack = strang.rack;
  if (!rack) return;
  const mitglieder = glieder(strang as Spur);
  const passt = (z: RackZiel): boolean => {
    if (!istGliedZiel(z)) return true;
    const m = mitglieder.find((x) => x.id === z.glied);
    return !!m && gliedMakroParam(m.geraet, z.param) !== undefined;
  };
  const makros = rack.makros.map((m) => ({ ziel: m.ziel.filter(passt) }));
  if (makros.every((m) => m.ziel.length === 0)) delete strang.rack;
  else strang.rack = { ...rack, makros };
  kettenLanenBereinigen(strang);
}
// the plugin of a command: `plugin_id` (the index resolves it; `art` is the kind the caller needs: an effect stage takes an `ok` effect, an instrument
// track an `ok` instrument) or `plugin` {format, pfad, uid}; the file must exist (ctx.pluginDa)
type Identitaet = { format: 'vst3' | 'lv2'; pfad: string; uid: string };
function pluginIdentitaet(a: Args, ctx: Kontext, art: 'effekt' | 'instrument'): { identitaet: Identitaet; indexName?: string; pfad: string } {
  if (a.plugin !== undefined && a.plugin_id !== undefined) ab('argument_ungueltig', 'plugin and plugin_id name the same plugin');
  let indexName: string | undefined;
  let pl: unknown = a.plugin;
  if (a.plugin_id !== undefined) {   // the plugin index resolves the identity; only an `ok` effect can be inserted
    if (typeof a.plugin_id !== 'string' || a.plugin_id === '') ab('argument_ungueltig', 'plugin_id: eine Kennung erwartet');
    const e = ctx.pluginIndex?.(a.plugin_id as string) ?? ab('plugin_unbekannt', String(a.plugin_id));
    if (e.status !== 'ok') ab('plugin_blockiert', `${e.name}: ${e.grund ?? 'blocked'}`);
    if (e.art !== art) ab(art === 'effekt' ? 'kein_effekt' : 'kein_instrument', `${e.name} is an ${e.art}`);
    pl = { format: e.format, pfad: e.pfad, uid: e.uid };
    indexName = e.name;
  }
  if (!istObjekt(pl)) return ab('argument_ungueltig', 'plugin: {format, pfad, uid} erwartet');
  for (const k of Object.keys(pl)) if (!['format', 'pfad', 'uid'].includes(k)) ab('argument_unbekannt', `plugin.${k}`);
  if (pl.format !== 'vst3' && pl.format !== 'lv2') ab('argument_ungueltig', 'plugin.format: vst3 oder lv2 erwartet');
  if (typeof pl.pfad !== 'string' || !HOST_PFAD_ZEICHEN.test(pl.pfad)) ab('argument_ungueltig', 'plugin.pfad: Pfad ohne Steuerzeichen erwartet');
  if (typeof pl.uid !== 'string' || !HOST_UID_ZEICHEN.test(pl.uid) || (pl.format === 'vst3' && pl.uid === '')) ab('argument_ungueltig', 'plugin.uid: erwartet');
  const identitaet = { format: pl.format as 'vst3' | 'lv2', pfad: pl.pfad, uid: pl.uid };
  if (ctx.pluginDa && !ctx.pluginDa(identitaet)) ab('plugin_nicht_ladbar', `${pl.pfad}`);
  return { identitaet, ...(indexName !== undefined ? { indexName } : {}), pfad: pl.pfad };
}
// plan 1.11 T7: a host stage. `plugin` {format, pfad, uid} is the identity, the display name comes from the path; the host number is the lowest free slot
// (host_grenze when all MAX_HOST are used), the state file path is fixed here. `stufe` is accepted as another name of `pos`.
function hostSetzen(p: Projekt, a: Args, ctx: Kontext): void {
  erlaube(a, 'strang_id', 'pos', 'stufe', 'art', 'plugin', 'plugin_id', 'ersetzen');
  const id = idArg(a, 'strang_id');
  const strang = sucheStrang(p, id) ?? ab('spur_unbekannt', id);
  if (a.pos !== undefined && a.stufe !== undefined) ab('argument_ungueltig', 'pos and stufe name the same position');
  const pos = zahl({ pos: a.pos ?? a.stufe }, 'pos', 0, MAX_INSERTS_PRO_STRANG - 1, { ganz: true })!;
  const ersetzen = flagge(a, 'ersetzen', true) ?? false;
  const { identitaet, indexName, pfad } = pluginIdentitaet(a, ctx, 'effekt');
  const liste = [...(strang.inserts ?? [])];
  if (ersetzen) {
    if (pos >= liste.length) ab('argument_ungueltig', `pos: no stage to replace at ${pos}`);
    liste.splice(pos, 1);
  } else {
    if (pos > liste.length) ab('argument_ungueltig', `pos: at most ${liste.length} (no gaps in the chain)`);
    if (liste.length >= MAX_INSERTS_PRO_STRANG) ab('kette_voll', `all ${MAX_INSERTS_PRO_STRANG} stages of ${id} are used`);
  }
  const belegt = new Set(alleInserts(p).filter((x) => x.insert.art === 'host' && !(ersetzen && x.insert === strang.inserts![pos])).map((x) => x.insert.slot));
  const slot = Array.from({ length: MAX_INS.host }, (_, i) => i + 1).find((n) => !belegt.has(n))
    ?? ab('host_grenze', `all ${MAX_INS.host} effect hosts are used`);
  const iid = neueId(p, 'insert');
  const name = indexName || pfad.replace(/\/+$/, '').split('/').pop()!.replace(/\.(vst3|lv2)$/i, '') || pl.pfad;
  const insert: Insert = { id: iid, art: 'host', slot, an: true, werte: {}, plugin: { ...identitaet, name: name.slice(0, 128) },
    zustand: `plugins/${iid}.carxs` };
  liste.splice(pos, 0, insert);
  strang.inserts = liste;
  rackBereinigen(strang);
}
// slice 4: a stage by its ID, with the strip that carries it
const insertVon = (p: Projekt, id: string): { strang: InsertTraeger; insert: Insert } => {
  const t = alleInserts(p).find((x) => x.insert.id === id);
  return t ? { strang: t.strang, insert: t.insert } : ab('insert_unbekannt', id);
};
// 1.10 slice 5 (E12): the values of "Duck by Kick" = presets/factory/comp/kick-sidechain.preset.json by the plugin names of INSERT_ARTEN (no file I/O here);
// tests/project_key.test.mjs pins this constant to the preset file
export const DUCK_DURCH_KICK_WERTE: Readonly<Record<string, number>> =
  { schwelle: -30, ratio: 8, knie: 0, attack: 1, release: 150, makeup: 0, mix: 1, schp: 0 };
// the sidechain key of a `komp` stage: 0 = own signal, n = input of track number n (the track must exist). 1.10 slice 6 (plan D13): the stage on the
// strip `traegerId` may not name its own track (`pre` of itself): the rules answer sidechain_zyklus, like the matrix cell. `ausser` = the stage rewritten.
function schluesselArg(p: Projekt, x: unknown, traegerId: string, ausser?: Insert): number {
  if (x === undefined) return 0;
  if (typeof x !== 'number' || !Number.isInteger(x) || x < 0 || x > MAX_SPUREN) return ab('argument_ungueltig', `sc: whole number 0..${MAX_SPUREN} expected`);
  if (x > 0 && !p.spuren.some((s) => s.nr === x)) ab('spur_unbekannt', `sc: no track number ${x}`);
  if (x > 0) pruefeSchluessel(p, traegerId, { quelle: 'spur', nr: x, punkt: 'pre' }, ausser);
  return x;
}
// 1.10 slice 5 (plan E8): the `key` argument of a compressor stage. null = no key. `{quelle: 'spur', nr, punkt: 'pre'}` is the row key: it comes back as
// `{sc: nr}` (one shape for the page picker);
// every other source comes back as `{key}` after the rules (project/routing_rules.ts: sidechain_spaet, sidechain_zyklus, sidechain_quelle). `ausser` =
// the stage being replaced or rewritten.
const KEY_QUELLEN = ['spur', 'grp', 'ret', 'pm', 'deck', 'erz', 'pad'] as const;
function schluesselDef(p: Projekt, strangId: string, x: unknown, ausser?: Insert): { sc: number } | { key: InsertSchluessel } | null {
  if (x === undefined || x === null) return null;
  if (!istObjekt(x)) return ab('argument_ungueltig', 'key: object {quelle, nr, punkt} expected');
  for (const k of Object.keys(x)) if (k !== 'quelle' && k !== 'nr' && k !== 'punkt') ab('argument_unbekannt', `key.${k}`);
  const quelle = x.quelle;
  if (typeof quelle !== 'string' || !(KEY_QUELLEN as readonly string[]).includes(quelle)) {
    return ab('argument_ungueltig', `key.quelle: ${KEY_QUELLEN.join(' | ')} expected`);
  }
  const q = quelle as (typeof KEY_QUELLEN)[number];
  const dj = q === 'deck' || q === 'erz' || q === 'pad';
  const nr = x.nr ?? (q === 'pm' ? 0 : undefined);
  const max = q === 'spur' ? MAX_SPUREN : q === 'grp' ? MAX_GRUPPEN : q === 'ret' ? MAX_RETURNS : q === 'pm' ? 0 : 99;
  const nrMin = q === 'pm' ? 0 : 1;
  if (typeof nr !== 'number' || !Number.isInteger(nr) || nr < nrMin || nr > max) {
    return ab('argument_ungueltig', `key.nr: whole number ${nrMin}..${max} expected`);
  }
  if (x.punkt !== undefined && x.punkt !== 'pre' && x.punkt !== 'post') return ab('argument_ungueltig', 'key.punkt: pre | post expected');
  if (x.punkt === undefined && !dj && q !== 'pm') return ab('argument_ungueltig', 'key.punkt: pre | post expected');
  const punkt: 'pre' | 'post' = dj || q === 'pm' ? (x.punkt ?? 'post') : x.punkt;
  if (q === 'spur' && punkt === 'pre') return { sc: schluesselArg(p, nr, strangId, ausser) };        // the row key keeps its 4a checks and fast-path rules
  if (q === 'grp' && !(p.gruppen ?? []).some((g) => g.nr === nr)) ab('gruppe_unbekannt', `key: no group number ${nr}`);
  if (q === 'ret' && !(p.returns ?? []).some((r) => r.nr === nr)) ab('return_unbekannt', `key: no return number ${nr}`);
  if (q === 'spur' && !p.spuren.some((s) => s.nr === nr)) ab('spur_unbekannt', `key: no track number ${nr}`);
  const frage: SchluesselFrage = { quelle: q, nr, punkt };
  pruefeSchluessel(p, strangId, frage, ausser);                                    // throws the named reason; below this line the key is allowed
  return { key: { quelle: q as InsertSchluessel['quelle'], nr, punkt } };
}
// 1.14 comping: take lanes. A take name is 1 to TAKE_NAME_MAX characters with more than blanks in it (reason take_name_ungueltig)
function takeName(x: unknown): string {
  if (typeof x === 'string' && x.trim().length >= 1 && x.length <= TAKE_NAME_MAX) return x;
  return ab('take_name_ungueltig', `name: 1 to ${TAKE_NAME_MAX} characters expected`);
}
function takeVon(p: Projekt, a: Args): { spur: Spur; take: Take } {
  const spur = spurVon(p, idArg(a, 'spur_id'));
  const id = idArg(a, 'take_id');
  const take = (spur.takes ?? []).find((t) => t.id === id);
  return take ? { spur, take } : ab('take_unbekannt', id);
}
const FARBE_OK = /^#[0-9a-fA-F]{6}$/;
const GRUPPE_LEICHT = ['name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'gefaltet'];   // Felder von gruppenspur_aendern
// Slice 2 (E4): the one place of the lock. Every lane command that writes goes through here and is rejected on a locked lane;
// only auto_aendern asks with `auchGesperrt` (it is the way to unlock).
// 1.12 slice 6: a lane lives on any strip (track, group, return, master), so the search covers all of them; `spur` is the strip that carries it
const laneVon = (p: Projekt, id: string, auchGesperrt = false): { spur: InsertTraeger; lane: Lane } => {
  for (const { strang: spur } of alleStraenge(p)) {
    const lane = (spur.automation ?? []).find((l) => l.id === id);
    if (lane) { if (lane.gesperrt && !auchGesperrt) ab('lane_gesperrt', id); return { spur, lane }; }
  }
  return ab('lane_unbekannt', id);
};
// the value range of a lane on its strip (the lane exists, so the target does; a chain target that stopped existing is removed with its stage)
const laneBereichVon = (strang: InsertTraeger, lane: Lane) =>
  zielBereichVon(lane.ziel, strang) ?? ab('ziel_unbekannt', `${lane.ziel} no longer exists on its strip`);
// 1.12 slice 4: the range of an editor tool; bis <= von or a range outside 0..MAX_BEAT is bereich_leer
function laneBereich(a: Args): [number, number] {
  const von = zahl(a, 'von_beat', -Infinity, Infinity)!, bis = zahl(a, 'bis_beat', -Infinity, Infinity)!;
  if (!(von >= 0 && bis <= MAX_BEAT && bis > von)) ab('bereich_leer', `${von}..${bis} must lie inside 0..${MAX_BEAT} and be longer than 0`);
  return [von, bis];
}
function laneSchreibe(strang: InsertTraeger, lane: Lane, punkte: Punkt[]): void {
  const f = punktePruefung(punkte, lane.ziel, laneBereichVon(strang, lane));
  if (f) ab(f.grund, f.text);
  lane.punkte = punkte;
  normalisiereLane(lane);
}
// the rack device of the track a rack command names; any other track is keine_rackspur
function rackGeraetVon(p: Projekt, a: Args): RackGeraet {
  const s = spurVon(p, idArg(a, 'spur_id'));
  if (s.art !== 'instrument' || s.geraet?.art !== 'rack') ab('keine_rackspur', `${s.id} is not a rack track`);
  return s.geraet as RackGeraet;
}
// start value of a new lane: what the track has now, so the new line changes nothing audible until a point is moved
export function laneStart(strang: Spur | InsertTraeger, ziel: string): number {
  const k = zerlegeKettenZiel(ziel);
  if (k) {   // 1.12 slice 6: a chain lane starts at the row value of its parameter (the macro value for a macro lane)
    if ('makro' in k) return strang.rack?.werte[k.makro - 1] ?? 0;
    return (strang.inserts ?? []).find((i) => i.id === k.insert)?.werte[k.param] ?? 0;
  }
  const s = strang as Spur;
  if (ziel === 'fader') return s.fader_db;
  if (ziel === 'pan') return s.pan;
  if (ziel === 'mute') return s.mute ? 1 : 0;
  if (ziel === 'solo') return s.solo ? 1 : 0;
  // 1.12 slice 7: a bk knob starts at the track's knob, an untouched one is 0.5
  if (s.geraet?.art === 'intern' && s.geraet.name === 'bk') return s.geraet.parameter[ziel.slice(GERAET_PRAEFIX.length)] ?? BK_KNOPF_VORGABE;
  const kn = ziel.slice(GERAET_PRAEFIX.length) as keyof typeof RB_VORGABE_NORM;
  const eigen = s.geraet?.art === 'intern' && s.geraet.name === 'rb338' ? s.geraet.parameter[kn] : undefined;
  return eigen ?? RB_VORGABE_NORM[kn];
}
// 1.14 comping (spec R5): the seam fade of a comp edge is 4 ms, stored in beats at the project tempo
export const COMP_FADE_S = 0.004;
const COMP_EPS = 1e-9;
// Shared by comp_waehlen and the recording (recording.ts nehmeTakeAuf): cut every clip of the lane that has `t` strictly inside by the
// clip_teilen rules, for each t in order. `neuerTeil(alt, neu)` is told about each second part. Loop clips are the caller's business.
export function teileClipsAn(p: Projekt, spur: Spur, ts: number[], neuerTeil?: (alt: Clip, neu: Clip) => void): void {
  for (const t of ts) {
    for (const c of spur.clips.filter((x) => x.start_beat < t - COMP_EPS && x.start_beat + x.laenge_beats > t + COMP_EPS)) {
      const vorher = new Set(spur.clips);
      PRO_BEFEHL.clip_teilen(p, { befehl: 'clip_teilen', clip_id: c.id, beat: t }, { quelle: 'andreas' });
      if (neuerTeil) for (const n of spur.clips) if (!vorher.has(n)) neuerTeil(c, n);
    }
  }
}
// No-op rule (spec R4): the main clips over [von, bis) are exactly the copies (R6) of the take clips over it, same pieces of the range,
// and they sound the same in every other field too (stumm, gain, warp parameters ...: klingtGleich)
function compGleich(haupt: Clip[], quellen: AudioClip[], von: number, bis: number, bpm: number): boolean {
  if (haupt.length !== quellen.length) return false;
  const stuecke = <C extends Clip>(l: C[]) => l.map((c) => ({ c, v: Math.max(c.start_beat, von), b: Math.min(c.start_beat + c.laenge_beats, bis) }))
    .sort((x, y) => x.v - y.v || x.b - y.b);
  const h = stuecke(haupt), q = stuecke(quellen);
  return h.every((x, i) => x.c.art === 'audio' && Math.abs(x.v - q[i].v) <= TAKE_KOPIE_EPS && Math.abs(x.b - q[i].b) <= TAKE_KOPIE_EPS
    && klingtGleich(x.c, q[i].c, bpm));
}
// A seam fade has priority: it grows to `ziel` beats (never shorter than the fade was). The fade on the other edge of the same clip gives way
// and is capped at the length that is left (length minus the seam fade).
export function compFade(c: AudioClip, feld: 'fade_ein_beats' | 'fade_aus_beats', ziel: number): void {
  const gegen = feld === 'fade_ein_beats' ? 'fade_aus_beats' : 'fade_ein_beats';
  c[feld] = runde9(Math.max(c[feld], ziel));
  c[gegen] = runde9(Math.min(c[gegen], Math.max(0, c.laenge_beats - c[feld])));
}
const clipVon = (p: Projekt, id: string): { spur: Spur; clip: Clip } => sucheClip(p, id) ?? ab('clip_unbekannt', id);
const midiVon = (clip: Clip, id: string): MidiClip => (clip.art === 'midi' ? clip : ab('clip_nicht_midi', id));
const runde9 = (x: number): number => Math.round(x * 1e9) / 1e9;
const SHA = /^[0-9a-f]{64}$/;
const NOTEN_ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const NOTEN_NR_GRENZE = 2 ** 31;                   // Spec 6.32 (Wortlaut von 6.31 berichtigt): ausdrückliche Noten-IDs n<k> mit k < 2^31
const WIRT_SLOT_LISTE = Array.from({ length: WIRT_SLOTS }, (_, i) => i + 1);
const SLOT_TEXT = 'both Surge slots are in use (1, 2)';
const SLOT_UNGUELTIG_TEXT = 'geraet.slot: 1 or 2 expected';

// --- Warp (Paket 1.13) -------------------------------------------------------------------------------------------------------------
// Das Warp-Argument eines Befehls: fehlt, null oder 'aus' heißt ohne Warp (null); ein Objekt wird wie im Modell geprüft (Grund und Text von
// warpPruefung). 'auto' löst nicht dieser Baustein, sondern der Server aus dem Katalog (session.ts loeseQuellenAuf); ein 'auto', das bis
// hierher kommt, hatte keinen Katalog.
function warpArg(x: unknown): Warp | null {
  if (x === undefined || x === null || x === 'aus') return null;
  if (x === 'auto') return ab('argument_ungueltig', "warp 'auto' braucht den Katalog des Servers (Tempo-Angaben der Library)");
  const f = warpPruefung(x);
  if (f) return ab(f.grund, f.text);
  return structuredClone(x) as Warp;
}
const WARP_FELDER = ['an', 'modus', 'transpose_st', 'detune_ct', 'beats'] as const;
// Slice 3b: die Befehle der Marker von Hand. Alle arbeiten auf einem Audio-Clip mit Warp (sonst kein_warp), rechnen mit den reinen Funktionen von
// warp.ts, prüfen das Ergebnis mit warpPruefung und setzen quelle 'hand'. Clip-Beats sind die Beats der Marker (Beat 0 = die Eins der Quelle).
function warpClip(p: Projekt, a: Args): AudioClip & { warp: Warp } {
  const gefunden = clipVon(p, idArg(a, 'clip_id')).clip;
  const clip = gefunden.art === 'audio' ? gefunden : ab('feld_nur_audio', 'warp');
  if (!clip.warp) ab('kein_warp', clip.id);
  return clip as AudioClip & { warp: Warp };
}
function mitWarp<T>(f: () => T): T {
  try { return f(); } catch (e) { if (e instanceof WarpFehler) return ab(e.grund, e.message); throw e; }
}
function gueltig(w: Warp): Warp {
  const f = warpPruefung(w);
  if (f) ab(f.grund, f.text);
  return w;
}
function objekte(a: Args, k: string, erlaubt: string[]): Args[] {
  return listeArg(a, k).map((x, i) => {
    if (!istObjekt(x)) return ab('argument_ungueltig', `${k}[${i}]: Objekt erwartet`);
    erlaube(x as Args, ...erlaubt);
    return x as Args;
  });
}

// 1.16 rest (F8): the preset origin of a device or stage, a register id; undefined = not given (the stored object then has no key)
function presetArg(x: unknown, wo: string): string | undefined {
  if (x === undefined) return undefined;
  if (typeof x !== 'string' || !PRESET_ID.test(x)) ab('argument_ungueltig', `${wo}: preset id <werk|nutzer>:<geraet>/<slug> expected`);
  return x as string;
}

// Baukasten S20: {art: intern, name: bk, graph, parameter?}. The name rule always applies; with ctx.graphArt (the server injects a lookup into the
// graph folder) an unknown graph and an effect graph are refused here, so Cypher gets the refusal at the command and not at the next load.
function baueBkGeraet(g: Args, ctx?: Kontext): Geraet {
  erlaube(g, 'art', 'name', 'graph', 'parameter', 'preset');
  const preset = presetArg(g.preset, 'geraet.preset');
  if (typeof g.graph !== 'string' || !BK_GRAPH_NAME.test(g.graph)) ab('argument_ungueltig', 'geraet.graph: graph name expected ([a-z0-9_-], 1..32 characters)');
  const art = ctx?.graphArt?.(g.graph);
  if (ctx?.graphArt && art === null) ab('argument_ungueltig', `geraet.graph: unknown graph ${g.graph}`);
  if (art === 'effekt') ab('argument_ungueltig', `geraet.graph: ${g.graph} is an effect graph, an instrument is expected`);
  const parameter: Record<string, number> = {};
  if (g.parameter !== undefined) {
    if (!istObjekt(g.parameter)) ab('argument_ungueltig', 'geraet.parameter: Objekt erwartet');
    for (const [k, v] of Object.entries(g.parameter as Record<string, unknown>)) {
      if (!BK_PARAMETER.includes(k)) ab('argument_unbekannt', `geraet.parameter.${k} (allowed: ${BK_PARAMETER.join(', ')})`);
      if (!zahlOk(v) || v < 0 || v > 1) ab('argument_ungueltig', `geraet.parameter.${k}: Zahl 0..1 erwartet`);
      parameter[k] = v as number;
    }
  }
  return { art: 'intern', name: 'bk', graph: g.graph, parameter, ...(preset !== undefined ? { preset } : {}) };
}

// 1.9 (L25): {art: intern, name: kit, kit}. The name rule always applies; with ctx.kitDa (the server injects a lookup into the kit folder) an unknown
// kit is refused here as kit_unbekannt, so Cypher gets the refusal at the command and not when the core refuses the playback.
function baueKitGeraet(g: Args, ctx?: Kontext): Geraet {
  erlaube(g, 'art', 'name', 'kit');
  if (typeof g.kit !== 'string' || !KIT_NAME.test(g.kit)) ab('argument_ungueltig', 'geraet.kit: kit name expected ([a-z0-9_-], 1..32 characters)');
  if (ctx?.kitDa && !ctx.kitDa(g.kit)) ab('kit_unbekannt', `geraet.kit: no kit ${g.kit} in the kit folder`);
  return { art: 'intern', name: 'kit', kit: g.kit };
}

// 1.9 U5 (O28 on Surge): the sparse map of Surge display values. The shape rules are the model's; with ctx.surgeBereich (the server injects the
// ranges of surge_bereiche.json) an unknown name is argument_unbekannt and a value outside its range argument_ungueltig.
function surgeParameter(x: unknown, ctx?: Kontext): { parameter?: Record<string, number> } {
  if (x === undefined) return {};
  if (!istObjekt(x)) return ab('argument_ungueltig', 'geraet.parameter: Objekt erwartet');
  const e = Object.entries(x as Record<string, unknown>);
  if (e.length > SURGE_PARAMETER_MAX) ab('argument_ungueltig', `geraet.parameter: at most ${SURGE_PARAMETER_MAX} entries`);
  const parameter: Record<string, number> = {};
  for (const [k, v] of e) {
    if (!SURGE_NAME.test(k)) ab('argument_ungueltig', `geraet.parameter.${k}: Surge parameter name expected ([a-z][a-z0-9_], 1..48 characters)`);
    const b = ctx?.surgeBereich?.(k);
    if (ctx?.surgeBereich && b === null) ab('argument_unbekannt', `geraet.parameter.${k} (not a Surge parameter of surge_bereiche.json)`);
    if (!zahlOk(v)) ab('argument_ungueltig', `geraet.parameter.${k}: a finite number is expected`);
    if (b && ((v as number) < b[0] || (v as number) > b[1])) ab('argument_ungueltig', `geraet.parameter.${k}: ${b[0]}..${b[1]} expected`);
    parameter[k] = v as number;
  }
  return e.length ? { parameter } : {};
}

// --- Geräte -----------------------------------------------------------------------------------------------------------
// `eigene`: die Spur, deren Gerät geändert wird. Ohne `slot` behält sie ihren eigenen Wirt-Slot (Spec 6.8), sonst gilt der erste freie.
// 1.9 (L10): two hosts (arr1, arr2), slots 1 and 2 (WIRT_SLOTS); a third Surge track is slot_belegt, with or without slot.
// 1.9 U7: {art: rack, glieder: [{id, geraet, ton?, vel?, kette?, gain_db?}], kette?}. Every member device is built by baueGeraet itself (one code per
// kind); a rack inside a rack is refused. A Surge member takes a production slot like a Surge track (T4): `besetzt` holds the slots the other members of
// the same rack use and grows with every Surge member built. The model's zone and id checks run at the end of the list.
function baueGlied(p: Projekt, mx: unknown, wo: string, eigene: string | undefined, ctx?: Kontext, besetzt: Set<number> = new Set()): Glied {
  if (!istObjekt(mx)) return ab('argument_ungueltig', `${wo}: object expected`);
  erlaube(mx, 'id', 'geraet', 'ton', 'vel', 'kette', 'gain_db');
  if (!istObjekt(mx.geraet)) return ab('argument_ungueltig', `${wo}.geraet: object expected`);
  if (mx.geraet.art === 'rack') ab('argument_ungueltig', `${wo}.geraet: a rack does not nest`);
  if (mx.geraet.art === 'wirt' && mx.geraet.name === 'plugin') {
    ab('argument_ungueltig', `${wo}.geraet: a plugin instrument is a track device, not a rack member`);
  }
  if (mx.geraet.art === 'wirt' && mx.geraet.patch !== undefined) ab('argument_ungueltig', `${wo}.geraet: a Surge member does not take a patch in 1.9`);
  if (mx.geraet.art === 'wirt' && mx.geraet.parameter !== undefined) ab('argument_ungueltig', `${wo}.geraet: surge member parameters are not mirrored in 1.9`);
  const m: Record<string, unknown> = { id: mx.id, geraet: baueGeraet(p, mx.geraet, eigene, ctx, besetzt) };
  for (const k of ['ton', 'vel', 'kette', 'gain_db']) if (mx[k] !== undefined) m[k] = mx[k];
  return m as unknown as Glied;
}
function baueRackGeraet(p: Projekt, g: Args, eigene: string | undefined, ctx?: Kontext): Geraet {
  erlaube(g, 'art', 'glieder', 'kette');
  let liste = g.glieder;
  let kette = g.kette as number | undefined;
  if (liste === undefined) {   // {art: rack} alone: the track's current device becomes g1 (a rack keeps its members and chain value)
    const alt = eigene === undefined ? undefined : sucheSpur(p, eigene)?.geraet;
    if (alt?.art === 'rack') { liste = alt.glieder; kette ??= alt.kette; }
    else if (alt === undefined) return ab('argument_ungueltig', 'geraet.glieder: the track has no device to become member g1, list the members');
    else liste = [{ id: 'g1', geraet: alt }];
  }
  if (!Array.isArray(liste)) ab('argument_ungueltig', 'geraet.glieder: list expected');
  const besetzt = new Set<number>();
  const glieder = (liste as unknown[]).map((mx, i) => baueGlied(p, mx, `geraet.glieder[${i}]`, eigene, ctx, besetzt));
  if (kette !== undefined && (!zahlOk(kette) || !Number.isInteger(kette))) ab('argument_ungueltig', 'geraet.kette: integer expected');
  return { art: 'rack', glieder, kette: kette ?? 0 };
}
function baueGeraet(p: Projekt, g: unknown, eigene?: string, ctx?: Kontext, besetzt?: Set<number>, spurId?: string): Geraet {
  if (!istObjekt(g)) return ab('argument_ungueltig', 'geraet: Objekt erwartet');
  if (g.art === 'rack') return baueRackGeraet(p, g, eigene, ctx);
  // T4 (spec 4.4): the slots of every other track and of its rack members, plus the siblings of a member under construction
  const belegt = new Set([...p.spuren.filter((s) => s.id !== eigene).flatMap(wirtSlots), ...(besetzt ?? [])]);
  const eigenerGeraet = eigene === undefined ? undefined : sucheSpur(p, eigene)?.geraet;
  if (g.art === 'intern' && g.name === 'bk') return baueBkGeraet(g, ctx);                 // Baukasten S20
  if (g.art === 'intern' && g.name === 'kit') return baueKitGeraet(g, ctx);               // 1.9 (L25)
  if (g.art === 'intern') {
    erlaube(g, 'art', 'name', 'parameter', 'preset');
    const preset = presetArg(g.preset, 'geraet.preset');
    if (g.name !== undefined && g.name !== 'rb338') ab('argument_ungueltig', 'geraet.name: intern knows rb338, bk or kit');
    const parameter: Record<string, number> = {};
    if (g.parameter !== undefined) {
      if (!istObjekt(g.parameter)) ab('argument_ungueltig', 'geraet.parameter: Objekt erwartet');
      for (const [k, v] of Object.entries(g.parameter as Record<string, unknown>)) {
        if (!RB_PARAMETER.includes(k)) ab('argument_unbekannt', `geraet.parameter.${k} (erlaubt: ${RB_PARAMETER.join(', ')})`);
        if (!zahlOk(v) || v < 0 || v > 1) ab('argument_ungueltig', `geraet.parameter.${k}: Zahl 0..1 erwartet`);
        parameter[k] = v as number;
      }
    }
    return { art: 'intern', name: 'rb338', parameter, ...(preset !== undefined ? { preset } : {}) };
  }
  if (g.art === 'wirt') {
    const fremd = g.name === 'plugin';   // plan 1.11 task 17: a foreign instrument plugin in the host of the slot
    if (fremd) erlaube(g, 'art', 'name', 'slot', 'plugin_id', 'plugin'); else erlaube(g, 'art', 'name', 'slot', 'parameter', 'patch');
    if (g.name !== undefined && g.name !== 'surge' && !fremd) ab('argument_ungueltig', 'geraet.name: wirt knows surge or plugin');
    let slot: number;
    if (g.slot === undefined) {
      const frei = eigenerGeraet?.art === 'wirt' && besetzt === undefined ? eigenerGeraet.slot : WIRT_SLOT_LISTE.find((s) => !belegt.has(s));
      if (frei === undefined) return ab('slot_belegt', SLOT_TEXT);
      slot = frei;
    } else {
      if (g.slot !== 1 && g.slot !== 2) return ab('argument_ungueltig', SLOT_UNGUELTIG_TEXT);
      if (belegt.has(g.slot)) return ab('slot_belegt', SLOT_TEXT);
      slot = g.slot;
    }
    besetzt?.add(slot);
    if (fremd) {
      const { identitaet, indexName, pfad } = pluginIdentitaet(g, ctx ?? { quelle: 'andreas' }, 'instrument');
      const name = (indexName || pfad.replace(/\/+$/, '').split('/').pop()!.replace(/\.(vst3|lv2)$/i, '') || pfad).slice(0, 128);
      const id = spurId ?? eigene ?? ab('argument_ungueltig', 'geraet.plugin: needs a track');
      return { art: 'wirt', name: 'plugin', slot, plugin: { ...identitaet, name }, zustand: `plugins/${id}.carxs` };
    }
    if (g.patch !== undefined) {
      if (typeof g.patch !== 'string' || g.patch === '') ab('argument_ungueltig', 'geraet.patch: the library name of a Surge patch is expected');
      if (!istPatchName(g.patch) || (ctx?.surgePatchDa && !ctx.surgePatchDa(g.patch))) {
        ab('patch_unbekannt', `geraet.patch: no Surge patch ${JSON.stringify(g.patch)} in the library (klang liste)`);
      }
    }
    return { art: 'wirt', name: 'surge', slot, ...(g.patch !== undefined ? { patch: g.patch as string } : {}), ...surgeParameter(g.parameter, ctx) };
  }
  return ab('argument_ungueltig', 'geraet.art: intern, wirt or rack expected');
}

// --- Noten ------------------------------------------------------------------------------------------------------------
function notenFelder(n: Args, wo: string, teil: boolean): Partial<Note> {
  const ausgabe: Partial<Note> = {};
  const f = (k: 'beat' | 'laenge' | 'ton' | 'vel', min: number, max: number, o: { ganz?: boolean; offenUnten?: boolean }): void => {
    if (n[k] === undefined) { if (!teil) ab('argument_ungueltig', `${wo}.${k}: fehlt`); return; }
    if (!zahlOk(n[k]) || n[k] > max || (o.offenUnten ? n[k] <= min : n[k] < min) || (o.ganz && !Number.isInteger(n[k]))) {
      ab('argument_ungueltig', `${wo}.${k}: ungültig`);
    }
    ausgabe[k] = n[k];
  };
  f('beat', 0, MAX_BEAT, {}); f('laenge', 0, MAX_BEAT, { offenUnten: true }); f('ton', 0, 127, { ganz: true }); f('vel', 1, 127, { ganz: true });
  return ausgabe;
}
function listeArg(a: Args, k: string): unknown[] {
  return Array.isArray(a[k]) && a[k].length >= 1 && a[k].length <= 65536 ? a[k] : ab('argument_ungueltig', `${k}: nicht leere Liste erwartet`);
}
// Linear in der Zahl der Noten: der Zähler wird einmal gelesen und danach hochgezählt, die Kollisionsprüfung läuft über ein Set.
// Spec 6.28/6.30: der Zähler gehört dem Projekt (einer für alle Clips). Eine ausdrücklich mitgegebene ID n<k> unter dem Zähler war schon einmal
// vergeben und ist id_belegt, auch wenn die Note inzwischen gelöscht ist; eine darüber hebt den Zähler. Eigene IDs (z. B. „kick“) zählen nicht.
// Spec 6.32 (Wortlaut von 6.31 berichtigt): unter dem Projekt-Zähler bleibt es bei id_belegt (6.30); ab 2^31 oder bei falscher Form gilt
// argument_ungueltig, damit eine ausdrückliche ID den Zähler nie über die Grenze des Modells hebt (vorher: n<MAX_SAFE-1> angenommen, danach
// scheiterte jede automatische Note an projekt_ungueltig).
function fuegeNotenEin(p: Projekt, clip: MidiClip, roh: unknown[]): void {
  const vorhanden = new Set(clip.noten.map((n) => n.id));
  let naechste = notenZaehler(p);
  roh.forEach((r, i) => {
    if (!istObjekt(r)) ab('argument_ungueltig', `noten[${i}]: Objekt erwartet`);
    erlaube(r as Args, 'id', 'beat', 'laenge', 'ton', 'vel');
    const f = notenFelder(r as Args, `noten[${i}]`, false) as Omit<Note, 'id'>;
    let id = (r as Args).id as string | undefined;
    if (id !== undefined && (typeof id !== 'string' || !NOTEN_ID.test(id))) ab('argument_ungueltig', `noten[${i}].id: ungültig`);
    if (id !== undefined) {
      const k = notenNummer(id);
      if (k !== null && k >= NOTEN_NR_GRENZE) ab('argument_ungueltig', `noten[${i}].id: Nummer unter 2^31 erwartet`);
      if (vorhanden.has(id) || (k !== null && k < naechste)) ab('id_belegt', id);
      if (k !== null) naechste = k + 1;
    } else {
      do { id = `n${naechste}`; naechste += 1; } while (vorhanden.has(id));
    }
    vorhanden.add(id);
    clip.noten.push({ id, beat: f.beat, laenge: f.laenge, ton: f.ton, vel: f.vel });
  });
  p.naechste_noten_id = naechste;
}

// --- Einzelne Befehle (verändern den Entwurf `p`) ---------------------------------------------------------------------
const MIXER = ['fader_db', 'pan', 'mute', 'solo'] as const;
// ctx.quelle: wer den Befehl gibt (der Verlauf reicht meta.quelle durch); spur_neu schreibt sie als von in die Spur (Spec 6.22)
// ctx.graphArt (Baukasten S20): lookup of a graph name in the graph folder, 'instrument' | 'effekt' | null (unknown); absent = name rule only
// ctx.kitDa (1.9, L25): does the kit folder hold a kit of this name; absent = name rule only
// ctx.presetLies (1.9, O28): reads a preset by id ("werk:rb338/dark-dub") from the preset store, null = no such preset; absent = preset_anwenden refuses
export interface PresetInhalt { geraet: string; werte: Record<string, unknown> }
interface Kontext {
  quelle: Herkunft; graphArt?: (name: string) => 'instrument' | 'effekt' | null; kitDa?: (name: string) => boolean;
  presetLies?: (id: string) => PresetInhalt | null;
  surgeBereich?: (name: string) => [number, number] | null;   // 1.9 U5: range of a Surge parameter (display units), null = unknown name
  surgeIst?: (slot: number, name: string) => number | null;   // 1.9 U5: the value the host of the slot plays now (display units), null = not known
  surgePatchDa?: (name: string) => boolean;                   // does the Surge patch library hold this name; absent = the name rule only
  surgeFilter1An?: (slot: number) => boolean | null;          // is filter 1 on in the patch the host of the slot plays; null = not known (not blocked)
  pluginDa?: (plugin: { format: string; pfad: string; uid: string }) => boolean;   // plan 1.11 T7: does the plugin file exist (absent = not checked)
  pluginIndex?: (id: string) => PluginEintrag | null;   // plan 1.11 T10: the plugin index entry of an ID (absent = no index: plugin_unbekannt)
  // strudel-clip: the Strudel side (child process, areas/proj/pattern_run.ts; tests hand in the module itself), the sounds of a kit
  // (null = no such kit) and a collector of the report of each generated clip
  musterUebersetze?: (a: { code: string; takte: number | null }) => MusterErgebnis | MusterFehlschlag;
  kitKlaenge?: (name: string) => KitKlang[] | null;
  musterMeldung?: (m: MusterMeldung) => void;
}
export interface MusterMeldung {
  clip_id: string; spur_id: string; noten_zahl: number; takte: number; loop_beats: number | null;
  huellkurven: string[]; ohne_ziel: string[]; hinweise: string[];
}
export interface PluginEintrag { format: 'vst3' | 'lv2'; pfad: string; uid: string; name: string; art: string; status: string; grund?: string }
// preset ids of the RB-338 as the register prints them: <herkunft>:rb338/<slug> (presets/model.ts SLUG)
const RB_PRESET_ID = /^(?:werk|nutzer):rb338\/[a-z0-9][a-z0-9-]{0,47}$/;
const PRO_BEFEHL: Record<string, (p: Projekt, a: Args, ctx: Kontext) => void> = {
  spur_neu(p, a, ctx) {
    erlaube(a, 'art', 'name', 'geraet', 'gruppe');
    const art = a.art;
    if (art !== 'audio' && art !== 'instrument') ab('argument_ungueltig', 'art: audio oder instrument erwartet');
    if (art === 'audio' && a.geraet !== undefined) ab('argument_ungueltig', 'geraet: nur für Instrument-Spuren');
    if (p.spuren.length >= MAX_SPUREN) ab('spur_bereich', `alle ${MAX_SPUREN} Spuren belegt`);
    const nr = Array.from({ length: MAX_SPUREN }, (_, i) => i + 1).find((n) => !p.spuren.some((s) => s.nr === n)) ?? ab('spur_bereich', 'keine freie Nummer');
    const spurId = neueId(p, 'spur');
    const geraet = art === 'instrument' ? baueGeraet(p, a.geraet ?? { art: 'intern' }, undefined, ctx, undefined, spurId) : undefined;
    const standard = geraet?.art === 'rack' ? 'Rack' : geraet?.art === 'intern'   // S20: a bk track is named after its graph; 1.9: a kit track after its kit
      ? (geraet.name === 'bk' ? geraet.graph : geraet.name === 'kit' ? `KIT · ${geraet.kit}` : 'RB-338')
      : geraet?.art === 'wirt' && geraet.plugin ? geraet.plugin.name : 'Surge';
    const name = text(a, 'name', 80) ?? (art === 'audio' ? `Audio ${nr}` : standard);
    const gruppe = gruppeArg(a);
    const spur: Spur = { id: spurId, von: ctx.quelle, ...(gruppe !== undefined ? { gruppe } : {}), nr, name,
      farbe: SPUR_FARBEN[(nr - 1) % SPUR_FARBEN.length], art,
      ...(geraet ? { geraet } : {}), ...(wirtSlots({ art, geraet }).length > 0 ? { freeze: null } : {}),
      fader_db: 0, pan: 0, mute: false, solo: false, clips: [] };
    p.spuren.push(spur);
  },

  spur_aendern(p, a, ctx) {
    if (a.von !== undefined) ab('argument_ungueltig', 'von: unveränderlich (Spec 6.22), die Herkunft einer Spur ändert kein Befehl');
    erlaube(a, 'spur_id', 'name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'geraet', 'gruppe', 'arm', 'eingang', 'monitor');
    const s = spurVon(p, idArg(a, 'spur_id'));
    if (['name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'geraet', 'gruppe', 'arm', 'eingang', 'monitor'].every((k) => a[k] === undefined)) {
      ab('argument_ungueltig', 'keine Änderung angegeben');
    }
    const name = text(a, 'name', 80);
    const gruppe = a.gruppe === null ? null : gruppeArg(a);       // null nimmt die Spur aus ihrer Gruppe
    if (a.farbe !== undefined && (typeof a.farbe !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(a.farbe))) ab('argument_ungueltig', 'farbe: #rrggbb erwartet');
    const fader = zahl(a, 'fader_db', FADER_MIN, FADER_MAX, { opt: true }), pan = zahl(a, 'pan', -1, 1, { opt: true });
    const mute = flagge(a, 'mute', true), solo = flagge(a, 'solo', true);
    if (a.geraet !== undefined && s.art !== 'instrument') ab('argument_ungueltig', 'geraet: nur für Instrument-Spuren');
    const geraet = a.geraet !== undefined ? baueGeraet(p, a.geraet, s.id, ctx) : undefined;
    if (a.arm !== undefined || a.eingang !== undefined || a.monitor !== undefined) {   // 1.8: kein Regler, kein Neuladen (wiedergabeSicht kennt das Feld nicht)
      if (a.arm !== undefined && typeof a.arm !== 'boolean') ab('argument_ungueltig', 'arm: true oder false erwartet');
      if (a.monitor !== undefined && !['aus', 'auto', 'ein'].includes(a.monitor as string)) ab('argument_ungueltig', 'monitor: aus, auto or ein expected');
      const alt = s.aufnahme ?? { scharf: false, eingang: null };
      let eingang = alt.eingang;
      if (a.eingang === null) eingang = null;
      else if (a.eingang !== undefined) eingang = eingangVon(s.art, a.eingang);
      const monitor = a.monitor === undefined ? alt.monitor : a.monitor === 'auto' ? undefined : a.monitor;   // auto is the canonical absence (D11)
      const scharf = a.arm ?? alt.scharf;
      if (scharf && eingang === null) ab('kein_eingang', 'arm braucht einen Eingang');
      // the cap of eight counts audio tracks only; an armed instrument track (midi) does not take a slot
      if (s.art === 'audio' && scharf && !alt.scharf
        && p.spuren.filter((x) => x !== s && x.art === 'audio' && x.aufnahme?.scharf).length >= MAX_ARM_AUDIO) {
        ab('zu_viele_scharf', `höchstens ${MAX_ARM_AUDIO} scharfe Audio-Spuren`);
      }
      if (scharf || eingang !== null || monitor !== undefined) s.aufnahme = { scharf, eingang, ...(monitor !== undefined ? { monitor } : {}) } as SpurAufnahme;
      else delete s.aufnahme;
    }
    if (name !== undefined) s.name = name;
    if (gruppe === null) delete s.gruppe; else if (gruppe !== undefined) s.gruppe = gruppe;
    if (a.farbe !== undefined) s.farbe = a.farbe;
    if (fader !== undefined) s.fader_db = fader;
    if (pan !== undefined) s.pan = pan;
    if (mute !== undefined) s.mute = mute;
    if (solo !== undefined) s.solo = solo;
    if (geraet && (s.automation ?? []).some((l) => istGeraetZiel(l.ziel) && !passtGeraetZiel(l.ziel, geraet))) {
      ab('geraet_lanes', `${s.id}: delete its geraet.* lanes before switching to a device that does not have those parameters`);
    }
    // 1.12 slice 5: the same rule for the geraet.* envelopes of the track's clips
    if (geraet && s.clips.some((c) => (c.huellkurven ?? []).some((h) => istGeraetZiel(h.ziel) && !passtGeraetZiel(h.ziel, geraet)))) {
      ab('geraet_huellkurven', `${s.id}: delete the geraet.* envelopes of its clips before switching to a device that does not have those parameters`);
    }
    if (geraet && kanonisch(geraet) !== kanonisch(s.geraet)) {
      s.geraet = geraet;
      freezeFeld(s);
      bereinigeGliedZiele(s);   // 1.9 U8 T8: a conversion away from a rack, or to other members, takes the member targets with it
    }
  },

  // 1.9 U7 (spec 4.4, E11): the member list of a rack track. A structure change = a playback swap (like a device change).
  // glied.id absent = add with the lowest free id g1..g4; present = replace that member. The model checks zones and counts at the end of the command.
  rack_glied_setzen(p, a, ctx) {
    erlaube(a, 'spur_id', 'glied');
    const g = rackGeraetVon(p, a);
    if (!istObjekt(a.glied)) ab('argument_ungueltig', 'glied: object expected');
    const id = a.glied.id;
    if (id !== undefined && typeof id !== 'string') ab('argument_ungueltig', 'glied.id: string expected');
    const stelle = id === undefined ? -1 : g.glieder.findIndex((m) => m.id === id);
    if (id !== undefined && stelle < 0) ab('glied_unbekannt', String(id));
    let neuId = id as string | undefined;
    if (id === undefined) {
      neuId = ['g1', 'g2', 'g3', 'g4'].find((k) => !g.glieder.some((m) => m.id === k));
      if (neuId === undefined) ab('rack_voll_glieder', `at most ${MAX_GLIEDER} members per rack`);
    }
    const andere = new Set(g.glieder.filter((_, i) => i !== stelle).flatMap((x) => (x.geraet.art === 'wirt' ? [x.geraet.slot] : [])));
    const m = baueGlied(p, { ...a.glied, id: neuId }, 'glied', a.spur_id as string, ctx, andere);
    if (stelle >= 0) g.glieder[stelle] = m; else g.glieder.push(m);
    freezeFeld(spurVon(p, a.spur_id as string));
    bereinigeGliedZiele(spurVon(p, a.spur_id as string));   // 1.9 U8 T8: a replaced member keeps only the targets its new device allows
  },

  rack_glied_entfernen(p, a) {
    erlaube(a, 'spur_id', 'glied_id');
    const g = rackGeraetVon(p, a);
    if (typeof a.glied_id !== 'string') ab('argument_ungueltig', 'glied_id: string expected');
    const stelle = g.glieder.findIndex((m) => m.id === a.glied_id);
    if (stelle < 0) ab('glied_unbekannt', a.glied_id);
    if (g.glieder.length === 1) ab('rack_letztes_glied', 'the last member cannot go; convert the track to a plain device instead');
    g.glieder.splice(stelle, 1);
    freezeFeld(spurVon(p, a.spur_id as string));
    bereinigeGliedZiele(spurVon(p, a.spur_id as string));   // 1.9 U8 T8: never a dangling `glied` id; undo restores both
  },

  rack_kette(p, a) {
    erlaube(a, 'spur_id', 'kette');
    const g = rackGeraetVon(p, a);
    if (!zahlOk(a.kette) || !Number.isInteger(a.kette) || a.kette < 0 || a.kette > 127) ab('argument_ungueltig', 'kette: integer 0..127 expected');
    g.kette = a.kette;
    freezeFeld(spurVon(p, a.spur_id as string));
  },

  // Paket 1.18, E-c: die gewählte Spur laut (mute false), alle anderen Spuren derselben Gruppe stumm (mute true); Spuren außerhalb der Gruppe
  // bleiben unberührt. Ein Befehl, also ein Undo-Schritt. Die Spur muss zur Gruppe gehören (sonst argument_ungueltig).
  variante_waehlen(p, a) {
    erlaube(a, 'gruppe', 'spur_id');
    const gruppe = gruppeArg(a, false) as string;
    const gewaehlt = spurVon(p, idArg(a, 'spur_id'));
    if (gewaehlt.gruppe !== gruppe) ab('argument_ungueltig', `spur_id: ${gewaehlt.id} gehört nicht zur Gruppe ${gruppe}`);
    for (const s of p.spuren) if (s.gruppe === gruppe) s.mute = s !== gewaehlt;
  },

  // 1.14 comping, slice 1: take lanes are read-only containers (R7); these commands never touch s.clips, so playback stays as it is
  take_neu(p, a) {
    erlaube(a, 'spur_id', 'name');
    const s = spurVon(p, idArg(a, 'spur_id'));
    if (s.art !== 'audio') ab('take_nur_audio', s.id);
    if ((s.takes ?? []).length >= MAX_TAKES_PRO_SPUR) ab('takes_voll', `at most ${MAX_TAKES_PRO_SPUR} take lanes per track`);
    const nummer = (s.takes ?? []).filter((t) => t.art === undefined).length + 1;   // the Original lane does not count
    const name = a.name === undefined ? `Take ${nummer}` : takeName(a.name);
    (s.takes ??= []).push({ id: neueId(p, 'take'), name, clips: [] });
  },

  take_umbenennen(p, a) {
    erlaube(a, 'spur_id', 'take_id', 'name');
    const { take } = takeVon(p, a);
    take.name = takeName(a.name);                 // art stays: the Original lane keeps its mark
  },

  take_loeschen(p, a) {
    erlaube(a, 'spur_id', 'take_id');
    const { spur, take } = takeVon(p, a);
    spur.takes!.splice(spur.takes!.indexOf(take), 1);
    entferneLeereTakes(p);                         // never leave `takes: []` behind (undo and redo patches would carry it)
  },

  // 1.14 comping (spec R4, R5): the main lane over [von, bis) becomes what the take lane holds there (gaps stay silent). Clones of the take
  // clips overlapping the range join s.clips next to the main clips (that overlap exists only inside this command; the project is validated
  // once, at the end), both sides are cut at von and bis by the clip_teilen rules, then main parts inside and clone parts outside the range go.
  // The take list is never touched, so no empty list can appear and entferneLeereTakes is not needed.
  comp_waehlen(p, a) {
    erlaube(a, 'spur_id', 'take_id', 'von_beat', 'bis_beat');
    const { spur, take } = takeVon(p, a);
    for (const k of ['von_beat', 'bis_beat']) if (!zahlOk(a[k])) ab('argument_ungueltig', `${k}: number expected`);
    const von: number = a.von_beat, bis: number = a.bis_beat;
    if (!(von >= 0 && bis <= MAX_BEAT && bis > von)) ab('comp_leer', `${von}..${bis} must lie inside 0..${MAX_BEAT} and be longer than 0`);
    const ende = (c: Clip): number => c.start_beat + c.laenge_beats;
    const drin = (c: Clip): boolean => c.start_beat < bis - COMP_EPS && ende(c) > von + COMP_EPS;          // overlaps [von, bis)
    const schneidet = (c: Clip, t: number): boolean => c.start_beat < t - COMP_EPS && ende(c) > t + COMP_EPS;   // t lies strictly inside
    const quellen = take.clips.filter(drin);
    for (const c of [...spur.clips, ...quellen]) {
      if (c.loop_beats != null && (schneidet(c, von) || schneidet(c, bis))) ab('ersetzen_loop', c.id);
    }
    if (compGleich(spur.clips.filter(drin), quellen, von, bis, p.tempo_bpm)) return;                       // no-op: nothing spent, nothing changed
    const klon = new Set<string>();
    for (const c of quellen) { const k = { ...structuredClone(c), id: neueId(p, 'clip') }; klon.add(k.id); spur.clips.push(k); }
    teileClipsAn(p, spur, [von, bis], (alt, neu) => { if (klon.has(alt.id)) klon.add(neu.id); });         // the second part of a clone is a clone
    spur.clips = spur.clips.filter((c) => (klon.has(c.id) ? drin(c) : !drin(c)));
    const haupt = spur.clips.filter((c): c is AudioClip => c.art === 'audio' && !klon.has(c.id));
    const klone = spur.clips.filter((c): c is AudioClip => c.art === 'audio' && klon.has(c.id));
    for (const k of klone) {                                                                               // clones sit at the right place in the lane
      spur.clips.splice(spur.clips.indexOf(k), 1);
      const i = spur.clips.findIndex((c) => !klon.has(c.id) && c.start_beat >= k.start_beat - COMP_EPS);
      spur.clips.splice(i < 0 ? spur.clips.length : i, 0, k);
    }
    const fade = (COMP_FADE_S * p.tempo_bpm) / 60;
    for (const m of haupt) for (const k of klone) {                                                        // seams only where main and clone touch
      const ziel = Math.min(fade, Math.min(m.laenge_beats, k.laenge_beats) / 2);
      const nahe = (x: number, y: number): boolean => Math.abs(x - y) <= COMP_EPS;
      if (nahe(ende(m), von) && nahe(k.start_beat, von)) { compFade(m, 'fade_aus_beats', ziel); compFade(k, 'fade_ein_beats', ziel); }
      if (nahe(ende(k), bis) && nahe(m.start_beat, bis)) { compFade(k, 'fade_aus_beats', ziel); compFade(m, 'fade_ein_beats', ziel); }
    }
  },

  spur_loeschen(p, a) {
    erlaube(a, 'spur_id');
    const s = spurVon(p, idArg(a, 'spur_id'));
    p.spuren.splice(p.spuren.indexOf(s), 1);
    // slice 4: a stage keyed on this track would dangle and silently re-bind to a later track taking the number; drop the key (the sc row resets to 0)
    for (const x of alleInserts(p)) {
      if (x.insert.sc === s.nr) delete x.insert.sc;
      if (x.insert.key?.quelle === 'spur' && x.insert.key.nr === s.nr) delete x.insert.key;   // slice 5: the same for a post key
    }
  },

  spur_verschieben(p, a) {
    erlaube(a, 'spur_id', 'index');
    const s = spurVon(p, idArg(a, 'spur_id'));
    if (!Number.isInteger(a.index)) ab('argument_ungueltig', 'index: ganze Zahl erwartet');
    if (a.index < 0 || a.index >= p.spuren.length) ab('index_bereich', `${a.index} (0..${p.spuren.length - 1})`);
    p.spuren.splice(p.spuren.indexOf(s), 1);
    p.spuren.splice(a.index, 0, s);
  },

  clip_neu(p, a) {
    erlaube(a, 'spur_id', 'art', 'start_beat', 'laenge_beats', 'loop_beats', 'sha256', 'name', 'pfad_hinweis', 'noten', 'warp');
    const s = spurVon(p, idArg(a, 'spur_id'));
    if (a.art !== 'audio' && a.art !== 'midi') ab('argument_ungueltig', 'art: audio oder midi erwartet');
    if (a.art !== (s.art === 'audio' ? 'audio' : 'midi')) ab('art_passt_nicht', `${a.art}-Clip auf ${s.art}-Spur`);
    const start = zahl(a, 'start_beat', 0, MAX_BEAT)!, laenge = zahl(a, 'laenge_beats', 0, MAX_BEAT, { offenUnten: true })!;
    // Spec 6.17: loop_beats 1/16 ≤ x ≤ laenge_beats; null oder fehlend = kein Loop (das Feld bleibt dann weg)
    const loop = a.loop_beats === undefined || a.loop_beats === null ? null : zahl(a, 'loop_beats', LOOP_MIN, MAX_BEAT)!;
    if (loop !== null && loop > laenge + 1e-9) ab('argument_ungueltig', `loop_beats: höchstens laenge_beats (${laenge})`);
    const id = neueId(p, 'clip');
    if (a.art === 'audio') {
      if (a.noten !== undefined) ab('argument_ungueltig', 'noten: nur für MIDI-Clips');
      const warp = warpArg(a.warp);
      if (typeof a.sha256 !== 'string' || !SHA.test(a.sha256)) ab('sha_ungueltig', 'sha256: 64 Hex-Zeichen (klein) aus dem Katalog erwartet');
      const hinweis = a.pfad_hinweis === undefined ? ''
        : (typeof a.pfad_hinweis === 'string' && a.pfad_hinweis.length <= 4096 ? a.pfad_hinweis : ab('argument_ungueltig', 'pfad_hinweis: Text erwartet'));
      const vonPfad = hinweis.split('/').pop()?.replace(/\.[^.]*$/, '').slice(0, 80);
      s.clips.push({ id, art: 'audio', name: text(a, 'name', 80) ?? (vonPfad || 'Audio'), start_beat: start, laenge_beats: laenge,
        quelle: { sha256: a.sha256, pfad_hinweis: hinweis }, dekodiert: 'nein', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0,
        ...(loop === null ? {} : { loop_beats: loop }), ...(warp === null ? {} : { warp }) });
    } else {
      if (a.warp !== undefined) ab('feld_nur_audio', 'warp');
      if (a.sha256 !== undefined || a.pfad_hinweis !== undefined) ab('argument_ungueltig', 'sha256/pfad_hinweis: nur für Audio-Clips');
      const clip: MidiClip = { id, art: 'midi', name: text(a, 'name', 80) ?? 'MIDI', start_beat: start, laenge_beats: laenge,
        ...(loop === null ? {} : { loop_beats: loop }), noten: [] };
      if (a.noten !== undefined) fuegeNotenEin(p, clip, listeArg(a, 'noten'));
      s.clips.push(clip);
    }
  },

  // strudel-clip: a Strudel pattern becomes the notes (and envelopes) of a MIDI clip. New clip: spur_id + start_beat + code (+ takte, name); in place: clip_id
  // (+ code, takte): the notes and envelopes of that clip are replaced, the clip keeps id, start and length; without code it is generated again from
  // its stored muster.code. 1 cycle = 1 bar. takte absent: a new clip is as long as the pattern takes to repeat (capped), an existing clip keeps its length.
  clip_aus_muster(p, a, ctx) {
    erlaube(a, 'spur_id', 'start_beat', 'clip_id', 'code', 'takte', 'name', 'ueberschreiben');
    if (a.ueberschreiben !== undefined && typeof a.ueberschreiben !== 'boolean') ab('argument_ungueltig', 'ueberschreiben: true or false expected');
    if ((a.spur_id === undefined) === (a.clip_id === undefined)) ab('argument_ungueltig',
      'give spur_id (a new clip) or clip_id (generate an existing clip again), not both');
    let spur: Spur, bestehend: MidiClip | null = null;
    if (a.clip_id !== undefined) {
      const g = clipVon(p, idArg(a, 'clip_id'));
      bestehend = midiVon(g.clip, a.clip_id); spur = g.spur;
      if (a.start_beat !== undefined) ab('argument_ungueltig', 'start_beat: only for a new clip');
    } else {
      spur = spurVon(p, idArg(a, 'spur_id'));
      if (spur.art !== 'instrument') ab('art_passt_nicht', `${spur.id} is an audio track: a pattern makes MIDI clips`);
    }
    const code = a.code ?? bestehend?.muster?.code;
    if (typeof code !== 'string' || code.trim() === '' || code.length > MUSTER_CODE_MAX) {
      ab(a.code === undefined && bestehend ? 'muster_fehlt' : 'argument_ungueltig', a.code === undefined && bestehend
        ? `${bestehend.id} has no stored pattern: give code` : `code: text of 1..${MUSTER_CODE_MAX} characters expected`);
    }
    const takte = zahl(a, 'takte', 0, 1024, { opt: true, offenUnten: true }) ?? (bestehend ? bestehend.laenge_beats / 4 : null);
    const start = bestehend ? bestehend.start_beat : zahl(a, 'start_beat', 0, MAX_BEAT)!;
    const name = text(a, 'name', 80);
    // generating again replaces notes and envelopes: what was changed by hand since the pattern made them is only replaced when asked for
    if (bestehend && a.ueberschreiben !== true && bestehend.muster?.abdruck !== undefined && bestehend.muster.abdruck !== musterAbdruck(bestehend)) {
      ab('handarbeit_vorhanden',
        `${bestehend.id}: notes or envelopes were changed by hand since the pattern made them; pass ueberschreiben: true to replace them`);
    }
    if (!ctx.musterUebersetze) ab('muster_nicht_verfuegbar', 'this server cannot translate Strudel patterns');
    const g = spur.geraet;
    const kitName = g?.art === 'intern' && g.name === 'kit' ? g.kit : null;
    let klaenge: KitKlang[] | null = null;
    if (kitName !== null) {
      klaenge = ctx.kitKlaenge?.(kitName) ?? null;
      if (klaenge === null) ab('kit_unbekannt', kitName);
    }
    const erg = ctx.musterUebersetze!({ code: code as string, takte });
    if (!erg.ok) return ab(erg.grund, erg.fehler);
    const r = wendeMusterAn(erg, spur, klaenge, kitName, (ziel) => laneStart(spur, ziel as Ziel));
    if ('grund' in r) return ab(r.grund, r.text);
    const clip: MidiClip = bestehend ?? {
      id: neueId(p, 'clip'), art: 'midi', name: name ?? 'Pattern', start_beat: start, laenge_beats: erg.laenge_beats, noten: [],
    };
    if (bestehend && name !== undefined) clip.name = name;
    clip.laenge_beats = erg.laenge_beats;
    if (erg.loop_beats === null) delete clip.loop_beats; else clip.loop_beats = erg.loop_beats;
    clip.noten = [];
    if (r.noten.length) fuegeNotenEin(p, clip, r.noten as unknown[]);
    for (const h of r.huellkurven) {
      const f = huellkurvePruefung(h, clip, spur);
      if (f) ab(f.grund, f.text);
    }
    if (r.huellkurven.length) clip.huellkurven = r.huellkurven; else delete clip.huellkurven;
    clip.muster = { code: code as string, ...(r.ohne_ziel.length ? { ohne_ziel: r.ohne_ziel } : {}), abdruck: musterAbdruck(clip) };
    if (!bestehend) spur.clips.push(clip);
    ctx.musterMeldung?.({ clip_id: clip.id, spur_id: spur.id, noten_zahl: clip.noten.length, takte: erg.takte, loop_beats: erg.loop_beats,
      huellkurven: r.huellkurven.map((h) => h.ziel), ohne_ziel: r.ohne_ziel, hinweise: r.hinweise });
  },

  clip_aendern(p, a) {
    erlaube(a, 'clip_id', 'start_beat', 'laenge_beats', 'loop_beats', 'offset_s', 'gain_db', 'fade_ein_beats', 'fade_aus_beats', 'spur_id', 'name',
      'versatz_beats', 'stumm', 'entstehung');
    const { spur, clip } = clipVon(p, idArg(a, 'clip_id'));
    const felder = ['start_beat', 'laenge_beats', 'loop_beats', 'offset_s', 'gain_db', 'fade_ein_beats', 'fade_aus_beats', 'spur_id', 'name',
      'versatz_beats', 'stumm', 'entstehung'];
    if (felder.every((k) => a[k] === undefined)) ab('argument_ungueltig', 'keine Änderung angegeben');
    for (const k of ['offset_s', 'gain_db', 'fade_ein_beats', 'fade_aus_beats', 'versatz_beats', 'stumm', 'entstehung']) {
      if (a[k] !== undefined && clip.art !== 'audio') ab('feld_nur_audio', k);
    }
    const versatz = zahl(a, 'versatz_beats', -MAX_BEAT, MAX_BEAT, { opt: true });
    const start = zahl(a, 'start_beat', 0, MAX_BEAT, { opt: true }), laenge = zahl(a, 'laenge_beats', 0, MAX_BEAT, { opt: true, offenUnten: true });
    const offset = zahl(a, 'offset_s', 0, 1e7, { opt: true }), gain = zahl(a, 'gain_db', GAIN_MIN, GAIN_MAX, { opt: true });
    const ein = zahl(a, 'fade_ein_beats', 0, MAX_BEAT, { opt: true }), aus = zahl(a, 'fade_aus_beats', 0, MAX_BEAT, { opt: true });
    const name = text(a, 'name', 80);
    const loop = a.loop_beats === undefined || a.loop_beats === null ? a.loop_beats as null | undefined : zahl(a, 'loop_beats', LOOP_MIN, MAX_BEAT)!;
    let ziel: Spur | undefined;
    if (a.spur_id !== undefined) {
      ziel = spurVon(p, idArg(a, 'spur_id'));
      if (clip.art !== (ziel.art === 'audio' ? 'audio' : 'midi')) ab('art_passt_nicht', `${clip.art}-Clip auf ${ziel.art}-Spur`);
      for (const h of clip.huellkurven ?? []) {     // 1.12 slice 5: the envelopes must fit the new track (geraet.* on RB-338 tracks only)
        const f = huellkurvePruefung(h, clip, ziel);
        if (f) ab(f.grund, f.text);
      }
    }
    if (start !== undefined) clip.start_beat = start;
    if (laenge !== undefined) clip.laenge_beats = laenge;
    // Spec 6.17: loop_beats ≤ laenge_beats. Ausdrücklich zu lang ist ein Fehler; eine kürzere Länge zieht den Loop mit.
    if (loop !== undefined) {
      if (loop !== null && loop > clip.laenge_beats + 1e-9) ab('argument_ungueltig', `loop_beats: höchstens laenge_beats (${clip.laenge_beats})`);
      clip.loop_beats = loop;
    } else if (clip.loop_beats != null && clip.loop_beats > clip.laenge_beats) clip.loop_beats = clip.laenge_beats;
    // 1.12 slice 5: an envelope loop longer than the clip is clamped like the clip loop; its points stay (silent beyond the clip)
    for (const h of clip.huellkurven ?? []) if (h.loop_beats !== undefined && h.loop_beats > clip.laenge_beats) h.loop_beats = clip.laenge_beats;
    if (name !== undefined) clip.name = name;
    if (clip.art === 'audio') {
      // Paket 1.13: bei Warp an liest der Clip nicht über offset_s, sondern über versatz_beats (Beats, tempounabhängig)
      if (offset !== undefined && clip.warp?.an) ab('offset_bei_warp', 'der Clip ist gewarpt: den Inhalt verschiebt versatz_beats');
      if (versatz !== undefined && !clip.warp) ab('kein_warp', clip.id);
      const fv = versatz !== undefined && clip.warp ? warpPruefung({ ...clip.warp, versatz_beats: versatz }) : null;
      if (fv) ab(fv.grund, fv.text);
      if (offset !== undefined) clip.offset_s = offset;
      if (versatz !== undefined && clip.warp) clip.warp = { ...clip.warp, versatz_beats: versatz };
      if (gain !== undefined) clip.gain_db = gain;
      if (a.stumm !== undefined) {
        if (typeof a.stumm !== 'boolean') ab('argument_ungueltig', 'stumm: true oder false erwartet');
        if (a.stumm) clip.stumm = true; else delete clip.stumm;
      }
      if (a.entstehung !== undefined) {   // S15: provenance of a stream take; null deletes the field (absent, never null in the file)
        if (a.entstehung === null) delete clip.entstehung;
        else {
          const fe = entstehungPruefung(a.entstehung);
          if (fe) ab(fe.grund, fe.text);
          clip.entstehung = structuredClone(a.entstehung) as Entstehung;
        }
      }
      if (ein !== undefined) clip.fade_ein_beats = ein;
      if (aus !== undefined) clip.fade_aus_beats = aus;
      if (clip.fade_ein_beats + clip.fade_aus_beats > clip.laenge_beats + 1e-9) {
        ab('fade_zu_lang', `${clip.fade_ein_beats} + ${clip.fade_aus_beats} > ${clip.laenge_beats}`);
      }
    }
    if (ziel && ziel !== spur) { spur.clips.splice(spur.clips.indexOf(clip), 1); ziel.clips.push(clip); }
  },

  clip_teilen(p, a) {
    erlaube(a, 'clip_id', 'beat');
    const { spur, clip } = clipVon(p, idArg(a, 'clip_id'));
    if (clip.loop_beats != null) ab('argument_ungueltig', 'Loop-Clip: erst den Loop ausschalten (loop_beats null), dann teilen (Spec 6.17)');
    const beat = zahl(a, 'beat', -MAX_BEAT, MAX_BEAT)!;
    const rel = beat - clip.start_beat, rest = clip.start_beat + clip.laenge_beats - beat;
    if (!(rel > 0 && rest > 0)) ab('beat_ausserhalb', `${beat} liegt nicht im Inneren von ${clip.start_beat}..${clip.start_beat + clip.laenge_beats}`);
    const id = neueId(p, 'clip');
    let zweiter: Clip;
    if (clip.art === 'audio') {
      const zw: AudioClip = { ...structuredClone(clip), id, start_beat: beat, laenge_beats: rest,
        offset_s: runde9(clip.offset_s + rel * 60 / p.tempo_bpm), fade_ein_beats: 0, fade_aus_beats: Math.min(clip.fade_aus_beats, rest) };
      // Paket 1.13: der zweite Teil beginnt rel Beats weiter im Inhalt, exakt in Beats und unabhängig vom Tempo
      if (zw.warp) zw.warp = { ...zw.warp, versatz_beats: runde9(zw.warp.versatz_beats + rel) };
      zweiter = zw;
      clip.fade_ein_beats = Math.min(clip.fade_ein_beats, rel); clip.fade_aus_beats = 0;
    } else {
      const erste: Note[] = [], zweite: Note[] = [], quer: Note[] = [];
      for (const n of clip.noten) {
        if (n.beat + n.laenge <= rel) erste.push(n);
        else if (n.beat >= rel) zweite.push({ ...n, beat: runde9(n.beat - rel) });
        else { erste.push({ ...n, laenge: runde9(rel - n.beat) }); quer.push({ ...n, beat: 0, laenge: runde9(n.beat + n.laenge - rel) }); }
      }
      zweiter = { ...structuredClone(clip), id, start_beat: beat, laenge_beats: rest, noten: zweite };
      for (const q of quer) { q.id = neueNotenId(p); zweiter.noten.push(q); }
      clip.noten = erste;
      delete clip.muster; delete (zweiter as MidiClip).muster;   // strudel-clip: a cut clip is no longer what the pattern makes
    }
    if (clip.huellkurven) {                        // 1.12 slice 5 (T6.4): linked envelopes are cut, unlinked ones rotate on the right part
      const teile = clip.huellkurven.map((h) => teileHuellkurve(h, rel));
      clip.huellkurven = teile.map((t) => t.links); zweiter.huellkurven = teile.map((t) => t.rechts);
      // an unlinked loop longer than a part is clamped to that part (as clip_aendern does): the part never reaches a repetition, so it sounds the same
      for (const [c, laenge] of [[clip, rel], [zweiter, rest]] as const) {
        for (const h of c.huellkurven ?? []) if (h.loop_beats !== undefined && h.loop_beats > laenge) h.loop_beats = laenge;
      }
    }
    clip.laenge_beats = rel;
    spur.clips.splice(spur.clips.indexOf(clip) + 1, 0, zweiter);
  },

  // Paket 1.13: Warp eines Audio-Clips. Entweder das ganze Objekt (`warp`, null oder 'aus' entfernt es) oder einzelne Felder des vorhandenen Warps.
  warp_setzen(p, a) {
    erlaube(a, 'clip_id', 'warp', ...WARP_FELDER);
    const gefunden = clipVon(p, idArg(a, 'clip_id')).clip;
    const clip = gefunden.art === 'audio' ? gefunden : ab('feld_nur_audio', 'warp');
    const einzeln = WARP_FELDER.filter((k) => a[k] !== undefined);
    if (a.warp !== undefined) {
      if (einzeln.length) ab('argument_ungueltig', `warp: entweder das ganze Objekt oder einzelne Felder (${einzeln.join(', ')})`);
      const w = warpArg(a.warp);
      if (w === null) delete clip.warp; else clip.warp = w;
      return;
    }
    if (!einzeln.length) ab('argument_ungueltig', 'keine Änderung angegeben');
    const alt = clip.warp ?? ab('kein_warp', clip.id);
    const neu: Warp = structuredClone(alt);
    if (a.an !== undefined) neu.an = flagge(a, 'an')!;
    if (a.modus !== undefined) neu.modus = a.modus;
    if (a.transpose_st !== undefined) neu.transpose_st = a.transpose_st;
    if (a.detune_ct !== undefined) neu.detune_ct = a.detune_ct;
    if (a.beats !== undefined) neu.beats = structuredClone(a.beats) as Warp['beats'];
    const f = warpPruefung(neu);
    if (f) ab(f.grund, f.text);
    clip.warp = neu;
  },

  // Paket 1.13: Auto-Warp aus den Tempo-Angaben der Library löst der Server auf (session.ts loeseQuellenAuf schreibt den Befehl in warp_setzen
  // um); ohne Katalog bleibt nur diese Ablehnung
  warp_auto(p, a) {
    erlaube(a, 'clip_id');
    if (clipVon(p, idArg(a, 'clip_id')).clip.art !== 'audio') ab('feld_nur_audio', 'warp');
    ab('argument_ungueltig', 'warp_auto braucht den Katalog des Servers (Tempo-Angaben der Library)');
  },

  // Slice 3b (Spec 5.5): ×2 / :2. Die Beats aller Marker, der Versatz, die Länge und der Loop des Clips werden mit dem Faktor multipliziert: derselbe
  // Ausschnitt der Quelle klingt, nur mit doppelt (halb) so vielen Beats. Die Fades bleiben in Beats; reichen sie danach über den Clip: fade_zu_lang.
  warp_tempo(p, a) {
    erlaube(a, 'clip_id', 'faktor');
    const clip = warpClip(p, a);
    const warp = gueltig(mitWarp(() => tempoSkalieren(clip.warp, a.faktor)));
    const laenge = clip.laenge_beats * a.faktor;
    if (laenge > MAX_BEAT) ab('argument_ungueltig', `laenge_beats: höchstens ${MAX_BEAT}`);
    const loop = clip.loop_beats == null ? null : clip.loop_beats * a.faktor;
    if (loop !== null && loop < LOOP_MIN) ab('argument_ungueltig', `loop_beats: mindestens ${LOOP_MIN}`);
    if (clip.fade_ein_beats + clip.fade_aus_beats > laenge + 1e-9) ab('fade_zu_lang', `${clip.fade_ein_beats} + ${clip.fade_aus_beats} > ${laenge}`);
    clip.warp = warp; clip.laenge_beats = laenge;
    if (loop !== null) clip.loop_beats = loop;
  },
  // Slice 3b: Marker setzen, löschen, verschieben (Reihenfolge löschen → verschieben → setzen; Beats wie vor dem Befehl). Die Länge des Clips bleibt.
  warp_marker(p, a) {
    erlaube(a, 'clip_id', 'setze', 'loesche', 'verschiebe');
    const clip = warpClip(p, a);
    if (a.setze === undefined && a.loesche === undefined && a.verschiebe === undefined) ab('argument_ungueltig', 'keine Änderung angegeben');
    const setze = a.setze === undefined ? undefined : objekte(a, 'setze', ['quell_s', 'beat']).map((s): MarkerSetze => ({
      quell_s: zahl(s, 'quell_s', 0, 1e7)!, ...(s.beat === undefined ? {} : { beat: zahl(s, 'beat', -MAX_BEAT, MAX_BEAT)! }) }));
    const loesche = a.loesche === undefined ? undefined
      : listeArg(a, 'loesche').map((b) => (zahlOk(b) ? b : ab('argument_ungueltig', 'loesche: Beats (Zahlen) erwartet')));
    const verschiebe = a.verschiebe === undefined ? undefined : objekte(a, 'verschiebe', ['beat', 'neu_beat', 'neu_quell_s']).map((v): MarkerVerschiebe => ({
      beat: zahl(v, 'beat', -MAX_BEAT, MAX_BEAT)!, ...(v.neu_beat === undefined ? {} : { neu_beat: zahl(v, 'neu_beat', -MAX_BEAT, MAX_BEAT)! }),
      ...(v.neu_quell_s === undefined ? {} : { neu_quell_s: zahl(v, 'neu_quell_s', 0, 1e7)! }) }));
    const marker = mitWarp(() => markerAendern(clip.warp.marker, { setze, loesche: loesche as number[] | undefined, verschiebe }));
    clip.warp = gueltig(handWarp(clip.warp, marker));
  },
  // Slice 3b: Warp From Here. gerade: ab `beat` (Clip-Beat) ein Segment mit dem Tempo dort. start: ab `beat` der Auto-Warp neu; den löst der Server
  // aus dem Katalog (session.ts loeseQuellenAuf schreibt den Befehl in warp_setzen um), ohne Katalog bleibt nur diese Ablehnung. Die Länge bleibt.
  warp_ab_hier(p, a) {
    erlaube(a, 'clip_id', 'beat', 'art');
    const clip = warpClip(p, a);
    const beat = zahl(a, 'beat', -MAX_BEAT, MAX_BEAT)!;
    if (a.art !== 'gerade' && a.art !== 'start') ab('argument_ungueltig', 'art: gerade oder start erwartet');
    if (a.art === 'start') ab('argument_ungueltig', 'warp_ab_hier start braucht den Katalog des Servers (Tempo-Angaben der Library)');
    const marker = abHierGerade(clip.warp.marker, beat);
    if (marker !== null) clip.warp = gueltig(handWarp(clip.warp, marker));
  },
  // Slice 4: Quantize Audio. Die Transienten kennt nur der Server (session.ts loeseQuellenAuf schreibt den Befehl in warp_setzen mit Hand-Markern um);
  // hier bleibt die Ablehnung der Fälle, die er nicht umschreibt.
  audio_quantisieren(p, a) {
    erlaube(a, 'clip_id', 'raster', 'staerke', 'von_beat', 'bis_beat');
    warpClip(p, a);
    ab('argument_ungueltig', 'audio_quantisieren braucht den Server (er kennt die Transienten)');
  },
  // Slice 3b: Set 1.1.1 Here. Die Stelle quell_s der Quelle wird Beat 0; der Klang bleibt, der Clip beginnt (versatz_beats gleich) an der neuen Eins.
  // Seine Länge folgt, damit er dasselbe Ende der Quelle spielt: laenge − (alter Beat der Stelle).
  eins_hier(p, a) {
    erlaube(a, 'clip_id', 'quell_s');
    const clip = warpClip(p, a);
    const { warp, verschoben } = einsHier(clip.warp, zahl(a, 'quell_s', 0, 1e7)!);
    const laenge = runde9(clip.laenge_beats - verschoben);
    if (!(laenge > 0)) ab('beat_ausserhalb', `die neue Eins liegt ${verschoben} Beats hinter dem Anfang, der Clip hat ${clip.laenge_beats}`);
    if (laenge > MAX_BEAT) ab('argument_ungueltig', `laenge_beats: höchstens ${MAX_BEAT}`);
    if (clip.fade_ein_beats + clip.fade_aus_beats > laenge + 1e-9) ab('fade_zu_lang', `${clip.fade_ein_beats} + ${clip.fade_aus_beats} > ${laenge}`);
    clip.warp = gueltig(warp); clip.laenge_beats = laenge;
    if (clip.loop_beats != null && clip.loop_beats > laenge) clip.loop_beats = laenge;
  },
  // Slice 3b: tempo_vom_clip setzt das Projekttempo auf das Tempo des Clips (warp.ts fensterTempo). Den Befehl schreibt der Server in tempo_setzen um
  // (session.ts loeseQuellenAuf), damit die Sperren des Tempos (deck_laeuft, Aufnahme) greifen; hier bleibt die Ablehnung der Fälle, die er nicht umschreibt.
  tempo_vom_clip(p, a) {
    erlaube(a, 'clip_id');
    warpClip(p, a);
    ab('argument_ungueltig', 'tempo_vom_clip braucht den Server (er setzt das Projekttempo über tempo_setzen)');
  },
  clip_duplizieren(p, a) {
    erlaube(a, 'clip_id', 'ziel_beat');
    const { spur, clip } = clipVon(p, idArg(a, 'clip_id'));
    const ziel = zahl(a, 'ziel_beat', 0, MAX_BEAT, { opt: true }) ?? clip.start_beat + clip.laenge_beats;
    const kopie = { ...structuredClone(clip), id: neueId(p, 'clip'), start_beat: ziel };
    spur.clips.splice(spur.clips.indexOf(clip) + 1, 0, kopie);
  },

  clip_loeschen(p, a) {
    erlaube(a, 'clip_id');
    const { spur, clip } = clipVon(p, idArg(a, 'clip_id'));
    spur.clips.splice(spur.clips.indexOf(clip), 1);
  },

  noten_neu(p, a) {
    erlaube(a, 'clip_id', 'noten');
    const id = idArg(a, 'clip_id');
    const clip = midiVon(clipVon(p, id).clip, id);
    const roh = listeArg(a, 'noten');
    const neu = new Set<string>();
    for (const r of roh) if (istObjekt(r) && typeof r.id === 'string') { if (neu.has(r.id)) ab('id_belegt', r.id); neu.add(r.id); }
    fuegeNotenEin(p, clip, roh);
  },

  noten_aendern(p, a) {
    erlaube(a, 'clip_id', 'noten');
    const id = idArg(a, 'clip_id');
    const clip = midiVon(clipVon(p, id).clip, id);
    const roh = listeArg(a, 'noten');
    const nachId = new Map(clip.noten.map((n, k) => [n.id, k] as const));  // linear statt find je Note (S2-Integration Slice 1)
    const aenderungen = roh.map((r, i) => {
      if (!istObjekt(r)) return ab('argument_ungueltig', `noten[${i}]: Objekt erwartet`);
      erlaube(r as Args, 'id', 'beat', 'laenge', 'ton', 'vel');
      if (typeof r.id !== 'string') ab('argument_ungueltig', `noten[${i}].id: ID erwartet`);
      const f = notenFelder(r as Args, `noten[${i}]`, true);
      if (Object.keys(f).length === 0) ab('argument_ungueltig', `noten[${i}]: keine Änderung angegeben`);
      const k = nachId.get(r.id as string) ?? ab('noten_unbekannt', String(r.id));
      return { k, f };
    });
    // Spec 6.31 (Leistung): eine geänderte Note ist ein neues Objekt, die alte bleibt unberührt (der Notenweg teilt ungeänderte Noten mit dem Stand davor)
    for (const { k, f } of aenderungen) clip.noten[k] = { ...clip.noten[k], ...f };
  },

  noten_loeschen(p, a) {
    erlaube(a, 'clip_id', 'ids');
    const id = idArg(a, 'clip_id');
    const clip = midiVon(clipVon(p, id).clip, id);
    const ids = listeArg(a, 'ids');
    const da = new Set(clip.noten.map((x) => x.id)), weg = new Set<string>();   // linear statt some/includes je Note (S2-Integration Slice 1)
    for (const n of ids) { if (typeof n !== 'string' || !da.has(n)) ab('noten_unbekannt', String(n)); weg.add(n as string); }
    clip.noten = clip.noten.filter((n) => !weg.has(n.id));
  },

  // 1.10 Slice 1 (P4): Gruppen-Spuren. Die Namen vermeiden das Feld `gruppe` der Varianten (Paket 1.18, E-c).
  gruppenspur_neu(p, a) {
    erlaube(a, 'name', 'farbe', 'mitglieder');
    const gl = (p.gruppen ??= []);
    if (gl.length >= MAX_GRUPPEN) ab('routing_grenze', `all ${MAX_GRUPPEN} groups are used`);
    const nr = Array.from({ length: MAX_GRUPPEN }, (_, i) => i + 1).find((n) => !gl.some((g) => g.nr === n)) ?? ab('routing_grenze', 'no free group number');
    if (a.farbe !== undefined && (typeof a.farbe !== 'string' || !FARBE_OK.test(a.farbe))) ab('argument_ungueltig', 'farbe: #rrggbb erwartet');
    let mitglieder: Spur[] = [];
    if (a.mitglieder !== undefined) {
      if (!Array.isArray(a.mitglieder) || a.mitglieder.length < 1 || a.mitglieder.length > MAX_SPUREN) {
        ab('argument_ungueltig', 'mitglieder: nicht leere Liste von Spur-IDs erwartet');
      }
      const ids = new Set<string>();
      mitglieder = a.mitglieder.map((x: unknown) => {
        if (typeof x !== 'string' || ids.has(x)) return ab('argument_ungueltig', 'mitglieder: Spur-IDs ohne Doppelte erwartet');
        ids.add(x);
        return spurVon(p, x);
      });
    }
    const g: Gruppe = { id: neueId(p, 'gruppe'), nr, name: text(a, 'name', 80) ?? `Group ${nr}`, farbe: a.farbe ?? SPUR_FARBEN[(nr - 1) % SPUR_FARBEN.length],
      fader_db: 0, pan: 0, mute: false, solo: false, gefaltet: false };
    gl.push(g);
    for (const s of mitglieder) s.ausgang = { art: 'gruppe', id: g.id };
  },

  gruppenspur_aendern(p, a) {
    erlaube(a, 'gruppe_id', 'name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'gefaltet');
    const g = gruppeVon(p, idArg(a, 'gruppe_id'));
    if (GRUPPE_LEICHT.every((k) => a[k] === undefined)) ab('argument_ungueltig', 'keine Änderung angegeben');
    const name = text(a, 'name', 80);
    if (a.farbe !== undefined && (typeof a.farbe !== 'string' || !FARBE_OK.test(a.farbe))) ab('argument_ungueltig', 'farbe: #rrggbb erwartet');
    const fader = zahl(a, 'fader_db', FADER_MIN, FADER_MAX, { opt: true }), pan = zahl(a, 'pan', -1, 1, { opt: true });
    const mute = flagge(a, 'mute', true), solo = flagge(a, 'solo', true), gefaltet = flagge(a, 'gefaltet', true);
    if (name !== undefined) g.name = name;
    if (a.farbe !== undefined) g.farbe = a.farbe;
    if (fader !== undefined) g.fader_db = fader;
    if (pan !== undefined) g.pan = pan;
    if (mute !== undefined) g.mute = mute;
    if (solo !== undefined) g.solo = solo;
    if (gefaltet !== undefined) g.gefaltet = gefaltet;
  },

  gruppenspur_loeschen(p, a) {   // Mitglieder wechseln auf master (derselbe Schritt), nie verwaiste Ziele
    erlaube(a, 'gruppe_id');
    const gl = (p.gruppen ??= []);
    const g = gruppeVon(p, idArg(a, 'gruppe_id'));
    for (const s of p.spuren) if (s.ausgang?.id === g.id) delete s.ausgang;
    gl.splice(gl.indexOf(g), 1);
    // slice 5: a key on this group would dangle
    for (const x of alleInserts(p)) if (x.insert.key?.quelle === 'grp' && x.insert.key.nr === g.nr) delete x.insert.key;
  },

  // strang_id: eine Spur- oder Gruppen-ID. Spuren dürfen in eine Gruppe (Tiefe 1); eine Gruppe kann nur auf master zeigen:
  // in sich selbst ist routing_zyklus, in eine andere routing_grenze.
  ziel_setzen(p, a) {
    erlaube(a, 'strang_id', 'ausgang');
    const id = idArg(a, 'strang_id');
    const z = a.ausgang;
    let gid: string | null;
    if (z === 'master' || (istObjekt(z) && z.art === 'master')) gid = null;
    else if (istObjekt(z) && z.art === 'gruppe' && typeof z.id === 'string') gid = z.id;
    else return ab('argument_ungueltig', "ausgang: 'master' oder {art: 'gruppe', id} erwartet");
    if (gid !== null && !(p.gruppen ?? []).some((g) => g.id === gid)) ab('ziel_unbekannt', gid);
    const spur = sucheSpur(p, id);
    if (spur) {
      if (gid === null) delete spur.ausgang; else spur.ausgang = { art: 'gruppe', id: gid };
      return;
    }
    const grp = (p.gruppen ?? []).find((g) => g.id === id);
    if (!grp) return ab('spur_unbekannt', id);
    if (gid === null) return;
    return gid === grp.id ? ab('routing_zyklus', `group ${id} cannot feed itself`) : ab('routing_grenze', 'groups do not nest (depth 1)');
  },

  master_aendern(p, a) {
    erlaube(a, 'fader_db');
    (p.master ??= { fader_db: 0 }).fader_db = zahl(a, 'fader_db', FADER_MIN, FADER_MAX)!;
  },

  // 1.10 slice 3: returns (the Hall is a part of the return) and sends. A send is an entry {id: <return id>, db} of a track or group; -200 removes it.
  // arr-bk slice 4: `effekt` {graph, werte?} makes an EFFECT return: the Hall is off and the chain carries one bk stage with that effect graph
  // (the shipped standard case is the tempo-synchronous stereo delay fx-delay-sync). Without `effekt` the return keeps the Cypher Hall as before.
  // The send level into the return is send_setzen as always.
  return_neu(p, a, ctx) {
    erlaube(a, 'name', 'farbe', 'hall', 'effekt');
    if (a.effekt !== undefined && a.hall !== undefined) ab('argument_ungueltig', 'effekt and hall exclude each other: an effect return has no Hall');
    if (a.effekt !== undefined && !istObjekt(a.effekt)) ab('argument_ungueltig', 'effekt: object {graph, werte?} expected');
    const rl = p.returns ?? [];
    if (rl.length >= MAX_RETURNS) ab('routing_grenze', `all ${MAX_RETURNS} returns are used`);
    const nr = Array.from({ length: MAX_RETURNS }, (_, i) => i + 1).find((n) => !rl.some((r) => r.nr === n)) ?? ab('routing_grenze', 'no free return number');
    if (a.farbe !== undefined && (typeof a.farbe !== 'string' || !FARBE_OK.test(a.farbe))) ab('argument_ungueltig', 'farbe: #rrggbb erwartet');
    const name = text(a, 'name', 80);
    const hall = { ...HALL_VORGABE };
    hallArg(a.hall, hall);
    const r: Return = { id: neueId(p, 'return'), nr, name: name ?? `Return ${nr}`, farbe: a.farbe ?? SPUR_FARBEN[(nr + 3) % SPUR_FARBEN.length],
      fader_db: 0, pan: 0, mute: false, solo: false, hall };
    if (a.effekt !== undefined) r.hall.an = false;
    p.returns = [...rl, r].sort((x, y) => x.nr - y.nr);
    if (a.effekt !== undefined) {
      const e = a.effekt as Args;
      for (const k of Object.keys(e)) if (k !== 'graph' && k !== 'werte') ab('argument_unbekannt', `effekt.${k}`);
      const stufe: Args = { befehl: 'insert_setzen', strang_id: r.id, pos: 0, art: 'bk', graph: e.graph, ...(e.werte !== undefined ? { werte: e.werte } : {}) };
      PRO_BEFEHL.insert_setzen(p, stufe, ctx);
    }
  },

  return_aendern(p, a) {
    erlaube(a, 'return_id', 'name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'hall', 'pre');
    const r = returnVon(p, idArg(a, 'return_id'));
    const felderRet = ['name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'hall', 'pre'];
    if (felderRet.every((k) => a[k] === undefined)) ab('argument_ungueltig', 'keine Änderung angegeben');
    const name = text(a, 'name', 80);
    if (a.farbe !== undefined && (typeof a.farbe !== 'string' || !FARBE_OK.test(a.farbe))) ab('argument_ungueltig', 'farbe: #rrggbb erwartet');
    const fader = zahl(a, 'fader_db', FADER_MIN, FADER_MAX, { opt: true }), pan = zahl(a, 'pan', -1, 1, { opt: true });
    const mute = flagge(a, 'mute', true), solo = flagge(a, 'solo', true), pre = flagge(a, 'pre', true);
    const hall = { ...r.hall };
    hallArg(a.hall, hall);                                           // validates the whole object before anything is written
    if (name !== undefined) r.name = name;
    if (a.farbe !== undefined) r.farbe = a.farbe;
    if (fader !== undefined) r.fader_db = fader;
    if (pan !== undefined) r.pan = pan;
    if (mute !== undefined) r.mute = mute;
    if (solo !== undefined) r.solo = solo;
    if (pre === true) r.pre = true; else if (pre === false) delete r.pre;   // absent = post (slice 4)
    r.hall = hall;
  },

  return_loeschen(p, a) {   // every send to it goes in the same step, never an orphan; the stellwerk slots go back to the defaults (reglerAenderungen)
    erlaube(a, 'return_id');
    const r = returnVon(p, idArg(a, 'return_id'));
    for (const st of [...p.spuren, ...(p.gruppen ?? [])]) {
      if (!st.sends) continue;
      st.sends = st.sends.filter((x) => x.id !== r.id);
      if (st.sends.length === 0) delete st.sends;
    }
    p.returns = (p.returns ?? []).filter((x) => x.id !== r.id);
    if (p.returns.length === 0) delete p.returns;
    // slice 5: a key on this return would dangle
    for (const x of alleInserts(p)) if (x.insert.key?.quelle === 'ret' && x.insert.key.nr === r.nr) delete x.insert.key;
  },

  send_setzen(p, a) {
    erlaube(a, 'strang_id', 'return_id', 'db');
    const id = idArg(a, 'strang_id');
    const strang: Spur | Gruppe = sucheSpur(p, id) ?? (p.gruppen ?? []).find((g) => g.id === id) ?? ab('spur_unbekannt', id);
    const r = returnVon(p, idArg(a, 'return_id'));
    const db = zahl(a, 'db', FADER_MIN, FADER_MAX)!;
    const rest = (strang.sends ?? []).filter((x) => x.id !== r.id);
    if (db > FADER_MIN) rest.push({ id: r.id, db });
    const nr = (x: Send): number => (p.returns ?? []).find((y) => y.id === x.id)?.nr ?? 0;
    rest.sort((x, y) => nr(x) - nr(y));
    if (rest.length) strang.sends = rest; else delete strang.sends;
  },

  // 1.10 slice 4: the insert chain of a strip (track, group, return, 'master'). Stages carry a pooled slot (lowest free of the kind, project-wide).
  // Default `insert_setzen` INSERTS at `pos` (later stages move back; a chain of four refuses with kette_voll); `ersetzen: true` replaces the stage at `pos`.
  insert_setzen(p, a, ctx) {
    if (a.art === 'host') return hostSetzen(p, a, ctx);
    erlaube(a, 'strang_id', 'pos', 'art', 'werte', 'sc', 'key', 'ersetzen', 'preset', 'graph');
    const preset = presetArg(a.preset, 'preset');
    const art = a.art;
    if (typeof art !== 'string' || !(INSERT_ARTEN_AKTIV as readonly string[]).includes(art)) ab('art_unbekannt', String(art));
    const id = idArg(a, 'strang_id');
    const strang = sucheStrang(p, id) ?? ab('spur_unbekannt', id);
    const pos = zahl(a, 'pos', 0, MAX_INSERTS_PRO_STRANG - 1, { ganz: true })!;
    const ersetzen = flagge(a, 'ersetzen', true) ?? false;
    const pool = art as InsertPoolArt;
    const werte = insertVorgabe(pool);
    const wp = insertWertParameter(pool);
    if (a.werte !== undefined) {
      if (!istObjekt(a.werte)) ab('argument_ungueltig', 'werte: Objekt erwartet');
      for (const k of Object.keys(a.werte)) if (!wp.some((q) => q.name === k)) ab('argument_unbekannt', `werte.${k}`);
      for (const q of wp) {
        if (a.werte[q.name] !== undefined) werte[q.name] = insertZahl(pool, q, a.werte as Args, q.name);
      }
    }
    const graph = pool === 'bk' ? bkEffektGraph(a.graph, ctx) : undefined;
    if (pool !== 'bk' && a.graph !== undefined) ab('argument_unbekannt', `graph: only a bk stage has a graph (${art})`);
    if (pool !== 'komp' && a.sc !== undefined) ab('argument_unbekannt', `sc: only the compressor has a key (${art})`);
    if (pool !== 'komp' && a.key !== undefined) ab('argument_unbekannt', `key: only the compressor has a key (${art})`);
    if (a.sc !== undefined && a.key !== undefined && a.key !== null) ab('argument_ungueltig', 'sc and key exclude each other: a stage has one key at most');
    const liste = [...(strang.inserts ?? [])];
    if (ersetzen) {
      if (pos >= liste.length) ab('argument_ungueltig', `pos: no stage to replace at ${pos}`);
      liste.splice(pos, 1);
    } else {
      if (pos > liste.length) ab('argument_ungueltig', `pos: at most ${liste.length} (no gaps in the chain)`);
      if (liste.length >= MAX_INSERTS_PRO_STRANG) ab('kette_voll', `all ${MAX_INSERTS_PRO_STRANG} stages of ${id} are used`);
    }
    const belegt = new Set(alleInserts(p).filter((x) => x.insert.art === art && !(ersetzen && x.insert === strang.inserts![pos])).map((x) => x.insert.slot));
    const slot = Array.from({ length: MAX_INS[art] }, (_, i) => i + 1).find((n) => !belegt.has(n))
      ?? ab('ins_voll', `all ${MAX_INS[art]} ${art} stages are used`);
    const gestuft = ersetzen ? strang.inserts![pos] : undefined;   // a replaced stage does not count as an edge of the track order
    const def = schluesselDef(p, id, a.key, gestuft);
    const sc = def && 'sc' in def ? def.sc : schluesselArg(p, a.sc, id, gestuft);
    const insert: Insert = { id: neueId(p, 'insert'), art: art as Insert['art'], slot, an: true, werte, ...(sc > 0 ? { sc } : {}),
      ...(def && 'key' in def ? { key: def.key } : {}), ...(graph !== undefined ? { graph } : {}), ...(preset !== undefined ? { preset } : {}) };
    liste.splice(pos, 0, insert);
    strang.inserts = liste;
    rackBereinigen(strang);   // a replaced stage takes its mappings with it
  },

  insert_param_setzen(p, a) {
    erlaube(a, 'insert_id', 'param', 'wert');
    const { strang, insert } = insertVon(p, idArg(a, 'insert_id'));
    const param = a.param;
    if (param === 'sc') {
      if (insert.art !== 'komp') ab('argument_unbekannt', `param: sc (only the compressor has a key; ${insert.art})`);
      if (a.wert === undefined) ab('argument_ungueltig', 'wert: fehlt');
      const sc = schluesselArg(p, a.wert, strangKennung(p, strang), insert);
      if (sc > 0) insert.sc = sc; else delete insert.sc;
      delete insert.key;   // slice 5 (E8): a stage has one key at most; the row key replaces a structural one (a structure change, see istLeicht)
      return;
    }
    if (param === 'key') {   // slice 5: every other source; null removes the structural key
      if (insert.art !== 'komp') ab('argument_unbekannt', `param: key (only the compressor has a key; ${insert.art})`);
      if (a.wert === undefined) ab('argument_ungueltig', 'wert: fehlt');
      const def = schluesselDef(p, strangKennung(p, strang), a.wert, insert);
      if (def === null) delete insert.key;
      else if ('sc' in def) { if (def.sc > 0) insert.sc = def.sc; else delete insert.sc; delete insert.key; }
      else { insert.key = def.key; delete insert.sc; }
      return;
    }
    const q = typeof param === 'string' ? insertWertParameter(insert.art as InsertPoolArt).find((x) => x.name === param) : undefined;
    if (!q) return ab('argument_unbekannt', `param: ${String(param)}`);
    const gemappt = makroVon(strang, insert.id, q.name);   // slice 4c (spec D13, Q4): one writer per parameter
    if (gemappt) {
      const wo = `macro ${gemappt.nr} of the rack of ${strangKennung(p, strang)}`;
      ab('param_gemappt', `${insert.id}.${q.name} is driven by ${wo}; remove the mapping first (rack_setzen)`);
    }
    insert.werte[q.name] = insertZahl(insert.art as InsertPoolArt, q, a, 'wert');
  },

  // plan 1.11 T7 (D4): the user's addition to the latency of a host stage, 0..MAX_LATENZ_EXTRA samples (0 = the field is absent)
  insert_latenz_extra(p, a) {
    erlaube(a, 'insert_id', 'samples');
    const { insert } = insertVon(p, idArg(a, 'insert_id'));
    if (insert.art !== 'host') ab('argument_ungueltig', `insert_id: ${insert.id} is not a host stage (${insert.art})`);
    const n = zahl(a, 'samples', 0, MAX_LATENZ_EXTRA, { ganz: true })!;
    if (n === 0) delete insert.latenz_extra; else insert.latenz_extra = n;
  },

  insert_an(p, a) {
    erlaube(a, 'insert_id', 'an');
    const { insert } = insertVon(p, idArg(a, 'insert_id'));
    insert.an = flagge(a, 'an')!;
  },

  // 1.10 slice 5 (plan E12): "Duck by Kick" in one gesture. A `komp` stage on `spur_id` with the values of the Kick Sidechain preset
  // (DUCK_DURCH_KICK_WERTE) keyed by the
  // input of the kick track (`sc` = its number, the track `pre` key of E8 a). `pos` defaults to the end of the chain. One command, so one undo step.
  duck_durch_kick(p, a, ctx) {
    erlaube(a, 'spur_id', 'kick_id', 'pos');
    const spur = spurVon(p, idArg(a, 'spur_id'));
    const kick = spurVon(p, idArg(a, 'kick_id'));
    if (kick === spur) ab('argument_ungueltig', 'kick_id: the kick track must be another track than spur_id');
    const laenge = spur.inserts?.length ?? 0;
    if (a.pos === undefined && laenge >= MAX_INSERTS_PRO_STRANG) ab('kette_voll', `all ${MAX_INSERTS_PRO_STRANG} stages of ${spur.id} are used`);
    PRO_BEFEHL.insert_setzen(p, { befehl: 'insert_setzen', strang_id: spur.id, pos: a.pos ?? laenge, art: 'komp',
      werte: { ...DUCK_DURCH_KICK_WERTE }, sc: kick.nr }, ctx);
  },

  insert_entfernen(p, a) {
    erlaube(a, 'insert_id');
    const { strang, insert } = insertVon(p, idArg(a, 'insert_id'));
    const rest = (strang.inserts ?? []).filter((x) => x !== insert);
    if (rest.length) strang.inserts = rest; else delete strang.inserts;   // the slot goes back to the pool; the rows reset through reglerAenderungen
    rackBereinigen(strang);
  },

  insert_ordnung(p, a) {
    erlaube(a, 'strang_id', 'reihenfolge');
    const id = idArg(a, 'strang_id');
    const strang = sucheStrang(p, id) ?? ab('spur_unbekannt', id);
    const jetzt = strang.inserts ?? [];
    const r = a.reihenfolge;
    if (!Array.isArray(r) || r.length !== jetzt.length || new Set(r).size !== r.length || !r.every((x) => jetzt.some((i) => i.id === x))) {
      ab('argument_ungueltig', `reihenfolge: a permutation of the ${jetzt.length} stage IDs of ${id} expected`);
    }
    if (jetzt.length) strang.inserts = r.map((x) => jetzt.find((i) => i.id === x)!);
  },

  // 1.10 slice 4c (spec D13): the rack of a strip. `makros` = up to four entries `{name?, ziel: [{insert, param, von, bis}]}` (macro 1..4 in
  // order); the whole mapping is replaced.
  // `insert` is a stage of the strip's own chain, `param` a continuous parameter of its kind (not `an`, not `sc`), `von`/`bis` in its real range
  // (macro 0 gives von, macro 1 gives bis).
  // A parameter has one macro at most (ziel_doppelt), at most MAX_MAKRO_ZIELE mappings per strip (makro_voll), MAX_RACK racks in the project
  // (rack_voll). No mapping at all removes the rack.
  // The live macro values stay with the rack (new rack: 0). Structure change = new playback.
  rack_setzen(p, a) {
    erlaube(a, 'strang_id', 'makros');
    const id = idArg(a, 'strang_id');
    const strang = sucheStrang(p, id) ?? ab('spur_unbekannt', id);
    const roh = a.makros;
    if (!Array.isArray(roh) || roh.length > MAX_MAKROS) ab('argument_ungueltig', `makros: Liste mit höchstens ${MAX_MAKROS} Einträgen erwartet`);
    const kette = strang.inserts ?? [];
    const namen: string[] = [], makros: { ziel: RackZiel[] }[] = [];
    const gesehen = new Set<string>();
    for (let i = 0; i < MAX_MAKROS; i++) {
      const m: unknown = i < (roh as unknown[]).length ? (roh as unknown[])[i] : {};   // only a missing entry is an empty macro; null is refused
      if (!istObjekt(m)) ab('argument_ungueltig', `makros[${i}]: Objekt erwartet`);
      for (const k of Object.keys(m)) if (k !== 'name' && k !== 'ziel') ab('argument_unbekannt', `makros[${i}].${k}`);
      const name = m.name === undefined ? '' : m.name;
      if (typeof name !== 'string' || name.length > MAKRO_NAME_MAX) {
        ab('argument_ungueltig', `makros[${i}].name: Text mit höchstens ${MAKRO_NAME_MAX} Zeichen erwartet`);
      }
      namen.push(name);
      const roh_z = m.ziel === undefined ? [] : m.ziel;
      if (!Array.isArray(roh_z)) ab('argument_ungueltig', `makros[${i}].ziel: Liste erwartet`);
      const ziel: RackZiel[] = [];
      (roh_z as unknown[]).forEach((zx, k) => {
        const wo = `makros[${i}].ziel[${k}]`;
        if (!istObjekt(zx)) ab('argument_ungueltig', `${wo}: Objekt erwartet`);
        if ('glied' in zx) {   // 1.9 U8 T7 (E12): a target on a member of the rack device of this track
          for (const key of Object.keys(zx)) if (!['glied', 'param', 'von', 'bis'].includes(key)) ab('argument_unbekannt', `${wo}.${key}`);
          const spur = sucheSpur(p, id);
          if (!spur || spur.art !== 'instrument' || spur.geraet?.art !== 'rack') ab('glied_ohne_rack', `${wo}.glied: ${id} is not a rack track`);
          const gid = zx.glied;
          if (typeof gid !== 'string') ab('argument_ungueltig', `${wo}.glied: member id expected`);
          const m = (spur!.geraet as RackGeraet).glieder.find((x) => x.id === gid) ?? ab('glied_unbekannt', `${String(gid)} is no member of ${id}`);
          if (m.geraet.art === 'wirt') ab('makro_ziel_wirt', `${wo}.glied: ${m.id} is a Surge member; a macro cannot drive it`);
          const pn = zx.param;
          const q = typeof pn === 'string' ? gliedMakroParam(m.geraet, pn) : undefined;
          if (!q) ab('argument_unbekannt', `${wo}.param: ${String(pn)} (member ${m.id})`);
          const von = zahl(zx as Args, 'von', q!.min, q!.max)!, bis = zahl(zx as Args, 'bis', q!.min, q!.max)!;
          const gkey = `${m.id}/${pn as string}`;
          if (gesehen.has(gkey)) ab('ziel_doppelt', `${gkey}: one parameter has one macro`);
          gesehen.add(gkey);
          ziel.push({ glied: m.id, param: pn as string, von, bis });
          return;
        }
        for (const key of Object.keys(zx)) if (!['insert', 'param', 'von', 'bis'].includes(key)) ab('argument_unbekannt', `${wo}.${key}`);
        const iid = zx.insert;
        if (typeof iid !== 'string') ab('argument_ungueltig', `${wo}.insert: ID erwartet`);
        const st = kette.find((x) => x.id === iid) ?? ab('insert_unbekannt', `${String(iid)} is no stage of the chain of ${id}`);
        const art = st.art as InsertPoolArt;
        const pn = zx.param;
        if (typeof pn !== 'string' || !insertWertParameter(art).some((x) => x.name === pn)) ab('argument_unbekannt', `${wo}.param: ${String(pn)}`);
        if (!makroFaehig(art, pn as string)) {
          ab('param_nicht_stetig', `${wo}.param: ${String(pn)} is a switch or a step list; a macro drives continuous parameters`);
        }
        const q = insertWertParameter(art).find((x) => x.name === pn)!;
        if ((strang.automation ?? []).some((l) => l.ziel === `insert.${st.id}.${q.name}`)) {   // one writer per parameter (spec D13): a lane already drives it
          ab('param_hat_lane', `${st.id}.${q.name} has a lane; delete the lane first (auto_loeschen) or automate the macro instead`);
        }
        const von = zahl(zx as Args, 'von', q.min, q.max)!, bis = zahl(zx as Args, 'bis', q.min, q.max)!;
        const key = `${st.id}/${pn}`;
        if (gesehen.has(key)) ab('ziel_doppelt', `${st.id}.${pn as string}: one parameter has one macro`);
        gesehen.add(key);
        ziel.push({ insert: st.id, param: pn as string, von, bis });
      });
      makros.push({ ziel });
    }
    const n = makros.reduce((x, m) => x + m.ziel.length, 0);
    if (n > MAX_MAKRO_ZIELE) ab('makro_voll', `${n} mappings; at most ${MAX_MAKRO_ZIELE} per strip`);
    if (n === 0) { delete strang.rack; kettenLanenBereinigen(strang); return; }
    const belegt = new Set(alleRacks(p).filter((x) => x.strang !== strang).map((x) => x.rack.slot));
    const freierSlot = Array.from({ length: MAX_RACK }, (_, i) => i + 1).find((x) => !belegt.has(x));
    const slot = strang.rack?.slot ?? freierSlot ?? ab('rack_voll', `all ${MAX_RACK} racks are used`);
    const variationen = strang.rack?.variationen;   // 1.9 T10: a new mapping keeps the stored variations
    strang.rack = { slot, namen, makros, werte: strang.rack ? [...strang.rack.werte] : [0, 0, 0, 0], ...(variationen ? { variationen } : {}) };
    kettenLanenBereinigen(strang);
  },

  // The live value of macro `nr` (1..4) of the rack of a strip, 0..1. Control change only (light command): no new playback.
  rack_makro(p, a) {
    erlaube(a, 'strang_id', 'nr', 'wert');
    const id = idArg(a, 'strang_id');
    const strang = sucheStrang(p, id) ?? ab('spur_unbekannt', id);
    const nr = zahl(a, 'nr', 1, MAX_MAKROS, { ganz: true })!;
    const wert = zahl(a, 'wert', 0, 1)!;
    if (!strang.rack) ab('rack_unbekannt', `${id} has no rack`);
    strang.rack!.werte[nr - 1] = wert;
  },

  // 1.9 T10 (E13): named snapshots of the 4 live macro values of a strip's rack (pure project data, no playback). Save stores the current values
  // (an existing name is replaced in place; a ninth distinct name is variation_voll), load sets the values (a control change like rack_makro),
  // delete removes one (the last one drops the field).
  makro_variation_speichern(p, a) {
    const { rack, name } = variationArgs(p, a);
    const liste = rack.variationen ?? [];
    const k = liste.findIndex((v) => v.name === name);
    if (k < 0 && liste.length >= MAX_VARIATIONEN) ab('variation_voll', `a rack holds at most ${MAX_VARIATIONEN} variations`);
    const neu = { name, werte: [...rack.werte] };
    rack.variationen = k < 0 ? [...liste, neu] : liste.map((v, i) => (i === k ? neu : v));
  },
  makro_variation_laden(p, a) {
    const { rack, name } = variationArgs(p, a);
    const v = (rack.variationen ?? []).find((x) => x.name === name) ?? ab('variation_unbekannt', `${name}: no such variation`);
    rack.werte = [...v.werte];
  },
  makro_variation_loeschen(p, a) {
    const { rack, name } = variationArgs(p, a);
    const liste = rack.variationen ?? [];
    if (!liste.some((x) => x.name === name)) ab('variation_unbekannt', `${name}: no such variation`);
    const rest = liste.filter((x) => x.name !== name);
    if (rest.length) rack.variationen = rest; else delete rack.variationen;
  },

  // 1.16 rest (F1, F8): several values of one stage in one command (one undo step, used by an applied preset), plus its preset origin
  // (`preset` id sets it, null clears it). Names, ranges and steps are those of the stage's kind as insert_setzen has them (compressor, EQ, saturator);
  // `an` and the key `sc` are never touched. A value that a rack macro drives is refused like insert_param_setzen does (param_gemappt). Controls only.
  insert_werte_setzen(p, a) {
    erlaube(a, 'insert_id', 'werte', 'preset');
    const { strang, insert } = insertVon(p, idArg(a, 'insert_id'));
    if (!istObjekt(a.werte)) ab('argument_ungueltig', 'werte: Objekt erwartet');
    const werte = a.werte as Args;
    const wp = insertWertParameter(insert.art as InsertPoolArt);
    for (const k of Object.keys(werte)) if (!wp.some((q) => q.name === k)) ab('argument_unbekannt', `werte.${k}`);
    const preset = a.preset === null ? null : presetArg(a.preset, 'preset');
    if (Object.keys(werte).length === 0 && preset === undefined) ab('argument_ungueltig', 'werte: at least one value, or a preset');
    const neu: Record<string, number> = {};
    for (const q of wp) {
      if (werte[q.name] === undefined) continue;
      const gemappt = makroVon(strang, insert.id, q.name);   // slice 4c (spec D13, Q4): one writer per parameter
      if (gemappt) {
        ab('param_gemappt',
          `${insert.id}.${q.name} is driven by macro ${gemappt.nr} of the rack of ${strangKennung(p, strang)}; remove the mapping first (rack_setzen)`);
      }
      neu[q.name] = insertZahl(insert.art as InsertPoolArt, q, werte, q.name);
    }
    Object.assign(insert.werte, neu);
    if (preset === null) delete insert.preset; else if (preset !== undefined) insert.preset = preset;
  },

  tempo_setzen(p, a) {
    erlaube(a, 'bpm');
    if (!zahlOk(a.bpm)) ab('argument_ungueltig', 'bpm: Zahl erwartet');
    if (a.bpm < TEMPO_MIN || a.bpm > TEMPO_MAX) ab('tempo_bereich', `${a.bpm} (${TEMPO_MIN}..${TEMPO_MAX})`);
    p.tempo_bpm = a.bpm;
  },

  loop_setzen(p, a) {
    erlaube(a, 'an', 'von_beat', 'bis_beat');
    const an = flagge(a, 'an')!, von = zahl(a, 'von_beat', 0, MAX_BEAT)!, bis = zahl(a, 'bis_beat', 0, MAX_BEAT)!;
    if (bis - von < 1) ab('loop_bereich', `bis_beat − von_beat muss mindestens 1 sein (${von}..${bis})`);
    p.loop = { an, von_beat: von, bis_beat: bis };
  },

  // 1.8 S0 (D17): count-in, punch range and overdub. The key is created by the first command; unset fields take AUFNAHME_VORGABE. Not a mixer command
  // (nested, off the fast path) and not a playback command (wiedergabeSicht does not know it).
  aufnahme_setzen(p, a) {
    erlaube(a, 'vorzaehler_takte', 'punch', 'overdub');
    if (['vorzaehler_takte', 'punch', 'overdub'].every((k) => a[k] === undefined)) ab('argument_ungueltig', 'keine Änderung angegeben');
    const neu = structuredClone(p.aufnahme ?? AUFNAHME_VORGABE) as ProjektAufnahme;
    if (a.vorzaehler_takte !== undefined) {
      if (!(VORZAEHLER_WERTE as readonly unknown[]).includes(a.vorzaehler_takte)) ab('argument_ungueltig', 'vorzaehler_takte: 0, 1, 2 or 4 expected');
      neu.vorzaehler_takte = a.vorzaehler_takte as ProjektAufnahme['vorzaehler_takte'];
    }
    if (a.punch !== undefined) {
      if (!istObjekt(a.punch)) ab('argument_ungueltig', 'punch: object expected');
      const pu = a.punch as Args;
      erlaube(pu, 'ein', 'aus', 'von_beat', 'bis_beat');
      if (['ein', 'aus', 'von_beat', 'bis_beat'].every((k) => pu[k] === undefined)) ab('argument_ungueltig', 'punch: no field given');
      const ein = flagge(pu, 'ein', true), aus = flagge(pu, 'aus', true);
      const von = zahl(pu, 'von_beat', 0, MAX_BEAT, { opt: true }), bis = zahl(pu, 'bis_beat', 0, MAX_BEAT, { opt: true });
      if (ein !== undefined) neu.punch.ein = ein;
      if (aus !== undefined) neu.punch.aus = aus;
      if (von !== undefined) neu.punch.von_beat = von;
      if (bis !== undefined) neu.punch.bis_beat = bis;
      if (neu.punch.bis_beat <= neu.punch.von_beat) {
        ab('argument_ungueltig', `punch: bis_beat must be greater than von_beat (${neu.punch.von_beat}..${neu.punch.bis_beat})`);
      }
    }
    const overdub = flagge(a, 'overdub', true);
    if (overdub !== undefined) neu.overdub = overdub;
    p.aufnahme = neu;
  },

  metronom_setzen(p, a) {
    erlaube(a, 'an', 'pegel_db', 'ziel');
    if (['an', 'pegel_db', 'ziel'].every((k) => a[k] === undefined)) ab('argument_ungueltig', 'keine Änderung angegeben');
    const an = flagge(a, 'an', true), pegel = zahl(a, 'pegel_db', -60, 0, { opt: true });
    if (a.ziel !== undefined && a.ziel !== 'master' && a.ziel !== 'cue') ab('argument_ungueltig', 'ziel: master oder cue erwartet');
    if (an !== undefined) p.metronom.an = an;
    if (pegel !== undefined) p.metronom.pegel_db = pegel;
    if (a.ziel !== undefined) p.metronom.ziel = a.ziel;
  },

  // --- Automation Slice 1 (ADR 032, D8): Lanes sind Projektdaten; jeder Befehl ist ein Undo-Schritt (Patch über `unterschied`) ---
  auto_neu(p, a) {
    erlaube(a, 'spur_id', 'strang_id', 'ziel', 'punkte');
    // 1.12 slice 6: a chain lane (`insert.<id>.<param>`, `rack.m1..m4`) lives on the strip that carries the stage or rack: a track by `spur_id`, or any
    // strip (track, group, return, 'master') by `strang_id`; a device lane (fader, pan, ...) is always a track's
    if (a.spur_id !== undefined && a.strang_id !== undefined) ab('argument_ungueltig', 'spur_id and strang_id: give one of them');
    const strang: InsertTraeger = a.strang_id !== undefined
      ? (sucheStrang(p, idArg(a, 'strang_id')) ?? ab('spur_unbekannt', String(a.strang_id)))
      : spurVon(p, idArg(a, 'spur_id'));
    const kennung = strangKennung(p, strang);
    if (a.ziel === undefined) ab('argument_ungueltig', 'ziel: fehlt');
    const kettig = istKettenZiel(a.ziel);
    if (!kettig && !(AUTO_ZIELE as readonly unknown[]).includes(a.ziel)) {
      ab('ziel_unbekannt', `${String(a.ziel)} (${AUTO_ZIELE.join(' | ')} | insert.<stage id>.<param> | rack.m1..m4)`);
    }
    const s = strang as Spur;
    if (!kettig && (strang === p.master || sucheSpur(p, kennung) !== strang)) {
      ab('ziel_unbekannt', `${String(a.ziel)} (a device lane belongs to a track; ${kennung} is not one)`);
    }
    if (!kettig && istGeraetZiel(a.ziel as string) && !(s.art === 'instrument' && passtGeraetZiel(a.ziel as string, s.geraet))) {
      ab('ziel_unbekannt', `${String(a.ziel)} (only on a track whose device has that parameter: RB-338 lautstaerke, cutoff, resonanz, env_mod; bk k1 to k64)`);
    }
    if (kettig) {
      const k = zerlegeKettenZiel(a.ziel as string)!;
      if ('makro' in k) {
        if (!strang.rack) ab('rack_unbekannt', `${kennung} has no rack (${String(a.ziel)})`);
      } else {
        const st = (strang.inserts ?? []).find((x) => x.id === k.insert) ?? ab('insert_unbekannt', `${k.insert} is no stage of the chain of ${kennung}`);
        if (st.art === 'host') ab('ziel_unbekannt', `${String(a.ziel)} (a host stage keeps its own parameters)`);
        if (!insertWertParameter(st.art as InsertPoolArt).some((x) => x.name === k.param)) {
          ab('argument_unbekannt', `${String(a.ziel)}: no parameter ${k.param} on a ${st.art} stage`);
        }
        if (!makroFaehig(st.art as InsertPoolArt, k.param)) {
          ab('param_nicht_stetig', `${String(a.ziel)}: a lane drives continuous parameters, not a switch or a step list`);
        }
        const gemappt = makroVon(strang, st.id, k.param);   // one writer per parameter (spec D13)
        if (gemappt) {
          ab('param_gemappt', `${st.id}.${k.param} is driven by macro ${gemappt.nr} of the rack of ${kennung}; `
            + `remove the mapping first (rack_setzen) or automate the macro (rack.m${gemappt.nr})`);
        }
      }
      if (!kettenZielBereich(strang, a.ziel as string)) ab('ziel_unbekannt', String(a.ziel));
    }
    if ((strang.automation ?? []).some((l) => l.ziel === a.ziel)) ab('lane_doppelt', `${kennung} ${a.ziel}`);
    if ((strang.automation ?? []).length >= MAX_LANES_PRO_SPUR) ab('zu_gross', `at most ${MAX_LANES_PRO_SPUR} lanes per strip`);
    if (kettig && alleStraenge(p).reduce((n, x) => n + (x.strang.automation ?? []).filter((l) => istKettenZiel(l.ziel)).length, 0) >= MAX_KETTEN_LANEN) {
      ab('zu_gross', `at most ${MAX_KETTEN_LANEN} insert and rack lanes in the project`);
    }
    // eine Lane mit leerer Punktliste ist verboten: zwei Punkte an der Loop-Klammer mit dem Grundwert der Spur
    // slice 3 (D16): optional `punkte` bring the lane and its points in one command (a recorded take), checked like any lane
    const ziel = a.ziel as string, wert = laneStart(strang, ziel);
    let start: Punkt[] = [{ beat: p.loop.von_beat, wert }, { beat: p.loop.bis_beat, wert }];
    if (a.punkte !== undefined) {
      const f = punktePruefung(a.punkte, ziel, zielBereichVon(ziel, strang)!);
      if (f) ab(f.grund, f.text);
      start = (a.punkte as Punkt[]).map((q) => ({ ...q }));
    }
    const lane: Lane = { id: neueId(p, 'lane'), ziel: ziel as Lane['ziel'], punkte: start };
    normalisiereLane(lane);
    strang.automation = [...(strang.automation ?? []), lane];
  },

  auto_punkte(p, a) {
    erlaube(a, 'lane_id', 'setze', 'loesche_von', 'loesche_bis');
    const { spur: traeger, lane } = laneVon(p, idArg(a, 'lane_id'));
    const bereich = laneBereichVon(traeger, lane);
    const von = zahl(a, 'loesche_von', -Infinity, Infinity, { opt: true }), bis = zahl(a, 'loesche_bis', -Infinity, Infinity, { opt: true });
    if (a.setze !== undefined && !Array.isArray(a.setze)) ab('argument_ungueltig', 'setze: Liste erwartet');
    const setze = (a.setze ?? []) as unknown[];
    if (setze.length === 0 && von === undefined && bis === undefined) {
      ab('argument_ungueltig', 'keine Änderung angegeben (setze, loesche_von oder loesche_bis)');
    }
    const neu: Punkt[] = setze.map((x, i) => {
      if (!istObjekt(x)) return ab('argument_ungueltig', `setze[${i}]: Objekt erwartet`);
      erlaube(x as Args, 'beat', 'wert', 'form');
      return { ...(x as unknown as Punkt) };
    });
    for (const [i, q] of neu.entries()) {          // Wert und Beat des einzelnen Punkts: dieselbe Prüfung wie im Modell
      const f = punktePruefung([q], lane.ziel, bereich);
      if (f) ab(f.grund, f.text.replace(/^punkte\[0\]/, `setze[${i}]`));
    }
    // erst löschen (beide Enden inklusiv, fehlt eines, ist die Seite offen), dann setzen: ein gesetzter Punkt ersetzt alle Punkte an seinem Beat
    const imBereich = (q: Punkt): boolean => (von !== undefined || bis !== undefined)
      && (von === undefined || q.beat >= von) && (bis === undefined || q.beat <= bis);
    const bleibt = lane.punkte.filter((q) => !imBereich(q) && !neu.some((n) => n.beat === q.beat));
    const alle = [...bleibt, ...neu].map((q, i) => ({ q, i })).sort((x, y) => x.q.beat - y.q.beat || x.i - y.i).map((x) => x.q);
    const f = punktePruefung(alle, lane.ziel, bereich);
    if (f) ab(f.grund, f.text);
    lane.punkte = alle;
    normalisiereLane(lane);
  },

  // slice 2 (E4): the lock; `gesperrt: false` deletes the key (an unlocked lane never carries it), one undo step
  auto_aendern(p, a) {
    erlaube(a, 'lane_id', 'gesperrt');
    const lane = laneVon(p, idArg(a, 'lane_id'), true).lane;
    if (typeof a.gesperrt !== 'boolean') ab('argument_ungueltig', 'gesperrt: true or false expected');
    if (a.gesperrt) lane.gesperrt = true; else delete lane.gesperrt;
  },

  auto_loeschen(p, a) {
    erlaube(a, 'lane_id');
    const { spur, lane } = laneVon(p, idArg(a, 'lane_id'));
    const rest = (spur.automation ?? []).filter((l) => l !== lane);
    if (rest.length > 0) spur.automation = rest; else delete spur.automation;     // eine leere Liste steht nie in der Datei
  },

  // --- 1.12 slice 4 (D3 to D6): the editor tools; each goes through laneVon (lock) and ends with the lane check (laneSchreibe) ---
  auto_vereinfachen(p, a) {
    erlaube(a, 'lane_id', 'von_beat', 'bis_beat', 'toleranz');
    const { spur: traeger, lane } = laneVon(p, idArg(a, 'lane_id'));
    const [von, bis] = laneBereich(a);
    const tol = zahl(a, 'toleranz', 0, 1000, { opt: true });
    const br = laneBereichVon(traeger, lane);
    // a chain lane's default tolerance is 0.4 % of the parameter's range (the rule of pan and the device lanes, D15)
    const toleranz = tol ?? (istKettenZiel(lane.ziel) ? 0.004 * (br.max - br.min) : undefined);
    laneSchreibe(traeger, lane, bereichVereinfacht(lane.punkte, von, bis, lane.ziel, toleranz));
  },

  auto_dehnen(p, a) {
    erlaube(a, 'lane_id', 'von_beat', 'bis_beat', 'neu_bis_beat');
    const { spur: traeger, lane } = laneVon(p, idArg(a, 'lane_id'));
    const [von, bis] = laneBereich(a);
    const neuBis = zahl(a, 'neu_bis_beat', -Infinity, Infinity)!;
    if (!(neuBis > von && neuBis <= MAX_BEAT)) ab('bereich_leer', `neu_bis_beat ${neuBis} must lie after von_beat ${von} and at most at ${MAX_BEAT}`);
    laneSchreibe(traeger, lane, dehne(lane.punkte, von, bis, neuBis, lane.ziel));
  },

  auto_neigen(p, a) {
    erlaube(a, 'lane_id', 'von_beat', 'bis_beat', 'faktor');
    const { spur: traeger, lane } = laneVon(p, idArg(a, 'lane_id'));
    const [von, bis] = laneBereich(a);
    laneSchreibe(traeger, lane, neige(lane.punkte, von, bis, zahl(a, 'faktor', -1, 1)!, lane.ziel));
  },

  auto_form(p, a) {
    erlaube(a, 'lane_id', 'von_beat', 'bis_beat', 'form', 'perioden', 'unten', 'oben');
    const { spur: traeger, lane } = laneVon(p, idArg(a, 'lane_id'));
    const [von, bis] = laneBereich(a);
    if (a.form === undefined) ab('argument_ungueltig', 'form: missing');
    if (!(FORMEN_EINFUEGEN as readonly unknown[]).includes(a.form)) ab('form_ungueltig', `${String(a.form)} (${FORMEN_EINFUEGEN.join(' | ')})`);
    const { min, max, nurSprung } = laneBereichVon(traeger, lane);
    if (nurSprung && a.form !== 'rechteck') ab('form_ungueltig', `${lane.ziel} lanes take rechteck only`);
    const vorgabe = istKettenZiel(lane.ziel) ? { unten: min, oben: max } : formBereich(lane.ziel);   // a chain lane's shape spans the parameter's own range
    const perioden = zahl(a, 'perioden', 1, 64, { opt: true, ganz: true }) ?? 1;
    const unten = zahl(a, 'unten', min, max, { opt: true }) ?? vorgabe.unten, oben = zahl(a, 'oben', min, max, { opt: true }) ?? vorgabe.oben;
    if (unten > oben) ab('argument_ungueltig', `unten ${unten} must not lie above oben ${oben}`);
    laneSchreibe(traeger, lane, setzeForm(lane.punkte, von, bis, formPunkte(a.form as FormEinfuegen, von, bis, perioden, unten, oben), lane.ziel));
  },

  // --- 1.12 slice 5 (D7): clip envelopes; one per target and clip, replaced as a whole ---
  huellkurve_setzen(p, a) {
    erlaube(a, 'clip_id', 'ziel', 'punkte', 'verknuepft', 'loop_beats');
    const { spur, clip } = clipVon(p, idArg(a, 'clip_id'));
    if (a.verknuepft !== undefined && typeof a.verknuepft !== 'boolean') ab('argument_ungueltig', 'verknuepft: true or false expected');
    const hk = { ziel: a.ziel, ...(a.verknuepft === false ? { verknuepft: false } : {}), ...(a.loop_beats !== undefined ? { loop_beats: a.loop_beats } : {}),
      punkte: Array.isArray(a.punkte) ? (a.punkte as unknown[]).map((q) => (istObjekt(q) ? { ...q } : q)) : a.punkte };
    const f = huellkurvePruefung(hk, clip, spur);
    if (f) ab(f.grund, f.text);
    const liste = (clip.huellkurven ?? []).filter((h) => h.ziel !== a.ziel);
    clip.huellkurven = [...liste, hk as Huellkurve];
  },

  huellkurve_loeschen(p, a) {
    erlaube(a, 'clip_id', 'ziel');
    const { clip } = clipVon(p, idArg(a, 'clip_id'));
    if (!(clip.huellkurven ?? []).some((h) => h.ziel === a.ziel)) ab('huellkurve_unbekannt', `${clip.id} ${String(a.ziel)}`);
    const rest = (clip.huellkurven ?? []).filter((h) => h.ziel !== a.ziel);
    if (rest.length) clip.huellkurven = rest; else delete clip.huellkurven;       // an empty list is never written
  },

  // 1.9 U4 (O28, E6): description to sound. A word of the device's direction table (project/direction.ts) moves the parameters of the track's
  // device by bounded steps (0.12 x staerke). One command is one undo step; the label is the caller's (`<word> <track name>` by convention).
  geraet_richtung(p, a, ctx) {
    erlaube(a, 'spur_id', 'wort', 'staerke');
    const s = spurVon(p, idArg(a, 'spur_id'));
    if (typeof a.wort !== 'string' || a.wort === '') ab('argument_ungueltig', 'wort: a direction word is expected');
    const rb = s.art === 'instrument' && istRbGeraet(s.geraet);
    const surge = s.art === 'instrument' && s.geraet?.art === 'wirt' && s.geraet.name === 'surge' ? s.geraet : null;
    const name = rb ? 'rb338' : surge ? 'surge' : s.art === 'audio' ? 'audio' : s.geraet?.art === 'intern' ? s.geraet.name
      : s.geraet?.art === 'wirt' ? 'plugin' : (s.geraet?.art ?? 'none');
    // Surge (U5): the map holds display values; a parameter it does not hold yet starts from the host's current value (ctx.surgeIst, read by the server)
    const umfeld = surge ? { bereich: ctx.surgeBereich ?? (() => null), ist: (n: string) => ctx.surgeIst?.(surge.slot, n) ?? null,
      filter1An: () => ctx.surgeFilter1An?.(surge.slot) ?? null } : undefined;
    const alt = rb ? (s.geraet as { parameter: Record<string, number> }).parameter : surge ? { ...(surge.parameter ?? {}) } : {};
    const r = richtungAnwenden(name, alt, a.wort, a.staerke ?? 1, umfeld);
    if ('grund' in r) {
      if (r.grund === 'richtung_unbekannt') ab('richtung_unbekannt', r.text);
      if (r.grund === 'richtung_grenze') ab('richtung_grenze', r.text);
      if (r.grund === 'wirt_wert_unbekannt') ab('wirt_wert_unbekannt', r.text);
      if (r.grund === 'richtung_wirkungslos') ab('richtung_wirkungslos', r.text);
      ab('argument_ungueltig', r.text);
    } else if (surge) {
      if (Object.keys(r.parameter).length > SURGE_PARAMETER_MAX) ab('argument_ungueltig', `the Surge map holds at most ${SURGE_PARAMETER_MAX} entries`);
      surge.parameter = r.parameter;
    } else (s.geraet as { parameter: Record<string, number> }).parameter = r.parameter;
  },

  // 1.9 U4 (O28, E8): a factory or user preset of the RB-338 becomes the track's parameter object (display units → the core's 0..1, rb_mapping.ts).
  // The object is replaced as a whole: a parameter the preset does not name goes back to the plugin default,
  // so the result does not depend on what the track held before.
  preset_anwenden(p, a, ctx) {
    erlaube(a, 'spur_id', 'preset');
    const s = spurVon(p, idArg(a, 'spur_id'));
    const id = idArg(a, 'preset');
    if (!RB_PRESET_ID.test(id)) ab('argument_ungueltig', 'preset: an id like werk:rb338/dark-dub is expected (werk or nutzer, device rb338, a slug)');
    if (s.art !== 'instrument' || !istRbGeraet(s.geraet)) ab('argument_ungueltig', `${s.id}: only an RB-338 track takes an RB-338 preset`);
    const preset = ctx.presetLies?.(id) ?? null;
    if (preset === null || preset.geraet !== 'rb338') ab('preset_unbekannt', id);
    let parameter: Record<string, number>;
    try { parameter = presetZuParameter(preset!.werte); } catch (e) { return ab('argument_ungueltig', `${id}: ${(e as Error).message}`); }
    (s.geraet as { parameter: Record<string, number> }).parameter = parameter;
    (s.geraet as { preset?: string }).preset = id;   // merge with 1.16 rest: the device remembers the preset it came from, as presets_anwenden does
  },

  bk_setzen(p, a) {   // S17: sound snapshot entry (project/modular.ts); no playback, no controls
    const r = bkSetzen(p.baukasten, a);
    if ('grund' in r) ab(r.grund, r.text);
    else if (r.liste.length) p.baukasten = r.liste; else delete p.baukasten;
  },
};
export const BEFEHL_NAMEN: readonly string[] = Object.keys(PRO_BEFEHL);

// Ein eingefrorener Wirt-Spur-Klang gilt nur zu genau den Noten, dem Gerät und dem Tempo, mit denen er entstanden ist
// (Spec 3.3: Noten oder Gerät; Tempo ergänzt, weil das Audio in Sekunden fest ist und die Noten in Beats wandern).
// `Vorher` hält nur, was dafür nötig ist: Tempo und die Klang-Sicht der eingefrorenen Spuren. Ohne Freeze im Projekt kostet das nichts.
interface Vorher { tempo: number; sichten: Map<string, string> }
function merkeFreezes(p: Projekt): Vorher | null {
  const frozen = p.spuren.filter((s) => s.freeze);
  return frozen.length === 0 ? null : { tempo: p.tempo_bpm, sichten: new Map(frozen.map((s) => [s.id, kanonisch(spurSicht(s, false))])) };
}
function verwerfeFreezes(vorher: Vorher, neu: Projekt): void {
  for (const s of neu.spuren) {
    if (!s.freeze) continue;
    const alt = vorher.sichten.get(s.id);
    if (alt === undefined || vorher.tempo !== neu.tempo_bpm || alt !== kanonisch(spurSicht(s, false))) s.freeze = null;
  }
}

function pruefeBefehl(b: unknown): asserts b is Befehl {
  if (!istObjekt(b) || typeof b.befehl !== 'string' || !Object.hasOwn(PRO_BEFEHL, b.befehl)) {
    ab('befehl_unbekannt', istObjekt(b) && typeof b.befehl === 'string' ? b.befehl : 'kein Befehl');
  }
}
function wendeAn(entwurf: Projekt, b: unknown, ctx: Kontext): void {
  pruefeBefehl(b);
  const vorher = merkeFreezes(entwurf);
  PRO_BEFEHL[b.befehl](entwurf, b as Args, ctx);
  if (vorher) verwerfeFreezes(vorher, entwurf);
}

const KURZ = { fader_db: 'fader', pan: 'pan', mute: 'mute', solo: 'solo' } as const;
// 1.10 slice 3: send controls spur|grp/<nr>/send/<r> (dB, -200 = absent), ret/<r>/{fader,pan,mute,solo} and ret/<r>/hall/*.
// A new or deleted return number sets the slot to the defaults; a deleted track or group sets its sends back to -200.
const HALL_PFAD = ['an', ...HALL_FELDER] as const;
const hallWert = (h: Return['hall'], k: (typeof HALL_PFAD)[number]): number => (k === 'an' ? (h.an ? 1 : 0) : h[k]);
function returnReglerAenderungen(alt: Projekt, neu: Projekt, aus: ReglerAenderung[]): void {
  const sendWerte = (st: Spur | Gruppe, p: Projekt): number[] => {
    const w = new Array<number>(MAX_RETURNS).fill(FADER_MIN);
    for (const sd of st.sends ?? []) { const r = (p.returns ?? []).find((x) => x.id === sd.id); if (r) w[r.nr - 1] = sd.db; }
    return w;
  };
  const strang = (kurz: string, a: (Spur | Gruppe)[], n: (Spur | Gruppe)[], pa: Projekt, pn: Projekt): void => {
    for (const st of n) {
      const vorher = a.find((x) => x.id === st.id && x.nr === st.nr);
      const w = sendWerte(st, pn), v = vorher ? sendWerte(vorher, pa) : new Array<number>(MAX_RETURNS).fill(FADER_MIN);
      w.forEach((x, i) => { if (x !== v[i]) aus.push({ pfad: `${kurz}/${st.nr}/send/${i + 1}`, wert: x }); });
    }
    for (const st of a) {
      if (n.some((x) => x.nr === st.nr)) continue;
      sendWerte(st, pa).forEach((x, i) => { if (x !== FADER_MIN) aus.push({ pfad: `${kurz}/${st.nr}/send/${i + 1}`, wert: FADER_MIN }); });
    }
  };
  strang('spur', alt.spuren, neu.spuren, alt, neu);
  strang('grp', alt.gruppen ?? [], neu.gruppen ?? [], alt, neu);
  const altR = alt.returns ?? [], neuR = neu.returns ?? [];
  const rw = (r: Return): number[] => [r.fader_db, r.pan, r.mute ? 1 : 0, r.solo ? 1 : 0];
  const RK = ['fader', 'pan', 'mute', 'solo'];
  for (const r of neuR) {
    const a = altR.find((x) => x.id === r.id && x.nr === r.nr);
    const w = rw(r), v = a ? rw(a) : null;
    w.forEach((x, i) => { if (!v || v[i] !== x) aus.push({ pfad: `ret/${r.nr}/${RK[i]}`, wert: x }); });
    for (const k of HALL_PFAD) {
      const x = hallWert(r.hall, k), y = a ? hallWert(a.hall, k) : hallWert(HALL_VORGABE, k);
      if (x !== y) aus.push({ pfad: `ret/${r.nr}/hall/${k}`, wert: x });
    }
  }
  for (const a of altR) {
    if (neuR.some((r) => r.nr === a.nr)) continue;
    rw(a).forEach((_, i) => aus.push({ pfad: `ret/${a.nr}/${RK[i]}`, wert: 0 }));
    for (const k of HALL_PFAD) {
      const vorgabe = hallWert(HALL_VORGABE, k);
      if (hallWert(a.hall, k) !== vorgabe) aus.push({ pfad: `ret/${a.nr}/hall/${k}`, wert: vorgabe });
    }
  }
}

// arr-bk slice 3: the graph of a bk stage. The name rule always applies; with ctx.graphArt (the server injects a lookup into the graph folder)
// an unknown graph and
// an instrument graph (no `eingang` node) are refused with the reason in the text, the mirror of the check for an instrument track (baueBkGeraet).
function bkEffektGraph(g: unknown, ctx?: Kontext): string {
  if (g === undefined) ab('argument_ungueltig', 'graph: an effect graph name is required for art bk (list them with the graphen tool: art effekt)');
  if (typeof g !== 'string' || !BK_GRAPH_NAME.test(g)) ab('argument_ungueltig', 'graph: graph name expected ([a-z0-9_-], 1..32 characters)');
  const art = ctx?.graphArt?.(g);
  if (ctx?.graphArt && art === null) ab('argument_ungueltig', `graph: unknown graph ${g} (list the graphs with the graphen tool)`);
  if (art === 'instrument') {
    ab('argument_ungueltig', `graph: ${g} is an instrument graph (it has no input node), an effect graph is expected (graphen tool, art effekt)`);
  }
  return g;
}

// 1.10 slice 4: the pooled rows ins/<art>/<slot>/* follow the stages by SLOT, not by strip: a slot that is free (or whose stage left) is at the
// defaults (an 0, the pool defaults, sc 0). Values first, `an` last when a stage turns on; `an` first when it turns off, so nothing sounds with stale values.
// Slice 4b: the same for eq, saett and lim (the contract names every row of the kind, the EQ band rows as 'b<m>/<parameter>').
// utility and bk last, as in the contract (arr-fx, arr-bk)
const INS_POOL: readonly InsertPoolArt[] = ['komp', 'eq', 'saett', 'lim', 'host', 'utility', 'bk'];
// A value of an insert stage by the range of its contract row. One more rule that the range cannot say: `mono_unter` of the utility is 0 (off) or at least 1 Hz
// (the core treats 1 to 19 as 20 Hz, the page shows "off" below 1), so 0 < v < 1 is refused instead of switching the bass mono on while the page says off.
function insertZahl(art: InsertPoolArt, q: { min: number; max: number; ganz?: boolean; name: string }, o: Args, k: string): number {
  const v = zahl(o, k, q.min, q.max, { ganz: q.ganz })!;
  if (art === 'utility' && q.name === 'mono_unter' && v > 0 && v < 1) ab('argument_ungueltig', `${k}: 0 (off) or 1..500 Hz expected (1 to 19 act as 20 Hz)`);
  return v;
}

const INS_NAMEN = Object.fromEntries(INS_POOL.map((art) => [art, INSERT_ARTEN[art].parameter.map((q) => q.name)])) as Record<InsertPoolArt, string[]>;
const INS_VORGABE: Record<InsertPoolArt, Record<string, number>> = Object.fromEntries(
  INS_POOL.map((art) => [art, Object.fromEntries(INSERT_ARTEN[art].parameter.map((q) => [q.name, q.vorgabe]))])
) as Record<InsertPoolArt, Record<string, number>>;
function insertReglerAenderungen(alt: Projekt, neu: Projekt, aus: ReglerAenderung[]): void {
  for (const art of INS_POOL) {
    const zustand = (p: Projekt): Map<number, Record<string, number>> => new Map(alleInserts(p).filter((x) => x.insert.art === art)
      .map((x) => [x.insert.slot, { ...x.insert.werte, an: x.insert.an ? 1 : 0, ...(art === 'komp' ? { sc: x.insert.sc ?? 0 } : {}) }] as const));
    const a = zustand(alt), n = zustand(neu);
    for (const slot of [...new Set([...a.keys(), ...n.keys()])].sort((x, y) => x - y)) {
      const v = a.get(slot) ?? INS_VORGABE[art], w = n.get(slot) ?? INS_VORGABE[art];
      const geaendert = INS_NAMEN[art].filter((k) => v[k] !== w[k]);
      const pfad = (k: string): ReglerAenderung => ({ pfad: `ins/${art}/${slot}/${k}`, wert: w[k] });
      if (geaendert.includes('an') && w.an === 0) aus.push(pfad('an'));
      for (const k of geaendert) if (k !== 'an') aus.push(pfad(k));
      if (geaendert.includes('an') && w.an === 1) aus.push(pfad('an'));
    }
  }
}

// 1.10 slice 4c: the macro rows rack/<slot>/m1..m4 follow the racks by SLOT, like the insert rows: a free slot (or one whose rack left) is at the default 0.
function rackReglerAenderungen(alt: Projekt, neu: Projekt, aus: ReglerAenderung[]): void {
  const zustand = (p: Projekt): Map<number, number[]> => new Map(alleRacks(p).map((x) => [x.rack.slot, x.rack.werte] as const));
  const a = zustand(alt), n = zustand(neu);
  for (const slot of [...new Set([...a.keys(), ...n.keys()])].sort((x, y) => x - y)) {
    const v = a.get(slot) ?? [0, 0, 0, 0], w = n.get(slot) ?? [0, 0, 0, 0];
    for (let i = 0; i < MAX_MAKROS; i++) if (v[i] !== w[i]) aus.push({ pfad: `rack/${slot}/m${i + 1}`, wert: w[i] });
  }
}

// Welche Regler (spur/<nr>/…) müssen auf welchen Wert? Mute und Solo als 0/1.
function reglerAenderungen(alt: Projekt, neu: Projekt): ReglerAenderung[] {
  const werte = (s: Spur): Record<(typeof MIXER)[number], number> => ({ fader_db: s.fader_db, pan: s.pan, mute: s.mute ? 1 : 0, solo: s.solo ? 1 : 0 });
  const aus: ReglerAenderung[] = [];
  for (const s of neu.spuren) {
    const a = alt.spuren.find((x) => x.id === s.id && x.nr === s.nr);
    const w = werte(s), v = a ? werte(a) : null;
    for (const k of MIXER) if (!v || v[k] !== w[k]) aus.push({ pfad: `spur/${s.nr}/${KURZ[k]}`, wert: w[k] });
  }
  for (const a of alt.spuren) {
    if (neu.spuren.some((s) => s.nr === a.nr)) continue;                      // die Nummer lebt weiter (ggf. mit neuer Spur): oben erledigt
    for (const k of MIXER) aus.push({ pfad: `spur/${a.nr}/${KURZ[k]}`, wert: 0 });
  }
  // 1.10: Gruppen-Regler grp/<nr>/* und pm/fader; eine gelöschte oder neue Gruppe setzt den Slot auf die Vorgabe (alles 0) beziehungsweise auf ihre Werte
  const gw = (g: Gruppe): Record<(typeof MIXER)[number], number> => ({ fader_db: g.fader_db, pan: g.pan, mute: g.mute ? 1 : 0, solo: g.solo ? 1 : 0 });
  const altG = alt.gruppen ?? [], neuG = neu.gruppen ?? [];
  for (const g of neuG) {
    const a = altG.find((x) => x.id === g.id && x.nr === g.nr);
    const w = gw(g), v = a ? gw(a) : null;
    for (const k of MIXER) if (!v || v[k] !== w[k]) aus.push({ pfad: `grp/${g.nr}/${KURZ[k]}`, wert: w[k] });
  }
  for (const a of altG) {
    if (neuG.some((g) => g.nr === a.nr)) continue;
    for (const k of MIXER) aus.push({ pfad: `grp/${a.nr}/${KURZ[k]}`, wert: 0 });
  }
  if ((alt.master?.fader_db ?? 0) !== (neu.master?.fader_db ?? 0)) aus.push({ pfad: 'pm/fader', wert: neu.master?.fader_db ?? 0 });
  returnReglerAenderungen(alt, neu, aus);
  insertReglerAenderungen(alt, neu, aus);
  rackReglerAenderungen(alt, neu, aus);
  return aus;
}

// Gleich wie kanonisch(a) === kanonisch(b), ohne beide Seiten zu sortieren und zu serialisieren: Identisches ist gleich (geteilte Noten des
// Notenwegs kosten nichts), Objekte vergleichen ihre Schlüssel ohne Reihenfolge (undefined zählt wie in JSON als fehlend), Arrays der Reihe nach;
// alles andere (Zahlen, Text, null) über kanonisch selbst, damit -0, NaN und Co. genau wie dort ausgehen. Spec 6.31 (Leistung).
export function gleicheSicht(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!gleicheSicht(a[i], b[i])) return false;
    return true;
  }
  if (istObjekt(a) && istObjekt(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined), kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => b[k] !== undefined && gleicheSicht(a[k], b[k]));
  }
  if (istObjekt(a) || istObjekt(b)) return false;
  return kanonisch(a) === kanonisch(b);
}

// Was ein Stand dem Kern sagt: Wiedergabe neu nötig? Welche Regler müssen auf welchen Wert?
export function vergleiche(alt: Projekt, neu: Projekt): { betrifft_wiedergabe: boolean; regler_aenderungen: ReglerAenderung[] } {
  return { betrifft_wiedergabe: !gleicheSicht(wiedergabeSicht(alt), wiedergabeSicht(neu)), regler_aenderungen: reglerAenderungen(alt, neu) };
}

// --- Schneller Weg für Mixer- und Kopfbefehle --------------------------------------------------------------------------
const SPUR_LEICHT = ['name', 'farbe', 'fader_db', 'pan', 'mute', 'solo'];
function istLeicht(projekt: Projekt, b: unknown): boolean {
  if (!istObjekt(b) || typeof b.befehl !== 'string') return false;
  switch (b.befehl) {
    // ein Gerätewechsel berührt Freeze, Slots und Klang; gruppe kann neu entstehen, und leichterUnterschied sieht nur Schlüssel, die schon da sind
    case 'spur_aendern': return b.geraet === undefined && b.gruppe === undefined && b.arm === undefined && b.eingang === undefined && b.monitor === undefined;
    case 'loop_setzen': case 'metronom_setzen': return true;
    case 'gruppenspur_aendern': case 'master_aendern': return true;
    // slice 4: knob and bypass of a stage are live only (the key `sc` may add or remove a field, and `key` is structure, so both take the general path)
    case 'insert_param_setzen': return b.param !== 'sc' && b.param !== 'key';
    case 'insert_an': return true;
    case 'rack_makro': case 'makro_variation_laden': return true;   // slice 4c: the live macro value is a control change
    case 'tempo_setzen': return !projekt.spuren.some((s) => s.freeze);        // Tempo verwirft Freezes und ändert deren Länge in Beats
    default: return false;
  }
}

// Unterschied zweier Stände, soweit ihn leichte Befehle erzeugen können (Tempo, Loop, Metronom, flache Spur-Felder), in der Schlüsselfolge
// von `von` (dieselbe Reihenfolge wie `unterschied`, damit beide Wege dieselben Patches ergeben).
function leichterUnterschied(von: Projekt, nach: Projekt): Patch {
  const aus: Patch = [];
  const flach = (a: object, b: object, pfad: string, felder?: readonly string[]): void => {
    for (const k of Object.keys(a)) {
      if (felder && !felder.includes(k)) continue;
      const x = (a as Record<string, unknown>)[k], y = (b as Record<string, unknown>)[k];
      if (x !== y && !(Number.isNaN(x) && Number.isNaN(y))) aus.push({ op: 'replace', pfad: `${pfad}/${pfadSegment(k)}`, wert: y });
    }
  };
  // slice 4: the stages of a strip, only the fields the light commands write (`an` and the values), in the key order of `unterschied`
  const stufen = (a: { inserts?: Insert[]; rack?: Rack }, b: { inserts?: Insert[]; rack?: Rack }, pfad: string): void => {
    if (a.inserts !== b.inserts) {
      (a.inserts ?? []).forEach((x, i) => {
        const y = b.inserts![i];
        if (x === y) return;
        flach(x, y, `${pfad}/inserts/${x.id}`, ['an']);
        flach(x.werte, y.werte, `${pfad}/inserts/${x.id}/werte`);
      });
    }
    // slice 4c: the live macro values of the rack (the general path replaces the whole array)
    if (a.rack && b.rack && a.rack !== b.rack) flach(a.rack, b.rack, `${pfad}/rack`, ['werte']);
  };
  for (const k of Object.keys(von)) {
    if (k === 'tempo_bpm') flach({ tempo_bpm: von.tempo_bpm }, { tempo_bpm: nach.tempo_bpm }, '');
    else if (k === 'loop' || k === 'metronom') flach(von[k], nach[k], `/${k}`);
    else if (k === 'spuren') {
      von.spuren.forEach((s, i) => {
        if (s === nach.spuren[i]) return;
        flach(s, nach.spuren[i], `/spuren/${s.id}`, SPUR_LEICHT); stufen(s, nach.spuren[i], `/spuren/${s.id}`);
      });
    } else if (k === 'gruppen') {
      von.gruppen.forEach((g, i) => {
        if (g === nach.gruppen[i]) return;
        flach(g, nach.gruppen[i], `/gruppen/${g.id}`, GRUPPE_LEICHT); stufen(g, nach.gruppen[i], `/gruppen/${g.id}`);
      });
    }
    else if (k === 'returns') (von.returns ?? []).forEach((r, i) => { if (r !== nach.returns![i]) stufen(r, nach.returns![i], `/returns/${r.id}`); });
    else if (k === 'master') { flach(von.master, nach.master, '/master', ['fader_db']); stufen(von.master, nach.master, '/master'); }
  }
  return aus;
}

function fuehreLeichtAus(projekt: Projekt, befehle: unknown[]): BefehlErgebnis {
  const entwurf: Projekt = { ...projekt, loop: { ...projekt.loop }, metronom: { ...projekt.metronom }, spuren: [...projekt.spuren],
    ...(projekt.gruppen ? { gruppen: [...projekt.gruppen], master: { ...projekt.master } } : {}) };
  const kopiert = new Set<string>();
  if (projekt.returns) entwurf.returns = [...projekt.returns];
  // slice 4: copy the strip, its chain and the stage that a light insert command writes (everything else stays shared)
  const kopiereStufe = (id: string): void => {
    if (kopiert.has(id)) return;
    const t = alleInserts(entwurf).find((x) => x.insert.id === id);
    if (!t) return;
    const eigen = { ...t.strang, inserts: t.strang.inserts!.map((x) => (x === t.insert ? { ...x, werte: { ...x.werte } } : x)) };
    const in_ = (liste: { id: string }[] | undefined): void => {
      const k = liste?.findIndex((x) => x.id === t.strangId) ?? -1;
      if (liste && k >= 0) liste[k] = eigen as never;
    };
    if (t.strangId === 'master') entwurf.master = eigen as typeof entwurf.master;
    else { in_(entwurf.spuren); in_(entwurf.gruppen); in_(entwurf.returns); }
    kopiert.add(id);
  };
  // slice 4c: copy the strip and its rack for rack_makro
  const kopiereRack = (id: string): void => {
    const key = `rack:${id}`;
    if (kopiert.has(key)) return;
    const st = sucheStrang(entwurf, id);
    if (!st?.rack) return;
    const eigen = { ...st, rack: { ...st.rack, werte: [...st.rack.werte] } };
    const in_ = (liste: { id: string }[] | undefined): void => {
      const k = liste?.findIndex((x) => x.id === id) ?? -1;
      if (liste && k >= 0) liste[k] = eigen as never;
    };
    if (id === 'master') entwurf.master = eigen as typeof entwurf.master;
    else { in_(entwurf.spuren); in_(entwurf.gruppen); in_(entwurf.returns); }
    kopiert.add(key);
  };
  const hinweise: LaneHinweis[] = [];
  befehle.forEach((b, i) => {
    const vorher = hatLaneRuhewerte(entwurf) ? laneRuhewerte(entwurf) : null;
    try {
      const a = b as Args;
      if ((a.befehl === 'rack_makro' || a.befehl === 'makro_variation_laden') && typeof a.strang_id === 'string') kopiereRack(a.strang_id);
      if ((a.befehl === 'insert_param_setzen' || a.befehl === 'insert_an') && typeof a.insert_id === 'string') kopiereStufe(a.insert_id);
      if (a.befehl === 'spur_aendern' && typeof a.spur_id === 'string' && !kopiert.has(a.spur_id)) {
        const k = entwurf.spuren.findIndex((s) => s.id === a.spur_id);
        if (k >= 0) { entwurf.spuren[k] = { ...entwurf.spuren[k] }; kopiert.add(a.spur_id); }
      }
      if (a.befehl === 'gruppenspur_aendern' && typeof a.gruppe_id === 'string' && !kopiert.has(a.gruppe_id)) {
        const k = (entwurf.gruppen ?? []).findIndex((g) => g.id === a.gruppe_id);
        if (k >= 0) { entwurf.gruppen[k] = { ...entwurf.gruppen[k] }; kopiert.add(a.gruppe_id); }
      }
      PRO_BEFEHL[a.befehl](entwurf, a, { quelle: 'andreas' });          // nur Befehle ohne Herkunft (istLeicht)
    } catch (e) { if (e instanceof BefehlFehler) e.index = i; throw e; }
    hinweise.push(...laneHinweise(vorher, entwurf, i));
  });
  return { projekt: entwurf, vor: leichterUnterschied(projekt, entwurf), zurueck: leichterUnterschied(entwurf, projekt),
    betrifft_wiedergabe: false, regler_aenderungen: reglerAenderungen(projekt, entwurf), ...(hinweise.length ? { hinweise } : {}) };
}

// --- Notenweg (Spec 6.31, Leistung) ----------------------------------------------------------------------------------
// Eine Liste nur aus noten_neu, noten_aendern und noten_loeschen berührt nur die genannten Clips. Statt das ganze Projekt tief zu kopieren,
// bekommen nur ihre Spuren und Clips eine flache Kopie samt eigener Notenliste; alle anderen Spuren, Clips und Noten werden geteilt. Die Befehle
// verändern dabei keine geteilte Note (noten_aendern setzt ein neues Objekt, noten_neu hängt an die eigene Liste, noten_loeschen filtert), und
// unterschied/vergleiche sehen Geteiltes über die Identität. Ergebnis wie der volle Weg (Test: beide Wege, das Ausgangsprojekt bleibt gleich).
const NOTEN_BEFEHLE: ReadonlySet<unknown> = new Set(['noten_neu', 'noten_aendern', 'noten_loeschen']);
function notenEntwurf(projekt: Projekt, befehle: unknown[]): Projekt | null {
  const clips = new Set<string>();
  for (const b of befehle) {
    if (!istObjekt(b) || !NOTEN_BEFEHLE.has(b.befehl) || typeof b.clip_id !== 'string') return null;
    clips.add(b.clip_id);
  }
  return { ...projekt, loop: { ...projekt.loop }, metronom: { ...projekt.metronom },
    spuren: projekt.spuren.map((s) => (s.clips.some((c) => clips.has(c.id))
      ? { ...s, clips: s.clips.map((c) => (clips.has(c.id) && c.art === 'midi' ? { ...c, noten: [...c.noten] } : c)) } : s)) };
}

type TransientenQuelle = (sha256: string) => number[] | null;
// The checks every command list ends with (model validity, the core's limits after unrolling loops, warp markers); also the end of a recording.
export function pruefeGrenzen(entwurf: Projekt, o: { transienten?: TransientenQuelle } = {}): void {
  const fehler = pruefeFehler(entwurf);
  if (fehler !== null) ab('projekt_ungueltig', fehler);
  const g = zaehleAusgerollt(entwurf);                                         // Spec 6.17: die Grenzen gelten nach dem Ausrollen
  // Spec 6.34: englisch (der Text kam bisher deutsch an die Seite, die bei zu_gross den Text der Antwort zeigt)
  if (g.clips > MAX_CLIPS || g.noten > MAX_NOTEN) {
    ab('zu_gross', `after unrolling loops ${g.clips} clips, ${g.noten} notes (at most ${MAX_CLIPS}, ${MAX_NOTEN})`);
  }
  // Paket 1.13: Warp-Marker aller Kopien, Grenze wie im Kern (Slice 4: BEATS-Einheiten nach denselben Transienten wie uebersetze)
  const marker = zaehleWarpMarker(entwurf, o.transienten ? { transienten: o.transienten } : undefined);
  if (marker > MAX_WARP_PUNKTE) ab('zu_gross', `after unrolling loops ${marker} warp markers (at most ${MAX_WARP_PUNKTE})`);
  // 1.12 slice 5 (D7): clip envelope points count with the lane points against MAX_AUTO_PUNKTE (once per repetition over the clip)
  let hk = 0, lanen = 0;
  // 1.12 slice 6: every strip carries lanes
  for (const { strang } of alleStraenge(entwurf)) for (const l of strang.automation ?? []) lanen += l.punkte.length;
  for (const s of entwurf.spuren) for (const c of s.clips) hk += hkPunkteZahl(c);
  if (hk > 0 && hk + lanen > MAX_AUTO_PUNKTE) ab('zu_gross', `${lanen} lane points and ${hk} envelope points (at most ${MAX_AUTO_PUNKTE})`);
  // the modulation envelopes of a track merge into one relative lane per target (D9); the core takes at most MAX_LANE_PUNKTE points per lane.
  // The total counts the points as the translator writes them (gain_hk per copy, relative lanes): the roll-out adds points at every period edge.
  if (hk > 0) {
    let ausgerollt = 0;
    for (const s of entwurf.spuren) {
      for (const l of relativeLanen(s.clips)) {
        const n = l.punkte.length;
        if (n > MAX_LANE_PUNKTE) ab('zu_gross', `${s.id}: the ${l.ziel} modulation rolls out to ${n} points (at most ${MAX_LANE_PUNKTE})`);
        ausgerollt += l.punkte.length;
      }
      for (const c of s.clips) ausgerollt += gainHkPunkte(c);
    }
    if (ausgerollt + lanen > MAX_AUTO_PUNKTE) ab('zu_gross', `${lanen} lane points and ${ausgerollt} rolled-out envelope points (at most ${MAX_AUTO_PUNKTE})`);
  }
}
// Mehrere Befehle nacheinander (spätere sehen frühere); ein Gesamt-Patch von `projekt` zum Ergebnis. Eine Ablehnung verwirft alle.
// o.quelle: Herkunft für spur_neu (Spec 6.22), ohne Angabe andreas. o.voll: immer der allgemeine Weg (tiefe Kopie), für den Vergleich in Tests.
// o.transienten (Slice 4, D9): dieselbe Transienten-Quelle wie uebersetze, damit die Zählung der BEATS-Einheiten hier und dort gleich ist;
// ohne gilt Raster 1/16.
export function fuehreListeAus(projekt: Projekt, befehle: unknown[],
  o: { voll?: boolean; quelle?: Herkunft; transienten?: TransientenQuelle; graphArt?: Kontext['graphArt']; kitDa?: Kontext['kitDa'];
    presetLies?: Kontext['presetLies']; surgeBereich?: Kontext['surgeBereich']; surgeIst?: Kontext['surgeIst'];
    surgeFilter1An?: Kontext['surgeFilter1An']; surgePatchDa?: Kontext['surgePatchDa']; pluginDa?: Kontext['pluginDa'];
    pluginIndex?: Kontext['pluginIndex']; musterUebersetze?: Kontext['musterUebersetze']; kitKlaenge?: Kontext['kitKlaenge'];
    musterMeldung?: Kontext['musterMeldung'] } = {}): BefehlErgebnis {
  if (!Array.isArray(befehle) || befehle.length === 0) ab('argument_ungueltig', 'befehle: nicht leere Liste erwartet');
  if (!o.voll && befehle.every((b) => istLeicht(projekt, b))) return fuehreLeichtAus(projekt, befehle);
  const entwurf = (o.voll ? null : notenEntwurf(projekt, befehle)) ?? structuredClone(projekt);
  const ctx: Kontext = { quelle: o.quelle ?? 'andreas', ...(o.graphArt ? { graphArt: o.graphArt } : {}), ...(o.kitDa ? { kitDa: o.kitDa } : {}),
    ...(o.presetLies ? { presetLies: o.presetLies } : {}), ...(o.surgeBereich ? { surgeBereich: o.surgeBereich } : {}),
    ...(o.surgeIst ? { surgeIst: o.surgeIst } : {}),
    ...(o.surgeFilter1An ? { surgeFilter1An: o.surgeFilter1An } : {}), ...(o.surgePatchDa ? { surgePatchDa: o.surgePatchDa } : {}),
    ...(o.pluginDa ? { pluginDa: o.pluginDa } : {}), ...(o.pluginIndex ? { pluginIndex: o.pluginIndex } : {}),
    ...(o.musterUebersetze ? { musterUebersetze: o.musterUebersetze } : {}), ...(o.kitKlaenge ? { kitKlaenge: o.kitKlaenge } : {}),
    ...(o.musterMeldung ? { musterMeldung: o.musterMeldung } : {}) };
  const hinweise: LaneHinweis[] = [];
  befehle.forEach((b, i) => {
    const vorher = hatLaneRuhewerte(entwurf) ? laneRuhewerte(entwurf) : null;
    try { wendeAn(entwurf, b, ctx); } catch (e) { if (e instanceof BefehlFehler) e.index = i; throw e; }
    hinweise.push(...laneHinweise(vorher, entwurf, i));
  });
  pruefeGrenzen(entwurf, o);
  return { projekt: entwurf, vor: unterschied(projekt, entwurf), zurueck: unterschied(entwurf, projekt), ...vergleiche(projekt, entwurf),
    ...(hinweise.length ? { hinweise } : {}) };
}
export const fuehreAus = (projekt: Projekt, befehl: unknown): BefehlErgebnis => fuehreListeAus(projekt, [befehl]);

// Abgleich der Audio-Clips mit dem Dekodier-Cache (Spec 2.8: Zustand je Clip). Kein Befehl und kein Undo-Eintrag: der Zustand ist
// abgeleitet und steht nie in einem Patch (Spec 6.6). Ändert sich etwas, steigt rev um 1; ändert sich nichts, kommt dasselbe Objekt zurück.
export function gleicheDekodiertAb(p: Projekt, zustandVon: (sha256: string) => DekodiertZustand): Projekt {
  let anders = false;
  for (const c of alleAudioClips(p)) if (zustandVon(c.quelle.sha256) !== c.dekodiert) anders = true;
  if (!anders) return p;
  const q = structuredClone(p);
  setzeDekodiert(q, zustandVon);
  q.rev += 1;
  return q;
}
// Setzt den Zustand aller Audio-Clips in `p` selbst (ohne rev). Nach Undo/Redo und beim Nachziehen aus dem Log ruft der Verlauf das über
// den Haken `dekodiert`, weil Patches den echten Zustand nicht tragen.
export function setzeDekodiert(p: Projekt, zustandVon: (sha256: string) => DekodiertZustand): void {
  for (const c of alleAudioClips(p)) c.dekodiert = zustandVon(c.quelle.sha256);
}
// 1.14 comping (R9): the audio clips of the main lanes and of the take lanes; a take clip is decoded like a main clip
export function* alleAudioClips(p: Projekt): Generator<AudioClip> {
  for (const s of p.spuren) {
    for (const c of s.clips) if (c.art === 'audio') yield c;
    for (const t of s.takes ?? []) for (const c of t.clips) yield c;
  }
}
