// Loop deck channel strip (plan 1.4): which effect graphs may sit in the effect slot of a deck track.
// A track insert is in series with the loop, so a graph qualifies when it keeps the dry signal (not wet only) and delays it by at most
// LOOP_FX_LATENZ_MAX samples (the PDC shifts the other tracks of the container by that time).
import type { GraphEintrag } from '../../graphs.ts';

export const LOOP_FX_LATENZ_MAX = 64;                                   // samples at 48 kHz (1.3 ms)
export const LOOP_FX_NUR_NASS: readonly string[] = ['fx-delay-sync'];   // wet only: on a track insert it would remove the loop (the DELAY send covers it)
export const LOOP_FX_ZUERST: readonly string[] = ['fx-remix', 'fx-crunch'];

export type LoopFxGraph = { name: string; kurz: string; latenz: number };

export function loopFxGraphen(liste: GraphEintrag[]): LoopFxGraph[] {
  const ok = liste.filter((g) => g.art === 'effekt' && g.latenz <= LOOP_FX_LATENZ_MAX && !LOOP_FX_NUR_NASS.includes(g.name));
  const rang = (n: string): number => { const i = LOOP_FX_ZUERST.indexOf(n); return i < 0 ? LOOP_FX_ZUERST.length : i; };
  ok.sort((a, b) => rang(a.name) - rang(b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return ok.map((g) => ({ name: g.name, kurz: g.name.replace(/^fx-/, '').slice(0, 6).toUpperCase(), latenz: g.latenz }));
}
