// Sampler A2: marker edits of a cut (E6, E7), all pure. A marker is a bound `grenzen[k]` (k = 1..n-1; bound k starts the 0-based slice k). Moving one
// leaves the pattern alone; adding or removing one renumbers the notes that play the cut, so every hit keeps playing the audio it started with.
import type { Projekt } from '../project/model.ts';
import type { Anschlag } from '../project/transients.ts';
import { geraetName } from './device.ts';
import { guete, MAX_SCHEIBEN, SchnittFehler, type Schnitt } from './schnitt.ts';

/** Snap range in beats (E7). */
export const EINRAST_BEATS = 0.0625;
const GRID_BEATS = 0.25;      // the 1/16 positions a marker snaps to
const MIN_SCHEIBE = 4;        // frames, as in the cut methods
const UMGEKEHRT = 64;         // note 64 + t plays slice t reversed

export type MarkenArt = 'schieben' | 'neu' | 'weg';
export type MarkenAktion = { art?: unknown; marke?: unknown; frame?: unknown; beat?: unknown; einrasten?: unknown };

const arg = (text: string): SchnittFehler => new SchnittFehler(400, 'argument_ungueltig', text);

/** The frame a marker snaps to (E7): the nearest candidate within EINRAST_BEATS among the hits (`treffer`) and the 1/16 positions, a hit winning a tie; the
 *  frame itself when nothing is near. */
export function einrasten(s: Pick<Schnitt, 'frames' | 'beats' | 'treffer'>, frame: number): number {
  const fenster = EINRAST_BEATS * s.frames / s.beats;
  let best = frame, dist = Infinity;
  for (const t of s.treffer ?? []) {
    const d = Math.abs(t - frame);
    if (d <= fenster && d < dist) { dist = d; best = t; }
  }
  const schritt = GRID_BEATS * s.frames / s.beats;
  const raster = Math.round(Math.round(frame / schritt) * schritt);
  const d = Math.abs(raster - frame);
  if (d <= fenster && d < dist) best = raster;       // strictly nearer than every hit: a hit wins a tie
  return best;
}

/** One marker edit (E7). `treffer` are the hits of the cut with their strength (they measure the new quality); the cut's own `treffer` frames serve the
 *  snap (those of the hits when a cut of plan A1 has none). Returns the changed cut (`methode: 'hand'`, `ursprung` kept or, on a cut that never had one, the
 *  bounds before this edit), the kind of edit and `k`, the index of the bound that moved, appeared or went. Refusals: argument_ungueltig, marke_unbekannt,
 *  marke_zu_nah, zu_viele_scheiben (SchnittFehler); the cut is not changed. */
export function setzeMarke(s: Schnitt, a: MarkenAktion, treffer: Anschlag[]): { schnitt: Schnitt; art: MarkenArt; k: number } {
  const art = a.art;
  if (art !== 'schieben' && art !== 'neu' && art !== 'weg') throw arg('art: schieben, neu or weg expected');
  if (a.einrasten !== undefined && typeof a.einrasten !== 'boolean') throw arg('einrasten: true or false expected');
  const mitEinrasten = a.einrasten !== false;
  const g = s.grenzen, n = g.length - 1;
  const stelle = (): number => {
    if ((a.frame === undefined) === (a.beat === undefined)) throw arg('frame or beat: exactly one expected');
    const roh = a.frame !== undefined ? a.frame : typeof a.beat === 'number' ? a.beat * s.frames / s.beats : a.beat;
    if (typeof roh !== 'number' || !Number.isFinite(roh)) throw arg(`${a.frame !== undefined ? 'frame' : 'beat'}: a number expected`);
    const frame = Math.round(roh);
    return mitEinrasten ? einrasten({ frames: s.frames, beats: s.beats, treffer: s.treffer ?? treffer.map((t) => t.frame) }, frame) : frame;
  };
  let neu: number[], k: number;
  if (art === 'neu') {
    if (a.marke !== undefined) throw arg('marke: only for schieben and weg');
    if (n >= MAX_SCHEIBEN) throw new SchnittFehler(409, 'zu_viele_scheiben', `the cut has ${n} slices, the most there can be; remove a marker first`);
    const x = stelle();
    const j = g.findIndex((b, i) => i < n && x >= b && x < g[i + 1]);   // the slice that is split
    if (j < 0 || x - g[j] < MIN_SCHEIBE || g[j + 1] - x < MIN_SCHEIBE) {
      throw new SchnittFehler(409, 'marke_zu_nah', `a marker at frame ${x} would leave a slice shorter than ${MIN_SCHEIBE} frames`);
    }
    k = j + 1;
    neu = [...g.slice(0, k), x, ...g.slice(k)];
  } else {
    if (!Number.isInteger(a.marke)) throw arg('marke: the index of a bound (1 to the slice count minus 1) expected');
    k = a.marke as number;
    if (k < 1 || k > n - 1) throw new SchnittFehler(404, 'marke_unbekannt', `marker ${k} does not exist: the cut has ${n} slices, its movable markers are 1 to ${n - 1}`);
    if (art === 'weg') {
      if (a.frame !== undefined || a.beat !== undefined) throw arg('frame, beat: not for weg');
      neu = [...g.slice(0, k), ...g.slice(k + 1)];
    } else {
      const x = stelle();
      if (x - g[k - 1] < MIN_SCHEIBE || g[k + 1] - x < MIN_SCHEIBE) {
        throw new SchnittFehler(409, 'marke_zu_nah', `marker ${k} at frame ${x} would leave a slice shorter than ${MIN_SCHEIBE} frames`);
      }
      neu = [...g.slice(0, k), x, ...g.slice(k + 1)];
    }
  }
  const schnitt: Schnitt = { ...s, methode: 'hand', grenzen: neu, guete: guete(s, neu, treffer), ursprung: s.ursprung ?? [...g],
    treffer: s.treffer ?? treffer.map((t) => t.frame) };
  return { schnitt, art, k };
}

/** The note that keeps playing the audio `ton` played before the edit (E6). `n` is the slice count BEFORE the edit, `k` the bound index. Add: from slice k on
 *  every note moves up one. Remove: slices k-1 and k merge, so k goes to k-1 and the later ones down one. Note 64 + t (reversed) follows slice t; a note that no
 *  slice names (t >= n) stays. */
export function tonNach(art: 'neu' | 'weg', k: number, n: number, ton: number): number {
  const rueck = ton >= UMGEKEHRT && ton < UMGEKEHRT + n;
  const t = rueck ? ton - UMGEKEHRT : ton;
  if (t < 0 || t >= n) return ton;
  const nach = art === 'neu' ? (t >= k ? t + 1 : t) : t >= k ? t - 1 : t;
  return rueck ? nach + UMGEKEHRT : nach;
}

/** The commands that renumber every track of `p` that plays the cut (its device `smp-<id>`): one `noten_aendern` per MIDI clip with a changed note. Tracks
 *  of racks and tracks in other projects are not seen. */
export function umnummerBefehle(p: Projekt, schnittId: string, art: 'neu' | 'weg', k: number, n: number): Record<string, unknown>[] {
  const graph = geraetName(schnittId);
  const aus: Record<string, unknown>[] = [];
  for (const sp of p.spuren) {
    if (!(sp.geraet?.art === 'intern' && sp.geraet.name === 'bk' && sp.geraet.graph === graph)) continue;
    for (const c of sp.clips) {
      if (c.art !== 'midi') continue;
      const noten = c.noten.flatMap((no) => { const t = tonNach(art, k, n, no.ton); return t === no.ton ? [] : [{ id: no.id, ton: t }]; });
      if (noten.length > 0) aus.push({ befehl: 'noten_aendern', clip_id: c.id, noten });
    }
  }
  return aus;
}
