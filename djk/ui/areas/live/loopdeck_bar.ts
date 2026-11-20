// Loop deck: the grid point a cell start or stop waits for (index 1.5, S2). Pure: the clock of the caller (receipt time of the last /uhr and "now")
// comes in as numbers, so nothing here reads the wall clock. Never uses szenenZielBeat (that one is the SEQ bar grid of the project).
export const LOOP_VORLAUF_MS = 80;

// no usable core clock: nothing has been received yet, or the tempo is 0 (the route turns it into 409 keine_uhr)
export class KeineUhrFehler extends Error {
  constructor() { super('keine_uhr'); this.name = 'KeineUhrFehler'; }
}

export interface UhrStand { beat: number; bpm: number; empfangenMs: number }

// The core beat now, extrapolated from the last /uhr: beat + (jetzt - empfangen) * bpm / 60000. Throws KeineUhrFehler without a usable clock.
export function loopBeatJetzt(uhr: UhrStand | null | undefined, jetztMs: number): number {
  if (!uhr || !Number.isFinite(uhr.beat) || !Number.isFinite(uhr.bpm) || !Number.isFinite(uhr.empfangenMs) || uhr.bpm <= 0) throw new KeineUhrFehler();
  return uhr.beat + (jetztMs - uhr.empfangenMs) * uhr.bpm / 60000;
}

// The next multiple of rasterBeats that lies at least LOOP_VORLAUF_MS ahead of the extrapolated core beat.
export function loopZielBeat(uhr: UhrStand | null | undefined, rasterBeats: number, jetztMs: number): number {
  const jetzt = loopBeatJetzt(uhr, jetztMs);
  if (!(rasterBeats > 0) || !Number.isFinite(rasterBeats)) throw new RangeError('rasterBeats must be positive');
  const fruehestens = jetzt + LOOP_VORLAUF_MS * uhr!.bpm / 60000;
  // the tolerance keeps a point that is exactly at the lead from being pushed a whole grid step by float noise
  return Math.ceil(fruehestens / rasterBeats - 1e-9) * rasterBeats;
}
