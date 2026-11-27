// Pure rules of the loudness-matched A/B of the production master chain. A = the project as it is, B = every insert stage of the master
// switched off by its live row ins/<art>/<slot>/an. The louder side is turned down by the measured difference with the live row pm/fader,
// the quieter side plays at the project fader (never turned up: B has no limiter, raising it would add clipping that is in neither version).
// Nothing here touches a project or the core; the state machine is areas/proj/master_ab.ts.
import { FADER_MAX, FADER_MIN, type Projekt } from './model.ts';

export const AB_MAX_DB = 24;
const AB_MIN_DIFF = 0.2;

export type AbSeite = 'a' | 'b';
export interface AbAusgleich { leiser: AbSeite | null; db: number }
export interface AbZeile { pfad: string; wert: number }

/** The side that is turned down and by how much (>= 0, rounded to 0.1, at most AB_MAX_DB). No measurement or a difference under 0.2 dB: no cut. */
export function abAusgleich(aLufs: number | null, bLufs: number | null): AbAusgleich {
  if (aLufs === null || bLufs === null || !Number.isFinite(aLufs) || !Number.isFinite(bLufs)) return { leiser: null, db: 0 };
  const d = aLufs - bLufs;
  if (Math.abs(d) < AB_MIN_DIFF) return { leiser: null, db: 0 };
  return { leiser: d > 0 ? 'a' : 'b', db: Math.round(Math.min(AB_MAX_DB, Math.abs(d)) * 10) / 10 };
}

/** The live rows of one side: the switch of every master stage (B: all 0, A: the project's own), then pm/fader. */
export function abZeilen(p: Projekt, seite: AbSeite, aus: AbAusgleich): AbZeile[] {
  const zeilen: AbZeile[] = (p.master?.inserts ?? []).map((i) => ({
    pfad: `ins/${i.art}/${i.slot}/an`, wert: seite === 'b' ? 0 : (i.an ? 1 : 0) }));
  const fader = (p.master?.fader_db ?? 0) - (aus.leiser === seite ? aus.db : 0);
  zeilen.push({ pfad: 'pm/fader', wert: Math.min(FADER_MAX, Math.max(FADER_MIN, Math.round(fader * 100) / 100)) });
  return zeilen;
}

/** The reason A/B is refused for this project, or null: `keine_stufe` (nothing to bypass), `master_lane` (a fader lane would fight the fader row). */
export function abSperre(p: Projekt): string | null {
  if (!(p.master?.inserts ?? []).length) return 'keine_stufe';
  if ((p.master?.automation ?? []).some((l) => l.ziel === 'fader')) return 'master_lane';
  return null;
}

/** The rows A/B touches for this project: the paths of abZeilen (every master stage switch and pm/fader). Written to the marker file while A/B is on. */
export const abMarkePfade = (p: Projekt): string[] => abZeilen(p, 'a', { leiser: null, db: 0 }).map((z) => z.pfad);

/** After a restart of the page server with a marker: the project's own values for exactly the marked rows (only rows that still exist), switches first. */
export function abNachLauf(p: Projekt, pfade: readonly string[]): AbZeile[] {
  const gesperrt = new Set(pfade);
  return abZeilen(p, 'a', { leiser: null, db: 0 }).filter((z) => gesperrt.has(z.pfad));
}
