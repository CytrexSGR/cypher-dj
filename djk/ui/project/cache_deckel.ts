// Size caps for the two derived caches (storage layout A5). Only derived files are ever removed: names that match the pattern, regular files
// directly inside the cache folder. Nothing under a project folder and no source file is touched. When in doubt the file stays.
import fs from 'node:fs';
import path from 'node:path';
import { alleAudioClips } from './commands.ts';
import { alleZellen, type Projekt } from './model.ts';
import type { Projekte } from './storage.ts';
import { SLUG } from '../collection.ts';

export const DEKODIERT_DECKEL = 5 * 1024 ** 3;
export const WELLE_DECKEL = 1024 ** 3;

export type Deckelung = { geloescht: string[]; bytes_vorher: number; bytes_nachher: number };

/** Removes the oldest matching files (by mtime) that are not protected until the total of all matching files is at or below the cap. */
export function deckle(a: { ordner: string; muster: RegExp; deckel: number; geschuetzt: (name: string) => boolean }): Deckelung {
  let namen: string[];
  try { namen = fs.readdirSync(a.ordner); } catch { return { geloescht: [], bytes_vorher: 0, bytes_nachher: 0 }; }
  const dateien: { name: string; groesse: number; mtime: number }[] = [];
  for (const name of namen) {
    if (!a.muster.test(name)) continue;
    try {
      const s = fs.lstatSync(path.join(a.ordner, name));
      if (s.isFile()) dateien.push({ name, groesse: s.size, mtime: s.mtimeMs });
    } catch { /* gone or unreadable: not counted */ }
  }
  let summe = dateien.reduce((n, d) => n + d.groesse, 0);
  const vorher = summe, geloescht: string[] = [];
  if (summe > a.deckel) {
    dateien.sort((x, y) => x.mtime - y.mtime || (x.name < y.name ? -1 : 1));
    for (const d of dateien) {
      if (summe <= a.deckel) break;
      if (a.geschuetzt(d.name)) continue;
      try { fs.rmSync(path.join(a.ordner, d.name), { force: true }); } catch { continue; }
      summe -= d.groesse; geloescht.push(d.name);
    }
  }
  return { geloescht, bytes_vorher: vorher, bytes_nachher: summe };
}

export type ProjektEintrag = { slug: string; ordner: string; projekt: Projekt };

/**
 * Every entry of the projects root whose name is a slug and which is a directory (links are followed), read with `lies`. `unlesbar` lists the slugs
 * that could not be read (broken json, missing rights, dangling link): a caller that deletes anything must stop when it is not empty.
 * A directory without a project.json is no project and is skipped. A root that cannot be listed (other than missing) is `wurzelFehler`.
 */
export function leseProjekte(p: Projekte): { eintraege: ProjektEintrag[]; unlesbar: string[]; wurzelFehler: boolean } {
  const eintraege: ProjektEintrag[] = [], unlesbar: string[] = [];
  let namen: string[];
  try { namen = fs.readdirSync(p.wurzelPfad); } catch (e) {
    return { eintraege, unlesbar, wurzelFehler: (e as NodeJS.ErrnoException).code !== 'ENOENT' && (e as NodeJS.ErrnoException).code !== 'ENOTDIR' };
  }
  for (const slug of namen.filter((n) => SLUG.test(n)).sort()) {
    const ordner = path.join(p.wurzelPfad, slug);
    try {
      if (!fs.statSync(ordner).isDirectory()) continue;
    } catch { unlesbar.push(slug); continue; }
    try { fs.statSync(path.join(ordner, 'project.json')); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') unlesbar.push(slug);
      continue;
    }
    try { eintraege.push({ slug, ordner, projekt: p.lies(slug) }); } catch { unlesbar.push(slug); }
  }
  return { eintraege, unlesbar, wurzelFehler: false };
}

/** Every project of the root that can be read. Unreadable folders are skipped here; the cap run uses `leseProjekte` and stops on them. */
export function alleProjekte(p: Projekte): Projekt[] { return leseProjekte(p).eintraege.map((e) => e.projekt); }

const SHA_DATEI = /^([0-9a-f]{64})\.f32$/;
const WIEDERGABE = /^wiedergabe-.*\.json$/;

function wiedergabeShas(arbeitsordner: string): Set<string> {
  const aus = new Set<string>();
  let namen: string[];
  try { namen = fs.readdirSync(arbeitsordner); } catch { return aus; }
  for (const n of namen) {
    if (!WIEDERGABE.test(n)) continue;
    const text = fs.readFileSync(path.join(arbeitsordner, n), 'utf8');   // a read error aborts the run (the caller catches): nothing is deleted
    for (const m of text.matchAll(/[0-9a-f]{64}/g)) aus.add(m[0]);
  }
  return aus;
}

/** Every 64-hex string of a file, read in chunks (a history can be several MB). A missing file is no error; any other read error throws. */
function hexTreffer(datei: string, in_: Set<string>): void {
  let fd: number;
  try { fd = fs.openSync(datei, 'r'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
  try {
    const puffer = Buffer.alloc(256 * 1024);
    let rest = '';
    for (;;) {
      const n = fs.readSync(fd, puffer, 0, puffer.length, null);
      if (n === 0) break;
      const text = rest + puffer.toString('latin1', 0, n);
      for (const m of text.matchAll(/[0-9a-f]{64}/g)) in_.add(m[0]);
      rest = text.slice(-63);   // a hash cut by the chunk border is whole in the next text; one seen twice is only added twice
    }
  } finally { fs.closeSync(fd); }
}

/** After a run that deleted nothing although the cache is over the cap, the next full run waits this long. */
export const DECKEL_SPERRE_MS = 10 * 60_000;

export interface DekodiertDeckelOptionen {
  arbeitsordner: string; projekte: Projekte;
  offeneShas: () => Set<string>;                      // the shas of the open project
  frisch?: string | null;                              // the sha that was just decoded: never removed in this run
  deckel?: number; log?: (z: Record<string, unknown>) => void; gemeldet?: Set<string>;
  sperre?: { bis: number }; jetzt?: () => number;      // the lock after a run that could delete nothing (state of the caller; the clock is injectable)
}

// total size of the files that match, one readdir plus one lstat each; no project is read for this
function summe(ordner: string, muster: RegExp): number {
  let n = 0;
  try {
    for (const name of fs.readdirSync(ordner)) {
      if (!muster.test(name)) continue;
      try { const s = fs.lstatSync(path.join(ordner, name)); if (s.isFile()) n += s.size; } catch { /* gone: not counted */ }
    }
  } catch { /* no folder: empty */ }
  return n;
}

/**
 * Caps `<arbeitsordner>/audio/<sha>.f32`. Returns at once when the cache is at or under the cap (no project is read). Over the cap, a decode is
 * never removed when any project (real or linked, open or saved) names its sha, nor when it is the open project's, the one just decoded, or named in a
 * wiedergabe-*.json; the rest goes oldest first. Returns null when a project could not be read (nothing deleted) or the run failed.
 */
export function deckleDekodiert(a: DekodiertDeckelOptionen): Deckelung | null {
  const ordner = path.join(a.arbeitsordner, 'audio'), deckel = a.deckel ?? DEKODIERT_DECKEL;
  try {
    const gesamt = summe(ordner, SHA_DATEI);
    if (gesamt <= deckel) return { geloescht: [], bytes_vorher: gesamt, bytes_nachher: gesamt };
    const jetzt = (a.jetzt ?? Date.now)();
    if (a.sperre && jetzt < a.sperre.bis) return { geloescht: [], bytes_vorher: gesamt, bytes_nachher: gesamt };
    const sperre = (r: Deckelung | null): void => {
      if (a.sperre) a.sperre.bis = r === null || (r.geloescht.length === 0 && r.bytes_nachher > deckel) ? jetzt + DECKEL_SPERRE_MS : 0;
    };
    const gelesen = leseProjekte(a.projekte);
    const genannt = new Set<string>();
    const unlesbar = [...gelesen.unlesbar];
    for (const e of gelesen.eintraege) {   // the history (undo.jsonl holds undo and redo too) carries whole clips: its shas are named
      try { hexTreffer(path.join(e.ordner, 'undo.jsonl'), genannt); } catch { unlesbar.push(e.slug); }
    }
    if (gelesen.wurzelFehler || unlesbar.length > 0) {
      for (const slug of unlesbar.length > 0 ? unlesbar : ['']) {
        if (a.gemeldet?.has(`projekt:${slug}`)) continue;
        a.gemeldet?.add(`projekt:${slug}`);
        a.log?.({ typ: 'cache_deckel_projekt_unlesbar', slug });
      }
      sperre(null);
      return null;
    }
    for (const sha of wiedergabeShas(a.arbeitsordner)) genannt.add(sha);
    for (const sha of a.offeneShas()) genannt.add(sha);
    for (const e of gelesen.eintraege) {
      for (const c of alleAudioClips(e.projekt)) genannt.add(c.quelle.sha256);
      for (const z of alleZellen(e.projekt)) genannt.add(z.sha256);   // loop deck cells of the stored projects too
    }
    const geschuetzt = (name: string): boolean => {
      const sha = SHA_DATEI.exec(name)?.[1];
      return sha === undefined || sha === a.frisch || genannt.has(sha);
    };
    const r = deckle({ ordner, muster: SHA_DATEI, deckel, geschuetzt });
    sperre(r);
    meldeVoll(r, ordner, deckel, a.log, a.gemeldet);
    return r;
  } catch (e) {
    a.log?.({ typ: 'cache_deckel_fehler', ordner, text: String((e as Error)?.message ?? e).slice(0, 120) });
    return null;
  }
}

/** Caps `<ordner>/*.welle` (finished files only; the `.teil` files of a running computation never match). Nothing is protected. */
export function deckleWelle(a: { ordner: string; deckel?: number; log?: (z: Record<string, unknown>) => void; gemeldet?: Set<string> }): Deckelung | null {
  const deckel = a.deckel ?? WELLE_DECKEL;
  try {
    const r = deckle({ ordner: a.ordner, muster: /^[^.][^/]*\.welle$/, deckel, geschuetzt: () => false });
    meldeVoll(r, a.ordner, deckel, a.log, a.gemeldet);
    return r;
  } catch { return null; }
}

// one line per server start and folder when a run leaves the cache over the cap: what is left is all protected
function meldeVoll(r: Deckelung, ordner: string, deckel: number, log?: (z: Record<string, unknown>) => void, gemeldet?: Set<string>): void {
  if (r.bytes_nachher <= deckel || gemeldet?.has(ordner)) return;
  gemeldet?.add(ordner);
  log?.({ typ: 'cache_deckel_voll', ordner, bytes_geschuetzt: r.bytes_nachher, bytes_gesamt: r.bytes_vorher });
}
