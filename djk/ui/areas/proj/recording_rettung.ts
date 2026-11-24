// Recovered takes (B11). Part 1: the run file. At REC the page server writes <project>/aufnahmen/.laufend-<kennung>.json (project slug, track ids, start
// beat, tempo, latency offset, the core's f32 paths); after the take hand-over it is removed. A run file that is left behind tells the next project
// open that a take exists in the core's work folder that no project knows (see the rescue part of this module).
// The run file is a safety net only: nothing in here may ever throw into the recording flow.
import fs from 'node:fs';
import path from 'node:path';
import { nehmeTakeAuf, schreibeWavAusF32Stueckweise, TakeFehler } from '../../project/recording.ts';
import type { Projekt } from '../../project/model.ts';
import type { ProjZugang } from './area.ts';
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { grundText } from '../../http/reasons.ts';
import { aendereStand } from '../../project/state.ts';
import { sucheSpur } from '../../project/model.ts';
import { alsAntwort, leseKoerper } from './area.ts';
import { ProjFehler, type Antwort } from './session.ts';

export const LAUF_FORMAT = 'cypherdj-lauf/1';

export interface LaufDatei {
  format: typeof LAUF_FORMAT; projekt: string; kennung: number; seit: string; start_beat: number; tempo_bpm: number; nachlauf_samples: number;
  spuren: { id: string; nr: number; name: string; versatz_samples: number; f32: string }[];
  midi_spuren: string[];   // instrument tracks: ids only, a MIDI take is not recoverable
}

export function laufDateiPfad(ordner: string, kennung: number): string {
  return path.join(ordner, 'aufnahmen', `.laufend-${kennung}.json`);
}

// Atomic (tmp, fsync, rename); creates aufnahmen/ when missing. Returns false and never throws.
export function schreibeLaufDatei(ordner: string, d: LaufDatei): boolean {
  const ziel = laufDateiPfad(ordner, d.kennung), tmp = `${ziel}.tmp`;
  let fd: number | null = null;
  try {
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, JSON.stringify(d));
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = null;
    fs.renameSync(tmp, ziel);
    return true;
  } catch {
    try { if (fd !== null) fs.closeSync(fd); } catch { /* nothing to do */ }
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to do */ }
    return false;
  }
}

export function entferneLaufDatei(ordner: string, kennung: number): void {
  try { fs.rmSync(laufDateiPfad(ordner, kennung), { force: true }); } catch { /* never throws */ }
}

// The keep/delete decision after the take hand-over. `antwort` are the `takes` entries of the hand-over answer; an audio entry carries `spur_nr` (the caller
// adds it, the answer itself has only spur_id), an entry without it (a MIDI track) is not recoverable and does not count. KEPT when any audio track failed
// for a rescuable reason; DELETED when every track was placed, its f32 is gone, it is empty (`leer`) or deliberately outside the punch range (`punch_leer`).
export function laufDateiBleibt(antwort: Record<string, unknown>[], f32: (spurNr: number) => string): boolean {
  for (const e of antwort) {
    if (!e.fehler || typeof e.spur_nr !== 'number') continue;
    if (e.fehler === 'leer' || e.fehler === 'punch_leer') continue;
    if (e.fehler === 'datei_fehlt' || e.fehler === 'veraltet_spur') {
      let da = false;
      try { da = fs.existsSync(f32(e.spur_nr)); } catch { da = false; }
      if (da) return true;
      continue;
    }
    return true;
  }
  return false;
}

// ---- Part 2: the rescue when a project opens ---------------------------------------------------------------------------------------------------------------
// The core is a separate process and keeps writing after a page server kill. A left run file names the raw f32 of every track; each is converted into
// aufnahmen/take-<kennung>-<nr>-gerettet.wav plus a record file .gerettet-<kennung>-<nr>.json that the list (and PLACE) reads. Every step can be repeated
// after a second crash: tmp WAV first, then compare with the project, then rename, then the record, and the run file goes last.
export const GERETTET_FORMAT = 'cypherdj-gerettet/1';

export interface GeretteterTake {
  datei: string; spur_id: string; spur_name: string; start_beat: number; tempo_bpm: number; frames: number; sha256: string;
  versatz_samples: number; nachlauf_samples: number; abgebrochen: boolean; gerettet: true;
}
type Log = (e: Record<string, unknown>) => void;
export interface RettungOpt {
  projekt: Projekt; arbeitsordner: string;   // the core's work folder: the only place a run file may name a raw f32 in
  jetzt?: () => number; staleMs?: number; log?: Log;
  schreibe?: typeof schreibeWavAusF32Stueckweise;   // replaceable by tests (call count); the default is the real chunked writer
}
type RettungInnen = Required<RettungOpt>;
const STALE_MS = 10000;
const laufende = new Map<string, Promise<void>>();   // one running rescue per project folder

const gerettetDatei = (ordner: string, kennung: number, nr: number): string => path.join(ordner, 'aufnahmen', `.gerettet-${kennung}-${nr}.json`);
const wavName = (kennung: number, nr: number): string => `take-${kennung}-${nr}-gerettet.wav`;

async function schreibeAtomar(ziel: string, text: string): Promise<void> {
  const tmp = `${ziel}.tmp`;
  const f = await fs.promises.open(tmp, 'w');
  try { await f.writeFile(text); await f.sync(); } finally { await f.close(); }
  await fs.promises.rename(tmp, ziel);
}

// every sha256 the project mentions (clips of the main lanes and of the take lanes): a take whose audio is already there is not offered again
function projektHashes(p: Projekt, spurId: string): Set<string> {
  const h = new Set<string>();
  const geh = (x: unknown): void => {
    if (x === null || typeof x !== 'object') return;
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if (k === 'sha256' && typeof v === 'string') h.add(v); else geh(v);
    }
  };
  // per track: identical audio on another track (digital silence) is not "already there"
  for (const s of p.spuren) { if (s.id === spurId) { geh(s.clips); geh(s.takes); } }
  return h;
}

// What the core's sidecar says: null = unknown or unreadable (treated like `laeuft`)
function sidecarStatus(f32: string): string | null {
  try {
    const j = JSON.parse(fs.readFileSync(f32.replace(/\.f32$/, '.json'), 'utf8')) as { status?: unknown };
    return typeof j.status === 'string' ? j.status : null;
  } catch { return null; }
}

type Spur1 = LaufDatei['spuren'][number];
const istLaufDatei = (j: unknown): j is LaufDatei => {
  const d = j as Partial<LaufDatei> | null;
  return d !== null && typeof d === 'object' && d.format === LAUF_FORMAT && Number.isInteger(d.kennung) && Array.isArray(d.spuren)
    && typeof d.start_beat === 'number' && typeof d.tempo_bpm === 'number' && typeof d.nachlauf_samples === 'number'
    && d.spuren.every((s) => s && typeof s.id === 'string' && Number.isInteger(s.nr) && typeof s.f32 === 'string' && typeof s.versatz_samples === 'number');
};

// true = resolved (converted, missing, empty or already placed), false = left for later (still being written, or a failure that may pass)
async function rettSpur(ordner: string, d: LaufDatei, s: Spur1, o: RettungInnen): Promise<boolean> {
  const hashes = projektHashes(o.projekt, s.id);
  const aufn = path.join(ordner, 'aufnahmen');
  let st: fs.Stats;
  try { st = await fs.promises.stat(s.f32); } catch {
    o.log({ typ: 'proj_rettung_datei_fehlt', kennung: d.kennung, spur_id: s.id, f32: s.f32 });
    return true;
  }
  const frames = Math.floor(st.size / 8);
  const status = sidecarStatus(s.f32);
  const frisch = o.jetzt() - st.mtimeMs < o.staleMs;
  const fertig = status === 'fertig' || status === 'luecken' || status === 'abgebrochen' || status === 'kein_platz';
  if (!fertig && frisch) { o.log({ typ: 'proj_rettung_schreibt_noch', kennung: d.kennung, spur_id: s.id }); return false; }
  if (frames === 0) { o.log({ typ: 'proj_rettung_leer', kennung: d.kennung, spur_id: s.id }); return true; }
  const abgebrochen = !(status === 'fertig' || status === 'luecken');
  const datei = wavName(d.kennung, s.nr), ziel = path.join(aufn, datei), tmp = `${ziel}.tmp`;
  const rec = gerettetDatei(ordner, d.kennung, s.nr);
  // idempotent: a valid record with its WAV is the finished state of this track (the run file removal is what a crash interrupted)
  try {
    const alt = JSON.parse(await fs.promises.readFile(rec, 'utf8')) as { format?: unknown; datei?: unknown };
    if (alt.format === GERETTET_FORMAT && alt.datei === datei && fs.existsSync(ziel)) return true;
  } catch { /* no record yet */ }
  try {
    await fs.promises.rm(tmp, { force: true });
    const w = await o.schreibe(s.f32, tmp);
    if (hashes.has(w.sha256)) { await fs.promises.rm(tmp, { force: true }); o.log({ typ: 'proj_rettung_schon_platziert', kennung: d.kennung,
      spur_id: s.id }); return true; }
    await fs.promises.rename(tmp, ziel);   // an existing final name without its record is replaced
    const r: GeretteterTake = { datei, spur_id: s.id, spur_name: s.name, start_beat: d.start_beat, tempo_bpm: d.tempo_bpm, frames: w.frames, sha256: w.sha256,
      versatz_samples: s.versatz_samples, nachlauf_samples: d.nachlauf_samples, abgebrochen, gerettet: true };
    await schreibeAtomar(rec, JSON.stringify({ format: GERETTET_FORMAT, ...r }));
    o.log({ typ: 'proj_rettung_gerettet', kennung: d.kennung, spur_id: s.id, datei, frames: w.frames, abgebrochen });
    return true;
  } catch (e) {
    await fs.promises.rm(tmp, { force: true }).catch(() => { /* nothing to do */ });
    o.log({ typ: 'proj_rettung_fehler', kennung: d.kennung, spur_id: s.id, grund: e instanceof TakeFehler ? e.grund : undefined,
      fehler: (e as Error)?.message ?? String(e) });
    return false;
  }
}

// The f32 a run file names must be `aufnahme-<nr>-<kennung>.f32` directly inside the work folder of the core, after symlinks (realpath), with its sidecar
// json next
// to it. A missing f32 passes the name test only (the rescue then logs it as gone); anything that exists must pass all of it.
function f32Erlaubt(arbeitsordner: string, kennung: number, s: Spur1): boolean {
  try {
    if (typeof s.f32 !== 'string' || !path.isAbsolute(s.f32)) return false;
    if (path.basename(s.f32) !== `aufnahme-${s.nr}-${kennung}.f32`) return false;
    const arr = fs.realpathSync(arbeitsordner);
    if (path.dirname(path.resolve(s.f32)) !== arr && path.dirname(path.resolve(s.f32)) !== path.resolve(arbeitsordner)) return false;
    if (!fs.existsSync(s.f32)) { try { fs.lstatSync(s.f32); return false; } catch { return true; } }   // a dangling symlink is not "missing"
    if (fs.realpathSync(s.f32) !== path.join(arr, path.basename(s.f32))) return false;
    const j = s.f32.replace(/\.f32$/, '.json');
    return fs.lstatSync(j).isFile() && fs.realpathSync(j) === path.join(arr, path.basename(j));
  } catch { return false; }
}

async function rette(ordner: string, opt: RettungOpt): Promise<void> {
  const o: RettungInnen = { projekt: opt.projekt, arbeitsordner: opt.arbeitsordner, jetzt: opt.jetzt ?? Date.now, staleMs: opt.staleMs ?? STALE_MS,
    log: opt.log ?? (() => { /* silent */ }),
    schreibe: opt.schreibe ?? schreibeWavAusF32Stueckweise };
  const aufn = path.join(ordner, 'aufnahmen');
  let namen: string[];
  try { namen = (await fs.promises.readdir(aufn)).filter((n) => /^\.laufend-\d+\.json$/.test(n)).sort(); } catch { return; }
  for (const n of namen) {
    const pfad = path.join(aufn, n);
    let d: unknown;
    try { d = JSON.parse(await fs.promises.readFile(pfad, 'utf8')); } catch (e) {
      o.log({ typ: 'proj_rettung_lauf_unlesbar', datei: n, fehler: (e as Error).message }); continue;   // never deleted
    }
    if (!istLaufDatei(d)) { o.log({ typ: 'proj_rettung_lauf_unbekannt', datei: n }); continue; }
    if (d.spuren.length === 0) o.log({ typ: 'proj_rettung_nur_midi', kennung: d.kennung, midi_spuren: d.midi_spuren?.length ?? 0 });
    let alle = true;
    const falsch = d.spuren.find((s) => !f32Erlaubt(o.arbeitsordner, d.kennung, s));
    // a run file is data of the project (it may come with an imported project): it never makes the server read a file outside the core's work folder
    if (falsch) {
      o.log({ typ: 'proj_rettung_lauf_pfad_abgelehnt', datei: n, kennung: d.kennung, spur_id: falsch.id, f32: falsch.f32 });
      entferneLaufDatei(ordner, d.kennung); continue;
    }
    for (const s of d.spuren) { if (!(await rettSpur(ordner, d, s, o))) alle = false; }
    if (alle) entferneLaufDatei(ordner, d.kennung);
  }
}

// One rescue per folder at a time; a second call joins the first.
export function rettePendelnde(ordner: string, opt: RettungOpt): Promise<void> {
  const da = laufende.get(ordner);
  if (da) return da;
  const p = rette(ordner, opt).finally(() => { if (laufende.get(ordner) === p) laufende.delete(ordner); });
  laufende.set(ordner, p);
  return p;
}

// The recovered takes of a folder (record files), after a running rescue of that folder has ended. Corrupt records are skipped and logged; a record without its
// WAV is not listed.
export async function gerettetListe(ordner: string, log: Log = () => { /* silent */ }): Promise<GeretteterTake[]> {
  try { await laufende.get(ordner); } catch { /* the rescue logged it */ }
  const aufn = path.join(ordner, 'aufnahmen');
  let namen: string[];
  try { namen = await fs.promises.readdir(aufn); } catch { return []; }
  const liste: { k: number; nr: number; t: GeretteterTake }[] = [];
  for (const n of namen) {
    const m = /^\.gerettet-(\d+)-(\d+)\.json$/.exec(n);
    if (!m) continue;
    try {
      const { format, ...t } = JSON.parse(await fs.promises.readFile(path.join(aufn, n), 'utf8')) as { format?: unknown } & GeretteterTake;
      if (format !== GERETTET_FORMAT || typeof t.datei !== 'string' || t.datei !== path.basename(t.datei) || typeof t.spur_id !== 'string'
        || typeof t.sha256 !== 'string' || !Number.isFinite(t.frames) || !Number.isFinite(t.start_beat)) throw new Error('not a recovered take record');
      if (!fs.existsSync(path.join(aufn, t.datei))) throw new Error('the WAV of the record is missing');
      liste.push({ k: Number(m[1]), nr: Number(m[2]), t: { ...t, gerettet: true } });
    } catch (e) { log({ typ: 'proj_rettung_eintrag_defekt', datei: n, fehler: (e as Error).message }); }
  }
  return liste.sort((a, b) => a.k - b.k || a.nr - b.nr).map((x) => x.t);
}

// The hook of the page server: when a project opens, rescue what a left run file names. Skipped while a recording runs (the next open does it); never blocks
// the open, never throws.
export function starteRettung(zugang: Pick<ProjZugang, 'beiOffen' | 'offen' | 'aufnahmeAktiv' | 'arbeitsordner'>, ctx: Pick<BereichKontext, 'log'>,
  opt: Partial<RettungOpt> = {}): void {
  const log: Log = (e) => { try { ctx.log(e); } catch { /* the log must not hurt */ } };
  zugang.beiOffen?.((slug) => {
    if (slug === null) return;
    try {
      if (zugang.aufnahmeAktiv?.() === true) { log({ typ: 'proj_rettung_aufgeschoben', slug }); return; }
      const o = zugang.offen();
      if (!o) return;
      void rettePendelnde(o.ordner, { ...opt, projekt: o.projekt, arbeitsordner: zugang.arbeitsordner(),
        log }).catch((e: unknown) => log({ typ: 'proj_rettung_fehler', fehler: (e as Error)?.message ?? String(e) }));
    } catch (e) { log({ typ: 'proj_rettung_fehler', fehler: (e as Error)?.message ?? String(e) }); }
  });
}

// ---- Part 3: list and PLACE --------------------------------------------------------------------------------------------------------------------------------
// POST /proj/gerettet_platzieren {datei}: the recovered take named by its WAV file name goes onto its track at its recorded start, as one undoable entry.
// `datei` is looked up ONLY by matching the file name in gerettetListe; client text never becomes part of a path.
const RATE = 48000;
const recordDatei = (ordner: string, datei: string): string | null => {
  const m = /^take-(\d+)-(\d+)-gerettet\.wav$/.exec(datei);
  return m ? path.join(ordner, 'aufnahmen', `.gerettet-${m[1]}-${m[2]}.json`) : null;
};
// The contract wants {ok:false, grund, text}; the shared answer builder adds `fehler`, so `ok` and `grund` are added next to it.
const mitGrund = (a: Antwort): Antwort => {
  const j = a.j as Record<string, unknown>;
  return a.code === 200 ? a : { code: a.code, j: { ok: false, grund: j.fehler, ...j } };
};

export function rettungBereich(ctx: BereichKontext, zugang: ProjZugang): Bereich {
  const platziere = async (d: Record<string, unknown>): Promise<Antwort> => {
    const datei = d.datei;
    const o0 = zugang.offen();
    if (!o0) throw new ProjFehler(409, 'kein_projekt');
    if (zugang.aufnahmeAktiv?.() === true) throw new ProjFehler(409, 'aufnahme_laeuft');
    if (typeof datei !== 'string' || datei === '' || datei !== path.basename(datei) || datei.includes('\\')) throw new ProjFehler(400, 'gerettet_unbekannt');
    const t = (await gerettetListe(o0.ordner, (e) => ctx.log(e))).find((x) => x.datei === datei);
    const rec = recordDatei(o0.ordner, datei);
    if (!t || !rec) throw new ProjFehler(404, 'gerettet_unbekannt');
    // the project as it is NOW (the rescue wait above may have taken a moment); another project than before means the take is not of this one
    const o = zugang.offen();
    if (!o || o.slug !== o0.slug) throw new ProjFehler(409, 'kein_projekt');
    if (zugang.aufnahmeAktiv?.() === true) throw new ProjFehler(409, 'aufnahme_laeuft');
    const wav = path.join(o.ordner, 'aufnahmen', t.datei);
    const meta = { quelle: ctx.quelle(), label: 'Place recovered take' };
    const kennung = /^take-(\d+)-/.exec(t.datei)?.[1] ?? '';
    const vorher = new Set(sucheSpur(o.projekt, t.spur_id)?.clips.map((c) => c.id) ?? []);
    let neu: Projekt;
    try {
      neu = nehmeTakeAuf(structuredClone(o.projekt), { spurId: t.spur_id, startBeat: t.start_beat,
        laengeBeats: (t.frames / RATE) * (o.projekt.tempo_bpm / 60), sha256: t.sha256, pfadHinweis: wav, name: `Take ${kennung} (recovered)`,
        versatzSamples: t.versatz_samples, nachlaufSamples: t.nachlauf_samples, abgebrochen: t.abgebrochen });
    } catch (e) {
      if (e instanceof TakeFehler) return { code: 409, j: { ok: false, fehler: e.grund, grund: e.grund, text: grundText(e.grund) } };
      throw e;
    }
    const w = aendereStand(o.verlauf, o.projekt, neu, meta, zugang.haken());
    if (w.eintrag !== null) await zugang.uebernimm(w, meta);
    const klon = (zugang.offen()?.projekt ?? w.projekt);
    const clip = sucheSpur(klon, t.spur_id)?.clips.find((c) => !vorher.has(c.id));
    try { fs.rmSync(rec, { force: true }); } catch (e) { ctx.log({ typ: 'proj_rettung_eintrag_bleibt', datei, fehler: (e as Error).message }); }
    return { code: 200, j: { ok: true, clip_id: clip?.id ?? null } };
  };
  const antworte = async (r: http.ServerResponse, f: () => Antwort | Promise<Antwort>): Promise<void> => {
    let x: Antwort;
    try { x = mitGrund(await f()); } catch (e) { x = mitGrund(alsAntwort(e, ctx)); }
    json(r, x.code, x.j);
  };
  const routen = (): Route[] => [
    { methode: 'POST', pfad: '/proj/gerettet_platzieren', schutz: 'fremdePost', handler: async (q, r) => {
      await antworte(r, async () => platziere(await leseKoerper(q)));
    } },
  ];
  return { name: 'proj-rettung', routen };
}
