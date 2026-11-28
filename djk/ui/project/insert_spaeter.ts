// Parameters that a kind got after its first release (strand 5: the dynamic EQ bands d1..d8 and dyn_attack/dyn_release, the saturator's kurve and decke).
// Like k9..k64 of a bk stage (modular.ts) they are optional in the file, read as their default and not written while they hold it: a project that never
// uses them keeps its bytes, and a project stored before they existed still loads.
import { INSERT_ARTEN, type InsertPoolArt } from './insert_key.ts';

const SPAETER: Partial<Record<InsertPoolArt, (name: string) => boolean>> = {
  eq: (n) => /^d[1-8]\//.test(n) || n === 'dyn_attack' || n === 'dyn_release',
  saett: (n) => n === 'kurve' || n === 'decke',
};
/** the names of `Insert.werte` of a kind that are optional in the file */
export const insertSpaeterNamen = (art: InsertPoolArt): readonly string[] => {
  const ist = SPAETER[art];
  return ist ? INSERT_ARTEN[art].parameter.filter((q) => ist(q.name)).map((q) => q.name) : [];
};
const vorgabeVon = (art: InsertPoolArt, name: string): number => INSERT_ARTEN[art].parameter.find((q) => q.name === name)!.vorgabe;
/** on load: a missing late parameter is its default */
export const insertSpaeterAuffuellen = (art: InsertPoolArt, werte: Record<string, number>): void => {
  for (const k of insertSpaeterNamen(art)) if (!(k in werte)) werte[k] = vorgabeVon(art, k);
};
/** on save: a late parameter at its default is not written */
export const insertSpaeterKanonisch = (art: InsertPoolArt, werte: Record<string, number>): void => {
  for (const k of insertSpaeterNamen(art)) if (werte[k] === vorgabeVon(art, k)) delete werte[k];
};
