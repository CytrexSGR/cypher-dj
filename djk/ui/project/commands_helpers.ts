// Helpers of the project commands (commands.ts): argument checks, lookups, device builders, the command context and the registry of the handlers.
// Moved out of commands.ts unchanged (pure move); commands.ts re-exports the names that other files import from it.
import {
  GERAET_PRAEFIX, FADER_MIN, istSendZiel, sendZielVon,
  BK_KNOPF_VORGABE, RB_VORGABE_NORM, normalisiereLane, punktePruefung, istKettenZiel, istBlendZiel, zerlegeKettenZiel,
  kettenZielBereich, zielBereichVon, alleStraenge, type Lane, type Punkt, GRUPPE_MAX, INTERNE_EINGAENGE, MAX_BEAT, MAX_GRUPPEN, MAX_RETURNS,
  MAX_SPUREN, HALL_FELDER, MAX_INSERTS_PRO_STRANG, MAX_INS, alleInserts, sucheStrang, gliedMakroParam, glieder, istGliedZiel, istInsertZiel, makroVon,
  VARIATION_NAME_MAX, type Rack, type RackZiel, BK_GRAPH_NAME, BK_PARAMETER, KIT_NAME, RB_PARAMETER, WIRT_SLOTS, SURGE_NAME, SURGE_PARAMETER_MAX,
  istPatchName, TAKE_NAME_MAX, type Take, istObjekt, neueId, notenNummer, notenZaehler, sucheClip, sucheSpur, warpPruefung, type AudioClip, type Clip,
  type Glied, type RackGeraet, type Gruppe, type Herkunft, type Geraet, type Insert, type InsertSchluessel, type InsertTraeger, type MidiClip,
  type Note, type Projekt, type Return, type Spur, type Warp, HOST_PFAD_ZEICHEN, HOST_UID_ZEICHEN, wirtSlots, EXTERN_MODI, type EingangExtern,
  type EingangIntern, type EingangMidi,
} from './model.ts';
import { type KitKlang, type MusterErgebnis, type MusterFehlschlag } from './pattern_clip.ts';
import { createHash } from 'node:crypto';
import { pruefeSchluessel, type SchluesselFrage } from './routing_rules.ts';
import { PRESET_ID } from '../presets/preset_id.ts';
import { stiftFehler, type Steckfeld, type Stift } from '../steckfeld.ts';
import { type Patch } from './patch.ts';
import { klingtGleich, TAKE_KOPIE_EPS } from './takes.ts';
import { WarpFehler } from './warp.ts';

export class BefehlFehler extends Error {
  readonly grund: string;
  readonly detail: string;
  index?: number;                                  // Stelle in einer Befehlsliste (fuehreListeAus)
  constructor(grund: string, detail = '') { super(detail ? `${grund}: ${detail}` : grund); this.grund = grund; this.detail = detail; }
}
export const ab = (grund: string, detail?: string): never => { throw new BefehlFehler(grund, detail); };

export interface ReglerAenderung { pfad: string; wert: number }
/** Kraken patch field: one live pin of the matrix block of the project track `nr` (light path only; last write per position, value 0 = pin removed) */
export interface StiftAenderung { nr: number; satz: number; zeile: number; spalte: number; wert: number }
export interface BefehlErgebnis {
  projekt: Projekt; vor: Patch; zurueck: Patch; betrifft_wiedergabe: boolean; regler_aenderungen: ReglerAenderung[]; hinweise?: LaneHinweis[];
  stift_aenderungen?: StiftAenderung[]
}
/** The answer of a command that wrote the value of a parameter on which a lane lies (an insert stage parameter, a rack macro, a Baukasten knob): the write is
 *  kept, but it is only the rest value of the parameter. While the arrangement plays, the lane drives the parameter in every block and holds its first and
 *  last value beyond its points; the value applies while the transport is stopped and after the lane is removed. `index` is the command in the list. */
export interface LaneHinweis { index: number; hinweis: 'lane_treibt'; lane_id: string; ziel: string; strang_id: string; text: string }
/** the fader lane of a RETURN: the core ignores the return fader while it plays and there is no hand override for returns, so the fader is a rest value like a
 *  chain parameter. A track has the override and the master and groups take no fader lane, so this holds for returns only. */
const istReturnFaderLane = (p: Projekt, strang: InsertTraeger, l: Lane): boolean => l.ziel === 'fader' && (p.returns ?? []).includes(strang as Return);
/** the stored value of every lane-driven parameter, keyed by strip and lane id (chain and knob lanes and the fader lane of a return; the lanes of a track
 *  fader, pan, mute and solo have the hand override) */
export function laneRuhewerte(p: Projekt): Map<string, { wert: number | undefined; lane: Lane; strangId: string }> {
  const aus = new Map<string, { wert: number | undefined; lane: Lane; strangId: string }>();
  for (const { strang, strangId } of alleStraenge(p)) {
    for (const l of strang.automation ?? []) {
      let wert: number | undefined;
      if (istReturnFaderLane(p, strang, l)) wert = (strang as Return).fader_db;
      else if (istKettenZiel(l.ziel)) {
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
export const hatLaneRuhewerte = (p: Projekt): boolean =>
  alleStraenge(p).some(({ strang }) => (strang.automation ?? []).some((l) => istReturnFaderLane(p, strang, l) || istKettenZiel(l.ziel)
    || /^geraet\.k([1-9]|[1-5][0-9]|6[0-4])$/.test(l.ziel)));
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
export type Args = Record<string, any>;                   // eslint-disable-line @typescript-eslint/no-explicit-any
export function erlaube(a: Args, ...namen: string[]): void {
  for (const k of Object.keys(a)) if (k !== 'befehl' && !namen.includes(k)) ab('argument_unbekannt', k);
}
export const zahlOk = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
export function zahl(a: Args, k: string, min: number, max: number, o: { opt?: boolean; ganz?: boolean; offenUnten?: boolean } = {}): number | undefined {
  const x = a[k];
  if (x === undefined) { if (o.opt) return undefined; return ab('argument_ungueltig', `${k}: fehlt`); }
  if (!zahlOk(x) || x > max || (o.offenUnten ? x <= min : x < min) || (o.ganz && !Number.isInteger(x))) {
    return ab('argument_ungueltig', `${k}: ${o.ganz ? 'ganze ' : ''}Zahl ${o.offenUnten ? '>' : '≥'} ${min} und ≤ ${max} erwartet`);
  }
  return x;
}
export function flagge(a: Args, k: string, opt = false): boolean | undefined {
  const x = a[k];
  if (x === undefined && opt) return undefined;
  return typeof x === 'boolean' ? x : ab('argument_ungueltig', `${k}: true oder false erwartet`);
}

// 1.8 S0: the recording input of a track as the command carries it. Audio tracks take an internal tap or an external pair (mode defaults to stereo),
// instrument tracks take midi_ein_1; everything else is eingang_fehlt (the same reason the kern gives for an input it cannot tap).
export function eingangVon(art: 'audio' | 'instrument', roh: unknown): EingangIntern | EingangExtern | EingangMidi {
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
export function text(a: Args, k: string, max: number, opt = true): string | undefined {
  const x = a[k];
  if (x === undefined && opt) return undefined;
  return typeof x === 'string' && x.trim().length >= 1 && x.length <= max ? x : ab('argument_ungueltig', `${k}: Text mit 1 bis ${max} Zeichen erwartet`);
}
// Paket 1.18, E-c (Review S2): der Gruppenname trägt keine Leerzeichen am Rand, sonst wären ' bass' und 'bass' zwei Gruppen; wie model.ts beim Laden
export function gruppeArg(a: Args, opt = true): string | undefined {
  const g = text(a, 'gruppe', GRUPPE_MAX, opt);
  return g !== undefined && g.trim() !== g ? ab('argument_ungueltig', 'gruppe: ohne Leerzeichen am Rand') : g;
}
// The hall object of return_neu / return_aendern: a partial object of the Hall fields (an: true/false, the rest 0..1); writes into `ziel`
export function hallArg(x: unknown, ziel: Return['hall']): void {
  if (x === undefined) return;
  if (!istObjekt(x)) ab('argument_ungueltig', 'hall: Objekt erwartet');
  for (const k of Object.keys(x)) if (k !== 'an' && !(HALL_FELDER as readonly string[]).includes(k)) ab('argument_unbekannt', `hall.${k}`);
  if (Object.keys(x).length === 0) ab('argument_ungueltig', 'hall: leeres Objekt');
  if (x.an !== undefined) { if (typeof x.an !== 'boolean') ab('argument_ungueltig', 'hall.an: true oder false erwartet'); ziel.an = x.an; }
  for (const k of HALL_FELDER) if (x[k] !== undefined) ziel[k] = zahl(x as Args, k, 0, 1)!;
}
export function idArg(a: Args, k: string): string {
  const x = a[k];
  return typeof x === 'string' && x ? x : ab('argument_ungueltig', `${k}: ID erwartet`);
}
// 1.9 T10: strip, rack and variation name of the three makro_variation_* commands
export function variationArgs(p: Projekt, a: Args): { rack: Rack; name: string } {
  erlaube(a, 'strang_id', 'name');
  const id = idArg(a, 'strang_id');
  const strang = sucheStrang(p, id) ?? ab('spur_unbekannt', id);
  const name = text(a, 'name', VARIATION_NAME_MAX, false)!;
  if (!strang.rack) ab('rack_unbekannt', `${id} has no rack`);
  return { rack: strang.rack!, name };
}
export const spurVon = (p: Projekt, id: string): Spur => sucheSpur(p, id) ?? ab('spur_unbekannt', id);
// T4: a track that uses a production slot carries `freeze` (null or the entry), every other track carries none; a change of the sound drops the entry
export const freezeFeld = (s: Spur): void => { if (wirtSlots(s).length > 0) s.freeze = null; else delete s.freeze; };
export const gruppeVon = (p: Projekt, id: string): Gruppe => (p.gruppen ?? []).find((g) => g.id === id) ?? ab('gruppe_unbekannt', id);
export const returnVon = (p: Projekt, id: string): Return => (p.returns ?? []).find((r) => r.id === id) ?? ab('return_unbekannt', id);
export const strangKennung = (p: Projekt, strang: InsertTraeger): string =>
  strang === p.master ? 'master' : (strang as { id?: string }).id ?? '?';
// slice 4c: after a chain change the rack of the strip loses the mappings of stages that are gone; a rack with no mapping left is removed (its
// slot goes back to the pool,
// the macro rows reset through reglerAenderungen)
export function rackBereinigen(strang: InsertTraeger): void {
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
export function kettenLanenBereinigen(strang: InsertTraeger): void {
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
export type Identitaet = { format: 'vst3' | 'lv2'; pfad: string; uid: string };
export function pluginIdentitaet(a: Args, ctx: Kontext, art: 'effekt' | 'instrument'): { identitaet: Identitaet; indexName?: string; pfad: string } {
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
export function hostSetzen(p: Projekt, a: Args, ctx: Kontext): void {
  erlaube(a, 'strang_id', 'pos', 'stufe', 'art', 'plugin', 'plugin_id', 'ersetzen', 'key');
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
  const key = hostSchluesselDef(p, id, identitaet, a.key, ctx, ersetzen ? strang.inserts![pos] : undefined);
  const iid = neueId(p, 'insert');
  const name = indexName || pfad.replace(/\/+$/, '').split('/').pop()!.replace(/\.(vst3|lv2)$/i, '') || pfad;
  const insert: Insert = { id: iid, art: 'host', slot, an: true, werte: {}, plugin: { ...identitaet, name: name.slice(0, 128) },
    zustand: `plugins/${iid}.carxs`, ...(key ? { key } : {}) };
  liste.splice(pos, 0, insert);
  strang.inserts = liste;
  rackBereinigen(strang);
}
// strand 2 task 3.4: the structural key of a host stage. Its plugin needs a key pair: the index entry (looked up by the id plugin_scan.py gives the
// identity, sha1 of `<format>:<pfad>#<uid>`) has at least HOST_SCHLUESSEL_EIN audio inputs, inputs 3 and 4 being the key; no entry or fewer inputs
// is kein_schluessel. The sources and rules are those of the compressor, but a host stage has no row key: track pre (the komp row sc) is refused.
// null = no key (always allowed, also without an index).
export const HOST_SCHLUESSEL_EIN = 4;
export const pluginIndexId = (pl: { format: string; pfad: string; uid: string }): string =>
  createHash('sha1').update(`${pl.format}:${pl.pfad}#${pl.uid}`).digest('hex').slice(0, 12);
export function hostSchluesselDef(p: Projekt, strangId: string, plugin: { format: string; pfad: string; uid: string }, x: unknown, ctx: Kontext,
  ausser?: Insert): InsertSchluessel | null {
  if (x === undefined || x === null) return null;
  const e = ctx.pluginIndex?.(pluginIndexId(plugin)) ?? null;
  if (!e || !(typeof e.audio_ein === 'number' && e.audio_ein >= HOST_SCHLUESSEL_EIN)) {
    const hat = e ? `${e.audio_ein ?? 0} audio inputs` : 'not in the plugin index';
    ab('kein_schluessel', `${e?.name ?? plugin.pfad}: ${hat}, a key needs ${HOST_SCHLUESSEL_EIN}`);
  }
  if (istObjekt(x) && x.quelle === 'spur' && x.punkt === 'pre') {
    ab('argument_ungueltig', 'key: track pre is the row key of the compressor; a host stage takes track post or another source');
  }
  const def = schluesselDef(p, strangId, x, ausser);
  return def && 'key' in def ? def.key : null;
}
// slice 4: a stage by its ID, with the strip that carries it
export const insertVon = (p: Projekt, id: string): { strang: InsertTraeger; insert: Insert } => {
  const t = alleInserts(p).find((x) => x.insert.id === id);
  return t ? { strang: t.strang, insert: t.insert } : ab('insert_unbekannt', id);
};
// 1.10 slice 5 (E12): the values of "Duck by Kick" = presets/factory/comp/kick-sidechain.preset.json by the plugin names of INSERT_ARTEN (no file I/O here);
// tests/project_key.test.mjs pins this constant to the preset file
export const DUCK_DURCH_KICK_WERTE: Readonly<Record<string, number>> =
  { schwelle: -30, ratio: 8, knie: 0, attack: 1, release: 150, makeup: 0, mix: 1, schp: 0 };
// the sidechain key of a `komp` stage: 0 = own signal, n = input of track number n (the track must exist). 1.10 slice 6 (plan D13): the stage on the
// strip `traegerId` may not name its own track (`pre` of itself): the rules answer sidechain_zyklus, like the matrix cell. `ausser` = the stage rewritten.
export function schluesselArg(p: Projekt, x: unknown, traegerId: string, ausser?: Insert): number {
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
export const KEY_QUELLEN = ['spur', 'grp', 'ret', 'pm', 'deck', 'erz', 'pad'] as const;
export function schluesselDef(p: Projekt, strangId: string, x: unknown, ausser?: Insert): { sc: number } | { key: InsertSchluessel } | null {
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
export function takeName(x: unknown): string {
  if (typeof x === 'string' && x.trim().length >= 1 && x.length <= TAKE_NAME_MAX) return x;
  return ab('take_name_ungueltig', `name: 1 to ${TAKE_NAME_MAX} characters expected`);
}
export function takeVon(p: Projekt, a: Args): { spur: Spur; take: Take } {
  const spur = spurVon(p, idArg(a, 'spur_id'));
  const id = idArg(a, 'take_id');
  const take = (spur.takes ?? []).find((t) => t.id === id);
  return take ? { spur, take } : ab('take_unbekannt', id);
}
export const FARBE_OK = /^#[0-9a-fA-F]{6}$/;
export const GRUPPE_LEICHT = ['name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'gefaltet'];   // Felder von gruppenspur_aendern
// Slice 2 (E4): the one place of the lock. Every lane command that writes goes through here and is rejected on a locked lane;
// only auto_aendern asks with `auchGesperrt` (it is the way to unlock).
// 1.12 slice 6: a lane lives on any strip (track, group, return, master), so the search covers all of them; `spur` is the strip that carries it
export const laneVon = (p: Projekt, id: string, auchGesperrt = false): { spur: InsertTraeger; lane: Lane } => {
  for (const { strang: spur } of alleStraenge(p)) {
    const lane = (spur.automation ?? []).find((l) => l.id === id);
    if (lane) { if (lane.gesperrt && !auchGesperrt) ab('lane_gesperrt', id); return { spur, lane }; }
  }
  return ab('lane_unbekannt', id);
};
// the value range of a lane on its strip (the lane exists, so the target does; a chain target that stopped existing is removed with its stage)
export const laneBereichVon = (strang: InsertTraeger, lane: Lane) =>
  zielBereichVon(lane.ziel, strang) ?? ab('ziel_unbekannt', `${lane.ziel} no longer exists on its strip`);
// 1.12 slice 4: the range of an editor tool; bis <= von or a range outside 0..MAX_BEAT is bereich_leer
export function laneBereich(a: Args): [number, number] {
  const von = zahl(a, 'von_beat', -Infinity, Infinity)!, bis = zahl(a, 'bis_beat', -Infinity, Infinity)!;
  if (!(von >= 0 && bis <= MAX_BEAT && bis > von)) ab('bereich_leer', `${von}..${bis} must lie inside 0..${MAX_BEAT} and be longer than 0`);
  return [von, bis];
}
export function laneSchreibe(strang: InsertTraeger, lane: Lane, punkte: Punkt[]): void {
  const f = punktePruefung(punkte, lane.ziel, laneBereichVon(strang, lane));
  if (f) ab(f.grund, f.text);
  lane.punkte = punkte;
  normalisiereLane(lane);
}
// the rack device of the track a rack command names; any other track is keine_rackspur
export function rackGeraetVon(p: Projekt, a: Args): RackGeraet {
  const s = spurVon(p, idArg(a, 'spur_id'));
  if (s.art !== 'instrument' || s.geraet?.art !== 'rack') ab('keine_rackspur', `${s.id} is not a rack track`);
  return s.geraet as RackGeraet;
}
// start value of a new lane: what the track has now, so the new line changes nothing audible until a point is moved
export function laneStart(strang: Spur | InsertTraeger, ziel: string): number {
  if (istBlendZiel(ziel)) return (strang as { blend?: number }).blend ?? 0;
  if (istSendZiel(ziel)) return ((strang as Spur).sends ?? []).find((x) => x.id === sendZielVon(ziel))?.db ?? FADER_MIN;   // the level of the send now
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
export const COMP_EPS = 1e-9;
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
export function compGleich(haupt: Clip[], quellen: AudioClip[], von: number, bis: number, bpm: number): boolean {
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
export const clipVon = (p: Projekt, id: string): { spur: Spur; clip: Clip } => sucheClip(p, id) ?? ab('clip_unbekannt', id);
export const midiVon = (clip: Clip, id: string): MidiClip => (clip.art === 'midi' ? clip : ab('clip_nicht_midi', id));
export const runde9 = (x: number): number => Math.round(x * 1e9) / 1e9;
export const SHA = /^[0-9a-f]{64}$/;
export const NOTEN_ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
export const NOTEN_NR_GRENZE = 2 ** 31;                   // Spec 6.32 (Wortlaut von 6.31 berichtigt): ausdrückliche Noten-IDs n<k> mit k < 2^31
export const WIRT_SLOT_LISTE = Array.from({ length: WIRT_SLOTS }, (_, i) => i + 1);
export const SLOT_TEXT = 'both Surge slots are in use (1, 2)';
export const SLOT_UNGUELTIG_TEXT = 'geraet.slot: 1 or 2 expected';

// --- Warp (Paket 1.13) -------------------------------------------------------------------------------------------------------------
// Das Warp-Argument eines Befehls: fehlt, null oder 'aus' heißt ohne Warp (null); ein Objekt wird wie im Modell geprüft (Grund und Text von
// warpPruefung). 'auto' löst nicht dieser Baustein, sondern der Server aus dem Katalog (session.ts loeseQuellenAuf); ein 'auto', das bis
// hierher kommt, hatte keinen Katalog.
export function warpArg(x: unknown): Warp | null {
  if (x === undefined || x === null || x === 'aus') return null;
  if (x === 'auto') return ab('argument_ungueltig', "warp 'auto' braucht den Katalog des Servers (Tempo-Angaben der Library)");
  const f = warpPruefung(x);
  if (f) return ab(f.grund, f.text);
  return structuredClone(x) as Warp;
}
export const WARP_FELDER = ['an', 'modus', 'transpose_st', 'detune_ct', 'beats'] as const;
// Slice 3b: die Befehle der Marker von Hand. Alle arbeiten auf einem Audio-Clip mit Warp (sonst kein_warp), rechnen mit den reinen Funktionen von
// warp.ts, prüfen das Ergebnis mit warpPruefung und setzen quelle 'hand'. Clip-Beats sind die Beats der Marker (Beat 0 = die Eins der Quelle).
export function warpClip(p: Projekt, a: Args): AudioClip & { warp: Warp } {
  const gefunden = clipVon(p, idArg(a, 'clip_id')).clip;
  const clip = gefunden.art === 'audio' ? gefunden : ab('feld_nur_audio', 'warp');
  if (!clip.warp) ab('kein_warp', clip.id);
  return clip as AudioClip & { warp: Warp };
}
export function mitWarp<T>(f: () => T): T {
  try { return f(); } catch (e) { if (e instanceof WarpFehler) return ab(e.grund, e.message); throw e; }
}
export function gueltig(w: Warp): Warp {
  const f = warpPruefung(w);
  if (f) ab(f.grund, f.text);
  return w;
}
export function objekte(a: Args, k: string, erlaubt: string[]): Args[] {
  return listeArg(a, k).map((x, i) => {
    if (!istObjekt(x)) return ab('argument_ungueltig', `${k}[${i}]: Objekt erwartet`);
    erlaube(x as Args, ...erlaubt);
    return x as Args;
  });
}

// 1.16 rest (F8): the preset origin of a device or stage, a register id; undefined = not given (the stored object then has no key)
export function presetArg(x: unknown, wo: string): string | undefined {
  if (x === undefined) return undefined;
  if (typeof x !== 'string' || !PRESET_ID.test(x)) ab('argument_ungueltig', `${wo}: preset id <werk|nutzer>:<geraet>/<slug> expected`);
  return x as string;
}

// Baukasten S20: {art: intern, name: bk, graph, parameter?}. The name rule always applies; with ctx.graphArt (the server injects a lookup into the
// graph folder) an unknown graph and an effect graph are refused here, so Cypher gets the refusal at the command and not at the next load.
export function baueBkGeraet(g: Args, ctx?: Kontext): Geraet {
  erlaube(g, 'art', 'name', 'graph', 'parameter', 'preset', 'stifte');
  const preset = presetArg(g.preset, 'geraet.preset');
  // Kraken patch field (task 9): a whole pin list may ride in the device (a preset applies through spur_aendern); absent = the graph's default pins
  if (g.stifte !== undefined) { const f = stiftFehler(g.stifte); if (f !== null) ab('argument_ungueltig', `geraet.${f}`); }
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
  return { art: 'intern', name: 'bk', graph: g.graph, parameter, ...(preset !== undefined ? { preset } : {}),
    ...(g.stifte !== undefined ? { stifte: (g.stifte as Stift[]).map((e): Stift => [e[0], e[1], e[2], e[3]]) } : {}) };
}

// 1.9 (L25): {art: intern, name: kit, kit}. The name rule always applies; with ctx.kitDa (the server injects a lookup into the kit folder) an unknown
// kit is refused here as kit_unbekannt, so Cypher gets the refusal at the command and not when the core refuses the playback.
export function baueKitGeraet(g: Args, ctx?: Kontext): Geraet {
  erlaube(g, 'art', 'name', 'kit');
  if (typeof g.kit !== 'string' || !KIT_NAME.test(g.kit)) ab('argument_ungueltig', 'geraet.kit: kit name expected ([a-z0-9_-], 1..32 characters)');
  if (ctx?.kitDa && !ctx.kitDa(g.kit)) ab('kit_unbekannt', `geraet.kit: no kit ${g.kit} in the kit folder`);
  return { art: 'intern', name: 'kit', kit: g.kit };
}

// 1.9 U5 (O28 on Surge): the sparse map of Surge display values. The shape rules are the model's; with ctx.surgeBereich (the server injects the
// ranges of surge_bereiche.json) an unknown name is argument_unbekannt and a value outside its range argument_ungueltig.
export function surgeParameter(x: unknown, ctx?: Kontext): { parameter?: Record<string, number> } {
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
export function baueGlied(p: Projekt, mx: unknown, wo: string, eigene: string | undefined, ctx?: Kontext, besetzt: Set<number> = new Set()): Glied {
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
export function baueRackGeraet(p: Projekt, g: Args, eigene: string | undefined, ctx?: Kontext): Geraet {
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
export function baueGeraet(p: Projekt, g: unknown, eigene?: string, ctx?: Kontext, besetzt?: Set<number>, spurId?: string): Geraet {
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
// The note fields of a command. teil = a change (fields may be absent; the optional ones chance, wdh, versatz may be null = remove them: listed in `weg`)
export const NOTEN_OPTIONAL = { chance: [1, 99], wdh: [2, 8], versatz: [-95, 95], spalte: [1, 8], platz: [1, 32] } as const;
// spalte 1 = absent: accepted, never stored; platz 1 is slot 1 and is stored
export function notenFelder(n: Args, wo: string, teil: boolean): { f: Partial<Note>; weg: ('chance' | 'wdh' | 'versatz' | 'spalte' | 'platz')[] } {
  const ausgabe: Partial<Note> = {}, weg: ('chance' | 'wdh' | 'versatz' | 'spalte' | 'platz')[] = [];
  const f = (k: 'beat' | 'laenge' | 'ton' | 'vel', min: number, max: number, o: { ganz?: boolean; offenUnten?: boolean }): void => {
    if (n[k] === undefined) { if (!teil) ab('argument_ungueltig', `${wo}.${k}: fehlt`); return; }
    if (!zahlOk(n[k]) || n[k] > max || (o.offenUnten ? n[k] <= min : n[k] < min) || (o.ganz && !Number.isInteger(n[k]))) {
      ab('argument_ungueltig', `${wo}.${k}: ungültig`);
    }
    ausgabe[k] = n[k];
  };
  f('beat', 0, MAX_BEAT, {}); f('laenge', 0, MAX_BEAT, { offenUnten: true }); f('ton', 0, 127, { ganz: true }); f('vel', 1, 127, { ganz: true });
  for (const k of ['chance', 'wdh', 'versatz', 'spalte', 'platz'] as const) {
    if (n[k] === undefined) continue;
    if (n[k] === null && teil) { weg.push(k); continue; }
    const [min, max] = NOTEN_OPTIONAL[k];
    if (!zahlOk(n[k]) || !Number.isInteger(n[k]) || n[k] < min || n[k] > max || (k === 'versatz' && n[k] === 0)) {
      ab('argument_ungueltig', `${wo}.${k}: whole number ${min}..${max}${k === 'versatz' ? ' without 0' : ''} expected${teil ? ' (null removes it)' : ''}`);
    }
    if (k === 'spalte' && n[k] === 1) { if (teil) weg.push(k); continue; }   // column 1 is the same as absent
    ausgabe[k] = n[k];
  }
  return { f: ausgabe, weg };
}
export function listeArg(a: Args, k: string): unknown[] {
  return Array.isArray(a[k]) && a[k].length >= 1 && a[k].length <= 65536 ? a[k] : ab('argument_ungueltig', `${k}: nicht leere Liste erwartet`);
}
// Linear in der Zahl der Noten: der Zähler wird einmal gelesen und danach hochgezählt, die Kollisionsprüfung läuft über ein Set.
// Spec 6.28/6.30: der Zähler gehört dem Projekt (einer für alle Clips). Eine ausdrücklich mitgegebene ID n<k> unter dem Zähler war schon einmal
// vergeben und ist id_belegt, auch wenn die Note inzwischen gelöscht ist; eine darüber hebt den Zähler. Eigene IDs (z. B. „kick“) zählen nicht.
// Spec 6.32 (Wortlaut von 6.31 berichtigt): unter dem Projekt-Zähler bleibt es bei id_belegt (6.30); ab 2^31 oder bei falscher Form gilt
// argument_ungueltig, damit eine ausdrückliche ID den Zähler nie über die Grenze des Modells hebt (vorher: n<MAX_SAFE-1> angenommen, danach
// scheiterte jede automatische Note an projekt_ungueltig).
export function fuegeNotenEin(p: Projekt, clip: MidiClip, roh: unknown[]): void {
  const vorhanden = new Set(clip.noten.map((n) => n.id));
  let naechste = notenZaehler(p);
  roh.forEach((r, i) => {
    if (!istObjekt(r)) ab('argument_ungueltig', `noten[${i}]: Objekt erwartet`);
    erlaube(r as Args, 'id', 'beat', 'laenge', 'ton', 'vel', 'chance', 'wdh', 'versatz', 'spalte', 'platz');
    const f = notenFelder(r as Args, `noten[${i}]`, false).f as Omit<Note, 'id'>;
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
    clip.noten.push({ id, beat: f.beat, laenge: f.laenge, ton: f.ton, vel: f.vel,
      ...(f.chance !== undefined ? { chance: f.chance } : {}), ...(f.wdh !== undefined ? { wdh: f.wdh } : {}),
        ...(f.versatz !== undefined ? { versatz: f.versatz } : {}), ...(f.spalte !== undefined ? { spalte: f.spalte } : {}),
        ...(f.platz !== undefined ? { platz: f.platz } : {}) });
  });
  p.naechste_noten_id = naechste;
}

// Internal note insert of the fan-out (ADR 039): the notes carry their ids, drawn once for all members of a pattern, so each member takes exactly
// these ids. Refuses only an id already in this clip, and (with `ab`, the project counter before the draw) an explicit id n<k> with k < ab, which was
// given out before; the ids of the draw lie at or above it. Raises the counter to cover the ids taken. A note without id is numbered as fuegeNotenEin does.
export function fuegeNotenEinMitIds(p: Projekt, clip: MidiClip, roh: unknown[], boden: number = 1): void {
  const vorhanden = new Set(clip.noten.map((n) => n.id));
  let naechste = notenZaehler(p);
  roh.forEach((r, i) => {
    if (!istObjekt(r)) ab('argument_ungueltig', `noten[${i}]: Objekt erwartet`);
    erlaube(r as Args, 'id', 'beat', 'laenge', 'ton', 'vel', 'chance', 'wdh', 'versatz', 'spalte', 'platz');
    const f = notenFelder(r as Args, `noten[${i}]`, false).f as Omit<Note, 'id'>;
    let id = (r as Args).id as string | undefined;
    if (id !== undefined && (typeof id !== 'string' || !NOTEN_ID.test(id))) ab('argument_ungueltig', `noten[${i}].id: ungültig`);
    if (id !== undefined) {
      const k = notenNummer(id);
      if (k !== null && k >= NOTEN_NR_GRENZE) ab('argument_ungueltig', `noten[${i}].id: Nummer unter 2^31 erwartet`);
      if (vorhanden.has(id) || (k !== null && k < boden)) ab('id_belegt', id);
      if (k !== null && k >= naechste) naechste = k + 1;
    } else {
      do { id = `n${naechste}`; naechste += 1; } while (vorhanden.has(id));
    }
    vorhanden.add(id);
    clip.noten.push({ id, beat: f.beat, laenge: f.laenge, ton: f.ton, vel: f.vel,
      ...(f.chance !== undefined ? { chance: f.chance } : {}), ...(f.wdh !== undefined ? { wdh: f.wdh } : {}),
        ...(f.versatz !== undefined ? { versatz: f.versatz } : {}), ...(f.spalte !== undefined ? { spalte: f.spalte } : {}),
        ...(f.platz !== undefined ? { platz: f.platz } : {}) });
  });
  p.naechste_noten_id = naechste;
}

// --- Einzelne Befehle (verändern den Entwurf `p`) ---------------------------------------------------------------------
export const MIXER = ['fader_db', 'pan', 'mute', 'solo'] as const;
// ctx.quelle: wer den Befehl gibt (der Verlauf reicht meta.quelle durch); spur_neu schreibt sie als von in die Spur (Spec 6.22)
// ctx.graphArt (Baukasten S20): lookup of a graph name in the graph folder, 'instrument' | 'effekt' | null (unknown); absent = name rule only
// ctx.kitDa (1.9, L25): does the kit folder hold a kit of this name; absent = name rule only
// ctx.presetLies (1.9, O28): reads a preset by id ("werk:rb338/dark-dub") from the preset store, null = no such preset; absent = preset_anwenden refuses
export interface PresetInhalt { geraet: string; werte: Record<string, unknown> }
export interface Kontext {
  quelle: Herkunft; graphArt?: (name: string) => 'instrument' | 'effekt' | null; kitDa?: (name: string) => boolean;
  presetLies?: (id: string) => PresetInhalt | null;
  // Kraken patch field: the labels and default pins of the matrix node of a graph, null = no such graph or no matrix node; absent = no lookup (a
  // first pin is refused kein_steckfeld)
  steckfeldVon?: (graph: string) => Steckfeld | null;
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
  // absolute project folder of the open project (absent in pure tests): commands that turn an absolute file path into a project-relative one
  ordner?: string;
  noteIdsAb?: number;   // fan-out of noten_neu (ADR 039): the notes carry drawn ids; the project note counter before the draw (see fuegeNotenEinMitIds)
}
export interface MusterMeldung {
  clip_id: string; spur_id: string; noten_zahl: number; takte: number; loop_beats: number | null;
  huellkurven: string[]; ohne_ziel: string[]; hinweise: string[];
}
export interface PluginEintrag {
  format: 'vst3' | 'lv2'; pfad: string; uid: string; name: string; art: string; status: string; grund?: string; klasse?: number;
  audio_ein?: number;   // strand 2 task 3.4: a host stage takes a key with 4 or more
}

export { laneHinweise };   // declared above without the modifier: the line would pass 160 characters

// --- Registry and merge (the handlers live in the family files; they call each other through PRO_BEFEHL at call time) -------------------
export type Handler = (p: Projekt, a: Args, ctx: Kontext) => void;
export const PRO_BEFEHL: Record<string, Handler> = {};
export function mergeTabellen(ziel: Record<string, Handler>, ...tabellen: Record<string, Handler>[]): Record<string, Handler> {
  for (const t of tabellen) {
    for (const k of Object.keys(t)) {
      if (Object.hasOwn(ziel, k)) throw new Error(`duplicate command: ${k}`);
      ziel[k] = t[k];
    }
  }
  return ziel;
}
