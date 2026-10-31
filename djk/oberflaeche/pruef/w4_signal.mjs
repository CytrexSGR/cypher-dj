// Paket 1.13 Warp, Slice 4 (Task 14): Messsignale der Zielabnahme (pruef/abnahme_w4.mjs). Rein, ohne Netz und Datei; getestet in tests/pruef_w4_signal.test.mjs.
// Alle liefern { daten: Float32Array Stereo verschränkt, lagen: Frame des Anschlags je Schlag }.
//   klickSpur   Ein-Sample-Klicks 0,8 (D11: Lage; das Prüfgerät w1_wav.mjs klicks() nimmt die größte Spitze)
//   schlagSpur  Schlag mit Körper (D11): Rausch-Burst 0,8·exp(−t/3 ms) plus Sinus 180 Hz 0,5·exp(−t/40 ms), so lang wie sein Platz bis zum nächsten Schlag (Form, Lücken, Hülle)
//   burstSpur   Rausch-Burst 0,8 mit 1 ms linearem Anstieg und Abfall exp(−t/3 ms), 20 ms lang (b2: weicher Anschlag, der Detektor trifft 0,8..1,5 ms nach dem Anschlag)
//   sinusSpur   Sinus (Negativ-Kontrolle der Transienten)
// Optionen: bpm, schlaege, raster (in Beats), zittern_ms (gleichverteilt ±), seed, sr (48000), vorlauf (Frames bis zum ersten Schlag, 24000 = 0,5 s), frames (Länge der Datei;
// sonst letzter Schlag plus 0,5 s). Der Schlag k liegt auf vorlauf + k·raster·60/bpm·sr + Zittern (gerundet). Passt ein Schlag nicht in die Datei oder fallen zwei auf
// denselben Frame oder rückwärts, wirft der Generator (nie still kürzen).
const SR = 48000;

// mulberry32: deterministisch, kleine Saat
function zufall(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function lagenVon({ bpm, schlaege, raster, zittern_ms = 0, seed = 1, sr = SR, vorlauf = 24000, frames }) {
  const z = zufall(seed), lagen = [];
  for (let k = 0; k < schlaege; k++) {
    const j = zittern_ms > 0 ? (2 * z() - 1) * zittern_ms / 1000 * sr : 0;
    lagen.push(Math.round(vorlauf + k * raster * 60 / bpm * sr + j));
  }
  const n = frames ?? Math.round((lagen.at(-1) ?? vorlauf) + 0.5 * sr);
  for (let k = 0; k < lagen.length; k++) {
    if (lagen[k] < 0 || lagen[k] >= n) throw new Error(`Schlag ${k} bei Frame ${lagen[k]} passt nicht in die Datei (${n} Frames)`);
    if (k > 0 && lagen[k] <= lagen[k - 1]) throw new Error(`Schlag ${k} bei Frame ${lagen[k]} liegt nicht hinter dem vorigen (${lagen[k - 1]}): Zittern zu groß für das Raster`);
  }
  return { lagen, n };
}

function bauen(o, form) {
  const sr = o.sr ?? SR, { lagen, n } = lagenVon(o), daten = new Float32Array(2 * n), rnd = zufall((o.seed ?? 1) * 7919 + 13);
  lagen.forEach((a, k) => {
    const platz = (k + 1 < lagen.length ? lagen[k + 1] : n) - a;
    for (let i = 0, m = form.laenge(platz, sr); i < m; i++) { const v = form.wert(i, sr, rnd); daten[2 * (a + i)] += v; daten[2 * (a + i) + 1] += v; }
  });
  return { daten, lagen };
}

export function klickSpur(o) {
  const { lagen, n } = lagenVon(o), daten = new Float32Array(2 * n);
  for (const f of lagen) { daten[2 * f] = 0.8; daten[2 * f + 1] = 0.8; }
  return { daten, lagen };
}

export function schlagSpur(o) {
  return bauen(o, {
    laenge: (platz) => platz,
    wert: (i, sr, rnd) => { const t = i / sr; return 0.8 * (2 * rnd() - 1) * Math.exp(-t / 0.003) + 0.5 * Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t / 0.04); },
  });
}

export function burstSpur(o) {
  return bauen(o, {
    laenge: (platz, sr) => Math.min(platz, Math.round(0.02 * sr)),
    wert: (i, sr, rnd) => { const t = i / sr; return 0.8 * (2 * rnd() - 1) * Math.min(1, t / 0.001) * Math.exp(-t / 0.003); },
  });
}

export function sinusSpur({ frames, hz = 440, amplitude = 0.3, sr = SR }) {
  const daten = new Float32Array(2 * frames);
  for (let i = 0; i < frames; i++) daten[2 * i] = daten[2 * i + 1] = amplitude * Math.sin(2 * Math.PI * hz * i / sr);
  return { daten, lagen: [] };
}
