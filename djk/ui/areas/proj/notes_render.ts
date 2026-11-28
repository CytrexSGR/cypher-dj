// Note editor (slice 1, task B4): the render service. An audio clip whose note list carries a target (audio_noten, contract djk/contract/notes.md) plays
// the render of that edit instead of its source: <arbeitsordner>/noten/<key>.f32 next to <key>.json (the CacheEintrag of project/notes_cache.ts), the
// key being renderSchluessel(source sha, curve id, engine version, list). The translation asks datei(c) for every audio clip (spec N1: the one place that
// decides which file a clip plays); a missing render is queued, ONE worker runs `cypherdj-noten render` (NotenLauf, the runner of the detection), and
// the finished render makes the live playback load again (neuLaden). The three note commands do not touch the playback (betrifft_wiedergabe false), so
// beiStand(p) watches every stand of the open project: it queues missing renders (undo, redo, a restored version, a deleted cache folder) and reloads the
// live playback once per stand when the file a clip plays has changed without a new render (reset of all targets, undo onto a cached render).
// States per clip: quelle (plays the source), rechnet (queued or running, plays the source), alt (plays the last finished render of the clip while the
// new one is computed), bereit (the exact render), fehler (plays the source; noten_programm_fehlt, noten_render_fehler, noten_kurve_fehlt).
import fs from 'node:fs';
import path from 'node:path';
import type { spawn as echtSpawn } from 'node:child_process';
import type { BereichKontext } from '../../http/router.ts';
import { alleAudioClips } from '../../project/commands.ts';
import type { AudioClip, Projekt } from '../../project/model.ts';
import { AUFTRAG_FORMAT, NOTEN_SR, SEGMENTIERER_VERSION, hatZiele, kurveDatei, renderSchluessel, zeilePruefung,
  type AudioNote } from '../../project/notes_contract.ts';
import { geaenderteIds, raeumePlan, type CacheEintrag } from '../../project/notes_cache.ts';
import type { ProjZugang } from './area.ts';
import { CURVE_ID, leseKurve } from './notes.ts';
import { NotenLauf, type NotenErgebnis } from './notes_run.ts';
import { notenZeitlimitMs } from '../../project/notes_audio.ts';

export type RenderZustand = { zustand: 'quelle' | 'rechnet' | 'bereit' | 'alt' | 'fehler'; schluessel?: string; grund?: string; text?: string;
  sekunden?: number;
  /** measured pitch of the output per edited note (the `messung` of the result line of `render`), when the engine gave it */
  messung?: NotenMessung[] };
export type NotenMessung = { id: string; ton_ist: number; fehler_ct: number };
/** What the translation (and the export) asks: the file a clip plays instead of its source, or null for the source. `live`: the answer goes to the live
 *  playback (the service remembers it to see later whether the file of a clip changed). */
export type NotenRenderQuelle = {
  datei(c: AudioClip, live?: boolean): { sha256: string; datei: string } | null;
  bereit?(fristMs: number): Promise<boolean>;
  /** A translation starts (the service forgets what the last one asked). live: it goes to the live playback; false: an export or another file view */
  beginne?(live: boolean): void;
  /** true when the last non-live translation gave every clip with targets its exact file */
  exakt?(): boolean;
  /** the reason of the first clip of the open project whose render will not come (a failed job, no program), else null */
  fehlerGrund?(): string | null;
};
export interface NotenRenderOptionen {
  programm: string;                      // cypherdj-noten
  netz: string[] | null;                 // the network module as a command; null = no network runtime (a network curve cannot be recomputed)
  cwd: string;
  neuLaden: () => Promise<unknown>;      // the live playback is translated and loaded again (ProjSitzung.ladeLiveNeuFrei)
  maxBytes?: number;                     // cache limit, default 4 GB (spec N5)
  proKlip?: number;                      // renders kept per clip, default 3
  killMs?: number;                       // SIGTERM to SIGKILL of a child that overran its limit, default 2000
  renderFristMs?: number;                // test: the limit of one `render` child instead of max(30 s, 4 x the source duration)
  versionFristMs?: number;               // test: the limit of `version` at start instead of 10 s
  env?: Record<string, string | undefined>;   // extra environment of the children (a test steers its stand-ins with it)
  cpus?: string;                         // CPU mask instead of CYPHERDJ_STEMS_CPUS (test)
  spawn?: typeof echtSpawn;              // test: look at the command line
}

interface Auftrag { slug: string; clipId: string; sha: string; kurve: string; liste: AudioNote[]; schluessel: string }
// A failed job: the reason that goes to the page, and the detail that goes to the log
class RenderFehler extends Error {
  readonly grund: 'noten_render_fehler' | 'noten_kurve_fehlt';
  readonly text: string;
  constructor(grund: 'noten_render_fehler' | 'noten_kurve_fehlt', text: string, detail: string) { super(detail); this.grund = grund; this.text = text; }
}
class Abbruch extends Error {}

const PROKLIP = 3;
const MAXBYTES = 4_000_000_000;           // spec N5: at most 4 GB in total
const VERSION_MS = 10_000;
const TEMP_AB = 900_000;                  // the temp folders noten-<n> of a render start here; the detection counts up from 1 in the same folder
const HEX64 = /^[0-9a-f]{64}$/;

const groesse = (pfad: string): number | null => { try { return fs.statSync(pfad).size; } catch { return null; } };

export class NotenRender implements NotenRenderQuelle {
  private readonly ctx: BereichKontext;
  private readonly zugang: ProjZugang;
  private readonly o: NotenRenderOptionen;
  private maschine: string | null = null;                         // the engine version of `cypherdj-noten version`; null = no program
  private readonly index = new Map<string, CacheEintrag>();      // every render in the cache folder, by key
  private readonly letzte = new Map<string, CacheEintrag>();     // per clip: the last finished render (`alt`, --vorher)
  private readonly zustaende = new Map<string, RenderZustand>(); // per clip; a clip that plays its source has no entry
  // per clip: the file the LAST live translation was given (null = source). A translation starts a new record (beginne) and a clip it never asks
  // (muted, not decoded, frozen) is not in it, so beiStand compares only what the playback really holds.
  private gegeben = new Map<string, string | null>();
  private readonly zuletzt = new Map<string, string>();          // per clip: the key of the last answer with a render (in use for the cleanup)
  // keys whose job failed: tried once more on the next stand that still needs them (n counts the failures), then not again until the list changes
  // (a new key) or the server restarts
  private readonly gescheitert = new Map<string, { f: RenderFehler; stand: number; n: number }>();
  private standNr = 0;                                              // counts the calls of beiStand
  private imStand = false;                                        // true while beiStand runs: only there a failed key may be tried again
  private letzteExakt = true;                                     // pruefeClip: the clip got what it needs (its exact file, or it needs none)
  private exportLuecke = false;                                   // the last non-live translation gave a clip with targets less than its exact file
  private readonly rechenzeit = new Map<string, number>();       // seconds of the last job of a key (state bereit)
  private readonly messungen = new Map<string, NotenMessung[]>();  // the `messung` of the last job of a key (state bereit)
  private readonly queue = new Map<string, Auftrag>();           // at most one per clip, a newer request replaces it
  private laufend: Auftrag | null = null;
  private prozess: NotenLauf | null = null;
  private stand: Projekt | null = null;                          // the last stand beiStand saw
  private geschlossen = false;
  private naechsterOrdner = TEMP_AB;
  private readonly warter = new Set<() => void>();

  constructor(ctx: BereichKontext, zugang: ProjZugang, o: NotenRenderOptionen) { this.ctx = ctx; this.zugang = zugang; this.o = o; }

  // ---- paths --------------------------------------------------------------------------------------------------------------------------

  private notenOrdner(): string { return path.join(this.zugang.arbeitsordner(), 'noten'); }
  private renderDatei(key: string): string { return path.join(this.notenOrdner(), `${key}.f32`); }
  private quellDatei(sha: string): string { return path.join(this.zugang.arbeitsordner(), 'audio', `${sha}.f32`); }
  private static ck(slug: string, clipId: string): string { return `${slug}\0${clipId}`; }
  // a render is usable when its file is there and has exactly the size of the source (the contract: the render has the frames of the source)
  private dateiOk(key: string, quellBytes: number): boolean { return groesse(this.renderDatei(key)) === quellBytes; }

  // ---- start ------------------------------------------------------------------------------------------------------------------------

  /** Reads the engine version once and rebuilds the index from the .json files of the cache folder. Without a program every clip plays its source. */
  async start(): Promise<void> {
    const prog = this.o.programm;
    this.maschine = null;
    if (!prog.includes('/') || fs.existsSync(prog)) {
      const e = await this.kind([prog, 'version'], 1, this.o.versionFristMs ?? VERSION_MS);
      const z = e.zeile;
      if (e.rc === 0 && z && z.status === 'ok' && zeilePruefung(z) === null && typeof z.maschine === 'string') this.maschine = z.maschine;
      else this.ctx.log({ typ: 'noten_render_programm', rc: e.rc, fehl: e.fehl });
    }
    this.indexAufbauen();
    const offen = this.zugang.offen();
    if (offen) this.beiStand(offen.projekt);
  }

  private indexAufbauen(): void {
    this.index.clear();
    let namen: string[] = [];
    try { namen = fs.readdirSync(this.notenOrdner()); } catch { return; }
    for (const n of namen) {
      if (!/^[0-9a-f]{64}\.json$/.test(n)) continue;                        // the sidecars of the curves are <sha>.<curve id>.json
      const key = n.slice(0, 64);
      let x: Partial<CacheEintrag>;
      try { x = JSON.parse(fs.readFileSync(path.join(this.notenOrdner(), n), 'utf8')); } catch { continue; }
      if (!x || typeof x !== 'object' || x.schluessel !== key || typeof x.slug !== 'string' || typeof x.clip_id !== 'string' || !HEX64.test(String(x.quelle))
        || typeof x.kurve !== 'string' || typeof x.maschine !== 'string' || !Array.isArray(x.liste) || typeof x.bytes !== 'number'
          || typeof x.zeit !== 'number') continue;
      if (groesse(this.renderDatei(key)) !== x.bytes) continue;             // the file is gone or not whole
      const e = x as CacheEintrag;
      this.index.set(key, e);
      const k = NotenRender.ck(e.slug, e.clip_id);
      const l = this.letzte.get(k);
      if (e.maschine === this.maschine && (!l || e.zeit > l.zeit)) this.letzte.set(k, e);
    }
  }

  // ---- the answer of the translation ------------------------------------------------------------------------------------------------

  beginne(live: boolean): void {
    if (live) this.gegeben = new Map();
    else this.exportLuecke = false;
  }

  datei(c: AudioClip, live = false): { sha256: string; datei: string } | null {
    const slug = this.zugang.offen()?.slug;
    if (!slug) return null;
    const r = this.pruefeClip(c, slug);
    if (live) this.gegeben.set(NotenRender.ck(slug, c.id), r ? r.datei : null);
    else if (!this.letzteExakt) this.exportLuecke = true;
    return r;
  }

  exakt(): boolean { return !this.exportLuecke; }

  fehlerGrund(): string | null {
    const o = this.zugang.offen();
    if (!o) return null;
    for (const c of alleAudioClips(o.projekt)) {
      const z = this.zustaende.get(NotenRender.ck(o.slug, c.id));
      if (z?.zustand === 'fehler' && z.grund) return z.grund;
    }
    return null;
  }

  zustand(clipId: string): RenderZustand {
    const slug = this.zugang.offen()?.slug;
    const z = slug ? this.zustaende.get(NotenRender.ck(slug, clipId)) : undefined;
    return z ? { ...z } : { zustand: 'quelle' };
  }

  // What a clip plays now, its state, and the job it needs (queued once). The only place that decides.
  private pruefeClip(c: AudioClip, slug: string): { sha256: string; datei: string } | null {
    const ck = NotenRender.ck(slug, c.id);
    const f = c.audio_noten;
    this.letzteExakt = true;
    if (!f || !hatZiele(f.liste)) { this.zuletzt.delete(ck); this.setze(slug, c.id, { zustand: 'quelle' }); return null; }
    this.letzteExakt = false;
    if (this.maschine === null) {
      this.setze(slug, c.id, { zustand: 'fehler', grund: 'noten_programm_fehlt', text: 'cypherdj-noten is not built or not installed' });
      return null;
    }
    const quellBytes = groesse(this.quellDatei(c.quelle.sha256));
    // not decoded: nothing to render from, nothing to play
    if (quellBytes === null) { this.letzteExakt = true; this.setze(slug, c.id, { zustand: 'quelle' }); return null; }
    const key = renderSchluessel(c.quelle.sha256, f.kurve, this.maschine, f.liste);
    if (this.dateiOk(key, quellBytes)) {
      this.letzteExakt = true;
      this.zuletzt.set(ck, key);
      const sekunden = this.rechenzeit.get(key);
      const messung = this.messungen.get(key);
      this.setze(slug, c.id, { zustand: 'bereit', schluessel: key, ...(sekunden !== undefined ? { sekunden } : {}), ...(messung ? { messung } : {}) });
      return { sha256: key, datei: this.renderDatei(key) };
    }
    const fehl = this.gescheitert.get(key);
    // a failed key: on the first stand after the failure that still needs it, one more try; after the second failure it stays failed
    if (fehl && !this.imJob(key) && !(this.imStand && fehl.n < 2 && this.standNr > fehl.stand)) {
      this.setze(slug, c.id, { zustand: 'fehler', schluessel: key, grund: fehl.f.grund, text: fehl.f.text });
      this.zuletzt.delete(ck);
      return null;
    }
    this.einreihen(slug, c, key);
    const l = this.letzte.get(ck);
    if (l && l.quelle === c.quelle.sha256 && l.kurve === f.kurve && this.dateiOk(l.schluessel, quellBytes)) {
      this.zuletzt.set(ck, l.schluessel);
      this.setze(slug, c.id, { zustand: 'alt', schluessel: key });
      return { sha256: l.schluessel, datei: this.renderDatei(l.schluessel) };
    }
    this.zuletzt.delete(ck);
    this.setze(slug, c.id, { zustand: 'rechnet', schluessel: key });
    return null;
  }

  // the state of a clip; SSE only when it changed
  private setze(slug: string, clipId: string, z: RenderZustand): void {
    const ck = NotenRender.ck(slug, clipId);
    const vor = this.zustaende.get(ck) ?? { zustand: 'quelle' };
    if (JSON.stringify(vor) === JSON.stringify(z)) return;
    if (z.zustand === 'quelle') this.zustaende.delete(ck); else this.zustaende.set(ck, z);
    this.ctx.verteile({ a: 'proj', f: { noten_render: { slug, clip_id: clipId, ...z } } });
  }

  // ---- the stand ------------------------------------------------------------------------------------------------------------------

  /** After every assignment of the open project: queue what is missing, and load the live playback again when a clip plays another file than the last
   *  live translation gave it (once per stand, however many clips changed) */
  beiStand(p: Projekt): void {
    this.stand = p;
    const slug = this.zugang.offen()?.slug;
    if (!slug) return;
    let neu = false;
    const da = new Set<string>();
    this.standNr++;
    this.imStand = true;
    try {
      for (const c of alleAudioClips(p)) {
        const ck = NotenRender.ck(slug, c.id);
        da.add(ck);
        const vorher = this.gegeben.get(ck);                                 // undefined: the last live translation did not ask this clip (or none ran yet)
        const r = this.pruefeClip(c, slug);
        if (vorher !== undefined && vorher !== (r ? r.datei : null)) neu = true;
      }
    } finally { this.imStand = false; }
    const praefix = `${slug}\0`;
    for (const ck of [...this.zustaende.keys(), ...this.gegeben.keys(), ...this.zuletzt.keys()]) {
      if (ck.startsWith(praefix) && !da.has(ck)) { this.zustaende.delete(ck); this.gegeben.delete(ck); this.zuletzt.delete(ck); }
    }
    if (neu) this.laden();
  }

  private laden(): void {
    Promise.resolve().then(() => this.o.neuLaden()).catch((e) => this.ctx.log({ typ: 'noten_render_neu_laden_fehler',
      fehler: (e as Error)?.message ?? String(e) }));
  }

  // ---- queue and worker ---------------------------------------------------------------------------------------------------------

  // a job with this key is running or queued
  private imJob(key: string): boolean {
    return this.laufend?.schluessel === key || [...this.queue.values()].some((a) => a.schluessel === key);
  }

  private einreihen(slug: string, c: AudioClip, key: string): void {
    const ck = NotenRender.ck(slug, c.id);
    if (this.laufend && NotenRender.ck(this.laufend.slug, this.laufend.clipId) === ck && this.laufend.schluessel === key) { this.queue.delete(ck); return; }
    if (this.queue.get(ck)?.schluessel === key) return;
    this.queue.set(ck, { slug, clipId: c.id, sha: c.quelle.sha256, kurve: c.audio_noten!.kurve, liste: structuredClone(c.audio_noten!.liste),
      schluessel: key });
    this.pumpe();
  }

  private pumpe(): void {
    if (this.laufend || this.geschlossen) return;
    const erste = this.queue.entries().next();
    if (erste.done) return;
    const [ck, a] = erste.value;
    this.queue.delete(ck);
    this.laufend = a;
    this.fuehreAus(a)
      .catch((e) => this.ctx.log({ typ: 'noten_render_intern', fehler: (e as Error)?.message ?? String(e) }))
      .finally(() => { this.laufend = null; this.prozess = null; this.wecke(); this.pumpe(); });
  }

  private wecke(): void { for (const w of [...this.warter]) w(); }

  private async kind(befehl: string[], omp: number, fristMs: number): Promise<NotenErgebnis> {
    if (this.geschlossen) throw new Abbruch();
    const p = new NotenLauf(befehl, { cwd: this.o.cwd, omp, ...(this.o.env ? { env: this.o.env } : {}), ...(this.o.cpus !== undefined
      ? { cpus: this.o.cpus } : {}),
      ...(this.o.spawn ? { spawn: this.o.spawn } : {}) }, () => {});
    this.prozess = p;
    let zuLang = false;
    const uhr = setTimeout(() => { zuLang = true; p.abbrechen(this.o.killMs ?? 2000); }, fristMs);   // a child that hangs must not hold the queue
    const e = await p.fertig;
    clearTimeout(uhr);
    this.prozess = null;
    if (this.geschlossen) throw new Abbruch();
    return zuLang ? { ...e, fehl: `${e.fehl}\ntimed out after ${Math.round(fristMs / 1000)} s`, zeile: null } : e;
  }
  // the result line of a finished command, checked against the contract; returns its CPU seconds
  private zeile(e: NotenErgebnis, was: string): number {
    const z = e.zeile;
    if (e.rc === 0 && z && z.status === 'ok' && zeilePruefung(z) === null) return typeof z.sekunden === 'number' ? z.sekunden : 0;
    const grund = z?.status === 'fehler' ? `${String(z.fehler)}: ${String(z.text)}`
      : e.fehl.includes('timed out after') ? e.fehl.slice(e.fehl.indexOf('timed out after')) : (e.signal ?? (e.rc === null
        ? e.fehl : `no valid result line, exit ${e.rc}`));
    throw new RenderFehler('noten_render_fehler', 'the note edit could not be rendered; the clip plays without it', `${was} failed (${grund})`);
  }

  // One job: sidecar (recomputed when it is gone), order file, `render`, the file into the cache, the entry, cleanup, the reload
  private async fuehreAus(a: Auftrag): Promise<void> {
    const tmp = path.join(this.zugang.arbeitsordner(), `noten-${this.naechsterOrdner++}`);
    try {
      const { sekunden, messung } = await this.rechne(a, tmp);
      if (this.geschlossen) return;
      this.rechenzeit.set(a.schluessel, sekunden);
      if (messung) this.messungen.set(a.schluessel, messung); else this.messungen.delete(a.schluessel);
      this.gescheitert.delete(a.schluessel);
      this.raeume();
      const c = this.frischerClip(a);
      if (c) this.pruefeClip(c, a.slug);                                     // the state of the clip at the stand it has now
      // a render of a list that was undone meanwhile stays in the cache, nothing more; a clip the live playback does not hold (muted, not decoded)
      // loads with the translation that takes it in
      if (c?.audio_noten && hatZiele(c.audio_noten.liste) && this.gegeben.has(NotenRender.ck(a.slug, a.clipId))) this.laden();
    } catch (x) {
      if (x instanceof Abbruch || this.geschlossen) return;
      const f = x instanceof RenderFehler ? x : new RenderFehler('noten_render_fehler', 'the note edit could not be rendered; the clip plays without it',
        (x as Error)?.message ?? String(x));
      this.gescheitert.set(a.schluessel, { f, stand: this.standNr, n: (this.gescheitert.get(a.schluessel)?.n ?? 0) + 1 });
      this.ctx.log({ typ: 'noten_render_fehler', clip_id: a.clipId, grund: f.grund, fehler: f.message });
      this.laufend = null;                                                   // the job is over: the state below must not count it as running
      const c = this.frischerClip(a);
      if (c) this.pruefeClip(c, a.slug);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  // the clip of a job in the open project as it is now (null: another project is open, or the clip is gone)
  private frischerClip(a: Auftrag): AudioClip | null {
    const o = this.zugang.offen();
    if (!o || o.slug !== a.slug) return null;
    for (const c of alleAudioClips(o.projekt)) if (c.id === a.clipId) return c;
    return null;
  }

  // The sidecar of the curve: the file in the cache folder when it is valid, else computed again
  private async kurve(a: Auftrag, quelle: string, frames: number, tmp: string): Promise<string> {
    const pfad = path.join(this.notenOrdner(), kurveDatei(a.sha, a.kurve));
    if (leseKurve(pfad, a.sha, frames, a.kurve)) return pfad;
    const gone = (text: string): RenderFehler => new RenderFehler('noten_kurve_fehlt',
      'the pitch curve of this clip is gone and cannot be recomputed here; detect the notes again', text);
    const prog = this.o.programm;
    const aus = path.join(tmp, 'kurve.json');
    const limit = notenZeitlimitMs(frames);                                 // the limit of the detection job for this length
    if (a.kurve === CURVE_ID) {
      this.zeile(await this.kind([prog, 'analyse', quelle, aus], 1, limit), 'the analysis');
    } else if (a.kurve.endsWith(`.${SEGMENTIERER_VERSION}`) && a.kurve.startsWith('netz-')) {
      if (!this.o.netz) throw gone(`curve ${a.kurve}: there is no network runtime`);
      const roh = path.join(tmp, 'roh.json');
      const n = await this.kind([...this.o.netz, '--quelle', quelle, '--aus', roh], 2, limit);
      if (n.rc !== 0 || n.zeile?.status !== 'ok') throw gone(`the network detector failed (${String(n.zeile?.grund ?? n.signal ?? `exit ${n.rc}`)})`);
      this.zeile(await this.kind([prog, 'segment', quelle, roh, aus], 1, limit), 'the segmentation');
    } else {
      throw gone(`curve ${a.kurve}: this build does not know the detector`);
    }
    if (!leseKurve(aus, a.sha, frames, a.kurve)) throw gone(`the recomputed curve is not ${a.kurve}`);
    fs.mkdirSync(path.dirname(pfad), { recursive: true });
    fs.renameSync(aus, pfad);
    return pfad;
  }

  // returns the CPU seconds of the `render` call and its `messung` (null when the engine gave none)
  private async rechne(a: Auftrag, tmp: string): Promise<{ sekunden: number; messung: NotenMessung[] | null }> {
    const quelle = this.quellDatei(a.sha);
    const bytes = groesse(quelle);
    if (bytes === null) throw new RenderFehler('noten_render_fehler', 'the note edit could not be rendered; the clip plays without it',
      'the decoded source is missing');
    fs.mkdirSync(tmp, { recursive: true });
    const kurve = await this.kurve(a, quelle, bytes / 8, tmp);
    const auftrag = path.join(tmp, 'auftrag.json');
    fs.writeFileSync(auftrag, `${JSON.stringify({ format: AUFTRAG_FORMAT, kurve: a.kurve, liste: a.liste })}\n`);
    const aus = path.join(tmp, 'aus.f32');
    // incremental when the last finished render of the clip is for the same source, curve and engine and only some targets differ
    const l = this.letzte.get(NotenRender.ck(a.slug, a.clipId));
    const nur = l && l.quelle === a.sha && l.kurve === a.kurve && l.maschine === this.maschine && this.dateiOk(l.schluessel, bytes) ? geaenderteIds(l.liste,
      a.liste) : null;
    // --vorher-liste: the list the earlier render was made from, so the engine also clears where a moved note was before
    const vorherListe = path.join(tmp, 'vorher_auftrag.json');
    if (l && nur && nur.length > 0) fs.writeFileSync(vorherListe, `${JSON.stringify({ format: AUFTRAG_FORMAT, kurve: l.kurve, liste: l.liste })}\n`);
    const zusatz = l && nur && nur.length > 0 ? ['--vorher', this.renderDatei(l.schluessel), '--nur', nur.join(','), '--vorher-liste', vorherListe] : [];
    const e = await this.kind([this.o.programm, 'render', quelle, kurve, auftrag, aus, ...zusatz], 1, this.o.renderFristMs ?? Math.max(30_000,
      4 * Math.round(bytes / 8 / NOTEN_SR * 1000)));
    const sekunden = this.zeile(e, 'the render');
    const messung = Array.isArray(e.zeile?.messung) ? (e.zeile.messung as NotenMessung[]) : null;   // the line passed zeilePruefung in zeile()
    if (groesse(aus) !== bytes) throw new RenderFehler('noten_render_fehler', 'the note edit could not be rendered; the clip plays without it',
      'the render wrote a file of another size than the source');
    fs.mkdirSync(this.notenOrdner(), { recursive: true });
    fs.renameSync(aus, this.renderDatei(a.schluessel));
    const eintrag: CacheEintrag = { schluessel: a.schluessel, slug: a.slug, clip_id: a.clipId, quelle: a.sha, kurve: a.kurve, maschine: this.maschine!,
      liste: a.liste, bytes, zeit: Date.now() };
    const json = path.join(this.notenOrdner(), `${a.schluessel}.json`);
    fs.writeFileSync(`${json}.tmp`, `${JSON.stringify(eintrag)}\n`);
    fs.renameSync(`${json}.tmp`, json);
    this.index.set(a.schluessel, eintrag);
    this.letzte.set(NotenRender.ck(a.slug, a.clipId), eintrag);
    return { sekunden, messung };
  }

  // ---- cleanup ------------------------------------------------------------------------------------------------------------------

  private raeume(): void {
    const benutzt = new Set<string>([...this.zuletzt.values(), ...[...this.letzte.values()].map((e) => e.schluessel),
      ...[...this.queue.values()].map((a) => a.schluessel)]);
    if (this.laufend) benutzt.add(this.laufend.schluessel);
    const p = this.stand ?? this.zugang.offen()?.projekt;
    if (p && this.maschine !== null) {
      for (const c of alleAudioClips(p)) if (c.audio_noten && hatZiele(c.audio_noten.liste)) benutzt.add(renderSchluessel(c.quelle.sha256, c.audio_noten.kurve,
        this.maschine, c.audio_noten.liste));
    }
    for (const key of raeumePlan([...this.index.values()], { proKlip: this.o.proKlip ?? PROKLIP, maxBytes: this.o.maxBytes ?? MAXBYTES, benutzt })) {
      fs.rmSync(this.renderDatei(key), { force: true });                      // the file first: an entry without a file is ignored at the next start
      fs.rmSync(path.join(this.notenOrdner(), `${key}.json`), { force: true });
      const e = this.index.get(key);
      this.index.delete(key);
      if (e) { const k = NotenRender.ck(e.slug, e.clip_id); if (this.letzte.get(k)?.schluessel === key) this.letzte.delete(k); }
    }
  }

  // ---- the export waits ---------------------------------------------------------------------------------------------------------

  // 'ja': every clip of the open project with a target has its exact render and no job of the project is queued or running; 'nie': a render that will
  // not come (no program, a failed job); 'warte': a job is on its way
  private bereitStand(): 'ja' | 'nie' | 'warte' {
    const o = this.zugang.offen();
    if (!o) return 'ja';
    let warte = false;
    for (const c of alleAudioClips(o.projekt)) {
      const f = c.audio_noten;
      if (!f || !hatZiele(f.liste)) continue;
      if (this.maschine === null) return 'nie';
      const bytes = groesse(this.quellDatei(c.quelle.sha256));
      if (bytes === null) continue;                                          // not decoded: the clip is silent anyway
      const key = renderSchluessel(c.quelle.sha256, f.kurve, this.maschine, f.liste);
      if (this.dateiOk(key, bytes)) continue;
      if (this.gescheitert.has(key) && !this.imJob(key)) return 'nie';
      this.pruefeClip(c, o.slug);                                            // queued when nobody asked yet
      warte = true;
    }
    if (this.laufend?.slug === o.slug || [...this.queue.values()].some((a) => a.slug === o.slug)) warte = true;
    return warte ? 'warte' : 'ja';
  }

  /** true when no job of the open project is queued or running and every clip with a target has its exact file; false at the deadline, or at once when
   *  a render cannot come (no program, a failed job). No polling: every end of a job wakes it. */
  async bereit(fristMs: number): Promise<boolean> {
    const ende = Date.now() + fristMs;
    for (;;) {
      const s = this.bereitStand();
      if (s === 'ja') return true;
      if (s === 'nie' || this.geschlossen) return false;
      const rest = ende - Date.now();
      if (rest <= 0) return false;
      await new Promise<void>((ok) => {
        const fertig = (): void => { clearTimeout(uhr); this.warter.delete(fertig); ok(); };
        const uhr = setTimeout(fertig, rest);
        this.warter.add(fertig);
      });
    }
  }

  /** Server stop: the queue is dropped, a running child is killed at once (the temp folder goes with the job) */
  schliesse(): void {
    this.geschlossen = true;
    this.queue.clear();
    this.prozess?.toete();
    this.wecke();
  }
}
