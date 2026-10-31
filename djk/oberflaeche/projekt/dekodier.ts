// Dekodier-Cache (Spec 2.8 und 6.3): Audio wird nie im Kern dekodiert. ffmpeg wandelt die Quelle in rohes f32le, 48 kHz, STEREO verschränkt
// nach <arbeitsordner>/audio/<sha256>.f32, geschrieben als <sha>.<pid>.teil und dann umbenannt. Die Kanalzahl der Quelle fragt ffprobe:
// Mono wird ohne Pegelverlust verdoppelt (pan=stereo|c0=c0|c1=c0, L = R = Quelle; -ac 2 allein würde um 3 dB absenken), Stereo bleibt,
// mehr als zwei Kanäle mischt -ac 2. Warteschlange ohne Verdrängen
// (anders als der Wellen-Cache: dort darf ein Auftrag verdrängt werden, hier hängt ein Clip im Projekt daran), eine Dekodierung zur Zeit.
// Grenzen: Quelldauer ≤ 15 min, Datei ≤ 2 GB. Zustände je sha: nein · laeuft (angefordert, wartend oder laufend) · fertig · fehler.
// Die sha ist die Identität (Katalog); dass Quelle und sha zusammenpassen, sichert der Aufrufer (er löst den Pfad über den Katalog auf).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SAMPLERATE, type DekodiertZustand } from './modell.ts';

export class DekodierFehler extends Error {
  readonly grund: string;
  constructor(grund: string, text = '') { super(text ? `${grund}: ${text}` : grund); this.grund = grund; }
}
export interface DekodierEreignis { sha: string; zustand: DekodiertZustand; grund?: string }
export interface DekodierOptionen {
  ffmpeg?: string[];                         // Aufruf (Vorgabe ['ffmpeg']); Tests setzen einen Wrapper
  ffprobe?: string[];                        // Aufruf für die Kanalzahl (Vorgabe ['ffprobe'])
  vorsatz?: string[];                        // Vorgabe: niedrigste Priorität wie der Wellen-Cache
  bei?: (e: DekodierEreignis) => void;       // SSE: jedes Mal, wenn sich der Zustand einer sha ändert (laeuft / fertig / fehler)
  dauerGrenzeS?: number;                     // Vorgabe 900
  groesseGrenze?: number;                    // Vorgabe 2 GiB
  zeitlimitMs?: number;                      // Vorgabe 10 min (Dekodieren läuft mit nice 19 und braucht bei 15 min Quelle ~ Sekunden)
}

const SHA = /^[0-9a-f]{64}$/;
const pruefeSha = (sha: unknown): string => {
  if (typeof sha !== 'string' || !SHA.test(sha)) throw new DekodierFehler('sha_ungueltig', 'sha256: 64 Hex-Zeichen (klein) erwartet');
  return sha;
};

interface Auftrag { sha: string; quelle: string; promise: Promise<DekodiertZustand>; fertig: (z: DekodiertZustand) => void }

export class DekodierCache {
  readonly dauerGrenzeS: number;
  readonly groesseGrenze: number;
  private readonly audioOrdner: string;
  private readonly ffmpeg: string[];
  private readonly ffprobe: string[];
  private readonly vorsatz: string[];
  private readonly bei?: (e: DekodierEreignis) => void;
  private readonly zeitlimitMs: number;
  private readonly schlange: Auftrag[] = [];
  private readonly offen = new Map<string, Auftrag>();       // wartend oder laufend
  private readonly fehler = new Map<string, string>();       // sha → Grund des letzten Fehlschlags
  private lauf: Auftrag | null = null;

  constructor(arbeitsordner: string, o: DekodierOptionen = {}) {
    this.audioOrdner = path.join(arbeitsordner, 'audio');
    this.ffmpeg = o.ffmpeg ?? ['ffmpeg']; this.ffprobe = o.ffprobe ?? ['ffprobe']; this.vorsatz = o.vorsatz ?? ['nice', '-n', '19', 'ionice', '-c', '3'];
    this.bei = o.bei; this.dauerGrenzeS = o.dauerGrenzeS ?? 900; this.groesseGrenze = o.groesseGrenze ?? 2 * 1024 ** 3;
    this.zeitlimitMs = o.zeitlimitMs ?? 10 * 60_000;
    this.raeumeAuf();
  }

  // Reste eines beendeten Servers: <sha>.<pid>.teil toter PIDs. Lebende PIDs (andere Instanz, eigener Prozess) bleiben.
  private raeumeAuf(): void {
    let namen: string[];
    try { namen = fs.readdirSync(this.audioOrdner); } catch { return; }
    for (const n of namen) {
      const m = /^[0-9a-f]{64}\.(\d+)\.teil$/.exec(n);
      if (!m) continue;
      try { process.kill(Number(m[1]), 0); continue; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EPERM') continue; }
      fs.rmSync(path.join(this.audioOrdner, n), { force: true });
    }
  }

  datei(sha: string): string { return path.join(this.audioOrdner, `${pruefeSha(sha)}.f32`); }

  frames(sha: string): number | null {
    try {
      const g = fs.statSync(this.datei(sha)).size;
      return g >= 8 ? Math.floor(g / 8) : null;
    } catch (e) { if (e instanceof DekodierFehler) throw e; return null; }
  }

  zustand(sha: string): DekodiertZustand {
    if (this.offen.has(pruefeSha(sha))) return 'laeuft';
    if (this.frames(sha) !== null) return 'fertig';
    return this.fehler.has(sha) ? 'fehler' : 'nein';
  }
  fehlerGrund(sha: string): string | null { return this.fehler.get(pruefeSha(sha)) ?? null; }

  private melde(sha: string, zustand: DekodiertZustand, grund?: string): void {
    try { this.bei?.({ sha, zustand, ...(grund ? { grund } : {}) }); } catch { /* ein kaputter Zuhörer hält die Schlange nicht an */ }
  }

  // Reiht eine Dekodierung ein (oder meldet den Stand). Gibt den Zustand NACH dem Aufruf zurück: fertig, laeuft oder fehler.
  fordereAn(sha: string, quelle: string): DekodiertZustand {
    pruefeSha(sha);
    if (typeof quelle !== 'string' || quelle === '') throw new DekodierFehler('quelle_ungueltig', 'Pfad der Quelle erwartet');
    const z = this.zustand(sha);
    if (z === 'fertig' || z === 'laeuft') return z;
    this.fehler.delete(sha);
    if (!fs.existsSync(quelle)) { this.fehler.set(sha, 'quelle_fehlt'); this.melde(sha, 'fehler', 'quelle_fehlt'); return 'fehler'; }
    let fertig!: (z: DekodiertZustand) => void;
    const promise = new Promise<DekodiertZustand>((ok) => { fertig = ok; });
    const a: Auftrag = { sha, quelle, promise, fertig };
    this.offen.set(sha, a); this.schlange.push(a);
    this.melde(sha, 'laeuft');
    this.pumpe();
    return 'laeuft';
  }

  // Wartet, bis eine angeforderte sha fertig oder fehlgeschlagen ist; ohne Auftrag sofort mit dem aktuellen Zustand.
  bereit(sha: string): Promise<DekodiertZustand> {
    const a = this.offen.get(pruefeSha(sha));
    return a ? a.promise : Promise.resolve(this.zustand(sha));
  }

  private pumpe(): void {
    if (this.lauf) return;
    const a = this.schlange.shift();
    if (!a) return;
    this.lauf = a;
    // Kein Auftrag darf die Schlange anhalten: auch eine Ausnahme, die dekodiere entgegen seinem Vertrag verlässt, macht ihn zu „fehler".
    this.dekodiere(a).catch((e: unknown): DekodiertZustand => {
      const grund = `intern: ${(e as Error)?.message ?? e}`.slice(0, 120);
      this.fehler.set(a.sha, grund); this.melde(a.sha, 'fehler', grund);
      return 'fehler';
    }).then((z) => {
      this.offen.delete(a.sha);
      this.lauf = null;
      a.fertig(z);
      this.pumpe();
    });
  }

  // Läuft nie mit einer Ausnahme heraus: das Ergebnis ist fertig oder fehler (mit Grund in this.fehler).
  private async dekodiere(a: Auftrag): Promise<DekodiertZustand> {
    const ziel = this.datei(a.sha), teil = path.join(this.audioOrdner, `${a.sha}.${process.pid}.teil`);
    const scheitere = (grund: string): DekodiertZustand => { this.fehler.set(a.sha, grund); this.melde(a.sha, 'fehler', grund); return 'fehler'; };
    try {
      fs.mkdirSync(this.audioOrdner, { recursive: true });
      const kanaele = await this.kanalzahl(a.quelle);
      if (kanaele === 'zeitlimit') return scheitere('zeitlimit');
      if (kanaele === null) return scheitere('ffmpeg_fehler');
      // Mono: Pegel erhalten (pan statt -ac 2); mehr als zwei Kanäle: mischen; Stereo: nichts tun (Spec 6.3)
      const kanal = kanaele === 1 ? ['-af', 'pan=stereo|c0=c0|c1=c0'] : kanaele > 2 ? ['-ac', '2'] : [];
      // -t begrenzt die Arbeit auf Grenze + 1 s; länger als die Grenze heißt danach zu_lang. -fs stoppt bei der Größengrenze.
      const argumente = ['-nostdin', '-v', 'error', '-i', a.quelle, '-map', '0:a:0', ...kanal, '-ar', String(SAMPLERATE),
        '-t', String(this.dauerGrenzeS + 1), '-fs', String(this.groesseGrenze), '-f', 'f32le', '-y', teil];
      const [programm, ...vorArgs] = [...this.vorsatz, ...this.ffmpeg];
      const kind = spawn(programm, [...vorArgs, ...argumente], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '', abgelaufen = false;
      kind.stderr.on('data', (d) => { err = (err + d).slice(-300); });
      const limit = setTimeout(() => { abgelaufen = true; kind.kill('SIGKILL'); }, this.zeitlimitMs);
      const code = await new Promise<number | null>((ok) => { kind.once('error', () => ok(-1)); kind.once('exit', (c) => ok(c)); });
      clearTimeout(limit);
      if (abgelaufen) return scheitere('zeitlimit');
      if (code !== 0) return scheitere(`ffmpeg_fehler`);
      const g = fs.statSync(teil).size;
      if (g === 0) return scheitere('leer');
      if (g % 8 !== 0) return scheitere('format');
      if (g >= this.groesseGrenze) return scheitere('zu_gross');
      if (g / 8 > this.dauerGrenzeS * SAMPLERATE + 48) return scheitere('zu_lang');   // 1 ms Spielraum für die Rundung der Ratenwandlung
      fs.renameSync(teil, ziel);
      this.fehler.delete(a.sha);
      this.melde(a.sha, 'fertig');
      return 'fertig';
    } catch (e) {
      return scheitere(`intern: ${(e as Error).message}`.slice(0, 120));
    } finally {
      // ein Rest, den wir nicht löschen können, darf den Auftrag nicht zum Absturz machen (raeumeAuf räumt ihn beim nächsten Start)
      try { fs.rmSync(teil, { force: true }); } catch { /* bewusst still */ }
    }
  }

  // Kanalzahl des ersten Audio-Streams per ffprobe; null = nicht lesbar (kein Audio, Datei kaputt), 'zeitlimit' = ffprobe hängt.
  private async kanalzahl(quelle: string): Promise<number | 'zeitlimit' | null> {
    const [programm, ...vorArgs] = this.ffprobe;
    const kind = spawn(programm, [...vorArgs, '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', quelle],
      { stdio: ['ignore', 'pipe', 'ignore'] });
    let aus = '', abgelaufen = false;
    kind.stdout.on('data', (d) => { aus = (aus + d).slice(0, 200); });
    const limit = setTimeout(() => { abgelaufen = true; kind.kill('SIGKILL'); }, this.zeitlimitMs);
    const code = await new Promise<number | null>((ok) => { kind.once('error', () => ok(-1)); kind.once('exit', (c) => ok(c)); });
    clearTimeout(limit);
    if (abgelaufen) return 'zeitlimit';
    const n = Number(/^\s*(\d+)/.exec(aus)?.[1]);   // führende Zahl: csv hängt bei Seitendaten (ReplayGain) ein Komma an ("2,")
    return code === 0 && Number.isInteger(n) && n >= 1 ? n : null;
  }
}
