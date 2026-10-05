// Zählt am Ziel, in wie vielen Takten zwei Decks zugleich „tief offen“ waren (SCHNITTSTELLEN §1.6, Invariante I1), aus dem,
// was die Attrappe gemeldet hat: /e/regler (Fader, Trim, EQ tief, Kill tief, xfader, master/pegel), /zustand/deck (läuft).
// Raster: alle 480 Samples (10 ms); ein Takt zählt, wenn an mindestens einem Rasterpunkt beide Decks tief offen sind.
import { REGLER } from '../src/regler_info.ts';
import { wertBei, type Lauf } from './laeufer.ts';

export interface SubDoppelt { takte: number[]; samples: number }

const SPT = 90000; // Samples je Takt bei 128 BPM

export function subDoppelt(l: Lauf, decks: [number, number], vonTakt: number, bisTakt: number,
  hoerbarDb = -26, tiefOffenDb = -12): SubDoppelt {
  const wert = (pfad: string, s: number): number => {
    const r = l.regler.get(pfad) ?? [];
    return !r.length || r[0][0] > s ? (REGLER.get(pfad)?.vorgabe as number) : (wertBei(r, s) as number);
  };
  const status = new Map<number, Array<[number, number]>>();
  for (const b of l.beobachtet) {
    if (!b.osc || b.osc[0] !== '/zustand/deck') continue;
    const d = b.osc[2] as number;
    if (!status.has(d)) status.set(d, []);
    status.get(d)!.push([b.sample, b.osc[3] as number]);
  }
  const laeuft = (d: number, s: number) => {
    const r = status.get(d) ?? [];
    let st = 0;
    for (const [x, v] of r) if (x <= s) st = v;
    return st >= 2 && st <= 5;
  };
  const tiefOffen = (d: number, s: number) => {
    const k = `deck/${d}`;
    const pegel = wert(`${k}/trim`, s) + wert(`${k}/fader`, s) + wert('master/pegel', s);
    return laeuft(d, s) && pegel > hoerbarDb && wert(`${k}/kill/tief`, s) === 0 && wert(`${k}/eq/tief`, s) > tiefOffenDb;
  };
  const takte: number[] = [];
  let samples = 0;
  for (let t = vonTakt; t <= bisTakt; t++) {
    let hier = false;
    for (let s = (t - 1) * SPT; s < t * SPT; s += 480) {
      if (tiefOffen(decks[0], s) && tiefOffen(decks[1], s)) { hier = true; samples += 480; }
    }
    if (hier) takte.push(t);
  }
  return { takte, samples };
}
