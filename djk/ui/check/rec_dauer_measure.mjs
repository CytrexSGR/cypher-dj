// 1.8 T11: pure measuring helpers of acceptance_rec_dauer.mjs (the 10-minute run, AK6): impulse counter over a stereo float32 take, the verdict of one take (gaps, length against the
// recorded window) and of its impulse train (count, constant spacing). No I/O; calibrated in tests/pruef_rec_dauer_messen.test.mjs.
export const KANAL_MODI = ['stereo', 'links', 'rechts', 'summe'];
const SCHWELLE = 0.2, RUHE = 64;   // an impulse is a sample >= 0.2 after 64 quiet ones (the proof client puts 1.0 on a_L; the sum mode halves it)

// Counts the impulses of a stream of interleaved stereo frames per channel, chunk by chunk (a 10-minute take is 230 MB: it is never read at once).
export class ImpulsZaehler {
  constructor() { this.l = []; this.r = []; this.frames = 0; this.spitzeL = 0; this.spitzeR = 0; this.ruheL = RUHE; this.ruheR = RUHE; }
  fuettere(x) {   // Float32Array of whole frames (the caller keeps the chunks frame aligned)
    const n = x.length >> 1;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(x[2 * i]), b = Math.abs(x[2 * i + 1]), f = this.frames + i;
      if (a > this.spitzeL) this.spitzeL = a;
      if (b > this.spitzeR) this.spitzeR = b;
      if (a >= SCHWELLE) { if (this.ruheL >= RUHE) this.l.push(f); this.ruheL = 0; } else this.ruheL++;
      if (b >= SCHWELLE) { if (this.ruheR >= RUHE) this.r.push(f); this.ruheR = 0; } else this.ruheR++;
    }
    this.frames += n;
  }
}

// What the proof client's impulse (1.0 on cypherdj-pruef-ein:a_L) leaves in a take with `paare` impulses sent. The fixture of input 1 names ONE source port; the profile pc-eingang
// connects it to ein_1_L and ein_1_R (a mono source on both channels), so every channel mode of the track (stereo, links, rechts, summe = (L + R) / 2) records the impulse at
// full height on both channels. The modes are exercised in the core, but this source cannot tell them apart.
export function erwartung(modus, paare) {
  if (!KANAL_MODI.includes(modus)) throw new Error(`unknown channel mode ${modus}`);
  return { l: paare, r: paare, ampL: 1, ampR: 1 };
}

// One take: no gaps (the count of the writer and the status), and as long as the window the core recorded (end sample minus start sample) within one cycle.
export function urteilTake({ frames, luecken, status }, { fenster, zyklus }) {
  if (luecken !== 0) return { ok: false, grund: `${luecken} gaps counted` };
  if (status !== 0) return { ok: false, grund: `status ${status} (0 expected)` };
  if (Math.abs(frames - fenster) > zyklus) return { ok: false, grund: `${frames} frames against a window of ${fenster} (${frames - fenster >= 0 ? '+' : ''}${frames - fenster}, more than one cycle of ${zyklus})` };
  return { ok: true, grund: `${frames} frames, window ${fenster} (${frames - fenster >= 0 ? '+' : ''}${frames - fenster})` };
}

// The impulse train of one channel: the expected count and a constant spacing (one sample of rounding allowed). A dropped or doubled stretch of audio shows as
// a lost impulse or as a spacing that jumps, also when the writer did not count it as a gap.
export function urteilImpulse(orte, erwartet) {
  if (orte.length !== erwartet) return { ok: false, grund: `${orte.length} impulses, expected ${erwartet}` };
  if (orte.length < 2) return { ok: true, grund: `${orte.length} impulses` };
  const d = orte.slice(1).map((o, i) => o - orte[i]), lo = Math.min(...d), hi = Math.max(...d);
  if (hi - lo > 1) return { ok: false, grund: `spacing ${lo} to ${hi} frames (constant within 1 expected)` };
  return { ok: true, grund: `${orte.length} impulses, spacing ${lo} to ${hi} frames` };
}
