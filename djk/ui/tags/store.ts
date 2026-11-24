// TagSpeicher: the page side of the tag store (tags.sqlite next to the catalogue). Reads, user and agent writes. The schema and the
// inheritance are the files under djk/bibliothek (read here by relative path, one source for both languages). The Python hook
// writes the measured rows; this class never writes `gemessen`.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { camelotNachbarn } from '../catalog.ts';
import { itemVokabular } from './vocabulary_item.ts';
import { EINWERTIG, TagFehler, pruefeItemId, pruefeTag, type TagHerkunft } from './model.ts';

export const SCHEMA_DATEI = fileURLToPath(new URL('../../bibliothek/tags_schema.sql', import.meta.url));
export const ERBE_DATEI = fileURLToPath(new URL('../../bibliothek/tags_erbe.sql', import.meta.url));
export const MAX_ITEMS = 500, MAX_TAGS = 20;
const BUSY_MS = 5000;
const ERBE_CHUNK = 500;   // derived rows per write transaction
const SUCHE_VORGABE = 100, SUCHE_MAX = 500;
const ANZAHL_MAX = 9999;
const ZAEHL_BUDGET_MS = 30;  // time one gespeichert() call may spend counting (at least one search is always counted)      // cap of the live count of a saved search
const VERWANDT_MAX = 500;     // cap of each relation list
const PASST_VORGABE = 20, PASST_MAX = 100, TEMPO_SPANNE = 0.06;
type Quelle = 'nutzer' | 'agent';
export interface BezugSatz { eigner: string; name?: string; relationen: ['made_from' | 'used_in', string, string][]; tags?: string[] }

// Statements of one of our SQL files (no semicolon inside a string or comment text)
export function anweisungen(sql: string): string[] {
  const ohne = sql.split('\n').filter((z) => !z.trim().startsWith('--')).join('\n');
  return ohne.split(';').map((t) => t.trim()).filter((t) => t.length > 0);
}
// Create or upgrade the schema once: only when PRAGMA user_version is below the number in the schema file, in one write transaction.
// A current store runs no statement of the file and takes no write lock (same rule as bibliothek/tags_store.py).
function schemaAnlegen(d: DatabaseSync): void {
  const sql = fs.readFileSync(SCHEMA_DATEI, 'utf8');
  const soll = Number(/^-- schema-version:\s*(\d+)/m.exec(sql)?.[1]);
  const ist = (): number => Number((d.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  if (ist() >= soll) return;
  d.exec('BEGIN IMMEDIATE');
  try {
    if (ist() < soll) {   // another opener may have been first
      for (const a of anweisungen(sql)) d.exec(a);
      d.exec(`PRAGMA user_version = ${soll}`);
    }
    d.exec('COMMIT');
  } catch (e) {
    try { d.exec('ROLLBACK'); } catch { /* not in a transaction */ }
    throw e;
  }
}

// Recompute the derived rows (tags_erbe.sql) for `items` and their descendants (undefined = the whole store). The computation reads
// only. The changes go out in transactions of at most ERBE_CHUNK rows, deletions first, and only where the result differs from the
// stored rows. Returns the number of rows written.
export function erbe(d: DatabaseSync, jetzt: number, items?: Iterable<string>, chunk: number = ERBE_CHUNK): number {
  d.exec('CREATE TEMP TABLE IF NOT EXISTS erbe_ziel(item TEXT PRIMARY KEY)');
  d.exec('DELETE FROM erbe_ziel');
  if (items === undefined) {
    d.exec("INSERT OR IGNORE INTO erbe_ziel SELECT von FROM relation WHERE art = 'made_from' UNION SELECT item FROM item_tag WHERE herkunft = 'abgeleitet' AND quelle = 'erbe'");
  } else {
    const ein = d.prepare('INSERT OR IGNORE INTO erbe_ziel(item) VALUES (?)');
    for (const i of items) ein.run(i);
  }
  for (const a of anweisungen(fs.readFileSync(ERBE_DATEI, 'utf8'))) d.exec(a);
  let geschrieben = 0;
  const schritte: [string, string][] = [
    ['erbe_weg', "DELETE FROM item_tag WHERE item = ? AND tag = ? AND herkunft = 'abgeleitet' AND quelle = 'erbe'"],
    ['erbe_dazu', "INSERT OR REPLACE INTO item_tag(item, tag, herkunft, quelle, an, wert, zeit) VALUES (?, ?, 'abgeleitet', 'erbe', 1, ?, ?)"],
  ];
  for (const [tabelle, sql] of schritte) {
    const lies = d.prepare(`SELECT rowid AS rid, * FROM temp.${tabelle} ORDER BY rowid LIMIT ?`);
    const schreibe = d.prepare(sql);
    const fertig = d.prepare(`DELETE FROM temp.${tabelle} WHERE rowid <= ?`);
    for (;;) {
      const zeilen = lies.all(chunk) as { rid: number; item: string; tag: string; tiefe?: number }[];
      if (zeilen.length === 0) break;
      d.exec('BEGIN IMMEDIATE');
      try {
        for (const z of zeilen) { if (tabelle === 'erbe_weg') schreibe.run(z.item, z.tag); else schreibe.run(z.item, z.tag, z.tiefe ?? 0, jetzt); }
        d.exec('COMMIT');
      } catch (e) {
        try { d.exec('ROLLBACK'); } catch { /* not in a transaction */ }
        throw e;
      }
      fertig.run(zeilen[zeilen.length - 1].rid);
      geschrieben += zeilen.length;
    }
  }
  d.exec('DROP TABLE IF EXISTS temp.erbe_ziel');
  return geschrieben;
}

const fehlerCode = (e: unknown): number => {
  const c = (e as { errcode?: unknown } | null)?.errcode;
  return typeof c === 'number' ? c & 0xff : -1;
};
const gesperrt = (e: unknown): boolean => fehlerCode(e) === 5 || fehlerCode(e) === 6 || /database is locked|busy/i.test((e as Error)?.message ?? '');
const kaputt = (e: unknown): boolean => fehlerCode(e) === 11 || fehlerCode(e) === 26 || /not a database|malformed/i.test((e as Error)?.message ?? '');

const einwertigArt = (t: string): string | null => { const art = t.slice(0, t.indexOf(':')); return (EINWERTIG as readonly string[]).includes(art) ? art : null; };
// SQL condition: one of `tags` (all of one art) is effective for the item in column `spalte`: a winning row, and for a single-valued
// art no better sibling of the same art. Probes the primary key of item_tag, never scans it.
function wirksamBedingung(par: (string | number)[], tags: string[], spalte: string = 'i.id'): string {
  const art = einwertigArt(tags[0]);
  const wahl = tags.length === 1 ? 'w.tag = ?' : `w.tag IN (${tags.map(() => '?').join(',')})`;
  par.push(...tags);
  if (art === null) return `EXISTS (SELECT 1 FROM wirksam_roh w WHERE w.item = ${spalte} AND ${wahl})`;
  par.push(`${art}:`, `${art};`);
  return `EXISTS (SELECT 1 FROM wirksam_roh w WHERE w.item = ${spalte} AND ${wahl} AND NOT EXISTS (SELECT 1 FROM wirksam_roh v WHERE v.item = w.item AND v.tag >= ? AND v.tag < ? AND v.tag <> w.tag
    AND (v.prio > w.prio OR (v.prio = w.prio AND v.zeit > w.zeit) OR (v.prio = w.prio AND v.zeit = w.zeit AND v.tag < w.tag))))`;
}

export class TagSpeicher {
  private readonly pfad: string | undefined;
  private readonly jetzt: () => number;
  private db: DatabaseSync | null = null;
  private letzteZeit = 0;
  private schreibZaehler = 0;   // bumped on every access that may write; part of the cache key of the saved-search counts
  private readonly zaehlCache = new Map<string, { spec: string; version: string; anzahl: number }>();

  constructor(opt: { pfad?: string; jetzt?: () => number } = {}) {
    this.pfad = opt.pfad;
    this.jetzt = opt.jetzt ?? Date.now;
  }

  get speicherPfad(): string | undefined { return this.pfad; }

  // Seconds, strictly rising per instance so two calls in one millisecond keep their order (one microsecond apart, so the clock
  // never runs ahead of wall time by more than a few milliseconds even after thousands of calls)
  private zeit(): number {
    this.letzteZeit = Math.max(this.jetzt() / 1000, this.letzteZeit + 1e-6);
    return this.letzteZeit;
  }

  private oeffne(): DatabaseSync {
    const auf = (): DatabaseSync => {
      const d = new DatabaseSync(this.pfad as string);
      try { d.exec(`PRAGMA busy_timeout = ${BUSY_MS}`); d.exec('PRAGMA journal_mode = WAL'); d.exec('PRAGMA synchronous = NORMAL'); schemaAnlegen(d); return d; }
      catch (e) { try { d.close(); } catch { /* ignore */ } throw e; }
    };
    fs.mkdirSync(path.dirname(this.pfad!), { recursive: true });
    try { return auf(); }
    catch (e) {
      if (gesperrt(e)) throw new TagFehler(503, 'tags_busy');
      if (!kaputt(e)) throw e;
    }
    // A damaged file moves aside (same rule as the Python side); an empty store takes its place, measured rows come back with the next hook run
    const ziel = `${this.pfad}.defekt-${Math.floor(Date.now() / 1000)}`;
    fs.renameSync(this.pfad!, fs.existsSync(ziel) ? `${ziel}-${process.pid}` : ziel);
    for (const s of ['-wal', '-shm']) fs.rmSync(this.pfad + s, { force: true });
    try { return auf(); } catch (e) { throw gesperrt(e) ? new TagFehler(503, 'tags_busy') : e; }
  }

  // The open handle; with `anlegen` false an absent file stays absent (reads of a store that does not exist yet)
  private verbindung(anlegen: boolean): DatabaseSync | null {
    if (anlegen) this.schreibZaehler++;
    if (this.db) return this.db;
    if (!this.pfad) { if (anlegen) throw new TagFehler(503, 'tags_busy'); return null; }
    if (!anlegen && !fs.existsSync(this.pfad)) return null;
    return (this.db = this.oeffne());
  }

  private lesend<T>(f: (d: DatabaseSync) => T, leer: T): T {
    try {
      const d = this.verbindung(false);
      return d ? f(d) : leer;
    } catch (e) {
      if (e instanceof TagFehler) return leer;
      if (gesperrt(e) || kaputt(e)) return leer;
      throw e;
    }
  }

  tagsVon(item: string): { tag: string; herkunft: TagHerkunft }[] {
    return this.lesend((d) => (d.prepare('SELECT tag, herkunft FROM wirksam WHERE item = ? ORDER BY tag').all(item) as { tag: string; herkunft: TagHerkunft }[]).map((r) => ({ tag: r.tag, herkunft: r.herkunft })), []);
  }

  // Search: every given tag must be effective (view wirksam_roh, probed by the primary key of item_tag, plus the sibling rule of the
  // single-valued arts); `text` words each match the item name (LIKE over the whole store) or the word part of an effective tag
  // (the matching tags are enumerated from the closed vocabulary and the frei: range, then found through the index it_tag); `art` is
  // item.art. The candidates come from the rarest tag. Only the number of results is capped, never the searched part of the store.
  suche(o: { tags: string[]; text?: string; art?: string; limit?: number }): { item: string; name: string; art: string; tags: string[] }[] {
    return this.sucheKern(o, false) as { item: string; name: string; art: string; tags: string[] }[];
  }

  // The number of hits of the same query (one COUNT, no second lookup per hit), capped
  zaehle(o: { tags: string[]; text?: string; art?: string }, max: number = ANZAHL_MAX): number {
    return this.sucheKern({ ...o, limit: max }, true) as number;
  }

  private sucheKern(o: { tags: string[]; text?: string; art?: string; limit?: number }, zahl: boolean): unknown {
    const roh = Array.isArray(o.tags) ? o.tags : [];
    if (roh.length > MAX_TAGS) throw new TagFehler(400, 'zu_viele_tags');
    const vok = itemVokabular();
    for (const t of roh) if (!pruefeTag(t, vok)) throw new TagFehler(400, 'tag_ungueltig', String(t).slice(0, 80));
    const tags = [...new Set(roh)];
    const limit = zahl ? Number(o.limit) : Math.min(SUCHE_MAX, Math.max(1, Math.floor(Number(o.limit ?? SUCHE_VORGABE)) || SUCHE_VORGABE));
    const woerter = String(o.text ?? '').toLowerCase().split(/\s+/).filter((w) => w.length > 0);
    const maske = (w: string): string => `%${w.replace(/[\\%_]/g, '\\$&')}%`;
    return this.lesend((d) => {
      const bedingung: string[] = ['i.weg = 0'];
      const par: (string | number)[] = [];
      let von = 'item i';
      const vorPar: (string | number)[] = [];
      if (tags.length > 0) {
        const zaehle = d.prepare('SELECT count(*) AS n FROM item_tag WHERE tag = ?');
        const seltenster = [...tags].sort((a, b) => (zaehle.get(a) as { n: number }).n - (zaehle.get(b) as { n: number }).n)[0];
        von = '(SELECT DISTINCT item FROM item_tag WHERE tag = ? AND an = 1) c CROSS JOIN item i ON i.id = c.item';
        vorPar.push(seltenster);
        for (const t of tags) bedingung.push(wirksamBedingung(par, [t]));
      }
      if (o.art !== undefined && o.art !== '') { bedingung.push('i.art = ?'); par.push(String(o.art)); }
      for (const w of woerter) {
        const passend = this.tagsMitWort(d, vok, w);
        if (passend.length === 0) { bedingung.push("lower(i.name) LIKE ? ESCAPE '\\'"); par.push(maske(w)); continue; }
        bedingung.push("(lower(i.name) LIKE ? ESCAPE '\\' OR i.id IN (SELECT item FROM wirksam_roh WHERE tag IN (SELECT value FROM json_each(?))))");
        par.push(maske(w), JSON.stringify(passend));
      }
      if (zahl) return (d.prepare(`SELECT count(*) AS n FROM (SELECT 1 FROM ${von} WHERE ${bedingung.join(' AND ')} LIMIT ?)`).get(...vorPar, ...par, limit) as { n: number }).n;
      const ohneSuche = tags.length === 0 && woerter.length === 0;
      const ordnung = ohneSuche ? 'i.geaendert DESC, i.id' : 'i.name COLLATE NOCASE, i.id';
      const zeilen = d.prepare(`SELECT i.id, i.name, i.art FROM ${von} WHERE ${bedingung.join(' AND ')} ORDER BY ${ordnung} LIMIT ?`).all(...vorPar, ...par, limit) as { id: string; name: string; art: string }[];
      if (zeilen.length === 0) return [];
      const eff = d.prepare('SELECT tag, prio, zeit FROM wirksam_roh WHERE item = ?');
      return zeilen.map((z) => ({ item: z.id, name: z.name, art: z.art, tags: this.wirksameTags(eff.all(z.id) as { tag: string; prio: number; zeit: number }[]) }));
    }, zahl ? 0 : []);
  }

  // The tags whose word part contains `w`: the closed vocabulary words are enumerated, free words come from the frei: range of the index
  private tagsMitWort(d: DatabaseSync, vok: ReturnType<typeof itemVokabular>, w: string): string[] {
    const aus: string[] = [];
    const prufe = (art: string, wort: string): void => { if (wort.toLowerCase().replace(/_/g, ' ').includes(w)) aus.push(`${art}:${wort}`); };
    for (const x of vok.typ) prufe('typ', x);
    for (const x of vok.charakter) prufe('charakter', x);
    for (const x of vok.genre) prufe('genre', x);
    for (const x of vok.einsatz) prufe('einsatz', x);
    for (let n = 1; n <= 5; n++) prufe('energie', String(n));
    for (let n = 1; n <= 12; n++) for (const b of ['A', 'B']) prufe('tonart', `${n}${b}`);
    if (/^[0-9]+$/.test(w)) for (let n = 40; n <= 220; n++) prufe('tempo', String(n));
    for (const r of d.prepare("SELECT DISTINCT tag FROM item_tag WHERE tag >= 'frei:' AND tag < 'frei;'").all() as { tag: string }[]) prufe('frei', r.tag.slice(5));
    return [...new Set(aus)];
  }

  // The effective tags of one item from its wirksam_roh rows: single-valued arts keep the best row (prio, newest, tag order)
  private wirksameTags(zeilen: { tag: string; prio: number; zeit: number }[]): string[] {
    const beste = new Map<string, { tag: string; prio: number; zeit: number }>();
    const rest: string[] = [];
    for (const r of zeilen) {
      const art = r.tag.slice(0, r.tag.indexOf(':'));
      if (!(EINWERTIG as readonly string[]).includes(art)) { rest.push(r.tag); continue; }
      const b = beste.get(art);
      if (!b || r.prio > b.prio || (r.prio === b.prio && (r.zeit > b.zeit || (r.zeit === b.zeit && r.tag < b.tag)))) beste.set(art, r);
    }
    return [...rest, ...[...beste.values()].map((x) => x.tag)].sort();
  }

  // Everything is checked first; then one transaction. Returns the number of (item, tag) pairs that changed state.
  setze(items: unknown, tags: unknown, an: boolean, quelle: Quelle): number {
    if (!Array.isArray(items)) throw new TagFehler(400, 'item_ungueltig');
    if (!Array.isArray(tags)) throw new TagFehler(400, 'tag_ungueltig');
    if (items.length > MAX_ITEMS) throw new TagFehler(400, 'zu_viele_items');
    if (tags.length > MAX_TAGS) throw new TagFehler(400, 'zu_viele_tags');
    const arten = new Map<string, string>();
    for (const i of items) {
      const p = pruefeItemId(i);
      if (!p) throw new TagFehler(400, 'item_ungueltig', String(i).slice(0, 80));
      arten.set(i as string, p.art);
    }
    const vok = itemVokabular();
    const einwertigGesetzt = new Set<string>();
    for (const t of tags) {
      const p = pruefeTag(t, vok);
      if (!p) throw new TagFehler(400, 'tag_ungueltig', String(t).slice(0, 80));
      if (an && (EINWERTIG as readonly string[]).includes(p.art)) {
        if (einwertigGesetzt.has(p.art)) throw new TagFehler(400, 'tag_ungueltig', String(t));   // two values of a single-valued art in one call
        einwertigGesetzt.add(p.art);
      }
    }
    const tagListe = [...new Set(tags as string[])];
    if (arten.size === 0 || tagListe.length === 0) return 0;

    let d: DatabaseSync | null;
    try { d = this.verbindung(true); } catch (e) { if (gesperrt(e)) throw new TagFehler(503, 'tags_busy'); throw e; }
    if (!d) throw new TagFehler(503, 'tags_busy');
    const eff = d.prepare('SELECT herkunft FROM wirksam WHERE item = ? AND tag = ?');
    const neuItem = d.prepare("INSERT OR IGNORE INTO item(id, art, name, kopf, katalog, weg, geaendert) VALUES (?, ?, '', '', 0, 0, ?)");
    const loescheManuell = d.prepare("DELETE FROM item_tag WHERE item = ? AND tag = ? AND herkunft IN ('nutzer', 'agent')");
    const loescheArt = d.prepare("DELETE FROM item_tag WHERE item = ? AND herkunft IN ('nutzer', 'agent') AND an = 1 AND tag LIKE ? ESCAPE '\\'");
    const schreibe = d.prepare('INSERT OR REPLACE INTO item_tag(item, tag, herkunft, quelle, an, wert, zeit) VALUES (?, ?, ?, ?, ?, NULL, ?)');
    let geaendert = 0;
    const z = this.zeit();
    try {
      d.exec('BEGIN IMMEDIATE');
      for (const [item, art] of arten) {
        neuItem.run(item, art, z);
        for (const tag of tagListe) {
          const vorher = (eff.get(item, tag) as { herkunft: TagHerkunft } | undefined)?.herkunft;
          if (an) {
            if (vorher === quelle) continue;
            const kind = tag.slice(0, tag.indexOf(':'));
            loescheManuell.run(item, tag);
            if ((EINWERTIG as readonly string[]).includes(kind)) loescheArt.run(item, `${kind}:%`);
            schreibe.run(item, tag, quelle, '', 1, z);
            geaendert++;
          } else {
            if (vorher === undefined) continue;
            loescheManuell.run(item, tag);
            if (eff.get(item, tag) !== undefined) schreibe.run(item, tag, quelle, '', 0, z);
            geaendert++;
          }
        }
      }
      d.exec('COMMIT');
    } catch (e) {
      try { d.exec('ROLLBACK'); } catch { /* not in a transaction */ }
      if (gesperrt(e)) throw new TagFehler(503, 'tags_busy');
      throw e;
    }
    // Derived rows follow in small transactions of their own (the write lock is never held for long); only the touched items and
    // their descendants are recomputed. A crash between the two leaves them stale until the next hook run recomputes the store.
    if (geaendert > 0) {
      try { erbe(d, this.zeit(), arten.keys()); }
      catch (e) { if (gesperrt(e)) throw new TagFehler(503, 'tags_busy'); throw e; }
    }
    return geaendert;
  }

  // A reported relation (stems placement and others): both ids are checked, missing items are created, the relation is stored once with
  // herkunft 'melde'. Returns true when a row was added; the inheritance of the two items follows. made_from and used_in only.
  meldeBezug(art: 'made_from' | 'used_in', von: string, nach: string, opt: { name?: string } = {}): boolean {
    if (art !== 'made_from' && art !== 'used_in') throw new TagFehler(400, 'bezug_ungueltig', String(art).slice(0, 40));
    const pv = pruefeItemId(von), pn = pruefeItemId(nach);
    if (!pv) throw new TagFehler(400, 'item_ungueltig', String(von).slice(0, 80));
    if (!pn) throw new TagFehler(400, 'item_ungueltig', String(nach).slice(0, 80));
    const d = this.schreibend();
    const z = this.zeit();
    let neu = false;
    try {
      d.exec('BEGIN IMMEDIATE');
      const item = d.prepare("INSERT OR IGNORE INTO item(id, art, name, kopf, katalog, weg, geaendert) VALUES (?, ?, ?, '', 0, 0, ?)");
      item.run(von, pv.art, opt.name ?? '', z); item.run(nach, pn.art, '', z);
      if (opt.name) d.prepare("UPDATE item SET name = ? WHERE id = ? AND name = '' AND katalog = 0").run(opt.name, von);
      neu = Number(d.prepare("INSERT OR IGNORE INTO relation(von, art, nach, herkunft, wert, zeit) VALUES (?, ?, ?, 'melde', NULL, ?)").run(von, art, nach, z).changes) > 0;
      d.exec('COMMIT');
    } catch (e) {
      try { d.exec('ROLLBACK'); } catch { /* not in a transaction */ }
      if (gesperrt(e)) throw new TagFehler(503, 'tags_busy');
      throw e;
    }
    if (neu) this.erbeNach([von, nach]);
    return neu;
  }

  // The scan side (tags/bezuege.ts). Each unit replaces what its owner produced: the relations it wrote earlier (table scan_eigner, so a
  // relation another source also wrote stays) and, when `tags` is given, the derived rows of quelle 'preset' of the owner. Never touched:
  // erbe, messen, melde and manual rows. All units of a call go into ONE transaction and one inheritance run.
  anwendeBezug(satz: BezugSatz): void { this.anwendeBezuege([satz]); }
  anwendeBezuege(saetze: BezugSatz[]): void {
    if (saetze.length === 0) return;
    const d = this.schreibend();
    const z = this.zeit();
    const beruehrt = new Set<string>();   // sources of made_from rows that came or went, and owners whose derived tags changed
    try {
      d.exec('BEGIN IMMEDIATE');
      const alt = d.prepare('SELECT von, art, nach FROM scan_eigner WHERE eigner = ?');
      const loeseEigner = d.prepare('DELETE FROM scan_eigner WHERE eigner = ?');
      const loeseRel = d.prepare("DELETE FROM relation WHERE von = ? AND art = ? AND nach = ? AND herkunft = 'scan' AND NOT EXISTS (SELECT 1 FROM scan_eigner e WHERE e.von = ? AND e.art = ? AND e.nach = ?)");
      const item = d.prepare("INSERT OR IGNORE INTO item(id, art, name, kopf, katalog, weg, geaendert) VALUES (?, ?, '', '', 0, 0, ?)");
      const benenne = d.prepare('UPDATE item SET name = ?, geaendert = ? WHERE id = ? AND katalog = 0');
      const loescheTags = d.prepare("DELETE FROM item_tag WHERE item = ? AND herkunft = 'abgeleitet' AND quelle = 'preset'");
      const ein = d.prepare("INSERT OR REPLACE INTO item_tag(item, tag, herkunft, quelle, an, wert, zeit) VALUES (?, ?, 'abgeleitet', 'preset', 1, NULL, ?)");
      const rel = d.prepare("INSERT OR IGNORE INTO relation(von, art, nach, herkunft, wert, zeit) VALUES (?, ?, ?, 'scan', NULL, ?)");
      const besitze = d.prepare('INSERT OR IGNORE INTO scan_eigner(eigner, von, art, nach) VALUES (?, ?, ?, ?)');
      for (const satz of saetze) {
        const frueher = alt.all(satz.eigner) as { von: string; art: string; nach: string }[];
        loeseEigner.run(satz.eigner);
        for (const r of frueher) { loeseRel.run(r.von, r.art, r.nach, r.von, r.art, r.nach); if (r.art === 'made_from') beruehrt.add(r.von); }
        const art = pruefeItemId(satz.eigner)?.art;
        if (art && (satz.relationen.length > 0 || (satz.tags?.length ?? 0) > 0)) {
          item.run(satz.eigner, art, z);
          if (satz.name !== undefined) benenne.run(satz.name, z, satz.eigner);
        }
        if (satz.tags !== undefined) {
          loescheTags.run(satz.eigner);
          for (const t of satz.tags) ein.run(satz.eigner, t, z);
          beruehrt.add(satz.eigner);
        }
        for (const [a, von, nach] of satz.relationen) {
          const pv = pruefeItemId(von), pn = pruefeItemId(nach);
          if (!pv || !pn) continue;
          item.run(von, pv.art, z); item.run(nach, pn.art, z);
          rel.run(von, a, nach, z);
          besitze.run(satz.eigner, von, a, nach);
          if (a === 'made_from') beruehrt.add(von);
        }
      }
      d.exec('COMMIT');
    } catch (e) {
      try { d.exec('ROLLBACK'); } catch { /* not in a transaction */ }
      if (gesperrt(e)) throw new TagFehler(503, 'tags_busy');
      throw e;
    }
    if (beruehrt.size > 0) this.erbeNach(beruehrt);
  }

  // stand: small key/value notes of the producers (scan_<art> holds the signatures of the last scan)
  // Related items (B20). The four contract lists and the two additions; every list is an indexed lookup (primary key of relation or
  // rel_nach). `passt_zu` is computed on read: same item.art, effective tonart in camelotNachbarn, effective tempo within 6 percent,
  // nearest tempo first; found tempo by tempo through the index it_tag, so the cost follows the number of candidates near the tempo.
  verwandt(item: string, opt: { passt_max?: number } = {}): { gemacht_aus: string[]; steckt_in: string[]; passt_zu: string[]; aehnlich: string[]; daraus: string[]; enthaelt: string[] } {
    const leer = { gemacht_aus: [], steckt_in: [], passt_zu: [], aehnlich: [], daraus: [], enthaelt: [] };
    return this.lesend((d) => {
      const sichtbar = "AND NOT EXISTS (SELECT 1 FROM item x WHERE x.id = r.%S AND x.weg = 1)";
      const liste = (ziel: 'von' | 'nach', art: string, ordnung: string): string[] => {
        const frei = ziel === 'nach' ? 'von' : 'nach';
        const sql = `SELECT r.${ziel} AS id FROM relation r WHERE r.${frei} = ? AND r.art = ? ${sichtbar.replace('%S', ziel)} ORDER BY ${ordnung} LIMIT ${VERWANDT_MAX}`;
        return (d.prepare(sql).all(item, art) as { id: string }[]).map((r) => r.id);
      };
      return {
        gemacht_aus: liste('nach', 'made_from', 'r.nach'),
        steckt_in: liste('nach', 'used_in', 'r.nach'),
        daraus: liste('von', 'made_from', 'r.von'),
        enthaelt: liste('von', 'used_in', 'r.von'),
        aehnlich: liste('nach', 'similar_to', 'r.wert, r.nach'),
        passt_zu: this.passtZu(d, item, Math.min(PASST_MAX, Math.max(1, Math.floor(Number(opt.passt_max ?? PASST_VORGABE)) || PASST_VORGABE))),
      };
    }, leer);
  }

  private passtZu(d: DatabaseSync, item: string, max: number): string[] {
    const zeile = d.prepare('SELECT art FROM item WHERE id = ?').get(item) as { art: string } | undefined;
    if (!zeile) return [];
    const eigene = d.prepare("SELECT tag FROM wirksam WHERE item = ? AND (tag >= 'tempo:' AND tag < 'tempo;' OR tag >= 'tonart:' AND tag < 'tonart;')").all(item) as { tag: string }[];
    const tempoTag = eigene.find((r) => r.tag.startsWith('tempo:')), tonartTag = eigene.find((r) => r.tag.startsWith('tonart:'));
    if (!tempoTag || !tonartTag) return [];
    const tempo = Number(tempoTag.tag.slice(6));
    const nachbarn = camelotNachbarn(tonartTag.tag.slice(7)).map((k) => `tonart:${k}`);
    const spanne = Math.floor(tempo * TEMPO_SPANNE + 1e-9);
    // the tempo tag is bound per probe: build the condition once with a placeholder tag, its parameters are filled in below
    const bedTempo = wirksamBedingung([], ['tempo:0'], 'i.id');
    const parTonart: (string | number)[] = [];
    const bedTonart = wirksamBedingung(parTonart, nachbarn, 'i.id');
    const sql = `SELECT DISTINCT i.id FROM item_tag c CROSS JOIN item i ON i.id = c.item
      WHERE c.tag = ? AND c.an = 1 AND i.art = ? AND i.weg = 0 AND i.id <> ? AND ${bedTempo} AND ${bedTonart} ORDER BY i.id LIMIT ?`;
    const st = d.prepare(sql);
    const aus: string[] = [];
    for (let delta = 0; delta <= spanne && aus.length < max; delta++) {
      for (const t of delta === 0 ? [tempo] : [tempo - delta, tempo + delta]) {
        if (t < 40 || t > 220 || aus.length >= max) continue;
        const tag = `tempo:${t}`;
        const rest = max - aus.length;
        // parameters in order: probe tag, art, item, effective-tempo tag, its sibling range, the four keys, their sibling range, limit
        const werte = [tag, zeile.art, item, tag, 'tempo:', 'tempo;', ...parTonart, rest];
        for (const r of st.all(...werte) as { id: string }[]) aus.push(r.id);
      }
    }
    return aus;
  }

  // Saved searches (smart collections): the tags and text are stored, the count is taken live. A count of a common tag costs tens of
  // milliseconds on the real catalogue, and the page server serves the live studio, so one call counts inside a time budget
  // (ZAEHL_BUDGET_MS, always at least one search) and keeps each count until the store changes (a write through this class or a commit
  // of another process, e.g. the measuring hook). A search not counted in this call because the budget ran out is listed with anzahl null and
  // frisch false (a count from before the last change is never shown as current); the next call goes on. A stored search that no longer parses (a word left the vocabulary) is listed with count 0.
  gespeichert(): { name: string; tags: string[]; text: string; art: string; anzahl: number | null; frisch: boolean }[] {
    return this.lesend((d) => {
      const zeilen = d.prepare('SELECT name, tags, text, art FROM gespeichert ORDER BY lower(name), name').all() as { name: string; tags: string; text: string; art: string }[];
      const version = `${(d.prepare('PRAGMA data_version').get() as { data_version: number }).data_version}:${this.schreibZaehler}`;
      const start = performance.now();
      let gezaehlt = 0;
      const lebend = new Set<string>();
      const aus = zeilen.map((z) => {
        const tags = z.tags === '' ? [] : z.tags.split(',');
        const spec = `${z.tags}\u0000${z.text}\u0000${z.art}`;
        lebend.add(z.name);
        let c = this.zaehlCache.get(z.name);
        if (!c || c.spec !== spec) c = undefined;
        if ((!c || c.version !== version) && (gezaehlt === 0 || performance.now() - start < ZAEHL_BUDGET_MS)) {
          let anzahl = 0;
          try { anzahl = this.zaehle({ tags, text: z.text, art: z.art }); } catch (e) { if (!(e instanceof TagFehler)) throw e; }
          c = { spec, version, anzahl };
          this.zaehlCache.set(z.name, c);
          gezaehlt++;
        }
        const frisch = c !== undefined && c.version === version;
        return { name: z.name, tags, text: z.text, art: z.art, anzahl: frisch ? c!.anzahl : null, frisch };
      });
      for (const n of [...this.zaehlCache.keys()]) if (!lebend.has(n)) this.zaehlCache.delete(n);
      return aus;
    }, []);
  }

  merke(name: unknown, tags: unknown, text: unknown, art: unknown = ''): void {
    const n = typeof name === 'string' ? name.trim() : '';
    if (n.length < 1 || n.length > 40 || /[\u0000-\u001f\u007f]/.test(n)) throw new TagFehler(400, 'suche_name_ungueltig');
    const liste = tags === undefined || tags === null ? [] : tags;
    if (!Array.isArray(liste)) throw new TagFehler(400, 'tag_ungueltig');
    if (liste.length > MAX_TAGS) throw new TagFehler(400, 'zu_viele_tags');
    const vok = itemVokabular();
    for (const t of liste) if (!pruefeTag(t, vok)) throw new TagFehler(400, 'tag_ungueltig', String(t).slice(0, 80));
    const t = typeof text === 'string' ? text.trim().slice(0, 200) : '';
    if (liste.length === 0 && t === '') throw new TagFehler(400, 'tag_ungueltig');
    const a = art === undefined || art === null ? '' : art;
    if (typeof a !== 'string' || !/^[a-z]{0,16}$/.test(a)) throw new TagFehler(400, 'art_ungueltig', String(a).slice(0, 40));
    const d = this.schreibend();
    try { d.prepare('INSERT OR REPLACE INTO gespeichert(name, tags, text, art, angelegt) VALUES (?, ?, ?, ?, ?)').run(n, [...new Set(liste as string[])].join(','), t, a, this.zeit()); }
    catch (e) { if (gesperrt(e)) throw new TagFehler(503, 'tags_busy'); throw e; }
  }

  vergiss(name: unknown): void {
    const n = typeof name === 'string' ? name.trim() : '';
    if (n === '') throw new TagFehler(400, 'suche_name_ungueltig');
    const d = this.schreibend();
    try {
      if (Number(d.prepare('DELETE FROM gespeichert WHERE name = ?').run(n).changes) === 0) throw new TagFehler(404, 'suche_unbekannt', n);
    } catch (e) { if (e instanceof TagFehler) throw e; if (gesperrt(e)) throw new TagFehler(503, 'tags_busy'); throw e; }
  }

  lesStand(schluessel: string): string | null {
    return this.lesend((d) => (d.prepare('SELECT wert FROM stand WHERE schluessel = ?').get(schluessel) as { wert: string } | undefined)?.wert ?? null, null);
  }
  schreibeStand(schluessel: string, wert: string): void {
    const d = this.schreibend();
    try { d.prepare('INSERT OR REPLACE INTO stand(schluessel, wert) VALUES (?, ?)').run(schluessel, wert); }
    catch (e) { if (gesperrt(e)) throw new TagFehler(503, 'tags_busy'); throw e; }
  }

  private schreibend(): DatabaseSync {
    let d: DatabaseSync | null;
    try { d = this.verbindung(true); } catch (e) { if (gesperrt(e)) throw new TagFehler(503, 'tags_busy'); throw e; }
    if (!d) throw new TagFehler(503, 'tags_busy');
    return d;
  }
  private erbeNach(items: Iterable<string>): void {
    try { erbe(this.schreibend(), this.zeit(), items); }
    catch (e) { if (gesperrt(e)) throw new TagFehler(503, 'tags_busy'); throw e; }
  }

  // Close the handle; the next access opens again (after the file was replaced from outside)
  zuruecksetzen(): void { this.schliesse(); }
  schliesse(): void { try { this.db?.close(); } catch { /* ignore */ } this.db = null; }
}
