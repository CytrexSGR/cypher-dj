// The source list in the page (storage layout A4). `quellen.toml` is owned by the Python package `djk/quellen`; this class only runs its command
// line (`python3 -m quellen ... --json`, cwd `djk`) and adds what the command line does not know: whether a source is there right now (the one
// reachability check of the page, `erreichbar.ts`). The answer of the command line is kept per mtime of the file; reachability is asked at every `zeige`.
import fs from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { festerPfad } from './paths.ts';
import { lageVon, type Erreichbarkeit } from './erreichbar.ts';

export type QuellenGrund = 'kein_pfad_fuer_rechner' | 'platte' | 'ordner';
export interface QuellenWurzel { name: string; art: string; pfad: string | null; wechselplatte: boolean; katalog: boolean; regal: boolean; erreichbar: boolean; grund?: QuellenGrund }
export interface QuellenSicht { datei: string; wurzeln: QuellenWurzel[] }
interface Roh { name: string; art: string; pfad: string | null; wechselplatte: boolean; katalog: boolean; regal: boolean }

/** A refusal with the HTTP code and reason the route answers with; `text` is English and never carries foreign text. */
export class QuellenFehler extends Error {
  readonly code: number; readonly grund: string; readonly text: string; readonly detail?: string;
  constructor(code: number, grund: string, text: string, detail?: string) { super(grund); this.code = code; this.grund = grund; this.text = text; this.detail = detail; }
}

const FRIST_MS = 15_000;
const drin = (wurzel: string, p: string): boolean => p === wurzel || p.startsWith(wurzel.endsWith('/') ? wurzel : `${wurzel}/`);

export class Quellen {
  private readonly o: { python: string; cwd: string; erreichbar: Erreichbarkeit; env?: NodeJS.ProcessEnv };
  private letzte: { schluessel: string; wurzeln: Roh[] } | null = null;
  constructor(o: { python: string; cwd: string; erreichbar: Erreichbarkeit; env?: NodeJS.ProcessEnv }) { this.o = o; }

  private get env(): NodeJS.ProcessEnv { return { ...process.env, ...(this.o.env ?? {}) }; }
  private schluessel(): string {
    try { const s = fs.statSync(festerPfad('quellen')); return `${s.mtimeMs}:${s.size}`; } catch { return 'none'; }
  }

  private static lesbar(ausgabe: string): Roh[] {
    let j: { wurzeln?: Roh[] };
    try { j = JSON.parse(ausgabe) as { wurzeln?: Roh[] }; } catch { throw new QuellenFehler(500, 'quellen_fehler', 'the source list command answered something that is not JSON'); }
    return (j.wurzeln ?? []).map((w) => ({ name: w.name, art: w.art, pfad: w.pfad ?? null, wechselplatte: w.wechselplatte === true, katalog: w.katalog !== false, regal: w.regal === true }));
  }

  /** Runs the command line; resolves with its stdout. A non-zero exit becomes a QuellenFehler (exit 2: 400, 3: 409 quellen_kaputt, 4: by its text, 6: 409). */
  private lauf(args: string[]): Promise<string> {
    return new Promise((ok, nein) => {
      const k = spawn(this.o.python, ['-m', 'quellen', ...args], { cwd: this.o.cwd, env: this.env, stdio: ['ignore', 'pipe', 'pipe'] });
      let aus = '', fehl = '';
      const uhr = setTimeout(() => { k.kill('SIGKILL'); }, FRIST_MS);
      k.stdout.on('data', (d) => { aus += d; });
      k.stderr.on('data', (d) => { fehl += d; });
      k.on('error', () => { clearTimeout(uhr); nein(new QuellenFehler(503, 'python_fehlt', 'the source list command could not be started (python is missing)')); });
      k.on('close', (code) => {
        clearTimeout(uhr);
        if (code === 0) return ok(aus);
        nein(Quellen.ausCode(code, fehl.trim()));
      });
    });
  }

  private static ausCode(code: number | null, fehl: string): QuellenFehler {
    if (code === 2) return new QuellenFehler(400, 'argument_ungueltig', 'a value in the request is not allowed', fehl);
    if (code === 3) return new QuellenFehler(409, 'quellen_kaputt', 'the source list file cannot be read; fix or remove it', fehl);
    if (code === 6) return new QuellenFehler(409, 'heim_nicht_bereit', 'the home folder of the studio is missing or its disk is not mounted', fehl);
    if (code === 4) {
      if (/no root is named/.test(fehl)) return new QuellenFehler(404, 'unbekannt', 'no source folder has that name', fehl);
      if (/is used by/.test(fehl)) return new QuellenFehler(409, 'quelle_benutzt', 'a kit still uses this source folder', fehl);
      return new QuellenFehler(409, 'name_vergeben', 'a source folder with that name exists already', fehl);
    }
    return new QuellenFehler(500, 'quellen_fehler', 'the source list command failed', fehl);
  }

  private sicht(roh: Roh[]): QuellenSicht {
    return { datei: festerPfad('quellen'), wurzeln: roh.map((w) => {
      if (w.pfad === null) return { ...w, erreichbar: false, grund: 'kein_pfad_fuer_rechner' as const };
      const l = lageVon(w.pfad, this.o.erreichbar);
      return { ...w, erreichbar: l.da, ...(l.grund ? { grund: l.grund } : {}) };
    }) };
  }

  async zeige(): Promise<QuellenSicht> {
    const s = this.schluessel();
    if (this.letzte === null || this.letzte.schluessel !== s) {
      const wurzeln = Quellen.lesbar(await this.lauf(['zeige', '--json']));
      this.letzte = { schluessel: s, wurzeln };
    }
    return this.sicht(this.letzte.wurzeln);
  }

  /** Adds a root and regenerates the old shelf list (`schreibe-alt`), so the shelf sees the folder at once. */
  async dazu(e: { name: string; pfad: string; art: string; wechselplatte?: boolean; regal?: boolean }): Promise<QuellenSicht> {
    const a = ['dazu', '--name', e.name, '--pfad', e.pfad, '--art', e.art];
    if (e.wechselplatte !== undefined) a.push('--wechselplatte', e.wechselplatte ? 'ja' : 'nein');
    if (e.regal) a.push('--regal');
    await this.lauf(a);
    return this.nachAenderung();
  }

  async weg(name: string): Promise<QuellenSicht> {
    await this.lauf(['weg', '--name', name]);
    return this.nachAenderung();
  }

  private async nachAenderung(): Promise<QuellenSicht> {
    this.letzte = null;
    await this.lauf(['schreibe-alt']);
    return this.zeige();
  }

  /** Whether the path lies on a removable disk, by the last answer (longest root prefix); null when no root holds it. Reads the list once when none was read yet. */
  wechselplatte(pfad: string): boolean | null {
    const s = this.schluessel();
    if (this.letzte === null || this.letzte.schluessel !== s) {
      try {
        const aus = execFileSync(this.o.python, ['-m', 'quellen', 'zeige', '--json'], { cwd: this.o.cwd, env: this.env, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
        this.letzte = { schluessel: s, wurzeln: Quellen.lesbar(aus) };
      } catch { return this.letzte === null ? null : Quellen.platteVon(this.letzte.wurzeln, pfad); }
    }
    return Quellen.platteVon(this.letzte.wurzeln, pfad);
  }

  private static platteVon(wurzeln: readonly Roh[], pfad: string): boolean | null {
    let best: Roh | null = null;
    for (const w of wurzeln) if (w.pfad !== null && drin(w.pfad, pfad) && (best === null || w.pfad.length > (best.pfad as string).length)) best = w;
    return best === null ? null : best.wechselplatte;
  }
}
