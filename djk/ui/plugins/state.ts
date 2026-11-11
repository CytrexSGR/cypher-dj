// Plan 1.11 task 7 (D8): the state files of host plugins and when they are written. A state file is <project>/plugins/<insert-id>.carxs; its path is fixed
// when the insert is created (Insert.zustand). The host writes it on `zustand_holen {pfad}`: to `<file>.neu`, renamed over the file only after the host
// answered ok, so a crash or a refusal never leaves a torn state file.
import fs from 'node:fs';
import path from 'node:path';

export type SicherGrund = 'param' | 'fenster' | 'export' | 'schliessen' | 'ende';

/** absolute path of a state file; `relativ` is Insert.zustand and must stay inside the project folder */
export function zustandDatei(projektOrdner: string, relativ: string): string {
  const voll = path.resolve(projektOrdner, relativ);
  if (!voll.startsWith(path.resolve(projektOrdner) + path.sep)) throw new Error(`state path leaves the project folder: ${relativ}`);
  return voll;
}
export const zustandNeu = (datei: string): string => `${datei}.neu`;
export const zustandDa = (datei: string): boolean => { try { return fs.statSync(datei).size > 0; } catch { return false; } };
export function zustandOrdner(datei: string): void { fs.mkdirSync(path.dirname(datei), { recursive: true }); }
/** after an ok answer: the written `.neu` replaces the state file (atomic rename); a missing `.neu` is an error */
export function zustandUebernehmen(datei: string): void {
  try { fs.copyFileSync(datei, `${datei}.bak`); } catch { /* the first write has no earlier version */ }   // the previous version survives one write
  fs.renameSync(zustandNeu(datei), datei);
}
export function zustandVerwerfen(datei: string): void { try { fs.rmSync(zustandNeu(datei), { force: true }); } catch { /* nothing to drop */ } }

/** the timers behind the triggers 'param' (2 s after the LAST param call) and 'fenster' (every 30 s while a plugin window is open, and once when it closes) */
export class ZustandPlan {
  private paramTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly fenster = new Map<string, ReturnType<typeof setInterval>>();
  private readonly o: { ruheMs: number; fensterMs: number; sichere: (grund: SicherGrund, insertId?: string) => Promise<void> };
  constructor(o: { ruheMs: number; fensterMs: number; sichere: (grund: SicherGrund, insertId?: string) => Promise<void> }) { this.o = o; }
  /** a plugin parameter was set: (re)start the quiet period; ten calls in a row write once */
  param(): void {
    if (this.paramTimer) clearTimeout(this.paramTimer);
    this.paramTimer = setTimeout(() => { this.paramTimer = null; void this.o.sichere('param'); }, this.o.ruheMs);
    this.paramTimer.unref();
  }
  /** the window of a plugin opened: write its state every fensterMs while it stays open */
  fensterOffen(insertId: string): void {
    if (this.fenster.has(insertId)) return;
    const t = setInterval(() => void this.o.sichere('fenster', insertId), this.o.fensterMs);
    t.unref();
    this.fenster.set(insertId, t);
  }
  /** the window closed: stop the interval and write once */
  fensterZu(insertId: string): Promise<void> {
    const t = this.fenster.get(insertId);
    if (t) { clearInterval(t); this.fenster.delete(insertId); }
    return this.o.sichere('fenster', insertId);
  }
  /** a pending 'param' write is not needed once something else writes the state (close, end) */
  verwirf(): void {
    if (this.paramTimer) { clearTimeout(this.paramTimer); this.paramTimer = null; }
    for (const t of this.fenster.values()) clearInterval(t);
    this.fenster.clear();
  }
}
