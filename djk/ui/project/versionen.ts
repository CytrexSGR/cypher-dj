// Project versions (spec B10): copies of project.json under <project>/.versionen/. Automatic ones are made when a project is opened and then at most
// every five minutes while saves arrive (the LAST 20 are kept); named ones are never pruned. Media files are never copied.
// Writes are atomic (tmp + fsync + rename); sichereAuto never fails the caller: it logs and swallows its own errors.
import fs from 'node:fs';
import path from 'node:path';
import { SLUG } from '../collection.ts';
import { AblageFehler } from './storage.ts';   // import cycle by design: only used inside methods, never at module load

export const VERSIONEN_ORDNER = '.versionen';
export interface VersionEintrag { id: string; zeit: string; name?: string; auto: boolean }
export interface VersionenOptionen { jetzt?: () => number; behalten?: number; abstandMs?: number }

const DATEI = /^(\d{8}T\d{9}Z)(?:--(.+))?\.json$/;

// 20261123T100000000Z
export const stempel = (ms: number): string => new Date(ms).toISOString().replace(/[-:.]/g, '');
const zeitVon = (st: string): string =>
  `${st.slice(0, 4)}-${st.slice(4, 6)}-${st.slice(6, 8)}T${st.slice(9, 11)}:${st.slice(11, 13)}:${st.slice(13, 15)}.${st.slice(15, 18)}Z`;

function fsyncDatei(pfad: string): void {
  const fd = fs.openSync(pfad, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function fsyncOrdner(pfad: string): void {
  const fd = fs.openSync(pfad, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export class Versionen {
  private readonly wurzel: string;
  private readonly jetzt: () => number;
  private readonly behalten: number;
  private readonly abstandMs: number;
  private readonly letzteAuto = new Map<string, number>();   // per slug: ms of the newest automatic copy (in memory, seeded from the folder)

  constructor(wurzel: string, opt: VersionenOptionen = {}) {
    this.wurzel = wurzel; this.jetzt = opt.jetzt ?? Date.now; this.behalten = opt.behalten ?? 20; this.abstandMs = opt.abstandMs ?? 300000;
  }

  ordner(slug: string): string {
    if (typeof slug !== 'string' || !SLUG.test(slug)) throw new Error('slug_ungueltig');
    return path.join(this.wurzel, slug, VERSIONEN_ORDNER);
  }

  liste(slug: string): VersionEintrag[] {
    let namen: string[];
    try { namen = fs.readdirSync(this.ordner(slug)); } catch { return []; }
    const aus: VersionEintrag[] = [];
    for (const n of namen) {
      const m = DATEI.exec(n);
      if (m === null) continue;
      aus.push({ id: n.slice(0, -5), zeit: zeitVon(m[1]), ...(m[2] !== undefined ? { name: m[2] } : {}), auto: m[2] === undefined });
    }
    return aus.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  }

  // the bytes of a version; callers match the id against liste() first, it is never trusted as a path
  lies(slug: string, id: string): Buffer { return fs.readFileSync(path.join(this.ordner(slug), `${id}.json`)); }

  // atomic write of one version file under a free stamp (from `ms` upward, so two saves in one millisecond never overwrite)
  protected schreibe(slug: string, ms: number, name: string | null, bytes: Buffer): string {
    const o = this.ordner(slug);
    fs.mkdirSync(o, { recursive: true });
    for (;; ms++) {
      const id = name === null ? stempel(ms) : `${stempel(ms)}--${name}`;
      const ziel = path.join(o, `${id}.json`);
      if (fs.existsSync(ziel)) continue;
      const tmp = `${ziel}.${process.pid}.tmp`;
      try {
        fs.writeFileSync(tmp, bytes); fsyncDatei(tmp);
        fs.renameSync(tmp, ziel);
      } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
      fsyncOrdner(o);
      return id;
    }
  }

  private neuesteBytes(slug: string): Buffer | null {
    const l = this.liste(slug);
    if (l.length === 0) return null;
    try { return this.lies(slug, l[0].id); } catch { return null; }
  }

  // an automatic copy, never throws. 'oeffnen' always (unless identical to the newest version), 'speichern' only after the spacing.
  sichereAuto(slug: string, grund: 'oeffnen' | 'speichern', bytes?: Buffer): void {
    try {
      const jetzt = this.jetzt();
      let letzte = this.letzteAuto.get(slug);
      if (letzte === undefined) {
        const a = this.liste(slug).find((x) => x.auto);
        letzte = a === undefined ? -Infinity : Date.parse(a.zeit);
        this.letzteAuto.set(slug, letzte);
      }
      if (grund === 'speichern' && jetzt - letzte < this.abstandMs) return;
      const inhalt = bytes ?? fs.readFileSync(path.join(this.wurzel, slug, 'project.json'));
      const neu = this.neuesteBytes(slug);
      if (neu !== null && neu.equals(inhalt)) return;
      this.schreibe(slug, jetzt, null, inhalt);
      this.letzteAuto.set(slug, jetzt);
      this.raeume(slug);
    } catch (e) {
      // no project: nothing to copy, no noise
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' && !fs.existsSync(path.join(this.wurzel, slug, 'project.json'))) return;
      console.error(`Versionen ${slug}: ${(e as Error).message}`); }
  }

  // a named copy, never pruned. The name loses / \ : * ? " < > | and control characters, whitespace collapses, 60 characters; empty is refused.
  // `bytes` default: the current project.json. Unlike sichereAuto this throws (the user asked for it).
  sichereBenannt(slug: string, name: string, bytes?: Buffer): string {
    const n = (typeof name === 'string' ? name : '').replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60).trim();
    if (n === '') throw new AblageFehler(400, 'version_name_leer');
    const inhalt = bytes ?? fs.readFileSync(path.join(this.wurzel, slug, 'project.json'));
    return this.schreibe(slug, this.jetzt(), n, inhalt);
  }

  // keeps the newest `behalten` automatic copies, named ones stay
  raeume(slug: string): void {
    const auto = this.liste(slug).filter((x) => x.auto);
    for (const v of auto.slice(this.behalten)) fs.rmSync(path.join(this.ordner(slug), `${v.id}.json`), { force: true });
  }
}
