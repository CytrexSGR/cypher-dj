// Regler-Pfade mit Einheit, Bereich, Vorgabe und „nur Hand“ nach INTERFACES §1.5, dazu Kanal eines Pfads und
// „leiser machen“ im Sinn der Autonomie-Positivliste (§10 Stufe 1: Fader oder Send nach unten, Kill an).
// Die Pfadmenge gleicht tests/controls_info.test.ts mit dem Muster regler_pfad aus djk/contract/schemas/defs.schema.json ab.

import {
  PULT_ALIAS_STROEME, pultAliasSuffixe, pultBkN, pultBusPfad, pultContainerPfad, pultReglerBus, pultReglerPlayer, pultReglerZug, pultStroeme,
} from '../../contract/pult.ts';
import { INSERT_REGLER_ZEILEN } from './insert_controls.ts';

export type Einheit = 'db' | 'schalter' | 'linear' | 'stufe';

export interface ReglerInfo {
  pfad: string;
  kanal: string | null; // deck/1, deck/2, pad/1, pad/2, bus/1 … bus/4, erz/<n> (alias); null für xfader, master/pegel, cue/*, fx/*
  einheit: Einheit;
  min: number;
  max: number;
  vorgabe: number;
  nurHand: boolean;
  alias?: true; // erz/<n>/<suffix>: a stream alias row, resolved by the page server to the stream's strip
}

/** The player decks: stem rows exist for deck/1..4 (players), the strip rows only for the containers deck/1, deck/2, pad/1, pad/2. */
export const DECKS = ['deck/1', 'deck/2', 'deck/3', 'deck/4'] as const;
export const BUSSE: readonly string[] = pultBusPfad;
/** The four containers (strips A..D) in the order of the contract. */
export const CONTAINER: readonly string[] = pultContainerPfad;
const alias = (n: number): string => `erz/${n}`;

type Eintrag = Omit<ReglerInfo, 'pfad' | 'kanal'>;
const r = (einheit: Einheit, min: number, max: number, vorgabe: number, nurHand = false): Eintrag =>
  ({ einheit, min, max, vorgabe, nurHand });

// Unit, range and default of every strip suffix (hand-written here; the suffix SETS come from contract/pult.ts, regler.zug and regler.bus).
// The compressor and gate side chain source is 0 = off, 1..4 = container (F9 D-V3).
const ZUG: Record<string, Eintrag> = {
  fader: r('db', -200, 0, -200),
  trim: r('db', -24, 24, 0),
  'eq/tief': r('db', -200, 6, 0), 'eq/mitte': r('db', -200, 6, 0), 'eq/hoch': r('db', -200, 6, 0),
  'kill/tief': r('schalter', 0, 1, 0), 'kill/mitte': r('schalter', 0, 1, 0), 'kill/hoch': r('schalter', 0, 1, 0),
  filter: r('linear', -1, 1, 0),
  'send/1': r('db', -200, 0, -200), 'send/2': r('db', -200, 0, -200), 'send/3': r('db', -200, 0, -200), 'send/4': r('db', -200, 0, -200),
  xseite: r('stufe', 0, 2, 1),
  pfl: r('schalter', 0, 1, 0),
  ziel: r('stufe', 0, 4, 0),
  'komp/an': r('schalter', 0, 1, 0), 'komp/schwelle': r('linear', -60, 0, -18), 'komp/ratio': r('linear', 1, 20, 4),
  'komp/attack': r('linear', 0.1, 100, 10), 'komp/release': r('linear', 10, 1000, 120), 'komp/makeup': r('linear', 0, 24, 0),
  'komp/mix': r('linear', 0, 1, 1), 'komp/sc': r('stufe', 0, 4, 0),
  pan: r('linear', -1, 1, 0), mute: r('schalter', 0, 1, 0), solo: r('schalter', 0, 1, 0),   // stream aliases only
};
const BK_TOKEN = 'bk/<k>';
const BK_ZEILE = r('linear', 0, 1, 0.5);

const tabelle = new Map<string, ReglerInfo>();
const setze = (pfad: string, kanal: string | null, e: Eintrag, alias?: true): void => {
  tabelle.set(pfad, alias ? { pfad, kanal, ...e, alias } : { pfad, kanal, ...e });
};
for (const k of CONTAINER) {
  for (const s of pultReglerZug) if (s in ZUG) setze(`${k}/${s}`, k, ZUG[s]);
}
for (const k of BUSSE) {
  for (const s of pultReglerBus) if (s in ZUG) setze(`${k}/${s}`, k, ZUG[s]);
}
for (let n = 1; n <= DECKS.length; n++) {
  for (const s of pultReglerPlayer) if (s.startsWith('stem/')) setze(`deck/${n}/${s}`, `deck/${n}`, r('db', -200, 6, 0));
}
// Stream aliases erz/<n>/<suffix> (resolved by the page server to the stream's strip): the unit, range and default of the container row of the same suffix.
for (const n of PULT_ALIAS_STROEME) {
  for (const s of pultAliasSuffixe) if (s !== BK_TOKEN) setze(`${alias(n)}/${s}`, alias(n), ZUG[s], true);
}

for (const [p, e] of Object.entries({
  xfader: r('linear', -1, 1, 0), 'master/pegel': r('db', -200, 0, 0), 'master/kleber': r('linear', 0, 1, 0), 'cue/mix': r('linear', -1, 1, -1),
  'cue/pegel': r('db', -200, 0, -12, true), 'cue/split': r('schalter', 0, 1, 0), 'master/pfl': r('schalter', 0, 1, 0),
  'fx/1/notenwert': r('linear', 1 / 32, 4, 0.75), 'fx/2/notenwert': r('linear', 1 / 32, 4, 0.75),
  'fx/1/rueckkopplung': r('linear', 0, 0.95, 0.5), 'fx/2/rueckkopplung': r('linear', 0, 0.95, 0.5),
  'fx/1/rueckweg': r('db', -200, 0, 0), 'fx/2/rueckweg': r('db', -200, 0, 0),
  'fx/3/rueckweg': r('db', -200, 0, 0), 'fx/4/rueckweg': r('db', -200, 0, 0),
  'duck/tiefe': r('db', -24, 0, 0), 'duck/release': r('linear', 50, 600, 200),
  'color/art': r('stufe', 0, 5, 0), 'color/param': r('linear', 0, 1, 0.5),   // SOUND COLOR FX, alle dürfen
  keylock: r('schalter', 0, 1, 1),   // Keylock 3 (Fassung 4): EIN Knopf für alle Quellen, alle dürfen
})) tabelle.set(p, { pfad: p, kanal: null, ...e });
for (let n = 1; n <= 128; n++) {   // D1 K1 (§1.5), E3: 128 Slots: Spur-Regler des Arrangements, global, alle dürfen; Fader bis +6 dB (Spec 6.16)
  tabelle.set(`spur/${n}/fader`, { pfad: `spur/${n}/fader`, kanal: null, ...r('db', -200, 6, 0) });
  tabelle.set(`spur/${n}/pan`, { pfad: `spur/${n}/pan`, kanal: null, ...r('linear', -1, 1, 0) });
  tabelle.set(`spur/${n}/mute`, { pfad: `spur/${n}/mute`, kanal: null, ...r('schalter', 0, 1, 0) });
  tabelle.set(`spur/${n}/solo`, { pfad: `spur/${n}/solo`, kanal: null, ...r('schalter', 0, 1, 0) });
  tabelle.set(`spur/${n}/filter`, { pfad: `spur/${n}/filter`, kanal: null, ...r('linear', -1, 1, 0) });   // loop deck K7a: DJ filter of a track
  tabelle.set(`spur/${n}/pfl`, { pfad: `spur/${n}/pfl`, kanal: null, ...r('schalter', 0, 1, 0) });   // container core K7
  tabelle.set(`spur/${n}/trim`, { pfad: `spur/${n}/trim`, kanal: null, ...r('db', -24, 24, 0) });   // container core K7
  for (const b of ['tief', 'mitte', 'hoch']) tabelle.set(`spur/${n}/kill/${b}`, { pfad: `spur/${n}/kill/${b}`, kanal: null, ...r('schalter', 0, 1, 0) });   // container core K7
  for (const b of ['tief', 'mitte', 'hoch']) tabelle.set(`spur/${n}/eq/${b}`, { pfad: `spur/${n}/eq/${b}`, kanal: null, ...r('db', -200, 6, 0) });   // loop deck channel strip KZ1: isolator band of a track, -200 = kill
  for (const u of [1, 2, 3]) tabelle.set(`spur/${n}/fx/${u}`, { pfad: `spur/${n}/fx/${u}`, kanal: null, ...r('schalter', 0, 1, 0) });   // loop deck lane strip: FX 1 2 3 assignment of a track
}
for (let n = 1; n <= 16; n++) {   // 1.10 Slice 1 (§1.5): Gruppen-Regler des Arrangements, global, alle dürfen; Fader bis +6 dB
  tabelle.set(`grp/${n}/fader`, { pfad: `grp/${n}/fader`, kanal: null, ...r('db', -200, 6, 0) });
  tabelle.set(`grp/${n}/pan`, { pfad: `grp/${n}/pan`, kanal: null, ...r('linear', -1, 1, 0) });
  tabelle.set(`grp/${n}/mute`, { pfad: `grp/${n}/mute`, kanal: null, ...r('schalter', 0, 1, 0) });
  tabelle.set(`grp/${n}/solo`, { pfad: `grp/${n}/solo`, kanal: null, ...r('schalter', 0, 1, 0) });
  tabelle.set(`grp/${n}/cue`, { pfad: `grp/${n}/cue`, kanal: null, ...r('schalter', 0, 1, 0) });   // live modules task 6: headphone cue of the group, hand only
}
tabelle.set('pm/fader', { pfad: 'pm/fader', kanal: null, ...r('db', -200, 6, 0) });
// 1.10 Slice 3 (§1.5): sends (post fader) from tracks and groups to the 4 returns, return strips and Cypher Hall values; global, everybody may.
// Sends default to -200 (off). Hall values are normalised 0..1 (unit mapping in the kernel); hall/an is a switch.
const HALL_VORGABE: Record<string, number> = { pre: 0.04, decay: 0.5252, groesse: 0.282, tief: 0.5658, highcut: 0.8039, fahne: 0.66667 };
for (let ret = 1; ret <= 8; ret++) {   // container core K6: returns 1..8
  for (let n = 1; n <= 128; n++) tabelle.set(`spur/${n}/send/${ret}`, { pfad: `spur/${n}/send/${ret}`, kanal: null, ...r('db', -200, 6, -200) });
  for (let n = 1; n <= 16; n++) tabelle.set(`grp/${n}/send/${ret}`, { pfad: `grp/${n}/send/${ret}`, kanal: null, ...r('db', -200, 6, -200) });
  tabelle.set(`ret/${ret}/fader`, { pfad: `ret/${ret}/fader`, kanal: null, ...r('db', -200, 6, 0) });
  tabelle.set(`ret/${ret}/pan`, { pfad: `ret/${ret}/pan`, kanal: null, ...r('linear', -1, 1, 0) });
  tabelle.set(`ret/${ret}/mute`, { pfad: `ret/${ret}/mute`, kanal: null, ...r('schalter', 0, 1, 0) });
  tabelle.set(`ret/${ret}/solo`, { pfad: `ret/${ret}/solo`, kanal: null, ...r('schalter', 0, 1, 0) });
  tabelle.set(`ret/${ret}/hall/an`, { pfad: `ret/${ret}/hall/an`, kanal: null, ...r('schalter', 0, 1, 1) });
  for (const [f, v] of Object.entries(HALL_VORGABE)) tabelle.set(`ret/${ret}/hall/${f}`, { pfad: `ret/${ret}/hall/${f}`, kanal: null, ...r('linear', 0, 1, v) });
}
// S5r (§1.5): 64 graph knobs <kanal>/bk/<1..64> on the channels that take a Baukasten graph: the four containers and the alias streams with an
// instrument graph (stream 1 is the drum kit, it has no instrument graph). The contract still lists the bk rows of every alias stream, so the table
// holds them all (the pattern equality); BK_KANAELE names the channels that really take a graph. All 0..1, default 0.5, everybody may.
export const BK_REGLER_N = pultBkN;   // knobs per channel: <kanal>/bk/1..64 (64-knob widening)
export const BK_KANAELE: readonly string[] = [...CONTAINER, ...PULT_ALIAS_STROEME.filter((n) => n !== 1).map(alias)];
for (const k of CONTAINER) {
  for (let n = 1; n <= BK_REGLER_N; n++) setze(`${k}/bk/${n}`, k, BK_ZEILE);
}
for (const n of PULT_ALIAS_STROEME) {
  for (let m = 1; m <= BK_REGLER_N; m++) setze(`${alias(n)}/bk/${m}`, alias(n), BK_ZEILE, true);
}
// strom/<1..16>/bk/<1..64>: the graph knobs of the 16 stream slots, global (no channel)
for (let n = 1; n <= pultStroeme; n++) {
  for (let m = 1; m <= BK_REGLER_N; m++) setze(`strom/${n}/bk/${m}`, null, BK_ZEILE);
}
// S14 (§1.5): 64 graph knobs fx/<n>/bk/<m> per send return fx/3, fx/4; global (no channel), linear 0..1, default 0.5, everybody may
export const BK_SEND_KANAELE: readonly string[] = ['fx/3', 'fx/4'];
for (const k of BK_SEND_KANAELE) {
  for (let m = 1; m <= BK_REGLER_N; m++) tabelle.set(`${k}/bk/${m}`, { pfad: `${k}/bk/${m}`, kanal: null, ...r('linear', 0, 1, 0.5) });
}
// §1.5: 64 graph knobs master/bk/<m> of the effect graph on the DJ master sum; global (no channel), linear 0..1, default 0.5, everybody may
for (let m = 1; m <= BK_REGLER_N; m++) tabelle.set(`master/bk/${m}`, { pfad: `master/bk/${m}`, kanal: null, ...r('linear', 0, 1, 0.5) });

// Controller targets: spur/<slot>/bk/<k>, slot 1..16 (the n-th Baukasten track of the open project, bkSlot in ui/project/model.ts), k 1..64. The core rows
// (core/signalbox/src/controls.cpp, SPUR_BK_SLOTS x SPUR_BK_KNOEPFE, appended last) are global (no channel), linear 0..1, default 0.5, everybody may; a value on
// them is a transient override that is not in the project and that every playback rebuild clears.
export const SPUR_BK_SLOTS = 16;
for (let n = 1; n <= SPUR_BK_SLOTS; n++) {
  for (let m = 1; m <= BK_REGLER_N; m++) tabelle.set(`spur/${n}/bk/${m}`, { pfad: `spur/${n}/bk/${m}`, kanal: null, ...r('linear', 0, 1, 0.5) });
}

// 1.15 A2 (§1.5, the mix-tool rows): gate on the four containers, utility on those plus bus/1..4, multiband and channel
// limiter on bus/1..4, one global spectrum row. Streams have no tool rows. All rows: everybody may, no "leiser machen"
// (default deny, machtLeiser). Ranges and defaults equal tool_controls.h; tests/controls_info.test.ts compares both.
const WZ_QUELLEN: readonly string[] = CONTAINER;
const WZ_BAND: readonly (readonly [string, Einheit, number, number, number])[] = [
  ['schwelle', 'linear', -60, 0, 0], ['ratio', 'linear', 1, 20, 1], ['attack', 'linear', 0.1, 500, 10], ['release', 'linear', 1, 5000, 100],
  ['knie', 'linear', 0, 24, 0], ['makeup', 'linear', -24, 24, 0], ['umgehen', 'schalter', 0, 1, 0],
];
const WZ_REIHEN: readonly { kanaele: readonly string[]; zeilen: readonly (readonly [string, Einheit, number, number, number])[] }[] = [
  { kanaele: WZ_QUELLEN, zeilen: [
    ['gate/an', 'schalter', 0, 1, 0], ['gate/schwelle', 'linear', -90, 0, -40], ['gate/hysterese', 'linear', 0, 24, 4],
    ['gate/ratio', 'linear', 1, 100, 100], ['gate/bereich', 'linear', -120, 0, -80], ['gate/attack', 'linear', 0.1, 500, 1],
    ['gate/hold', 'linear', 0, 2000, 20], ['gate/release', 'linear', 1, 5000, 100], ['gate/sc', 'stufe', 0, 4, 0]] },
  { kanaele: [...WZ_QUELLEN, ...BUSSE], zeilen: [
    ['util/balance', 'linear', -1, 1, 0], ['util/breite', 'linear', 0, 200, 100], ['util/bassmono', 'linear', 0, 500, 0],
    ['util/phase_l', 'schalter', 0, 1, 0], ['util/phase_r', 'schalter', 0, 1, 0], ['util/tausch', 'schalter', 0, 1, 0],
    ['util/dc', 'schalter', 0, 1, 0]] },
  { kanaele: BUSSE, zeilen: [
    ['mb/an', 'schalter', 0, 1, 0], ['mb/grenze_tief', 'linear', 20, 20000, 200], ['mb/grenze_hoch', 'linear', 20, 20000, 2000],
    ...['tief', 'mitte', 'hoch'].flatMap((b) => WZ_BAND.map(([f, e, lo, hi, v]) => [`mb/${b}/${f}`, e, lo, hi, v] as const)),
    ['lim/an', 'schalter', 0, 1, 0], ['lim/decke', 'linear', -60, 0, -0.3], ['lim/abklingen', 'linear', 1, 2000, 80]] },
];
for (const { kanaele, zeilen } of WZ_REIHEN) {
  for (const k of kanaele) for (const [f, e, lo, hi, v] of zeilen) tabelle.set(`${k}/${f}`, { pfad: `${k}/${f}`, kanal: k, ...r(e, lo, hi, v) });
}
tabelle.set('spektrum/kanal', { pfad: 'spektrum/kanal', kanal: null, ...r('stufe', 0, 9, 0) });   // 0 off, 1..9 = the mix list (containers, buses, master sum)

// 1.10 slice 4a/4b (§1.5): the insert controls ins/komp|eq|saett|lim/<n>/*, global rows, everybody may, project-only (the server refuses POST /regler on them).
// The rows are generated from docs/interfaces/insert_module.json (insert_controls.ts); the namenslisten checker compares them with insert_zeilen.inc.
for (const [pfad, e, lo, hi, v] of INSERT_REGLER_ZEILEN) tabelle.set(pfad, { pfad, kanal: null, ...r(e, lo, hi, v) });

// Strand 2 slice 2 (§1.5): plug/<h>/k<m>, knob m (1..16) of effect host h (1..8), the last rows of the core table (core/signalbox/src/controls.cpp,
// REGLER_PLUG_HOSTS x REGLER_PLUG_KNOEPFE). Global (no channel), linear 0..1, default 0, everybody may and not project-only: the page server writes
// them with /k/teil to pick up the plugin's current value and forwards /e/hand moves of them to the plugin. Never "leiser machen".
export const PLUG_HOSTS = 8;
export const PLUG_KNOEPFE = 16;
for (let h = 1; h <= PLUG_HOSTS; h++) {
  for (let m = 1; m <= PLUG_KNOEPFE; m++) tabelle.set(`plug/${h}/k${m}`, { pfad: `plug/${h}/k${m}`, kanal: null, ...r('linear', 0, 1, 0) });
}

export const REGLER: ReadonlyMap<string, ReglerInfo> = tabelle;

export function reglerInfo(pfad: string): ReglerInfo | null { return REGLER.get(pfad) ?? null; }
export function kanalVon(pfad: string): string | null { return REGLER.get(pfad)?.kanal ?? null; }
export function deckNrVon(kanal: string | null): number | null {
  const m = kanal ? /^deck\/([1-4])$/.exec(kanal) : null;
  return m ? Number(m[1]) : null;
}

// §1.5 Bereich; Schalter und Stufen nur als Setzen (dauer 0) mit ganzem Wert
export function imBereich(info: ReglerInfo, nach: number, dauer: number): boolean {
  if (!Number.isFinite(nach)) return false;
  if (info.einheit === 'schalter') return (nach === 0 || nach === 1) && dauer === 0;
  if (info.einheit === 'stufe') return Number.isInteger(nach) && nach >= info.min && nach <= info.max && dauer === 0;
  return nach >= info.min - 1e-9 && nach <= info.max + 1e-9;
}

// §10 Stufe 1: „Fader oder Send nach unten, Kill an“. von = Wert des Reglers unmittelbar vor dem Teil. „Nach unten“ heißt
// streng leiser: gleich laut ist kein Leisermachen (Scheibe 21, Positivliste P22; vorher ging gleich laut direkt).
export function machtLeiser(pfad: string, von: number, nach: number): boolean {
  if (/\/kill\/(tief|mitte|hoch)$/.test(pfad)) return nach === 1;
  if (/\/(fader|send\/[1-4])$/.test(pfad) && kanalVon(pfad) !== null) return nach < von;
  return false;
}

// §1.6 „offen“ gegen die Schwelle hoerbar_db (kern.toml, Vorgabe −26 dB)
export function kanalpegel(trim: number, fader: number): number { return trim + fader; }
