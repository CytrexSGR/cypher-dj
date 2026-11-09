// Paket 1.13 Warp, Slice 3a: Messgerät für AK10 (Anschläge im Export gegen das starre Raster). Portierung von proben/07-werkstatt-zerleger/messwerk.py (anschlaege, raster_rest):
// Einsatz = Überschreitung von schwelle · p99,9 der RMS-Hüllkurve (Fenster fensterMs), Hysterese: neu scharf erst, wenn die Hüllkurve ruheMs lang unter der halben Schwelle lag.
export function anschlaege(x, rate = 48000, { fensterMs = 2.0, schwelle = 0.3, ruheMs = 60.0 } = {}) {
  const n = Math.max(1, Math.floor(rate * fensterMs / 1000)), N = x.length;
  const q = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) q[i + 1] = q[i] + x[i] * x[i];
  const e = new Float32Array(N), h = n >> 1;
  for (let i = 0; i < N; i++) { const a = Math.max(0, i - h), b = Math.min(N, i - h + n); e[i] = Math.sqrt((q[b] - q[a]) / n); }   // zentriert, wie np.convolve(..., 'same')
  const sortiert = Float32Array.from(e).sort();
  const thr = schwelle * sortiert[Math.min(N - 1, Math.floor(0.999 * N))];
  if (!(thr > 0)) return [];   // Stille: die Schwelle wäre 0 und 0 >= 0 ein Einsatz bei t = 0 (vom Selbsttest gefunden, Task 17)
  const ruhe = Math.floor(rate * ruheMs / 1000), aus = [];
  let scharf = true, unter = 0;
  for (let i = 0; i < N; i += 8) {
    const v = e[i];
    if (scharf && v >= thr) { aus.push(i / rate); scharf = false; unter = 0; }
    else if (!scharf) { unter = v < thr / 2 ? unter + 8 : 0; if (unter >= ruhe) scharf = true; }
  }
  return aus;
}
// Rest jedes Einsatzes gegen ein starres Raster der Periode (Sekunden); Phase per Kreismittel; Ergebnis in ms
export function rasterRest(t, periode) {
  let c = 0, s = 0;
  for (const x of t) { c += Math.cos(2 * Math.PI * x / periode); s += Math.sin(2 * Math.PI * x / periode); }
  const ph = Math.atan2(s / t.length, c / t.length) / (2 * Math.PI) * periode;
  return t.map((x) => (x - (ph + Math.round((x - ph) / periode) * periode)) * 1000);
}
// n Einsätze, p90 des Betrags, Median, Maximum (ms) gegen das Raster von bpm
export function messe(x, bpm, rate = 48000) {
  const t = anschlaege(x, rate), rest = rasterRest(t, 60 / bpm).map(Math.abs).sort((a, b) => a - b);
  if (rest.length === 0) return { n: 0, p90: Infinity, median: Infinity, max: Infinity, t };
  return { n: t.length, p90: rest[Math.ceil(0.9 * rest.length) - 1], median: rest[rest.length >> 1], max: rest.at(-1), t };
}
