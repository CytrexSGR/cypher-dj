// Patch field pins (Kraken plan, task 4). No imports: the project model, presets, graph reader, routes and the panel share these names.
// A pin is [satz, zeile, spalte, wert]: satz 0 (A) or 1 (B), zeile 0..15 (source), spalte 0..15 (destination), wert finite in -1..1.
// 0 means "no pin" and is never stored. Stored lists are sorted by (satz, zeile, spalte), hold no position twice and at most 512 entries.
export type Stift = [number, number, number, number];
export const STIFT_SAETZE = 2;
export const STIFT_ZEILEN = 16;
export const STIFT_SPALTEN = 16;
export const STIFTE_MAX = 512;
export const STECKFELD_NAME_MAX = 16;
/** the labels and default pins of the matrix node of a graph */
export interface Steckfeld { zeilen: string[]; spalten: string[]; stifte: Stift[] }

const ganz = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;

/** the first problem of a single pin as text, null when it is a good pin (a 0 value is a good pin here; the list rules decide about it) */
export function stiftEinzelFehler(e: unknown, wo = 'stift'): string | null {
  if (!Array.isArray(e) || e.length !== 4) return `${wo}: [satz, zeile, spalte, wert] expected`;
  if (!ganz(e[0], 0, STIFT_SAETZE - 1)) return `${wo}[0]: satz 0 or 1 expected`;
  if (!ganz(e[1], 0, STIFT_ZEILEN - 1)) return `${wo}[1]: zeile 0..${STIFT_ZEILEN - 1} expected`;
  if (!ganz(e[2], 0, STIFT_SPALTEN - 1)) return `${wo}[2]: spalte 0..${STIFT_SPALTEN - 1} expected`;
  if (typeof e[3] !== 'number' || !Number.isFinite(e[3]) || e[3] < -1 || e[3] > 1) return `${wo}[3]: finite value in -1..1 expected`;
  return null;
}

/** the first problem of a stored list (null = good): an array of at most 512 good pins, sorted, no position twice, no zero value */
export function stiftFehler(roh: unknown): string | null {
  if (!Array.isArray(roh)) return 'stifte: array expected';
  if (roh.length > STIFTE_MAX) return `stifte: at most ${STIFTE_MAX} entries`;
  let vor = -1;
  for (let i = 0; i < roh.length; i++) {
    const f = stiftEinzelFehler(roh[i], `stifte[${i}]`);
    if (f) return f;
    const e = roh[i] as Stift;
    if (e[3] === 0) return `stifte[${i}]: a zero value is no pin and is never stored`;
    const pos = e[0] * 256 + e[1] * 16 + e[2];
    if (pos === vor) return `stifte[${i}]: position stored twice`;
    if (pos < vor) return `stifte[${i}]: not sorted by (satz, zeile, spalte)`;
    vor = pos;
  }
  return null;
}

/** drops zeros, the last write per position wins, sorted by (satz, zeile, spalte); the input is not changed */
export function normaleStifte(l: readonly Stift[]): Stift[] {
  const je = new Map<number, Stift>();
  for (const e of l) je.set(e[0] * 256 + e[1] * 16 + e[2], [e[0], e[1], e[2], e[3]]);
  return [...je.entries()].sort((a, b) => a[0] - b[0]).map(([, e]) => e).filter((e) => e[3] !== 0);
}
