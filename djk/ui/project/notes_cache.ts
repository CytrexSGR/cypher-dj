// Note editor (slice 1, task B4): the pure helpers of the note render cache (areas/proj/notes_render.ts keeps the files). Nothing here touches the disk
// or a process. A cache entry is the sidecar `<key>.json` next to `<key>.f32`; the key is renderSchluessel (notes_contract.ts).
import { rundeS, rundeTon, type AudioNote } from './notes_contract.ts';

export type CacheEintrag = { schluessel: string; slug: string; clip_id: string; quelle: string; kurve: string; maschine: string; liste: AudioNote[];
  bytes: number; zeit: number };

// The target fields of a note in the order and with the rounding of kanonischeListe, so that "equal here" means "equal key"
const zielTupel = (n: AudioNote): string => {
  const s = (x: number | undefined): number | null => (x === undefined ? null : rundeS(x));
  const t = (x: number | undefined): number | null => (x === undefined ? null : rundeTon(x));
  return JSON.stringify([s(n.a), s(n.e), t(n.ton), t(n.vib), t(n.drift), t(n.formant), t(n.gain_db)]);
};

/**
 * What the incremental render may rely on: the ids whose target tuple differs between two lists, in list order. null when the two lists are not
 * the same notes (another id sequence, or `qa`, `qe` or `qton` of any note differs): the engine's `--vorher` file would not fit, so the caller
 * renders in full. An empty array means the same render.
 */
export function geaenderteIds(alt: AudioNote[], neu: AudioNote[]): string[] | null {
  if (alt.length !== neu.length) return null;
  const ids: string[] = [];
  for (let i = 0; i < alt.length; i++) {
    const a = alt[i], b = neu[i];
    if (a.id !== b.id || rundeS(a.qa) !== rundeS(b.qa) || rundeS(a.qe) !== rundeS(b.qe) || rundeTon(a.qton) !== rundeTon(b.qton)) return null;
    if (zielTupel(a) !== zielTupel(b)) ids.push(b.id);
  }
  return ids;
}

/**
 * The keys to delete: first every entry beyond the `proKlip` newest of its (slug, clip) group, then the oldest of what is left until the sum of the
 * bytes is at most `maxBytes`. A key in `benutzt` never goes (it can keep the sum above the limit). The list is in the order of deletion: the
 * overflow of the groups oldest first, then the rest oldest first. The argument is not changed.
 */
export function raeumePlan(e: CacheEintrag[], o: { proKlip: number; maxBytes: number; benutzt: ReadonlySet<string> }): string[] {
  const aelterZuerst = (a: CacheEintrag, b: CacheEintrag): number => a.zeit - b.zeit || (a.schluessel < b.schluessel ? -1 : a.schluessel > b.schluessel
    ? 1 : 0);
  const gruppen = new Map<string, CacheEintrag[]>();
  for (const x of e) { const k = `${x.slug}\0${x.clip_id}`; const g = gruppen.get(k); if (g) g.push(x); else gruppen.set(k, [x]); }
  const ueberzaehlig: CacheEintrag[] = [];
  for (const g of gruppen.values()) ueberzaehlig.push(...g.sort((a, b) => b.zeit - a.zeit || (a.schluessel < b.schluessel ? 1 : -1)).slice(o.proKlip));
  const weg = ueberzaehlig.filter((x) => !o.benutzt.has(x.schluessel)).sort(aelterZuerst);
  const geht = new Set(weg.map((x) => x.schluessel));
  let summe = e.reduce((n, x) => n + (geht.has(x.schluessel) ? 0 : x.bytes), 0);
  const plan = weg.map((x) => x.schluessel);
  for (const x of e.filter((y) => !geht.has(y.schluessel) && !o.benutzt.has(y.schluessel)).sort(aelterZuerst)) {
    if (summe <= o.maxBytes) break;
    plan.push(x.schluessel); summe -= x.bytes;
  }
  return plan;
}
