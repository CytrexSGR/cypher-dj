// Ablage der Projekte (Spec 2.9): <wurzel>/<slug>/{project.json, undo.jsonl}. Muster Sammlungen (sammlung.ts): Slug, exklusives mkdir,
// Temp-Datei + rename. Der Server hält keinen Projektzustand, der einen Neustart nicht überlebt: alles, was gilt, steht in diesen
// beiden Dateien.
// Haltbarkeit (Spec 6.7): project.json wird mit fsync auf die Temp-Datei, rename und fsync auf das Verzeichnis geschrieben.
// Sperren (sperre.ts), ehrlich begrenzt:
//   - `.lauf` hält ein geöffneter Verlauf (verlauf()/oeffne()) von der Öffnung bis schliesse(): ein zweites Öffnen desselben Projekts,
//     im selben Prozess (Register OFFEN) oder in einem anderen, ist 409 projekt_busy. Das schützt vor zwei Schreibern auf einem Log.
//   - `.sperre` umschließt nur das einzelne Schreiben von project.json (speichere). Wer speichere/lies OHNE geöffneten Verlauf aufruft,
//     ist dadurch nicht gegen einen zweiten Prozess geschützt; Lesen, Ändern, Schreiben als Ganzes sperrt sie nicht.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nimmSperre, SperreBelegt } from '../sperre.ts';
import { SLUG, slugVon } from '../sammlung.ts';
import { kanonisch, neuesProjekt, pruefeFehler, pruefeProjekt, sortiert, type Projekt } from './modell.ts';
import { Verlauf, zieheNach, type VerlaufOptionen } from './verlauf.ts';
import { grundText } from '../http/gruende.ts';

export { kanonisch };

// Keine Parameter-Properties (Node strippt nur Typen), Muster SammlungFehler.
export class AblageFehler extends Error {
  readonly code: number;
  readonly fehler: string;
  constructor(code: number, fehler: string, detail = '') { super(detail ? `${fehler}: ${detail}` : fehler); this.code = code; this.fehler = fehler; }
}

export interface ProjektEintrag { slug: string; name: string; geaendert: string; fehler?: string; text?: string }   // text: englisch (6.34)

// Slug wie bei den Sammlungen; ein Name ohne Buchstaben und Ziffern heißt „projekt" (nicht „set")
export function projektSlug(name: string): string {
  const s = slugVon(name);
  return s === 'set' && !/\bset\b/i.test(name) ? 'projekt' : s;
}

// Schlüssel tief sortiert, Zahlen wie JSON.stringify (Spec A8). Die Datei enthält genau diese Form.
export const normalisiere = (p: Projekt): Projekt => sortiert(p);        // sortiert baut neue Objekte, die Eingabe bleibt unberührt

// Wurzeln je Instanz. Betrieb: ''. Prüfinstanz: ein Buchstabe a bis z (die Pakete S1..S3 haben q..x, Spec 4). Projekte der Prüfinstanzen liegen
// im flüchtigen /dev/shm (nie im Betriebsordner), der Arbeitsordner folgt Spec 2.9 (~/.cache/cypherdj[-<i>]/arr).
function instanzPruefen(instanz: string): void {
  if (instanz !== '' && !/^[a-z]$/.test(instanz)) throw new Error(`Instanz ${instanz}: erlaubt sind a bis z`);
}
export function projektWurzelVorgabe(instanz: string): string {
  instanzPruefen(instanz);
  return instanz === '' ? path.join(os.homedir(), 'cypherdj-projekte') : `/dev/shm/cypherdj-${instanz}/projekte`;
}
export function arbeitsordnerVorgabe(instanz: string): string {
  instanzPruefen(instanz);
  return path.join(os.homedir(), '.cache', instanz === '' ? 'cypherdj' : `cypherdj-${instanz}`, 'arr');
}

// fsync auf eine Datei, die schon geschrieben und geschlossen ist (Linux: flusht den Inode, gleich über welchen Deskriptor)
function fsyncDatei(pfad: string): void {
  const fd = fs.openSync(pfad, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function fsyncVerzeichnis(pfad: string): void {
  const fd = fs.openSync(pfad, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

// Projekte, deren Verlauf in diesem Prozess offen ist (Schlüssel: absoluter Projektordner). Die Sperrdatei erkennt den eigenen Prozess
// nicht als Besitzer (sperre.ts: eine Sperre mit der eigenen PID ist ein Rest), darum braucht der Prozess selbst dieses Register.
const OFFEN = new Set<string>();

export class Projekte {
  private readonly wurzel: string;
  constructor(wurzel: string) { this.wurzel = wurzel; }
  get wurzelPfad(): string { return this.wurzel; }

  private ordner(slug: string): string {
    if (typeof slug !== 'string' || !SLUG.test(slug)) throw new AblageFehler(400, 'slug_ungueltig');
    return path.join(this.wurzel, slug);
  }
  private datei(slug: string): string { return path.join(this.ordner(slug), 'project.json'); }

  private mitSperre<T>(slug: string, f: () => T): T {
    let frei: () => void;
    try { frei = nimmSperre(path.join(this.ordner(slug), '.sperre')); }
    catch (e) {
      if (e instanceof SperreBelegt) throw new AblageFehler(409, 'projekt_busy');
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new AblageFehler(404, 'unbekannt');
      throw e;
    }
    try { return f(); } finally { frei(); }
  }

  private schreibe(slug: string, p: Projekt): void {
    const ziel = this.datei(slug), tmp = `${ziel}.${process.pid}.teil`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(normalisiere(p), null, 1) + '\n');
      fsyncDatei(tmp);                                                 // Inhalt auf der Platte, bevor der Name umgeschaltet wird
      fs.renameSync(tmp, ziel);
    } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
    fsyncVerzeichnis(path.dirname(ziel));                              // der neue Name selbst überlebt einen Stromausfall
  }

  liste(): ProjektEintrag[] {
    if (!fs.existsSync(this.wurzel)) return [];
    const aus: ProjektEintrag[] = [];
    const ordner = fs.readdirSync(this.wurzel, { withFileTypes: true }).filter((x) => x.isDirectory() && SLUG.test(x.name))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of ordner) {
      const p = path.join(this.wurzel, d.name, 'project.json');
      let st: fs.Stats;
      try { st = fs.statSync(p); } catch { continue; }
      const geaendert = st.mtime.toISOString();
      try {
        const j = JSON.parse(fs.readFileSync(p, 'utf8')) as { name?: unknown };
        if (typeof j?.name !== 'string') throw new Error('name');
        aus.push({ slug: d.name, name: j.name, geaendert });
      } catch { aus.push({ slug: d.name, name: d.name, geaendert, fehler: 'json_kaputt', text: grundText('json_kaputt') }); }
    }
    return aus;
  }

  lies(slug: string): Projekt {
    const p = this.datei(slug);
    if (!fs.existsSync(p)) throw new AblageFehler(404, 'unbekannt');
    let j: unknown;
    try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { throw new AblageFehler(409, 'json_kaputt'); }
    const g = pruefeProjekt(j);
    if ('fehler' in g) throw new AblageFehler(409, 'projekt_ungueltig', g.fehler);
    return g.projekt;
  }

  lege(name: string): { slug: string; projekt: Projekt } {
    const n = typeof name === 'string' ? name.trim() : '';
    if (n.length < 1 || n.length > 80) throw new AblageFehler(400, 'name_ungueltig');
    const basis = projektSlug(n);
    let slug = basis;
    // exklusiv anlegen: zwei Prozesse mit gleichem Namen bekommen verschiedene Slugs
    fs.mkdirSync(this.wurzel, { recursive: true });
    for (let i = 2; ; i++) {
      try { fs.mkdirSync(path.join(this.wurzel, slug)); break; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      slug = `${basis.slice(0, 44)}-${i}`;
    }
    const projekt = neuesProjekt(n);
    this.schreibe(slug, projekt);
    fs.writeFileSync(path.join(this.ordner(slug), 'undo.jsonl'), '', { flag: 'wx' });
    fsyncVerzeichnis(this.ordner(slug)); fsyncVerzeichnis(this.wurzel);
    return { slug, projekt };
  }

  // Ein ungültiges Projekt wird nie geschrieben; der alte Stand bleibt.
  speichere(slug: string, projekt: Projekt): void {
    this.datei(slug);                                                  // Slug prüfen, bevor etwas angefasst wird
    const fehler = pruefeFehler(projekt);
    if (fehler !== null) throw new AblageFehler(400, 'projekt_ungueltig', fehler);
    this.mitSperre(slug, () => this.schreibe(slug, projekt));
  }

  // Öffnet den Verlauf des Projekts und hält die Sperre `.lauf`, bis schliesse() gerufen wird (siehe Kopf der Datei). Wer ihn nicht
  // schliesst, hält das Projekt bis zum Prozessende: ein zweites Öffnen ist dann projekt_busy.
  // Öffnet den Verlauf für sich (ohne Nachziehen). Läuft das Log der Datei project.json voraus, ist dieser Weg falsch (jeder Schreibversuch
  // scheiterte an rev_nicht_steigend): dann 409 log_voraus, die Sperre ist wieder frei, und der Aufrufer nimmt oeffne() (Spec 6.7, 6.12).
  verlauf(slug: string, optionen?: VerlaufOptionen): Verlauf {
    const v = this.verlaufRoh(slug, optionen);
    let rev: number;
    try { rev = this.lies(slug).rev; } catch (e) { try { v.schliesse(); } catch { /* der erste Fehler zählt */ } throw e; }
    if (v.stand() > rev) {
      try { v.schliesse(); } catch { /* der erste Fehler zählt */ }
      throw new AblageFehler(409, 'log_voraus', `Log rev ${v.stand()}, project.json rev ${rev}: oeffne() zieht nach`);
    }
    return v;
  }

  private verlaufRoh(slug: string, optionen?: VerlaufOptionen): Verlauf {
    const o = this.ordner(slug);
    if (!fs.existsSync(path.join(o, 'project.json'))) throw new AblageFehler(404, 'unbekannt');
    const schluessel = path.resolve(o);
    if (OFFEN.has(schluessel)) throw new AblageFehler(409, 'projekt_busy');
    let frei: () => void;
    try { frei = nimmSperre(path.join(o, '.lauf')); } catch (e) { throw e instanceof SperreBelegt ? new AblageFehler(409, 'projekt_busy') : e; }
    OFFEN.add(schluessel);
    const losgelassen = (): void => { OFFEN.delete(schluessel); frei(); optionen?.beiSchliesse?.(); };
    try { return new Verlauf(path.join(o, 'undo.jsonl'), { ...optionen, beiSchliesse: losgelassen }); } catch (e) { losgelassen(); throw e; }
  }

  // Projekt und Verlauf zusammen öffnen (Spec 6.7): läuft das Log dem Projekt voraus, wird es aus dem Log nachgezogen und gespeichert.
  // `nachgezogen` sagt, wie viele Einträge das waren. Scheitert etwas, ist der Verlauf wieder geschlossen.
  oeffne(slug: string, optionen?: VerlaufOptionen): { projekt: Projekt; verlauf: Verlauf; nachgezogen: number } {
    const verlauf = this.verlaufRoh(slug, optionen);
    try {
      const z = zieheNach(verlauf, this.lies(slug));
      if (z.angewendet > 0) this.speichere(slug, z.projekt);
      return { projekt: z.projekt, verlauf, nachgezogen: z.angewendet };
    } catch (e) {
      try { verlauf.schliesse(); } catch { /* der erste Fehler zählt */ }
      throw e;
    }
  }
}
