// Collecting sources into the project (storage layout A5). Copies, never moves: a source outside the project folder is copied
// streaming into <project>/audio/<name>-<sha8>.<ext> and the copy's sha256 must equal the clip's sha. The file work runs in child
// processes under nice 19 and ionice idle, so no source file ever sits in the page server's memory.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { aufWechselplatte } from '../erreichbar.ts';
import { alleAudioClips } from './commands.ts';
import { alleZellen, type Projekt } from './model.ts';
import { einsammelName, findeKopie, loeseQuelle } from './source_path.ts';

export { einsammelName, loeseQuelle };

export type EinsammelBericht = { kopiert: number; schon_da: number; fehlt: string[]; abweichend: string[]; bytes: number; aufgeschoben: number;
  fehlt_grund: Record<string, string> };   // fehlt_grund: sha -> source_missing | timeout | cancelled | copy_failed
export type Lauf = (cmd: string, args: string[], o?: { signal?: AbortSignal }) => Promise<{ code: number | null; stdout: string }>;

const echtLauf: Lauf = (cmd, args, o = {}) => new Promise((ok, f) => {
  const k = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'], signal: o.signal, killSignal: 'SIGKILL' });
  let aus = '';
  k.stdout.on('data', (d: Buffer) => { if (aus.length < 4096) aus += d.toString('utf8'); });
  k.once('error', f);
  k.once('close', (code) => ok({ code, stdout: aus }));
});

// media_library.ts drops ionice when it is not installed; the same here
const ionicePfad = (): boolean => (process.env.PATH ?? '').split(path.delimiter).some((d) => d !== '' && fs.existsSync(path.join(d, 'ionice')));

/** Time allowed for one file: at least 120 s, plus 1 s per MB. */
export const zeitLimitMs = (bytes: number): number => Math.max(120_000, Math.ceil(bytes / 1048576) * 1000);

// the temp files of running copies of this process, so a second run never removes them as leftovers
const aktiv = new Set<string>();
const TMP_MUSTER = /^\.q-.*\.tmp-[0-9a-f]+$/;
// a leftover is only removed when it is this old: a fresh one may be the running copy of a second process on the same project
export const RESTE_ALTER_MS = 3600_000;
function raeumeReste(ordner: string): void {
  let namen: string[];
  try { namen = fs.readdirSync(ordner); } catch { return; }
  for (const n of namen) {
    const p = path.join(ordner, n);
    if (!TMP_MUSTER.test(n) || aktiv.has(p)) continue;
    try {
      const st = fs.lstatSync(p);
      if (st.isFile() && Date.now() - st.mtimeMs > RESTE_ALTER_MS) fs.rmSync(p, { force: true });
    } catch { /* gone already */ }
  }
}

/** Copies `von` to `nach` (the caller's temp path) and returns the sha256 of the copy. Throws when cp or sha256sum fails, on `timeout` (the
 *  child is killed after zeitMs) and on `cancelled` (signal). */
export async function kopiereGeprueft(von: string, nach: string,
  o: { lauf?: Lauf; ionice?: boolean; signal?: AbortSignal; zeitMs?: number } = {}): Promise<string> {
  const lauf = o.lauf ?? echtLauf;
  const vor = ['-n', '19', ...(o.ionice ?? ionicePfad() ? ['ionice', '-c', '3'] : [])];
  const zeit = new AbortController();
  const timer = o.zeitMs !== undefined ? setTimeout(() => zeit.abort(), o.zeitMs) : null;
  const signale = [zeit.signal, ...(o.signal ? [o.signal] : [])];
  const stopp = AbortSignal.any(signale);
  // a runner that ignores the signal is left behind; its promise is dropped
  const abbruch = new Promise<never>((_ok, f) => {
    const los = (): void => f(new Error(o.signal?.aborted ? 'cancelled' : 'timeout'));
    if (stopp.aborted) los(); else stopp.addEventListener('abort', los, { once: true });
  });
  abbruch.catch(() => {});
  const rennen = <T>(p: Promise<T>): Promise<T> => Promise.race([p, abbruch]);
  try {
    const cp = await rennen(lauf('nice', [...vor, 'cp', '--', von, nach], { signal: stopp }));
    if (cp.code !== 0) throw new Error(`cp failed (${cp.code})`);
    const h = await rennen(lauf('nice', [...vor, 'sha256sum', '--', nach], { signal: stopp }));
    const m = /^([0-9a-f]{64})\b/.exec(h.stdout);
    if (h.code !== 0 || !m) throw new Error(`sha256sum failed (${h.code})`);
    return m[1];
  } catch (e) {
    if (stopp.aborted) throw new Error(o.signal?.aborted ? 'cancelled' : 'timeout');
    throw e;
  } finally { if (timer) clearTimeout(timer); }
}

const drin = (wurzel: string, p: string): boolean => p === wurzel || p.startsWith(wurzel.endsWith(path.sep) ? wurzel : wurzel + path.sep);
const echt = (p: string): string => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
// the sync runs in the thread pool: a GB takes tens of ms and must not stand still the event loop of the page
const sichere = async (p: string, verzeichnis: boolean): Promise<void> => {
  const fd = fs.openSync(p, verzeichnis ? 'r' : 'r+');
  try { await new Promise<void>((ok, f) => { fs.fsync(fd, (e) => (e ? f(e) : ok())); }); } finally { fs.closeSync(fd); }
};

export async function sammleEin(a: { projekt: Projekt; projektOrdner: string; quellPfad: (sha: string, hinweis: string) => string | null;
  nur?: (pfad: string) => boolean; frei?: () => boolean; signal?: AbortSignal; zeit?: (bytes: number) => number; lauf?: Lauf }): Promise<EinsammelBericht> {
  const b: EinsammelBericht = { kopiert: 0, schon_da: 0, fehlt: [], abweichend: [], bytes: 0, aufgeschoben: 0, fehlt_grund: {} };
  const fehlt = (sha: string, grund: string): void => { b.fehlt.push(sha); b.fehlt_grund[sha] = grund; };
  const gesehen = new Set<string>();
  const wurzel = echt(a.projektOrdner);
  const ordner = path.join(a.projektOrdner, 'audio');
  let angelegt = false, aufgeraeumt = false;
  try {
    // clip sources first, then the audio of loop deck cells (the same collecting, the same name rule)
    const quellen = [...alleAudioClips(a.projekt)].map((c) => ({ sha: c.quelle.sha256, hinweis: c.quelle.pfad_hinweis }))
      .concat([...alleZellen(a.projekt)].map((z) => ({ sha: z.sha256, hinweis: z.pfad_hinweis ?? '' })));
    for (const { sha, hinweis } of quellen) {
      if (gesehen.has(sha)) continue;
      gesehen.add(sha);
      if (a.signal?.aborted) { b.aufgeschoben += 1; continue; }
      if (findeKopie(a.projektOrdner, sha) !== null) { b.schon_da += 1; continue; }
      // while music plays the disk of a source is not touched at all (a sleeping USB disk would block the event loop for its stat)
      if (a.frei && !a.frei()) { b.aufgeschoben += 1; continue; }
      const pfad = a.quellPfad(sha, hinweis);
      if (pfad === null) { fehlt(sha, 'source_missing'); continue; }
      if (drin(wurzel, echt(pfad))) { b.schon_da += 1; continue; }
      if (a.nur && !a.nur(pfad)) continue;
      const ziel = path.join(ordner, einsammelName(pfad, sha));
      const tmp = path.join(ordner, `.q-${path.basename(ziel)}.tmp-${crypto.randomBytes(4).toString('hex')}`);
      try {
        if (!fs.existsSync(ordner)) { fs.mkdirSync(ordner, { recursive: true }); angelegt = true; }
        if (!aufgeraeumt) { raeumeReste(ordner); aufgeraeumt = true; }
        aktiv.add(tmp);
        const groesse = fs.statSync(pfad).size;
        const kopieSha = await kopiereGeprueft(pfad, tmp, { signal: a.signal, zeitMs: (a.zeit ?? zeitLimitMs)(groesse), lauf: a.lauf });
        if (kopieSha !== sha) { fs.rmSync(tmp, { force: true }); b.abweichend.push(sha); continue; }
        await sichere(tmp, false);                 // the copy is on the disk before it gets its name
        fs.renameSync(tmp, ziel);               // replaces an empty leftover of the same name
        try { await sichere(ordner, true); } catch { /* a folder cannot be synced everywhere */ }
        b.kopiert += 1; b.bytes += fs.statSync(ziel).size;
      } catch (e) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to remove */ }
        const m = (e as Error).message;
        fehlt(sha, m === 'timeout' || m === 'cancelled' ? m : 'copy_failed');
      } finally { aktiv.delete(tmp); }
    }
  } finally {
    if (angelegt) { try { fs.rmdirSync(ordner); } catch { /* not empty: it holds a copy */ } }
  }
  return b;
}

interface Auftrag { projekt: Projekt; projektOrdner: string; quellPfad: (sha: string, hinweis: string) => string | null; alles: boolean }

type EinsammlerOptionen = { wechselplatte: (pfad: string) => boolean | null; frei: () => boolean; warteMs?: number;
  zeit?: (bytes: number) => number; lauf?: Lauf; log?: (z: Record<string, unknown>) => void };

/** One job at a time in the background. A job re-checks `frei` before each file and, while it is false, waits and tries again without a limit.
 *  A file that takes longer than its limit (zeitLimitMs) is dropped as `fehlt`; schliesse() kills a running copy and removes its temp file. */
export class Einsammler {
  private readonly wartend: Auftrag[] = [];
  private laeuft: Promise<void> | null = null;
  private zu = false;
  private wecker: (() => void) | null = null;
  private readonly abbruch = new AbortController();
  private readonly warteMs: number;
  private readonly o: EinsammlerOptionen;
  constructor(o: EinsammlerOptionen) { this.o = o; this.warteMs = o.warteMs ?? 5000; }
  frei(): boolean { return this.o.frei(); }
  /** For the button: its copies end with the server and use the same limits. */
  get signal(): AbortSignal { return this.abbruch.signal; }
  get zeit(): ((bytes: number) => number) | undefined { return this.o.zeit; }
  get lauf(): Lauf | undefined { return this.o.lauf; }
  melde(a: { projekt: Projekt; projektOrdner: string; quellPfad: (sha: string, hinweis: string) => string | null; alles?: boolean }): void {
    if (this.zu || this.wartend.some((w) => w.projektOrdner === a.projektOrdner)) return;
    this.wartend.push({ projekt: structuredClone(a.projekt), projektOrdner: a.projektOrdner, quellPfad: a.quellPfad, alles: a.alles === true });
    this.laeuft ??= this.arbeite();
  }
  /** Resolves when every reported job is done. */
  async leer(): Promise<void> { while (this.laeuft) await this.laeuft; }
  /** Ends the collector: a running child is killed and its temp file removed; waits for that at most 2 s. */
  async schliesse(): Promise<void> {
    this.zu = true; this.wartend.length = 0; this.wecker?.(); this.abbruch.abort();
    const lauf = this.laeuft;
    if (lauf) await Promise.race([lauf, new Promise<void>((ok) => { setTimeout(ok, 2000).unref(); })]);
  }
  private async arbeite(): Promise<void> {
    try {
      for (let j = this.wartend.shift(); j && !this.zu; j = this.wartend.shift()) {
        try { await this.eins(j); } catch (e) { this.o.log?.({ typ: 'einsammeln_fehler', ordner: j.projektOrdner, fehler: (e as Error).message }); }
      }
    } finally { this.laeuft = null; }
  }
  private async eins(j: Auftrag): Promise<void> {
    const nur = j.alles ? undefined : (p: string): boolean => this.o.wechselplatte(p) ?? aufWechselplatte(p);
    for (;;) {
      const b = await sammleEin({ projekt: j.projekt, projektOrdner: j.projektOrdner, quellPfad: j.quellPfad, nur, frei: this.o.frei,
        signal: this.abbruch.signal, zeit: this.o.zeit, lauf: this.o.lauf });
      if (b.aufgeschoben === 0 || this.zu) return;
      await new Promise<void>((ok) => { const t = setTimeout(ok, this.warteMs); this.wecker = () => { clearTimeout(t); ok(); }; });
      this.wecker = null;
    }
  }
}
