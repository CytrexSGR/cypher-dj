// Reachability of the places a catalog row lives in (media browser slice 1). A disk that is not mounted often leaves its mount folder
// behind as an empty directory (2026-11-17: /media/user/DiskA), so a source counts as present only when it holds at least one entry.
import fs from 'node:fs';

export const ERREICHBAR_TTL_MS = 10_000;
export interface Quelle { name: string; pfad: string }

const MOUNT = [/^(\/media\/[^/]+\/[^/]+)(?:\/|$)/, /^(\/run\/media\/[^/]+\/[^/]+)(?:\/|$)/, /^(\/mnt\/[^/]+)(?:\/|$)/];
const drin = (wurzel: string, p: string): boolean => p === wurzel || p.startsWith(wurzel.endsWith('/') ? wurzel : `${wurzel}/`);

/** The source of a folder: the longest sampler root that holds it, else its disk (/media/<u>/<x>, /run/media/<u>/<x>, /mnt/<x>), else the system disk. */
export function quelleVon(ordner: string, wurzeln: readonly Quelle[]): Quelle {
  let best: Quelle | null = null;
  for (const w of wurzeln) if (drin(w.pfad, ordner) && (best === null || w.pfad.length > best.pfad.length)) best = w;
  if (best) return { name: best.name, pfad: best.pfad };
  for (const re of MOUNT) {
    const m = re.exec(ordner);
    if (m) return { name: m[1].slice(m[1].lastIndexOf('/') + 1), pfad: m[1] };
  }
  return { name: 'System disk', pfad: '/' };
}

/** The path lies on a removable disk: under `/media/<u>/<x>` or `/run/media/<u>/<x>` (the `/mnt` disks are fixed ones). */
export const aufWechselplatte = (pfad: string): boolean => MOUNT.slice(0, 2).some((re) => re.test(pfad));

export class Erreichbarkeit {
  private readonly ttl: number;
  private readonly jetzt: () => number;
  private readonly ordner = new Map<string, { t: number; da: boolean }>();
  private readonly quellen = new Map<string, { t: number; da: boolean }>();
  constructor(o: { ttlMs?: number; jetzt?: () => number } = {}) { this.ttl = o.ttlMs ?? ERREICHBAR_TTL_MS; this.jetzt = o.jetzt ?? Date.now; }

  private gemerkt(m: Map<string, { t: number; da: boolean }>, k: string, f: () => boolean): boolean {
    const t = this.jetzt(), z = m.get(k);
    if (z && t - z.t <= this.ttl) return z.da;
    const da = f();
    m.set(k, { t, da });
    return da;
  }

  /** The folder exists. Called for every row of a page by the priority order, hence the cache. */
  ordnerDa(ordner: string | null): boolean {
    if (ordner === null) return false;
    return this.gemerkt(this.ordner, ordner, () => fs.existsSync(ordner));
  }

  /** The source is mounted: `/` always, else a directory with at least one entry (an empty mount folder is a missing disk). */
  quelleDa(pfad: string): boolean {
    if (pfad === '/') return true;
    return this.gemerkt(this.quellen, pfad, () => {
      try { return fs.statSync(pfad).isDirectory() && fs.readdirSync(pfad).length > 0; } catch { return false; }
    });
  }
}

/** The disk a path lives on (`/media/<u>/<x>`, `/run/media/<u>/<x>`, `/mnt/<x>`), else the system disk `/`. */
const plattePfad = (pfad: string): string => {
  for (const re of MOUNT) { const m = re.exec(pfad); if (m) return m[1]; }
  return '/';
};

/** Whether one source path is there, and when not, why (`grund`): `platte` its disk is not mounted, `ordner` the disk is there but the folder is not (or is empty). */
export function lageVon(pfad: string, e: Erreichbarkeit): { da: boolean; grund?: 'platte' | 'ordner' } {
  if (e.quelleDa(pfad)) return { da: true };
  const platte = plattePfad(pfad);
  return { da: false, grund: platte !== pfad && e.quelleDa(platte) ? 'ordner' : 'platte' };
}

/** Folder counts summed per source, with the reachability of each source; most files first, then by name. A source that is not there says why
 *  (`grund`): `platte` its disk is not mounted, `ordner` the disk is there but the sampler folder is not (or is empty). Only when `da` is false. */
export function quellenLage(ordner: readonly { pfad: string; n: number }[], wurzeln: readonly Quelle[], e: Erreichbarkeit): { name: string; pfad: string; n: number; da: boolean; grund?: 'platte' | 'ordner' }[] {
  const summe = new Map<string, { name: string; pfad: string; n: number }>();
  for (const o of ordner) {
    const q = quelleVon(o.pfad, wurzeln);
    const z = summe.get(q.pfad);
    if (z) z.n += o.n; else summe.set(q.pfad, { name: q.name, pfad: q.pfad, n: o.n });
  }
  return [...summe.values()].map((q) => ({ name: q.name, pfad: q.pfad, n: q.n, ...lageVon(q.pfad, e) }))
    .sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
