import { INSERT_ARTEN } from './insert_key.ts';
import { SKALEN, akkordSymbol, tonartFehler } from '../public/harmonie.js';
import { bkInsertAuffuellen, pruefeBkListe } from './modular.ts';
import { ersterUngueltigerSchluessel } from './routing_verdict.ts';
import { insertSpaeterAuffuellen } from './insert_spaeter.ts';
import { markerFehler } from './marker.ts';
import { metaFehler } from './abgabe_meta.ts';
import { pruefeStammbaum } from './sound_runde_contract.ts';
import { seqPruefung } from './seq.ts';
import { INTERNE_EINGAENGE } from '../../contract/streams.ts';
import { trackerPruefung } from './tracker.ts';
import { verbundPruefungSpur } from './verbund.ts';
import { werkbankPruefung } from './werkbank.ts';
import {
  alleInserts, alleRacks, alleStraenge, entferneLeereTakes, loopDeckGruppe, neueId, setzeFehlendeZaehler, uebernimmNotenZaehler,
} from './model_ids.ts';
import { modulatorenPruefung } from './model_modulator.ts';
import {
  Fehl, NEU_TRIM_MAX, NEU_TRIM_MIN, boolean, felder, kettenLanen, kettenLanen_, normalisiereLane, pruefeClip, pruefeFreeze, pruefeGeraet,
  pruefeInserts, pruefeLanen, pruefeRack, pruefeReturn, pruefeSends, pruefeTake, text, werfe, zahlIn,
} from './model_check_parts.ts';
import {
  ARP_MUSTER, ARP_RATEN, EQ_BAENDER, EQ_MAX, EQ_MIN, EXTERN_MODI, type EqBand, FADER_MAX, FADER_MIN, FARBE, FORMAT, FORMAT_ALT,
  FORMAT_ALT2, FX_NUMMERN, type FxNr, GRUPPE_MAX, type Gruppe, HARMONIE_MAX, ID, type Insert, type InsertPoolArt, LOOP_FARBEN,
  LOOP_RASTER_BEATS, LOOP_SPUREN, LOOP_ZELLEN, type Lane, MAX_AUTO_PUNKTE, MAX_BEAT, MAX_BK_SPUREN, MAX_CLIPS, MAX_GRUPPEN,
  MAX_KETTEN_LANEN, MAX_KIT_GERAETE, MAX_MAKRO_ZIELE, MAX_NOTEN, MAX_RACK_GERAETE, MAX_RETURNS, MAX_SPUREN, MAX_STROEME,
  MAX_TAKES_PRO_SPUR, type MidiStufe, PLAETZE, PLATZ_TYPEN, type Platz, type PlatzTyp, type Projekt, type Rack, type Return,
  type ReturnLoopdeck, SHA, SZENEN_SLOTS, SZENEN_ZEILEN, SZENE_NAME_MAX, SZENE_TAKTE_MAX, type Send, type Spur, TAKTART_ZAEHLER_MAX,
  TAKTART_ZAEHLER_MIN, TEMPO_MAX, TEMPO_MIN, VORZAEHLER_WERTE, type Zelle, type Ziel, ganz, gliedMakroParam, glieder, herkunft,
  istGliedZiel, istHalten, istObjekt, istRack, makroFaehig, taktartOk, wirtSlots, zahl, zellFehler,
} from './model_types.ts';

const SHA_HEX = /^[0-9a-f]{64}$/;
function loopRasterPruefen(x: unknown, wo: string): void {
  if (typeof x !== 'string' || !Object.hasOwn(LOOP_RASTER_BEATS, x)) werfe(wo, "'1/4', '1/2', '1', 'takt' or '4takte' expected");
}
// session settings: the global grid and exactly 8 scenes (row i+1 = entry i); ids unique
function pruefeSession(x: unknown): void {
  const o = felder(x, 'session', ['raster', 'szenen']);
  loopRasterPruefen(o.raster, 'session.raster');
  if (!Array.isArray(o.szenen) || o.szenen.length !== SZENEN_ZEILEN) werfe('session.szenen', `array of ${SZENEN_ZEILEN} scenes expected`);
  const ids = new Set<string>();
  (o.szenen as unknown[]).forEach((e, i) => {
    const wo = `session.szenen[${i}]`;
    const s = felder(e, wo, ['id', 'name', 'farbe'], ['bpm', 'takte', 'folge']);
    if (typeof s.id !== 'string' || !/^sz[1-9][0-9]{0,14}$/.test(s.id)) werfe(`${wo}.id`, 'sz<n> expected');
    if (ids.has(s.id)) werfe(`${wo}.id`, `duplicate (${s.id})`);
    ids.add(s.id);
    if (typeof s.name !== 'string' || s.name.length > SZENE_NAME_MAX) werfe(`${wo}.name`, `text 0..${SZENE_NAME_MAX} characters expected`);
    zahlIn(s.farbe, `${wo}.farbe`, 0, LOOP_FARBEN - 1, true);
    if ('bpm' in s) zahlIn(s.bpm, `${wo}.bpm`, TEMPO_MIN, TEMPO_MAX);
    if ('takte' in s) zahlIn(s.takte, `${wo}.takte`, 1, SZENE_TAKTE_MAX, true);
    if ('folge' in s) {
      const f = s.folge;
      if (f === 'loop' || f === 'weiter' || f === 'stopp') return;
      const sp = istObjekt(f) && Object.keys(f).length === 1 && 'sprung' in f ? f.sprung : undefined;
      if (!zahl(sp) || !ganz(sp) || sp < 1 || sp > SZENEN_ZEILEN) werfe(`${wo}.folge`, "'loop', 'weiter', 'stopp' or { sprung: 1..8 } expected");
    }
  });
}
// one cell of a loop deck track (the id is checked for uniqueness by pruefeAlles)
function pruefeZelle(x: unknown, wo: string): void {
  const o = felder(x, wo, ['id', 'name', 'farbe', 'art', 'sha256', 'gain_db'], ['beats', 'bpm', 'pfad_hinweis', 'raster', 'transponieren', 'rueckwaerts',
    'blende', 'scheiben', 'keylock', 'huellen']);
  if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${wo}.id`, 'ID erwartet');
  text(o.name, `${wo}.name`, 64);
  if ((o.name as string).trim() === '') werfe(`${wo}.name`, 'a cell name of spaces only is not a name');
  zahlIn(o.farbe, `${wo}.farbe`, 0, LOOP_FARBEN - 1, true);
  if (o.art !== 'loop' && o.art !== 'einmal') werfe(`${wo}.art`, "'loop' or 'einmal' expected");
  if (typeof o.sha256 !== 'string' || !SHA_HEX.test(o.sha256)) werfe(`${wo}.sha256`, '64 hex characters expected');
  zahlIn(o.gain_db, `${wo}.gain_db`, -60, 12);
  if (o.art === 'loop') {
    if (!('beats' in o)) werfe(`${wo}.beats`, 'fehlt (a loop cell needs beats)');
    if (!('bpm' in o)) werfe(`${wo}.bpm`, 'fehlt (a loop cell needs bpm)');
  }
  if ('beats' in o) {
    const b = zahlIn(o.beats, `${wo}.beats`, 0.25, 64);
    if (!ganz(b * 4)) werfe(`${wo}.beats`, 'a multiple of 0.25 expected');
  }
  if ('bpm' in o) zahlIn(o.bpm, `${wo}.bpm`, TEMPO_MIN, TEMPO_MAX);
  if ('raster' in o) loopRasterPruefen(o.raster, `${wo}.raster`);
  const zf = zellFehler(o as unknown as Zelle);
  if (zf) werfe(wo, `${zf.grund}: ${zf.text}`);
  if ('pfad_hinweis' in o) {
    const h = text(o.pfad_hinweis, `${wo}.pfad_hinweis`, 1024);
    if (h.startsWith('/') || h.includes('\\') || h.includes('\0') || h.split('/').some((t) => t === '..' || t === '')) {
      werfe(`${wo}.pfad_hinweis`, 'a relative path without .. expected');
    }
  }
}
function pruefeZellen(x: unknown, wo: string): void {
  if (!Array.isArray(x) || x.length !== LOOP_ZELLEN) werfe(wo, `array of ${LOOP_ZELLEN} entries expected`);
  (x as unknown[]).forEach((z, i) => {
    if (z === null) return;
    if (istObjekt(z) && 'halten' in z) {   // the slot { halten: true } and nothing else
      if (!istHalten(z)) werfe(`${wo}[${i}]`, 'the slot is exactly { halten: true }');
      return;
    }
    pruefeZelle(z, `${wo}[${i}]`);
  });
}

// the first field of a track that only a loop deck track may carry, or null
const deckFeld = (s: Spur): string | null => (['zellen', 'filter', 'eq', 'kill', 'fx'] as const).find((k) => s[k] !== undefined) ?? null;

// MIDI stage of a track (plan strand 7, 3.3): every rule names its field
export function pruefeMidiStufe(x: unknown, wo: string): MidiStufe {
  const o = felder(x, wo, [], ['aus', 'akkord', 'skala', 'arp', 'velocity', 'chance', 'saat']);
  if ('aus' in o && o.aus !== true) werfe(`${wo}.aus`, 'true expected (absent when the chain is on)');
  if ('akkord' in o) {
    const a = felder(o.akkord, `${wo}.akkord`, ['intervalle']);
    const iv = a.intervalle;
    if (!Array.isArray(iv) || iv.length < 1 || iv.length > 6) werfe(`${wo}.akkord.intervalle`, '1..6 entries expected');
    (iv as unknown[]).forEach((v, i) => { zahlIn(v, `${wo}.akkord.intervalle[${i}]`, -24, 24, true);
      if (v === 0) werfe(`${wo}.akkord.intervalle[${i}]`, 'not 0 expected'); });
    if (new Set(iv as unknown[]).size !== (iv as unknown[]).length) werfe(`${wo}.akkord.intervalle`, 'distinct entries expected');
  }
  if ('skala' in o) {
    if (istObjekt(o.skala) && 'quelle' in o.skala) {
      const k = felder(o.skala, `${wo}.skala`, ['quelle']);
      if (k.quelle !== 'projekt') werfe(`${wo}.skala.quelle`, "'projekt' expected");
    } else {
      const k = felder(o.skala, `${wo}.skala`, ['grundton', 'skala']);
      zahlIn(k.grundton, `${wo}.skala.grundton`, 0, 11, true);
      if (typeof k.skala !== 'string' || !Object.hasOwn(SKALEN, k.skala)) werfe(`${wo}.skala.skala`, `one of ${Object.keys(SKALEN).join(', ')} expected`);
    }
  }
  if ('arp' in o) {
    const a0 = istObjekt(o.arp) ? o.arp : werfe(`${wo}.arp`, 'Objekt erwartet');
    if (a0.sync !== true && a0.sync !== false) werfe(`${wo}.arp.sync`, 'true/false expected');
    const a = felder(a0, `${wo}.arp`, ['muster', 'sync', 'oktaven', 'gate', a0.sync ? 'rate' : 'hz']);
    if (!(ARP_MUSTER as readonly unknown[]).includes(a.muster)) werfe(`${wo}.arp.muster`, `one of ${ARP_MUSTER.join(', ')} expected`);
    if (a.sync) { if (typeof a.rate !== 'string' || !Object.hasOwn(ARP_RATEN, a.rate))
      werfe(`${wo}.arp.rate`, `one of ${Object.keys(ARP_RATEN).join(', ')} expected`); }
    else zahlIn(a.hz, `${wo}.arp.hz`, 0.5, 40);
    zahlIn(a.oktaven, `${wo}.arp.oktaven`, 1, 4, true);
    zahlIn(a.gate, `${wo}.arp.gate`, 0.05, 1);
  }
  if ('velocity' in o) {
    const v = felder(o.velocity, `${wo}.velocity`, ['kurve', 'zufall'], ['fest']);
    zahlIn(v.kurve, `${wo}.velocity.kurve`, -1, 1); zahlIn(v.zufall, `${wo}.velocity.zufall`, 0, 64, true);
    if ('fest' in v) zahlIn(v.fest, `${wo}.velocity.fest`, 1, 127, true);
  }
  if ('chance' in o) zahlIn(o.chance, `${wo}.chance`, 0, 100, true);
  if ('saat' in o) zahlIn(o.saat, `${wo}.saat`, 0, 4294967295, true);
  return o as MidiStufe;
}
export function midiStufeFehler(x: unknown): string | null {
  try { pruefeMidiStufe(x, 'midi'); return null; } catch (e) { if (e instanceof Fehl) return e.message; throw e; }
}

// Production harmony lane (plan strand 7, 5.1): {eintraege: [{beat, grundton, skala, akkord?}]}, sorted by beat, one entry per beat, 1..HARMONIE_MAX.
export function harmonieFehler(x: unknown): string | null {
  if (!istObjekt(x)) return 'harmonie: object {eintraege} expected';
  for (const k of Object.keys(x)) if (k !== 'eintraege') return `harmonie.${k}: unknown field`;
  const e = x.eintraege;
  if (!Array.isArray(e)) return 'harmonie.eintraege: list expected';
  if (e.length < 1) return 'harmonie.eintraege: not empty expected (absent when there is no lane)';
  if (e.length > HARMONIE_MAX) return `harmonie.eintraege: at most ${HARMONIE_MAX} entries`;
  let vorher = -Infinity;
  for (let i = 0; i < e.length; i += 1) {
    const wo = `harmonie.eintraege[${i}]`, z: unknown = e[i];
    if (!istObjekt(z)) return `${wo}: object expected`;
    for (const k of Object.keys(z)) if (!['beat', 'grundton', 'skala', 'akkord'].includes(k)) return `${wo}.${k}: unknown field`;
    if (typeof z.beat !== 'number' || !Number.isFinite(z.beat) || z.beat < 0 || z.beat > MAX_BEAT) return `${wo}.beat: number 0..${MAX_BEAT} expected`;
    if (z.beat <= vorher) return `${wo}.beat: ascending beats, one entry per beat expected`;
    vorher = z.beat;
    const f = tonartFehler({ grundton: z.grundton, skala: z.skala });
    if (f) return `${wo}.${f.replace(/^tonart\.?/, '')}`;
    if ('akkord' in z) {
      if (typeof z.akkord !== 'string') return `${wo}.akkord: chord symbol text expected`;
      try { akkordSymbol(z.akkord); } catch (err) { return `${wo}.akkord: ${(err as Error).message.replace(/^akkord:\s*/, '')}`; }
    }
  }
  return null;
}

function pruefeSpur(s: unknown, wo: string, warpErlaubt: boolean): Spur {
  if (!istObjekt(s)) return werfe(wo, 'Objekt erwartet');
  const basis = ['id', 'nr', 'name', 'farbe', 'art', 'fader_db', 'pan', 'mute', 'solo', 'clips'];
  if (s.art !== 'audio' && s.art !== 'instrument' && s.art !== 'strom') werfe(`${wo}.art`, 'audio, instrument or strom expected');
  const o = s.art === 'strom'
    ? felder(s, wo, [...basis, 'strom'], ['von', 'gruppe', 'ausgang', 'automation', 'sends', 'inserts', 'rack', 'filter', 'eq', 'kill', 'fx'])
    : s.art === 'audio'
    ? felder(s, wo, basis, ['von', 'gruppe', 'aufnahme', 'ausgang', 'automation', 'sends', 'inserts', 'rack', 'takes', 'zellen', 'filter', 'eq', 'kill', 'fx'])
    : felder(s, wo, [...basis, 'geraet'], ['freeze', 'von', 'gruppe', 'ausgang', 'automation', 'sends', 'inserts', 'rack',
      'aufnahme', 'stammbaum', 'takes', 'midi']);
  if (s.art === 'strom') {
    zahlIn(o.strom, `${wo}.strom`, 1, MAX_STROEME, true);
    if (!Array.isArray(o.clips) || o.clips.length > 0) werfe(`${wo}.clips`, 'a strom track has no clips');
    if (!('ausgang' in o)) werfe(`${wo}.ausgang`, 'a strom track sits inside the strudel group');
  }
  if ('zellen' in o) pruefeZellen(o.zellen, `${wo}.zellen`);
  if ('filter' in o) zahlIn(o.filter, `${wo}.filter`, -1, 1);
  if ('eq' in o) {
    const e = istObjekt(o.eq) ? o.eq : werfe(`${wo}.eq`, 'Objekt erwartet');
    for (const k of Object.keys(e)) {
      if (!EQ_BAENDER.includes(k as EqBand)) werfe(`${wo}.eq.${k}`, 'unknown band');
      zahlIn(e[k], `${wo}.eq.${k}`, EQ_MIN, EQ_MAX);
    }
  }
  if ('kill' in o) {
    const e = istObjekt(o.kill) ? o.kill : werfe(`${wo}.kill`, 'Objekt erwartet');
    for (const k of Object.keys(e)) {
      if (!EQ_BAENDER.includes(k as EqBand)) werfe(`${wo}.kill.${k}`, 'unknown band');
      if (e[k] !== true) werfe(`${wo}.kill.${k}`, 'true expected');
    }
  }
  if ('fx' in o) {
    const e = istObjekt(o.fx) ? o.fx : werfe(`${wo}.fx`, 'Objekt erwartet');
    for (const k of Object.keys(e)) {
      if (!FX_NUMMERN.includes(k as FxNr)) werfe(`${wo}.fx.${k}`, 'unknown FX (1, 2, 3)');
      boolean(e[k], `${wo}.fx.${k}`);
    }
  }
  if ('midi' in o) { if (!warpErlaubt) werfe(`${wo}.midi`, `unknown field (midi stages exist only from ${FORMAT} on)`); pruefeMidiStufe(o.midi, `${wo}.midi`); }
  if ('stammbaum' in o) { const f = pruefeStammbaum(o.stammbaum, `${wo}.stammbaum`); if (f.length) werfe(`${wo}.stammbaum`, f[0]); }
  if ('sends' in o) pruefeSends(o.sends, `${wo}.sends`, warpErlaubt);
  if ('inserts' in o) pruefeInserts(o.inserts, `${wo}.inserts`, warpErlaubt);
  if ('rack' in o) { if (!warpErlaubt) werfe(`${wo}.rack`, `unbekanntes Feld (Racks gibt es erst ab ${FORMAT})`); pruefeRack(o.rack, `${wo}.rack`); }
  if ('von' in o && o.von !== 'andreas' && o.von !== 'cypher') werfe(`${wo}.von`, 'andreas oder cypher erwartet');
  // ohne Leerzeichen am Rand, wie die Befehle (Review S2)
  if ('gruppe' in o && text(o.gruppe, `${wo}.gruppe`, GRUPPE_MAX).trim() !== o.gruppe) werfe(`${wo}.gruppe`, 'ohne Leerzeichen am Rand erwartet');
  if ('aufnahme' in o) {
    const a = felder(o.aufnahme, `${wo}.aufnahme`, ['scharf', 'eingang'], ['monitor']);
    boolean(a.scharf, `${wo}.aufnahme.scharf`);
    if ('monitor' in a && a.monitor !== 'aus' && a.monitor !== 'ein') werfe(`${wo}.aufnahme.monitor`, "'aus' or 'ein' expected (auto is written as no key)");
    if (a.eingang !== null) {
      if (o.art === 'instrument') {   // instrument tracks: only midi_ein_1
        const e = felder(a.eingang, `${wo}.aufnahme.eingang`, ['art']);
        if (e.art !== 'midi') werfe(`${wo}.aufnahme.eingang`, "{art: 'midi'} or null expected on an instrument track");
      } else {
        const e = istObjekt(a.eingang) ? a.eingang : werfe(`${wo}.aufnahme.eingang`, 'Objekt erwartet');
        if (e.art === 'extern') {
          felder(e, `${wo}.aufnahme.eingang`, ['art', 'paar', 'modus']);
          if (e.paar !== 1 && e.paar !== 2 && e.paar !== 3 && e.paar !== 4) werfe(`${wo}.aufnahme.eingang.paar`, '1, 2, 3 or 4 expected');
          if (!(EXTERN_MODI as readonly unknown[]).includes(e.modus)) werfe(`${wo}.aufnahme.eingang.modus`, 'stereo, links, rechts or summe expected');
        } else {
          felder(e, `${wo}.aufnahme.eingang`, ['art', 'name']);
          if (e.art !== 'intern' || !(INTERNE_EINGAENGE as readonly unknown[]).includes(e.name)) {
            werfe(`${wo}.aufnahme.eingang`, 'intern input of the table (erz/1..3, erz/5..7, pad/1..2), {art: extern, paar, modus} or null expected');
          }
        }
      }
    }
    if (a.scharf === true && a.eingang === null) werfe(`${wo}.aufnahme.scharf`, 'scharf braucht einen Eingang');
  }
  if ('ausgang' in o) {   // 1.10: master steht nie in der Datei
    const au = felder(o.ausgang, `${wo}.ausgang`, ['art', 'id']);
    if (au.art !== 'gruppe') werfe(`${wo}.ausgang.art`, 'gruppe erwartet (master steht nie in der Datei)');
    if (typeof au.id !== 'string' || !ID.test(au.id)) werfe(`${wo}.ausgang.id`, 'ID erwartet');
  }
  if ('automation' in o) {          // in /1 ist jedes automation-Feld unbekannt (wie warp)
    if (!warpErlaubt) werfe(`${wo}.automation`, `unbekanntes Feld (Automation gibt es erst ab ${FORMAT})`);
    pruefeLanen(o.automation, wo, o as { inserts?: Insert[]; rack?: Rack; sends?: Send[] }, o.art === 'instrument' ? o.geraet : undefined);
  }
  if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${wo}.id`, 'ID erwartet');
  zahlIn(o.nr, `${wo}.nr`, 1, MAX_SPUREN, true);
  text(o.name, `${wo}.name`, 80);
  if (typeof o.farbe !== 'string' || !FARBE.test(o.farbe)) werfe(`${wo}.farbe`, '#rrggbb erwartet');
  zahlIn(o.fader_db, `${wo}.fader_db`, FADER_MIN, FADER_MAX); zahlIn(o.pan, `${wo}.pan`, -1, 1);
  boolean(o.mute, `${wo}.mute`); boolean(o.solo, `${wo}.solo`);
  if (o.art === 'instrument') {
    const g = pruefeGeraet(o.geraet, `${wo}.geraet`, warpErlaubt);
    if (wirtSlots({ art: 'instrument', geraet: g }).length > 0) {      // 1.9 U7 T4: a rack with a Surge member freezes like a Surge track
      if (!('freeze' in o)) werfe(`${wo}.freeze`, 'fehlt (null oder Objekt)');
      if (o.freeze !== null) pruefeFreeze(o.freeze, `${wo}.freeze`);
    } else if ('freeze' in o) werfe(`${wo}.freeze`, 'nur bei Wirt-Geräten');
  }
  if (!Array.isArray(o.clips)) werfe(`${wo}.clips`, 'Liste erwartet');
  (o.clips as unknown[]).forEach((c, i) => pruefeClip(c, `${wo}.clips[${i}]`, o.art as string, warpErlaubt, o as { art: string; geraet?: unknown }));
  if ('takes' in o) {               // 1.14: like warp, /2 only; an empty list is valid on load (the load drops it)
    if (!warpErlaubt) werfe(`${wo}.takes`, `unknown field (takes exist only from ${FORMAT} on)`);
    if (!Array.isArray(o.takes)) werfe(`${wo}.takes`, 'list expected');
    if ((o.takes as unknown[]).length > MAX_TAKES_PRO_SPUR) werfe(`${wo}.takes`, `at most ${MAX_TAKES_PRO_SPUR} takes per track`);
    (o.takes as unknown[]).forEach((t, i) => pruefeTake(t, `${wo}.takes[${i}]`, warpErlaubt, o.art as string));
  }
  return o as unknown as Spur;
}

function pruefeModul(m: unknown, wo: string): void {
  const o = felder(m, wo, ['quelle_sha256', 'titel', 'fassung', 'basis_bpm', 'von_beat', 'laenge_beats', 'bpm', 'datum'],
    ['set', 'eins_beat', 'transponiert', 'kuenstler', 'tonart', 'id', 'quelle']);
  if ('quelle' in o && o.quelle !== 'mitschnitt') werfe(`${wo}.quelle`, "'mitschnitt' expected");
  if ('id' in o && (typeof o.id !== 'string' || !/^[0-9a-f]{16}$/.test(o.id))) werfe(`${wo}.id`, '16 hex characters expected');
  if ('transponiert' in o && (!ganz(o.transponiert) || o.transponiert < -12 || o.transponiert > 12 || o.transponiert === 0)) {
    werfe(`${wo}.transponiert`, 'integer -12..12 except 0 expected');
  }
  if ('eins_beat' in o) zahlIn(o.eins_beat, `${wo}.eins_beat`, -MAX_BEAT, MAX_BEAT);
  if (typeof o.quelle_sha256 !== 'string' || !SHA.test(o.quelle_sha256)) werfe(`${wo}.quelle_sha256`, 'sha256 (64 hex characters) expected');
  for (const k of ['titel', 'fassung', 'datum']) text(o[k], `${wo}.${k}`, 200);
  for (const k of ['kuenstler', 'tonart']) if (k in o) text(o[k], `${wo}.${k}`, 200);
  if ('set' in o) text(o.set, `${wo}.set`, 200);
  zahlIn(o.basis_bpm, `${wo}.basis_bpm`, 1, 1000); zahlIn(o.bpm, `${wo}.bpm`, 1, 1000);
  zahlIn(o.von_beat, `${wo}.von_beat`, 0, MAX_BEAT);
  if (!zahl(o.laenge_beats) || o.laenge_beats <= 0 || o.laenge_beats > MAX_BEAT) {
    werfe(`${wo}.laenge_beats`, `number above 0 up to ${MAX_BEAT} expected`);
  }
}

// The check of a module record as a message (null = fine), for the command modul_setzen
export function pruefeModulFehler(m: unknown): string | null {
  try { pruefeModul(m, 'modul'); return null; } catch (e) { if (e instanceof Fehl) return e.message; throw e; }
}

function pruefeGruppe(g: unknown, wo: string): Gruppe {
  const o = felder(g, wo, ['id', 'nr', 'name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'gefaltet'],
    ['sends', 'inserts', 'rack', 'automation', 'ausgang', 'modul', 'blend', 'neu_trim_db', 'seq', 'loopdeck', 'strudel']);
  if ('modul' in o) pruefeModul(o.modul, `${wo}.modul`);
  if ('strudel' in o) {
    felder(o.strudel, `${wo}.strudel`, []);
    for (const k of ['modul', 'seq', 'loopdeck']) if (k in o) werfe(`${wo}.strudel`,
      'a group holds a strudel marker, a loop deck, a module or a SEQ deck, not several');
    if ('ausgang' in o) werfe(`${wo}.strudel`, 'the strudel module sits on a top group, not on a nested one');
  }
  if ('loopdeck' in o) {
    const d = felder(o.loopdeck, `${wo}.loopdeck`, ['platz', 'raster']);
    if (d.platz !== 1 && d.platz !== 2) werfe(`${wo}.loopdeck.platz`, '1 or 2 expected');
    if (typeof d.raster !== 'string' || !Object.hasOwn(LOOP_RASTER_BEATS, d.raster)) {
      werfe(`${wo}.loopdeck.raster`, "'1/4', '1/2', '1', 'takt' or '4takte' expected");
    }
    if ('modul' in o) werfe(`${wo}.loopdeck`, 'a group holds a loop deck, a module or a SEQ deck, not several');
    if ('seq' in o) werfe(`${wo}.loopdeck`, 'a group holds a loop deck, a module or a SEQ deck, not several');
    if ('ausgang' in o) werfe(`${wo}.loopdeck`, 'a loop deck sits on a top group, not on a nested one');
  }
  if ('seq' in o) {
    const f = seqPruefung(o.seq);
    if (f) werfe(`${wo}.seq`, f.text);
    if ('modul' in o) werfe(`${wo}.seq`, 'a group holds a SEQ deck or a module, not both');
    if ('ausgang' in o) werfe(`${wo}.seq`, 'a SEQ deck sits on a top group, not on a nested one');
  }
  if ('blend' in o) zahlIn(o.blend, `${wo}.blend`, 0, 1);
  if ('neu_trim_db' in o) zahlIn(o.neu_trim_db, `${wo}.neu_trim_db`, NEU_TRIM_MIN, NEU_TRIM_MAX);
  if ('ausgang' in o) {   // master is never stored
    const au = felder(o.ausgang, `${wo}.ausgang`, ['art', 'id']);
    if (au.art !== 'gruppe') werfe(`${wo}.ausgang.art`, 'gruppe erwartet (master steht nie in der Datei)');
    if (typeof au.id !== 'string' || !ID.test(au.id)) werfe(`${wo}.ausgang.id`, 'ID erwartet');
  }
  if ('sends' in o) pruefeSends(o.sends, `${wo}.sends`, true);
  if ('inserts' in o) pruefeInserts(o.inserts, `${wo}.inserts`, true);
  if ('rack' in o) pruefeRack(o.rack, `${wo}.rack`);
  // after the chain and rack checks: it looks them up
  if ('automation' in o) pruefeLanen(o.automation, wo, o as { inserts?: Insert[]; rack?: Rack }, undefined, 'gruppe');
  if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${wo}.id`, 'ID erwartet');
  zahlIn(o.nr, `${wo}.nr`, 1, MAX_GRUPPEN, true);
  text(o.name, `${wo}.name`, 80);
  if (typeof o.farbe !== 'string' || !FARBE.test(o.farbe)) werfe(`${wo}.farbe`, '#rrggbb erwartet');
  zahlIn(o.fader_db, `${wo}.fader_db`, FADER_MIN, FADER_MAX); zahlIn(o.pan, `${wo}.pan`, -1, 1);
  boolean(o.mute, `${wo}.mute`); boolean(o.solo, `${wo}.solo`); boolean(o.gefaltet, `${wo}.gefaltet`);
  return o as unknown as Gruppe;
}

// Prüft ohne Kopie: null = gültig, sonst der Fehlertext. Der Befehlsweg braucht nur das Urteil (kein structuredClone des ganzen Projekts).
export function pruefeFehler(x: unknown): string | null {
  try {
    pruefeAlles(x);
    return null;
  } catch (e) {
    if (e instanceof Fehl) return e.message;
    throw e;
  }
}

// every insert stage of the project (tracks, groups, returns, master) that is a bk stage gets k9..k64 = 0.5 where the file had none
function bkInsertWerteAuffuellen(p: Projekt): void {
  for (const { strang } of alleStraenge(p)) {
    for (const i of strang.inserts ?? []) {
      if (i.art === 'bk') bkInsertAuffuellen(i.werte); else if (i.art !== 'host') insertSpaeterAuffuellen(i.art, i.werte);   // eq d1..d8, saett kurve/decke
    }
  }
}
// --- Upgrade /2 -> /3 -----------------------------------------------------------------------------------------------
const STANDARD_PLAETZE: readonly PlatzTyp[] = ['track', 'track', 'strudel', 'loops'];
const oberste = (gruppen: Gruppe[], id: string | undefined): Gruppe | undefined => {
  let g = gruppen.find((x) => x.id === id);
  for (let n = 0; g?.ausgang && n <= gruppen.length; n++) { const z = g.ausgang.id; g = gruppen.find((x) => x.id === z); }
  return g && !g.ausgang ? g : undefined;
};
/**
 * Lifts a /2 project to /3 in place (no rev step). The removed fields (seq.platz, loopdeck.ausgang_platz, modul.slot) are dropped; a live project
 * gets `plaetze` and `Return.gruppe` derived in this order, a place is claimed by the first claimant and a later claimant is parked, never dropped:
 * 1. a SEQ deck claims `seq.platz`; 2. a loop deck claims `ausgang_platz`, absent = deck 1 -> 3, deck 2 -> 4; 3. a module claims 3 for slot A and
 * 4 for slot B (no slot: parked); 4. unclaimed places take the default layout `track, track, strudel, loops` where that type is free (strudel
 * once, creating the empty STRUDEL group; loops only while no loops place exists, filled by a parked loop deck, else track); 5. return owners.
 * A production project only changes its format string.
 */
export function hebeAufDrei(p: Projekt): void {
  (p as unknown as { format: string }).format = FORMAT;
  const gruppen = p.gruppen ?? [];
  // read the removed fields first, then drop them
  const alt = new Map<string, { seq?: number; ort?: number; slot?: 'A' | 'B' }>();
  for (const g of gruppen) {
    const e: { seq?: number; ort?: number; slot?: 'A' | 'B' } = {};
    if (istObjekt(g.seq)) { e.seq = (g.seq as { platz?: number }).platz; delete (g.seq as { platz?: number }).platz; }
    if (istObjekt(g.loopdeck)) { e.ort = (g.loopdeck as { ausgang_platz?: number }).ausgang_platz;
      delete (g.loopdeck as { ausgang_platz?: number }).ausgang_platz; }
    if (istObjekt(g.modul)) { e.slot = (g.modul as { slot?: 'A' | 'B' }).slot; delete (g.modul as { slot?: string }).slot; }
    alt.set(g.id, e);
  }
  if (p.live !== true) return;
  const spitzen = gruppen.filter((g) => !g.ausgang);
  const plaetze: (Platz | null)[] = [null, null, null, null];
  const belege = (i: number | undefined, platz: Platz): boolean => {
    if (i === undefined || !Number.isInteger(i) || i < 1 || i > PLAETZE || plaetze[i - 1] !== null) return false;
    plaetze[i - 1] = platz; return true;
  };
  for (const g of spitzen) if (g.seq) belege(alt.get(g.id)?.seq, { typ: 'seq', gruppe: g.id });
  for (const g of spitzen) if (g.loopdeck) belege(alt.get(g.id)?.ort ?? (g.loopdeck.platz === 1 ? 3 : 4), { typ: 'loops', gruppe: g.id });
  for (const g of spitzen) if (g.modul) { const s = alt.get(g.id)?.slot; belege(s === 'A' ? 3 : s === 'B' ? 4 : undefined, { typ: 'stems', gruppe: g.id }); }
  const belegt = (g: Gruppe): boolean => plaetze.some((e) => e !== null && 'gruppe' in e && e.gruppe === g.id);
  const hatStrudel = (): boolean => gruppen.some((g) => g.strudel) || plaetze.some((e) => e?.typ === 'strudel');
  for (let i = 0; i < PLAETZE; i++) {
    if (plaetze[i] !== null) continue;
    const wunsch = STANDARD_PLAETZE[i];
    if (wunsch === 'strudel' && !hatStrudel() && gruppen.length < MAX_GRUPPEN) {
      const nrs = new Set(gruppen.map((g) => g.nr));
      let nr = 1; while (nrs.has(nr)) nr++;
      const id = neueId(p, 'gruppe');
      gruppen.push({ id, nr, name: 'STRUDEL', farbe: '#8a8f98', fader_db: 0, pan: 0, mute: false, solo: false, gefaltet: false, strudel: {} });
      plaetze[i] = { typ: 'strudel', gruppe: id };
    } else if (wunsch === 'loops' && !plaetze.some((e) => e?.typ === 'loops')) {
      const frei = spitzen.filter((g) => g.loopdeck && !belegt(g)).sort((a, b) => a.loopdeck!.platz - b.loopdeck!.platz)[0];
      plaetze[i] = frei ? { typ: 'loops', gruppe: frei.id } : { typ: 'track' };
    } else plaetze[i] = { typ: 'track' };
  }
  p.gruppen = gruppen;
  p.plaetze = plaetze as [Platz, Platz, Platz, Platz];
  // return owners
  const returns = p.returns ?? [];
  if (!returns.length) return;
  const strudel = gruppen.find((g) => g.strudel);
  const platz1 = (p.plaetze[0] as { gruppe?: string }).gruppe;
  const standard = gruppen.find((g) => g.id === platz1) ?? strudel ?? [...spitzen].sort((a, b) => a.nr - b.nr)[0];
  const behalten: Return[] = [];
  const neue: Return[] = [];
  for (const r of returns) {
    if (r.loopdeck && !loopDeckGruppe(p, r.loopdeck.platz)) delete r.loopdeck;
    if (r.loopdeck) { r.gruppe = loopDeckGruppe(p, r.loopdeck.platz)!.id; behalten.push(r); continue; }
    const sender: string[] = [];   // top groups that send into the return, in group order
    const spitze = (id: string | undefined): string | undefined => oberste(gruppen, id)?.id;
    const sendet = new Set<string>();
    for (const s of p.spuren) if ((s.sends ?? []).some((x) => x.id === r.id)) { const o = spitze(s.ausgang?.id); if (o) sendet.add(o); }
    for (const g of gruppen) if ((g.sends ?? []).some((x) => x.id === r.id)) { const o = spitze(g.id); if (o) sendet.add(o); }
    for (const g of spitzen) if (sendet.has(g.id)) sender.push(g.id);
    if (sender.length === 0) {
      if (!r.inserts?.length && !r.rack || !standard) continue;   // nothing hears it and it holds nothing: dropped
      r.gruppe = standard.id; behalten.push(r); continue;
    }
    r.gruppe = sender[0]; behalten.push(r);
    for (const gid of sender.slice(1)) {
      const kopieR = structuredClone(r) as Return;
      delete kopieR.inserts; delete kopieR.rack; delete kopieR.automation;
      kopieR.id = ''; kopieR.gruppe = gid;
      kopieR.name = `${r.name} ${gruppen.find((g) => g.id === gid)!.name}`.slice(0, 80);
      neue.push(Object.assign(kopieR, { __von: r.id }) as Return);
    }
  }
  p.returns = behalten;
  if (behalten.length + neue.length > MAX_RETURNS) throw new Fehl('returns: returns_voll (the upgrade needs more than ' + MAX_RETURNS + ' returns)');
  for (const n of neue) {
    const von = (n as unknown as { __von: string }).__von;
    delete (n as unknown as { __von?: string }).__von;
    n.id = neueId({ ...p, returns: p.returns } as Projekt, 'return');
    p.naechste_id = { ...p.naechste_id, return: Number(n.id.slice(1)) + 1 };
    const nrs = new Set(p.returns!.map((q) => q.nr));
    let nr = 1; while (nrs.has(nr)) nr++;
    n.nr = nr;
    p.returns!.push(n);
    const umlenken = (x: { sends?: Send[] }): void => { for (const sd of x.sends ?? []) if (sd.id === von) sd.id = n.id; };
    for (const s of p.spuren) if (oberste(gruppen, s.ausgang?.id)?.id === n.gruppe) umlenken(s);
    for (const g of gruppen) if (oberste(gruppen, g.id)?.id === n.gruppe) umlenken(g);
  }
  if (neue.length) p.returns.sort((a, b) => a.nr - b.nr);
}

export function pruefeProjekt(x: unknown): { projekt: Projekt } | { fehler: string } {
  const fehler = pruefeFehler(x);
  if (fehler !== null) return { fehler };
  const p = structuredClone(x) as Projekt;
  // 1.10 (P3): /1 → /2, kein rev-Schritt. Paket 1.13: ein /1-Projekt hat keinen Warp (die Prüfung lehnt ihn dort ab), die Hebung setzt keinen
  if ((p as { format: string }).format === FORMAT_ALT) { p.format = FORMAT; p.gruppen = []; p.master = { fader_db: 0 }; }
  if ((p as { format: string }).format === FORMAT_ALT2) hebeAufDrei(p);   // container core: /2 -> /3, places derived, no rev step
  for (const s of p.spuren) for (const l of s.automation ?? []) normalisiereLane(l);   // slice 2 (E2): mute/solo points without form are sprung
  bkInsertWerteAuffuellen(p);                                                        // a bk stage of an older project: k9..k64 = 0.5
  for (const s of p.spuren) s.von = herkunft(s);                                     // Spec 6.22: fehlt von (älteres Projekt), gilt andreas
  uebernimmNotenZaehler(p);                                                          // Spec 6.28: alte Clip-Zähler ins Projekt
  entferneLeereTakes(p);                                                             // 1.14: an empty takes list is not written
  setzeFehlendeZaehler(p);                                                           // Spec 6.35: fehlende Zähler schon beim Öffnen
  return { projekt: p };
}

function pruefeSzenen(x: unknown): void {
  if (!Array.isArray(x) || x.length !== SZENEN_SLOTS) werfe('szenen', `array of ${SZENEN_SLOTS} entries expected`);
  (x as unknown[]).forEach((e, i) => {
    if (e === null) return;
    const o = felder(e, `szenen[${i}]`, ['an', 'aus']);
    for (const k of ['an', 'aus']) {
      const l = o[k];
      if (!Array.isArray(l) || l.some((id) => typeof id !== 'string' || id === '')) werfe(`szenen[${i}].${k}`, 'list of ids expected');
    }
  });
}

function pruefeAlles(x: unknown): void {
  // Format zuerst (Prüfung 2, C1): ein fremdes Format, auch eines mit gruppen und master, ist der Fehler „format“
  // und scheitert nicht an „unbekanntes Feld“.
  // Ein fehlendes Format bleibt Sache von `felder` („projekt.format: fehlt“).
  if (istObjekt(x) && 'format' in x && x.format !== FORMAT && x.format !== FORMAT_ALT2 && x.format !== FORMAT_ALT) {
    werfe('format', `${FORMAT}, ${FORMAT_ALT2} or ${FORMAT_ALT} expected`);
  }
  // a /2 file is checked as its lift: the /3 rules applied to a copy that hebeAufDrei changed (a /2 file never holds plaetze)
  if (istObjekt(x) && x.format === FORMAT_ALT2) {
    if ('plaetze' in x) werfe('plaetze', `unknown field (places exist only from ${FORMAT} on)`);
    const k = structuredClone(x) as unknown as Projekt;
    try { hebeAufDrei(k); } catch (e) {
      if (e instanceof Fehl) throw e;
      k.format = FORMAT;   // malformed input: let the /3 check name the problem
    }
    return pruefeAlles(k);
  }
  const neu2 = istObjekt(x) && x.format === FORMAT;   // /2 verlangt gruppen und master, /1 hat sie nicht
  const pflicht = ['format', 'name', 'rev', 'wiedergabe_rev', 'tempo_bpm', 'taktart', 'loop', 'metronom', 'spuren', ...(neu2 ? ['gruppen', 'master'] : [])];
  // returns, baukasten in /1: unknown field
  const nur2 = ['returns', 'baukasten', 'aufnahme', 'live', 'werkbank', 'tracker', 'tonart',
    'harmonie', 'abgabe_meta', 'marker', 'szenen', 'plaetze', 'session',
    'modulatoren'];
  const o = felder(x, 'projekt', pflicht, ['naechste_id', 'naechste_noten_id', ...(neu2 ? nur2 : [])]);
  if ('szenen' in o) pruefeSzenen(o.szenen);
  if ('session' in o) {
    if (o.live !== true) werfe('session', 'unknown field (the session settings exist only in the live container)');
    pruefeSession(o.session);
  }
  const tf = 'tonart' in o ? tonartFehler(o.tonart) : null;
  if (tf) werfe('tonart', tf.replace(/^tonart[.:]?\s*/, ''));
  const hf = 'harmonie' in o ? harmonieFehler(o.harmonie) : null;
  if (hf) throw new Fehl(hf);
  const mf = 'abgabe_meta' in o ? metaFehler(o.abgabe_meta) : null;
  if (mf) throw new Fehl(mf);
  if ('marker' in o) {
    const f = markerFehler(o.marker, MAX_BEAT);
    if (f) throw new Fehl(f);
    if (o.live === true) werfe('marker', 'unknown field (the live container has no markers)');
  }
  if ('live' in o && o.live !== true) werfe('live', 'true expected (absent when not a live container)');
  if ('plaetze' in o && o.live !== true) werfe('plaetze', 'unknown field (places exist only in the live container)');
  if (o.live === true && !('plaetze' in o)) werfe('plaetze', 'fehlt (a live project holds its four places)');
  if ('werkbank' in o) {
    const w = werkbankPruefung(o.werkbank);
    if (w) werfe('werkbank', w.text);
    if ('live' in o) werfe('werkbank', 'a workbench module is never the live container');
  }
  if ('tracker' in o) {
    const t = trackerPruefung(o.tracker);
    if (t) werfe('tracker', t.text);
    if ('live' in o) werfe('tracker', 'the live container has no tracker view');
    if ('werkbank' in o) werfe('tracker', 'a workbench module has no tracker view');
  }
  if ('naechste_noten_id' in o) zahlIn(o.naechste_noten_id, 'naechste_noten_id', 1, Number.MAX_SAFE_INTEGER, true);
  if ('naechste_id' in o) {
    const zaehler = ['spur', 'clip', 'gruppe', 'lane', 'return', 'insert', 'take', 'verbund', 'zelle', 'szene', 'marker', 'mod'];
    const z = felder(o.naechste_id, 'naechste_id', [], zaehler);
    for (const k of zaehler) {
      if (k in z) zahlIn(z[k], `naechste_id.${k}`, 1, Number.MAX_SAFE_INTEGER, true);
    }
  }
  text(o.name, 'name', 80);
  zahlIn(o.rev, 'rev', 0, Number.MAX_SAFE_INTEGER, true); zahlIn(o.wiedergabe_rev, 'wiedergabe_rev', 0, Number.MAX_SAFE_INTEGER, true);
  zahlIn(o.tempo_bpm, 'tempo_bpm', TEMPO_MIN, TEMPO_MAX);
  if (!taktartOk(o.taktart)) werfe('taktart', `[n, 4] with n = ${TAKTART_ZAEHLER_MIN}..${TAKTART_ZAEHLER_MAX} expected`);
  const l = felder(o.loop, 'loop', ['an', 'von_beat', 'bis_beat']);
  boolean(l.an, 'loop.an'); zahlIn(l.von_beat, 'loop.von_beat', 0, MAX_BEAT); zahlIn(l.bis_beat, 'loop.bis_beat', 0, MAX_BEAT);
  if ((l.bis_beat as number) - (l.von_beat as number) < 1) werfe('loop', 'bis_beat − von_beat muss mindestens 1 sein');
  const m = felder(o.metronom, 'metronom', ['an', 'pegel_db', 'ziel']);
  boolean(m.an, 'metronom.an'); zahlIn(m.pegel_db, 'metronom.pegel_db', -60, 0);
  if (m.ziel !== 'master' && m.ziel !== 'cue') werfe('metronom.ziel', 'master oder cue erwartet');
  if ('aufnahme' in o) {   // 1.8 S0 (D17): all keys once the field exists; counts 0, 1, 2, 4 (the page choice, spec 4.5)
    const au = felder(o.aufnahme, 'aufnahme', ['vorzaehler_takte', 'punch', 'overdub']);
    if (!(VORZAEHLER_WERTE as readonly unknown[]).includes(au.vorzaehler_takte)) werfe('aufnahme.vorzaehler_takte', '0, 1, 2 or 4 expected');
    boolean(au.overdub, 'aufnahme.overdub');
    const pu = felder(au.punch, 'aufnahme.punch', ['ein', 'aus', 'von_beat', 'bis_beat']);
    boolean(pu.ein, 'aufnahme.punch.ein'); boolean(pu.aus, 'aufnahme.punch.aus');
    zahlIn(pu.von_beat, 'aufnahme.punch.von_beat', 0, MAX_BEAT); zahlIn(pu.bis_beat, 'aufnahme.punch.bis_beat', 0, MAX_BEAT);
    if ((pu.bis_beat as number) <= (pu.von_beat as number)) werfe('aufnahme.punch', 'bis_beat muss größer als von_beat sein');
  }
  if (!Array.isArray(o.spuren)) werfe('spuren', 'Liste erwartet');
  if ((o.spuren as unknown[]).length > MAX_SPUREN) werfe('spuren', `höchstens ${MAX_SPUREN}`);
  const refs: [number, string][] = [];
  const takeIds = new Set<string>();
  const spurIds = new Set<string>(), nrs = new Set<number>(), clipIds = new Set<string>(), slots = new Set<number>();
  let clips = 0, noten = 0, autoPunkte = 0, bkSpuren = 0, kitGeraete = 0, racks = 0;
  const laneIds = new Set<string>();
  // lane IDs are unique over the whole project (every strip: track, group, return, master); the points of all lanes count against MAX_AUTO_PUNKTE
  const laneZaehle = (st: { automation?: Lane[] }, wo: string): void => (st.automation ?? []).forEach((l, k) => {
    if (laneIds.has(l.id)) werfe(`${wo}.automation[${k}].id`, `doppelt (${l.id})`);
    laneIds.add(l.id); autoPunkte += l.punkte.length;
  });
  (o.spuren as unknown[]).forEach((sx, i) => {
    const s = pruefeSpur(sx, `spuren[${i}]`, neu2);   // Paket 1.13: warp nur in /2
    if (!neu2 && s.ausgang) werfe(`spuren[${i}].ausgang`, 'gibt es erst in /2');
    if (s.ausgang) refs.push([i, s.ausgang.id]);
    if (spurIds.has(s.id)) werfe(`spuren[${i}].id`, `doppelt (${s.id})`);
    if (nrs.has(s.nr)) werfe(`spuren[${i}].nr`, `doppelt (${s.nr})`);
    spurIds.add(s.id); nrs.add(s.nr);
    laneZaehle(s, `spuren[${i}]`);
    // 1.9 U7: the kit and bk limits count tracks plus rack members (the core counts every device it builds); racks have their own limit
    if (istRack(s) && ++racks > MAX_RACK_GERAETE) werfe('spuren', `at most ${MAX_RACK_GERAETE} rack devices`);
    for (const d of [s.geraet, ...glieder(s).map((m) => m.geraet)]) {
      if (d?.art === 'intern' && d.name === 'bk' && ++bkSpuren > MAX_BK_SPUREN) werfe('spuren', `at most ${MAX_BK_SPUREN} Cypher Modular tracks (bk)`);
      if (d?.art === 'intern' && d.name === 'kit' && ++kitGeraete > MAX_KIT_GERAETE) werfe('spuren', `at most ${MAX_KIT_GERAETE} kit devices`);
    }
    const wirtAn = (slot: number, wo: string): void => {      // one slot, one Surge: over tracks and rack members
      if (slots.has(slot)) werfe(`spuren[${i}].${wo}.slot`, `doppelt (${slot})`);
      slots.add(slot);
    };
    if (s.geraet?.art === 'wirt') wirtAn(s.geraet.slot, 'geraet');
    glieder(s).forEach((m, k) => { if (m.geraet.art === 'wirt') wirtAn(m.geraet.slot, `geraet.glieder[${k}].geraet`); });
    s.clips.forEach((c, k) => {
      if (clipIds.has(c.id)) werfe(`spuren[${i}].clips[${k}].id`, `doppelt (${c.id})`);
      clipIds.add(c.id); clips++; if (c.art === 'midi') noten += c.noten.length;
    });
    const vf = verbundPruefungSpur(s);                       // tracker patterns: the members of one pattern on this track must be equal
    if (vf) werfe(`spuren[${i}].clips`, vf.text);
    (s.takes ?? []).forEach((t, k) => {                      // 1.14: take ids and take clip ids are project wide, take clips count against MAX_CLIPS
      if (takeIds.has(t.id)) werfe(`spuren[${i}].takes[${k}].id`, `duplicate (${t.id})`);
      takeIds.add(t.id);
      t.clips.forEach((c, m) => {
        if (clipIds.has(c.id)) werfe(`spuren[${i}].takes[${k}].clips[${m}].id`, `duplicate (${c.id})`);
        clipIds.add(c.id); clips++;
      });
    });
  });
  const gruppenIds = new Set<string>(), gruppenNrs = new Set<number>(), deckPlaetze = new Set<number>();
  if (neu2) {
    if (!Array.isArray(o.gruppen)) werfe('gruppen', 'Liste erwartet');
    if ((o.gruppen as unknown[]).length > MAX_GRUPPEN) werfe('gruppen', `höchstens ${MAX_GRUPPEN}`);
    (o.gruppen as unknown[]).forEach((gx, i) => {
      const g = pruefeGruppe(gx, `gruppen[${i}]`);
      if (gruppenIds.has(g.id)) werfe(`gruppen[${i}].id`, `doppelt (${g.id})`);
      if (gruppenNrs.has(g.nr)) werfe(`gruppen[${i}].nr`, `doppelt (${g.nr})`);
      gruppenIds.add(g.id); gruppenNrs.add(g.nr);
      laneZaehle(g, `gruppen[${i}]`);
      // the patterns are the tracks that output into the group
      if (g.seq && o.live !== true) werfe(`gruppen[${i}].seq`, 'a SEQ deck exists only in the live container');
      if (g.strudel && o.live !== true) werfe(`gruppen[${i}].strudel`, 'the strudel module exists only in the live container');
      if (g.strudel && (o.gruppen as unknown[]).slice(0, i).some((m) => (m as Gruppe).strudel)) werfe(`gruppen[${i}].strudel`,
        'strudel is unique: the project has one strudel group');
      if (g.loopdeck) {   // loop deck: live container only, one group per deck identity
        if (o.live !== true) werfe(`gruppen[${i}].loopdeck`, 'a loop deck exists only in the live container');
        if (deckPlaetze.has(g.loopdeck.platz)) werfe(`gruppen[${i}].loopdeck.platz`,
          `duplicate (${g.loopdeck.platz}): the project already holds this loop deck`);
        deckPlaetze.add(g.loopdeck.platz);
      }
    });
    // group targets: a known group, not itself, and the tree has no cycle
    const ziel = new Map<string, string>();
    (o.gruppen as Gruppe[]).forEach((g, i) => {
      if (!g.ausgang) return;
      if (!gruppenIds.has(g.ausgang.id)) werfe(`gruppen[${i}].ausgang.id`, `unbekannte Gruppe ${g.ausgang.id}`);
      if (g.ausgang.id === g.id) werfe(`gruppen[${i}].ausgang.id`, 'Zyklus: eine Gruppe kann nicht in sich selbst spielen (cycle)');
      ziel.set(g.id, g.ausgang.id);
    });
    (o.gruppen as Gruppe[]).forEach((g, i) => {
      for (let x = g.id, n = 0; ziel.has(x); x = ziel.get(x)!) {
        if (++n > ziel.size) werfe(`gruppen[${i}].ausgang`, 'Zyklus: die Gruppen bilden einen Kreis (cycle)');
      }
    });
    const ms = felder(o.master, 'master', ['fader_db'], ['inserts', 'rack', 'automation']);
    zahlIn(ms.fader_db, 'master.fader_db', FADER_MIN, FADER_MAX);
    if ('inserts' in ms) pruefeInserts(ms.inserts, 'master.inserts', true);
    if ('rack' in ms) pruefeRack(ms.rack, 'master.rack');
    if ('automation' in ms) pruefeLanen(ms.automation, 'master', ms as { inserts?: Insert[]; rack?: Rack }, undefined, 'master');
    laneZaehle(ms as { automation?: Lane[] }, 'master');
  }
  // loop deck: 4 audio member tracks without clips; cells and filter only on those tracks; cell ids unique over the project
  if (neu2) {
    (o.gruppen as Gruppe[]).forEach((g, i) => {
      if (!g.loopdeck) return;
      const mitglieder = (o.spuren as Spur[]).filter((s) => s.ausgang?.id === g.id);
      if (mitglieder.length !== LOOP_SPUREN || (o.gruppen as Gruppe[]).some((m) => m.ausgang?.id === g.id)) {
        werfe(`gruppen[${i}].loopdeck`, `a loop deck group has exactly ${LOOP_SPUREN} member tracks and no nested group`);
      }
      for (const s of mitglieder) {
        if (s.art !== 'audio') werfe(`gruppen[${i}].loopdeck`, `track ${s.id} is not an audio track`);
        if (s.clips.length > 0) werfe(`gruppen[${i}].loopdeck`, `track ${s.id} has clips: a loop deck track holds cells only`);
      }
    });
    const deckGruppen = new Set((o.gruppen as Gruppe[]).filter((g) => g.loopdeck).map((g) => g.id));
    (o.spuren as Spur[]).forEach((s, i) => {
      if (deckFeld(s) !== null && s.art !== 'strom' && !(s.ausgang && deckGruppen.has(s.ausgang.id))) {
        werfe(`spuren[${i}].${deckFeld(s)}`, 'only on a track of a loop deck group');
      }
    });
  } else {
    (o.spuren as Spur[]).forEach((s, i) => { if (deckFeld(s) !== null && s.art !== 'strom') werfe(`spuren[${i}].zellen`,
      'only on a track of a loop deck group'); });
  }
  const zellenIds = new Set<string>();
  (o.spuren as Spur[]).forEach((s, i) => (s.zellen ?? []).forEach((z, k) => {
    if (!z || istHalten(z)) return;
    if (zellenIds.has(z.id)) werfe(`spuren[${i}].zellen[${k}].id`, `duplicate (${z.id})`);
    zellenIds.add(z.id);
  }));
  for (const [i, id] of refs) if (!gruppenIds.has(id)) werfe(`spuren[${i}].ausgang.id`, `unbekannte Gruppe ${id}`);
  // 1.10 slice 3: returns and the references of the sends
  const returnIds = new Set<string>(), returnNrs = new Set<number>();
  if ('returns' in o) {
    if (!Array.isArray(o.returns) || o.returns.length < 1) werfe('returns', 'nicht leere Liste erwartet (fehlt bei keinem Return)');
    if ((o.returns as unknown[]).length > MAX_RETURNS) werfe('returns', `höchstens ${MAX_RETURNS}`);
    (o.returns as unknown[]).forEach((rx, i) => {
      const r = pruefeReturn(rx, `returns[${i}]`);
      if (returnIds.has(r.id)) werfe(`returns[${i}].id`, `doppelt (${r.id})`);
      if (returnNrs.has(r.nr)) werfe(`returns[${i}].nr`, `doppelt (${r.nr})`);
      returnIds.add(r.id); returnNrs.add(r.nr);
      laneZaehle(r, `returns[${i}]`);
    });
  }
  if ('baukasten' in o) { const f = pruefeBkListe(o.baukasten); if (f) werfe(f.wo, f.text); }   // S17
  const sendRefs = (liste: { sends?: Send[] }[], wo: string) => liste.forEach((e, i) => (e.sends ?? []).forEach((sd, k) => {
    if (!returnIds.has(sd.id)) werfe(`${wo}[${i}].sends[${k}].id`, `unbekannter Return ${sd.id}`);
  }));
  sendRefs(o.spuren as { sends?: Send[] }[], 'spuren');
  if (neu2) sendRefs(o.gruppen as { sends?: Send[] }[], 'gruppen');
  // loop deck returns: only in the live container, one per (place, art), sends only from the track of the same deck
  {
    const loopRet = new Map<string, ReturnLoopdeck>();
    const gruppen = (o.gruppen ?? []) as Gruppe[];
    ((o.returns ?? []) as Return[]).forEach((r, i) => {
      if (!r.loopdeck) return;
      if (o.live !== true) werfe(`returns[${i}].loopdeck`, 'only in the live container');
      const k = `${r.loopdeck.platz}/${r.loopdeck.art}`;
      if (loopRet.has(k)) werfe(`returns[${i}].loopdeck`, `duplicate (place ${r.loopdeck.platz}, ${r.loopdeck.art})`);
      loopRet.set(r.id, r.loopdeck); loopRet.set(k, r.loopdeck);
    });
    const platzVon = (s: Spur): number | null => gruppen.find((g) => g.id === s.ausgang?.id)?.loopdeck?.platz ?? null;
    const pruefe = (liste: { sends?: Send[] }[], wo: string, platz: (e: never) => number | null): void => liste.forEach((e, i) =>
      (e.sends ?? []).forEach((sd, k) => {
        const l = loopRet.get(sd.id);
        if (l && platz(e as never) !== l.platz) werfe(`${wo}[${i}].sends[${k}]`, 'a loop deck return takes sends only from its own deck');
      }));
    pruefe(o.spuren as Spur[], 'spuren', platzVon as (e: never) => number | null);
    pruefe(gruppen, 'gruppen', () => null);
  }
  // container core: places, the strudel group, strom tracks and the owner of every return
  {
    const gruppen = (o.gruppen ?? []) as Gruppe[], spuren = o.spuren as Spur[], returns = (o.returns ?? []) as Return[];
    const top = new Map(gruppen.filter((g) => !g.ausgang).map((g) => [g.id, g] as const));
    const strudel = gruppen.find((g) => g.strudel);
    const stroeme = new Set<number>();
    spuren.forEach((s, i) => {
      if (s.art === 'strom') {
        if (stroeme.has(s.strom!)) werfe(`spuren[${i}].strom`, `duplicate (${s.strom})`);
        stroeme.add(s.strom!);
        if (!strudel || s.ausgang?.id !== strudel.id) werfe(`spuren[${i}].ausgang`, 'a strom track sits inside the strudel group');
      } else if (strudel && s.ausgang?.id === strudel.id) werfe(`spuren[${i}].ausgang`, 'the strudel group holds strom tracks only');
    });
    if (strudel) gruppen.forEach((g, i) => { if (g.ausgang?.id === strudel.id) werfe(`gruppen[${i}].ausgang`, 'the strudel group holds strom tracks only'); });
    if (o.live === true) {
      const pl = o.plaetze;
      if (!Array.isArray(pl) || pl.length !== PLAETZE) werfe('plaetze', `array of ${PLAETZE} entries expected`);
      const belegt = new Set<string>(), zaehl = { strudel: 0, loops: 0, stems: 0 };
      (pl as unknown[]).forEach((e, i) => {
        const wo = `plaetze[${i}]`;
        if (!istObjekt(e)) return werfe(wo, 'Objekt erwartet');
        if (!(PLATZ_TYPEN as readonly unknown[]).includes(e.typ)) werfe(`${wo}.typ`, `one of ${PLATZ_TYPEN.join(' | ')} expected`);
        if (e.typ === 'leer' || e.typ === 'track') { felder(e, wo, ['typ']); return; }
        felder(e, wo, ['typ', 'gruppe']);
        const g = typeof e.gruppe === 'string' ? top.get(e.gruppe) : undefined;
        if (!g) return werfe(`${wo}.gruppe`, `no top group ${String(e.gruppe)}`);
        const art = e.typ === 'strudel' ? g.strudel : e.typ === 'seq' ? g.seq : e.typ === 'loops' ? g.loopdeck : g.modul;
        if (!art) werfe(`${wo}.gruppe`, `group ${g.id} is not a ${e.typ as string} group`);
        if (belegt.has(g.id)) werfe(`${wo}.gruppe`, `group ${g.id} already sits in another place`);
        belegt.add(g.id);
        if (e.typ === 'strudel' && ++zaehl.strudel > 1) werfe(`${wo}.typ`, 'strudel is unique: one strudel place at most');
        if (e.typ === 'loops' && ++zaehl.loops > 2) werfe(`${wo}.typ`, 'at most two loops places (one per loop deck)');
        if (e.typ === 'stems' && ++zaehl.stems > 2) werfe(`${wo}.typ`, 'at most two stems places');
      });
    }
    const strRet = new Set<string>();
    returns.forEach((r, i) => {
      const wo = `returns[${i}]`;
      if (o.live === true) { if (r.gruppe === undefined) werfe(`${wo}.gruppe`, 'fehlt (owner top group of a live return)'); }
      else if (r.gruppe !== undefined) werfe(`${wo}.gruppe`, 'unknown field (only in the live container)');
      const eigner = r.gruppe === undefined ? undefined : top.get(r.gruppe);
      if (r.gruppe !== undefined && !eigner) werfe(`${wo}.gruppe`, `no top group ${r.gruppe}`);
      if (r.loopdeck && eigner?.loopdeck?.platz !== r.loopdeck.platz) werfe(`${wo}.gruppe`, `a loop deck return is owned by its loop deck ${r.loopdeck.platz}`);
      if (r.strudel) {
        if (!strudel) werfe(`${wo}.strudel`, 'only with a strudel group');
        if (strRet.has(r.strudel.art)) werfe(`${wo}.strudel`, `duplicate (${r.strudel.art})`);
        strRet.add(r.strudel.art);
        if (eigner !== strudel) werfe(`${wo}.gruppe`, 'a strudel return is owned by the strudel group');
      }
    });
  }
  // slice 4: stage IDs and pooled slots are unique over the whole project
  const insertIds = new Set<string>(), insertSlots = new Set<string>();
  for (const { strangId, insert } of alleInserts(o as unknown as Projekt)) {
    if (insertIds.has(insert.id)) werfe(`${strangId}.inserts`, `ID doppelt (${insert.id})`);
    const slot = `${insert.art}/${insert.slot}`;
    if (insertSlots.has(slot)) werfe(`${strangId}.inserts`, `Slot doppelt (${slot})`);
    insertIds.add(insert.id); insertSlots.add(slot);
    // the key names an existing track, like the command insert_setzen demands (a dangling key would bind silently to a later spur_neu)
    if (insert.sc !== undefined && insert.sc > 0 && !nrs.has(insert.sc)) werfe(`${strangId}.inserts`, `sc: Spur ${insert.sc} existiert nicht`);
    // slice 5: a structural key names an existing strip, like sc (a dangling key would bind silently to a later spur_neu)
    const kq = insert.key;
    if (kq && ((kq.quelle === 'spur' && !nrs.has(kq.nr)) || (kq.quelle === 'grp' && !gruppenNrs.has(kq.nr))
      || (kq.quelle === 'ret' && !returnNrs.has(kq.nr)))) {
      werfe(`${strangId}.inserts`, `key: ${kq.quelle} ${kq.nr} does not exist`);
    }
  }
  // nested groups: a stage key must be valid for the group tree of this file (a retarget can invalidate it; the core refuses such a playback)
  const ungueltig = ersterUngueltigerSchluessel(o as unknown as Projekt, true);
  if (ungueltig) werfe(`${ungueltig.strangId}.inserts`, `${ungueltig.ablehnung.grund}: ${ungueltig.ablehnung.text}`);
  // slice 4c: racks. The slot is unique over the project; a rack sits on a strip with a chain; every target is a stage of that chain and a
  // continuous parameter in
  // its range; a parameter has one macro at most; at most MAX_MAKRO_ZIELE targets per rack
  const rackSlots = new Set<number>();
  for (const { strang, strangId, rack } of alleRacks(o as unknown as Projekt)) {
    if (rackSlots.has(rack.slot)) werfe(`${strangId}.rack`, `Slot doppelt (${rack.slot})`);
    rackSlots.add(rack.slot);
    const rackSpur = 'art' in strang && strang.art === 'instrument' && strang.geraet?.art === 'rack';   // 1.9 U8 T7: its members are targets, no chain needed
    if (!strang.inserts?.length && !rackSpur) werfe(`${strangId}.rack`, 'ein Rack braucht eine Kette (rack_ohne_kette)');
    const ziele = rack.makros.flatMap((m) => m.ziel);
    if (ziele.length === 0) werfe(`${strangId}.rack`, 'kein Ziel: ein Rack ohne Zuordnung gibt es nicht (rack_leer)');
    if (ziele.length > MAX_MAKRO_ZIELE) werfe(`${strangId}.rack`, `höchstens ${MAX_MAKRO_ZIELE} Ziele (makro_voll)`);
    const gesehen = new Set<string>();
    for (const z of ziele) {
      if (istGliedZiel(z)) {   // 1.9 U8 T7: a target on a member of the rack device of this track
        if (!rackSpur) werfe(`${strangId}.rack`, `target ${z.glied}: only on a rack track (glied_ohne_rack)`);
        const m = glieder(strang as Spur).find((x) => x.id === z.glied);
        if (!m) werfe(`${strangId}.rack`, `target ${z.glied}: no member of this track (glied_unbekannt)`);
        const q = gliedMakroParam(m!.geraet, z.param);
        if (!q) werfe(`${strangId}.rack`, `target ${z.glied}.${z.param}: parameter not allowed for this device (makro_ziel_wirt, argument_unbekannt)`);
        if (z.von < q!.min || z.von > q!.max || z.bis < q!.min || z.bis > q!.max) {
          werfe(`${strangId}.rack`, `target ${z.glied}.${z.param}: von/bis outside ${q!.min}..${q!.max}`);
        }
        const gk = `${z.glied}/${z.param}`;
        if (gesehen.has(gk)) werfe(`${strangId}.rack`, `target ${gk} twice (ziel_doppelt)`);
        gesehen.add(gk);
        continue;
      }
      const st = (strang.inserts ?? []).find((x) => x.id === z.insert);
      if (!st) werfe(`${strangId}.rack`, `Ziel ${z.insert}: keine Stufe dieser Kette`);
      const art = st!.art as InsertPoolArt;
      const q = INSERT_ARTEN[art].parameter.find((x) => x.name === z.param);
      if (!q || !makroFaehig(art, z.param)) werfe(`${strangId}.rack`, `Ziel ${z.insert}.${z.param}: kein stetiger Parameter`);
      if (z.von < q!.min || z.von > q!.max || z.bis < q!.min || z.bis > q!.max) {
        werfe(`${strangId}.rack`, `Ziel ${z.insert}.${z.param}: von/bis ausserhalb ${q!.min}..${q!.max}`);
      }
      const key = `${z.insert}/${z.param}`;
      if (gesehen.has(key)) werfe(`${strangId}.rack`, `Ziel ${key} doppelt (ziel_doppelt)`);
      gesehen.add(key);
    }
  }
  if (clips > MAX_CLIPS) werfe('spuren', `höchstens ${MAX_CLIPS} Clips`);
  if (noten > MAX_NOTEN) werfe('noten', `höchstens ${MAX_NOTEN} Noten`);
  const kettenLanen = alleStraenge(o as unknown as Projekt).reduce((n, x) => n + kettenLanen_(x.strang), 0);
  if (kettenLanen > MAX_KETTEN_LANEN) werfe('automation', `at most ${MAX_KETTEN_LANEN} insert and rack lanes in the project (zu_gross)`);
  if (autoPunkte > MAX_AUTO_PUNKTE) werfe('automation', `höchstens ${MAX_AUTO_PUNKTE} Punkte im Projekt`);
  if ('modulatoren' in o) {   // strand 6: last, every strip and stage is checked by now
    const f = modulatorenPruefung(o.modulatoren, o as unknown as Projekt);
    if (f) werfe('modulatoren', `${f.text} (${f.grund})`);
  }
}
