// Session view S1b, B4: the page server twin of the core's source read map of a launcher cell (djk/core/src/zell_map.cpp, rules in plan index 2.3).
// One definition lives in djk/contract/zell_karte_referenz.json; tests/zell_map.test.mjs holds this twin to every case of it (the parity gate).
// zellRendern plays one turn of a cell through the map into a new buffer (the page's `→ NEW CELL`).
import type { Zelle } from './model.ts';

export const ZELL_NAHT = 96;                       // ARR_NAHT: seam crossfade length in frames (core: arrangement.h)
const STILLE = -1;
const GLEICH = 1e-6;                               // two source frames count as the same frame (slot starts come from a linear beats to frames conversion)

// n = s.length slots, 0 = identity; g[k] = slot starts in source frames with g[n] = frames; s[k] = source slot of played slot k (0-based)
export interface ZellKarteTs { g: number[]; s: number[]; rueck: boolean; blende: boolean; kreis: boolean; frames: number }
export interface ZellLesungTs { a: number; b: number; wb: number }

const f32 = Math.fround;
const puf = new DataView(new ArrayBuffer(8));
// std::nextafter(x, 0.0) for x > 0
function untenNach(x: number): number {
  if (!(x > 0)) return x;
  puf.setFloat64(0, x);
  puf.setBigUint64(0, puf.getBigUint64(0) - 1n);
  return puf.getFloat64(0);
}

function quelle(k: ZellKarteTs, slot: number, pos: number, stilleAmEnde: boolean): number {
  const n = k.s.length;
  if (n <= 0) return pos;
  const s = k.s[slot];
  if (s < 0 || s >= n) return STILLE;
  const q = k.g[s] + (pos - k.g[slot]);
  if (stilleAmEnde && q >= k.g[s + 1]) {
    // a played position 1-2 ulp below its own slot end can round to q at the source slot end: that is the last frame, not silence
    if (k.g[slot + 1] - pos < GLEICH && q < k.g[s + 1] + GLEICH) return untenNach(k.g[s + 1]);
    return STILLE;
  }
  return q;
}

function wende(k: ZellKarteTs, q: number): number {
  if (!(q >= 0 && q < k.frames)) return STILLE;
  if (!k.rueck) return q;
  const v = k.frames - 1 - q;
  return v >= 0 ? v : k.kreis ? v + k.frames : 0;
}

function alt(k: ZellKarteTs, slot: number, pos: number): number {
  const n = k.s.length;
  if (n > 0 && k.s[slot] < n) {
    const laenge = k.g[slot + 1] - k.g[slot], quelleLaenge = k.g[k.s[slot] + 1] - k.g[k.s[slot]];
    if (laenge > quelleLaenge + GLEICH && pos - k.g[slot] >= quelleLaenge) return STILLE;
  }
  let q = quelle(k, slot, pos, false);
  if (q >= k.frames) q = k.kreis ? q % k.frames : STILLE;
  return wende(k, q);
}

function gleich(k: ZellKarteTs, x: number, y: number): boolean {
  if (!(x >= 0 && y >= 0)) return false;
  let d = Math.abs(x - y);
  if (k.kreis) d = Math.min(d, k.frames - d);
  return d < GLEICH;
}

// fade-in weight of the read i frames after a hard onset (launch)
export function zellEinblende(i: number): number { return i <= 0 ? 0 : i >= ZELL_NAHT ? 1 : f32(i / ZELL_NAHT); }

// The frame to read for played frame f and, inside ZELL_NAHT after a discontinuous seam, the second read and its weight (the old read; with blende the
// loop seam is a dip: b stays silent, only wb moves). The first read weighs 1 - wb. a and b are in [0, frames) or exactly -1.
export function zellLesen(k: ZellKarteTs, f: number): ZellLesungTs {
  const r: ZellLesungTs = { a: STILLE, b: STILLE, wb: 0 };
  const n = k.s.length;
  if (!(f >= 0 && f < k.frames) || n > 64) return r;
  const naht = ZELL_NAHT, ende = k.frames;
  let slot = 0;
  while (slot + 1 < n && k.g[slot + 1] <= f) slot++;
  const q = quelle(k, slot, f, true);
  r.a = wende(k, q);

  if (slot >= 1 && f - k.g[slot] < naht) {
    const gk = k.g[slot];
    if (!gleich(k, alt(k, slot - 1, gk), wende(k, quelle(k, slot, gk, true)))) {
      r.b = alt(k, slot - 1, f);
      r.wb = f32(1 - (f - gk) / naht);
      return r;
    }
  } else if (slot === 0 && k.kreis && !k.blende && f < naht) {
    const letzt = n > 0 ? n - 1 : 0;
    if (!gleich(k, alt(k, letzt, ende), wende(k, quelle(k, 0, 0, true)))) {
      r.b = alt(k, letzt, f + ende);
      r.wb = f32(1 - f / naht);
      return r;
    }
  }
  if (n > 0 && q >= 0) {
    const e = k.g[k.s[slot] + 1];
    if (q >= e - naht && f + (e - q) < k.g[slot + 1] - GLEICH) r.wb = f32((q - (e - naht)) / naht);
  }
  if (k.blende) {
    let w = r.wb;
    if (f < naht) w = Math.max(w, f32(1 - zellEinblende(f)));
    if (f >= ende - naht) w = Math.max(w, f32((f - (ende - naht)) / naht));
    r.wb = w;
  }
  return r;
}

// The map of a cell: slot starts from the slot map exactly as the core loader reads them (round(start * frames / beats), g[n] = frames).
export function zellKarteVon(z: Zelle, frames: number, beats: number): ZellKarteTs {
  const sch = z.scheiben;
  return {
    g: sch ? sch.grenzen.map((x) => Math.round(x * frames / beats)).concat(frames) : [],
    s: sch ? sch.folge.map((x) => x - 1) : [],
    rueck: z.rueckwaerts === true, blende: z.blende === true, kreis: z.art === 'loop', frames,
  };
}

// one read of the source at a fractional frame (linear between neighbours; past the last frame a loop wraps, a one-shot reads silence)
function probe(d: Float32Array, frames: number, kreis: boolean, pos: number, kanal: number): number {
  const i = Math.floor(pos), t = pos - i;
  const x = d[2 * i + kanal];
  if (t === 0) return x;
  const j = i + 1 < frames ? i + 1 : kreis ? 0 : -1;
  return x + (j < 0 ? -x : d[2 * j + kanal] - x) * t;
}

// One turn of the cell (frames frames): d is interleaved stereo; gainLin scales the result. An identity map with gain 1 returns the input bit-equal.
// von..bis (played frames, default the whole turn) renders only that range: the result holds (bis - von) frames, equal to the same range of the full turn.
export function zellRendern(d: Float32Array, k: ZellKarteTs, gainLin: number, von = 0, bis = k.frames): Float32Array {
  const frames = k.frames;
  const aus = new Float32Array((bis - von) * 2);
  for (let f = von; f < bis; f++) {
    const r = zellLesen(k, f);
    for (let c = 0; c < 2; c++) {
      const a = r.a >= 0 ? probe(d, frames, k.kreis, r.a, c) : 0;
      let v = a;
      if (r.wb !== 0) {
        const b = r.b >= 0 ? probe(d, frames, k.kreis, r.b, c) : 0;
        v = a * (1 - r.wb) + b * r.wb;
      }
      aus[2 * (f - von) + c] = gainLin === 1 ? v : v * gainLin;
    }
  }
  return aus;
}
