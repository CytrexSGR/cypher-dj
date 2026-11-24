// The catalogue build as one background job (browser plan 1). KatalogJob runs the existing Python builder (`python -m bibliothek bauen
// --fortschritt-json --midi-liste`) as a single child at nice 10 and keeps the progress, the last result and the first-start facts.
// One child at a time; no watcher and no polling: a debounce timer, and a request while a build runs sets exactly one follow-up run.
// HOOK POINT for later plans: `laufEnde()` (end of `lauf()`): called once when a run, with its follow-up builds, is over. Plan 7 task 12 adds its
// `nachLetztemBau` call there; the analysis phase (plan 1 task 8) is a step inside `lauf()` before it, and `laufEnde()` runs after it.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type Phase = 'ruht' | 'scan' | 'merkmale' | 'schreiben' | 'analyse';
export interface LetzterBau { zeit: string; dateien: number; rc: number; grund?: string }
export interface Stand { phase: Phase; fertig: number; gesamt: number | null; letzter_bau: LetzterBau | null; fremd: boolean; leer: boolean; hinweis?: string; analyse_grund?: string }
export interface KatalogJobOptionen {
  python: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  entprellMs?: number;
  /** Wall-clock limit of one analysis child (default 10 min) and the most files it is given per run (default 300); the next run takes the rest. */
  analyseFristMs?: number;
  analyseMax?: number;
  /** The storage folder `importe` (browser plan 1): the one source the page registers by itself; `leer` ignores it. */
  importeOrdner?: () => string;
  /** Test seam: starts the builder command (args after `python -m bibliothek`); the default runs the real one and lowers its priority to `nice`. */
  befehl?: (args: string[], nice: number) => ChildProcess;
  /** Plan 7 task 12: called once when a run is over and its LAST build succeeded (after the analysis follow-up build when there was one). */
  nachLetztemBau?: () => void;
}
/** What `zeige --json` says, as far as this job reads it. */
export interface Zeige {
  datei?: string; ziel?: string; zustand?: string; zaehlung?: unknown;
  wurzeln?: { pfad: string; typ: string; fehlt?: boolean }[];
  baum_marke_gespeichert?: string | null; baum_marke_jetzt?: string;
}

/** A failure of a source command, answered as `{ ok: false, grund, fehler, text, detail? }` by the route. */
export class KatalogFehler extends Error {
  readonly code: number; readonly grund: string; readonly detail?: string;
  constructor(code: number, grund: string, detail?: string) { super(grund); this.code = code; this.grund = grund; this.detail = detail; }
}
const TYPEN = ['auto', 'track', 'loop', 'oneshot'] as const;
export type QuellenTyp = typeof TYPEN[number];
export const istQuellenTyp = (t: unknown): t is QuellenTyp => typeof t === 'string' && (TYPEN as readonly string[]).includes(t);
const echt = (p: string): string => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

const ENTPRELL_STANDARD_MS = 3000;
const SCHLIESS_FRIST_MS = 2000;
const ZEIGE_FRIST_MS = 20_000;
const ZEIGE_ALTER_MS = 10_000;
const MIDI_HINWEIS = 'only MIDI files so far, no audio to catalogue';
export const BAU_ARGS = ['bauen', '--fortschritt-json', '--midi-liste'];

export class KatalogJob {
  protected readonly o: KatalogJobOptionen;
  private phase: Phase = 'ruht';
  private fertig = 0;
  private gesamt: number | null = null;
  private letzter: LetzterBau | null = null;
  private analyseGrund: string | null = null;
  private kind: ChildProcess | null = null;
  private laeuft = false;
  private nachlauf = false;
  private letzterOk = false;   // the last build of the run exited 0
  private timer: NodeJS.Timeout | null = null;
  private zu = false;
  private zeigeCache: { schluessel: string; zeit: number; z: Zeige | null } | null = null;
  private zeigeVersion = 0;
  private zeigeUnterwegs: { version: number; p: Promise<Zeige | null> } | null = null;
  private fertigWarten: Array<() => void> = [];

  constructor(o: KatalogJobOptionen) { this.o = o; }

  private get env(): NodeJS.ProcessEnv { return { ...process.env, ...(this.o.env ?? {}) }; }

  /** The child of the running build (tests read its priority). */
  pid(): number | undefined { return this.kind?.pid; }

  private starteKind(args: string[], nice: number): ChildProcess {
    if (this.o.befehl) return this.o.befehl(args, nice);
    const k = spawn(this.o.python, ['-m', 'bibliothek', ...args], { cwd: this.o.cwd, env: this.env, stdio: ['ignore', 'pipe', 'pipe'] });
    try { if (k.pid !== undefined) os.setPriority(k.pid, nice); } catch { /* the priority is a courtesy */ }
    return k;
  }

  /** Starts a build now, or joins the running one. Never a second process. */
  starte(): { laeuft: true } {
    if (this.zu) return { laeuft: true };
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.laeuft) return { laeuft: true };
    this.laeuft = true;
    void this.lauf();
    return { laeuft: true };
  }

  /** A debounced start request (default 3000 ms). During a build it sets exactly one follow-up run. */
  anstoss(_grund: string): void {
    if (this.zu) return;
    if (this.laeuft) { this.nachlauf = true; return; }
    if (this.timer) return;   // a start is already waiting; the burst gives one build
    this.timer = setTimeout(() => { this.timer = null; this.starte(); }, this.o.entprellMs ?? ENTPRELL_STANDARD_MS);
    this.timer.unref?.();
  }

  private async lauf(): Promise<void> {
    this.letzterOk = false;
    try {
      do {
        this.nachlauf = false;
        const rc = await this.bau();
        this.letzterOk = rc === 0;
        // analysis phase (task 8): only after a build that succeeded; when it found values, exactly one more build carries them into the
        // catalogue, and no analysis follows that one (the tried marker would make it find nothing anyway)
        if (rc === 0 && !this.zu && (await this.analyse()) > 0 && !this.zu) this.letzterOk = (await this.bau()) === 0;
      } while (this.nachlauf && !this.zu);
    } finally {
      this.phase = 'ruht';
      this.laeuft = false;
      this.zeigeCache = null;
      this.laufEnde();
      for (const w of this.fertigWarten.splice(0)) w();
    }
  }

  /** HOOK POINT: a run (build, analysis, follow-up builds) is over and the state is back at `ruht`. Plan 7: the tags hook, only after a good last build. */
  protected laufEnde(): void {
    if (!this.letzterOk || this.zu) return;
    try { this.o.nachLetztemBau?.(); } catch { /* the hook is a courtesy */ }
  }

  /** Resolves when no run is active (tests and `schliesse`). */
  ruht(): Promise<void> { return this.laeuft ? new Promise((ok) => { this.fertigWarten.push(ok); }) : Promise.resolve(); }

  /** Runs one builder command as the one child; progress lines move phase/fertig/gesamt, the last plain stderr line is the candidate reason. */
  private kindLaufen(args: string[], nice: number, fristMs?: number): Promise<{ rc: number; grund?: string; letzteStdout: string }> {
    return new Promise((fertig) => {
      let k: ChildProcess;
      let plain = '', letzteStdout = '';
      let frist: NodeJS.Timeout | null = null, abgelaufen = false;
      const ende = (rc: number, grund?: string): void => { if (frist) clearTimeout(frist); this.kind = null; fertig({ rc, ...(grund ? { grund } : {}), letzteStdout }); };
      try { k = this.starteKind(args, nice); } catch (e) { return ende(-1, `the build could not be started: ${(e as Error).message}`); }
      this.kind = k;
      if (fristMs !== undefined) frist = setTimeout(() => { abgelaufen = true; try { k.kill('SIGKILL'); } catch { /* gone */ } }, fristMs);
      let fehlRest = '', ausRest = '';
      const zeile = (z: string): void => {
        if (z.startsWith('{')) {
          try {
            const j = JSON.parse(z) as { phase?: unknown; fertig?: unknown; gesamt?: unknown };
            if (typeof j.phase === 'string') {
              this.phase = j.phase as Phase;
              this.fertig = typeof j.fertig === 'number' ? j.fertig : this.fertig;
              this.gesamt = typeof j.gesamt === 'number' ? j.gesamt : null;
              return;
            }
          } catch { /* not a progress line: keep it as text */ }
        }
        if (z.trim() !== '') plain = z.trim();
      };
      k.stderr?.on('data', (d: Buffer) => { fehlRest += d; const t = fehlRest.split('\n'); fehlRest = t.pop() ?? ''; t.forEach(zeile); });
      k.stdout?.on('data', (d: Buffer) => { ausRest += d; const t = ausRest.split('\n'); ausRest = t.pop() ?? ''; for (const z of t) if (z.trim() !== '') letzteStdout = z; });
      let erledigt = false;
      k.on('error', (e: Error) => { if (erledigt) return; erledigt = true; ende(-1, `the build could not be started: ${e.message}`); });
      k.on('close', (rc: number | null, signal: string | null) => {
        if (erledigt) return;
        erledigt = true;
        if (fehlRest) zeile(fehlRest);
        if (ausRest.trim() !== '') letzteStdout = ausRest.trim();
        if (rc === 0) return ende(0);
        if (abgelaufen) return ende(rc ?? -1, `stopped: the time limit of ${Math.round((fristMs ?? 0) / 1000)} s ran out`);
        ende(rc ?? -1, signal ? `the build was stopped by ${signal}` : plain !== '' ? plain : 'the build failed');
      });
    });
  }

  /** One build; sets `letzter_bau` and returns its exit code. */
  private async bau(): Promise<number> {
    this.phase = 'scan'; this.fertig = 0; this.gesamt = null;
    const r = await this.kindLaufen(BAU_ARGS, 10);
    let dateien = 0;
    if (r.rc === 0) { try { dateien = Number((JSON.parse(r.letzteStdout) as { dateien?: unknown }).dateien) || 0; } catch { /* no summary line */ } }
    this.letzter = { zeit: new Date().toISOString(), dateien, rc: r.rc, ...(r.grund ? { grund: r.grund } : {}) };
    return r.rc;
  }

  /** The analysis of the folders the page registered (scope file) at nice 19; returns how many files got a value. `letzter_bau` is not touched. */
  private async analyse(): Promise<number> {
    const pfade = await this.scopePfade();
    if (pfade.length === 0) return 0;
    this.phase = 'analyse'; this.fertig = 0; this.gesamt = null; this.analyseGrund = null;
    const r = await this.kindLaufen(['analysieren', ...pfade.flatMap((p) => ['--unter', p]), '--max', String(this.o.analyseMax ?? 300), '--fortschritt-json'], 19, this.o.analyseFristMs ?? 600_000);
    if (r.rc !== 0) { this.analyseGrund = r.grund ?? 'the analysis failed'; return 0; }
    try { return Number((JSON.parse(r.letzteStdout) as { mit_wert?: unknown }).mit_wert) || 0; } catch { return 0; }
  }

  private async scopePfade(): Promise<string[]> {
    const datei = await this.scopeDatei();
    if (!datei) return [];
    try {
      const j = JSON.parse(fs.readFileSync(datei, 'utf8')) as { pfade?: unknown };
      return Array.isArray(j.pfade) ? j.pfade.filter((x): x is string => typeof x === 'string' && x !== '') : [];
    } catch { return []; }
  }

  // ---- the command line for reads (zeige) ----
  /** Runs `python -m bibliothek <args>` and resolves with stdout; rejects with the plain message. Not niced: reads only. */
  protected lies(args: string[]): Promise<string> {
    return new Promise((ok, nein) => {
      let aus = '', fehl = '';
      let k: ChildProcess;
      try { k = spawn(this.o.python, ['-m', 'bibliothek', ...args], { cwd: this.o.cwd, env: this.env, stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (e) { return nein(e); }
      const uhr = setTimeout(() => k.kill('SIGKILL'), ZEIGE_FRIST_MS);
      k.stdout?.on('data', (d) => { aus += d; });
      k.stderr?.on('data', (d) => { fehl += d; });
      k.on('error', (e) => { clearTimeout(uhr); nein(e); });
      k.on('close', (rc) => { clearTimeout(uhr); rc === 0 ? ok(aus) : nein(new Error(fehl.trim() || `exit ${rc}`)); });
    });
  }

  /** `zeige --json`, cached per catalogue file (mtime and size), per source change and for at most 10 s. null when it cannot be read. */
  async zeige(frisch = false): Promise<Zeige | null> {
    const jetzt = Date.now();
    const c = this.zeigeCache;
    if (!frisch && c && jetzt - c.zeit < ZEIGE_ALTER_MS && c.schluessel === this.schluessel(c.z?.ziel)) return c.z;
    // calls that arrive while a read is under way share it (six page polls at once are one process); a fresh read never joins an older one
    if (!frisch && this.zeigeUnterwegs && this.zeigeUnterwegs.version === this.zeigeVersion) return this.zeigeUnterwegs.p;
    const version = this.zeigeVersion;
    const p = (async (): Promise<Zeige | null> => {
      let z: Zeige | null = null;
      try { z = JSON.parse(await this.lies(['zeige', '--json'])) as Zeige; } catch { z = null; }
      if (version === this.zeigeVersion) this.zeigeCache = { schluessel: this.schluessel(z?.ziel), zeit: jetzt, z };
      return z;
    })();
    this.zeigeUnterwegs = { version, p };
    try { return await p; } finally { if (this.zeigeUnterwegs?.p === p) this.zeigeUnterwegs = null; }
  }
  private schluessel(ziel?: string): string {
    let s = `v${this.zeigeVersion}`;
    if (ziel) { try { const st = fs.statSync(ziel); s += `:${st.mtimeMs}:${st.size}`; } catch { s += ':none'; } }
    return s;
  }
  /** The sources or the catalogue changed from outside this class (a source added or removed): the next stand() reads afresh. */
  verwerfeZeige(): void { this.zeigeVersion++; this.zeigeCache = null; }

  /** The MIDI sidecar `<catalogue>.midi.json` (written by `bauen --midi-liste`); an empty list when absent or unreadable. */
  async midiListe(ziel?: string): Promise<{ pfad: string; name: string; groesse: number }[]> {
    const z = ziel ?? (await this.zeige())?.ziel;
    if (!z) return [];
    try {
      const j = JSON.parse(fs.readFileSync(`${z}.midi.json`, 'utf8')) as { dateien?: { pfad: string; name: string; groesse: number }[] };
      return Array.isArray(j.dateien) ? j.dateien : [];
    } catch { return []; }
  }

  async stand(): Promise<Stand & { katalog: { track: number; loop: number; oneshot: number } | null }> {
    const z = await this.zeige();
    const fremd = z?.zustand === 'foreign';   // only the catalogue's own marker: an exit 3 from a lost race (before the build lock) is not proof
    let katalog: { track: number; loop: number; oneshot: number } | null = null;
    if (z?.zustand === 'own' || z?.zustand === 'foreign') {
      const roh = z.zaehlung as Record<string, unknown> | null;
      const zeilen = (roh && typeof roh.zeilen === 'object' && roh.zeilen !== null ? roh.zeilen : roh) as Record<string, unknown> | null;
      if (zeilen) katalog = { track: Number(zeilen.track) || 0, loop: Number(zeilen.loop) || 0, oneshot: Number(zeilen.oneshot) || 0 };
    }
    const zeilenZahl = katalog ? katalog.track + katalog.loop + katalog.oneshot : 0;
    const eigene = this.o.importeOrdner ? echt(this.o.importeOrdner()) : null;
    const andere = (z?.wurzeln ?? []).filter((w) => eigene === null || echt(w.pfad) !== eigene);
    const leer = !fremd && zeilenZahl === 0 && andere.length === 0;   // data side of the first-start card
    let hinweis: string | undefined;
    if (this.letzter?.rc === 0 && this.letzter.dateien === 0 && (await this.midiListe(z?.ziel)).length > 0) hinweis = MIDI_HINWEIS;
    return { phase: this.phase, fertig: this.fertig, gesamt: this.gesamt, letzter_bau: this.letzter, fremd, leer, ...(hinweis ? { hinweis } : {}), ...(this.analyseGrund ? { analyse_grund: this.analyseGrund } : {}), katalog };
  }

  // ---- sources (task 6) ----
  // `dazu` and `weg` run at once, one after the other (a chain), not after a running build: the builder reads the config once at its start and the
  // config writers replace the file as a whole, so a build in progress keeps the folders it started with and the next build sees the change.
  private kette: Promise<unknown> = Promise.resolve();
  private seriell<T>(f: () => Promise<T>): Promise<T> {
    const r = this.kette.then(f, f);
    this.kette = r.catch(() => undefined);
    return r;
  }
  private static meldung(e: unknown): string { return e instanceof Error ? e.message : String(e); }

  /** The scope file of the analysis: `analyse_quellen.json` next to the catalogue, only paths the page registered. */
  private async scopeDatei(): Promise<string | null> {
    const z = await this.zeige();
    // nothing is ever written next to a catalogue that is not ours
    return z?.ziel && z.zustand !== 'foreign' ? path.join(path.dirname(z.ziel), 'analyse_quellen.json') : null;
  }
  private async scopeAendern(pfad: string, dazu: boolean): Promise<void> {
    const datei = await this.scopeDatei();
    if (!datei) return;
    let pfade: string[] = [];
    try { const j = JSON.parse(fs.readFileSync(datei, 'utf8')) as { pfade?: unknown }; if (Array.isArray(j.pfade)) pfade = j.pfade.filter((x): x is string => typeof x === 'string'); } catch { /* none yet */ }
    const neu = dazu ? (pfade.includes(pfad) ? pfade : [...pfade, pfad]) : pfade.filter((x) => x !== pfad);
    if (neu.length === pfade.length && neu.every((x, i) => x === pfade[i])) return;
    fs.mkdirSync(path.dirname(datei), { recursive: true });
    const tmp = `${datei}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ schema: 1, pfade: neu }));
    fs.renameSync(tmp, datei);
  }

  /** The sources as the command line knows them: `{ datei, quellen: [{ pfad, typ, fehlt }] }`. Always read afresh. */
  async quellen(): Promise<{ datei: string; quellen: { pfad: string; typ: string; fehlt: boolean }[] }> {
    const z = await this.zeige(true);
    if (!z) throw new KatalogFehler(503, 'katalog_fehler', 'the source list could not be read');
    return { datei: z.datei ?? 'bibliothek.json', quellen: (z.wurzeln ?? []).map((w) => ({ pfad: w.pfad, typ: w.typ, fehlt: w.fehlt === true })) };
  }

  /** Adds a folder as a source (the caller checked the path), writes the scope file and asks for a debounced build. Same folder twice: one entry. */
  dazu(pfad: string, typ: QuellenTyp, scope = true): Promise<void> {
    return this.seriell(async () => {
      const z = await this.zeige(true);
      const schon = (z?.wurzeln ?? []).some((w) => echt(w.pfad) === echt(pfad));
      if (!schon) {
        try { await this.lies(['dazu', pfad, '--typ', typ]); }
        catch (e) {
          const text = KatalogJob.meldung(e).replace(/^djk-bibliothek: /, '');
          if (/overlaps the existing folder/.test(text)) throw new KatalogFehler(409, 'quelle_enthalten', text);
          throw new KatalogFehler(400, 'quelle_ungueltig', text);
        } finally { this.verwerfeZeige(); }
      }
      if (scope) await this.scopeAendern(pfad, true);
      this.anstoss('dazu');
    });
  }

  /** Removes a source; an unknown folder is 404 quelle_unbekannt. */
  weg(pfad: string): Promise<void> {
    return this.seriell(async () => {
      try { await this.lies(['weg', pfad]); }
      catch (e) {
        const text = KatalogJob.meldung(e).replace(/^djk-bibliothek: /, '');
        if (/is not a library folder/.test(text)) throw new KatalogFehler(404, 'quelle_unbekannt', text);
        throw new KatalogFehler(400, 'quelle_ungueltig', text);
      } finally { this.verwerfeZeige(); }
      this.importeErledigt = false;   // a removed importe folder is registered again by the next import
      await this.scopeAendern(pfad, false);
      if (echt(pfad) !== pfad) await this.scopeAendern(echt(pfad), false);
    });
  }

  private importeErledigt = false;
  /** Registers the `importe` folder once as a source of type auto (idempotent; called on the first accepted import, never at page start). */
  sorgeFuerImporteQuelle(ordner: string): Promise<void> {
    return this.seriell(async () => {
      if (this.importeErledigt) return;
      try { await this.dazu0(ordner); this.importeErledigt = true; }
      catch { /* covered by a bigger source already, or the command is not available: the build still runs */ }
    });
  }
  private async dazu0(ordner: string): Promise<void> {
    const z = await this.zeige(true);
    if ((z?.wurzeln ?? []).some((w) => echt(w.pfad) === echt(ordner))) { this.importeErledigt = true; }
    else { try { await this.lies(['dazu', ordner, '--typ', 'auto']); } finally { this.verwerfeZeige(); } }
    await this.scopeAendern(ordner, true);
  }

  /** At page start (the studio only): builds when sources exist, the catalogue is not foreign and the tree changed since the last build. */
  async pruefeBeiStart(): Promise<void> {
    if (this.zu) return;
    let z: Zeige;
    try { z = JSON.parse(await this.lies(['zeige', '--json', '--marke'])) as Zeige; } catch { return; }
    if ((z.wurzeln ?? []).length === 0 || z.zustand === 'foreign') return;
    if (z.baum_marke_gespeichert === z.baum_marke_jetzt) return;
    this.starte();
  }

  /** Stops a running child with SIGTERM (at most 2 s, then SIGKILL) and clears the timer. */
  async schliesse(): Promise<void> {
    this.zu = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const k = this.kind;
    if (!k || k.exitCode !== null || k.signalCode !== null) return;
    k.kill('SIGTERM');
    await new Promise<void>((ok) => {
      const frist = setTimeout(() => { k.kill('SIGKILL'); ok(); }, SCHLIESS_FRIST_MS);
      k.once('close', () => { clearTimeout(frist); ok(); });
    });
  }
}

/** The `nachImport` hook of the import service: an accepted file in the `importe` folder registers that folder and asks for one debounced build. */
export function katalogNachImport(job: KatalogJob, importeOrdner: () => string): (r: { pfad: string; art: string; eintraege?: number }) => void {
  return (r) => {
    const katalogisierbar = r.art === 'audio' || r.art === 'midi' || (r.art === 'zip' && r.eintraege !== undefined);
    const basis = importeOrdner();
    if (!katalogisierbar || !(r.pfad === basis || r.pfad.startsWith(basis.endsWith('/') ? basis : `${basis}/`))) return;
    void job.sorgeFuerImporteQuelle(basis).then(() => job.anstoss('import'), () => job.anstoss('import'));
  };
}

/** What the page server does at start (the studio only): ask the job whether the music tree changed. A test instance never builds by itself. */
export function pruefeKatalogBeiStart(job: Pick<KatalogJob, 'pruefeBeiStart'>, inst: string, log?: (e: object) => void): Promise<void> {
  if (inst !== '') return Promise.resolve();
  return job.pruefeBeiStart().catch((e: Error) => { log?.({ typ: 'katalog_start_pruefung', fehler: e.message }); });
}
