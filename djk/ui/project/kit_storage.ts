// The kit store (browser plan 5): a kit is one folder <kit folder>/<name>/ with kit.json and raw stereo float32 files, exactly what the core reads
// (djk/core/src/kit.cpp lade_kit). This file validates a kit as strictly as the core does, hashes it, lists it, installs it from a folder or a zip
// with the name clash rule, and exports it as a zip. Rename, copy and delete follow in the same file (task 3).
// The page server serves the live studio: everything that reads or copies kit files runs on fs.promises and streams, never on the sync calls.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { KIT_NAME } from './model.ts';
import { kitsOrdnerVorgabe } from '../paths.ts';
import { entpacke, packe, ZipFehler } from './zipwerk.ts';
import { grundText } from '../http/reasons.ts';
import { leseKit } from '../areas/proj/kits.ts';
import { zaehleKitBezuege } from './kit_bezug.ts';
import { wavKopf } from './recording.ts';
import { freierKitName } from '../sampler/kit.ts';
import { kitSchreibGrund } from '../sampler/bk_schutz.ts';

/** A refusal with HTTP code and reason code; `text` is one English sentence (never foreign text, that goes into `detail`). */
export class KitFehler extends Error {
  readonly code: number; readonly grund: string; readonly text: string; readonly detail?: string;
  constructor(code: number, grund: string, text?: string, detail?: string) {
    super(grund); this.code = code; this.grund = grund; this.text = text ?? grundText(grund); this.detail = detail;
  }
}
export type KitOpt = { kitsOrdner?: string };
export type KitZeile = { name: string; pads: number; quelle: 'global' | 'projekt' };
export type Einspielung = { name: string; neu: boolean; umbenannt: { alt: string; neu: string } | null };

export const KIT_MAX_BYTES = 256 * 2 ** 20;
const KIT_MAX_FRAMES = 480_000;
const RESERVE = 256 * 2 ** 20;
export const kitsOrdnerVon = (o?: KitOpt): string => o?.kitsOrdner ?? kitsOrdnerVorgabe();

// the core's datei_name_ok: ends in .f32, 5 to 64 characters, no / and no ..
const dateiNameOk = (d: string): boolean => d.length >= 5 && d.length <= 64 && !d.includes('/') && !d.includes('..') && d.endsWith('.f32');

type Pruefung = { ok: true; pads: number; bytes: number; dateien: string[] } | { ok: false; grund: string; text: string };
const kaputt = (text: string): Pruefung => ({ ok: false, grund: 'kit_ungueltig', text });

async function pruefeIntern(ordner: string): Promise<Pruefung> {
  let j: unknown;
  try { j = JSON.parse(await fs.promises.readFile(path.join(ordner, 'kit.json'), 'utf8')); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, grund: 'kit_json_fehlt', text: grundText('kit_json_fehlt') };
    return kaputt('kit.json is not readable JSON');
  }
  const k = j as { schema?: unknown; klaenge?: unknown };
  if (typeof j !== 'object' || j === null || k.schema !== 1) return kaputt('kit.json must be an object with schema 1');
  if (!Array.isArray(k.klaenge) || k.klaenge.length === 0) return kaputt('kit.json needs a non-empty list "klaenge"');
  const noten = new Set<number>(), dateien: string[] = [];
  let bytes = 0;
  for (const e of k.klaenge as unknown[]) {
    const kl = e as { note?: unknown; datei?: unknown; frames?: unknown };
    if (typeof e !== 'object' || e === null || !Number.isInteger(kl.note)) return kaputt('every sound needs an integer note');
    const note = kl.note as number;
    if (note < 0 || note > 127) return kaputt(`note ${note} is outside 0..127`);
    if (noten.has(note)) return kaputt(`note ${note} is used twice`);
    noten.add(note);
    if (typeof kl.datei !== 'string' || !dateiNameOk(kl.datei)) {
      const n = String(kl.datei);
      if (typeof kl.datei === 'string' && /\.(wav|aif|aiff|flac|ogg|mp3|m4a|opus)$/i.test(n)) {
        return kaputt(`sound files must be raw stereo float32 .f32 as the kit starter writes them (found ${n.slice(0, 64)})`);
      }
      return kaputt(`the sound file name ${n.slice(0, 64)} is not allowed (a plain name of 5 to 64 characters ending in .f32)`);
    }
    if (!Number.isInteger(kl.frames) || (kl.frames as number) < 1 ||
      (kl.frames as number) > KIT_MAX_FRAMES) return kaputt(`${kl.datei}: frames must be 1 to ${KIT_MAX_FRAMES}`);
    const frames = kl.frames as number;
    bytes += frames * 8;
    if (bytes > KIT_MAX_BYTES) return kaputt('the sounds are larger than 256 MiB');
    let roh: Buffer;
    try { roh = await fs.promises.readFile(path.join(ordner, kl.datei)); } catch { return kaputt(`${kl.datei} is missing`); }
    if (roh.length !== frames * 8) return kaputt(`${kl.datei}: the size does not match frames * 8`);
    const f = new Float32Array(roh.buffer, roh.byteOffset, roh.length >> 2);
    if (roh.byteOffset % 4 === 0) { for (let i = 0; i < f.length; i++) if (!Number.isFinite(f[i])) return kaputt(`${kl.datei} holds NaN or infinity`); }
    else { for (let i = 0; i < roh.length; i += 4) if (!Number.isFinite(roh.readFloatLE(i))) return kaputt(`${kl.datei} holds NaN or infinity`); }
    dateien.push(kl.datei);
  }
  return { ok: true, pads: k.klaenge.length, bytes, dateien };
}

/** Strict twin of the core's lade_kit rules: schema 1, notes 0..127 unique, plain .f32 names, frames, exact sizes, finite samples, at most 256 MiB. */
export async function pruefeKitOrdner(ordner: string): Promise<{ ok: true; pads: number; bytes: number } | { ok: false; grund: string; text: string }> {
  const r = await pruefeIntern(ordner);
  return r.ok ? { ok: true, pads: r.pads, bytes: r.bytes } : r;
}

/** Throws 507 platte_voll when the filesystem of `ordner` has less than `bytes` plus 256 MiB free. */
export function braucheFreienPlatz(ordner: string, bytes: number, frei?: (ordner: string) => number): void {
  let probe = ordner;
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const f = (frei ?? ((o: string) => { const s = fs.statfsSync(o); return Number(s.bavail) * Number(s.bsize); }))(probe);
  if (f < bytes + RESERVE) {
    const mib = (n: number): number => Math.ceil(n / 2 ** 20);
    throw new KitFehler(507, 'platte_voll',
      `there is not enough free space on the disk: ${mib(bytes + RESERVE)} MiB needed, ${Math.floor(f / 2 ** 20)} MiB free`);
  }
}

/** sha256 over the sorted names and the bytes of the regular files directly in the folder (dot files are not part of a kit); read as streams. */
export async function kitInhaltHash(ordner: string): Promise<string> {
  const h = crypto.createHash('sha256');
  for (const n of (await fs.promises.readdir(ordner)).filter((x) => !x.startsWith('.')).sort()) {
    const p = path.join(ordner, n);
    const st = await fs.promises.stat(p);
    if (!st.isFile()) continue;
    h.update(`${n}\0${st.size}\0`);
    for await (const stueck of fs.createReadStream(p)) h.update(stueck as Buffer);
  }
  return h.digest('hex');
}

function listeEin(wurzel: string, quelle: KitZeile['quelle']): KitZeile[] {
  let namen: string[];
  try { namen = fs.readdirSync(wurzel); } catch { return []; }
  const aus: KitZeile[] = [];
  for (const name of namen) {
    if (!KIT_NAME.test(name)) continue;
    const n = leseKit(path.join(wurzel, name));
    if (n !== null) aus.push({ name, pads: n, quelle });
  }
  return aus;
}

/** The global kits plus those under `<projektOrdner>/kits/`, sorted by name; a name in both places appears twice. */
export function listeKitsAlle(projektOrdner: string | null, o?: KitOpt): KitZeile[] {
  const alle = [...listeEin(kitsOrdnerVon(o), 'global'), ...(projektOrdner ? listeEin(path.join(projektOrdner, 'kits'), 'projekt') : [])];
  return alle.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.quelle === b.quelle ? 0 : a.quelle === 'global' ? -1 : 1));
}

const zufall = (): string => crypto.randomBytes(5).toString('hex');
const aufraeumen = (p: string): void => { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ } };

/** Validates the kit folder `quelle` and installs it as `wunschName` in the kit folder; same name with the same content is reused, with other content
 *  the kit goes in as `<name cut to 23>-<sha8>`. Only kit.json and the files it names are copied. Nothing is left behind on an error. */
export async function installiereKitOrdner(quelle: string, wunschName: string, o?: KitOpt): Promise<Einspielung> {
  if (!KIT_NAME.test(wunschName)) throw new KitFehler(400, 'kit_name_ungueltig');
  { const g = kitSchreibGrund(kitsOrdnerVon(o)); if (g !== null) throw new KitFehler(409, 'kit_ordner_fehlt', g); }
  const p = await pruefeIntern(quelle);
  if (!p.ok) throw new KitFehler(400, p.grund, p.text);
  const wurzel = kitsOrdnerVon(o);
  braucheFreienPlatz(wurzel, p.bytes);
  { const g = kitSchreibGrund(wurzel); if (g !== null) throw new KitFehler(409, 'kit_ordner_fehlt', g); }
  fs.mkdirSync(wurzel, { recursive: true });
  const stage = path.join(wurzel, `.einspielen-${zufall()}`);
  try {
    fs.mkdirSync(stage);
    for (const n of ['kit.json', ...p.dateien]) await fs.promises.copyFile(path.join(quelle, n), path.join(stage, n));
    const hash = await kitInhaltHash(stage);
    let name = wunschName, umbenannt: Einspielung['umbenannt'] = null;
    for (let versuch = 0; ; versuch++) {
      const ziel = path.join(wurzel, name);
      if (!fs.existsSync(ziel)) {
        try { fs.renameSync(stage, ziel); } catch (e) {
          const c = (e as NodeJS.ErrnoException).code;
          if (c === 'ENOTEMPTY' || c === 'EEXIST') throw new KitFehler(409, 'kit_name_belegt');
          throw e;
        }
        return { name, neu: true, umbenannt };
      }
      let vorhanden: string | null = null;
      try { if ((await fs.promises.stat(ziel)).isDirectory()) vorhanden = await kitInhaltHash(ziel); } catch { /* unreadable counts as other content */ }
      if (vorhanden === hash) { aufraeumen(stage); return { name, neu: false, umbenannt }; }
      if (versuch > 0) throw new KitFehler(409, 'kit_name_belegt');
      name = `${wunschName.slice(0, 23)}-${hash.slice(0, 8)}`;
      umbenannt = { alt: wunschName, neu: name };
    }
  } catch (e) { aufraeumen(stage); throw e; }
}

/** The kit root of an unpacked zip: kit.json at the top, or inside the only top-level folder; null without kit.json. */
export function kitWurzelImOrdner(ordner: string): string | null {
  if (fs.existsSync(path.join(ordner, 'kit.json'))) return ordner;
  const eintraege = fs.readdirSync(ordner);
  if (eintraege.length === 1 && fs.statSync(path.join(ordner, eintraege[0])).isDirectory() && fs.existsSync(path.join(ordner, eintraege[0],
    'kit.json'))) return path.join(ordner, eintraege[0]);
  return null;
}

/** A name that passes KIT_NAME: lowercase, other characters to '-', cut to 32; null when nothing is left. */
export function kitNameAus(text: string): string | null {
  const s = text.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '');
  return s === '' ? null : s;
}

/** Unpacks a kit zip and installs it. The wanted name defaults to the name inside kit.json, then to the zip's file name (both sanitized). */
export async function installiereKitZip(zip: string, wunschName: string | null, o?: KitOpt): Promise<Einspielung> {
  const wurzel = kitsOrdnerVon(o);
  { const g = kitSchreibGrund(wurzel); if (g !== null) throw new KitFehler(409, 'kit_ordner_fehlt', g); }
  fs.mkdirSync(wurzel, { recursive: true });
  const stage = path.join(wurzel, `.einspielen-zip-${zufall()}`);
  try {
    fs.mkdirSync(stage);
    try { await entpacke(zip, path.join(stage, 'aus'), { maxBytes: KIT_MAX_BYTES + 2 ** 20, maxEintraege: 1000 }); }
    catch (e) {
      if (e instanceof ZipFehler) {
        throw e.grund === 'platte_voll' ? new KitFehler(507, 'platte_voll') : new KitFehler(400, 'zip_abgelehnt', grundText('zip_abgelehnt'), e.grund);
      }
      throw e;
    }
    const kitWurzel = kitWurzelImOrdner(path.join(stage, 'aus'));
    if (!kitWurzel) throw new KitFehler(400, 'kit_json_fehlt');
    let name = wunschName;
    if (name === null) {
      let intern: string | null = null;
      try { const n = (JSON.parse(fs.readFileSync(path.join(kitWurzel, 'kit.json'),
        'utf8')) as { name?: unknown }).name; if (typeof n === 'string') intern = kitNameAus(n); } catch { /* the check below reports it */ }
      name = intern ?? kitNameAus(path.basename(zip).replace(/\.(kit\.)?zip$/i, '')) ?? 'kit';
    }
    return await installiereKitOrdner(kitWurzel, name, o);
  } finally { aufraeumen(stage); }
}

/** The folder of a kit: global under the kit folder, or under `<projektOrdner>/kits/`. */
export function kitOrdnerVon(name: string, quelle: 'global' | 'projekt', projektOrdner: string | null, o?: KitOpt): string {
  if (!KIT_NAME.test(name)) throw new KitFehler(400, 'kit_name_ungueltig');
  if (quelle === 'projekt') {
    if (!projektOrdner) throw new KitFehler(409, 'kein_projekt');
    return path.join(projektOrdner, 'kits', name);
  }
  return path.join(kitsOrdnerVon(o), name);
}

/** Zips a kit (kit.json and the sounds it names at the zip root) to the new file `ziel`. The kit is validated first and may not exceed 256 MiB;
 *  stray files in the folder stay out. */
export async function exportiereKit(name: string, quelle: 'global' | 'projekt', projektOrdner: string | null, ziel: string, o?: KitOpt): Promise<void> {
  const ordner = kitOrdnerVon(name, quelle, projektOrdner, o);
  if (leseKit(ordner) === null) throw new KitFehler(404, 'kit_unbekannt');
  const p = await pruefeIntern(ordner);
  if (!p.ok) throw new KitFehler(409, p.grund, p.text);
  try { await packe(ordner, ziel, { nur: ['kit.json', ...p.dateien], maxBytes: KIT_MAX_BYTES + 2 ** 20, maxEintraege: 1000 }); }
  catch (e) {
    if (e instanceof ZipFehler) throw e.grund === 'platte_voll' ? new KitFehler(507, 'platte_voll') : new KitFehler(500, 'kit_fehler', undefined, e.grund);
    throw e;
  }
}

// ---- browser plan 5, task 3: rename, copy, delete, preview ----

export type VerwaltungsOpt = KitOpt & { projekteWurzel?: string; quelle?: 'global' | 'projekt'; projektOrdner?: string | null };

/** Slugs of all projects (under `projekteWurzel`) whose project.json names the kit; an unreadable project.json is skipped. */
export function kitBenutzer(name: string, projekteWurzel: string): string[] {
  let eintraege: fs.Dirent[];
  try { eintraege = fs.readdirSync(projekteWurzel, { withFileTypes: true }); } catch { return []; }
  const slugs: string[] = [];
  for (const e of eintraege) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    try {
      const p = JSON.parse(fs.readFileSync(path.join(projekteWurzel, e.name, 'project.json'), 'utf8')) as unknown;
      if (zaehleKitBezuege(p, name) > 0) slugs.push(e.name);
    } catch { /* unreadable: not counted */ }
  }
  return slugs.sort();
}

const vorhanden = (p: string): boolean => { try { fs.lstatSync(p); return true; } catch { return false; } };

function schreibeName(ordner: string, name: string): void {
  const datei = path.join(ordner, 'kit.json');
  const j = JSON.parse(fs.readFileSync(datei, 'utf8')) as Record<string, unknown>;
  j.name = name;
  const tmp = `${datei}.${zufall()}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(j, null, 1)); fs.renameSync(tmp, datei); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
}

/** Finds the kit: `quelle` names the folder to look in first (default global); without an explicit `quelle` the other one is
 * tried when the first has no such kit.
 *  `wurzel` is the folder that holds it (the kit folder or `<project>/kits`). */
function holeKit(name: string, o?: VerwaltungsOpt): { ordner: string; wurzel: string } {
  if (!KIT_NAME.test(name)) throw new KitFehler(400, 'kit_name_ungueltig');
  const wurzeln = { global: kitsOrdnerVon(o), projekt: o?.projektOrdner ? path.join(o.projektOrdner, 'kits') : null };
  const erst = o?.quelle ?? 'global', zweit = erst === 'global' ? 'projekt' : 'global';
  for (const q of o?.quelle ? [erst] : [erst, zweit]) {
    const w = wurzeln[q];
    if (w !== null && leseKit(path.join(w, name)) !== null) return { ordner: path.join(w, name), wurzel: w };
  }
  if (o?.quelle === 'projekt' && !o.projektOrdner) throw new KitFehler(409, 'kein_projekt');
  throw new KitFehler(404, 'kit_unbekannt');
}

function brauchtKeinenBenutzer(name: string, o: VerwaltungsOpt | undefined, trotzdem: boolean): void {
  if (trotzdem || !o?.projekteWurzel) return;
  const b = kitBenutzer(name, o.projekteWurzel);
  if (b.length > 0) throw new KitFehler(409, 'kit_in_benutzung', undefined, b.join(','));
}

/** Renames a kit folder (kit.json `name` follows). The target may not exist (409 kit_vorhanden); a kit that a project names is
 * refused (409 kit_in_benutzung). */
export function benenneKitUm(name: string, neu: string, o?: VerwaltungsOpt): void {
  const { ordner: von, wurzel } = holeKit(name, o);
  { const g = kitSchreibGrund(wurzel); if (g !== null) throw new KitFehler(409, 'kit_ordner_fehlt', g); }
  if (!KIT_NAME.test(neu)) throw new KitFehler(400, 'kit_name_ungueltig');
  const nach = path.join(wurzel, neu);
  if (vorhanden(nach)) throw new KitFehler(409, 'kit_vorhanden');
  brauchtKeinenBenutzer(name, o, false);
  fs.renameSync(von, nach);
  try { schreibeName(nach, neu); } catch { /* the folder name is what counts; kit.json keeps the old display name */ }
}

/** Copies a kit under `neu` (default: the next free `<name>-2`, ...) into the folder the kit lives in. */
export async function kopiereKit(name: string, neu: string | null, o?: VerwaltungsOpt): Promise<{ name: string }> {
  const { ordner: von, wurzel } = holeKit(name, o);
  { const g = kitSchreibGrund(wurzel); if (g !== null) throw new KitFehler(409, 'kit_ordner_fehlt', g); }
  const ziel = neu ?? freierKitName(name, { kits: wurzel });
  if (!KIT_NAME.test(ziel)) throw new KitFehler(400, 'kit_name_ungueltig');
  if (vorhanden(path.join(wurzel, ziel))) throw new KitFehler(409, 'kit_vorhanden');
  const p = await pruefeIntern(von);
  braucheFreienPlatz(wurzel, p.ok ? p.bytes : 0);
  const stage = path.join(wurzel, `.einspielen-${zufall()}`);
  try {
    fs.mkdirSync(stage);
    for (const n of await fs.promises.readdir(von)) {
      if (n.startsWith('.') || !(await fs.promises.stat(path.join(von, n))).isFile()) continue;
      await fs.promises.copyFile(path.join(von, n), path.join(stage, n));
    }
    try { schreibeName(stage, ziel); } catch { /* keep the old display name */ }
    try { fs.renameSync(stage, path.join(wurzel, ziel)); } catch (e) {
      const c = (e as NodeJS.ErrnoException).code;
      if (c === 'ENOTEMPTY' || c === 'EEXIST') throw new KitFehler(409, 'kit_vorhanden');
      throw e;
    }
  } catch (e) { aufraeumen(stage); throw e; }
  return { name: ziel };
}

/** Moves a kit into `<kits>/.papierkorb/<name>-<time>` (a dot folder, never listed); a kit that a project names needs `trotzdem`. */
export function loescheKit(name: string, o?: VerwaltungsOpt & { trotzdem?: boolean }): { papierkorb: string } {
  const { ordner: von, wurzel } = holeKit(name, o);
  { const g = kitSchreibGrund(wurzel); if (g !== null) throw new KitFehler(409, 'kit_ordner_fehlt', g); }
  brauchtKeinenBenutzer(name, o, o?.trotzdem === true);
  const korb = path.join(wurzel, '.papierkorb');
  const nach = path.join(korb, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(korb, { recursive: true });
  fs.renameSync(von, nach);
  return { papierkorb: nach };
}

const VORSCHAU_KLANG_FRAMES = 3 * 48000, VORSCHAU_PAUSE_FRAMES = 12000;

/** One WAV (48 kHz stereo float32) with every pad in note order, each at most 3 s, 250 ms silence between; `pad` = one note number selects that pad only. */
export async function renderKitVorschau(name: string, pad: number | null, o?: VerwaltungsOpt): Promise<{ wav: Buffer; frames: number }> {
  const { ordner } = holeKit(name, o);
  const p = await pruefeIntern(ordner);
  if (!p.ok) throw new KitFehler(400, p.grund, p.text);
  const j = JSON.parse(await fs.promises.readFile(path.join(ordner, 'kit.json'), 'utf8')) as { klaenge: { note: number; datei: string; frames: number }[] };
  let klaenge = [...j.klaenge].sort((a, b) => a.note - b.note);
  if (pad !== null) {
    klaenge = klaenge.filter((k) => k.note === pad);
    if (klaenge.length === 0) throw new KitFehler(404, 'pad_unbekannt');
  }
  const teile: Buffer[] = [];
  let frames = 0;
  for (const [i, k] of klaenge.entries()) {
    if (i > 0) { teile.push(Buffer.alloc(VORSCHAU_PAUSE_FRAMES * 8)); frames += VORSCHAU_PAUSE_FRAMES; }
    const n = Math.min(k.frames, VORSCHAU_KLANG_FRAMES);
    const fd = await fs.promises.open(path.join(ordner, k.datei), 'r');
    try {
      const b = Buffer.alloc(n * 8);
      await fd.read(b, 0, b.length, 0);
      teile.push(b);
    } finally { await fd.close(); }
    frames += n;
  }
  return { wav: Buffer.concat([wavKopf(frames), ...teile]), frames };
}
