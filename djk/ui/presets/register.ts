// Preset register (presets/DECISIONS.md, P-R1..P-R7): one index over exactly what the preset store holds (store.ts:
// werk = factory, nutzer = user). Every entry carries a stable id, its origin, device, path, the description fields and content
// hashes. bauen() reads the store, pruefe() compares a stored register with the store (missing, orphaned, duplicate, changed,
// invalid), frage() filters it, shaped so it can be offered to agents as a tool (frageSchema).
// The register never parses preset files itself: reading, naming and validation live only in store.ts and model.ts, so the
// register cannot disagree with the store about what a preset is.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kanonisch, sha256, fehlerText, type Vokabular, type Beschreibung, type BeschreibungsFehler, type Familie } from './vocabulary.ts';
import { GERAET_IDS } from './devices.ts';
import { ENDUNG, HERKUENFTE, PresetFehler, heuhaufen, passtBeschreibung, suchWoerter, type Herkunft } from './model.ts';
import type { PresetSpeicher } from './store.ts';
export { PRESET_ID } from './preset_id.ts';

export const PRESETS_ORDNER = path.dirname(fileURLToPath(import.meta.url));
export const WERK_REGISTER = path.join(PRESETS_ORDNER, 'register.json');
export const REGISTER_FORMAT = 1;

export interface Eintrag extends Beschreibung {
  id: string;             // "<herkunft>:<geraet>/<slug>", e.g. werk:komp/drum-bus
  herkunft: Herkunft;
  geraet: string;
  slug: string;
  name: string;
  pfad: string;           // posix, relative to the origin's root: <geraet>/<slug>.preset.json
  tags: string[];
  familie: Familie;
  hash: string;           // sha256 of the canonical file content: any change shows
  klang: string;          // sha256 of {geraet, werte} (plus graph when present, 1.16 F2): the same sound saved twice shows as a duplicate
  autor?: 'cypher';       // 1.16 F4/F13: only when present, so the factory register lines do not change
}
export interface Register { format: number; vokabular: { version: number; pruefsumme: string }; eintraege: Eintrag[] }
export interface Ungueltig { id: string; herkunft: Herkunft; pfad: string; fehler: BeschreibungsFehler[] }
export interface Duplikat { art: 'id' | 'klang'; ids: string[] }
export interface Aenderung { id: string; teile: ('klang' | 'beschreibung' | 'name' | 'geraet' | 'sonstiges')[] }
export interface Drift {
  sauber: boolean;
  fehlend: string[];       // in the register, file gone
  verwaist: string[];      // valid file in the store, not in the register
  doppelt: Duplikat[];     // same id twice in the stored register, or the same sound in several files
  geaendert: Aenderung[];  // in both, content hash differs
  ungueltig: Ungueltig[];  // file in the store that cannot be read or fails validation (also its description)
  vokabular_veraltet: boolean;  // register built against another vocabulary version
}

export class FrageFehler extends Error {
  readonly fehler: BeschreibungsFehler[];
  constructor(fehler: BeschreibungsFehler[]) { super(`invalid query: ${fehler.map(fehlerText).join('; ')}`); this.fehler = fehler; }
}

export const idVon = (herkunft: Herkunft, geraet: string, slug: string): string => `${herkunft}:${geraet}/${slug}`;

function pruefeHerkuenfte(herkuenfte: readonly Herkunft[]): void {
  const gesehen = new Set<string>();
  for (const h of herkuenfte) {
    if (!HERKUENFTE.includes(h)) throw new Error(`unknown preset origin ${String(h)}`);
    if (gesehen.has(h)) throw new Error(`preset origin ${h} given twice`);
    gesehen.add(h);
  }
}

// Everything the store lists for the given origins: valid presets as entries, damaged ones with their reasons
function lese(speicher: PresetSpeicher, herkuenfte: readonly Herkunft[]): { eintraege: Eintrag[]; ungueltig: Ungueltig[] } {
  pruefeHerkuenfte(herkuenfte);
  const eintraege: Eintrag[] = [], ungueltig: Ungueltig[] = [];
  for (const e of speicher.liste()) {
    if (!herkuenfte.includes(e.herkunft)) continue;
    const id = idVon(e.herkunft, e.geraet, e.slug), pfad = `${e.geraet}/${e.slug}${ENDUNG}`;
    try {
      const p = speicher.lies(e.herkunft, e.geraet, e.slug);
      const b = p.beschreibung;
      eintraege.push({
        id, herkunft: e.herkunft, geraet: p.geraet, slug: e.slug, name: p.name, pfad, tags: [...p.tags],
        familie: speicher.vok.familieVon.get(b.art) as Familie,
        art: b.art, unterart: b.unterart, charakter: [...b.charakter], genre: [...b.genre], einsatz: [...b.einsatz], energie: b.energie, text: b.text,
        hash: p.hash, klang: sha256(kanonisch({ geraet: p.geraet, werte: p.werte, ...(p.graph ? { graph: p.graph } : {}) })),
        ...(p.autor ? { autor: p.autor } : {}),
      });
    } catch (x) {
      if (!(x instanceof PresetFehler)) throw x;
      ungueltig.push({ id, herkunft: e.herkunft, pfad, fehler: x.details ?? [{ feld: 'datei', code: x.fehler, wert: x.text }] });
    }
  }
  eintraege.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  ungueltig.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { eintraege, ungueltig };
}

function klangDuplikate(eintraege: readonly Eintrag[]): Duplikat[] {
  const nach = new Map<string, string[]>();
  for (const e of eintraege) nach.set(e.klang, [...(nach.get(e.klang) ?? []), e.id]);
  return [...nach.values()].filter((ids) => ids.length > 1).map((ids) => ({ art: 'klang' as const, ids }));
}

// Rebuilds the register from the store. Invalid files are left out and reported; they never reach a query.
export function bauen(speicher: PresetSpeicher, herkuenfte: readonly Herkunft[] = HERKUENFTE): { register: Register; ungueltig: Ungueltig[]; doppelt: Duplikat[] } {
  const { eintraege, ungueltig } = lese(speicher, herkuenfte);
  return {
    register: { format: REGISTER_FORMAT, vokabular: { version: speicher.vok.version, pruefsumme: speicher.vok.pruefsumme }, eintraege },
    ungueltig, doppelt: klangDuplikate(eintraege),
  };
}

const BESCHREIBUNGS_FELDER = ['art', 'unterart', 'charakter', 'genre', 'einsatz', 'energie', 'text'] as const;

// Compares a stored register with the store. Only the given origins are looked at: entries of other origins in the register
// are neither missing nor checked (a factory-only check does not flag user presets).
export function pruefe(gespeichert: Register, speicher: PresetSpeicher, herkuenfte: readonly Herkunft[] = HERKUENFTE): Drift {
  const { eintraege, ungueltig } = lese(speicher, herkuenfte);
  const alt = gespeichert.eintraege.filter((e) => herkuenfte.includes(e.herkunft));
  const zaehl = new Map<string, number>();
  for (const e of gespeichert.eintraege) zaehl.set(e.id, (zaehl.get(e.id) ?? 0) + 1);
  const doppelt: Duplikat[] = [...zaehl].filter(([, n]) => n > 1).map(([id, n]) => ({ art: 'id' as const, ids: Array(n).fill(id) }));
  doppelt.push(...klangDuplikate(eintraege));

  const altNach = new Map(alt.map((e) => [e.id, e]));
  const neuNach = new Map(eintraege.map((e) => [e.id, e]));
  const ungueltigeIds = new Set(ungueltig.map((u) => u.id));
  // an entry whose file still exists but became invalid is reported as invalid, not as missing
  const fehlend = [...altNach.keys()].filter((id) => !neuNach.has(id) && !ungueltigeIds.has(id));
  const verwaist = [...neuNach.keys()].filter((id) => !altNach.has(id));
  const geaendert: Aenderung[] = [];
  for (const [id, n] of neuNach) {
    const a = altNach.get(id);
    if (!a || a.hash === n.hash) continue;
    const teile: Aenderung['teile'] = [];
    if (a.klang !== n.klang) teile.push('klang');
    if (BESCHREIBUNGS_FELDER.some((k) => kanonisch(a[k]) !== kanonisch(n[k]))) teile.push('beschreibung');
    if (a.name !== n.name) teile.push('name');
    if (a.geraet !== n.geraet) teile.push('geraet');
    if (!teile.length) teile.push('sonstiges');
    geaendert.push({ id, teile });
  }
  const vok = speicher.vok;
  const vokabular_veraltet = gespeichert.vokabular?.version !== vok.version || gespeichert.vokabular?.pruefsumme !== vok.pruefsumme;
  return {
    sauber: !fehlend.length && !verwaist.length && !doppelt.length && !geaendert.length && !ungueltig.length && !vokabular_veraltet,
    fehlend, verwaist, doppelt, geaendert, ungueltig, vokabular_veraltet,
  };
}

export function liesRegister(datei: string): Register {
  const r = JSON.parse(fs.readFileSync(datei, 'utf8')) as Register;
  if (!r || r.format !== REGISTER_FORMAT || !Array.isArray(r.eintraege)) throw new Error(`${datei}: not a preset register of format ${REGISTER_FORMAT}`);
  return r;
}
// Written atomically (temp file + rename), one entry per line so a diff shows which preset changed
export function schreibeRegister(datei: string, r: Register): void {
  const zeilen = r.eintraege.map((e) => `    ${JSON.stringify(e)}`).join(',\n');
  const text = `{\n  "format": ${r.format},\n  "vokabular": ${JSON.stringify(r.vokabular)},\n  "eintraege": [\n${zeilen}${zeilen ? '\n' : ''}  ]\n}\n`;
  const tmp = `${datei}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, datei);
}

// ---- query (P-R5) ----
export interface Anfrage {
  familie?: Familie;
  art?: string[];
  unterart?: string[];
  charakter?: string[];      // all must be present
  genre?: string[];          // any
  einsatz?: string[];        // any
  energie?: number | { min?: number; max?: number };
  geraet?: string[];
  herkunft?: Herkunft[];
  text?: string;             // free text: every word must appear in name, tags, device, sentence or a description word
  grenze?: number;           // max results, default 50, at most 500
}
export interface Antwort { gesamt: number; treffer: Eintrag[] }
export const GRENZE = { standard: 50, max: 500 };
export const MAX_WOERTER = 12;
export const ANFRAGE_FELDER = ['familie', 'art', 'unterart', 'charakter', 'genre', 'einsatz', 'energie', 'geraet', 'herkunft', 'text', 'grenze'] as const;

export function alleUnterarten(vok: Vokabular): string[] {
  const s = new Set<string>();
  for (const fam of Object.values(vok.inhalt.familien)) for (const l of Object.values(fam)) for (const w of l) s.add(w);
  return [...s].sort();
}

// Checks a query against the vocabulary: unknown fields or words are rejected, never silently ignored (P-R6)
export function pruefeAnfrage(a: unknown, vok: Vokabular): BeschreibungsFehler[] {
  const f: BeschreibungsFehler[] = [];
  if (!a || typeof a !== 'object' || Array.isArray(a)) return [{ feld: 'anfrage', code: 'typ', wert: a }];
  const o = a as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(ANFRAGE_FELDER as readonly string[]).includes(k)) f.push({ feld: k, code: 'unbekanntes_feld', erlaubt: [...ANFRAGE_FELDER] });
  const I = vok.inhalt;
  const listen: Record<string, readonly string[]> = {
    art: [...vok.familieVon.keys()], unterart: alleUnterarten(vok), charakter: I.charakter, genre: I.genre, einsatz: I.einsatz,
    herkunft: HERKUENFTE, geraet: GERAET_IDS,
  };
  for (const [feld, erlaubt] of Object.entries(listen)) {
    const l = o[feld];
    if (l === undefined) continue;
    if (!Array.isArray(l) || l.length === 0 || l.length > 30) { f.push({ feld, code: 'typ', wert: l }); continue; }
    for (const w of l) if (typeof w !== 'string' || !erlaubt.includes(w)) f.push({ feld, code: 'unbekanntes_wort', wert: w, erlaubt: [...erlaubt] });
  }
  if (o.familie !== undefined && o.familie !== 'instrument' && o.familie !== 'effekt') f.push({ feld: 'familie', code: 'unbekanntes_wort', wert: o.familie, erlaubt: ['instrument', 'effekt'] });
  const { min, max } = I.energie;
  const inBereich = (x: unknown): boolean => Number.isInteger(x) && (x as number) >= min && (x as number) <= max;
  if (o.energie !== undefined) {
    const e = o.energie as { min?: unknown; max?: unknown };
    const ok = typeof o.energie === 'number' ? inBereich(o.energie)
      : !!e && typeof e === 'object' && !Array.isArray(e) && Object.keys(e).every((k) => k === 'min' || k === 'max')
        && (e.min === undefined || inBereich(e.min)) && (e.max === undefined || inBereich(e.max))
        && (e.min === undefined || e.max === undefined || (e.min as number) <= (e.max as number));
    if (!ok) f.push({ feld: 'energie', code: 'bereich', wert: o.energie, erlaubt: [`${min}..${max}`, '{min, max}'] });
  }
  if (o.text !== undefined) {
    if (typeof o.text !== 'string' || o.text.length > 200) f.push({ feld: 'text', code: 'typ', wert: o.text });
    else if (o.text.split(/\s+/).filter(Boolean).length > MAX_WOERTER) f.push({ feld: 'text', code: 'anzahl', erlaubt: [`at most ${MAX_WOERTER} words`] });
  }
  if (o.grenze !== undefined && (!Number.isInteger(o.grenze) || (o.grenze as number) < 1 || (o.grenze as number) > GRENZE.max)) {
    f.push({ feld: 'grenze', code: 'bereich', wert: o.grenze, erlaubt: [`1..${GRENZE.max}`] });
  }
  return f;
}

// Filters the register. Throws FrageFehler for an invalid query. Order: name, then id (stable across calls).
// The description part is the same matcher the store list uses (model.ts passtBeschreibung), and so is the free text.
export function frage(r: Register, anfrage: Anfrage, vok: Vokabular): Antwort {
  const f = pruefeAnfrage(anfrage, vok);
  if (f.length) throw new FrageFehler(f);
  const a = anfrage;
  const woerter = suchWoerter(a.text);
  const treffer = r.eintraege.filter((e) =>
    (!a.geraet || a.geraet.includes(e.geraet)) && (!a.herkunft || a.herkunft.includes(e.herkunft))
    && passtBeschreibung(e, e.familie, a)
    && (!woerter.length || (() => { const heu = `${heuhaufen({ ...e, beschreibung: e })} ${e.id}`; return woerter.every((w) => heu.includes(w)); })()));
  treffer.sort((x, y) => x.name.localeCompare(y.name, 'en') || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return { gesamt: treffer.length, treffer: treffer.slice(0, a.grenze ?? GRENZE.standard) };
}

// Tool definition for agents (P-R7): name, description and a JSON Schema whose enums come from the vocabulary and the device
// catalogue, so a tool-using model sees the closed word lists and cannot send an invented tag without a validation error.
export function frageSchema(vok: Vokabular): { name: string; description: string; input_schema: Record<string, unknown> } {
  const I = vok.inhalt;
  const liste = (werte: readonly string[], beschreibung: string): Record<string, unknown> => ({
    type: 'array', minItems: 1, maxItems: 30, description: beschreibung, items: { type: 'string', enum: [...werte] },
  });
  const stufe = { type: 'integer', minimum: I.energie.min, maximum: I.energie.max };
  return {
    name: 'presets_suchen',
    description: `Search the preset register (factory and user presets of the Cypher instruments and effects) by kind, character, genre, use, energy, device and free text. Vocabulary version ${vok.version}. Character tags must all match; genre and use match any. Returns {gesamt, treffer[]} with stable ids "<herkunft>:<geraet>/<slug>".`,
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        familie: { type: 'string', enum: ['instrument', 'effekt'], description: 'instrument or effect' },
        art: liste([...vok.familieVon.keys()], 'kind, any of'),
        unterart: liste(alleUnterarten(vok), 'sub-kind, any of'),
        charakter: liste(I.charakter, 'character tags, all must be present'),
        genre: liste(I.genre, 'genre tags, any of'),
        einsatz: liste(I.einsatz, 'use in a set or production, any of'),
        energie: { description: 'energy 1 (calm) .. 5 (peak): one value or a range', oneOf: [stufe, { type: 'object', additionalProperties: false, properties: { min: stufe, max: stufe } }] },
        geraet: liste(GERAET_IDS, 'device ids, any of'),
        herkunft: liste(HERKUENFTE, 'preset origin: werk = factory, nutzer = user'),
        text: { type: 'string', maxLength: 200, description: `free text, every word must match (at most ${MAX_WOERTER} words)` },
        grenze: { type: 'integer', minimum: 1, maximum: GRENZE.max, description: `max results, default ${GRENZE.standard}` },
      },
    },
  };
}
