// Arbeitsbestand <arbeitsbestand>/<material_id>/fassungen/<bpm·1000>_r<n>/ (SCHNITTSTELLEN §6.4, ADR 015), 60m-Nachtrag.
// Form von Plan 36 F2 / Task 5 (docs/superpowers/plans/2026-09-23-djk-36-kiste-laden-vorhoeren.md:164, :1336 ff.) und
// Plan 31 N4, damit 36 den Schritt unverändert in den Leitstand übernehmen kann: kopiert fassung.json und die
// Audiodateien, die der Kern lädt (basis.f32, oder die vier Stems, wenn analyse_quelle = stems, §4.4), in
// <arbeitsbestand>/.kopie-<pid>-<n>; jede Audiodatei wird beim Kopieren gegen Größe (frames · 2 · 4) und sha256 aus
// fassung.json geprüft (§13.2); sichtbar wird die Fassung erst per rename des ganzen Ordners. Bei jedem Fehler wird der
// .kopie-Ordner entfernt: es bleibt keine halbe Kopie liegen. Kein Entladen und kein Löschen fertiger Fassungen.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type KopieCode = 'material_fehlt' | 'pruefung';

export class KopieFehler extends Error {
  readonly code: KopieCode;
  constructor(code: KopieCode, text: string) { super(text); this.code = code; }
}

export interface KopieErgebnis { ordner: string; kopiert: boolean; bytes: number; dauer_ms: number; mit_stems: 0 | 1 }

interface Datei { rel: string; sha256: string; frames: number }
interface FassungKopf {
  material_id: string; basis_bpm: number; fassung: number; datei: string; frames: number; sha256: string;
  analyse_quelle: string; stems: Record<string, { datei: string; sha256: string; frames: number }>;
}

const STEMS = ['drums', 'bass', 'vocals', 'other'] as const;
const PRAEFIX = '.kopie-';
let zaehler = 0;
const laufend = new Map<string, Promise<KopieErgebnis>>();

// Wie Plan 36 bestand_index.ts: 128000_r1
export function fassungsName(basis_bpm: number, fassung: number): string {
  return `${Math.round(basis_bpm * 1000)}_r${fassung}`;
}
export function fassungsOrdner(wurzel: string, material_id: string, basis_bpm: number, fassung: number): string {
  return path.join(wurzel, material_id, 'fassungen', fassungsName(basis_bpm, fassung));
}

// Vorgabe wie kern.toml (§2.1) mit Prüfinstanz (Z2, kern.toml:5 „schreibt /cypherdj/ in Pfaden zu /cypherdj-<i>/ um“)
export function arbeitsbestandVorgabe(instanz: string): string {
  const p = '/dev/shm/cypherdj/material';
  return instanz ? p.replace(/cypherdj\//g, `cypherdj-${instanz}/`) : p;
}

// Ein Dateipfad aus fassung.json bestimmt, wo gelesen und geschrieben wird: nur relativ, ohne '..', ohne leere oder
// '.'-Glieder, ohne Backslash und NUL, damit er unter dem Fassungsordner bleibt (Befund 1 der adversarialen Prüfung).
export function pruefePfad(rel: unknown, feld: string): string {
  if (typeof rel !== 'string' || rel === '' || rel.includes('\\') || rel.includes('\0') || path.isAbsolute(rel)
    || rel.split('/').some((g) => g === '' || g === '.' || g === '..')) {
    throw new KopieFehler('pruefung', `fassung.json: Pfad ${feld} = ${JSON.stringify(rel)} ist nicht relativ unter dem Fassungsordner`);
  }
  return rel;
}

function audioDateien(fj: FassungKopf): { mit_stems: 0 | 1; dateien: Datei[] } {
  if (fj.analyse_quelle === 'stems') {
    return {
      mit_stems: 1,
      dateien: STEMS.map((n) => {
        const s = fj.stems?.[n];
        if (!s) throw new KopieFehler('pruefung', `fassung.json: Stem ${n} fehlt, obwohl analyse_quelle = stems`);
        return { rel: pruefePfad(s.datei, `stems.${n}.datei`), sha256: s.sha256, frames: s.frames };
      }),
    };
  }
  return { mit_stems: 0, dateien: [{ rel: pruefePfad(fj.datei, 'datei'), sha256: fj.sha256, frames: fj.frames }] };
}

async function kopiereDatei(von: string, nach: string, soll: Datei): Promise<number> {
  const h = crypto.createHash('sha256');
  let n = 0;
  const zaehle = new Transform({
    transform(stueck: Buffer, _kodierung, weiter) { h.update(stueck); n += stueck.length; weiter(null, stueck); },
  });
  fs.mkdirSync(path.dirname(nach), { recursive: true });
  try {
    await pipeline(fs.createReadStream(von, { highWaterMark: 1 << 20 }), zaehle, fs.createWriteStream(nach));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'material_fehlt' : 'pruefung';
    throw new KopieFehler(code, `${von}: ${(e as Error).message}`);
  }
  if (n !== soll.frames * 8) throw new KopieFehler('pruefung', `${soll.rel}: ${n} Bytes statt ${soll.frames * 8} (frames · 2 · 4)`);
  const ist = h.digest('hex');
  if (ist !== soll.sha256) throw new KopieFehler('pruefung', `${soll.rel}: sha256 ${ist.slice(0, 12)}… statt ${String(soll.sha256).slice(0, 12)}…`);
  return n;
}

function liesKopf(ordner: string, material_id: string, basis_bpm: number, fassung: number): { roh: Buffer; fj: FassungKopf } {
  const datei = path.join(ordner, 'fassung.json');
  let roh: Buffer;
  try {
    roh = fs.readFileSync(datei);
  } catch {
    throw new KopieFehler('material_fehlt', `${datei} fehlt`);
  }
  let fj: FassungKopf;
  try {
    fj = JSON.parse(roh.toString('utf8')) as FassungKopf;
  } catch (e) {
    throw new KopieFehler('pruefung', `${datei}: ${(e as Error).message}`);
  }
  if (fj.material_id !== material_id || Math.abs(fj.basis_bpm - basis_bpm) > 1e-9 || fj.fassung !== fassung) {
    throw new KopieFehler('pruefung', `${datei} gehört zu ${fj.material_id}/${fassungsName(fj.basis_bpm, fj.fassung)}`);
  }
  return { roh, fj };
}

// Liegt die Fassung schon im Arbeitsbestand? Nur wenn fassung.json bytegleich ist und jede Audiodatei die volle Größe hat.
function schonDa(ziel: string, roh: Buffer, dateien: Datei[]): boolean {
  try {
    if (!fs.readFileSync(path.join(ziel, 'fassung.json')).equals(roh)) return false;
    return dateien.every((d) => fs.statSync(path.join(ziel, d.rel)).size === d.frames * 8);
  } catch {
    return false;
  }
}

async function kopiere(bestand: string, arbeitsbestand: string, material_id: string, basis_bpm: number,
  fassung: number): Promise<KopieErgebnis> {
  const t0 = process.hrtime.bigint();
  const quelle = fassungsOrdner(bestand, material_id, basis_bpm, fassung);
  const ziel = fassungsOrdner(arbeitsbestand, material_id, basis_bpm, fassung);
  const { roh, fj } = liesKopf(quelle, material_id, basis_bpm, fassung);
  const { mit_stems, dateien } = audioDateien(fj);
  const ms = () => Number((process.hrtime.bigint() - t0) / 1000000n);
  if (fs.existsSync(ziel)) {
    if (schonDa(ziel, roh, dateien)) return { ordner: ziel, kopiert: false, bytes: 0, dauer_ms: ms(), mit_stems };
    throw new KopieFehler('pruefung', `${ziel} liegt schon da, aber anders als ${quelle}`);
  }
  fs.mkdirSync(arbeitsbestand, { recursive: true });
  const tmp = path.join(arbeitsbestand, `${PRAEFIX}${process.pid}-${++zaehler}`);
  fs.mkdirSync(tmp);
  let bytes = 0;
  try {
    fs.writeFileSync(path.join(tmp, 'fassung.json'), roh);
    for (const d of dateien) bytes += await kopiereDatei(path.join(quelle, d.rel), path.join(tmp, d.rel), d);
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.renameSync(tmp, ziel);
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (e instanceof KopieFehler) throw e;
    if (fs.existsSync(ziel) && schonDa(ziel, roh, dateien)) return { ordner: ziel, kopiert: false, bytes: 0, dauer_ms: ms(), mit_stems };
    throw new KopieFehler('pruefung', `Kopie nach ${ziel}: ${(e as Error).message}`);
  }
  return { ordner: ziel, kopiert: true, bytes, dauer_ms: ms(), mit_stems };
}

// Eine Fassung in den Arbeitsbestand bringen; zwei gleichzeitige Aufrufe für dieselbe Fassung teilen sich eine Kopie.
export function inArbeitsbestand(bestand: string, arbeitsbestand: string, material_id: string, basis_bpm: number,
  fassung: number): Promise<KopieErgebnis> {
  const schluessel = `${arbeitsbestand}|${material_id}/${fassungsName(basis_bpm, fassung)}`;
  const da = laufend.get(schluessel);
  if (da) return da;
  const p = kopiere(bestand, arbeitsbestand, material_id, basis_bpm, fassung).finally(() => laufend.delete(schluessel));
  laufend.set(schluessel, p);
  return p;
}

// Reste abgebrochener Kopien (.kopie-<pid>-<n>) eines Prozesses, der nicht mehr lebt; gibt ihre Zahl zurück.
export function raeumeAuf(arbeitsbestand: string): number {
  let n = 0;
  let namen: string[] = [];
  try { namen = fs.readdirSync(arbeitsbestand); } catch { return 0; }
  for (const name of namen) {
    const m = /^\.kopie-(\d+)-\d+$/.exec(name);
    if (!m) continue;
    const pid = Number(m[1]);
    let lebt = pid === process.pid;
    if (!lebt) {
      try { process.kill(pid, 0); lebt = true; } catch (e) { lebt = (e as NodeJS.ErrnoException).code === 'EPERM'; }
    }
    if (lebt) continue;
    fs.rmSync(path.join(arbeitsbestand, name), { recursive: true, force: true });
    n++;
  }
  return n;
}
