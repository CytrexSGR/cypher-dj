// Front panels: readouts of device parameters (RB-338, Surge) from the Parameter table of GET /geraete/panel. `anzeigeWert` mirrors devices_parameter.ts
// (the one place on the server that turns a normalised value into display units; tests/production_device_view.test.mjs and tests/panel_skala_mitte.test.mjs pin this copy to it,
// the latter for knobs with a `mitte` against the engine's golden table). Pure, no DOM.
import { formatiereWert, diskretIndex, skaliere } from './panel_skala.js';

/** Surge: display value at travel `k` (0..1) over `punkte` (values at 0, 1/n .. 1), linear between the points. */
export function punkteWert(punkte, k) {
  const n = punkte.length - 1, x = Math.min(1, Math.max(0, k)) * n, i = Math.min(n - 1, Math.floor(x));
  return punkte[i] + (x - i) * (punkte[i + 1] - punkte[i]);
}
/** Inverse of punkteWert for monotone points (rising or falling); clamped to 0..1. */
export function punkteNorm(punkte, wert) {
  const n = punkte.length - 1, steigend = punkte[n] >= punkte[0];
  const w = steigend ? wert : -wert, q = steigend ? punkte : punkte.map((x) => -x);
  if (w <= q[0]) return 0;
  if (w >= q[n]) return 1;
  let i = 0;
  while (i < n - 1 && w > q[i + 1]) i++;
  return q[i + 1] === q[i] ? i / n : (i + (w - q[i]) / (q[i + 1] - q[i])) / n;
}

/** Normalised 0..1 -> display units of a Parameter entry {min, max, log, mitte?, skew?, gainDb?}. */
export function anzeigeWert(p, norm) {
  const k = Math.min(1, Math.max(0, Number.isFinite(norm) ? norm : 0));
  if (Array.isArray(p.punkte) && p.punkte.length >= 2) return punkteWert(p.punkte, k);
  if (p.mitte !== undefined) return skaliere(k, p);   // graph knob with a centre value: the one mapping of panel_skala.js
  if (p.gainDb) {
    const lo = 10 ** (p.min / 20), hi = 10 ** (p.max / 20);
    return 20 * Math.log10(k ** (1 / (p.skew ?? 1)) * (hi - lo) + lo);
  }
  if (p.skew !== undefined) return k ** (1 / p.skew) * (p.max - p.min) + p.min;
  return p.log && p.min > 0 && p.max > 0 ? p.min * (p.max / p.min) ** k : p.min + k * (p.max - p.min);
}

/** The readout text of a Parameter entry at norm: a stepped parameter shows its option, dB / Hz / s carry their unit, a 0..1 parameter without unit shows percent. */
export function anzeigeText(p, norm) {
  if (Array.isArray(p.stufen) && p.stufen.length) return p.stufen[diskretIndex(norm, p.stufen.length)] ?? '-';
  const w = anzeigeWert(p, norm);
  switch (p.einheit) {
    case 'log2 s': return formatiereWert(2 ** w * 1000, 'ms');   // Surge envelope times: display value x is 2^x seconds (measured)
    case 'amp3': return w <= 0 ? '-inf dB' : formatiereWert(60 * Math.log10(w), 'db');   // Surge levels: amplitude is x^3 (measured), so dB = 60 log10 x
    case 'dB': return formatiereWert(w, 'db');
    case 'Hz': return formatiereWert(w, 'hz');
    case 's': return formatiereWert(w * 1000, 'ms');
    case undefined: case '': return p.min === 0 && p.max === 1 ? formatiereWert(w, 'percent') : formatiereWert(w, 'raw');
    default: return formatiereWert(w, 'raw', p.einheit);
  }
}

/** Array of Parameter entries -> { name: entry } (what panel.js takes as `parameter`). */
export const parameterNachName = (liste) => Object.fromEntries((liste ?? []).map((p) => [p.name, p]));

/** Seconds of an envelope time read from a control: unit `log2 s` (Surge's envelope times: display value x is 2^x seconds, measured: attack 2.0 reaches full level in 4 s) is exponentiated, any other unit is already seconds. */
export const zeitInSekunden = (wert, einheit) => (einheit === 'log2 s' ? 2 ** wert : wert);
