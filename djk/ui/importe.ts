// Import of files into the studio (browser plan 1). ImportDienst takes one file as a stream and puts it into the storage kind `importe`
// (<importe>/<yyyy-mm-dd>/) or into the open project's audio folder. Reading, caps and the temp file are http/roh.ts.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { REPO } from './paths.ts';
import { versteckt } from './sampler/file.ts';
import { grundText } from './http/reasons.ts';
import { ROH_MAX_BYTES, RohFehler, rohBenennen, rohInTeilDatei } from './http/roh.ts';

export type ImportArt = 'audio' | 'midi' | 'zip' | 'preset' | 'kit';
export interface ImportErgebnis { ok: true; pfad: string; art: ImportArt; sha256?: string; eintraege?: number; uebersprungen?: { name: string; grund: string }[]; weiter?: { route: string } }

/** English sentence of a reason on the import routes (name_ungueltig is a project-name reason elsewhere, so it is worded here). */
export const importText = (grund: string): string => (grund === 'name_ungueltig' ? 'the file name is empty after cleaning it' : grundText(grund));
/** A refusal with the HTTP code and reason; `text` is English and never carries foreign text (file names go into `detail`). */
export class ImportFehler extends Error {
  code: number; grund: string; text: string; detail?: string;
  constructor(code: number, grund: string, detail?: string) { super(grund); this.code = code; this.grund = grund; this.text = importText(grund); this.detail = detail; }
}

const execFileP = promisify(execFile);
const ZIP_FRIST_MS = 120_000;
const AUDIO = new Set(['wav', 'aif', 'aiff', 'flac', 'ogg', 'mp3', 'm4a', 'opus']);
const NAME_MAX = 120;   // bytes (UTF-8)
/** The class of a file name by its extension, null when not accepted. 'kit' is only ever decided from a zip's content. */
export const importArtVon = (name: string): { art: ImportArt; ext: string } | null => {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (AUDIO.has(ext)) return { art: 'audio', ext };
  if (ext === 'mid' || ext === 'midi') return { art: 'midi', ext };
  if (ext === 'zip') return { art: 'zip', ext };
  if (ext === 'json') return { art: 'preset', ext };
  return null;
};

/** Readable name: basename of either separator style, control characters out, leading dots stripped, at most 120 UTF-8 bytes (extension kept). */
export function saubererName(roh: string): string {
  let n = roh.split(/[\\/]/).pop() ?? '';
  n = n.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/^\.+/, '').trim();
  if (Buffer.byteLength(n) > NAME_MAX) {   // cut by UTF-8 bytes, never inside a code point (a surrogate pair is one code point)
    const e = path.extname(n); let rest = NAME_MAX - Buffer.byteLength(e), stamm = '';
    for (const c of n.slice(0, n.length - e.length)) { rest -= Buffer.byteLength(c); if (rest < 0) break; stamm += c; }
    n = stamm + e;
  }
  return n;
}

const heuteVorgabe = (): string => { const d = new Date(), z = (x: number) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };

export interface ImportOptionen {
  importeOrdner: () => string;
  projektAudioOrdner: () => string | null;
  heute?: () => string;
  freierPlatz?: (ordner: string) => number;
  nachImport?: (r: ImportErgebnis) => void;
  maxBytes?: number;
  python?: string;   // for djk/tools/zipwerk.py; the server passes pythonVorgabe()
  erlaubt?: () => Wurzel[];   // the folders a path import may read from; default erlaubteWurzeln()
}

// ---- folder picker and path import (task 3) ----
export interface Wurzel { name: string; pfad: string }
const echt = (p: string): string | null => { try { return fs.realpathSync(p); } catch { return null; } };
export const istOrdner = (p: string): boolean => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
/** `p` is `wurzel` or lies below it (a separator is required: /home/user2 is not inside /home/user). */
const drin = (wurzel: string, p: string): boolean => p === wurzel || p.startsWith(wurzel.endsWith('/') ? wurzel : `${wurzel}/`);
const SORT = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const sortiere = (l: string[]): string[] => [...l].sort((a, b) => SORT.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
export const ORDNER_MAX = 2000;

/**
 * The folders the picker and the path import may read: the home folder ("Home") and every directory below the mount parents
 * (default /media/<user> and /mnt, named by their base name). All paths are realpath-resolved. `wurzeln` replaces the mount parents (tests).
 */
export function erlaubteWurzeln(o: { heim?: string; benutzer?: string; wurzeln?: string[] } = {}): Wurzel[] {
  let benutzer = o.benutzer;
  if (benutzer === undefined) { try { benutzer = os.userInfo().username; } catch { benutzer = ''; } }
  const eltern = o.wurzeln ?? [...(benutzer ? [`/media/${benutzer}`] : []), '/mnt'];
  const aus: Wurzel[] = [];
  const dazu = (name: string, p: string): void => { const r = echt(p); if (r && istOrdner(r) && !aus.some((w) => w.pfad === r)) aus.push({ name, pfad: r }); };
  dazu('Home', o.heim ?? os.homedir());
  for (const e of eltern) {
    let eintraege: fs.Dirent[];
    try { eintraege = fs.readdirSync(e, { withFileTypes: true }); } catch { continue; }
    for (const x of eintraege.sort((a, b) => SORT.compare(a.name, b.name))) if (!versteckt(x.name)) dazu(x.name, path.join(e, x.name));
  }
  return aus;
}

/** The realpath of a requested absolute path, or an ImportFehler: 400 argument_ungueltig, 404 pfad_fehlt, 403 pfad_ausserhalb or pfad_nicht_lesbar. */
export function loeseAuf(pfad: unknown, wurzeln: Wurzel[]): string {
  if (typeof pfad !== 'string' || pfad === '' || pfad.includes('\0') || !path.isAbsolute(pfad)) throw new ImportFehler(400, 'argument_ungueltig', 'pfad');
  const lex = path.resolve(pfad);   // ".." is gone before any check
  let real: string;
  try { real = fs.realpathSync(lex); } catch (e) {
    const c = (e as NodeJS.ErrnoException).code;
    if (c === 'ENOENT' || c === 'ENOTDIR') throw wurzeln.some((w) => drin(w.pfad, lex)) ? new ImportFehler(404, 'pfad_fehlt') : new ImportFehler(403, 'pfad_ausserhalb');
    throw new ImportFehler(403, 'pfad_nicht_lesbar');
  }
  const wurzel = wurzeln.find((w) => drin(w.pfad, real));
  if (!wurzel) throw new ImportFehler(403, 'pfad_ausserhalb');
  // hidden folders and files (.ssh, .config, .cache, ...) are never reachable by path, whoever asks (the folder listing hides them as well)
  if (path.relative(wurzel.pfad, real).split(path.sep).some((s) => s.startsWith('.') && s !== '.' && s !== '..')) throw new ImportFehler(403, 'pfad_ausserhalb');
  return real;
}

/** GET /dateisystem/ordner: the directories of a folder (no files), natural order, at most 2000 (`mehr`). Empty pfad lists the roots only. */
export function listeDateisystem(pfad: string, wurzeln: Wurzel[]): { pfad: string; eltern: string | null; ordner: Wurzel[]; wurzeln: Wurzel[]; mehr?: true } {
  if (pfad === '') return { pfad: '', eltern: null, ordner: [], wurzeln };
  const real = loeseAuf(pfad, wurzeln);
  if (!istOrdner(real)) throw new ImportFehler(400, 'kein_ordner');
  let eintraege: fs.Dirent[];
  try { eintraege = fs.readdirSync(real, { withFileTypes: true }); } catch { throw new ImportFehler(403, 'pfad_nicht_lesbar'); }
  const namen: string[] = [];
  for (const e of eintraege) {
    if (versteckt(e.name)) continue;
    if (e.isDirectory()) namen.push(e.name);
    else if (e.isSymbolicLink()) { const r = echt(path.join(real, e.name)); if (r !== null && istOrdner(r) && wurzeln.some((w) => drin(w.pfad, r))) namen.push(e.name); }
  }
  const sortiert = sortiere(namen);
  return { pfad: real, eltern: wurzeln.some((w) => w.pfad === real) ? null : path.dirname(real),
    ordner: sortiert.slice(0, ORDNER_MAX).map((name) => ({ name, pfad: path.join(real, name) })), wurzeln,
    ...(sortiert.length > ORDNER_MAX ? { mehr: true as const } : {}) };
}

export class ImportDienst {
  private readonly o: ImportOptionen;
  constructor(o: ImportOptionen) { this.o = o; }

  async nimmAn(strom: AsyncIterable<Buffer | string>, name: string, ziel: 'auto' | 'bibliothek' | 'projekt', laenge: number | null): Promise<ImportErgebnis> {
    const sauber = saubererName(name);
    if (sauber === '') throw new ImportFehler(400, 'name_ungueltig');
    const klasse = importArtVon(sauber);
    if (!klasse) throw new ImportFehler(415, 'typ_unbekannt', path.extname(sauber).slice(1).toLowerCase());
    let ordner: string;
    if (ziel === 'projekt') {
      if (klasse.art === 'zip' || klasse.art === 'preset') throw new ImportFehler(400, 'ziel_unpassend');
      const p = this.o.projektAudioOrdner();
      if (p === null) throw new ImportFehler(409, 'kein_projekt');
      ordner = p;
    } else ordner = path.join(this.o.importeOrdner(), (this.o.heute ?? heuteVorgabe)());
    let r;
    try {
      r = await rohInTeilDatei(strom, { ordner, laenge, maxBytes: this.o.maxBytes ?? ROH_MAX_BYTES, freierPlatz: this.o.freierPlatz, sha256: klasse.art === 'audio' });
    } catch (e) { throw e instanceof RohFehler ? new ImportFehler(e.code, e.grund, e.detail) : e; }
    const pfad = rohBenennen(r.teil, ordner, sauber);
    const erg: ImportErgebnis = klasse.art === 'zip' ? await this.zip(pfad, ordner)
      : { ok: true, pfad, art: klasse.art, ...(r.sha256 ? { sha256: r.sha256 } : {}), ...(klasse.art === 'preset' ? { weiter: { route: '/presets/import' } } : {}) };
    try { this.o.nachImport?.(erg); } catch { /* a failing hook never fails the import */ }
    return erg;
  }

  /** Copies one file from a readable folder (copy, never move): the same checks and the same code path as an upload. */
  async kopiere(pfad: unknown, ziel: 'auto' | 'bibliothek' | 'projekt'): Promise<ImportErgebnis> {
    const real = loeseAuf(pfad, (this.o.erlaubt ?? erlaubteWurzeln)());
    let st: fs.Stats;
    try { st = fs.statSync(real); } catch { throw new ImportFehler(403, 'pfad_nicht_lesbar'); }
    if (st.isDirectory()) throw new ImportFehler(400, 'ist_ordner', 'add a folder as a catalogue source instead');
    if (!st.isFile()) throw new ImportFehler(400, 'argument_ungueltig', 'pfad');
    const strom = fs.createReadStream(real);
    try { return await this.nimmAn(strom, path.basename(String(pfad)), ziel, st.size); } finally { strom.destroy(); }
  }

  // The helper djk/tools/zipwerk.py: one JSON object on stdout; exit 2 = refused ({abgelehnt: grund}).
  private async helfer(args: string[]): Promise<Record<string, unknown>> {
    const py = this.o.python ?? 'python3';
    try {
      const { stdout } = await execFileP(py, [path.join(REPO, 'djk', 'tools', 'zipwerk.py'), ...args], { timeout: ZIP_FRIST_MS, maxBuffer: 64 * 2 ** 20 });
      return JSON.parse(stdout) as Record<string, unknown>;
    } catch (e) {
      const f = e as { code?: unknown; stdout?: string };
      if (f.code === 2) {
        let grund = 'unbekannt';
        try { grund = String((JSON.parse(f.stdout ?? '{}') as { abgelehnt?: unknown }).abgelehnt ?? grund); } catch { /* keep the generic reason */ }
        if (grund === 'platte_voll') throw new ImportFehler(507, 'platte_voll');
        throw new ImportFehler(400, 'zip_abgelehnt', grund);
      }
      throw e;
    }
  }

  // A stored zip: a kit or project zip stays a zip; any other is unpacked (media only) into a folder named after it; a refused zip is removed.
  private async zip(zipPfad: string, ordner: string): Promise<ImportErgebnis> {
    try {
      const p = await this.helfer(['pruefe', zipPfad]);
      if (p.hat_kit_json === true) return { ok: true, pfad: zipPfad, art: 'kit', weiter: { route: '/kits/import' } };
      if (p.hat_projekt_json === true) return { ok: true, pfad: zipPfad, art: 'zip', weiter: { route: '/proj/import_zip' } };
      const stamm = path.basename(zipPfad, path.extname(zipPfad));
      let ziel = path.join(ordner, stamm);
      for (let n = 2; fs.existsSync(ziel); n++) ziel = path.join(ordner, `${stamm}-${n}`);
      const r = await this.helfer(['entpacke', zipPfad, ziel, '--nur-medien']);
      return { ok: true, pfad: String(r.ordner), art: 'zip', eintraege: Number(r.eintraege), uebersprungen: r.uebersprungen as { name: string; grund: string }[] };
    } catch (e) {
      if (e instanceof ImportFehler) fs.rmSync(zipPfad, { force: true });
      throw e;
    }
  }
}
