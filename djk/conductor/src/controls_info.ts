// Regler-Pfade mit Einheit, Bereich, Vorgabe und „nur Hand“ nach INTERFACES §1.5, dazu Kanal eines Pfads und
// „leiser machen“ im Sinn der Autonomie-Positivliste (§10 Stufe 1: Fader oder Send nach unten, Kill an).
// Die Pfadmenge gleicht tests/controls_info.test.ts mit dem Muster regler_pfad aus djk/contract/schemas/defs.schema.json ab.

import { INSERT_REGLER_ZEILEN } from './insert_controls.ts';

export type Einheit = 'db' | 'schalter' | 'linear' | 'stufe';

export interface ReglerInfo {
  pfad: string;
  kanal: string | null; // deck/1 … bus/4; null für xfader, master/pegel, cue/*, fx/*
  einheit: Einheit;
  min: number;
  max: number;
  vorgabe: number;
  nurHand: boolean;
}

export const DECKS = ['deck/1', 'deck/2', 'deck/3', 'deck/4'] as const;
export const ERZ = ['erz/1', 'erz/2', 'erz/3', 'erz/4', 'erz/5', 'erz/6', 'erz/7', 'erz/8'] as const;
export const PADS = ['pad/1', 'pad/2'] as const;
export const BUSSE = ['bus/1', 'bus/2', 'bus/3', 'bus/4'] as const;
export const SPIELKANAELE: readonly string[] = [...DECKS, ...ERZ, ...PADS];

type Eintrag = Omit<ReglerInfo, 'pfad' | 'kanal'>;
const r = (einheit: Einheit, min: number, max: number, vorgabe: number, nurHand = false): Eintrag =>
  ({ einheit, min, max, vorgabe, nurHand });

function kanalzug(k: string): Record<string, Eintrag> {
  const bus = k.startsWith('bus/');
  const m: Record<string, Eintrag> = {
    fader: r('db', -200, 0, -200, bus), // bus/<n>/fader nur Hand (§1.5)
    trim: r('db', -24, 24, 0),
    'eq/tief': r('db', -200, 6, 0), 'eq/mitte': r('db', -200, 6, 0), 'eq/hoch': r('db', -200, 6, 0),
    'kill/tief': r('schalter', 0, 1, 0), 'kill/mitte': r('schalter', 0, 1, 0), 'kill/hoch': r('schalter', 0, 1, 0),
    filter: r('linear', -1, 1, 0),
    'send/1': r('db', -200, 0, -200), 'send/2': r('db', -200, 0, -200),
    'send/3': r('db', -200, 0, -200), 'send/4': r('db', -200, 0, -200),
    xseite: r('stufe', 0, 2, 1, true),
    pfl: r('schalter', 0, 1, 0, true),
  };
  if (!bus) m.ziel = r('stufe', 0, 4, 0, true);
  if (!bus) Object.assign(m, {   // Kompressor je Quellkanal (2026-10-11), alle dürfen
    'komp/an': r('schalter', 0, 1, 0), 'komp/schwelle': r('linear', -60, 0, -18), 'komp/ratio': r('linear', 1, 20, 4),
    'komp/attack': r('linear', 0.1, 100, 10), 'komp/release': r('linear', 10, 1000, 120), 'komp/makeup': r('linear', 0, 24, 0),
    'komp/mix': r('linear', 0, 1, 1), 'komp/sc': r('stufe', 0, 14, 0),
  });
  if (k.startsWith('deck/')) for (const s of ['drums', 'bass', 'vocals', 'other']) m[`stem/${s}`] = r('db', -200, 6, 0);
  return m;
}

const tabelle = new Map<string, ReglerInfo>();
for (const k of [...SPIELKANAELE, ...BUSSE]) {
  for (const [p, e] of Object.entries(kanalzug(k))) tabelle.set(`${k}/${p}`, { pfad: `${k}/${p}`, kanal: k, ...e });
}
for (const [p, e] of Object.entries({
  xfader: r('linear', -1, 1, 0, true), 'master/pegel': r('db', -200, 0, 0, true), 'master/kleber': r('linear', 0, 1, 0, true), 'cue/mix': r('linear', -1, 1, -1, true),
  'cue/pegel': r('db', -200, 0, -12, true), 'cue/split': r('schalter', 0, 1, 0, true), 'master/pfl': r('schalter', 0, 1, 0, true),
  'fx/1/notenwert': r('linear', 1 / 32, 4, 0.75), 'fx/2/notenwert': r('linear', 1 / 32, 4, 0.75),
  'fx/1/rueckkopplung': r('linear', 0, 0.95, 0.5), 'fx/2/rueckkopplung': r('linear', 0, 0.95, 0.5),
  'fx/1/rueckweg': r('db', -200, 0, 0), 'fx/2/rueckweg': r('db', -200, 0, 0),
  'fx/3/rueckweg': r('db', -200, 0, 0), 'fx/4/rueckweg': r('db', -200, 0, 0),
  'duck/tiefe': r('db', -24, 0, 0), 'duck/release': r('linear', 50, 600, 200),
  'color/art': r('stufe', 0, 5, 0), 'color/param': r('linear', 0, 1, 0.5),   // SOUND COLOR FX, alle dürfen
  keylock: r('schalter', 0, 1, 1),   // Keylock 3 (Fassung 4): EIN Knopf für alle Quellen, alle dürfen
})) tabelle.set(p, { pfad: p, kanal: null, ...e });
for (let n = 1; n <= 32; n++) {   // D1 K1 (§1.5), E3: 32 Slots: Spur-Regler des Arrangements, global, alle dürfen; Fader bis +6 dB (Spec 6.16)
  tabelle.set(`spur/${n}/fader`, { pfad: `spur/${n}/fader`, kanal: null, ...r('db', -200, 6, 0) });
  tabelle.set(`spur/${n}/pan`, { pfad: `spur/${n}/pan`, kanal: null, ...r('linear', -1, 1, 0) });
  tabelle.set(`spur/${n}/mute`, { pfad: `spur/${n}/mute`, kanal: null, ...r('schalter', 0, 1, 0) });
  tabelle.set(`spur/${n}/solo`, { pfad: `spur/${n}/solo`, kanal: null, ...r('schalter', 0, 1, 0) });
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
for (let ret = 1; ret <= 4; ret++) {
  for (let n = 1; n <= 32; n++) tabelle.set(`spur/${n}/send/${ret}`, { pfad: `spur/${n}/send/${ret}`, kanal: null, ...r('db', -200, 6, -200) });
  for (let n = 1; n <= 16; n++) tabelle.set(`grp/${n}/send/${ret}`, { pfad: `grp/${n}/send/${ret}`, kanal: null, ...r('db', -200, 6, -200) });
  tabelle.set(`ret/${ret}/fader`, { pfad: `ret/${ret}/fader`, kanal: null, ...r('db', -200, 6, 0) });
  tabelle.set(`ret/${ret}/pan`, { pfad: `ret/${ret}/pan`, kanal: null, ...r('linear', -1, 1, 0) });
  tabelle.set(`ret/${ret}/mute`, { pfad: `ret/${ret}/mute`, kanal: null, ...r('schalter', 0, 1, 0) });
  tabelle.set(`ret/${ret}/solo`, { pfad: `ret/${ret}/solo`, kanal: null, ...r('schalter', 0, 1, 0) });
  tabelle.set(`ret/${ret}/hall/an`, { pfad: `ret/${ret}/hall/an`, kanal: null, ...r('schalter', 0, 1, 1) });
  for (const [f, v] of Object.entries(HALL_VORGABE)) tabelle.set(`ret/${ret}/hall/${f}`, { pfad: `ret/${ret}/hall/${f}`, kanal: null, ...r('linear', 0, 1, v) });
}
// S5r (§1.5): 64 Graph-Regler <kanal>/bk/<1..64> auf Kanälen, die einen Baukasten-Graphen annehmen (deck/1..4 Effekt,
// erz/1,2,3,5,6,7 und pad/1,2 Instrument; nicht erz/4, erz/8), alle dürfen, 0..1, Vorgabe 0,5
export const BK_REGLER_N = 64;   // knobs per channel: <kanal>/bk/1..64 (64-knob widening)
export const BK_KANAELE: readonly string[] = ['deck/1', 'deck/2', 'deck/3', 'deck/4', 'erz/1', 'erz/2', 'erz/3', 'erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2'];
for (const k of BK_KANAELE) {
  for (let n = 1; n <= BK_REGLER_N; n++) tabelle.set(`${k}/bk/${n}`, { pfad: `${k}/bk/${n}`, kanal: k, ...r('linear', 0, 1, 0.5) });
}
// S14 (§1.5): 64 graph knobs fx/<n>/bk/<m> per send return fx/3, fx/4; global (no channel), linear 0..1, default 0.5, everybody may
export const BK_SEND_KANAELE: readonly string[] = ['fx/3', 'fx/4'];
for (const k of BK_SEND_KANAELE) {
  for (let m = 1; m <= BK_REGLER_N; m++) tabelle.set(`${k}/bk/${m}`, { pfad: `${k}/bk/${m}`, kanal: null, ...r('linear', 0, 1, 0.5) });
}

// 1.15 A2 (§1.5, the 345 mix-tool rows): gate on the 13 live source channels, utility on those plus bus/1..4, multiband and channel
// limiter on bus/1..4, one global spectrum row. erz/8 has no tool rows (cue only). All rows: everybody may, no "leiser machen"
// (default deny, machtLeiser). Ranges and defaults equal tool_controls.h; tests/controls_info.test.ts compares both.
const WZ_QUELLEN: readonly string[] = [...DECKS, ...ERZ.slice(0, 7), ...PADS];
const WZ_BAND: readonly (readonly [string, Einheit, number, number, number])[] = [
  ['schwelle', 'linear', -60, 0, 0], ['ratio', 'linear', 1, 20, 1], ['attack', 'linear', 0.1, 500, 10], ['release', 'linear', 1, 5000, 100],
  ['knie', 'linear', 0, 24, 0], ['makeup', 'linear', -24, 24, 0], ['umgehen', 'schalter', 0, 1, 0],
];
const WZ_REIHEN: readonly { kanaele: readonly string[]; zeilen: readonly (readonly [string, Einheit, number, number, number])[] }[] = [
  { kanaele: WZ_QUELLEN, zeilen: [
    ['gate/an', 'schalter', 0, 1, 0], ['gate/schwelle', 'linear', -90, 0, -40], ['gate/hysterese', 'linear', 0, 24, 4],
    ['gate/ratio', 'linear', 1, 100, 100], ['gate/bereich', 'linear', -120, 0, -80], ['gate/attack', 'linear', 0.1, 500, 1],
    ['gate/hold', 'linear', 0, 2000, 20], ['gate/release', 'linear', 1, 5000, 100], ['gate/sc', 'stufe', 0, 14, 0]] },
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
tabelle.set('spektrum/kanal', { pfad: 'spektrum/kanal', kanal: null, ...r('stufe', 0, 19, 0) });   // 0 off, 1..18 channel + 1, 19 = master sum

// 1.10 slice 4a/4b (§1.5): the insert controls ins/komp|eq|saett|lim/<n>/*, global rows, everybody may, project-only (the server refuses POST /regler on them).
// The rows are generated from docs/interfaces/insert_module.json (insert_controls.ts); the namenslisten checker compares them with insert_zeilen.inc.
for (const [pfad, e, lo, hi, v] of INSERT_REGLER_ZEILEN) tabelle.set(pfad, { pfad, kanal: null, ...r(e, lo, hi, v) });

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
