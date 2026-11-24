// Katalog des Browsers (Plan 2026-10-10-mediathek-browser): liest die abgeleitete Datei katalog.sqlite, die
// cypher-mediathek (`mediathek katalog`) neben die Mediathek baut. Sie hat eine Zeile je Track-Werk, Loop und One-Shot
// mit Fundort auf dem bauenden Host. Nur lesen, je Abfrage öffnen und schließen: der Bau ersetzt die Datei per rename.
// Gemessen 2026-10-10 (88 807 Zeilen): Seite ≤ 2 ms, Zählung 1,8 ms, FTS ≤ 133 ms. Zählen ist eine eigene Abfrage,
// weil count(*) OVER () alles sortiert (85 ms).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseSuche } from './search_text.ts';
import { katalogPfad } from './paths.ts';

export type Typ = 'track' | 'loop' | 'oneshot';
// Nicht „TYPEN": server.ts:127 hat schon eine MIME-Tabelle dieses Namens (Plan-Review B1, gemessen SyntaxError)
export const KATALOG_TYPEN: readonly Typ[] = ['track', 'loop', 'oneshot'];
// Facetten je Typ (Plan 2.1): feste Spaltennamen, nie aus der Anfrage
export const FACETTEN: Record<Typ, readonly string[]> = { track: ['genre'], loop: ['pack'], oneshot: ['instrument', 'pack'] };
// Facettenwert einer Spalte: NULL, '' und Leerraum → NULL (der Baum zeigt es als „(none)“). `feld` kommt nur aus FACETTEN.
// Whitespace is the set of JS String.prototype.trim (tab, line breaks, NBSP, Unicode spaces, BOM); SQLite trim(x)
// alone strips U+0020 only.
const LEERRAUM = "char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)";
const facetteWert = (feld: string, pre = ''): string => `nullif(trim(${pre}${feld}, ${LEERRAUM}), '')`;
export const SCHEMA = '1';
// Camelot-Key → [gleich, −1, +1 (mit Umlauf 12→1), Paralleltonart]; Unsinn 400
export function camelotNachbarn(k: string): string[] {
  const m = /^\s*(\d{1,2})([AB])\s*$/i.exec(k);
  const n = m ? Number(m[1]) : 0;
  if (!m || n < 1 || n > 12) throw new KatalogFehler(400, 'camelot_ungueltig');
  const b = m[2].toUpperCase(), r = (x: number): number => ((x + 11) % 12) + 1;
  return [`${n}${b}`, `${r(n - 1)}${b}`, `${r(n + 1)}${b}`, `${n}${b === 'A' ? 'B' : 'A'}`];
}
// Energie-Klassen wie connection.ts energieKlasse (Andreas' Ohr 2026-10-10: drei Klassen)
const ENERGIE_SQL = ['k.energie <= 5', 'k.energie > 5 AND k.energie <= 7', 'k.energie > 7'];
export const SEITE_VORGABE = 100, SEITE_MAX = 200;
// Key nach Zahl, dann A vor B (1A, 1B, 2A … 12B); ohne Key NULL → zuletzt. Als Text sortiert wäre 10A vor 1A (Review S1 MINOR 2).
const CAMELOT_ZAHL = "CASE WHEN k.camelot GLOB '[0-9]*[AB]' THEN CAST(substr(k.camelot, 1, length(k.camelot) - 1) AS INTEGER) * 2 + (substr(k.camelot, -1) = 'B') END";
// Sortierschlüssel der URL → Spalte (fest, nie aus der Anfrage zusammengesetzt)
export const SORTIERUNG: Record<Typ, Record<string, string>> = {
  track: { titel: 'titel COLLATE NOCASE', kuenstler: 'kuenstler COLLATE NOCASE', bpm: 'bpm', camelot: CAMELOT_ZAHL, energie: 'energie', genre: 'genre COLLATE NOCASE', dauer: 'dauer_s' },
  loop: { name: 'name COLLATE NOCASE', pack: 'pack COLLATE NOCASE', bpm: 'bpm', takte: 'takte', camelot: CAMELOT_ZAHL, ordner: 'ordner' },
  oneshot: { name: 'name COLLATE NOCASE', instrument: 'instrument', pack: 'pack COLLATE NOCASE', dauer: 'dauer_s' },
};
export const SORT_VORGABE: Record<Typ, string> = { track: 'titel', loop: 'name', oneshot: 'name' };

export interface Zeile {
  id: number; typ: Typ; werk_id: number | null; sha: string; shas: string; titel: string | null; kuenstler: string | null; mix: string | null;
  bpm: number | null; camelot: string | null; energie: number | null; genre: string | null; pack: string | null; instrument: string | null;
  kategorie: string | null; takte: number | null; schutz: string | null; label: string | null; jahr: string | null; release: string | null;
  katalognummer: string | null; isrc: string | null; remixer: string | null; dauer_s: number | null; pfad: string | null; ordner: string | null;
  name: string | null; alle: string | null;
}
export interface Filter { text?: string; ordner?: string; facette?: { feld: string; wert: string }; camelot?: string; nachbarn?: boolean; /** with `camelot`: a row without a key passes too */ keyOffen?: boolean; bpm?: [number, number]; energie?: 0 | 1 | 2; ohneSchutz?: boolean }
/** Priority order of the shelf: reachable folders first, then the rank (favourites and recent, lower first), then the chosen column. */
export interface Vorrang {
  /** Folders (as the catalog names them) that are NOT reachable now; empty in the normal case, then the key drops out of the query. */
  fehlend: readonly string[];
  /** The ranked rows only (favourite 0, recent 1..): sha to rank; every other row ranks 1000. Empty: the key drops out. */
  rang: ReadonlyMap<string, number>;
}
const RANG_SONST = 1000;

export class KatalogFehler extends Error {
  readonly code: number; readonly fehler: string;
  constructor(code: number, fehler: string) { super(fehler); this.code = code; this.fehler = fehler; }
}

// Vorgabe: neben der Mediathek (so baut cypher-mediathek); CYPHERDJ_KATALOG überschreibt
export function katalogVorgabe(mediathek: string): string { return katalogPfad(mediathek); }

const SHA = /^[0-9a-f]{64}$/;
// Damage behind the stand table only shows up in a later query: SQLITE_CORRUPT (11) and SQLITE_NOTADB (26) become
// 503 katalog_kaputt like a damaged header. Checked by result code, not by message: an FTS "malformed MATCH" stays 400.
const kaputt = (e: unknown): unknown => {
  const c = (e as { errcode?: unknown } | null)?.errcode;
  return typeof c === 'number' && ((c & 0xff) === 11 || (c & 0xff) === 26) ? new KatalogFehler(503, 'katalog_kaputt') : e;
};
// LIKE-Muster aus Text: %, _ und \ sind Zeichen (ESCAPE '\')
const maske = (s: string): string => s.normalize('NFC').toLowerCase().replace(/[\\%_]/g, '\\$&');

export class Katalog {
  private readonly pfad: string;
  constructor(pfad: string) { this.pfad = pfad; }

  vorhanden(): boolean { return fs.existsSync(this.pfad); }

  // Answers that do not depend on a filter (folder sums, tree) are kept until the file changes (the hourly rebuild replaces it): a cache hit
  // costs a stat, not a scan over the whole table. The signature is file identity, size and mtime; a missing or unstattable file is never cached.
  private readonly gemerkt = new Map<string, unknown>();
  private signatur = '';
  private merke<T>(schluessel: string, f: () => T): T {
    let sig = '';
    try { const st = fs.statSync(this.pfad); sig = `${st.ino}:${st.size}:${st.mtimeMs}`; } catch { return f(); }
    if (sig !== this.signatur) { this.gemerkt.clear(); this.signatur = sig; }
    if (this.gemerkt.has(schluessel)) return this.gemerkt.get(schluessel) as T;
    const r = f();
    if (this.gemerkt.size >= 300) this.gemerkt.clear();   // counts of free-text filters come and go: bounded
    this.gemerkt.set(schluessel, r);
    return r;
  }

  /** The folders of one type with their file counts (also the base of the source list); kept until the catalog file changes. */
  ordnerSummen(typ: Typ, f: { ohneSchutz?: boolean } = {}): { ordner: { pfad: string; n: number }[]; gebaut_am: string } {
    return this.merke(`ordner|${typ}|${f.ohneSchutz ? 1 : 0}`, () => {
      const { db, stand } = this.oeffne();
      try {
        const sch = f.ohneSchutz ? ' AND schutz IS NULL' : '';
        const o = db.prepare(`SELECT ordner AS pfad, count(*) AS n FROM katalog WHERE typ = ? AND ordner IS NOT NULL${sch} GROUP BY ordner ORDER BY ordner`).all(typ) as { pfad: string; n: number }[];
        return { ordner: o.map((x) => ({ pfad: x.pfad, n: x.n })), gebaut_am: stand.gebaut_am ?? '' };
      } catch (e) { throw kaputt(e); } finally { db.close(); }
    });
  }

  private oeffne(): { db: DatabaseSync; stand: Record<string, string> } {
    if (!this.vorhanden()) throw new KatalogFehler(503, 'katalog_fehlt');
    // a path that exists but cannot be opened (a directory, no permission) is unavailable like a damaged file, not a 500
    let db: DatabaseSync;
    try { db = new DatabaseSync(this.pfad, { readOnly: true }); } catch { throw new KatalogFehler(503, 'katalog_kaputt'); }
    // Ordner-Vergleich unicode-gefaltet (S4-Review 2): SQLite lower() und LIKE falten nur ASCII, NFD-Pfade (macOS, Mediathek-Importe) passten nie
    db.function('klein', { deterministic: true }, (x) => (x == null ? null : String(x).normalize('NFC').toLowerCase()));
    let stand: Record<string, string>;
    try {
      stand = Object.fromEntries((db.prepare('SELECT schluessel, wert FROM stand').all() as { schluessel: string; wert: string }[]).map((r) => [r.schluessel, r.wert]));
    } catch { db.close(); throw new KatalogFehler(503, 'katalog_kaputt'); }
    if (stand.schema !== SCHEMA) { db.close(); throw new KatalogFehler(503, 'katalog_schema'); }
    return { db, stand };
  }

  // WHERE-Teil (Task 2.1: Typ, Ordner, Facette; Key/BPM/Energie Task 3.1, Text Task 4.2)
  private wo(typ: Typ, f: Filter): { mit: string; von: string; sql: string; par: (string | number)[] } {
    let mit = ''; const mpar: string[] = [];
    const w = ['k.typ = ?']; const par: (string | number)[] = [typ];
    // Präfix exakt (BINARY), nicht LIKE: LIKE ignoriert in SQLite die Groß-/Kleinschreibung und zählte /x/drums/sub zu /x/Drums (Review B1)
    if (f.ordner) { w.push('(k.ordner = ? OR substr(k.ordner, 1, length(?)) = ?)'); par.push(f.ordner, `${f.ordner}/`, `${f.ordner}/`); }
    if (f.facette) {
      if (!FACETTEN[typ].includes(f.facette.feld)) throw new KatalogFehler(400, 'facette_ungueltig');
      // NULL, '' und nur Leerraum sind ein Wert „leer“, im Baum (facetteWert) wie hier (Review B2)
      if (f.facette.wert === '') w.push(`${facetteWert(f.facette.feld, 'k.')} IS NULL`); else { w.push(`${facetteWert(f.facette.feld, 'k.')} = ?`); par.push(f.facette.wert); }
    }
    if (f.camelot) { const c = camelotNachbarn(f.camelot); const l = f.nachbarn ? c : [c[0]]; w.push(`(k.camelot IN (${l.map(() => '?').join(',')})${f.keyOffen ? " OR nullif(trim(k.camelot), '') IS NULL" : ''})`); par.push(...l); }
    if (f.bpm) { w.push('k.bpm BETWEEN ? AND ?'); par.push(f.bpm[0], f.bpm[1]); }
    if (f.energie !== undefined) w.push(ENERGIE_SQL[f.energie]);
    if (f.ohneSchutz) w.push('k.schutz IS NULL');
    if (f.text) {
      const s = parseSuche(f.text);
      if (s.zuviele) throw new KatalogFehler(400, 'zu_viele_suchwoerter');
      // Gemessen 2026-10-10: FTS naiv gejoint + ORDER BY = 19,8 s (FTS je Zeile abgefragt); als MATERIALIZED-CTE 14 ms
      if (s.fts) { mit = 'WITH t AS MATERIALIZED (SELECT rowid AS id FROM katalog_fts WHERE katalog_fts MATCH ?) '; mpar.push(s.fts); }
      for (const o of s.ordner) { w.push(`klein(k.ordner) LIKE ? ESCAPE '\\'`); par.push(`%${maske(o)}%`); }
    }
    return { mit, von: mit ? 'katalog k JOIN t ON t.id = k.id' : 'katalog k', sql: w.join(' AND '), par: [...mpar, ...par] };
  }

  seite(typ: Typ, f: Filter, sort: string, ab: boolean, seite: number, limit: number, vorrang?: Vorrang): { zeilen: Zeile[]; gesamt: number; gebaut_am: string } {
    const spalte = Object.hasOwn(SORTIERUNG[typ], sort) ? SORTIERUNG[typ][sort] : undefined;
    if (!spalte) throw new KatalogFehler(400, 'sort_ungueltig');
    const { db, stand } = this.oeffne();
    try {
      const { mit, von, sql, par } = this.wo(typ, f);
      // The count depends only on the filter, not on page, sort or priority; with `schutz IS NULL` it reads every row of the type (45 ms on 75 000 one-shots),
      // so it is kept per filter until the catalog file changes.
      const gesamt = this.merke(`n|${typ}|${JSON.stringify(f)}`, () => (db.prepare(`${mit}SELECT count(*) AS n FROM ${von} WHERE ${sql}`).get(...par) as { n: number }).n);
      if (gesamt === 0) return { zeilen: [], gesamt, gebaut_am: stand.gebaut_am ?? '' };   // nothing matches: the page query would walk the sort index to its end
      const ordnung = `${spalte.startsWith('CASE') ? spalte : `k.${spalte}`} ${ab ? 'DESC' : 'ASC'} NULLS LAST, k.id`;
      const mitFehlend = !!vorrang?.fehlend.length, mitRang = !!vorrang?.rang.size;
      if (!vorrang || (!mitFehlend && !mitRang)) {   // normal case: the order is the column's and the indexes serve it
        const zeilen = db.prepare(`${mit}SELECT k.* FROM ${von} WHERE ${sql} ORDER BY ${ordnung} LIMIT ? OFFSET ?`).all(...par, limit, seite * limit) as unknown as Zeile[];
        return { zeilen, gesamt, gebaut_am: stand.gebaut_am ?? '' };
      }
      // Priority order = four groups in this sequence: reachable and ranked (by rank), reachable and unranked (by column), missing and ranked, missing
      // and unranked. The two small bound sets live in temp tables, no function runs per row. The ranked rows are few and read whole; the two big
      // groups are read by the column's index with LIMIT/OFFSET, so a page costs about the same as without priority.
      if (mitFehlend) {
        db.exec('CREATE TEMP TABLE vr_fehlend(pfad TEXT PRIMARY KEY) WITHOUT ROWID');
        const ins = db.prepare('INSERT OR IGNORE INTO vr_fehlend VALUES (?)');
        for (const o of vorrang.fehlend) ins.run(o);
      }
      if (mitRang) {
        db.exec('CREATE TEMP TABLE vr_rang(sha TEXT PRIMARY KEY, r INTEGER NOT NULL) WITHOUT ROWID');
        const ins = db.prepare('INSERT OR IGNORE INTO vr_rang VALUES (?, ?)');
        for (const [sha, r] of vorrang.rang) ins.run(sha, r);
      }
      const weg = '(k.ordner IS NULL OR k.ordner IN (SELECT pfad FROM vr_fehlend))';   // a row without a folder counts as not reachable
      const ohneRang = mitRang ? ' AND k.sha NOT IN (SELECT sha FROM vr_rang)' : '';
      const da = mitFehlend ? ` AND NOT ${weg}` : '';
      const mitRangZeilen: { z: Zeile; weg: boolean }[] = mitRang
        ? (db.prepare(`${mit}SELECT k.*, ${mitFehlend ? weg : '0'} AS vr_weg, vr_rang.r AS vr_r FROM vr_rang CROSS JOIN ${von} WHERE k.sha = vr_rang.sha AND ${sql} ORDER BY vr_weg, vr_r, ${ordnung}`)
          .all(...par) as unknown as (Zeile & { vr_weg: number; vr_r: number })[]).map(({ vr_weg, vr_r: _r, ...z }) => ({ z: z as Zeile, weg: vr_weg === 1 }))
        : [];
      const rr = mitRangZeilen.filter((x) => !x.weg).map((x) => x.z), mr = mitRangZeilen.filter((x) => x.weg).map((x) => x.z);
      const frage = (bed: string, l: number, o: number): Zeile[] => db.prepare(`${mit}SELECT k.* FROM ${von} WHERE ${sql}${bed} ORDER BY ${ordnung} LIMIT ? OFFSET ?`).all(...par, l, o) as unknown as Zeile[];
      const zeilen: Zeile[] = [];
      let skip = seite * limit, noch = limit;
      const aus = (arr: Zeile[]): void => {
        if (skip >= arr.length) { skip -= arr.length; return; }
        const t = arr.slice(skip, skip + noch); zeilen.push(...t); noch -= t.length; skip = 0;
      };
      aus(rr);
      if (noch > 0) {   // reachable and unranked
        const t = frage(`${da}${ohneRang}`, noch, skip);
        zeilen.push(...t); noch -= t.length;
        if (noch > 0) {   // this group ended inside the window (or before it): how far did the offset reach into it?
          if (t.length === 0 && skip > 0) {
            const n = (db.prepare(`${mit}SELECT count(*) AS n FROM ${von} WHERE ${sql}${da}${ohneRang}`).get(...par) as { n: number }).n;
            skip = Math.max(0, skip - n);
          } else skip = 0;
        } else skip = 0;
      }
      if (noch > 0 && mitFehlend) {
        aus(mr);
        if (noch > 0) zeilen.push(...frage(` AND ${weg}${ohneRang}`, noch, skip));
      }
      return { zeilen, gesamt, gebaut_am: stand.gebaut_am ?? '' };
    } catch (e) {
      if (kaputt(e) !== e) throw kaputt(e);
      // FTS-Syntaxfehler sollte es durch das Quoten nicht geben; falls doch, ist es ein 400 und kein 500
      if (!(e instanceof KatalogFehler) && f.text && /fts5|unterminated|syntax error|malformed match/i.test((e as Error).message)) throw new KatalogFehler(400, 'suche_ungueltig');
      throw e;
    } finally { db.close(); }
  }

  // Ordner (vollständige Pfade mit Zahl, der Baum entsteht in der Seite) und Facetten je Typ. Unabhängig vom Filter.
  baum(typ: Typ, f: { ohneSchutz?: boolean } = {}): { ordner: { pfad: string; n: number }[]; facetten: Record<string, { wert: string; n: number }[]>; gebaut_am: string } {
    return this.merke(`baum|${typ}|${f.ohneSchutz ? 1 : 0}`, () => this.baumRechnen(typ, f));
  }
  private baumRechnen(typ: Typ, f: { ohneSchutz?: boolean }): { ordner: { pfad: string; n: number }[]; facetten: Record<string, { wert: string; n: number }[]>; gebaut_am: string } {
    const { db, stand } = this.oeffne();
    try {
      const sch = f.ohneSchutz ? ' AND schutz IS NULL' : '';
      const ordner = db.prepare(`SELECT ordner AS pfad, count(*) AS n FROM katalog WHERE typ = ? AND ordner IS NOT NULL${sch} GROUP BY ordner ORDER BY ordner`)
        .all(typ) as { pfad: string; n: number }[];
      const facetten: Record<string, { wert: string; n: number }[]> = {};
      for (const feld of FACETTEN[typ]) {
        // Zeilen umkopieren: node:sqlite liefert Objekte mit Null-Prototyp, deepStrictEqual scheitert daran (Review M1).
        // Kein LIMIT: die Seite zeigt 40 und „+N more" (Tracks haben 66 Genres).
        facetten[feld] = (db.prepare(`SELECT coalesce(${facetteWert(feld)}, '') AS wert, count(*) AS n FROM katalog WHERE typ = ?${sch} GROUP BY ${facetteWert(feld)} ORDER BY n DESC, wert`)
          .all(typ) as { wert: string; n: number }[]).map((r) => ({ wert: r.wert, n: r.n }));
      }
      return { ordner: ordner.map((o) => ({ pfad: o.pfad, n: o.n })), facetten, gebaut_am: stand.gebaut_am ?? '' };
    } catch (e) { throw kaputt(e); } finally { db.close(); }
  }

  eintrag(sha: string): Zeile | null {
    if (!SHA.test(sha)) throw new KatalogFehler(400, 'sha_ungueltig');
    const { db } = this.oeffne();
    try {
      const z = db.prepare('SELECT * FROM katalog WHERE sha = ?').get(sha) as unknown as Zeile | undefined;
      if (z) return z;
      // Ein Track hat mehrere Objekte (shas); ein Listen-Posten kann auf ein unterlegenes zeigen (S5-Review B6)
      return (db.prepare(`SELECT * FROM katalog WHERE typ = 'track' AND (' ' || shas || ' ') LIKE ? LIMIT 1`).get(`% ${sha} %`) as unknown as Zeile | undefined) ?? null;
    } catch (e) { throw kaputt(e); } finally { db.close(); }
  }

  // Für Sets: Eintrag per material_id (sha-Präfix 16); mehrdeutig oder unbekannt → null (Track-Geschwister sind unbekannt)
  eintragMid(mid: string): Zeile | null {
    if (!/^[0-9a-f]{16}$/.test(mid)) return null;
    const { db } = this.oeffne();
    try { const z = db.prepare('SELECT * FROM katalog WHERE sha >= ? AND sha < ? LIMIT 2').all(mid, `${mid}g`) as unknown as Zeile[]; return z.length === 1 ? { ...z[0] } : null; }
    catch (e) { throw kaputt(e); } finally { db.close(); }
  }

  // Prepare path without a media library (vorbereit_source.ts): the rows of a material id, at most 2, same SQL as eintragMid without the length rule
  eintraegeMid(mid: string): Zeile[] {
    const { db } = this.oeffne();
    try { return (db.prepare('SELECT * FROM katalog WHERE sha >= ? AND sha < ? LIMIT 2').all(mid, `${mid}g`) as unknown as Zeile[]).map((z) => ({ ...z })); }
    catch (e) { throw kaputt(e); } finally { db.close(); }
  }

  // Who built this catalog and which folders it scanned (stand table); wurzeln stays empty when the entry is missing or not a list of paths
  herkunft(): { erbauer: string | null; wurzeln: string[] } {
    const { db, stand } = this.oeffne();
    db.close();
    let wurzeln: string[] = [];
    try { const j = JSON.parse(stand.wurzeln ?? '[]') as unknown; if (Array.isArray(j)) wurzeln = j.map((w) => (w as { pfad?: unknown } | null)?.pfad).filter((p): p is string => typeof p === 'string'); } catch { /* none */ }
    return { erbauer: stand.erbauer ?? null, wurzeln };
  }

  // Für das Detail einer Listen-Zeile: die kennt nur die material_id (sha-Präfix 16). Das ist das sha des Gewinner-Objekts oder, bei einem
  // Track, das eines seiner anderen Objekte (shas). Mehrdeutig oder unbekannt → null.
  eintragVonMid(mid: string): Zeile | null {
    if (!/^[0-9a-f]{16}$/.test(mid)) throw new KatalogFehler(400, 'mid_ungueltig');
    const { db } = this.oeffne();
    try {
      const z = db.prepare('SELECT * FROM katalog WHERE sha >= ? AND sha < ? LIMIT 2').all(mid, `${mid}g`) as unknown as Zeile[];
      if (z.length) return z.length === 1 ? { ...z[0] } : null;
      const w = db.prepare(`SELECT * FROM katalog WHERE typ = 'track' AND (' ' || shas) LIKE ? LIMIT 2`).all(`% ${mid}%`) as unknown as Zeile[];
      return w.length === 1 ? { ...w[0] } : null;
    } catch (e) { throw kaputt(e); } finally { db.close(); }
  }
}
