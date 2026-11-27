// The marker file of a running master A/B: `<arbeitsordner>/master_ab.json` = { slug, pfade } (the project and the rows A/B touched, no values: the
// values come from the project). It lives in the playback working folder of the instance, next to the core whose rows it names, so it is never part
// of a project, an export, a zip or a collect. Written (atomically) before the first live row is sent, removed after the rows went back.
import fs from 'node:fs';

export interface AbMarke { slug: string; pfade: string[] }
export interface AbMarkeZugang { schreibe(slug: string, pfade: readonly string[]): void; lies(): AbMarke | null; loesche(): void }

export class MasterAbMarke implements AbMarkeZugang {
  private readonly datei: string;
  constructor(datei: string) { this.datei = datei; }
  schreibe(slug: string, pfade: readonly string[]): void {
    fs.mkdirSync(this.datei.replace(/[^/\\]*$/, '') || '.', { recursive: true });
    const tmp = `${this.datei}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ slug, pfade }));
    fs.renameSync(tmp, this.datei);
  }
  lies(): AbMarke | null {
    try {
      const j = JSON.parse(fs.readFileSync(this.datei, 'utf8')) as Partial<AbMarke>;
      return typeof j.slug === 'string' && Array.isArray(j.pfade) && j.pfade.every((x) => typeof x === 'string') ? { slug: j.slug, pfade: j.pfade } : null;
    } catch { return null; }
  }
  loesche(): void { fs.rmSync(this.datei, { force: true }); }
}
