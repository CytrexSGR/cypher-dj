// Closed vocabulary for preset descriptions and the validation of a description (presets/DECISIONS.md, P-V1..P-V6).
// The vocabulary lives only in presets/vokabular.json. Loading checks that its lists match the recorded checksum, so a
// changed list without a version bump fails loudly instead of silently admitting new words.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const VOKABULAR_DATEI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vokabular.json');

export type Familie = 'instrument' | 'effekt';
export interface VokabularInhalt {
  familien: Record<Familie, Record<string, string[]>>;
  charakter: string[];
  gegensaetze: [string, string][];
  genre: string[];
  einsatz: string[];
  energie: { min: number; max: number };
  text: { max_zeichen: number };
  // What each character word means and how it is carried out (since version 2): the shared meaning across waves
  bedeutung: Record<string, Bedeutung>;
}
export interface Bedeutung { sinn: string; messgroesse: string; eingriff: string; beleg: string }
export interface Vokabular {
  version: number;
  pruefsumme: string;
  inhalt: VokabularInhalt;
  // derived lookup: kind → family (a kind name exists in exactly one family)
  familieVon: Map<string, Familie>;
}
// A description as stored in a preset file under "beschreibung"
export interface Beschreibung {
  art: string;
  unterart: string;
  charakter: string[];
  genre: string[];
  einsatz: string[];
  energie: number;
  text: string;
}
// Machine-readable validation error; `erlaubt` lists the admissible words so an agent can correct itself
export interface BeschreibungsFehler { feld: string; code: string; wert?: unknown; erlaubt?: string[] }

export class VokabularFehler extends Error {}

export const FELDER = ['art', 'unterart', 'charakter', 'genre', 'einsatz', 'energie', 'text'] as const;
// How many tags a list may carry (P-V4): enough to classify, too few to tag everything with everything
export const ANZAHL: Record<'charakter' | 'genre' | 'einsatz', [number, number]> = {
  charakter: [1, 6], genre: [0, 6], einsatz: [1, 5],
};
const WORT = /^[a-z][a-z0-9_]*$/;

// Canonical JSON: keys sorted at every level, so the same content always gives the same bytes
export function kanonisch(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(kanonisch).join(',')}]`;
  if (x !== null && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${kanonisch(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(x);
}
export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
export const inhaltPruefsumme = (inhalt: unknown): string => sha256(kanonisch(inhalt)).slice(0, 16);

// Structural checks of the vocabulary itself: words well-formed and unique, kinds unique across families, opposites known
function pruefeInhalt(i: VokabularInhalt): void {
  const fehler: string[] = [];
  const liste = (name: string, l: unknown): void => {
    if (!Array.isArray(l) || l.length === 0) { fehler.push(`${name}: not a non-empty list`); return; }
    const s = new Set<string>();
    for (const w of l) {
      if (typeof w !== 'string' || !WORT.test(w)) fehler.push(`${name}: malformed word ${JSON.stringify(w)}`);
      else if (s.has(w)) fehler.push(`${name}: duplicate word ${w}`);
      else s.add(w);
    }
  };
  const arten = new Set<string>();
  for (const fam of ['instrument', 'effekt'] as const) {
    const f = i.familien?.[fam];
    if (!f || typeof f !== 'object') { fehler.push(`familien.${fam} missing`); continue; }
    for (const [art, unter] of Object.entries(f)) {
      if (!WORT.test(art)) fehler.push(`familien.${fam}: malformed kind ${art}`);
      if (arten.has(art)) fehler.push(`kind ${art} appears in more than one family`);
      arten.add(art);
      liste(`familien.${fam}.${art}`, unter);
    }
  }
  if (i.familien && Object.keys(i.familien).some((k) => k !== 'instrument' && k !== 'effekt')) fehler.push('familien: only instrument and effekt');
  liste('charakter', i.charakter); liste('genre', i.genre); liste('einsatz', i.einsatz);
  for (const p of i.gegensaetze ?? []) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((w) => i.charakter?.includes(w))) fehler.push(`gegensaetze: ${JSON.stringify(p)} is not a pair of character words`);
  }
  const bed = i.bedeutung;
  if (!bed || typeof bed !== 'object' || Array.isArray(bed)) fehler.push('bedeutung: needs one entry per character word');
  else {
    for (const w of i.charakter ?? []) if (!bed[w]) fehler.push(`bedeutung: character word ${w} has no meaning`);
    for (const [w, b] of Object.entries(bed)) {
      if (!i.charakter?.includes(w)) fehler.push(`bedeutung: ${w} is not a character word`);
      else for (const k of ['sinn', 'messgroesse', 'eingriff', 'beleg'] as const) {
        if (typeof b?.[k] !== 'string' || b[k].trim() === '') fehler.push(`bedeutung.${w}.${k}: needs a non-empty text`);
      }
    }
  }
  const e = i.energie;
  if (!e || !Number.isInteger(e.min) || !Number.isInteger(e.max) || e.min >= e.max) fehler.push('energie: needs integer min < max');
  if (!i.text || !Number.isInteger(i.text.max_zeichen) || i.text.max_zeichen < 20) fehler.push('text.max_zeichen: integer >= 20');
  if (fehler.length) throw new VokabularFehler(`vocabulary invalid: ${fehler.join('; ')}`);
}

// Parses and checks a vocabulary object (P-V2): checksum of `inhalt` must equal `pruefsumme`, and the last `verlauf`
// entry must carry the same version and checksum; versions in `verlauf` rise strictly and no checksum repeats.
export function pruefeVokabular(roh: unknown): Vokabular {
  const v = roh as { version?: unknown; pruefsumme?: unknown; verlauf?: unknown; inhalt?: VokabularInhalt };
  if (!v || typeof v !== 'object' || !v.inhalt) throw new VokabularFehler('vocabulary invalid: no inhalt');
  if (!Number.isInteger(v.version) || (v.version as number) < 1) throw new VokabularFehler('vocabulary invalid: version must be an integer >= 1');
  pruefeInhalt(v.inhalt);
  const ist = inhaltPruefsumme(v.inhalt);
  if (v.pruefsumme !== ist) {
    throw new VokabularFehler(`vocabulary changed without a version bump: pruefsumme ${String(v.pruefsumme)} recorded, content gives ${ist}. ` +
      'Raise version, append a verlauf entry with the new checksum and set pruefsumme.');
  }
  const verlauf = v.verlauf as { version: number; pruefsumme: string }[];
  if (!Array.isArray(verlauf) || verlauf.length === 0) throw new VokabularFehler('vocabulary invalid: verlauf missing');
  const letzter = verlauf[verlauf.length - 1];
  if (letzter.version !== v.version || letzter.pruefsumme !== ist) throw new VokabularFehler('vocabulary invalid: last verlauf entry must match version and pruefsumme');
  const summen = new Set<string>();
  verlauf.forEach((e, n) => {
    if (n > 0 && !(e.version > verlauf[n - 1].version)) throw new VokabularFehler('vocabulary invalid: verlauf versions must rise strictly');
    if (summen.has(e.pruefsumme)) throw new VokabularFehler(`vocabulary invalid: checksum ${e.pruefsumme} appears twice in verlauf (content changed back without a new version?)`);
    summen.add(e.pruefsumme);
  });
  const familieVon = new Map<string, Familie>();
  for (const fam of ['instrument', 'effekt'] as const) for (const art of Object.keys(v.inhalt.familien[fam])) familieVon.set(art, fam);
  return { version: v.version as number, pruefsumme: ist, inhalt: v.inhalt, familieVon };
}

export function ladeVokabular(datei: string = VOKABULAR_DATEI): Vokabular {
  return pruefeVokabular(JSON.parse(fs.readFileSync(datei, 'utf8')));
}

// One sentence (P-V5): no line break, ends with . ! or ?, no sentence end inside (". " followed by a capital letter)
function istEinSatz(t: string): boolean {
  if (/[\r\n]/.test(t)) return false;
  if (!/[.!?]$/.test(t)) return false;
  return !/[.!?]\s+[A-ZÄÖÜ]/.test(t.slice(0, -1));
}

// Validates one description against the vocabulary. Returns all errors at once (empty list = valid).
export function pruefeBeschreibung(b: unknown, vok: Vokabular): BeschreibungsFehler[] {
  const f: BeschreibungsFehler[] = [];
  if (!b || typeof b !== 'object' || Array.isArray(b)) return [{ feld: 'beschreibung', code: 'typ', wert: b }];
  const o = b as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(FELDER as readonly string[]).includes(k)) f.push({ feld: k, code: 'unbekanntes_feld', erlaubt: [...FELDER] });
  for (const k of FELDER) if (o[k] === undefined) f.push({ feld: k, code: 'fehlt' });
  const I = vok.inhalt;

  let unterarten: string[] | null = null;
  if (o.art !== undefined) {
    const fam = typeof o.art === 'string' ? vok.familieVon.get(o.art) : undefined;
    if (!fam) f.push({ feld: 'art', code: 'unbekanntes_wort', wert: o.art, erlaubt: [...vok.familieVon.keys()] });
    else unterarten = I.familien[fam][o.art as string];
  }
  if (o.unterart !== undefined && unterarten && (typeof o.unterart !== 'string' || !unterarten.includes(o.unterart))) {
    f.push({ feld: 'unterart', code: 'unbekanntes_wort', wert: o.unterart, erlaubt: unterarten });
  }
  for (const feld of ['charakter', 'genre', 'einsatz'] as const) {
    const l = o[feld];
    if (l === undefined) continue;
    if (!Array.isArray(l)) { f.push({ feld, code: 'typ', wert: l }); continue; }
    const erlaubt = I[feld];
    const gesehen = new Set<unknown>();
    for (const w of l) {
      if (typeof w !== 'string' || !erlaubt.includes(w)) f.push({ feld, code: 'unbekanntes_wort', wert: w, erlaubt });
      else if (gesehen.has(w)) f.push({ feld, code: 'doppelt', wert: w });
      gesehen.add(w);
    }
    const [min, max] = ANZAHL[feld];
    if (l.length < min || l.length > max) f.push({ feld, code: 'anzahl', wert: l.length, erlaubt: [`${min}..${max}`] });
  }
  if (Array.isArray(o.charakter)) {
    for (const [a, b2] of I.gegensaetze) if (o.charakter.includes(a) && o.charakter.includes(b2)) f.push({ feld: 'charakter', code: 'widerspruch', wert: [a, b2] });
  }
  if (o.energie !== undefined && (!Number.isInteger(o.energie) || (o.energie as number) < I.energie.min || (o.energie as number) > I.energie.max)) {
    f.push({ feld: 'energie', code: 'bereich', wert: o.energie, erlaubt: [`${I.energie.min}..${I.energie.max}`] });
  }
  if (o.text !== undefined) {
    if (typeof o.text !== 'string') f.push({ feld: 'text', code: 'typ', wert: o.text });
    else {
      const t = o.text;
      if (t !== t.trim() || t.length < 10 || t.length > I.text.max_zeichen) f.push({ feld: 'text', code: 'laenge', wert: t.length, erlaubt: [`10..${I.text.max_zeichen}, no surrounding spaces`] });
      if (!istEinSatz(t)) f.push({ feld: 'text', code: 'satz', wert: t });
    }
  }
  return f;
}

// Readable one-liner per error, for logs and the command line tool
export const fehlerText = (e: BeschreibungsFehler): string =>
  `${e.feld}: ${e.code}${e.wert !== undefined ? ` (${JSON.stringify(e.wert)})` : ''}${e.erlaubt ? ` allowed: ${e.erlaubt.slice(0, 40).join(', ')}` : ''}`;
