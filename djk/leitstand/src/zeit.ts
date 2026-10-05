// Zeit auf der Kern-Uhr (SCHNITTSTELLEN §1.1, §1.3, §5.2): Beat, Takt, Phrase und CLOCK_MONOTONIC
// aus dem letzten /uhr. Der Leitstand rechnet nur innerhalb des Segments des letzten /uhr hoch; die
// Uhr bleibt allein im Kern.
export interface Uhrstand {
  sample: number;   // Blockanfang
  mono_ns: number;  // CLOCK_MONOTONIC am Blockanfang (Kern)
  beat: number;
  bpm: number;
  bpm_pro_s: number; // k des Segments
}

export interface Zeitpunkt { sample: number; beat: number; takt: number; phrase: number }

export const RATE = 48000;

// §1.3: beat(s) = b0 + (bpm0·dt + k·dt²/2) / 60 mit dt = (s − s0)/48000
export function beatBeiSample(u: Uhrstand, s: number): number {
  const dt = (s - u.sample) / RATE;
  return u.beat + (u.bpm * dt + (u.bpm_pro_s * dt * dt) / 2) / 60;
}

// §1.3: sample(b) = s0 + 48000 · 120·(b − b0) / (bpm0 + sqrt(bpm0² + 120·k·(b − b0))), im Segment des Uhrstands
export function sampleBeiBeat(u: Uhrstand, b: number): number {
  const db = b - u.beat;
  const w = u.bpm * u.bpm + 120 * u.bpm_pro_s * db;
  return Math.round(u.sample + (RATE * 120 * db) / (u.bpm + Math.sqrt(Math.max(0, w))));
}

export function taktVonBeat(beat: number): number { return Math.floor(beat / 4) + 1; }
export function schlagVonBeat(beat: number): number { return Math.floor(beat - 4 * Math.floor(beat / 4)) + 1; }
export function phraseVonBeat(beat: number): number { return Math.floor(beat / 32) + 1; }

export function zeitpunkt(sample: number, beat: number): Zeitpunkt {
  return { sample, beat, takt: taktVonBeat(beat), phrase: phraseVonBeat(beat) };
}

// CLOCK_MONOTONIC eines Samples, hochgerechnet vom Blockanfang des Uhrstands.
export function monoBeiSample(u: Uhrstand, s: number): number {
  return u.mono_ns + Math.round(((s - u.sample) * 1e9) / RATE);
}

// process.hrtime.bigint() liest CLOCK_MONOTONIC (libuv uv_hrtime), dieselbe Uhr wie mono_ns des Kerns.
export function jetztNs(): number {
  return Number(process.hrtime.bigint());
}
