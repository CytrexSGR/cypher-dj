// Presets (package 1.16 "Browser"): data model, names, validation. No file access here (speicher.ts), no HTTP (bereich.ts).
// Every product decision behind these rules is written down in ENTSCHEIDUNGEN.md; change both together.
import { GERAETE, geraetVon, paramVon, type GeraetDef, type GeraetTyp } from './geraete.ts';
import { FELDER, pruefeBeschreibung, fehlerText, type Beschreibung, type BeschreibungsFehler, type Familie, type Vokabular } from './vokabular.ts';
export { PRESET_ID } from './preset_id.ts';

export const SCHEMA = 1;
export type Herkunft = 'werk' | 'nutzer';   // werk: factory, shipped read-only with the repository; nutzer: saved by the user
export const HERKUENFTE: readonly Herkunft[] = ['werk', 'nutzer'];
export type Wert = number | boolean | string;

// One preset file (<ordner>/<geraet>/<slug>.preset.json). Herkunft and slug are not stored: they follow from where the file lives.
// beschreibung is required and checked against the closed vocabulary (vokabular.json, ENTSCHEIDUNGEN.md P-V1..P-V6).
export const ENDUNG = '.preset.json';
export const DATEINAME = /^([a-z0-9][a-z0-9-]{0,47})\.preset\.json$/;
export interface Preset {
  schema: 1;
  name: string;
  geraet_typ: GeraetTyp;
  geraet: string;
  graph?: string;          // 1.16 F2: the Baukasten graph name; required for baukasten, forbidden otherwise
  werte: Record<string, Wert>;
  beschreibung: Beschreibung;
  tags: string[];
  notiz: string;
  autor?: 'cypher';        // 1.16 F4/F13: saved by Cypher; absent = Andreas. Not part of klang.
  angelegt: string;
  geaendert: string;
}
export interface Eintrag {
  herkunft: Herkunft; geraet: string; geraet_typ: GeraetTyp | null; slug: string; name: string; tags: string[]; geaendert: string | null;
  beschreibung: Beschreibung | null; familie: Familie | null;   // null only for a damaged file (fehler set)
  fehler?: string;
  autor?: 'cypher';
}

// Limits (ENTSCHEIDUNGEN.md "Naming rules")
export const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const NAME_MAX = 64;
export const TAG = /^[a-z0-9][a-z0-9 -]{0,23}$/;
export const TAGS_MAX = 16;
export const NOTIZ_MAX = 500;
export const DATEI_MAX = 256 * 1024;   // a preset of the biggest device (EQ, 58 parameters) is about 3 KB
// Graph name of a Baukasten preset: a copy of BK_GRAPH_NAME in projekt/modell.ts (not imported: that module pulls in the project
// model); tests/presets_speicher.test.mjs pins both equal.
export const GRAPH_NAME = /^[a-z0-9_-]{1,32}$/;
const STEUER = /[\u0000-\u001f\u007f-\u009f]/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

// details: for beschreibung_ungueltig and anfrage_ungueltig every single error with the admissible words (erlaubt), so the page
// and an agent can show or correct them (ENTSCHEIDUNGEN.md P-V3)
export class PresetFehler extends Error {
  readonly code: number; readonly fehler: string; readonly text: string; readonly details?: BeschreibungsFehler[];
  constructor(code: number, fehler: string, text?: string, details?: BeschreibungsFehler[]) {
    super(fehler); this.code = code; this.fehler = fehler; this.text = text ?? PRESET_TEXT[fehler] ?? `request refused (${fehler})`;
    if (details) this.details = details;
  }
}
// English texts for the page (http/gruende.ts is not ours to extend; the reasons stay local to this module)
export const PRESET_TEXT: Readonly<Record<string, string>> = {
  name_ungueltig: `the name needs 1 to ${NAME_MAX} characters with at least one letter or digit, no control characters`,
  name_vergeben: 'a preset with this name already exists for this device',
  slug_ungueltig: 'not a valid preset name in the address',
  herkunft_ungueltig: 'the origin must be werk (factory) or nutzer (user)',
  geraet_unbekannt: 'unknown device',
  geraet_typ_falsch: 'the device type does not match the device',
  werte_ungueltig: 'werte must be an object with at least one parameter',
  parameter_unbekannt: 'the device has no parameter of this name',
  wert_ungueltig: 'a parameter value has the wrong type or is out of range',
  tags_ungueltig: `up to ${TAGS_MAX} tags, each 1 to 24 characters a-z, 0-9, space or dash`,
  notiz_ungueltig: `the note may have up to ${NOTIZ_MAX} characters`,
  beschreibung_ungueltig: 'the description is not valid: kind, sub-kind, character, genre, use, energy and one sentence, with words from the vocabulary',
  anfrage_ungueltig: 'the search uses a field or word that is not in the vocabulary',
  unbekannt: 'no such preset',
  json_kaputt: 'the preset file is not readable JSON; it was left untouched',
  schema_unbekannt: 'the preset file has a schema version this page does not know',
  preset_ungueltig: 'the preset file is damaged; it was left untouched',
  zu_gross: 'the preset file is too large',
  werk_schreibgeschuetzt: 'factory presets cannot be changed; save a copy under a new name',
  veraltet: 'the preset was changed elsewhere in the meantime; reload and try again',
  preset_busy: 'another program is writing this device\'s presets right now; try again',
  koerper_ungueltig: 'the request body must be a JSON object',
  nicht_gefunden: 'no such preset route',
  // package 1.16 rest
  graph_fehlt: 'a Baukasten preset needs the name of its graph (graph)',
  graph_verboten: 'only a Baukasten preset carries a graph name',
  graph_ungueltig: 'the graph name needs 1 to 32 characters a-z, 0-9, _ or -',
  nur_andreas_preset: 'Cypher may change only presets she saved herself; this one is Andreas\'',
  kein_ziel: 'this device has no running instance in PRODUCTION to apply the preset to (the return hall is the kern\'s own hall)',
  art_nicht_aktiv: 'this insert kind is not active yet (slice 4b); the preset cannot be applied to an insert stage',
  geraet_passt_nicht: 'the preset belongs to another device than the target',
  graph_anders: 'the Baukasten preset belongs to another graph than the one on the track',
  kein_projekt: 'no project is open',
  ziel_unbekannt: 'no such target (track, insert stage, strip or channel)',
  kanal_art: 'this channel kind does not carry the device',
  preset_id_ungueltig: 'not a preset id <werk|nutzer>:<geraet>/<slug>',
};

// Search text and slug: lower case, umlauts spelled out, accents dropped (same rule as slugVon in sammlung.ts)
export function falte(s: string): string {
  return s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '');
}
export function slugVon(name: string): string {
  return falte(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
}

export function pruefeName(roh: unknown): string {
  if (typeof roh !== 'string') throw new PresetFehler(400, 'name_ungueltig');
  const n = roh.trim().replace(/\s+/g, ' ');
  if (n.length < 1 || n.length > NAME_MAX || STEUER.test(roh) || slugVon(n) === '') throw new PresetFehler(400, 'name_ungueltig');
  return n;
}
export function pruefeSlug(s: unknown): string {
  if (typeof s !== 'string' || !SLUG.test(s)) throw new PresetFehler(400, 'slug_ungueltig');
  return s;
}
export function pruefeHerkunft(h: unknown): Herkunft {
  if (typeof h !== 'string' || !(HERKUENFTE as readonly string[]).includes(h)) throw new PresetFehler(400, 'herkunft_ungueltig');
  return h as Herkunft;
}
export function pruefeGeraet(id: unknown): GeraetDef {
  const g = typeof id === 'string' ? geraetVon(id) : undefined;
  if (!g) throw new PresetFehler(400, 'geraet_unbekannt');
  return g;
}
export function pruefeTags(roh: unknown): string[] {
  if (roh === undefined || roh === null) return [];
  if (!Array.isArray(roh) || roh.length > TAGS_MAX) throw new PresetFehler(400, 'tags_ungueltig');
  const aus: string[] = [];
  for (const t of roh) {
    if (typeof t !== 'string') throw new PresetFehler(400, 'tags_ungueltig');
    const k = falte(t.trim()).replace(/\s+/g, ' ');
    if (!TAG.test(k)) throw new PresetFehler(400, 'tags_ungueltig');
    if (!aus.includes(k)) aus.push(k);
  }
  return aus;
}
export function pruefeNotiz(roh: unknown): string {
  if (roh === undefined || roh === null) return '';
  if (typeof roh !== 'string' || roh.length > NOTIZ_MAX) throw new PresetFehler(400, 'notiz_ungueltig');
  return roh;
}

// Parameter values by stable name. streng (writing): an unknown name is refused. Not streng (reading a file): unknown names are
// dropped and reported in `verworfen`, so a preset survives a plugin version that removed a parameter (ENTSCHEIDUNGEN.md D6).
export function pruefeWerte(g: GeraetDef, roh: unknown, streng: boolean): { werte: Record<string, Wert>; verworfen: string[] } {
  if (roh === null || typeof roh !== 'object' || Array.isArray(roh)) throw new PresetFehler(400, 'werte_ungueltig');
  const eintraege = Object.entries(roh as Record<string, unknown>);
  if (eintraege.length < 1 || eintraege.length > g.parameter.length + 64) throw new PresetFehler(400, 'werte_ungueltig');
  const werte: Record<string, Wert> = {}, verworfen: string[] = [];
  for (const [name, w] of eintraege) {
    const p = paramVon(g, name);
    if (!p) {
      if (streng) throw new PresetFehler(400, 'parameter_unbekannt', `${g.titel} has no parameter "${name.slice(0, 40)}"`);
      verworfen.push(name);
      continue;
    }
    const d = p.def;
    const gut = d.art === 'zahl' ? typeof w === 'number' && Number.isFinite(w) && w >= d.min && w <= d.max
      : d.art === 'schalter' ? typeof w === 'boolean'
        : typeof w === 'string' && d.werte.includes(w);
    if (!gut) {
      const soll = d.art === 'zahl' ? `a number from ${d.min} to ${d.max}` : d.art === 'schalter' ? 'true or false' : `one of ${d.werte.join(', ')}`;
      throw new PresetFehler(400, 'wert_ungueltig', `${p.titel} (${name}) must be ${soll}`);
    }
    werte[name] = w as Wert;
  }
  if (Object.keys(werte).length === 0) throw new PresetFehler(400, 'werte_ungueltig');
  return { werte, verworfen };
}

// The description against the vocabulary, plus one rule the vocabulary alone cannot know: the kind's family must be the device
// type (a compressor preset cannot be described as a bass). Rejects, never repairs (P-V3). code: 400 for input, 409 for a file.
export function pruefeBeschreibungFuer(g: GeraetDef, roh: unknown, vok: Vokabular, code: number): Beschreibung {
  const f = pruefeBeschreibung(roh, vok);
  const o = roh as Record<string, unknown>;
  if (!f.length && vok.familieVon.get(o.art as string) !== g.typ) {
    f.push({ feld: 'art', code: 'familie', wert: o.art, erlaubt: Object.keys(vok.inhalt.familien[g.typ]) });
  }
  if (f.length) throw new PresetFehler(code, 'beschreibung_ungueltig', `${PRESET_TEXT.beschreibung_ungueltig}; ${f.map(fehlerText).join('; ')}`, f);
  // stored in the fixed field order of FELDER, lists copied
  return Object.fromEntries(FELDER.map((k) => [k, Array.isArray(o[k]) ? [...(o[k] as string[])] : o[k]])) as unknown as Beschreibung;
}

// 1.16 F2: graph is required for baukasten and refused for every other device (code 400; a file turns it into 409 preset_ungueltig)
export function pruefeGraph(g: GeraetDef, roh: unknown): { graph?: string } {
  if (g.id !== 'baukasten') {
    if (roh !== undefined) throw new PresetFehler(400, 'graph_verboten');
    return {};
  }
  if (roh === undefined) throw new PresetFehler(400, 'graph_fehlt');
  if (typeof roh !== 'string' || !GRAPH_NAME.test(roh)) throw new PresetFehler(400, 'graph_ungueltig');
  return { graph: roh };
}

export interface NeuEingabe { name: unknown; geraet: unknown; geraet_typ?: unknown; graph?: unknown; werte: unknown; beschreibung: unknown; tags?: unknown; notiz?: unknown }
// A new or overwritten preset from user input (strict). The timestamps are set by the store.
export function pruefeEingabe(e: NeuEingabe, vok: Vokabular): Omit<Preset, 'angelegt' | 'geaendert'> {
  const g = pruefeGeraet(e.geraet);
  if (e.geraet_typ !== undefined && e.geraet_typ !== g.typ) throw new PresetFehler(400, 'geraet_typ_falsch');
  return { schema: SCHEMA, name: pruefeName(e.name), geraet_typ: g.typ, geraet: g.id, ...pruefeGraph(g, e.graph), werte: pruefeWerte(g, e.werte, true).werte,
    beschreibung: pruefeBeschreibungFuer(g, e.beschreibung, vok, 400), tags: pruefeTags(e.tags), notiz: pruefeNotiz(e.notiz) };
}

// A preset read from disk. Every refusal is 409 (the request was fine, the file is not); the file itself is never changed.
// A description that does not pass the vocabulary is its own reason (beschreibung_ungueltig, with details), so the page can say
// what to fix; the file stays as it is and can be replaced by saving with ueberschreiben.
export function pruefeDatei(j: unknown, geraetOrdner: string, vok: Vokabular): Preset & { verworfen: string[] } {
  if (j === null || typeof j !== 'object' || Array.isArray(j)) throw new PresetFehler(409, 'preset_ungueltig');
  const o = j as Record<string, unknown>;
  if (o.schema !== SCHEMA) throw new PresetFehler(409, 'schema_unbekannt', `schema ${JSON.stringify(o.schema ?? null).slice(0, 20)}; this page reads schema ${SCHEMA}`);
  try {
    const g = pruefeGeraet(o.geraet);
    if (g.id !== geraetOrdner || o.geraet_typ !== g.typ) throw new PresetFehler(409, 'preset_ungueltig');
    if (typeof o.angelegt !== 'string' || !ISO.test(o.angelegt) || typeof o.geaendert !== 'string' || !ISO.test(o.geaendert)) throw new PresetFehler(409, 'preset_ungueltig');
    const { werte, verworfen } = pruefeWerte(g, o.werte, false);
    const name = pruefeName(o.name), tags = pruefeTags(o.tags), notiz = pruefeNotiz(o.notiz);
    const beschreibung = pruefeBeschreibungFuer(g, o.beschreibung, vok, 409);
    const graph = pruefeGraph(g, o.graph);
    if (o.autor !== undefined && o.autor !== 'cypher') throw new PresetFehler(409, 'preset_ungueltig');
    return { schema: SCHEMA, name, geraet_typ: g.typ, geraet: g.id, ...graph, werte, beschreibung, tags, notiz, ...(o.autor === 'cypher' ? { autor: 'cypher' as const } : {}),
      angelegt: o.angelegt, geaendert: o.geaendert, verworfen };
  } catch (e) {
    if (e instanceof PresetFehler && e.code === 400) throw new PresetFehler(409, 'preset_ungueltig', `${PRESET_TEXT.preset_ungueltig} (${e.fehler})`);
    throw e;
  }
}

// Description filter, one implementation for the list (passt) and the register query (register.ts frage): kind, sub-kind,
// device, origin "any of"; character "all of"; genre and use "any of"; energy one value or a range (ENTSCHEIDUNGEN.md P-R5).
// The words are checked against the vocabulary before (register.ts pruefeAnfrage); here they are only compared.
export interface BeschreibungsFilter {
  familie?: Familie; art?: string[]; unterart?: string[]; charakter?: string[]; genre?: string[]; einsatz?: string[];
  energie?: number | { min?: number; max?: number };
}
const BESCHREIBUNGS_FILTER = ['familie', 'art', 'unterart', 'charakter', 'genre', 'einsatz', 'energie'] as const;
export const hatBeschreibungsFilter = (f: BeschreibungsFilter): boolean => BESCHREIBUNGS_FILTER.some((k) => f[k] !== undefined);
export function passtBeschreibung(b: Beschreibung | null, familie: Familie | null, f: BeschreibungsFilter): boolean {
  if (!hatBeschreibungsFilter(f)) return true;
  if (!b) return false;
  const emin = typeof f.energie === 'number' ? f.energie : f.energie?.min;
  const emax = typeof f.energie === 'number' ? f.energie : f.energie?.max;
  return (!f.familie || familie === f.familie)
    && (!f.art || f.art.includes(b.art)) && (!f.unterart || f.unterart.includes(b.unterart))
    && (!f.charakter || f.charakter.every((w) => b.charakter.includes(w)))
    && (!f.genre || f.genre.some((w) => b.genre.includes(w)))
    && (!f.einsatz || f.einsatz.some((w) => b.einsatz.includes(w)))
    && (emin === undefined || b.energie >= emin) && (emax === undefined || b.energie <= emax);
}

// Free-text search, one rule for the list, the register query and the page (oeffentlich/presets.js has its own copy): every word
// must occur in name, tags, note, device id, device title or the description (sentence and words); folded, "_" equals a space.
export function suchWoerter(q: string | undefined): string[] { return falte(q ?? '').replace(/_/g, ' ').split(/\s+/).filter(Boolean); }
export function heuhaufen(e: { name: string; tags?: string[]; notiz?: string; geraet: string; beschreibung?: Beschreibung | null }): string {
  const b = e.beschreibung;
  const teile = [e.name, ...(e.tags ?? []), e.notiz ?? '', e.geraet, GERAETE.find((g) => g.id === e.geraet)?.titel ?? ''];
  if (b) teile.push(b.text, b.art, b.unterart, ...b.charakter, ...b.genre, ...b.einsatz);
  return falte(teile.join(' ')).replace(/_/g, ' ');
}

// Search over a list: q as above; tag, geraet, geraet_typ and herkunft filter exactly; then the description filter.
export interface Filter extends BeschreibungsFilter { q?: string; tag?: string; geraet?: string; geraet_typ?: string; herkunft?: string }
export function passt(e: Eintrag & { notiz?: string }, f: Filter): boolean {
  if (f.geraet && e.geraet !== f.geraet) return false;
  if (f.geraet_typ && e.geraet_typ !== f.geraet_typ) return false;
  if (f.herkunft && e.herkunft !== f.herkunft) return false;
  if (f.tag && !e.tags.includes(falte(f.tag.trim()))) return false;
  if (!passtBeschreibung(e.beschreibung ?? null, e.familie ?? null, f)) return false;
  const woerter = suchWoerter(f.q);
  if (woerter.length === 0) return true;
  const heu = heuhaufen(e);
  return woerter.every((w) => heu.includes(w));
}
// User presets first (they are what the user made), then factory; within each by folded name, then slug
export function sortiere<T extends Eintrag>(l: T[]): T[] {
  const rang = (h: Herkunft): number => (h === 'nutzer' ? 0 : 1);
  return l.sort((a, b) => rang(a.herkunft) - rang(b.herkunft) || a.geraet.localeCompare(b.geraet) || falte(a.name).localeCompare(falte(b.name)) || a.slug.localeCompare(b.slug));
}
