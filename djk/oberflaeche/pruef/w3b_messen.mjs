// Paket 1.13 Warp, Slice 3b: Messgerät für AK22 (Teilen eines gewarpten Clips). Zwei Exporte desselben Projekts, einmal mit dem ganzen Clip, einmal an einem Beat geteilt.
//   RE-PITCH: außerhalb von ± halbfenster Samples um die Teilstelle müssen beide Exporte Sample für Sample gleich sein (abweichungAusserhalb).
//   COMPLEX:  die Klicks jedes Exports liegen höchstens 16 Samples neben dem Raster des ganzen Clips (rasterAbweichung); Klicks = lokale Spitzen über
//             30 % des Maximums. Paarweise (klickVersatz) taugt nicht: COMPLEX streut die Klicklage schon ohne Teilen um −6..+10 Samples, der neu
//             gestartete zweite Teil streut anders, paarweise addiert sich das auf 19 (Ziel 2026-10-30, ~/messungen/2026-10-31-w3b-ziel/).
import { klicks } from './w1_wav.mjs';

export function abweichungAusserhalb(a, b, mitte, halbfenster) {
  if (a.length !== b.length) return { laenge_gleich: false, n: Infinity, max: Infinity, erst: -1 };
  let n = 0, max = 0, erst = -1;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(i - mitte) <= halbfenster) continue;
    const d = Math.abs(a[i] - b[i]);
    if (d > 0) { n++; if (d > max) max = d; if (erst < 0) erst = i; }
  }
  return { laenge_gleich: true, n, max, erst };
}
export function klickStellen(x, abstand = 4000) {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  return m > 0 ? klicks(x, 0.3 * m, abstand) : [];
}
export function klickVersatz(a, b, abstand = 4000) {
  const ta = klickStellen(a, abstand), tb = klickStellen(b, abstand);
  if (ta.length !== tb.length || ta.length === 0) return { gleich: false, n: ta.length, m: tb.length, max: Infinity, stelle: -1 };
  let max = 0, stelle = 0;
  ta.forEach((t, i) => { const d = Math.abs(t - tb[i]); if (d > max) { max = d; stelle = t; } });
  return { gleich: true, n: ta.length, m: tb.length, max, stelle };
}
export function rasterAbweichung(x, null0, periode, abstand = 4000) {
  const t = klickStellen(x, abstand);
  let max = 0, stelle = -1;
  for (const k of t) { const d = Math.abs(k - (null0 + Math.round((k - null0) / periode) * periode)); if (d > max) { max = d; stelle = k; } }
  return { n: t.length, max: t.length ? max : Infinity, stelle };
}
