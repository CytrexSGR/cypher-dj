// Ablage der Projekte (Spec 2.9): <wurzel>/<slug>/{project.json, undo.jsonl}. Muster Sammlungen (collection.ts): Slug, exklusives mkdir,
// Temp-Datei + rename. Der Server hält keinen Projektzustand, der einen Neustart nicht überlebt: alles, was gilt, steht in diesen
// beiden Dateien.
// Haltbarkeit (Spec 6.7): project.json wird mit fsync auf die Temp-Datei, rename und fsync auf das Verzeichnis geschrieben.
// Sperren (lock.ts), ehrlich begrenzt:
//   - `.lauf` hält ein geöffneter Verlauf (verlauf()/oeffne()) von der Öffnung bis schliesse(): ein zweites Öffnen desselben Projekts,
//     im selben Prozess (Register OFFEN) oder in einem anderen, ist 409 projekt_busy. Das schützt vor zwei Schreibern auf einem Log.
//   - `.sperre` umschließt nur das einzelne Schreiben von project.json (speichere). Wer speichere/lies OHNE geöffneten Verlauf aufruft,
//     ist dadurch nicht gegen einen zweiten Prozess geschützt; Lesen, Ändern, Schreiben als Ganzes sperrt sie nicht.
import fs from 'node:fs';
import os from 'node:os';
import { ablageOrdner, type AblageOptionen } from '../paths.ts';
import path from 'node:path';
import { nimmSperre, SperreBelegt } from '../lock.ts';
import { SLUG, slugVon } from '../collection.ts';
import { insertSpaeterKanonisch } from './insert_spaeter.ts';
import { bkInsertKanonisch, bkReglerKanonisch, setzeVorgabenQuelle, vorgabenVonGraph as vorgabenQuelle } from './modular.ts';
export { setzeVorgabenQuelle };
import { seqV1Wandeln } from './seq.ts';
import { alleStraenge, kanonisch, hebeAufDrei, neuesProjekt, pruefeFehler, pruefeProjekt, sortiert, type Projekt } from './model.ts';
import { Verlauf, zieheNach, type VerlaufOptionen } from './history.ts';
import { aendereStand } from './state.ts';
import { grundText } from '../http/reasons.ts';
import { liesZuletzt } from './zuletzt.ts';
import { Versionen, VERSIONEN_ORDNER } from './versionen.ts';

export { kanonisch };

// Keine Parameter-Properties (Node strippt nur Typen), Muster SammlungFehler.
export class AblageFehler extends Error {
  readonly code: number;
  readonly fehler: string;
  constructor(code: number, fehler: string, detail = '') { super(detail ? `${fehler}: ${detail}` : fehler); this.code = code; this.fehler = fehler; }
}

// text: englisch (6.34); werkbank: the project is a workbench module; tracker: it is a tracker module (marker `tracker`, never together with werkbank)
export interface ProjektEintrag {
  slug: string; name: string; geaendert: string; zuletzt: string; fehler?: string; text?: string; werkbank?: true; tracker?: true;
}

// Slug wie bei den Sammlungen; ein Name ohne Buchstaben und Ziffern heißt „projekt" (nicht „set")
export function projektSlug(name: string): string {
  const s = slugVon(name);
  return s === 'set' && !/\bset\b/i.test(name) ? 'projekt' : s;
}

// Schlüssel tief sortiert, Zahlen wie JSON.stringify (Spec A8). Die Datei enthält genau diese Form.
// 64 knobs: k9..k64 of a bk insert stage at 0.5 and trailing `vorgabe` values of a snapshot `regler` are not written,
// so a project without knob 9..32 stays readable by older builds
export const normalisiere = (p: Projekt): Projekt => {
  const n = sortiert(p) as Projekt;                                       // sortiert baut neue Objekte, die Eingabe bleibt unberührt
  for (const { strang } of alleStraenge(n)) {
    for (const i of strang.inserts ?? []) {
      if (i.art === 'bk') bkInsertKanonisch(i.werte); else if (i.art !== 'host') insertSpaeterKanonisch(i.art, i.werte);
    }
  }
  // the sound snapshot: pad to 64, cut trailing values equal to the graph's `vorgabe` down to 8
  for (const e of n.baukasten ?? []) e.regler = bkReglerKanonisch(e.regler, vorgabenQuelle(e.graph));
  return n;
};

// Wurzeln je Instanz. Betrieb: ''. Prüfinstanz: ein Buchstabe a bis z (die Pakete S1..S3 haben q..x, Spec 4). Projekte der Prüfinstanzen liegen
// im flüchtigen /dev/shm (nie im Betriebsordner), der Arbeitsordner folgt Spec 2.9 (~/.cache/cypherdj[-<i>]/arr).
function instanzPruefen(instanz: string): void {
  if (instanz !== '' && !/^[a-z]$/.test(instanz)) throw new Error(`Instanz ${instanz}: erlaubt sind a bis z`);
}
export function projektWurzelVorgabe(instanz: string, o: AblageOptionen = {}): string {
  instanzPruefen(instanz);
  return instanz === '' ? ablageOrdner('projekte', o) : `/dev/shm/cypherdj-${instanz}/projekte`;
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
// nicht als Besitzer (lock.ts: eine Sperre mit der eigenen PID ist ein Rest), darum braucht der Prozess selbst dieses Register.
const OFFEN = new Set<string>();

export class Projekte {
  private readonly wurzel: string;
  versionen: Versionen;                                                // B10: copies under <project>/.versionen/ (project/versionen.ts)
  constructor(wurzel: string) { this.wurzel = wurzel; this.versionen = new Versionen(wurzel); }
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
    const stempel = liesZuletzt(this.wurzel);   // browser plan 2: the stamp of the last open, read once per call
    const ordner = fs.readdirSync(this.wurzel, { withFileTypes: true }).filter((x) => x.isDirectory() && SLUG.test(x.name))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of ordner) {
      const p = path.join(this.wurzel, d.name, 'project.json');
      let st: fs.Stats;
      try { st = fs.statSync(p); } catch { continue; }
      const geaendert = st.mtime.toISOString();
      const zuletzt = stempel[d.name] ?? geaendert;
      try {
        const j = JSON.parse(fs.readFileSync(p, 'utf8')) as { name?: unknown; werkbank?: unknown; tracker?: unknown };
        if (typeof j?.name !== 'string') throw new Error('name');
        aus.push({ slug: d.name, name: j.name, geaendert, zuletzt, ...(j.werkbank !== undefined ? { werkbank: true as const } : {}),
          ...(j.tracker !== undefined ? { tracker: true as const } : {}) });
      } catch { aus.push({ slug: d.name, name: d.name, geaendert, zuletzt, fehler: 'json_kaputt', text: grundText('json_kaputt') }); }
    }
    // most recently opened first; the stable sort keeps the slug order for equal times
    return aus.sort((a, b) => Date.parse(b.zuletzt) - Date.parse(a.zuletzt));
  }

  lies(slug: string): Projekt {
    const p = this.datei(slug);
    if (!fs.existsSync(p)) throw new AblageFehler(404, 'unbekannt');
    let j: unknown;
    try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { throw new AblageFehler(409, 'json_kaputt'); }
    seqV1Wandeln(j);   // SEQ deck v2: a stored v1 step document becomes the plain marker before the check (it is written on the next save)
    const g = pruefeProjekt(j);
    if ('fehler' in g) throw new AblageFehler(409, 'projekt_ungueltig', g.fehler);
    return g.projekt;
  }

  // werkbank: a loop workbench module (stage 1), never together with live. tracker: a tracker project, the marker {schema: 1} (never with live or werkbank).
  // live: the live container (plan live-module): flag set, loop region on over beats 0..64. Without it the project is exactly what it was before.
  lege(name: string, opt: { live?: true; werkbank?: true; tracker?: true } = {}): { slug: string; projekt: Projekt } {
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
    // the default layout track, track, strudel, track
    if (opt.live) { projekt.live = true; projekt.loop = { an: true, von_beat: 0, bis_beat: 64 }; hebeAufDrei(projekt); }
    // workbench module: marker, loop over 4 bars
    if (opt.werkbank) { projekt.werkbank = { schema: 1 }; projekt.loop = { an: true, von_beat: 0, bis_beat: 16 }; }
    if (opt.tracker) projekt.tracker = { schema: 1 };
    this.schreibe(slug, projekt);
    fs.writeFileSync(path.join(this.ordner(slug), 'undo.jsonl'), '', { flag: 'wx' });
    fsyncVerzeichnis(this.ordner(slug)); fsyncVerzeichnis(this.wurzel);
    return { slug, projekt };
  }

  // A copy of a project under a new name (workbench shelf SAVE AS, A 2026-11-16: "speichern der module wäre auch sinnvoll"): the folder with its media
  // (export, stems, resample, loops ...) and project.json with the new name; the history starts empty and so does the playback identity
  // (wiedergabe_rev 0: the first open does a full load, it is never taken for a restart of the source's playback), so the copy is a
  // version of its own. Locks and half-written files are not copied. The slug is made as in lege().
  kopiere(slug: string, name: string): { slug: string; projekt: Projekt } {
    const quelle = this.lies(slug);
    const n = typeof name === 'string' ? name.trim() : '';
    if (n.length < 1 || n.length > 80) throw new AblageFehler(400, 'name_ungueltig');
    const basis = projektSlug(n);
    let ziel = basis;
    fs.mkdirSync(this.wurzel, { recursive: true });
    for (let i = 2; ; i++) {
      try { fs.mkdirSync(path.join(this.wurzel, ziel)); break; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      ziel = `${basis.slice(0, 44)}-${i}`;
    }
    const von = this.ordner(slug), nach = this.ordner(ziel);
    const weg = new Set(['.sperre', '.lauf', 'undo.jsonl', 'project.json', VERSIONEN_ORDNER]);
    try {
      for (const e of fs.readdirSync(von)) {
        if (weg.has(e) || e.endsWith('.teil')) continue;
        fs.cpSync(path.join(von, e), path.join(nach, e), { recursive: true, filter: (q) => !q.endsWith('.teil') });
      }
      const projekt: Projekt = { ...structuredClone(quelle), name: n, wiedergabe_rev: 0 };
      this.schreibe(ziel, projekt);
      fs.writeFileSync(path.join(nach, 'undo.jsonl'), '', { flag: 'wx' });
      fsyncVerzeichnis(nach); fsyncVerzeichnis(this.wurzel);
      return { slug: ziel, projekt };
    } catch (e) {
      fs.rmSync(nach, { recursive: true, force: true });
      throw e;
    }
  }

  // Browser plan 5 (import of a project zip): takes in an unpacked project folder that lies under the projects root (same filesystem). Reads and
  // checks <ordner>/project.json as opening does (409 projekt_ungueltig), claims a free slug from the project's own name (as lege() and
  // kopiere() do), MOVES the children of the folder (no second copy), writes the project as `umschreiben` returns it with wiedergabe_rev 0
  // and an empty undo.jsonl. A failure removes the new folder; the unpacked folder stays the caller's to remove.
  nimmAuf(ordner: string, umschreiben: (p: Projekt) => Projekt): { slug: string; projekt: Projekt } {
    let j: unknown;
    try { j = JSON.parse(fs.readFileSync(path.join(ordner, 'project.json'), 'utf8')); } catch { throw new AblageFehler(409, 'projekt_ungueltig',
      'project.json is not readable JSON'); }
    seqV1Wandeln(j);
    const g = pruefeProjekt(j);
    if ('fehler' in g) throw new AblageFehler(409, 'projekt_ungueltig', g.fehler);
    const basis = projektSlug(g.projekt.name);
    let slug = basis;
    fs.mkdirSync(this.wurzel, { recursive: true });
    for (let i = 2; ; i++) {
      try { fs.mkdirSync(path.join(this.wurzel, slug)); break; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      slug = `${basis.slice(0, 44)}-${i}`;
    }
    const nach = this.ordner(slug);
    const weg = new Set(['.sperre', '.lauf', 'undo.jsonl', 'project.json', '.papierkorb', VERSIONEN_ORDNER]);
    try {
      for (const e of fs.readdirSync(ordner)) {
        if (weg.has(e) || e.endsWith('.teil')) continue;
        fs.renameSync(path.join(ordner, e), path.join(nach, e));
      }
      const projekt: Projekt = { ...umschreiben(structuredClone(g.projekt)), wiedergabe_rev: 0 };
      this.schreibe(slug, projekt);
      fs.writeFileSync(path.join(nach, 'undo.jsonl'), '', { flag: 'wx' });
      fsyncVerzeichnis(nach); fsyncVerzeichnis(this.wurzel);
      return { slug, projekt };
    } catch (e) {
      fs.rmSync(nach, { recursive: true, force: true });
      throw e;
    }
  }

  // Removes a project from the list: its folder moves to <wurzel>/.papierkorb/<slug>-<time> (a dot folder, never listed), so nothing is lost and it can
  // be put back by hand. A project open in a process (its `.lauf` lock is held) is refused with projekt_busy.
  entferne(slug: string): { papierkorb: string } {
    const von = this.ordner(slug);
    if (!fs.existsSync(path.join(von, 'project.json'))) throw new AblageFehler(404, 'unbekannt');
    let frei: () => void;
    try { frei = nimmSperre(path.join(von, '.lauf')); }
    catch (e) { if (e instanceof SperreBelegt) throw new AblageFehler(409, 'projekt_busy'); throw e; }
    const korb = path.join(this.wurzel, '.papierkorb');
    const nach = path.join(korb, `${slug}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    try {
      fs.mkdirSync(korb, { recursive: true });
      fs.renameSync(von, nach);
    } finally { try { frei(); } catch { /* the lock moved with the folder */ } }
    try { fs.rmSync(path.join(nach, '.lauf'), { force: true }); } catch { /* a stale lock file in the bin does no harm */ }
    fsyncVerzeichnis(this.wurzel);
    return { papierkorb: nach };
  }

  // Ein ungültiges Projekt wird nie geschrieben; der alte Stand bleibt.
  speichere(slug: string, projekt: Projekt): void {
    this.datei(slug);                                                  // Slug prüfen, bevor etwas angefasst wird
    const fehler = pruefeFehler(projekt);
    if (fehler !== null) throw new AblageFehler(400, 'projekt_ungueltig', fehler);
    this.mitSperre(slug, () => {
      this.versionen.sichereAuto(slug, 'speichern');                    // the state being replaced; swallows its own errors
      this.schreibe(slug, projekt);
    });
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
      let vorher: Buffer | undefined;
      try { vorher = fs.readFileSync(this.datei(slug)); } catch { /* lies() below reports it */ }
      const z = zieheNach(verlauf, this.lies(slug));
      this.versionen.sichereAuto(slug, 'oeffnen', vorher);               // the file as the user left it, before the write-back
      if (z.angewendet > 0) this.speichere(slug, z.projekt);
      return { projekt: z.projekt, verlauf, nachgezogen: z.angewendet };
    } catch (e) {
      try { verlauf.schliesse(); } catch { /* der erste Fehler zählt */ }
      throw e;
    }
  }

  // B10 RESTORE at storage level. Precondition: the project is not open in this process (the caller closed it; an open one is projekt_busy).
  // Order: validate the chosen version (nothing is written when it is unknown or invalid; a newer format fails the model check) -> take the
  // lock by opening -> save the CURRENT project.json as the named version `before restore` -> write the chosen content as ONE undoable entry with
  // wiedergabe_rev 0 (the next open does a full load, and the close-time write-back cannot undo it). A version equal to the current state writes
  // nothing (aendereStand returns eintrag null); the safety version is made anyway.
  // Read-only check of a stored version: known id, JSON, v1 step document lifted like lies(), model check. The session calls it before it closes anything.
  pruefeVersion(slug: string, id: string): { projekt: Projekt } {
    this.ordner(slug);
    const bekannt = typeof id === 'string' && this.versionen.liste(slug).some((v) => v.id === id);   // the id is only matched, never joined from the client
    if (!bekannt) throw new AblageFehler(404, 'version_unbekannt');
    let j: unknown;
    try { j = JSON.parse(this.versionen.lies(slug, id).toString('utf8')); } catch { throw new AblageFehler(409, 'version_ungueltig', 'not JSON'); }
    seqV1Wandeln(j);
    const g = pruefeProjekt(j);
    if ('fehler' in g) throw new AblageFehler(409, 'version_ungueltig', g.fehler);
    return g;
  }
  stelleWiederHer(slug: string, id: string, quelle: string): { gesichert_als: string } {
    this.ordner(slug);
    const g = this.pruefeVersion(slug, id);
    const o = this.oeffne(slug, { zeitgeber: false });
    try {
      const gesichert_als = this.versionen.sichereBenannt(slug, 'before restore', fs.readFileSync(this.datei(slug)));
      const alt = o.projekt;
      const neu: Projekt = { ...g.projekt, rev: alt.rev, wiedergabe_rev: alt.wiedergabe_rev };
      aendereStand(o.verlauf, alt, neu, { quelle: quelle as 'andreas' | 'cypher', label: 'version zurueck' },
        { speichere: (p) => this.speichere(slug, { ...p, wiedergabe_rev: 0 }) });
      return { gesichert_als };
    } finally { o.verlauf.schliesse(); }
  }
}
