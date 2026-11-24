// The files of the open project, as THIS PROJECT of the browser shows them (browser plan 2, task 1; contract "Plan 2", GET /proj/dateien).
// Pure builders over a project and a folder listing: the only I/O is the listing of a few project sub folders (missing folder = empty list).
import fs from 'node:fs';
import path from 'node:path';
import { alleAudioClips } from '../../project/commands.ts';
import { alleZellen, glieder, type Geraet, type Projekt, type Spur } from '../../project/model.ts';

export type Zeit = { datei: string; zeit: string };
export interface DateienSicht {
  audio: { sha256: string; name: string; pfad: string; clips: number; fehlt: boolean }[];
  midi: { clip_id: string; spur_id: string; name: string }[];
  takes: { datei: string; spur_id?: string; gerettet: boolean }[];
  exporte: Zeit[]; stems: Zeit[]; bounces: Zeit[]; resamples: Zeit[];
  instrumente: { spur_id: string; spur_name: string; geraet: string }[];
  kits: string[]; presets: string[]; fehlend: string[];
}
export interface GeretteterTake { datei: string; spur_id: string; gerettet: true }

/** Top-level entries of `<ordner>/<unter>` (dot entries skipped), newest first; a missing folder is an empty list. */
export function listeOrdnerDateien(ordner: string, unter: string): Zeit[] {
  const wurzel = path.join(ordner, unter);
  let namen: string[];
  try { namen = fs.readdirSync(wurzel); } catch { return []; }
  const aus: { datei: string; ms: number }[] = [];
  for (const datei of namen) {
    if (datei.startsWith('.')) continue;
    try { aus.push({ datei, ms: fs.statSync(path.join(wurzel, datei)).mtimeMs }); } catch { /* vanished while listing */ }
  }
  return aus.sort((a, b) => b.ms - a.ms || (a.datei < b.datei ? -1 : 1)).map((x) => ({ datei: x.datei, zeit: new Date(x.ms).toISOString() }));
}

// the device of a track as one word: rb338, surge, bk:<graph>, kit:<name>, else the name (a plugin shows its own name)
function geraetText(g: Geraet): string {
  if (g.art === 'rack') return 'rack';
  if (g.name === 'bk') return `bk:${g.graph}`;
  if (g.name === 'kit') return `kit:${g.kit}`;
  if (g.art === 'wirt' && g.name === 'plugin') return g.plugin?.name ?? 'plugin';
  return g.name;
}
const sammle = <T>(ziel: T[], x: T | undefined): void => { if (x !== undefined && !ziel.includes(x)) ziel.push(x); };

function geraeteDerSpur(s: Spur): Geraet[] {
  if (!s.geraet) return [];
  return s.geraet.art === 'rack' ? glieder(s).map((x) => x.geraet) : [s.geraet];
}

function takesVon(ordner: string, p: Projekt, gerettet: readonly GeretteterTake[]): DateienSicht['takes'] {
  const gerettetNamen = new Set(gerettet.map((g) => g.datei));
  const aus: DateienSicht['takes'] = [];
  for (const { datei } of listeOrdnerDateien(ordner, 'aufnahmen').sort((a, b) => (a.datei < b.datei ? -1 : 1))) {
    if (!/^take-.*\.wav$/.test(datei) || gerettetNamen.has(datei)) continue;
    const nr = /(\d+)(?:-gerettet)?\.wav$/.exec(datei)?.[1];
    const spur = nr === undefined ? undefined : p.spuren.find((s) => s.nr === Number(nr));
    aus.push({ datei, ...(spur ? { spur_id: spur.id } : {}), gerettet: false });
  }
  for (const g of gerettet) aus.push({ datei: g.datei, spur_id: g.spur_id, gerettet: true });
  return aus;
}

export function dateienSicht(a: { projekt: Projekt; ordner: string; gerettet: readonly GeretteterTake[];
  quellPfad: (sha: string, hinweis: string) => string | null; katalogName: (sha: string) => string | null }): DateienSicht {
  const p = a.projekt;
  // audio: clips of the main lanes and take lanes, then loop deck cells, merged by sha in the order they are met
  const quellen = new Map<string, { hinweis: string; clipName: string; clips: number }>();
  const merke = (sha: string, hinweis: string, name: string): void => {
    const q = quellen.get(sha);
    if (q) { q.clips += 1; if (q.hinweis === '' && hinweis) q.hinweis = hinweis; } else quellen.set(sha, { hinweis, clipName: name, clips: 1 });
  };
  for (const c of alleAudioClips(p)) merke(c.quelle.sha256, c.quelle.pfad_hinweis, c.name);
  for (const z of alleZellen(p)) merke(z.sha256, z.pfad_hinweis ?? '', z.name);
  const audio: DateienSicht['audio'] = [];
  const fehlend: string[] = [];
  for (const [sha, q] of quellen) {
    const aufgeloest = a.quellPfad(sha, q.hinweis);
    const pfad = aufgeloest ?? q.hinweis;
    const name = a.katalogName(sha) || q.clipName || path.basename(pfad);
    audio.push({ sha256: sha, name, pfad, clips: q.clips, fehlt: aufgeloest === null });
    if (aufgeloest === null) fehlend.push(sha);
  }
  const midi: DateienSicht['midi'] = [];
  const instrumente: DateienSicht['instrumente'] = [];
  const kits: string[] = [], presets: string[] = [];
  for (const s of p.spuren) {
    for (const c of s.clips) if (c.art === 'midi') midi.push({ clip_id: c.id, spur_id: s.id, name: c.name });
    if (s.geraet) instrumente.push({ spur_id: s.id, spur_name: s.name, geraet: geraetText(s.geraet) });
    for (const g of geraeteDerSpur(s)) {
      if (g.art === 'intern' && g.name === 'kit') sammle(kits, g.kit);
      if (g.art === 'intern' && g.name !== 'kit') sammle(presets, g.preset);
    }
    for (const i of s.inserts ?? []) sammle(presets, i.preset);
  }
  return { audio, midi, takes: takesVon(a.ordner, p, a.gerettet), exporte: listeOrdnerDateien(a.ordner, 'export'), stems: listeOrdnerDateien(a.ordner, 'stems'),
    bounces: listeOrdnerDateien(a.ordner, 'bounce'), resamples: listeOrdnerDateien(a.ordner, 'resample'), instrumente, kits, presets, fehlend };
}

/** The path hint the project holds for a sha (clips first, then loop cells), '' when it names none. */
export function hinweisVon(p: Projekt, sha: string): string {
  for (const c of alleAudioClips(p)) if (c.quelle.sha256 === sha && c.quelle.pfad_hinweis) return c.quelle.pfad_hinweis;
  for (const z of alleZellen(p)) if (z.sha256 === sha && z.pfad_hinweis) return z.pfad_hinweis;
  return '';
}

/** Every sha the project names (clips, take lanes, loop cells). */
export function referenzierteShas(p: Projekt): Set<string> {
  const s = new Set<string>();
  for (const c of alleAudioClips(p)) s.add(c.quelle.sha256);
  for (const z of alleZellen(p)) s.add(z.sha256);
  return s;
}

const SHA8_ENDE = /-([0-9a-f]{8})\.[^./]+$/;
const echtPfad = (p: string): string => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
// a hint as the project-relative path with '/': hints are absolute (take, bounce, resample, stems routes) or relative (older projects);
// an absolute hint is resolved through realpath on both sides (the project folder may sit behind a link), one outside the folder gives null
export function hinweisRelativ(ordner: string, h: string): string | null {
  const roh = h.replace(/\\/g, '/');
  if (!path.posix.isAbsolute(roh) && !path.win32.isAbsolute(h)) return path.posix.normalize(roh);
  const wurzel = echtPfad(ordner);
  const r = path.relative(wurzel, path.join(echtPfad(path.dirname(h)), path.basename(h))).split(path.sep).join('/');
  return r === '' || r.startsWith('..') || path.isAbsolute(r) ? null : r;
}
// files below a folder, never descending into or listing dot entries, never following links; paths relative to the project, with '/'
function dateienUnter(ordner: string, unter: string): string[] {
  const aus: string[] = [];
  const geh = (rel: string): void => {
    let eintraege: fs.Dirent[];
    try { eintraege = fs.readdirSync(path.join(ordner, rel), { withFileTypes: true }); } catch { return; }
    for (const e of eintraege) {
      if (e.name.startsWith('.')) continue;
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) geh(r); else if (e.isFile()) aus.push(r);
    }
  };
  geh(unter);
  return aus.sort();
}

/**
 * Files of the project folder that nothing references (CLEAN UP lists and moves them). Data-loss rules: a name ending `-gerettet.wav` and every file the
 * rescue list names are never listed; while an `aufnahmen/.laufend-*.json` exists nothing in `aufnahmen/` is listed; dot entries (`.versionen`,
 * `.papierkorb`, run files, markers) and `export/`, `project.json`, `undo.jsonl` are never looked at.
 */
export function unreferenziert(a: { projekt: Projekt; ordner: string; gerettet: readonly { datei: string }[] }): string[] {
  const shas8 = new Set([...referenzierteShas(a.projekt)].map((s) => s.slice(0, 8)));
  const hinweise = new Set<string>();
  for (const h of [...alleAudioClips(a.projekt).map((c) => c.quelle.pfad_hinweis), ...alleZellen(a.projekt).map((z) => z.pfad_hinweis)]) {
    const r = h ? hinweisRelativ(a.ordner, h) : null;
    if (r !== null) hinweise.add(r);
  }
  // a file written after the last save of project.json is not a candidate (a job may be placing it), and a `.teil` file is a job's partial output
  let gespeichert = Infinity;
  try { gespeichert = fs.statSync(path.join(a.ordner, 'project.json')).mtimeMs; } catch { /* no saved state: no cut-off */ }
  const frisch = (rel: string): boolean => { try { return fs.statSync(path.join(a.ordner, rel)).mtimeMs > gespeichert; } catch { return true; } };
  const frei = (rel: string): boolean => !rel.endsWith('.teil') && !frisch(rel);
  const gerettet = new Set(a.gerettet.map((g) => g.datei));
  let laeuft = false;
  try { laeuft = fs.readdirSync(path.join(a.ordner, 'aufnahmen')).some((n) => /^\.laufend-.*\.json$/.test(n)); } catch { /* no folder */ }
  const aus: string[] = [];
  for (const rel of dateienUnter(a.ordner, 'audio')) {
    const m = SHA8_ENDE.exec(rel);
    if (m && !shas8.has(m[1]) && !hinweise.has(rel) && frei(rel)) aus.push(rel);
  }
  if (!laeuft) {
    for (const rel of dateienUnter(a.ordner, 'aufnahmen')) {
      const name = path.posix.basename(rel);
      if (!/^take-.*\.wav$/.test(name) || name.endsWith('-gerettet.wav') || gerettet.has(name) || hinweise.has(rel) || !frei(rel)) continue;
      aus.push(rel);
    }
  }
  for (const unter of ['stems', 'bounce', 'resample']) {
    for (const rel of dateienUnter(a.ordner, unter)) {
      if (rel.endsWith('-gerettet.wav') || hinweise.has(rel) || !frei(rel)) continue;
      aus.push(rel);
    }
  }
  return aus.sort();
}
