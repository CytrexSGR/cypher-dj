import { makroVon, sucheSpur, sucheStrang } from './model_ids.ts';
import {
  boolean, felder, istKettenZiel, istPluginZiel, istSendZiel, pluginZielVon, sendZielVon, text, zerlegeKettenZiel, zielBereichVon,
} from './model_check_parts.ts';
import {
  ID, MAX_MODULATOREN, MAX_MOD_FELDER, MAX_MOD_ZIELE, MOD_ABFALL_MAX, MOD_ABFALL_MIN, MOD_ANGRIFF_MAX, MOD_ANGRIFF_MIN,
  MOD_EMPFINDLICH_MAX, MOD_FELDER_NUR, MOD_FORMEN, MOD_GLATT_MAX, MOD_HZ_MAX, MOD_HZ_MIN, MOD_NAME_MAX, MOD_TAKT_MAX, MOD_TAKT_MIN,
  type ModZiel, type Modulator, type Projekt, ganz, istGeraetZiel, istObjekt, modTiefeBereich, passtGeraetZiel, zahl,
} from './model_types.ts';

// --- Strand 6: modulators (check, cleanup) -----------------------------------------------------------------------------
type ModAblehnung = { grund: string; text: string };
const MOD_FELDER_GEMEINSAM = ['id', 'nr', 'name', 'art', 'glatt_ms', 'an', 'ziele'];
const MOD_ZIEL_FELDER = ['strang_id', 'ziel', 'tiefe', 'polaritaet'];
// is `ziel` a target a modulator takes on the strip `strangId` (null = yes): fader and pan of a track, the fader of a return, a geraet.* parameter that
// the track's device carries, send.<return id> of a send the track has (the core takes send targets on tracks only), insert.<stage id>.<param> of a
// continuous parameter of a built-in stage and rack.m1..m4 on any strip that carries the stage or rack, plugin.<host stage id>.<index> of a host stage
// of the strip (task 4.2). A stage parameter a rack macro drives is refused (param_gemappt): the core refuses it, the macro is its one writer.
function modZielFehler(p: Projekt, strangId: string, ziel: string): ModAblehnung | null {
  const nein = (text: string): ModAblehnung => ({ grund: 'mod_ziel_unbekannt', text });
  const strang = sucheStrang(p, strangId);
  if (!strang) return nein(`${strangId} is no track, group, return or master of this project`);
  const spur = sucheSpur(p, strangId), ret = (p.returns ?? []).find((r) => r.id === strangId);
  if (!zielBereichVon(ziel, strang)) return nein(`${ziel} is no target of ${strangId}`);
  if (istPluginZiel(ziel)) return null;
  const k = istKettenZiel(ziel) ? zerlegeKettenZiel(ziel) : null;
  if (k && 'insert' in k) {
    const m = makroVon(strang, k.insert, k.param);
    return m ? { grund: 'param_gemappt', text: `${ziel} on ${strangId} is driven by macro ${m.nr} of the rack; modulate the macro (rack.m${m.nr})` } : null;
  }
  if (k) return null;
  if (istSendZiel(ziel)) return spur ? null : nein(`${ziel} on ${strangId}: only the send of a track is modulated`);
  if (ret) return ziel === 'fader' ? null : nein(`${ziel} on ${strangId}: a return takes fader, insert.* and rack.* only`);
  if (!spur) return nein(`${ziel} on ${strangId}: a group or the master takes insert.*, rack.* and plugin.* only`);
  if (ziel === 'fader' || ziel === 'pan') return null;
  if (istGeraetZiel(ziel)) {
    return spur.art === 'instrument' && passtGeraetZiel(ziel, spur.geraet) ? null
      : nein(`${ziel} on ${strangId}: only on a track whose device has that parameter (RB-338 lautstaerke, cutoff, resonanz, env_mod; bk k1 to k64)`);
  }
  return nein(`${ziel} on ${strangId}: a modulator takes fader, pan, geraet.*, send.*, insert.*, rack.* or plugin.*`);
}
/** check of one modulator against the project it sits in (model and commands share it): null = valid */
export function modulatorPruefung(x: unknown, p: Projekt): ModAblehnung | null {
  const ab = (grund: string, text: string): ModAblehnung => ({ grund, text });
  const ug = (text: string): ModAblehnung => ab('argument_ungueltig', text);
  const istZahl = (v: unknown, min: number, max: number): boolean => zahl(v) && v >= min && v <= max;
  if (!istObjekt(x)) return ug('modulator: object expected');
  if (x.art !== 'lfo' && x.art !== 'folger') return ug(`art: lfo | folger expected (got ${JSON.stringify(x.art)})`);
  const eigene: readonly string[] = MOD_FELDER_NUR[x.art];
  for (const k of Object.keys(x)) {
    if (!MOD_FELDER_GEMEINSAM.includes(k) && !eigene.includes(k)) return ab('argument_unbekannt', `modulator.${k} (not a field of ${x.art})`);
  }
  for (const k of ['id', 'nr', 'art', 'ziele']) if (!(k in x)) return ug(`modulator.${k}: missing`);
  if (typeof x.id !== 'string' || !ID.test(x.id)) return ug('id: id expected');
  if (!ganz(x.nr) || x.nr < 1 || x.nr > MAX_MODULATOREN) return ug(`nr: whole number 1..${MAX_MODULATOREN} expected`);
  if ('name' in x && !(typeof x.name === 'string' && x.name.trim().length >= 1 && x.name.length <= MOD_NAME_MAX)) {
    return ug(`name: text of 1 to ${MOD_NAME_MAX} characters expected`);
  }
  if ('form' in x && !(MOD_FORMEN as readonly unknown[]).includes(x.form)) return ug(`form: ${MOD_FORMEN.join(' | ')} expected`);
  if ('takt' in x && 'hz' in x) return ug('takt and hz: give one of them (beats per period or a free rate)');
  if ('takt' in x && !istZahl(x.takt, MOD_TAKT_MIN, MOD_TAKT_MAX)) return ug(`takt: beats per period 1/64..${MOD_TAKT_MAX} expected`);
  if ('hz' in x && !istZahl(x.hz, MOD_HZ_MIN, MOD_HZ_MAX)) return ug(`hz: ${MOD_HZ_MIN}..${MOD_HZ_MAX} expected`);
  // the core reads phase in [0, 1) (arr_playback.cpp): 1 is the position of 0, so it is refused rather than written twice
  if ('phase' in x && !(istZahl(x.phase, 0, 1) && (x.phase as number) < 1)) return ug('phase: 0 up to below 1 expected');
  if ('glatt_ms' in x && !istZahl(x.glatt_ms, 0, MOD_GLATT_MAX)) return ug(`glatt_ms: 0..${MOD_GLATT_MAX} expected`);
  if ('an' in x && x.an !== false) return ug('an: only false is written (absent = on)');
  if (x.art === 'folger') {
    // the source is a track id; a switched-off follower keeps the id of a deleted track (modulatorenBereinigen)
    if (typeof x.quelle !== 'string' || x.quelle === '') return ug('quelle: the id of the source track expected');
    if (x.an !== false && !sucheSpur(p, x.quelle)) return ab('spur_unbekannt', `quelle: ${x.quelle} is no track of this project`);
    if ('angriff_ms' in x && !istZahl(x.angriff_ms, MOD_ANGRIFF_MIN, MOD_ANGRIFF_MAX)) return ug(`angriff_ms: ${MOD_ANGRIFF_MIN}..${MOD_ANGRIFF_MAX} expected`);
    if ('abfall_ms' in x && !istZahl(x.abfall_ms, MOD_ABFALL_MIN, MOD_ABFALL_MAX)) return ug(`abfall_ms: ${MOD_ABFALL_MIN}..${MOD_ABFALL_MAX} expected`);
    if ('empfindlich_db' in x && !istZahl(x.empfindlich_db, -MOD_EMPFINDLICH_MAX, MOD_EMPFINDLICH_MAX)) {
      return ug(`empfindlich_db: -${MOD_EMPFINDLICH_MAX}..${MOD_EMPFINDLICH_MAX} expected`);
    }
  }
  if (!Array.isArray(x.ziele) || x.ziele.length < 1 || x.ziele.length > MAX_MOD_ZIELE) return ug(`ziele: list of 1 to ${MAX_MOD_ZIELE} targets expected`);
  const gesehen = new Set<string>();
  for (const [i, z] of (x.ziele as unknown[]).entries()) {
    const wo = `ziele[${i}]`;
    if (!istObjekt(z)) return ug(`${wo}: object expected`);
    for (const k of Object.keys(z)) if (!MOD_ZIEL_FELDER.includes(k)) return ab('argument_unbekannt', `${wo}.${k}`);
    if (typeof z.strang_id !== 'string' || z.strang_id === '') return ug(`${wo}.strang_id: id expected`);
    if (typeof z.ziel !== 'string' || z.ziel === '') return ug(`${wo}.ziel: target expected`);
    const f = modZielFehler(p, z.strang_id, z.ziel);
    if (f) return ab(f.grund, `${wo}: ${f.text}`);
    const [mn, mx] = modTiefeBereich(z.ziel)!;
    if (!istZahl(z.tiefe, mn, mx)) return ug(`${wo}.tiefe: ${mn}..${mx} expected for ${z.ziel}`);
    if ('polaritaet' in z && z.polaritaet !== 'uni') return ug(`${wo}.polaritaet: uni expected (absent = bipolar)`);
    const k = `${z.strang_id}/${z.ziel}`;
    if (gesehen.has(k)) return ug(`${wo}: ${z.strang_id} ${z.ziel} twice in one modulator`);
    // a follower does not move its own source track (fader, pan or device): another modulator may
    if (x.art === 'folger' && z.strang_id === x.quelle) return ug(`${wo}: ${z.strang_id} is the source track of this follower`);
    gesehen.add(k);
  }
  return null;
}
/** check of the whole list `modulatoren` (model and commands share it): null = valid */
export function modulatorenPruefung(x: unknown, p: Projekt): ModAblehnung | null {
  if (!Array.isArray(x) || x.length < 1) return { grund: 'argument_ungueltig', text: 'non-empty list expected (absent when there is no modulator)' };
  if (x.length > MAX_MODULATOREN) return { grund: 'mod_voll', text: `at most ${MAX_MODULATOREN} modulators per project` };
  const ids = new Set<string>(), nrs = new Set<number>(), felder = new Set<string>();
  for (const [i, m] of (x as unknown[]).entries()) {
    const f = modulatorPruefung(m, p);
    if (f) return { grund: f.grund, text: `[${i}] ${f.text}` };
    const mod = m as Modulator;
    if (ids.has(mod.id)) return { grund: 'argument_ungueltig', text: `[${i}].id: duplicate (${mod.id})` };
    if (nrs.has(mod.nr)) return { grund: 'argument_ungueltig', text: `[${i}].nr: duplicate (${mod.nr})` };
    ids.add(mod.id); nrs.add(mod.nr);
    for (const z of mod.ziele) if (z.ziel === 'fader' || z.ziel === 'pan') felder.add(`${z.strang_id}/${z.ziel}`);
  }
  if (felder.size > MAX_MOD_FELDER) {
    return { grund: 'zu_gross', text: `${felder.size} distinct fader and pan targets under modulation (at most ${MAX_MOD_FELDER} in the project)` };
  }
  return null;
}
// does the strip and the stage, host stage, return or rack a target names still exist (the target may be invalid for other reasons: the check says so)
function modZielLebt(p: Projekt, z: ModZiel): boolean {
  const strang = sucheStrang(p, z.strang_id);
  if (!strang) return false;
  const plugin = pluginZielVon(z.ziel);
  if (plugin) return (strang.inserts ?? []).some((x) => x.id === plugin.insert && x.art === 'host');
  if (istSendZiel(z.ziel)) return (p.returns ?? []).some((r) => r.id === sendZielVon(z.ziel));
  const k = istKettenZiel(z.ziel) ? zerlegeKettenZiel(z.ziel) : null;
  if (k && 'makro' in k) return strang.rack !== undefined;
  if (k) return (strang.inserts ?? []).some((x) => x.id === k.insert);
  return true;
}
/** Strand 6 cleanup after a strip or stage went: drop the targets on it, drop a modulator without targets, turn off a follower whose source track
 *  went (it is kept). Changes `p` itself (a command draft); new objects for every changed modulator. */
export function modulatorenBereinigen(p: Projekt): void {
  if (!p.modulatoren) return;
  const rest: Modulator[] = [];
  for (const m of p.modulatoren) {
    const ziele = m.ziele.filter((z) => modZielLebt(p, z));
    if (ziele.length === 0) continue;
    let n = ziele.length === m.ziele.length ? m : { ...m, ziele };
    if (n.quelle !== undefined && n.an !== false && !sucheSpur(p, n.quelle)) n = { ...n, an: false };
    rest.push(n);
  }
  if (rest.length) p.modulatoren = rest; else delete p.modulatoren;
}
/** the modulator `nachher` has and `vorher` has not (the answer of mod_neu: handlers return nothing, the caller compares) */
export function neuerModulator(vorher: Projekt, nachher: Projekt): { mod_id: string; nr: number } | null {
  const alt = new Set((vorher.modulatoren ?? []).map((m) => m.id));
  const m = (nachher.modulatoren ?? []).find((x) => !alt.has(x.id));
  return m ? { mod_id: m.id, nr: m.nr } : null;
}
