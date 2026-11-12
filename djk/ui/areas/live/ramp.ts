// Plan live-module decision 16: a fader ramp over bars for project groups. The generic hand tool `regler` refuses grp/* (ueber_projekt), so the server
// steps the row itself: about every 1/16 note (a quarter beat) it writes the interpolated value on the core clock, and the model gets only the end value
// (the caller's one edit, one playback reload). The ramp is beat based, not wall-clock based: it ends when the core clock has advanced `beats`, whatever
// the tempo does meanwhile. Without beat progress (no clock, transport stopped, clock stalled) it does not wait: nothing sounds or nothing moves,
// so the end is taken at once.
export interface RampeKern {
  uhr(): { beat: number; bpm: number } | null;     // the master clock of the core (telemetry /uhr)
  laeuft(): boolean;                               // the transport plays (a module on a stopped transport is not audible, a fade would be pointless)
}
export interface RampeAuftrag {
  kern: RampeKern;
  von: number; nach: number; beats: number;
  schreibe(db: number): void;                      // one row write; the end value is written last, exactly `nach`
  abbruch?: () => boolean;                         // true: stop stepping (the project changed, Stop Cypher); no end value is written
  schrittBeats?: number;                           // default 0.25 (a 1/16 note)
  pollMs?: number; stillMs?: number;               // clock reading cadence (20 ms) and stall limit (1000 ms, like uhrStillMs)
  warte?: (ms: number) => Promise<void>;           // test seam
  jetzt?: () => number;
}
export type RampeEnde = 'erreicht' | 'sofort' | 'still' | 'abgebrochen';

// Amplitude squared: gain (1-t)^2, so the fade sounds even and the last step before silence is far down (-48 dB at 15/16 of a bar-long ramp). The result
// reaches `nach` only at t = 1; values below -200 are clamped by the fader range.
export function rampeWert(von: number, nach: number, t: number): number {
  if (t <= 0) return von;
  if (t >= 1) return nach;
  if (nach <= -200) return Math.max(-200, von + 40 * Math.log10(1 - t));
  return von + (nach - von) * t;
}

const schlaf = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function fahreRampe(a: RampeAuftrag): Promise<RampeEnde> {
  const warte = a.warte ?? schlaf, jetzt = a.jetzt ?? Date.now, poll = a.pollMs ?? 20, still = a.stillMs ?? 1000, schritt = a.schrittBeats ?? 0.25;
  const u0 = a.kern.uhr();
  if (a.beats <= 0 || a.von === a.nach || !u0 || !a.kern.laeuft()) { a.schreibe(a.nach); return 'sofort'; }
  const start = u0.beat;
  let letzter = start, seit = jetzt(), naechster = 1;
  for (;;) {
    await warte(poll);
    if (a.abbruch?.()) return 'abgebrochen';
    const u = a.kern.uhr(), t = jetzt();
    if (u && u.beat > letzter) { letzter = u.beat; seit = t; }
    if (!a.kern.laeuft() || t - seit > still) { a.schreibe(a.nach); return 'still'; }
    const fertig = (letzter - start) / a.beats;
    if (fertig >= 1) { a.schreibe(a.nach); return 'erreicht'; }
    if ((letzter - start) / schritt >= naechster) {
      a.schreibe(rampeWert(a.von, a.nach, fertig));
      naechster = Math.floor((letzter - start) / schritt) + 1;
    }
  }
}
