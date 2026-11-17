// The two fixed collections (media browser slice 2): Favourites and Recently used. Ordinary collection files under /kollektionen with
// two fixed slugs, created on first use, never renamed or deleted. They live beside the user's own collections, never in the catalog
// (the catalog is rebuilt hourly elsewhere). rangVon turns them into the rank that /stoebern sorts by.
import type { KollektionSpeicher } from './store.ts';

export const FAVORITEN_SLUG = 'favourites';
export const ZULETZT_SLUG = 'recently-used';
export const ZULETZT_MAX = 50;
export const FESTE: readonly { slug: string; name: string }[] = [
  { slug: FAVORITEN_SLUG, name: 'Favourites' },
  { slug: ZULETZT_SLUG, name: 'Recently used' },
];
export const istFest = (slug: string): boolean => FESTE.some((f) => f.slug === slug);

const RANG_SONST = 1000;
const shas = (s: KollektionSpeicher, slug: string): string[] => {
  try { return s.lies(slug).posten.flatMap((p) => (p.art === 'sample' ? [p.sha] : [])); } catch { return []; }   // missing or damaged counts as empty
};

// favourite 0; recent at distance i from the newest (the newest is the last item) 1 + i; everything else 1000. Read once, then pure.
export function rangVon(s: KollektionSpeicher): { rang(sha: string): number; favorit(sha: string): boolean; tabelle: ReadonlyMap<string, number> } {
  const fav = new Set(shas(s, FAVORITEN_SLUG));
  const neu = shas(s, ZULETZT_SLUG);
  const zuletzt = new Map<string, number>();
  neu.forEach((x, i) => zuletzt.set(x, 1 + (neu.length - 1 - i)));
  const tabelle = new Map<string, number>(zuletzt);   // only the ranked rows (at most ZULETZT_MAX plus the favourites): the query sorts against this set
  for (const x of fav) tabelle.set(x, 0);
  return {
    tabelle,
    favorit: (sha) => fav.has(sha),
    rang: (sha) => (fav.has(sha) ? 0 : zuletzt.get(sha) ?? RANG_SONST),
  };
}
