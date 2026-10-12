// Wellen für die Seite (Plan Oberfläche T2, Spec E4): Quelle auflösen, einmal rechnen (welle.py), nach Inhalt cachen.
// Schlüssel: Fassung → sha256 aus fassung.json (ändert sich mit dem Inhalt); Loop → Name + mtime + Größe von loop.f32.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LOOP_NAME } from './loops.ts';

export interface WelleQuelle { datei: string; schluessel: string; dekodieren?: boolean; dauerS?: number }
// Keine Parameter-Properties: Node 22.23 strippt nur Typen (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX, Review 2026-09-27);
// Muster wie KopieFehler in arbeitsbestand.ts:16-18.
export class WelleFehler extends Error {
  readonly code: number;
  constructor(code: number, text: string) { super(text); this.code = code; }
}

export function loopQuelle(loopOrdner: string, name: string): WelleQuelle {
  if (!LOOP_NAME.test(name)) throw new WelleFehler(400, 'unbekannter_loop');
  const datei = path.join(loopOrdner, name, 'loop.f32');
  if (!fs.existsSync(datei)) throw new WelleFehler(404, 'loop_fehlt');
  const s = fs.statSync(datei);
  return { datei, schluessel: `loop-${name}-${Math.round(s.mtimeMs)}-${s.size}` };
}

export function fassungQuelle(bestand: string, material: string, basisBpm: number, fassung: number): WelleQuelle {
  if (!/^[0-9a-f]{16}$/.test(material) || !Number.isFinite(basisBpm) || !Number.isInteger(fassung)) {
    throw new WelleFehler(400, 'unbekannte_fassung');
  }
  const ordner = path.join(bestand, material, 'fassungen', `${Math.round(basisBpm * 1000)}_r${fassung}`);
  let j: { datei?: string; sha256?: string };
  try { j = JSON.parse(fs.readFileSync(path.join(ordner, 'fassung.json'), 'utf8')); } catch { throw new WelleFehler(404, 'fassung_fehlt'); }
  const datei = path.join(ordner, j.datei ?? 'basis.f32');
  if (!fs.existsSync(datei) || !j.sha256) throw new WelleFehler(404, 'fassung_fehlt');
  return { datei, schluessel: `fassung-${j.sha256}` };
}

// Browser (Plan 2026-10-10-mediathek-browser, Task 5.2, S5-Review B1-B7): jede Audiodatei der Mediathek. ffmpeg dekodiert STREAMEND
// mono (Mittel L/R) auf 48 kHz in eine Pipe, welle.py --strom rechnet blockweise: keine Zwischendatei, Speicher konstant (Messung: 60 s, 600 s,
// 1 h gleicher RSS). Schlüssel = datei-v2-<Inhalts-sha> (v2: Eichung wie der Dateimodus; ältere datei-<sha> aus dem Probelauf bleiben ungenutzt). Die Quelle wird nur gelesen. dauerS (aus dem Katalog) bestimmt das Zeitlimit.
export function dateiQuelle(pfad: string, sha: string, dauerS?: number | null): WelleQuelle {
  if (!fs.existsSync(pfad)) throw new WelleFehler(404, 'datei_fehlt');
  return { datei: pfad, schluessel: `datei-v2-${sha}`, dekodieren: true, dauerS: dauerS ?? undefined };
}

// Cache je Instanz (S5-Review B4): Prüfinstanzen nie im Cache des Betriebs. Wie arbeitsbestandVorgabe: Instanz a bis i.
export function welleCacheVorgabe(instanz: string): string {
  if (instanz === '') return path.join(os.homedir(), '.cache', 'cypherdj', 'welle');
  if (!/^[a-i]$/.test(instanz)) throw new Error(`Instanz ${instanz}: erlaubt sind a bis i`);
  return `/dev/shm/cypherdj-${instanz}/welle`;
}

export const STROM_RATE = 48000;
// ffmpeg-Argumente der Strom-Dekodierung (ohne den Programmnamen). Genau diese gehen in die Produktion UND in den Eichtest.
// Mono als Mittel aus L und R (wie der Dateimodus; ffmpegs -ac 1 mischt +3 dB lauter), 48 kHz wie der Dateimodus: alle Bänder, Hop und Fenster gleich.
export const ffmpegArgumente = (datei: string, vor: string[] = []): string[] => ['-nostdin', '-v', 'error', ...vor, '-i', datei, '-map', '0:a:0',
  '-af', 'aformat=channel_layouts=stereo,pan=mono|c0=0.5*c0+0.5*c1', '-ar', String(STROM_RATE), '-f', 'f32le', '-'];
// 30 s + 0,1 × Dauer; ohne bekannte Dauer rechnen wir mit einer Stunde
export const zeitlimitVorgabe = (dauerS?: number): number => Math.round((30 + 0.1 * (dauerS && dauerS > 0 ? dauerS : 3600)) * 1000);

interface Auftrag {
  q: WelleQuelle; ziel: string; refs: number; laeuft: boolean; weg: boolean; prozesse: ChildProcess[];
  promise: Promise<string>; ok: (z: string) => void; fehler: (e: Error) => void;
}
export interface WelleOptionen { log?: (z: Record<string, unknown>) => void; ffmpeg?: string[]; zeitlimit?: (dauerS?: number) => number; negativMs?: number }

export class WelleCache {
  private readonly laufend = new Map<string, Promise<string>>();   // Fassungen/Loops: gleicher Schlüssel teilt sich einen Lauf
  private lauf: Auftrag | null = null;                              // Dateien: höchstens EINE Dekodierung gleichzeitig …
  private wartend: Auftrag | null = null;                           // … und höchstens EINE wartende, eine neue verdrängt sie (B2)
  private readonly negativ = new Map<string, number>();             // Schlüssel → Ablauf (ms): Zeitüberschreitungen kurz merken (B7)
  private readonly ordner: string;
  private readonly python: string;
  private readonly skript: string;
  private readonly log?: (z: Record<string, unknown>) => void;
  private readonly ffmpeg: string[];
  private readonly zeitlimit: (dauerS?: number) => number;
  private readonly negativMs: number;
  constructor(ordner: string, python: string, skript: string, log?: (z: Record<string, unknown>) => void, o: WelleOptionen = {}) {
    this.ordner = ordner; this.python = python; this.skript = skript; this.log = log ?? o.log;
    this.ffmpeg = o.ffmpeg ?? ['ffmpeg']; this.zeitlimit = o.zeitlimit ?? zeitlimitVorgabe; this.negativMs = o.negativMs ?? 10 * 60_000;
    this.raeumeAuf();
  }

  // Reste eines beendeten Servers (B3): <ziel>.<pid>.teil / .f32 toter PIDs und alte .neu. Lebende PIDs (andere Instanz) bleiben.
  private raeumeAuf(): void {
    let namen: string[];
    try { namen = fs.readdirSync(this.ordner); } catch { return; }
    for (const n of namen) {
      const m = /\.(\d+)\.(?:teil|f32)(?:\.neu)?$/.exec(n);
      const p = path.join(this.ordner, n);
      try {
        if (m) { try { process.kill(Number(m[1]), 0); continue; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EPERM') continue; } fs.rmSync(p, { force: true }); }
        else if (n.endsWith('.neu') && Date.now() - fs.statSync(p).mtimeMs > 10 * 60_000) fs.rmSync(p, { force: true });
      } catch { /* weg oder nicht lesbar: egal */ }
    }
  }

  async hole(q: WelleQuelle, signal?: AbortSignal): Promise<string> {
    const ziel = path.join(this.ordner, `${q.schluessel}.welle`);
    if (fs.existsSync(ziel)) return ziel;
    if (!q.dekodieren) {
      let p = this.laufend.get(q.schluessel);
      if (!p) {
        p = this.welle(q.datei, ziel).finally(() => this.laufend.delete(q.schluessel));
        this.laufend.set(q.schluessel, p);
      }
      return p;
    }
    const bis = this.negativ.get(q.schluessel);
    if (bis !== undefined) { if (Date.now() < bis) throw new WelleFehler(504, 'waveform timed out'); this.negativ.delete(q.schluessel); }
    if (signal?.aborted) throw new WelleFehler(499, 'abgebrochen');
    fs.mkdirSync(this.ordner, { recursive: true });
    let a = [this.lauf, this.wartend].find((x) => x?.q.schluessel === q.schluessel && !x.weg) ?? null;
    if (!a) {
      a = { q, ziel, refs: 0, laeuft: false, weg: false, prozesse: [], promise: null as unknown as Promise<string>, ok: () => {}, fehler: () => {} };
      a.promise = new Promise<string>((ok, fehler) => { a!.ok = ok; a!.fehler = fehler; });
      a.promise.catch(() => {});                                  // ein verworfener Auftrag ohne Zuhörer ist kein unbehandelter Fehler
      if (this.lauf === null) this.starte(a);
      else { if (this.wartend) this.verwirf(this.wartend, new WelleFehler(429, 'verdraengt')); this.wartend = a; }
    }
    const auftrag = a;
    auftrag.refs++;
    return new Promise<string>((ok, fehler) => {
      auftrag.promise.then(ok, fehler);
      signal?.addEventListener('abort', () => {
        fehler(new WelleFehler(499, 'abgebrochen'));
        if (--auftrag.refs <= 0) this.verwirf(auftrag, new WelleFehler(499, 'abgebrochen'));   // niemand wartet mehr: weg damit
      }, { once: true });
    });
  }

  private verwirf(a: Auftrag, e: Error): void {
    if (a.laeuft) { a.weg = true; for (const p of a.prozesse) p.kill('SIGKILL'); return; }   // die Pipeline meldet selbst
    if (this.wartend === a) this.wartend = null;
    a.fehler(e);
  }

  private starte(a: Auftrag): void {
    a.laeuft = true; this.lauf = a;
    this.dekodiere(a).then(a.ok, a.fehler).finally(() => {
      this.lauf = null;
      const n = this.wartend; this.wartend = null;
      if (n) this.starte(n);
    });
  }

  private async dekodiere(a: Auftrag): Promise<string> {
    const teil = `${a.ziel}.${process.pid}.teil`;
    const t0 = Date.now();
    const ff = spawn('nice', ['-n', '19', 'ionice', '-c', '3', ...this.ffmpeg, ...ffmpegArgumente(a.q.datei)], { stdio: ['ignore', 'pipe', 'pipe'] });
    const py = spawn('nice', ['-n', '19', this.python, this.skript, '--strom', String(STROM_RATE), teil], { stdio: ['pipe', 'ignore', 'pipe'] });
    a.prozesse = [ff, py];
    ff.stdout.pipe(py.stdin);
    py.stdin.on('error', () => {});
    let ffErr = '', pyErr = '', abgelaufen = false;
    ff.stderr.on('data', (d) => { ffErr = (ffErr + d).slice(-300); });
    py.stderr.on('data', (d) => { pyErr = (pyErr + d).slice(-300); });
    const ende = (p: ChildProcess): Promise<number | null> => new Promise((ok) => { p.once('error', () => ok(-1)); p.once('exit', (c) => ok(c)); });
    const limit = setTimeout(() => { abgelaufen = true; ff.kill('SIGKILL'); py.kill('SIGKILL'); }, this.zeitlimit(a.q.dauerS));
    try {
      const [fc, pc] = await Promise.all([ende(ff), ende(py)]);
      if (a.weg) throw new WelleFehler(499, 'abgebrochen');
      if (abgelaufen) { this.negativ.set(a.q.schluessel, Date.now() + this.negativMs); throw new WelleFehler(504, 'waveform timed out'); }
      if (fc !== 0) throw new WelleFehler(422, `ffmpeg rc ${fc}: ${ffErr}`);
      if (pc !== 0) throw new WelleFehler(500, `welle.py rc ${pc}: ${pyErr}`);
      fs.renameSync(teil, a.ziel);
      this.log?.({ typ: 'welle_gerechnet', datei: a.q.datei, ms: Date.now() - t0 });
      return a.ziel;
    } finally {
      clearTimeout(limit);
      for (const p of a.prozesse) p.kill('SIGKILL');
      fs.rmSync(teil, { force: true }); fs.rmSync(`${teil}.neu`, { force: true });
    }
  }

  private welle(datei: string, ziel: string): Promise<string> {
    fs.mkdirSync(this.ordner, { recursive: true });
    const t0 = Date.now();
    return new Promise((ok, fehler) => {
      const p = spawn(this.python, [this.skript, datei, ziel], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => { err += d; });
      p.once('error', fehler);
      p.once('exit', (c) => {
        if (c === 0) { this.log?.({ typ: 'welle_gerechnet', datei, ms: Date.now() - t0 }); ok(ziel); }
        else fehler(new WelleFehler(500, `welle.py rc ${c}: ${err.slice(-300)}`));
      });
    });
  }
}
