// Collections on disk (package 1.16 rest, K1): one JSON file per collection, <ordner>/<slug>.json, ordner = ~/.config/cypherdj[-<i>]/kollektionen
// (same instance scheme as presets/speicher.ts nutzerVorgabe). Writes: complete temp file with fsync, then rename (overwrite) or link (create,
// refuses an existing name atomically). Read-change-write runs under ONE lock per folder (sperre.ts) against foreign processes; a lock held
// by a live foreign process gives 409 kollektion_busy at once. Deleted files go to <ordner>/.papierkorb.
// Rights (K2): Cypher may create collections and add items anywhere; she may remove items, rename or delete only when the file is readable
// AND marked as hers (autor 'cypher'); an unreadable file counts as unmarked (the same rule as presets/speicher.ts cypherDarfNicht).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { nimmSperre, SperreBelegt } from '../sperre.ts';
import { instanz } from '../pfade.ts';
import {
  DATEI_MAX, KollektionFehler, MAX_KOLLEKTIONEN, MAX_POSTEN, SCHEMA, postenListe, postenSchluessel, pruefeDatei, pruefeName, pruefeSlug, slugVon,
  type Kollektion, type Posten,
} from './modell.ts';

export type Quelle = 'andreas' | 'cypher';
export function kollektionenVorgabe(i: string = instanz()): string { return path.join(os.homedir(), '.config', i ? `cypherdj-${i}` : 'cypherdj', 'kollektionen'); }
// nachTemp: test hook, runs after the temp file is complete and before it replaces the old file (a writer killed there leaves the old file)
export interface KollektionOptionen { ordner?: string; jetzt?: () => Date; nachTemp?: (tmp: string) => void }
export interface ListenEintrag { slug: string; name: string; anzahl: number; autor?: 'cypher'; geaendert: string | null; fehler?: string }

export const cypherDarfNicht = (quelle: Quelle, alt: Kollektion | null): boolean => quelle === 'cypher' && !(alt !== null && alt.autor === 'cypher');
const ENDUNG = /^([a-z0-9][a-z0-9-]{0,47})\.json$/;

export class KollektionSpeicher {
  readonly ordner: string;
  private readonly jetzt: () => Date;
  private readonly nachTemp?: (tmp: string) => void;
  constructor(opt: KollektionOptionen = {}) {
    this.ordner = opt.ordner ?? kollektionenVorgabe();
    this.jetzt = opt.jetzt ?? (() => new Date());
    this.nachTemp = opt.nachTemp;
  }

  pfad(slug: unknown): string { return path.join(this.ordner, `${pruefeSlug(slug)}.json`); }

  private slugs(): string[] {
    let namen: fs.Dirent[];
    try { namen = fs.readdirSync(this.ordner, { withFileTypes: true }); } catch { return []; }
    return namen.filter((d) => d.isFile() && ENDUNG.test(d.name)).map((d) => ENDUNG.exec(d.name)![1]).sort();
  }

  liste(): ListenEintrag[] {
    return this.slugs().map((slug) => {
      try {
        const k = this.lies(slug);
        return { slug, name: k.name, anzahl: k.posten.length, ...(k.autor ? { autor: k.autor } : {}), geaendert: k.geaendert };
      } catch (e) {
        if (!(e instanceof KollektionFehler)) throw e;
        return { slug, name: slug, anzahl: 0, geaendert: null, fehler: e.fehler };   // listed with its reason, never dropped or repaired
      }
    });
  }

  lies(slug: unknown): Kollektion {
    const p = this.pfad(slug);
    let st: fs.Stats;
    try { st = fs.lstatSync(p); } catch { throw new KollektionFehler(404, 'unbekannt'); }
    if (!st.isFile()) throw new KollektionFehler(404, 'unbekannt');
    if (st.size > DATEI_MAX) throw new KollektionFehler(409, 'zu_gross');
    let j: unknown;
    try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { throw new KollektionFehler(409, 'json_kaputt'); }
    return pruefeDatei(j);
  }

  // the file for a rights check: null when it exists but cannot be read (409), so it counts as unmarked
  private liesFuerRechte(slug: string): Kollektion | null {
    try { return this.lies(slug); } catch (x) { if (x instanceof KollektionFehler && x.code === 409) return null; throw x; }
  }

  lege(name: unknown, quelle: Quelle): { slug: string } {
    const n = pruefeName(name);
    const slug = slugVon(n);
    return this.mitSperre(() => {
      if (this.slugs().length >= MAX_KOLLEKTIONEN) throw new KollektionFehler(409, 'zu_viele');
      const jetzt = this.zeit();
      this.legeAn(this.pfad(slug), { schema: SCHEMA, name: n, ...(quelle === 'cypher' ? { autor: 'cypher' as const } : {}), angelegt: jetzt, geaendert: jetzt, posten: [] });
      return { slug };
    });
  }

  // hinzu: appended in order, an item already there (or twice in hinzu) is ignored; weg: removed when present.
  // erwartet: the geaendert stamp the caller last saw (409 veraltet when the file changed since).
  aendere(slug: unknown, o: { hinzu?: unknown; weg?: unknown; erwartet?: unknown }, quelle: Quelle): { anzahl: number; geaendert: string } {
    const p = this.pfad(slug);
    const hinzu = postenListe(o.hinzu), weg = postenListe(o.weg);
    return this.mitSperre(() => {
      if (!fs.existsSync(p)) throw new KollektionFehler(404, 'unbekannt');
      if (weg.length && cypherDarfNicht(quelle, this.liesFuerRechte(slug as string))) throw new KollektionFehler(403, 'nur_andreas_kollektion');
      const k = this.lies(slug);
      if (o.erwartet !== undefined && o.erwartet !== k.geaendert) throw new KollektionFehler(409, 'veraltet');
      const raus = new Set(weg.map(postenSchluessel));
      const posten: Posten[] = k.posten.filter((x) => !raus.has(postenSchluessel(x)));
      const da = new Set(posten.map(postenSchluessel));
      for (const x of hinzu) { const s = postenSchluessel(x); if (!da.has(s)) { da.add(s); posten.push(x); } }
      if (posten.length > MAX_POSTEN) throw new KollektionFehler(409, 'zu_viele');
      // nothing changed (every added item was already there, nothing to remove): no write, the stamp stays, so a no-op by Cypher never
      // touches Andreas' file and never makes his open page stale
      if (posten.length === k.posten.length && posten.every((x, i) => postenSchluessel(x) === postenSchluessel(k.posten[i]))) {
        return { anzahl: posten.length, geaendert: k.geaendert };
      }
      const neu: Kollektion = { ...k, geaendert: this.zeit(), posten };
      this.schreibe(p, neu);
      return { anzahl: posten.length, geaendert: neu.geaendert };
    });
  }

  benenne(slug: unknown, name: unknown, quelle: Quelle): { slug: string } {
    const alt = this.pfad(slug);
    const n = pruefeName(name);
    const neuSlug = slugVon(n);
    return this.mitSperre(() => {
      if (!fs.existsSync(alt)) throw new KollektionFehler(404, 'unbekannt');
      if (cypherDarfNicht(quelle, this.liesFuerRechte(slug as string))) throw new KollektionFehler(403, 'nur_andreas_kollektion');
      const { autor: _a, ...rest } = this.lies(slug);
      // D27: the mark stays only when Cypher renames her own collection; a rename by Andreas makes it his (the mark goes)
      const k: Kollektion = { ...rest, ...(quelle === 'cypher' && _a === 'cypher' ? { autor: 'cypher' as const } : {}), name: n, geaendert: this.zeit() };
      if (neuSlug === slug) { this.schreibe(alt, k); return { slug: neuSlug }; }
      this.legeAn(this.pfad(neuSlug), k);   // EEXIST → name_vergeben, the old file stays
      fs.rmSync(alt, { force: true });
      return { slug: neuSlug };
    });
  }

  loesche(slug: unknown, quelle: Quelle): void {
    const p = this.pfad(slug);
    this.mitSperre(() => {
      try { if (!fs.lstatSync(p).isFile()) throw new Error('kein file'); } catch { throw new KollektionFehler(404, 'unbekannt'); }
      if (cypherDarfNicht(quelle, this.liesFuerRechte(slug as string))) throw new KollektionFehler(403, 'nur_andreas_kollektion');
      const korb = path.join(this.ordner, '.papierkorb');
      fs.mkdirSync(korb, { recursive: true });
      fs.renameSync(p, path.join(korb, `${slug}-${Date.now()}-${crypto.randomBytes(2).toString('hex')}.json`));
    });
  }

  private zeit(): string { return this.jetzt().toISOString(); }

  private mitSperre<T>(f: () => T): T {
    fs.mkdirSync(this.ordner, { recursive: true });
    let frei: () => void;
    try { frei = nimmSperre(path.join(this.ordner, '.sperre')); }
    catch (e) { if (e instanceof SperreBelegt) throw new KollektionFehler(409, 'kollektion_busy'); throw e; }
    try { return f(); } finally { frei(); }
  }

  private temp(p: string, k: Kollektion): string {
    const tmp = `${p}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    const fd = fs.openSync(tmp, 'wx');
    try { fs.writeSync(fd, JSON.stringify(k, null, 1) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    this.nachTemp?.(tmp);
    return tmp;
  }
  private schreibe(p: string, k: Kollektion): void {
    const tmp = this.temp(p, k);
    try { fs.renameSync(tmp, p); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  }
  private legeAn(p: string, k: Kollektion): void {
    const tmp = this.temp(p, k);
    try { fs.linkSync(tmp, p); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new KollektionFehler(409, 'name_vergeben'); throw e; }
    finally { fs.rmSync(tmp, { force: true }); }
  }
}
