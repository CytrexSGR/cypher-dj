// 1.12 S7 (M13) track band loop: pure measurements for pruef/abnahme_s7_schleife.mjs, on the events the page server passes through its
// SSE stream (/strom): /uhr {sample, beat, bpm} (block start), /e/regler {pfad, wert, halter, sample, beat} (a change reports its exact
// sample; during a ramp at most 50 Hz), /q {id, status, ist_sample}. Tested with synthetic events in tests/pruef_s7_schleife_messen.test.mjs.
export const SR = 48000;

// Block size in samples: the smallest positive step between two /uhr block starts (null with fewer than two lines)
export function blockGroesse(uhren) {
  let b = null;
  for (let i = 1; i < uhren.length; i++) {
    const d = Number(uhren[i].sample) - Number(uhren[i - 1].sample);
    if (d > 0 && (b === null || d < b)) b = d;
  }
  return b;
}

// Sample of core beat `beat` on the line of the last /uhr at or before it (constant tempo from there); null without such a line
export function sampleBeiBeat(uhren, beat) {
  const u = uhren.filter((x) => x.beat <= beat).at(-1);
  return u ? Number(u.sample) + Math.round((beat - u.beat) * 60 / u.bpm * SR) : null;
}

// Seams of a loop: for every pass start beat in `starts` the first /e/regler event on `pfad` carrying the start value `wert` near that beat
// (within `fenster` beats). luecke = its sample minus the sample of the start beat; 0 = the pass starts exactly on its beat. A missing event
// is reported as fehlt (the pass did not start, or the core rejected it).
export function nahtLuecken(regler, uhren, { pfad, starts, wert, fenster = 0.5, toleranz = 1e-4 }) {
  return starts.map((beat) => {
    const soll = sampleBeiBeat(uhren, beat);
    const e = regler.find((x) => x.pfad === pfad && Math.abs(x.wert - wert) <= toleranz && Math.abs(x.beat - beat) <= fenster);
    return e && soll !== null ? { beat, soll, ist: Number(e.sample), luecke: Number(e.sample) - soll } : { beat, soll, fehlt: true };
  });
}

// The value course of one pass on `pfad`: the /e/regler values in [anfang, ende) beats, for the "change applies from pass k+1" check.
// The real core reports the end value of the running ramp and the next pass's set on the same sample of the seam beat (the end first); of
// events on one sample only the last is the value in force, so the old pass's end value does not leak into the course of the next pass.
export function verlauf(regler, pfad, anfang, ende) {
  const eigene = regler.filter((x) => x.pfad === pfad);
  return eigene.filter((x, i) => x.beat >= anfang && x.beat < ende && !(i + 1 < eigene.length && Number(eigene[i + 1].sample) === Number(x.sample))).map((x) => x.wert);
}

// STOP: the first /e/regler event on `pfad` at or after the sample at which the core executed the abort (ist_sample of its /q);
// verzug = that event's sample minus ist_sample (within one block = OK). null when the core reported no hold.
export function stoppVerzug(regler, pfad, istSample) {
  const e = regler.find((x) => x.pfad === pfad && Number(x.sample) >= istSample);
  return e ? { sample: Number(e.sample), wert: e.wert, verzug: Number(e.sample) - istSample } : null;
}
