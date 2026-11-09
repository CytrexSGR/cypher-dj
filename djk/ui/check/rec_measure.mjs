// 1.8 S2b.5: pure measuring helpers of acceptance_rec2.mjs (click positions in a take, deviation from the beat grid, peak level). No I/O.
// A click is the onset of the core metronome (2 kHz, decaying, 96 samples, the first sample is the maximum: arr_metronom.cpp), so the first frame at or
// above the threshold is the frame the click was generated on. After an onset the ringing is ignored for KLICK_ABSTAND frames.
export const KLICK_ABSTAND = 2000;

// Frame indices of the click onsets of x (a Float32Array); schwelle is an absolute amplitude.
export function klickOrte(x, schwelle, abstand = KLICK_ABSTAND) {
  const orte = [];
  let frei = 0;
  for (let i = 0; i < x.length; i++) {
    if (i < frei || Math.abs(x[i]) < schwelle) continue;
    orte.push(i);
    frei = i + abstand;
  }
  return orte;
}

// Deviation of the found positions from the wanted ones (both in the same frame unit): each wanted position takes the nearest found click within half the
// spacing; none within reach = missing (never a deviation of 0). abw = found - wanted (positive = late).
export function abweichung(orte, soll, reichweite = KLICK_ABSTAND / 2) {
  const je = soll.map((s) => {
    let best = null;
    for (const o of orte) if (Math.abs(o - s) <= reichweite && (best === null || Math.abs(o - s) < Math.abs(best - s))) best = o;
    return best === null ? { soll: s, fehlt: true } : { soll: s, ort: best, abw: best - s };
  });
  const da = je.filter((e) => !e.fehlt).map((e) => e.abw);
  const mittel = da.length ? da.reduce((a, b) => a + b, 0) / da.length : NaN;
  const streuung = da.length ? Math.sqrt(da.reduce((a, b) => a + (b - mittel) ** 2, 0) / da.length) : NaN;
  return { je, fehlend: je.length - da.length, min: da.length ? Math.min(...da) : NaN, max: da.length ? Math.max(...da) : NaN, mittel, streuung };
}

// OK only if every wanted click is there and no deviation exceeds the tolerance (frames). Silence has no click: FEHL.
export function urteilKlicks(orte, soll, toleranz) {
  const a = abweichung(orte, soll);
  const maxAbs = a.fehlend === soll.length ? NaN : Math.max(Math.abs(a.min), Math.abs(a.max));
  if (a.fehlend > 0) return { ok: false, grund: `no click at ${a.fehlend} of ${soll.length} beats`, maxAbs, ...a };
  if (maxAbs > toleranz) return { ok: false, grund: `deviation ${maxAbs} frames exceeds the tolerance ${toleranz}`, maxAbs, ...a };
  return { ok: true, grund: '', maxAbs, ...a };
}

// Peak level in dBFS; silence is -200 like the core reports it.
export function spitzeDb(x) {
  let m = 0;
  for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > m) m = v; }
  return m > 0 ? 20 * Math.log10(m) : -200;
}
