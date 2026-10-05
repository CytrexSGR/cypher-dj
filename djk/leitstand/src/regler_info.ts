// Regler-Pfade mit Einheit, Bereich, Vorgabe und „nur Hand“ nach SCHNITTSTELLEN §1.5, dazu Kanal eines Pfads und
// „leiser machen“ im Sinn der Autonomie-Positivliste (§10 Stufe 1: Fader oder Send nach unten, Kill an).
// Die Pfadmenge gleicht tests/regler_info.test.ts mit dem Muster regler_pfad aus djk/vertrag/schemas/defs.schema.json ab.

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
  if (k.startsWith('deck/')) for (const s of ['drums', 'bass', 'vocals', 'other']) m[`stem/${s}`] = r('db', -200, 6, 0);
  return m;
}

const tabelle = new Map<string, ReglerInfo>();
for (const k of [...SPIELKANAELE, ...BUSSE]) {
  for (const [p, e] of Object.entries(kanalzug(k))) tabelle.set(`${k}/${p}`, { pfad: `${k}/${p}`, kanal: k, ...e });
}
for (const [p, e] of Object.entries({
  xfader: r('linear', -1, 1, 0, true), 'master/pegel': r('db', -200, 0, 0, true), 'master/kleber': r('linear', 0, 1, 0, true), 'cue/mix': r('linear', -1, 1, -1, true),
  'cue/pegel': r('db', -200, 0, -12, true), 'cue/split': r('schalter', 0, 1, 0, true),
  'fx/1/notenwert': r('linear', 1 / 32, 4, 0.75), 'fx/2/notenwert': r('linear', 1 / 32, 4, 0.75),
  'fx/1/rueckkopplung': r('linear', 0, 0.95, 0.5), 'fx/2/rueckkopplung': r('linear', 0, 0.95, 0.5),
  'fx/1/rueckweg': r('db', -200, 0, 0), 'fx/2/rueckweg': r('db', -200, 0, 0),
  'fx/3/rueckweg': r('db', -200, 0, 0), 'fx/4/rueckweg': r('db', -200, 0, 0),
  'duck/tiefe': r('db', -24, 0, 0), 'duck/release': r('linear', 50, 600, 200),
})) tabelle.set(p, { pfad: p, kanal: null, ...e });

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
