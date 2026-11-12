// Front panel scaling: ONE module for the normalised knob (0..1) <-> plain value, shared by the page server (graphs.ts),
// the page (panel.js) and, later, the agent layer. Pure, no DOM, no Node API.
//
// The range comes from the graph's `regler` node ({min, max, log}); the engine turns the normalised knob k into the node output with
// instruments/modular_dsp/src/programm.rs (Schritt::Regler):
//     linear: min + (max - min) * k          log: min * (max / min)^k
// With `mitte` (a value pinned to knob position 0.5) the node maps 0..0.5 to min..mitte and 0.5..1 to mitte..max, each half linear or both
// log; knob 0.5 is exactly `mitte`, 0 is min and 1 is max (programm.rs `regler_mit_mitte`). Without `mitte` it is the formula above.
// tests/panel_skala.test.mjs pins this file to that formula, tests/panel_skala_mitte.test.mjs to the engine's golden table.

/** @typedef {{min: number, max: number, log: boolean, mitte?: number}} Bereich */

export const klemme01 = (k) => (Number.isFinite(k) ? Math.min(1, Math.max(0, k)) : 0);

/** Normalised knob 0..1 -> plain value, exactly as the engine computes it. */
export function skaliere(k, b) {
  const x = klemme01(k);
  if (b.mitte !== undefined) {
    if (x === 0.5) return b.mitte;
    if (x <= 0) return b.min;
    if (x >= 1) return b.max;
    const [von, bis, t] = x < 0.5 ? [b.min, b.mitte, x * 2] : [b.mitte, b.max, (x - 0.5) * 2];
    return b.log ? Math.min(Math.max(von, bis), Math.max(Math.min(von, bis), von * (bis / von) ** t)) : von + (bis - von) * t;
  }
  return b.log ? b.min * (b.max / b.min) ** x : b.min + (b.max - b.min) * x;
}

/** Plain value -> normalised knob 0..1 (clamped). A degenerate range (min == max) maps to 0. */
export function entskaliere(w, b) {
  if (!Number.isFinite(w)) return 0;
  if (b.mitte !== undefined) {
    if (w === b.mitte) return 0.5;
    const unten = (w - b.mitte) * (b.min - b.mitte) > 0;   // on the side of min (min may be above max for an inverted knob)
    const [von, bis] = unten ? [b.min, b.mitte] : [b.mitte, b.max];
    let t;
    if (b.log) {
      if (!(von > 0 && bis > 0 && w > 0) || von === bis) return unten ? 0 : 1;
      t = Math.log(w / von) / Math.log(bis / von);
    } else {
      if (von === bis) return unten ? 0 : 1;
      t = (w - von) / (bis - von);
    }
    return klemme01(unten ? 0.5 * Math.min(1, Math.max(0, t)) : 0.5 + 0.5 * Math.min(1, Math.max(0, t)));
  }
  if (b.log) {
    if (!(b.min > 0 && b.max > 0) || b.min === b.max) return 0;
    return klemme01(Math.log(w / b.min) / Math.log(b.max / b.min));
  }
  if (b.max === b.min) return 0;
  return klemme01((w - b.min) / (b.max - b.min));
}

/** Discrete controls (switch, selector) store the position i of n as i / (n - 1) in one knob. */
export const diskretWert = (i, n) => (n <= 1 ? 0 : klemme01(i / (n - 1)));
export const diskretIndex = (k, n) => (n <= 1 ? 0 : Math.min(n - 1, Math.max(0, Math.round(klemme01(k) * (n - 1)))));

// Number text with a fixed amount of precision: the readout must not jitter in width while a knob moves.
function zahl(w, stellen) { return (Math.abs(w) < 0.5 * 10 ** -stellen ? 0 : w).toFixed(stellen); }
function drei(w) { const a = Math.abs(w); return zahl(w, a >= 100 ? 0 : a >= 10 ? 1 : 2); }

/** Readout text of a PLAIN value. format: 'hz' | 'db' | 'ms' | 'percent' | 'raw' (default); `unit` is appended for 'raw' only
 *  (the other formats carry their own unit). 'percent' takes the plain value as a fraction (0.5 -> "50 %"). */
export function formatiereWert(w, format, unit) {
  if (!Number.isFinite(w)) return '-';
  switch (format) {
    case 'hz': return Math.abs(w) >= 1000 ? `${zahl(w / 1000, Math.abs(w) >= 10000 ? 1 : 2)} kHz` : `${drei(w)} Hz`;
    case 'db': return `${zahl(w, 1)} dB`;
    case 'ms': return Math.abs(w) >= 1000 ? `${zahl(w / 1000, 2)} s` : `${drei(w)} ms`;
    case 'percent': return `${zahl(w * 100, 0)} %`;
    default: return unit ? `${drei(w)} ${unit}` : drei(w);
  }
}
export const FORMATE = ['hz', 'db', 'ms', 'percent', 'raw'];
