// Wellen für die Seite (Plan Oberfläche T2, Spec E4): Quelle auflösen, einmal rechnen (welle.py), nach Inhalt cachen.
// Schlüssel: Fassung → sha256 aus fassung.json (ändert sich mit dem Inhalt); Loop → Name + mtime + Größe von loop.f32.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { LOOP_NAME } from './loops.ts';

export interface WelleQuelle { datei: string; schluessel: string }
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

export class WelleCache {
  private readonly laufend = new Map<string, Promise<string>>();
  private readonly ordner: string;
  private readonly python: string;
  private readonly skript: string;
  private readonly log?: (z: Record<string, unknown>) => void;
  constructor(ordner: string, python: string, skript: string, log?: (z: Record<string, unknown>) => void) {
    this.ordner = ordner; this.python = python; this.skript = skript; this.log = log;
  }

  async hole(q: WelleQuelle): Promise<string> {
    const ziel = path.join(this.ordner, `${q.schluessel}.welle`);
    if (fs.existsSync(ziel)) return ziel;
    let p = this.laufend.get(q.schluessel);
    if (!p) {
      p = this.rechne(q.datei, ziel).finally(() => this.laufend.delete(q.schluessel));
      this.laufend.set(q.schluessel, p);
    }
    return p;
  }

  private rechne(datei: string, ziel: string): Promise<string> {
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
