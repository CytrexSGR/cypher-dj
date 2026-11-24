// A project as one zip (browser plan 5, B13): export of the open project and import into a new slug. Pure folder work around zipwerk.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { alleAudioClips } from './commands.ts';
import { alleZellen, KIT_NAME, pruefeProjekt, type Projekt } from './model.ts';
import { KitFehler, braucheFreienPlatz, installiereKitOrdner, kitsOrdnerVon, pruefeKitOrdner } from './kit_storage.ts';
import { kitNamenImProjekt, schreibeKitBezuegeKarte } from './kit_bezug.ts';
import { findeKopie } from './source_path.ts';
import { seqV1Wandeln } from './seq.ts';
import { AblageFehler, type Projekte } from './storage.ts';
import { VERSIONEN_ORDNER } from './versionen.ts';
import { ZipFehler, entpacke, packe, zipGroesse, type ZipBericht } from './zipwerk.ts';

const drin = (wurzel: string, p: string): boolean => p === wurzel || p.startsWith(wurzel.endsWith(path.sep) ? wurzel : wurzel + path.sep);
const echt = (p: string): string => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

/** The resolved paths of the project's audio sources (clips, then loop cells, each sha once) that are NOT collected: no copy in `<project>/audio/` and the
 *  resolved path lies outside the project folder. A source that does not resolve at all is not outside (it cannot be exported, it does not block). */
export function projektAusserhalb(a: { projekt: unknown; projektOrdner: string; quellPfad: (sha: string, hinweis: string) => string | null }): string[] {
  const p = a.projekt as Projekt;
  const wurzel = echt(a.projektOrdner);
  const quellen = [...alleAudioClips(p)].map((c) => ({ sha: c.quelle.sha256, hinweis: c.quelle.pfad_hinweis }))
    .concat([...alleZellen(p)].map((z) => ({ sha: z.sha256, hinweis: z.pfad_hinweis ?? '' })));
  const gesehen = new Set<string>(), aus: string[] = [];
  for (const { sha, hinweis } of quellen) {
    if (gesehen.has(sha)) continue;
    gesehen.add(sha);
    if (findeKopie(a.projektOrdner, sha) !== null) continue;
    const pfad = a.quellPfad(sha, hinweis);
    if (pfad === null || drin(wurzel, echt(pfad))) continue;
    aus.push(pfad);
  }
  return aus;
}

export const EXPORT_OHNE: string[] = [`${VERSIONEN_ORDNER}/`, '.papierkorb/', 'aufnahmen/.laufend-*.json', 'kits/.alt-*', 'kits/.einspielen-*', '.lauf',
  '.sperre', '*.teil'];

function ordnerBytes(ordner: string): number {
  let n = 0;
  for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
    const p = path.join(ordner, e.name);
    if (e.name === VERSIONEN_ORDNER || e.name === '.papierkorb') continue;
    try {
      if (e.isDirectory()) n += ordnerBytes(p);
      else n += fs.statSync(p).size;
    } catch { /* vanished or a dead link */ }
  }
  return n;
}

/** The audio references of a project (clips of all tracks and takes, then loop cells): the objects themselves, so a caller can rewrite the hint in place. */
const audioQuellen = (p: Projekt): { sha: string; setze: (h: string) => void; hinweis: string }[] => [
  ...[...alleAudioClips(p)].map((c) => ({ sha: c.quelle.sha256, hinweis: c.quelle.pfad_hinweis, setze: (h: string) => { c.quelle.pfad_hinweis = h; } })),
  ...[...alleZellen(p)].map((z) => ({ sha: z.sha256, hinweis: z.pfad_hinweis ?? '', setze: (h: string) => { if (h === '' &&
    z.pfad_hinweis === undefined) return; z.pfad_hinweis = h; } })),
];

/** Sets every hint to the project-local copy by sha (`audio/<file>`), or drops it when the project holds no copy: an absolute path of this machine never
 *  travels, and a foreign zip cannot point a clip at any file of the importing machine. Returns whether anything changed. */
export function schreibeHinweiseNeu(projekt: Projekt, kopien: ReadonlyMap<string, string>): boolean {
  let geaendert = false;
  for (const q of audioQuellen(projekt)) {
    const neu = kopien.get(q.sha) ?? '';
    if (neu !== q.hinweis) { q.setze(neu); geaendert = true; }
  }
  return geaendert;
}

async function dateiSha(p: string): Promise<string> {
  const h = crypto.createHash('sha256');
  for await (const stueck of fs.createReadStream(p)) h.update(stueck as Buffer);
  return h.digest('hex');
}

/** Every file in `<ordner>/audio/` that would be found for a sha the project names (name ends in `-<sha8>.<ext>`) must really hash to that sha
 *  (streamed, async). A mislabeled file is refused: the decode cache is keyed by sha, a wrong file would poison other projects. */
async function pruefeAudioSha(projekt: Projekt, ordner: string): Promise<void> {
  const audio = path.join(ordner, 'audio');
  let namen: string[];
  try { namen = fs.readdirSync(audio); } catch { return; }
  const geprueft = new Set<string>();
  for (const { sha } of audioQuellen(projekt)) {
    if (!/^[0-9a-f]{8}/.test(sha)) continue;
    const ende = new RegExp(`-${sha.slice(0, 8)}\\.[^./]+$`);
    for (const n of namen.filter((x) => ende.test(x)).sort()) {
      const key = `${sha}/${n}`;
      if (geprueft.has(key)) continue;
      geprueft.add(key);
      const f = path.join(audio, n);
      if (!fs.statSync(f).isFile()) continue;
      if ((await dateiSha(f)) !== sha) throw new KitFehler(409, 'audio_sha_falsch',
        `the audio file audio/${n} does not match the sha256 the project names for it`, `audio/${n}`);
    }
  }
}

/** `audio/<file>` of the collected copy of every sha the project names (those without a copy are absent from the map). */
function kopienVon(projekt: Projekt, ordner: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const { sha } of audioQuellen(projekt)) {
    const k = findeKopie(ordner, sha);
    if (k !== null) m.set(sha, `audio/${path.basename(k)}`);
  }
  return m;
}

const zipText = (grund: string, was: 'export' | 'import'): string => (grund === 'zu_gross_entpackt'
  ? (was === 'export' ? 'the project is larger than 4 GiB and cannot be exported as one zip' : 'the zip unpacks to more than 4 GiB')
  : grund === 'zu_viele_eintraege' ? `the ${was === 'export' ? 'project holds' : 'zip holds'} too many files for one zip`
    : `the zip was refused: ${grund}`);

/** Zips the project folder (new file `zip`). Every kit the project names travels: the project's own `kits/<name>/` first, else the one of the kit folder
 *  (409 kit_fehlt naming the kits found nowhere). Absolute audio hints are rewritten to `audio/<copy>` in the zip's project.json. */
export async function exportiereProjekt(a: { ordner: string; zip: string; kitsOrdner?: string; frei?: (o: string) => number }): Promise<ZipBericht> {
  const ordner = fs.realpathSync(a.ordner);
  let projekt: Projekt;
  try { projekt = JSON.parse(fs.readFileSync(path.join(ordner, 'project.json'), 'utf8')) as Projekt; }
  catch { throw new KitFehler(409, 'projekt_ungueltig', 'project.json is not readable JSON'); }
  const kitOpt = a.kitsOrdner !== undefined ? { kitsOrdner: a.kitsOrdner } : undefined;
  const dazu: [string, string][] = [], fehlt: string[] = [];
  let kitBytes = 0;
  for (const name of kitNamenImProjekt(projekt)) {
    const eigen = path.join(ordner, 'kits', name), global = path.join(kitsOrdnerVon(kitOpt), name);
    const quelle = !KIT_NAME.test(name) ? null : fs.existsSync(path.join(eigen, 'kit.json')) ? eigen : fs.existsSync(path.join(global,
      'kit.json')) ? global : null;
    if (quelle === null) { fehlt.push(name); continue; }
    const p = await pruefeKitOrdner(quelle);
    if (!p.ok) throw new KitFehler(409, 'kit_ungueltig', `kit ${name}: ${p.text}`);
    if (quelle === global) { dazu.push([`kits/${name}`, global]); kitBytes += p.bytes; }
  }
  if (fehlt.length > 0) throw new KitFehler(409, 'kit_fehlt',
    `the project uses ${fehlt.length === 1 ? 'a kit' : 'kits'} that cannot be found: ${fehlt.join(', ')}`, fehlt.join(','));
  braucheFreienPlatz(path.dirname(a.zip), ordnerBytes(ordner) + kitBytes, a.frei);
  const ersatz = path.join(path.dirname(a.zip), `.projekt-${crypto.randomBytes(5).toString('hex')}.json`);
  try {
    const ersetze: Record<string, string> = {};
    if (schreibeHinweiseNeu(projekt, kopienVon(projekt, ordner))) {
      fs.writeFileSync(ersatz, JSON.stringify(projekt, null, 1) + '\n');
      ersetze['project.json'] = ersatz;
    }
    return await packe(a.ordner, a.zip, { ohne: EXPORT_OHNE, dazu, ersetze });
  } catch (e) {
    if (e instanceof ZipFehler) {
      if (e.grund === 'platte_voll') throw new KitFehler(507, 'platte_voll');
      throw new KitFehler(e.grund === 'zu_gross_entpackt' || e.grund === 'zu_viele_eintraege' ? 413 : 500, 'zip_abgelehnt', zipText(e.grund, 'export'),
        e.grund);
    }
    throw e;
  } finally { fs.rmSync(ersatz, { force: true }); }
}

/** English text for a failure of the project check (its messages are German in model.ts); the original stays in `detail`. */
function projektFehlerText(f: string): { text: string; detail?: string } {
  const e = f.replace(/unbekanntes Feld/g, 'unknown field');
  return /[äöüÄÖÜß]|\b(erwartet|muss|fehlt|ungültig|ungueltig|zu viele|nicht)\b/.test(e) ? { text: 'project.json did not pass the project checks',
    detail: f } : { text: e, ...(e !== f ? { detail: f } : {}) };
}

/** Removes the leftovers of a crashed export or import (`.import-*`, `.einspielen-*`, `.export-*`) older than `maxAlterMs` under the projects root. */
export function raeumeProjektReste(wurzel: string, maxAlterMs = 10 * 60_000): number {
  let n = 0;
  let namen: string[];
  try { namen = fs.readdirSync(wurzel); } catch { return 0; }
  for (const name of namen) {
    if (!/^\.(import|einspielen|export)-/.test(name)) continue;
    const p = path.join(wurzel, name);
    try {
      const st = fs.lstatSync(p);
      if (Date.now() - st.mtimeMs < maxAlterMs) continue;
      fs.rmSync(p, { recursive: true, force: true }); n++;
    } catch { /* best effort */ }
  }
  return n;
}

const zufall = (): string => crypto.randomBytes(5).toString('hex');

export type ImportBericht = { slug: string; kits_umbenannt: { alt: string; neu: string }[] };

/** Imports a project zip as a new project (never opens it). Every refusal before the kits are installed writes nothing. */
export async function importiereProjektZip(zip: string, o: { projekte: Projekte; kitsOrdner?: string; frei?: (o: string) => number }): Promise<ImportBericht> {
  const wurzel = o.projekte.wurzelPfad;
  const kitOpt = o.kitsOrdner !== undefined ? { kitsOrdner: o.kitsOrdner } : undefined;
  const ent = path.join(wurzel, `.import-${zufall()}`);
  try {
    // (1) the room for the unpacked project
    const g = await zipGroesse(zip).catch((e: unknown) => { throw e instanceof ZipFehler ? new KitFehler(400, 'zip_abgelehnt',
      `the zip was refused: ${e.grund}`) : e; });
    braucheFreienPlatz(wurzel, g.bytes, o.frei);
    // (2) unpack into a dot folder
    try { await entpacke(zip, ent); } catch (e) {
      if (e instanceof ZipFehler) throw new KitFehler(400, 'zip_abgelehnt', `the zip was refused: ${e.grund}`);
      throw e;
    }
    // (3) project.json must exist and pass the checks of opening
    const pj = path.join(ent, 'project.json');
    if (!fs.existsSync(pj)) throw new KitFehler(400, 'projekt_json_fehlt');
    let roh: unknown;
    try { roh = JSON.parse(fs.readFileSync(pj, 'utf8')); } catch { throw new KitFehler(409, 'projekt_ungueltig', 'project.json is not readable JSON'); }
    seqV1Wandeln(roh);
    const pr = pruefeProjekt(roh);
    if ('fehler' in pr) { const f = projektFehlerText(pr.fehler); throw new KitFehler(409, 'projekt_ungueltig', f.text, f.detail); }
    await pruefeAudioSha(pr.projekt, ent);
    const kopien = kopienVon(pr.projekt, ent);
    // (4) the project's own kits: every valid-named folder must be a good kit; folders with other names (.alt-*, Bad Name) are never installed
    const kitsDir = path.join(ent, 'kits');
    const kits: string[] = [];
    let summe = 0;
    const benannt = new Set(kitNamenImProjekt(pr.projekt));   // kits the project does not name are never installed
    if (fs.existsSync(kitsDir)) {
      if (!fs.lstatSync(kitsDir).isDirectory()) throw new KitFehler(400, 'kit_ungueltig', 'kits in the zip must be a folder, not a file');
      for (const e of fs.readdirSync(kitsDir, { withFileTypes: true })) {
        if (!e.isDirectory() || !KIT_NAME.test(e.name) || !benannt.has(e.name)) continue;
        const p = await pruefeKitOrdner(path.join(kitsDir, e.name));
        if (!p.ok) throw new KitFehler(400, 'kit_ungueltig', `kit ${e.name}: ${p.text}`);
        summe += p.bytes; kits.push(e.name);
      }
    }
    if (kits.length > 0) braucheFreienPlatz(kitsOrdnerVon(kitOpt), summe, o.frei);
    // (5) install the kits; all renames are known before any reference or folder moves
    const umbenannt: { alt: string; neu: string }[] = [];
    try {
      for (const name of kits) {
        const r = await installiereKitOrdner(path.join(kitsDir, name), name, kitOpt);
        if (r.umbenannt) umbenannt.push(r.umbenannt);
      }
      const karte = new Map(umbenannt.map((u) => [u.alt, u.neu] as const));
      // the project's own kit folders follow in two phases (a chain x to x-h and x-h to x-h-h2 must not collide)
      const zwischen = umbenannt.map((u) => ({ ...u, tmp: path.join(kitsDir, `.umbenennen-${zufall()}`) }));
      for (const u of zwischen) fs.renameSync(path.join(kitsDir, u.alt), u.tmp);
      for (const u of zwischen) {
        if (fs.existsSync(path.join(kitsDir, u.neu))) fs.rmSync(u.tmp, { recursive: true, force: true });   // the same kit is already there
        else fs.renameSync(u.tmp, path.join(kitsDir, u.neu));
      }
      // (6) take the project in under a new slug, references rewritten in one pass, audio hints point at the local copies, frozen files (cache) do not travel
      const r = o.projekte.nimmAuf(ent, (p) => {
        schreibeKitBezuegeKarte(p, karte);
        schreibeHinweiseNeu(p, kopien);
        for (const s of p.spuren) if (s.freeze !== undefined && s.freeze !== null && typeof s.freeze === 'object') s.freeze = null;
        return p;
      });
      return { slug: r.slug, kits_umbenannt: umbenannt };
    } catch (e) {
      if (e instanceof AblageFehler) throw new KitFehler(e.code, e.fehler, e.message);
      if (e instanceof KitFehler) throw e;
      const t = e as Error;
      throw new KitFehler(500, 'kit_fehler', `the import failed (${t.message}); kits that were already installed stay, they are harmless`);
    }
  } finally { fs.rmSync(ent, { recursive: true, force: true }); }
}
