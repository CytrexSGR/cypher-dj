// Collections (package 1.16 rest, decisions K1 and K2): a named list per user of samples, presets and devices. Model, names and
// validation only; no file access here (speicher.ts), no HTTP (bereich.ts). The DJ sets keep /sammlungen (sammlung.ts); collections
// have their own prefix /kollektionen and their own module (spec finding 1).
// References are not resolved here: the page shows an item it cannot find as missing, never drops it.
import { PRESET_ID } from '../presets/preset_id.ts';
import { SLUG, slugVon, GRAPH_NAME } from '../presets/modell.ts';

export const SCHEMA = 1;
export const MAX_POSTEN = 500;
export const MAX_KOLLEKTIONEN = 200;
export const NAME_MAX = 64;
export const DATEI_MAX = 256 * 1024;   // 500 items are about 50 KB
export { SLUG, slugVon };
const SHA = /^[0-9a-f]{64}$/;
const STEUER = /[\u0000-\u001f\u007f-\u009f]/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
// Device kinds a collection may hold: the instruments, the insert effects, and one Baukasten graph as bk:<graph>
export const GERAET_ARTEN: readonly string[] = ['rb338', 'surge', 'komp', 'eq', 'saett'];

export type Posten = { art: 'sample'; sha: string } | { art: 'preset'; id: string } | { art: 'geraet'; geraet: string };
export interface Kollektion { schema: 1; name: string; autor?: 'cypher'; angelegt: string; geaendert: string; posten: Posten[] }

export const KOLLEKTION_TEXT: Readonly<Record<string, string>> = {
  name_ungueltig: `the name needs 1 to ${NAME_MAX} characters with at least one letter or digit, no control characters`,
  name_vergeben: 'a collection with this name already exists',
  slug_ungueltig: 'not a valid collection name in the address',
  posten_ungueltig: 'an item must be {art: sample, sha}, {art: preset, id} or {art: geraet, geraet}',
  zu_viele: `at most ${MAX_POSTEN} items per collection and ${MAX_KOLLEKTIONEN} collections`,
  unbekannt: 'no such collection',
  nur_andreas_kollektion: 'Cypher may remove items from, rename or delete only collections she created; this one is Andreas\'',
  veraltet: 'the collection was changed elsewhere in the meantime; reload and try again',
  kollektion_busy: 'another program is writing the collections right now; try again',
  json_kaputt: 'the collection file is not readable JSON; it was left untouched',
  kollektion_ungueltig: 'the collection file is damaged; it was left untouched',
  zu_gross: 'the collection file is too large',
  koerper_ungueltig: 'the request body must be a JSON object',
  nicht_gefunden: 'no such collection route',
};

export class KollektionFehler extends Error {
  readonly code: number; readonly fehler: string; readonly text: string; readonly posten?: unknown;
  constructor(code: number, fehler: string, posten?: unknown) {
    super(fehler); this.code = code; this.fehler = fehler; this.text = KOLLEKTION_TEXT[fehler] ?? `request refused (${fehler})`;
    if (posten !== undefined) this.posten = posten;
  }
}

export function pruefeName(roh: unknown): string {
  if (typeof roh !== 'string') throw new KollektionFehler(400, 'name_ungueltig');
  const n = roh.trim().replace(/\s+/g, ' ');
  if (n.length < 1 || n.length > NAME_MAX || STEUER.test(roh) || slugVon(n) === '') throw new KollektionFehler(400, 'name_ungueltig');
  return n;
}
export function pruefeSlug(s: unknown): string {
  if (typeof s !== 'string' || !SLUG.test(s)) throw new KollektionFehler(400, 'slug_ungueltig');
  return s;
}

const nurFelder = (o: Record<string, unknown>, ...k: string[]): boolean => Object.keys(o).every((x) => k.includes(x));
// One item, closed fields; returns a fresh object in the fixed key order. code: 400 for input, 409 for a file.
export function pruefePosten(p: unknown, code = 400): Posten {
  const raus = (): never => { throw new KollektionFehler(code, code === 400 ? 'posten_ungueltig' : 'kollektion_ungueltig', p); };
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return raus();
  const o = p as Record<string, unknown>;
  if (o.art === 'sample' && nurFelder(o, 'art', 'sha') && typeof o.sha === 'string' && SHA.test(o.sha)) return { art: 'sample', sha: o.sha };
  if (o.art === 'preset' && nurFelder(o, 'art', 'id') && typeof o.id === 'string' && PRESET_ID.test(o.id)) return { art: 'preset', id: o.id };
  if (o.art === 'geraet' && nurFelder(o, 'art', 'geraet') && typeof o.geraet === 'string'
    && (GERAET_ARTEN.includes(o.geraet) || (o.geraet.startsWith('bk:') && GRAPH_NAME.test(o.geraet.slice(3))))) return { art: 'geraet', geraet: o.geraet };
  return raus();
}
export function postenListe(roh: unknown, code = 400): Posten[] {
  if (roh === undefined) return [];
  if (!Array.isArray(roh) || roh.length > MAX_POSTEN) throw new KollektionFehler(code, code === 400 ? 'posten_ungueltig' : 'kollektion_ungueltig', roh);
  return roh.map((p) => pruefePosten(p, code));
}
// Two items are the same item when kind and reference are equal
export const postenSchluessel = (p: Posten): string => (p.art === 'sample' ? `s:${p.sha}` : p.art === 'preset' ? `p:${p.id}` : `g:${p.geraet}`);

// A collection read from disk. Every refusal is 409; the file is never changed by reading.
export function pruefeDatei(j: unknown): Kollektion {
  if (j === null || typeof j !== 'object' || Array.isArray(j)) throw new KollektionFehler(409, 'kollektion_ungueltig');
  const o = j as Record<string, unknown>;
  if (o.schema !== SCHEMA || !nurFelder(o, 'schema', 'name', 'autor', 'angelegt', 'geaendert', 'posten')) throw new KollektionFehler(409, 'kollektion_ungueltig');
  if (o.autor !== undefined && o.autor !== 'cypher') throw new KollektionFehler(409, 'kollektion_ungueltig');
  if (typeof o.angelegt !== 'string' || !ISO.test(o.angelegt) || typeof o.geaendert !== 'string' || !ISO.test(o.geaendert)) throw new KollektionFehler(409, 'kollektion_ungueltig');
  let name: string;
  try { name = pruefeName(o.name); } catch { throw new KollektionFehler(409, 'kollektion_ungueltig'); }
  const posten = postenListe(o.posten, 409);
  if (new Set(posten.map(postenSchluessel)).size !== posten.length) throw new KollektionFehler(409, 'kollektion_ungueltig');
  return { schema: SCHEMA, name, ...(o.autor === 'cypher' ? { autor: 'cypher' as const } : {}), angelegt: o.angelegt, geaendert: o.geaendert, posten };
}
