// Katalog des Browsers (Plan 2026-10-10-mediathek-browser): liest die abgeleitete Datei katalog.sqlite, die
// cypher-mediathek (`mediathek katalog`) neben die Mediathek baut. Sie hat eine Zeile je Track-Werk, Loop und One-Shot
// mit Fundort auf dem bauenden Host. Nur lesen, je Abfrage öffnen und schließen: der Bau ersetzt die Datei per rename.
// Gemessen 2026-10-10 (88 807 Zeilen): Seite ≤ 2 ms, Zählung 1,8 ms, FTS ≤ 133 ms. Zählen ist eine eigene Abfrage,
// weil count(*) OVER () alles sortiert (85 ms).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseSuche } from './suchtext.ts';

export type Typ = 'track' | 'loop' | 'oneshot';
// Nicht „TYPEN": server.ts:127 hat schon eine MIME-Tabelle dieses Namens (Plan-Review B1, gemessen SyntaxError)
export const KATALOG_TYPEN: readonly Typ[] = ['track', 'loop', 'oneshot'];
// Facetten je Typ (Plan 2.1): feste Spaltennamen, nie aus der Anfrage
export const FACETTEN: Record<Typ, readonly string[]> = { track: ['genre'], loop: ['pack'], oneshot: ['instrument', 'pack'] };
// Facettenwert einer Spalte: NULL, '' und Leerraum → NULL (der Baum zeigt es als „(none)“). `feld` kommt nur aus FACETTEN.
const facetteWert = (feld: string, pre = ''): string => `nullif(trim(${pre}${feld}), '')`;
export const SCHEMA = '1';
// Camelot-Key → [gleich, −1, +1 (mit Umlauf 12→1), Paralleltonart]; Unsinn 400
export function camelotNachbarn(k: string): string[] {
  const m = /^\s*(\d{1,2})([AB])\s*$/i.exec(k);
  const n = m ? Number(m[1]) : 0;
  if (!m || n < 1 || n > 12) throw new KatalogFehler(400, 'camelot_ungueltig');
  const b = m[2].toUpperCase(), r = (x: number): number => ((x + 11) % 12) + 1;
  return [`${n}${b}`, `${r(n - 1)}${b}`, `${r(n + 1)}${b}`, `${n}${b === 'A' ? 'B' : 'A'}`];
}
// Energie-Klassen wie anschluss.ts energieKlasse (Andreas' Ohr 2026-10-10: drei Klassen)
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
export interface Filter { text?: string; ordner?: string; facette?: { feld: string; wert: string }; camelot?: string; nachbarn?: boolean; bpm?: [number, number]; energie?: 0 | 1 | 2 }

export class KatalogFehler extends Error {
  readonly code: number; readonly fehler: string;
  constructor(code: number, fehler: string) { super(fehler); this.code = code; this.fehler = fehler; }
}

// Vorgabe: neben der Mediathek (so baut cypher-mediathek); CYPHERDJ_KATALOG überschreibt
export function katalogVorgabe(mediathek: string): string {
  return process.env.CYPHERDJ_KATALOG || path.join(path.dirname(mediathek), 'katalog.sqlite');
}

const SHA = /^[0-9a-f]{64}$/;
// LIKE-Muster aus Text: %, _ und \ sind Zeichen (ESCAPE '\')
const maske = (s: string): string => s.normalize('NFC').toLowerCase().replace(/[\\%_]/g, '\\$&');

export class Katalog {
  private readonly pfad: string;
  constructor(pfad: string) { this.pfad = pfad; }

  vorhanden(): boolean { return fs.existsSync(this.pfad); }

  private oeffne(): { db: DatabaseSync; stand: Record<string, string> } {
    if (!this.vorhanden()) throw new KatalogFehler(503, 'katalog_fehlt');
    const db = new DatabaseSync(this.pfad, { readOnly: true });
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
    if (f.camelot) { const c = camelotNachbarn(f.camelot); const l = f.nachbarn ? c : [c[0]]; w.push(`k.camelot IN (${l.map(() => '?').join(',')})`); par.push(...l); }
    if (f.bpm) { w.push('k.bpm BETWEEN ? AND ?'); par.push(f.bpm[0], f.bpm[1]); }
    if (f.energie !== undefined) w.push(ENERGIE_SQL[f.energie]);
    if (f.text) {
      const s = parseSuche(f.text);
      if (s.zuviele) throw new KatalogFehler(400, 'zu_viele_suchwoerter');
      // Gemessen 2026-10-10: FTS naiv gejoint + ORDER BY = 19,8 s (FTS je Zeile abgefragt); als MATERIALIZED-CTE 14 ms
      if (s.fts) { mit = 'WITH t AS MATERIALIZED (SELECT rowid AS id FROM katalog_fts WHERE katalog_fts MATCH ?) '; mpar.push(s.fts); }
      for (const o of s.ordner) { w.push(`klein(k.ordner) LIKE ? ESCAPE '\\'`); par.push(`%${maske(o)}%`); }
    }
    return { mit, von: mit ? 'katalog k JOIN t ON t.id = k.id' : 'katalog k', sql: w.join(' AND '), par: [...mpar, ...par] };
  }

  seite(typ: Typ, f: Filter, sort: string, ab: boolean, seite: number, limit: number): { zeilen: Zeile[]; gesamt: number; gebaut_am: string } {
    const spalte = Object.hasOwn(SORTIERUNG[typ], sort) ? SORTIERUNG[typ][sort] : undefined;
    if (!spalte) throw new KatalogFehler(400, 'sort_ungueltig');
    const { db, stand } = this.oeffne();
    try {
      const { mit, von, sql, par } = this.wo(typ, f);
      const gesamt = (db.prepare(`${mit}SELECT count(*) AS n FROM ${von} WHERE ${sql}`).get(...par) as { n: number }).n;
      const zeilen = db.prepare(`${mit}SELECT k.* FROM ${von} WHERE ${sql} ORDER BY ${spalte.startsWith('CASE') ? spalte : `k.${spalte}`} ${ab ? 'DESC' : 'ASC'} NULLS LAST, k.id LIMIT ? OFFSET ?`)
        .all(...par, limit, seite * limit) as unknown as Zeile[];
      return { zeilen, gesamt, gebaut_am: stand.gebaut_am ?? '' };
    } catch (e) {
      // FTS-Syntaxfehler sollte es durch das Quoten nicht geben; falls doch, ist es ein 400 und kein 500
      if (!(e instanceof KatalogFehler) && f.text && /fts5|unterminated|syntax error|malformed match/i.test((e as Error).message)) throw new KatalogFehler(400, 'suche_ungueltig');
      throw e;
    } finally { db.close(); }
  }

  // Ordner (vollständige Pfade mit Zahl, der Baum entsteht in der Seite) und Facetten je Typ. Unabhängig vom Filter.
  baum(typ: Typ): { ordner: { pfad: string; n: number }[]; facetten: Record<string, { wert: string; n: number }[]>; gebaut_am: string } {
    const { db, stand } = this.oeffne();
    try {
      const ordner = db.prepare('SELECT ordner AS pfad, count(*) AS n FROM katalog WHERE typ = ? AND ordner IS NOT NULL GROUP BY ordner ORDER BY ordner')
        .all(typ) as { pfad: string; n: number }[];
      const facetten: Record<string, { wert: string; n: number }[]> = {};
      for (const feld of FACETTEN[typ]) {
        // Zeilen umkopieren: node:sqlite liefert Objekte mit Null-Prototyp, deepStrictEqual scheitert daran (Review M1).
        // Kein LIMIT: die Seite zeigt 40 und „+N more" (Tracks haben 66 Genres).
        facetten[feld] = (db.prepare(`SELECT coalesce(${facetteWert(feld)}, '') AS wert, count(*) AS n FROM katalog WHERE typ = ? GROUP BY ${facetteWert(feld)} ORDER BY n DESC, wert`)
          .all(typ) as { wert: string; n: number }[]).map((r) => ({ wert: r.wert, n: r.n }));
      }
      return { ordner: ordner.map((o) => ({ pfad: o.pfad, n: o.n })), facetten, gebaut_am: stand.gebaut_am ?? '' };
    } finally { db.close(); }
  }

  eintrag(sha: string): Zeile | null {
    if (!SHA.test(sha)) throw new KatalogFehler(400, 'sha_ungueltig');
    const { db } = this.oeffne();
    try {
      const z = db.prepare('SELECT * FROM katalog WHERE sha = ?').get(sha) as unknown as Zeile | undefined;
      if (z) return z;
      // Ein Track hat mehrere Objekte (shas); ein Listen-Posten kann auf ein unterlegenes zeigen (S5-Review B6)
      return (db.prepare(`SELECT * FROM katalog WHERE typ = 'track' AND (' ' || shas || ' ') LIKE ? LIMIT 1`).get(`% ${sha} %`) as unknown as Zeile | undefined) ?? null;
    } finally { db.close(); }
  }

  // Für Sets: Eintrag per material_id (sha-Präfix 16); mehrdeutig oder unbekannt → null (Track-Geschwister sind unbekannt)
  eintragMid(mid: string): Zeile | null {
    if (!/^[0-9a-f]{16}$/.test(mid)) return null;
    const { db } = this.oeffne();
    try { const z = db.prepare('SELECT * FROM katalog WHERE sha >= ? AND sha < ? LIMIT 2').all(mid, `${mid}g`) as unknown as Zeile[]; return z.length === 1 ? { ...z[0] } : null; }
    finally { db.close(); }
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
    } finally { db.close(); }
  }
}
