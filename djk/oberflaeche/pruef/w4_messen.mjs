// Paket 1.13 Warp, Slice 4 (Task 14): Messfunktionen der Zielabnahme (pruef/abnahme_w4.mjs), rein; geeicht in tests/pruef_w4_signal.test.mjs, bevor sie am Ziel messen.
import { anschlaege } from './w3a_messen.mjs';

export const db = (rmsWert) => 20 * Math.log10(rmsWert + 1e-12);
export function rms(x, a, b) { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); }
export function pearson(a, b) {
  let ma = 0, mb = 0; for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; } ma /= a.length; mb /= b.length;
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}
// Form: die ersten 10 ms jedes Schlags im Export gegen die Quelle. Schlag u liegt in der Quelle bei lagen[u] (Frames) und im Export bei u · periode + (lagen[u] − u · quellPeriode);
// der Verzug 0 oder 1 Sample ist erlaubt (D6a: die Einheit beginnt höchstens 1 Sample hinter der genauen Lage). Ergebnis: kleinster Wert, sein Verzug und sein Schlag.
export function formKorrelation(x, quelle, lagen, periode, quellPeriode, sr = 48000) {
  let kleinste = Infinity, lagBei = 0, wo = -1; const n = Math.round(0.01 * sr);
  lagen.forEach((l, u) => {
    const q = quelle.subarray(l, l + n), erwartet = Math.round(u * periode + (l - u * quellPeriode));
    let beste = -Infinity, bLag = 0;
    for (const lag of [0, 1]) { const c = erwartet + lag + n <= x.length ? pearson(x.subarray(erwartet + lag, erwartet + lag + n), q) : -1; if (c > beste) { beste = c; bLag = lag; } }
    if (beste < kleinste) { kleinste = beste; lagBei = bLag; wo = u; }
  });
  return { min: kleinste, lag: lagBei, schlag: wo };
}
// Rest der Einsätze gegen das feste Raster (60 / bpm Sekunden, Null = Anfang des Exports), ohne Phasenfit; in ms mit Vorzeichen (+ = nach dem Raster)
export function restFest(x, bpm, sr = 48000) {
  const t = anschlaege(x, sr), P = 60 / bpm, rest = t.map((s) => (s - Math.round(s / P) * P) * 1000);
  const abs = rest.map(Math.abs).sort((a, b) => a - b), sortiert = [...rest].sort((a, b) => a - b);
  return { n: t.length, p90: abs.length ? abs[Math.ceil(0.9 * abs.length) - 1] : Infinity, median: sortiert.length ? sortiert[sortiert.length >> 1] : NaN, max: abs.at(-1) ?? Infinity };
}
// Z5b (Fix-Runde Schluss): Urteil über restFest. Beides muss halten: |Median mit Vorzeichen| ≤ 0,5 ms (ein gleichmäßiger Versatz) UND p90(|Rest|) ≤ 2 ms (die Streuung).
// Nur p90 ≤ 2 ms ließ −1,5 ms Versatz grün (p90 1,83 ms). Geeicht in tests/pruef_w4_signal.test.mjs: ±1 ms Versatz werden rot.
// Ehrliche Grenze: kommt am Ziel FEHL heraus, ist das ein Befund über den Kern oder den Detektor, kein Werkzeugfehler; das Kriterium wird dann nicht gelockert, bis die Ursache feststeht.
export const Z5B_MEDIAN_MS = 0.5, Z5B_P90_MS = 2;
export const z5bOk = (m) => m.n === 64 && Math.abs(m.median) <= Z5B_MEDIAN_MS && m.p90 <= Z5B_P90_MS;
