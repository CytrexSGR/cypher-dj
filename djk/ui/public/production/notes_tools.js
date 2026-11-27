// Piano roll tools: the arithmetic of quantise (grid, strength, swing) and humanise (seeded time and velocity offsets) on the notes of one clip.
// Pure functions, browser and node, no DOM, no imports (like public/harmonie.js): the page of PRODUCTION and the project commands noten_quantisieren and
// noten_humanisieren (project/commands_clip.ts) share this one calculation. Notes are project notes { id, beat, laenge, ton, vel }, beats are clip-relative.

// Grid values of the roll (own table; the arrangement table RASTER of timeline.js stays as it is). beats null = no fixed step (BAR follows the meter, OFF has none).
export const ROLL_RASTER = Object.freeze([
  { id: '1/32', text: '1/32', beats: 0.125 }, { id: '1/16T', text: '1/16T', beats: 1 / 6 }, { id: '1/16', text: '1/16', beats: 0.25 },
  { id: '1/8T', text: '1/8T', beats: 1 / 3 }, { id: '1/8', text: '1/8', beats: 0.5 }, { id: '1/4T', text: '1/4T', beats: 2 / 3 }, { id: '1/4', text: '1/4', beats: 1 },
  { id: 'bar', text: 'BAR', beats: null }, { id: 'off', text: 'OFF', beats: null },
].map((r) => Object.freeze(r)));
export const rasterBeatsRolle = (id) => ROLL_RASTER.find((r) => r.id === id)?.beats ?? null;

const EPS = 1e-9;
const SECHZEHNTEL = 0.25;
const runde = (x) => Math.round(x * 1e9) / 1e9;
const klemme = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
// the last place a humanised note may take below `grenze`: still inside the clip and audible
const ENDE_ABSTAND = 1 / 64;
const innen = (n, grenze) => n.beat >= 0 && n.beat < grenze;

// Grid position k (0, 1, 2 ...) with swing in percent: the positions are taken in pairs, the second of a pair lies at pair start + 2 * raster * swing / 100.
const stelle = (k, raster, swing) => (k % 2 === 0 ? k * raster : (k - 1) * raster + (2 * raster * swing) / 100);

// The nearest grid position of a beat below `grenze` (a tie goes to the earlier one; a position at or behind the end is not a candidate: the note takes the last one before it).
function naechste(beat, raster, swing, grenze) {
  const basis = Math.floor(beat / raster + EPS);
  let best = null;
  for (let k = Math.max(0, basis - 2); k <= basis + 2; k++) {
    const pos = stelle(k, raster, swing);
    if (pos >= grenze - EPS) continue;
    if (best === null || Math.abs(pos - beat) < Math.abs(best - beat) - EPS) best = pos;
  }
  return best ?? 0;
}

// Quantise: beat' = beat + (target - beat) * staerke. Lengths stay. Returns { id, beat } for the notes whose beat changes (rounded to 1e-9).
// o: raster_beats (> 0), staerke 0..1 (default 1), swing 50..75 percent (default 50 = straight), grenze = end of the clip content (min of loop and length).
// A note outside [0, grenze) is not touched.
export function quantisiereNoten(noten, o) {
  const staerke = o.staerke ?? 1, swing = o.swing ?? 50;
  const aus = [];
  for (const n of noten) {
    if (!innen(n, o.grenze)) continue;
    const ziel = naechste(n.beat, o.raster_beats, swing, o.grenze);
    const beat = runde(n.beat + (ziel - n.beat) * staerke);
    if (beat !== n.beat) aus.push({ id: n.id, beat });
  }
  return aus;
}

const hash32 = (t) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};
// One draw in [-1, 1) from the seed, the note id and the field name ('beat', 'vel') only, never from the clip id: linked clips stay equal.
export function zufall(saat, notenId, feld) {
  let t = (hash32(`${saat >>> 0}|${notenId}|${feld}`) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
}

// Humanise: the start moves by up to ±(zeit percent of a sixteenth) (zeit 50 = ±0.125 beat), the velocity by up to ±vel steps, both uniform.
// Beats stay in [0, grenze) (an end below grenze keeps the note audible), velocity in 1..127 (whole numbers).
// Returns { id, beat?, vel? } for the notes that change. A note outside [0, grenze) is not touched.
export function humanisiereNoten(noten, o) {
  const zeit = o.zeit ?? 0, vel = o.vel ?? 0;
  const aus = [];
  for (const n of noten) {
    if (!innen(n, o.grenze)) continue;
    const e = { id: n.id };
    if (zeit > 0) {
      const beat = runde(klemme(n.beat + zufall(o.saat, n.id, 'beat') * ((zeit / 100) * SECHZEHNTEL), 0, Math.max(0, o.grenze - ENDE_ABSTAND)));
      if (beat !== n.beat) e.beat = beat;
    }
    if (vel > 0) {
      const v = klemme(Math.round(n.vel + zufall(o.saat, n.id, 'vel') * vel), 1, 127);
      if (v !== n.vel) e.vel = v;
    }
    if (e.beat !== undefined || e.vel !== undefined) aus.push(e);
  }
  return aus;
}
