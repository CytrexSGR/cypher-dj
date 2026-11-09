// 1.12 automation slice 3 (task 8, D15): the simplification of a recorded take, pure. Ramer-Douglas-Peucker on (beat, value), where the distance of a
// dropped point is measured the way the core measures a lane: the value laneWert gives on the chord between the two kept points at the beat of the
// dropped one (so the stumm rule of the fader is honoured, and a point that falls to -200 dB cannot be bridged: its deviation is the largest).
// Mute and solo are not simplified: only the jumps stay. Endpoints stay, beats rise, at most two points share a beat (the lane rule).
import { laneWert, type Punkt } from './lane.ts';

export const TOLERANZ_FADER_DB = 0.3;       // D15: 0.3 dB for the fader (the -200 dB fall is kept exactly by the distance measure)
export const TOLERANZ_PAN = 0.008;          // D15: 0.4 % of the pan range -1..1 (2 · 0.004)
export const TOLERANZ_GERAET = 0.004;       // 1.12 slice 4 (D6): 0.4 % of the device range 0..1, the same rule as pan (was the fader's 0.3 dB)
export function toleranzVon(ziel: string): number {
  return ziel === 'pan' ? TOLERANZ_PAN : ziel.startsWith('geraet.') ? TOLERANZ_GERAET : TOLERANZ_FADER_DB;
}

// A point is dropped only if its deviation is strictly below the tolerance: tolerance 0 keeps every point (D15 negative control).
function rdp(p: readonly Punkt[], ziel: string, tol: number): Punkt[] {
  const behalte = new Uint8Array(p.length);
  behalte[0] = 1; behalte[p.length - 1] = 1;
  const stapel: [number, number][] = [[0, p.length - 1]];
  while (stapel.length) {
    const [a, b] = stapel.pop() as [number, number];
    if (b - a < 2) continue;
    const sehne: Punkt[] = [{ beat: p[a].beat, wert: p[a].wert }, { beat: p[b].beat, wert: p[b].wert, form: 'linear' }];
    let max = -1, wo = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(laneWert(sehne, p[i].beat, ziel) - p[i].wert);
      if (d > max) { max = d; wo = i; }
    }
    if (max < tol) continue;
    behalte[wo] = 1;
    stapel.push([a, wo], [wo, b]);
  }
  return p.filter((_, i) => behalte[i] === 1);
}

// Beats rise (a stable sort repairs a late sample) and no more than two points share a beat: of a longer run the first and the last stay
function kappe(p: Punkt[]): Punkt[] {
  const s = p.map((q, i) => ({ q, i })).sort((x, y) => x.q.beat - y.q.beat || x.i - y.i).map((x) => x.q);
  const aus: Punkt[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1].beat === s[i].beat) j++;
    aus.push(s[i]);
    if (j > i) aus.push(s[j]);
    i = j;
  }
  return aus;
}

export function vereinfache(punkte: readonly Punkt[], ziel: string, toleranz: number = toleranzVon(ziel)): Punkt[] {
  const p = kappe(punkte.map((q) => ({ ...q })));
  if (p.length < 3) return p.map((q) => (ziel === 'mute' || ziel === 'solo' ? { ...q, form: 'sprung' as const } : q));
  if (ziel === 'mute' || ziel === 'solo') {
    const aus: Punkt[] = [];
    for (let i = 0; i < p.length; i++) {
      if (i === 0 || i === p.length - 1 || p[i].wert !== aus[aus.length - 1].wert) aus.push({ ...p[i], form: 'sprung' });
    }
    return aus;
  }
  return kappe(rdp(p, ziel, toleranz));
}
