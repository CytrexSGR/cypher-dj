// Mediathek-Anbindung (Plan 2026-10-03-mediathek-anbindung, T2): die Seite durchsucht die Mediathek (nur lesen) und schickt
// einen Track, der noch nicht im Bestand ist, durch die Werkstatt (Kindprozess werkstatt.einzeln, niedrige Priorität).
// - Die DB ist fremd (Beatport-Timer schreibt, WAL): jede Abfrage öffnet sie readOnly und schließt sie wieder.
// - Werk-Felder wie mediathek/suche.py:_felder_werk: je Feld über alle Objekte des Werks der Wert mit kleinstem Rang,
//   bei Gleichstand der jüngste erhoben_am. Quelle je Objekt ist die Sicht `aktuell`.
// - Schnell bleiben (Ziel < 300 ms bei 81 000 Objekten): Kandidaten erst per SQL (schmalster Filter), dann je Werk
//   zusammenführen und alles am Werk-Wert nachprüfen. Ein Werk-Wert stammt immer aus der aktuell-Zeile eines Objekts,
//   darum verliert die Vorauswahl kein Werk, das den Filter erfüllt.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

// Umgebung: CYPHERDJ_MEDIATHEK (sqlite, optional). Ungesetzt zeigt die Vorgabe auf eine Datei, die es
// nicht gibt: die Mediathek-Routen antworten dann 503 mediathek_fehlt, nichts stürzt.
export const MEDIATHEK_VORGABE = process.env.CYPHERDJ_MEDIATHEK || path.join(os.homedir(), '.local', 'share', 'cypherdj', 'mediathek', 'mediathek.sqlite');
export const LIMIT_VORGABE = 50, LIMIT_MAX = 200;
const FELDER = ['titel', 'kuenstler', 'mix', 'bpm', 'camelot', 'genre', 'typ'];
const ALLE_MAX = 1500;       // bis hierhin werden alle Kandidaten-Werke zusammengeführt (gesamt exakt, nach Titel sortiert)
const BLOCK = 300;           // Objekte je IN-Abfrage
const MID = /^[0-9a-f]{16}$/;

export class MediathekFehler extends Error {
  readonly code: number; readonly fehler: string;
  constructor(code: number, fehler: string) { super(fehler); this.code = code; this.fehler = fehler; }
}

export interface Anfrage { text?: string; camelot?: string; bpm?: [number, number]; genre?: string; limit?: number }
export const KLANG_TYPEN = ['oneshot', 'loop', 'impuls', 'mitschnitt', 'erzeugt', 'stimme'] as const;
export interface KlangAnfrage { text?: string; typ?: string; pack?: string; einsatz?: string; bpm?: [number, number]; camelot?: string; limit?: number }
export interface KlangTreffer {
  sha: string | null; pfad: string | null; pfad_da: boolean; typ: string; pack: string | null; kategorie: string | null; instrument: string | null;
  titel: string | null; dauer_s: number | null; bpm: number | null; camelot: string | null; einsatz: 'sofort' | 'werkstatt' | 'nur_live'; quelle: 'mediathek' | 'loopbib'; name?: string;
}
export interface Treffer {
  werk_id: number; titel: string | null; kuenstler: string | null; mix: string | null; bpm: number | null; camelot: string | null;
  genre: string | null; dauer_s: number | null; material_id: string | null; pfad_da: boolean; im_bestand: boolean;
  vorbereitung: string | null;
}
export interface Antwort { treffer: Treffer[]; gesamt: number; gesamt_genau: boolean }

interface Obj { sha: string; dauer_s: number | null; erst: string }
interface Wertzeile { inhalt_sha256: string; feld: string; wert: string; quelle: string; erhoben_am: string }

const maskiere = (s: string): string => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const wenig = (s: string): string => s.toLowerCase();

export function parseBpm(roh: string): [number, number] {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(?:-\s*(\d+(?:[.,]\d+)?))?\s*$/.exec(roh);
  if (!m) throw new MediathekFehler(400, 'bpm_ungueltig');
  const a = Number(m[1].replace(',', '.')), b = m[2] === undefined ? a : Number(m[2].replace(',', '.'));
  return a <= b ? [a, b] : [b, a];
}

export function parseLimit(roh: string | null): number {
  const n = roh === null || roh === '' ? NaN : Math.floor(Number(roh));
  if (!Number.isFinite(n)) return LIMIT_VORGABE;
  return Math.min(LIMIT_MAX, Math.max(1, n));
}

// Material-IDs im Bestand (derselbe index.sqlite wie leseBestand in server.ts)
export function bestandIds(dir: string): Set<string> {
  const idx = path.join(dir, 'index.sqlite');
  if (!fs.existsSync(idx)) return new Set();
  const db = new DatabaseSync(idx, { readOnly: true });
  try { return new Set((db.prepare('SELECT DISTINCT material_id FROM fassung').all() as { material_id: string }[]).map((r) => r.material_id)); }
  finally { db.close(); }
}

export interface PostenFelder {
  titel: string | null; kuenstler: string | null; mix: string | null; bpm: number | null; camelot: string | null; genre: string | null;
  dauer_s: number | null; pfad_da: boolean; bestand_mid: string | null;
}

export class Mediathek {
  private readonly pfad: string; private readonly host: string;
  constructor(pfad: string, host: string = os.hostname()) { this.pfad = pfad; this.host = host; }

  vorhanden(): boolean { return fs.existsSync(this.pfad); }

  listen(): { id: number; name: string; n: number }[] {
    const db = this.oeffne();
    try {
      return db.prepare(`SELECT l.id, l.name, count(e.inhalt_sha256) AS n FROM liste l JOIN listen_eintrag e ON e.liste_id = l.id
        WHERE l.quelle = 'traktor' AND e.inhalt_sha256 IS NOT NULL GROUP BY l.id HAVING n > 0 ORDER BY l.name`).all() as { id: number; name: string; n: number }[];
    } finally { db.close(); }
  }

  listeMids(id: number): { name: string; mids: string[] } {
    const db = this.oeffne();
    try {
      const l = db.prepare(`SELECT name FROM liste WHERE id = ? AND quelle = 'traktor'`).get(id) as { name: string } | undefined;
      if (!l) throw new MediathekFehler(404, 'liste_unbekannt');
      const z = db.prepare('SELECT inhalt_sha256 FROM listen_eintrag WHERE liste_id = ? AND inhalt_sha256 IS NOT NULL ORDER BY position').all(id) as { inhalt_sha256: string }[];
      return { name: l.name, mids: [...new Set(z.map((r) => r.inhalt_sha256.slice(0, 16)))] };
    } finally { db.close(); }
  }

  private oeffne(): DatabaseSync {
    if (!this.vorhanden()) throw new MediathekFehler(503, 'mediathek_fehlt');
    return new DatabaseSync(this.pfad, { readOnly: true });
  }

  private rang(db: DatabaseSync): Map<string, number> {
    return new Map((db.prepare('SELECT quelle, rang FROM rang').all() as { quelle: string; rang: number }[]).map((r) => [r.quelle, r.rang]));
  }

  // Für Sets: Werk-Felder je material_id (Präfix des sha), dazu bestand_mid (irgendein Objekt des Werks im Bestand) und
  // pfad_da (im Bestand oder eine lokale Datei existiert). Unbekannte/mehrdeutige mids fehlen in der Antwort.
  // Batch: ein Durchlauf über objekt für alle Werke (kein Index auf werk_id).
  felder(mids: string[], bestand: Set<string>): Map<string, PostenFelder> {
    const aus = new Map<string, PostenFelder>();
    const gueltig = [...new Set(mids.filter((m) => MID.test(m)))];
    if (gueltig.length === 0) return aus;
    const db = this.oeffne();
    try {
      const rang = this.rang(db);
      const obj = new Map<string, { sha: string; werk: number | null; dauer_s: number | null }>();
      const st = db.prepare('SELECT inhalt_sha256, werk_id, dauer_s FROM objekt WHERE inhalt_sha256 >= ? AND inhalt_sha256 < ?');
      for (const m of gueltig) {
        const z = st.all(m, `${m}g`) as { inhalt_sha256: string; werk_id: number | null; dauer_s: number | null }[];
        if (z.length === 1) obj.set(m, { sha: z[0].inhalt_sha256, werk: z[0].werk_id, dauer_s: z[0].dauer_s });
      }
      const werke = [...new Set([...obj.values()].map((o) => o.werk).filter((w): w is number => w !== null))];
      const geschw = this.geschwister(db, werke);
      const shasJe = new Map<string, string[]>();
      for (const [m, o] of obj) shasJe.set(m, o.werk === null ? [o.sha] : (geschw.get(o.werk) ?? []).map((x) => x.sha));
      const alle = [...new Set([...shasJe.values()].flat())];
      const werteJe = new Map<string, Wertzeile[]>();
      for (const z of this.werte(db, alle)) { const l = werteJe.get(z.inhalt_sha256) ?? []; l.push(z); werteJe.set(z.inhalt_sha256, l); }
      const fund = this.fundorte(db, [...obj.values()].map((o) => o.sha));
      const zahl = (s: string | undefined): number | null => { const n = Number(s); return s !== undefined && s !== '' && Number.isFinite(n) ? n : null; };
      for (const [m, o] of obj) {
        const shas = shasJe.get(m)!;
        const f = this.werkFelder(shas.flatMap((s) => werteJe.get(s) ?? []), rang);
        const bestandMid = shas.map((s) => s.slice(0, 16)).find((x) => bestand.has(x)) ?? null;
        const pfadDa = bestandMid !== null || (fund.get(o.sha) ?? []).some((p) => fs.existsSync(p));
        aus.set(m, { titel: f.titel ?? null, kuenstler: f.kuenstler ?? null, mix: f.mix ?? null, bpm: zahl(f.bpm), camelot: f.camelot ?? null,
          genre: f.genre ?? null, dauer_s: o.dauer_s, pfad_da: pfadDa, bestand_mid: bestandMid });
      }
      return aus;
    } finally { db.close(); }
  }

  // Werk-Felder aus den aktuell-Zeilen der Objekte eines Werks
  private werkFelder(zeilen: Wertzeile[], rang: Map<string, number>): Record<string, string> {
    const bester = new Map<string, { rang: number; am: string; wert: string }>();
    for (const z of zeilen) {
      const r = rang.get(z.quelle) ?? 999;
      const b = bester.get(z.feld);
      if (!b || r < b.rang || (r === b.rang && z.erhoben_am > b.am)) bester.set(z.feld, { rang: r, am: z.erhoben_am, wert: z.wert });
    }
    const f: Record<string, string> = {};
    for (const [k, v] of bester) f[k] = v.wert;
    return f;
  }

  // Fassung eines Werks: die erste mit lokal vorhandenem Pfad (Host = dieser Rechner, gegen das Dateisystem geprüft, nicht
  // gegen fundort.erreichbar), sonst die erste mit lokalem Fundort, sonst das erste Objekt.
  // Liegt irgendein Objekt des Werks im Bestand, ist das die Fassung (ladbar, kein zweiter Render).
  private waehleFassung(objekte: Obj[], fundorte: Map<string, string[]>, bestand: Set<string>): { obj: Obj; pfad: string | null; da: boolean } {
    const imB = objekte.find((o) => bestand.has(o.sha.slice(0, 16)));
    if (imB) return { obj: imB, pfad: null, da: true };
    let ersterLokal: { obj: Obj; pfad: string } | null = null;
    for (const o of objekte) {
      for (const p of fundorte.get(o.sha) ?? []) {
        if (fs.existsSync(p)) return { obj: o, pfad: p, da: true };
        ersterLokal ??= { obj: o, pfad: p };
      }
    }
    return ersterLokal ? { ...ersterLokal, da: false } : { obj: objekte[0], pfad: null, da: false };
  }

  private fundorte(db: DatabaseSync, shas: string[]): Map<string, string[]> {
    const m = new Map<string, string[]>();
    for (let i = 0; i < shas.length; i += BLOCK) {
      const teil = shas.slice(i, i + BLOCK);
      const z = db.prepare(`SELECT inhalt_sha256, pfad FROM fundort WHERE host = ? AND inhalt_sha256 IN (${teil.map(() => '?').join(',')}) ORDER BY pfad`)
        .all(this.host, ...teil) as { inhalt_sha256: string; pfad: string }[];
      for (const r of z) { const l = m.get(r.inhalt_sha256) ?? []; l.push(r.pfad); m.set(r.inhalt_sha256, l); }
    }
    return m;
  }

  private werte(db: DatabaseSync, shas: string[]): Wertzeile[] {
    const aus: Wertzeile[] = [];
    for (let i = 0; i < shas.length; i += BLOCK) {
      const teil = shas.slice(i, i + BLOCK);
      aus.push(...db.prepare(`SELECT inhalt_sha256, feld, wert, quelle, erhoben_am FROM aktuell WHERE inhalt_sha256 IN (${teil.map(() => '?').join(',')})
        AND feld IN (${FELDER.map((f) => `'${f}'`).join(',')})`).all(...teil) as unknown as Wertzeile[]);
    }
    return aus;
  }

  // Kandidaten: je Filter die Objekte mit einer passenden (nicht ersetzten) Angabe, dazu immer die mit typ=track, geschnitten.
  // Eine Obermenge von dem, was `aktuell` liefert (jeder Werk-Wert ist eine aktuell-Zeile), nachgeprüft wird am Werk-Wert.
  // `NOT INDEXED`: der Teilindex angabe_akt führt per Zufallszugriff durch die Tabelle (110 ms), der Durchlauf kostet 27 ms.
  // Ergebnis: sha → werk_id (Objekte ohne Werk fallen im Join weg).
  private kandidaten(db: DatabaseSync, a: Anfrage): Map<string, number> {
    const hole = (bedingung: string, ...p: (string | number)[]): Map<string, number> => {
      const m = new Map<string, number>();
      for (const r of db.prepare(`SELECT a.inhalt_sha256 AS s, o.werk_id AS w FROM angabe a NOT INDEXED JOIN objekt o ON o.inhalt_sha256 = a.inhalt_sha256
        WHERE a.ersetzt_durch IS NULL AND o.werk_id IS NOT NULL AND ${bedingung}`).all(...p) as { s: string; w: number }[]) m.set(r.s, r.w);
      return m;
    };
    const sets = [hole(`a.feld = 'typ' AND a.wert = 'track'`)];
    if (a.text) sets.push(hole(`a.feld IN ('titel','kuenstler','mix') AND a.wert LIKE ? ESCAPE '\\'`, maskiere(a.text)));
    if (a.camelot) sets.push(hole(`a.feld = 'camelot' AND a.wert = ? COLLATE NOCASE`, a.camelot));
    if (a.bpm) sets.push(hole(`a.feld = 'bpm' AND CAST(a.wert AS REAL) BETWEEN ? AND ?`, a.bpm[0], a.bpm[1]));
    if (a.genre) sets.push(hole(`a.feld = 'genre' AND a.wert LIKE ? ESCAPE '\\'`, maskiere(a.genre)));
    sets.sort((x, y) => x.size - y.size);
    return new Map([...sets[0]].filter(([s]) => sets.every((m) => m.has(s))));
  }

  // Alle Objekte der Werke, in Reihenfolge erstmals_gesehen, sha (objekt hat keinen Index auf werk_id; ein Durchlauf je Aufruf)
  private geschwister(db: DatabaseSync, werke: number[]): Map<number, Obj[]> {
    const m = new Map<number, Obj[]>();
    if (werke.length === 0) return m;
    const z = db.prepare(`SELECT inhalt_sha256, werk_id, dauer_s, erstmals_gesehen FROM objekt WHERE werk_id IN (${werke.map(() => '?').join(',')})`).all(...werke) as
      { inhalt_sha256: string; werk_id: number; dauer_s: number | null; erstmals_gesehen: string | null }[];
    for (const r of z) { const l = m.get(r.werk_id) ?? []; l.push({ sha: r.inhalt_sha256, dauer_s: r.dauer_s, erst: r.erstmals_gesehen ?? '' }); m.set(r.werk_id, l); }
    for (const l of m.values()) l.sort((x, y) => (x.erst < y.erst ? -1 : x.erst > y.erst ? 1 : x.sha < y.sha ? -1 : 1));
    return m;
  }

  private passt(f: Record<string, string>, a: Anfrage): boolean {
    if (f.typ !== 'track') return false;
    if (a.text) {
      const n = wenig(a.text);
      if (!['titel', 'kuenstler', 'mix'].some((k) => wenig(f[k] ?? '').includes(n))) return false;
    }
    if (a.camelot && wenig(f.camelot ?? '') !== wenig(a.camelot)) return false;
    if (a.bpm) { const b = Number(f.bpm); if (!(b >= a.bpm[0] && b <= a.bpm[1])) return false; }
    if (a.genre && !wenig(f.genre ?? '').includes(wenig(a.genre))) return false;
    return true;
  }

  suche(a: Anfrage, bestand: Set<string>, vorbereitung: (mid: string) => string | null): Antwort {
    const db = this.oeffne();
    try {
      const limit = Math.min(LIMIT_MAX, Math.max(1, a.limit ?? LIMIT_VORGABE));
      const rang = this.rang(db);
      const kandWerke = [...new Set(this.kandidaten(db, a).values())].sort((x, y) => x - y);
      const genau = kandWerke.length <= ALLE_MAX;
      const werke = new Map<number, Obj[]>();
      const angenommen: { werk: number; f: Record<string, string> }[] = [];
      // in Blöcken von Werken zusammenführen; ohne Exaktheitsanspruch hören wir auf, sobald limit Werke angenommen sind
      for (let i = 0; i < kandWerke.length && (genau || angenommen.length < limit); i += genau ? ALLE_MAX : 100) {
        const block = kandWerke.slice(i, i + (genau ? ALLE_MAX : 100));
        for (const [w, l] of this.geschwister(db, block)) werke.set(w, l);
        const werkVon = new Map<string, number>();
        for (const w of block) for (const o of werke.get(w) ?? []) werkVon.set(o.sha, w);
        const je = new Map<number, Wertzeile[]>();
        for (const z of this.werte(db, [...werkVon.keys()])) { const w = werkVon.get(z.inhalt_sha256)!; const l = je.get(w) ?? []; l.push(z); je.set(w, l); }
        for (const w of block) {
          const f = this.werkFelder(je.get(w) ?? [], rang);
          if (this.passt(f, a)) angenommen.push({ werk: w, f });
        }
      }
      if (genau) angenommen.sort((x, y) => (x.f.titel ?? '').localeCompare(y.f.titel ?? '', 'de', { sensitivity: 'base' }) || x.werk - y.werk);
      const gesamt = genau ? angenommen.length : kandWerke.length;
      const wahl = angenommen.slice(0, limit);
      const fund = this.fundorte(db, wahl.flatMap((x) => werke.get(x.werk)!.map((o) => o.sha)));
      const treffer = wahl.map(({ werk, f }): Treffer => {
        const fa = this.waehleFassung(werke.get(werk)!, fund, bestand);
        const mid = fa.obj ? fa.obj.sha.slice(0, 16) : null;
        const zahl = (s: string | undefined): number | null => { const n = Number(s); return s !== undefined && s !== '' && Number.isFinite(n) ? n : null; };
        return { werk_id: werk, titel: f.titel ?? null, kuenstler: f.kuenstler ?? null, mix: f.mix ?? null, bpm: zahl(f.bpm), camelot: f.camelot ?? null,
          genre: f.genre ?? null, dauer_s: fa.obj?.dauer_s ?? null, material_id: mid, pfad_da: fa.da, im_bestand: mid !== null && bestand.has(mid),
          vorbereitung: mid !== null ? vorbereitung(mid) : null };
      });
      return { treffer, gesamt, gesamt_genau: genau };
    } finally { db.close(); }
  }

  // Klänge (Plan 2026-10-06-klaenge, T1): Einzelklänge statt Werke. Ein Treffer je Objekt (sha), Fundort = erster Pfad dieses Hosts.
  // Felder je Objekt aus der Sicht `aktuell` (ein Wert je Feld, Rang schon aufgelöst), keine Werk-Zusammenführung:
  // Klänge haben keine Geschwister. Text: Pfad ab der Fundort-Wurzel (nicht das Präfix davor), pack, kategorie, instrument, titel (Teilstring, ohne Groß/Klein, `%` ist keiner).
  klaenge(a: KlangAnfrage): { treffer: KlangTreffer[]; gesamt: number } {
    const db = this.oeffne();
    try {
      const limit = Math.min(LIMIT_MAX, Math.max(1, a.limit ?? 30));
      const typen = a.typ ? [a.typ] : [...KLANG_TYPEN];
      const w: string[] = [`f.host = ?`, `k.typ IN (${typen.map(() => '?').join(',')})`];
      const par: (string | number)[] = [this.host, ...typen];
      if (a.text) {
        const m = maskiere(a.text.toLowerCase());
        w.push(`(lower(substr(f.pfad, coalesce(length(f.wurzel), 0) + 1)) LIKE ? ESCAPE '\\' OR lower(k.pack) LIKE ? ESCAPE '\\' OR lower(k.kategorie) LIKE ? ESCAPE '\\' OR lower(k.instrument) LIKE ? ESCAPE '\\' OR lower(k.titel) LIKE ? ESCAPE '\\')`);
        par.push(m, m, m, m, m);
      }
      if (a.pack) { w.push(`lower(k.pack) LIKE ? ESCAPE '\\'`); par.push(maskiere(a.pack.toLowerCase())); }
      if (a.camelot) { w.push(`lower(k.camelot) = ?`); par.push(a.camelot.toLowerCase()); }
      if (a.bpm) { w.push(`CAST(k.bpm AS REAL) BETWEEN ? AND ?`); par.push(a.bpm[0], a.bpm[1]); }
      if (a.einsatz === 'nur_live') w.push(`k.schutz = 'ableton'`);
      if (a.einsatz === 'werkstatt') w.push(`(k.schutz IS NULL OR k.schutz <> 'ableton')`);
      // Vorauswahl (Superset, die Endprüfung steht in w): Typ-Angaben und Text-Treffer als sha-Menge, damit die Sicht `aktuell`
      // nur für wenige Objekte aufgelöst wird (gemessen auf 81 000 Objekten: ganze Sicht 2,1 s, so 0,6 s)
      const cparam: (string | number)[] = [...typen];
      let cand = `SELECT inhalt_sha256 FROM angabe WHERE feld = 'typ' AND ersetzt_durch IS NULL AND wert IN (${typen.map(() => '?').join(',')})`;
      if (a.text) {
        const m = maskiere(a.text.toLowerCase());
        cand += ` INTERSECT SELECT inhalt_sha256 FROM (SELECT inhalt_sha256 FROM fundort WHERE host = ? AND lower(substr(pfad, coalesce(length(wurzel), 0) + 1)) LIKE ? ESCAPE '\\'
          UNION SELECT inhalt_sha256 FROM angabe WHERE ersetzt_durch IS NULL AND feld IN ('pack','kategorie','instrument','titel') AND lower(wert) LIKE ? ESCAPE '\\')`;
        cparam.push(this.host, m, m);
      }
      const von = `WITH cand AS (${cand}), k AS (SELECT inhalt_sha256 AS s, max(CASE WHEN feld='typ' THEN wert END) AS typ, max(CASE WHEN feld='pack' THEN wert END) AS pack,
          max(CASE WHEN feld='kategorie' THEN wert END) AS kategorie, max(CASE WHEN feld='instrument' THEN wert END) AS instrument,
          max(CASE WHEN feld='titel' THEN wert END) AS titel, max(CASE WHEN feld='bpm' THEN wert END) AS bpm,
          max(CASE WHEN feld='camelot' THEN wert END) AS camelot, max(CASE WHEN feld='schutz' THEN wert END) AS schutz
        FROM aktuell WHERE inhalt_sha256 IN (SELECT inhalt_sha256 FROM cand) AND feld IN ('typ','pack','kategorie','instrument','titel','bpm','camelot','schutz') GROUP BY inhalt_sha256)
        SELECT o.inhalt_sha256 AS sha, min(f.pfad) AS pfad, o.dauer_s, k.typ, k.pack, k.kategorie, k.instrument, k.titel, k.bpm, k.camelot, k.schutz
        FROM fundort f JOIN objekt o ON o.inhalt_sha256 = f.inhalt_sha256 JOIN k ON k.s = o.inhalt_sha256 WHERE ${w.join(' AND ')} GROUP BY o.inhalt_sha256`;
      const z = db.prepare(`SELECT *, count(*) OVER () AS gesamt FROM (${von}) ORDER BY pfad LIMIT ?`).all(...cparam, ...par, limit) as { gesamt: number; sha: string; pfad: string; dauer_s: number | null; typ: string; pack: string | null;
        kategorie: string | null; instrument: string | null; titel: string | null; bpm: string | null; camelot: string | null; schutz: string | null }[];
      const zahl = (s: string | null): number | null => { const n = Number(s); return s !== null && s !== '' && Number.isFinite(n) ? n : null; };
      const treffer = z.map((r): KlangTreffer => ({ sha: r.sha, pfad: r.pfad, pfad_da: fs.existsSync(r.pfad), typ: r.typ, pack: r.pack, kategorie: r.kategorie,
        instrument: r.instrument, titel: r.titel, dauer_s: r.dauer_s, bpm: zahl(r.bpm), camelot: r.camelot,
        einsatz: r.schutz === 'ableton' ? 'nur_live' : 'werkstatt', quelle: 'mediathek' }));
      return { treffer, gesamt: z.length > 0 ? z[0].gesamt : 0 };
    } finally { db.close(); }
  }

  // Karte (Plan 2026-10-06-klaenge, T2): Zahlen je Klang-Typ (gesamt, werkstatt, nur_live) und die größten Packs, ein Treffer je Objekt
  // mit Fundort auf diesem Host (wie klaenge). `sofort` kennt die Mediathek nicht, das kommt aus der Loop-Bibliothek (Server).
  karte(): { je_typ: Record<string, { gesamt: number; werkstatt: number; nur_live: number }>; packs: { pack: string; gesamt: number; nur_live: number }[]; mediathek_stand: string } {
    const db = this.oeffne();
    try {
      const typen = [...KLANG_TYPEN];
      const mit = `WITH cand AS (SELECT DISTINCT a.inhalt_sha256 AS s FROM angabe a WHERE a.feld = 'typ' AND a.ersetzt_durch IS NULL AND a.wert IN (${typen.map(() => '?').join(',')})
          AND EXISTS (SELECT 1 FROM fundort f WHERE f.inhalt_sha256 = a.inhalt_sha256 AND f.host = ?)),
        k AS (SELECT inhalt_sha256 AS s, max(CASE WHEN feld='typ' THEN wert END) AS typ, max(CASE WHEN feld='pack' THEN wert END) AS pack, max(CASE WHEN feld='schutz' THEN wert END) AS schutz
          FROM aktuell WHERE inhalt_sha256 IN (SELECT s FROM cand) AND feld IN ('typ','pack','schutz') GROUP BY inhalt_sha256)`;
      const par = [...typen, this.host];
      const z = db.prepare(`${mit} SELECT typ, count(*) AS gesamt, sum(CASE WHEN schutz = 'ableton' THEN 1 ELSE 0 END) AS live FROM k WHERE typ IN (${typen.map(() => '?').join(',')}) GROUP BY typ`)
        .all(...par, ...typen) as { typ: string; gesamt: number; live: number }[];
      const je_typ: Record<string, { gesamt: number; werkstatt: number; nur_live: number }> = {};
      for (const t of typen) je_typ[t] = { gesamt: 0, werkstatt: 0, nur_live: 0 };
      for (const r of z) je_typ[r.typ] = { gesamt: r.gesamt, werkstatt: r.gesamt - r.live, nur_live: r.live };
      const packs = (db.prepare(`${mit} SELECT pack, count(*) AS gesamt, sum(CASE WHEN schutz = 'ableton' THEN 1 ELSE 0 END) AS nur_live FROM k
        WHERE typ IN (${typen.map(() => '?').join(',')}) AND pack IS NOT NULL GROUP BY pack ORDER BY gesamt DESC, pack LIMIT 40`).all(...par, ...typen) as { pack: string; gesamt: number; nur_live: number }[])
        .map((r) => ({ pack: r.pack, gesamt: r.gesamt, nur_live: r.nur_live }));
      return { je_typ, packs, mediathek_stand: new Date(fs.statSync(this.pfad).mtimeMs).toISOString() };
    } finally { db.close(); }
  }

  /** Änderungsmarke für den Zwischenspeicher der Karte: mtime der DB und ihrer WAL-Datei (der Scan schreibt über WAL). */
  stand(): number {
    let m = 0;
    for (const f of [this.pfad, `${this.pfad}-wal`]) { try { m = Math.max(m, fs.statSync(f).mtimeMs); } catch { /* fehlt */ } }
    return m;
  }

  // Für POST /mediathek/vorbereiten: Pfad (lokal, vorhanden) und Titel zur material_id
  // Hat das Werk schon ein Objekt im Bestand, kommt dessen material_id als `vorhanden` zurück (kein zweiter Render).
  quelle(mid: string, bestand: Set<string>): { pfad: string; titel: string; vorhanden?: string } {
    if (!MID.test(mid)) throw new MediathekFehler(400, 'material_id_ungueltig');
    const db = this.oeffne();
    try {
      const obj = db.prepare('SELECT inhalt_sha256, werk_id FROM objekt WHERE inhalt_sha256 >= ? AND inhalt_sha256 < ?').all(mid, `${mid}g`) as { inhalt_sha256: string; werk_id: number | null }[];
      if (obj.length !== 1) throw new MediathekFehler(404, obj.length === 0 ? 'unbekannt' : 'material_id_mehrdeutig');
      const sha = obj[0].inhalt_sha256;
      if (obj[0].werk_id !== null) {
        const gleiche = (db.prepare('SELECT inhalt_sha256 FROM objekt WHERE werk_id = ?').all(obj[0].werk_id) as { inhalt_sha256: string }[]).map((r) => r.inhalt_sha256.slice(0, 16));
        const da = gleiche.find((m) => bestand.has(m));
        if (da !== undefined) return { pfad: '', titel: '', vorhanden: da };
      }
      const pfade = (db.prepare('SELECT pfad FROM fundort WHERE host = ? AND inhalt_sha256 = ? ORDER BY pfad').all(this.host, sha) as { pfad: string }[]).map((r) => r.pfad);
      const pfad = pfade.find((p) => fs.existsSync(p));
      if (pfad === undefined) throw new MediathekFehler(409, 'datei_fehlt');
      const rang = this.rang(db);
      const shas = obj[0].werk_id === null ? [sha]
        : (db.prepare('SELECT inhalt_sha256 FROM objekt WHERE werk_id = ?').all(obj[0].werk_id) as { inhalt_sha256: string }[]).map((r) => r.inhalt_sha256);
      const f = this.werkFelder(this.werte(db, shas), rang);
      const kopf = [f.kuenstler, f.titel].filter((s) => s).join(' – ');
      const titel = (kopf ? kopf + (f.mix ? ` - ${f.mix}` : '') : path.basename(pfad, path.extname(pfad)));
      return { pfad, titel };
    } finally { db.close(); }
  }
}

// ---- Vorbereiten: Kindprozess werkstatt.einzeln, höchstens einer je material_id, höchstens zwei zugleich ----

export interface VorbereitStand { status: 'laeuft' | 'neu' | 'vorhanden' | 'fehler'; grund?: string }
export interface VorbereiterOptionen {
  python: string; cwd: string; bestand: string; modul?: string; maxGleichzeitig?: number; zeitlimitMs?: number;
  log?: (zeile: Record<string, unknown>) => void;
}

function imPfad(prog: string): boolean {
  return (process.env.PATH ?? '').split(path.delimiter).some((d) => d !== '' && fs.existsSync(path.join(d, prog)));
}

export class Vorbereiter {
  private readonly staende = new Map<string, VorbereitStand>();
  private readonly laeufe = new Map<string, ChildProcess>();
  private readonly max: number;
  private readonly ionice = imPfad('ionice');
  private readonly o: VorbereiterOptionen;
  constructor(o: VorbereiterOptionen) { this.o = o; this.max = o.maxGleichzeitig ?? 2; }

  stand(mid: string): VorbereitStand | null { return this.staende.get(mid) ?? null; }
  // Text für die Trefferliste: null | "laeuft" | "fehler:<grund>"
  anzeige(mid: string): string | null {
    const s = this.staende.get(mid);
    return s === undefined ? null : s.status === 'laeuft' ? 'laeuft' : s.status === 'fehler' ? `fehler:${s.grund ?? 'unbekannt'}` : null;
  }

  // 'laeuft' = ein Lauf für diese mid besteht schon, 'ausgelastet' = kein freier Platz, 'gestartet' = neu angestoßen
  starte(mid: string, quelle: string, titel: string): 'gestartet' | 'laeuft' | 'ausgelastet' {
    if (this.laeufe.has(mid)) return 'laeuft';
    if (this.laeufe.size >= this.max) return 'ausgelastet';
    const args = ['-n', '19', ...(this.ionice ? ['ionice', '-c3'] : []), this.o.python, '-m', this.o.modul ?? 'werkstatt.einzeln',
      '--quelle', quelle, '--titel', titel, '--bestand', this.o.bestand];
    const kind = spawn('nice', args, { cwd: this.o.cwd, stdio: ['ignore', 'pipe', 'pipe'] });   // keine Shell: Titel und Pfad bleiben Argumente
    this.laeufe.set(mid, kind);
    this.staende.set(mid, { status: 'laeuft' });
    let aus = '', fehl = '', fertig = false;
    kind.stdout.on('data', (d: Buffer) => { aus += d; if (aus.length > 65536) aus = aus.slice(-32768); });
    kind.stderr.on('data', (d: Buffer) => { fehl += d; if (fehl.length > 8192) fehl = fehl.slice(-4096); });
    const ende = (stand: VorbereitStand): void => {
      if (fertig) return;
      fertig = true; clearTimeout(zeit);
      this.laeufe.delete(mid); this.staende.set(mid, stand);
      this.o.log?.({ typ: 'vorbereitet', material_id: mid, status: stand.status, grund: stand.grund });
    };
    const zeit = setTimeout(() => { kind.kill('SIGKILL'); ende({ status: 'fehler', grund: 'zeitlimit' }); }, this.o.zeitlimitMs ?? 20 * 60_000);
    zeit.unref();
    kind.once('error', () => ende({ status: 'fehler', grund: 'start' }));
    kind.once('close', (rc) => {
      // Vertrag des Einlesers: die letzte JSON-Zeile auf stdout {"status": neu|vorhanden|fehler, "material_id", "grund"?}
      const zeilen = aus.split('\n').map((z) => z.trim()).filter(Boolean);
      let j: { status?: unknown; grund?: unknown } | null = null;
      try { j = JSON.parse(zeilen[zeilen.length - 1] ?? '') as typeof j; } catch { j = null; }
      if (j && (j.status === 'neu' || j.status === 'vorhanden')) return ende({ status: j.status });
      const grund = j && j.status === 'fehler' && typeof j.grund === 'string' ? j.grund
        : rc === 0 ? 'keine_antwort' : `exit_${rc}`;
      if (!j) this.o.log?.({ typ: 'vorbereiten_stderr', material_id: mid, rc, stderr: fehl.slice(-500) });
      ende({ status: 'fehler', grund });
    });
    return 'gestartet';
  }

  stoppe(): void { for (const k of this.laeufe.values()) k.kill('SIGKILL'); }
}
