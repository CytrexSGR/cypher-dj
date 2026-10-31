// Paket 1.13 Warp, Slice 6 (Stems): die reine Rechnung der Zielabnahme pruef/abnahme_w6.mjs (Lage Z3/NK3, Anschläge Z4/Z4b/NK4, Rest Z5/NK5, Stand Z6).
// Ohne Netz und Datei, damit tests/pruef_w6_messen.test.mjs jede Rechnung samt Negativ-Kontrolle an synthetischen Daten eichen kann.
import { quellSekunde } from '../projekt/warp.ts';
import { anschlaege } from './w3a_messen.mjs';

export const SR = 48000;
export const p90 = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(0.9 * s.length))] : NaN; };
export const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
export const rms = (x, n = x.length) => { let s = 0; for (let i = 0; i < n; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, n)); };

// Quellsekunde eines Audio-Clips zur Projekt-Beat b (P7): gewarpt über die Marker, sonst offset_s und Projekttempo
export function quellSek(clip, b, tempo) {
  return clip.warp?.an === true
    ? quellSekunde(clip.warp.marker, b - clip.start_beat + clip.warp.versatz_beats)
    : clip.offset_s + (b - clip.start_beat) * 60 / tempo;
}
// F0 aus dem Original am Bereichsanfang (D5)
export const f0Von = (orig, von, tempo) => Math.round(quellSek(orig, von, tempo) * SR);
// Z3: größte Abweichung in Samples |W_stem(b) + f0/SR − W_orig(b)| an `schritte` + 1 Beats von `von` bis `bis`; f0 überschreibbar (NK3: f0 + 48)
export function lageMax(orig, stem, von, bis, tempo, { schritte = 128, f0 = f0Von(orig, von, tempo) } = {}) {
  let max = 0, stelle = von;
  for (let i = 0; i <= schritte; i++) {
    const b = von + (bis - von) * i / schritte;
    const d = Math.abs((quellSek(stem, b, tempo) + f0 / SR - quellSek(orig, b, tempo)) * SR);
    if (d > max) { max = d; stelle = b; }
  }
  return { max, stelle, f0, punkte: schritte + 1 };
}
export const Z3_MAX_SAMPLES = 1, NK3_MIN_SAMPLES = 40;
export const z3Ok = (r) => r.punkte === 129 && r.max <= Z3_MAX_SAMPLES;
export const nk3Ok = (r) => r.max >= NK3_MIN_SAMPLES;

export const f64 = (x) => Float64Array.from(x);
// Rest jedes Einsatzes (Sekunden, ab Exportbeginn bei Beat `vonBeat`) zum FESTEN 1/16-Raster des Projekts,
// ohne Phasenfit, in ms mit Vorzeichen (+ = nach dem Raster)
export function restFestMs(t, bpm, vonBeat) {
  const P = 60 / bpm / 4, t0 = ((-vonBeat * 60 / bpm) % P + P) % P;     // Rasterpunkte liegen bei Beat k/4; der Export beginnt bei vonBeat
  return t.map((x) => (x - (t0 + Math.round((x - t0) / P) * P)) * 1000);
}

// --- Z4: Einsätze. Die globale Re-Arm-Logik von w3a_messen.anschlaege zählt in einer Mischung (Bass über etwa -17 dB der Kick-Spitze)
// nur 1 statt 64 Einsätze (Review T11, gemessen). Gewählt (Begründung): (1) beide Signale gleich hochpassen (500 Hz wie proben/07 b_timemap.py):
// das nimmt den dauernden tiefen Anteil, der die Hüllkurve oben hält; (2) die Drums-Anschläge einzeln auf dem Drums-Stem finden (dort ist
// nichts anderes), dann für jeden die Einsatzzeit in BEIDEN Signalen LOKAL im Fenster ±20 ms suchen, relativ zum Boden des Fensters, ohne
// globale Sperre. Beide Signale laufen durch dieselbe Rechnung, ein Eigenversatz des Detektors hebt sich im Unterschied auf.
export function hochpass(x, fc = 500, rate = SR) {   // RBJ-Biquad, Butterworth-Güte, nur vorwärts (gleiche Verzögerung für beide Signale)
  const w = 2 * Math.PI * fc / rate, al = Math.sin(w) / (2 * Math.SQRT1_2), c = Math.cos(w), a0 = 1 + al;
  const b0 = (1 + c) / 2 / a0, b1 = -(1 + c) / a0, b2 = b0, a1 = -2 * c / a0, a2 = (1 - al) / a0;
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
// Einsatzzeit (Sekunden) in x nahe t: Hüllkurve (RMS, fensterMs) im Fenster t ± halbMs; Spitze suchen, Boden = Minimum davor,
// Einsatz = erster Punkt der letzten steigenden Flanke vor der Spitze über Boden + schwelle·(Spitze − Boden). null = kein Anstieg (Spitze < 1,2 · Boden).
// hub = Spitze − Boden (Maß für die Größe des Anstiegs).
export function lokalerEinsatzMitHub(x, t, { halbMs = 20, fensterMs = 2, schwelle = 0.3 } = {}) {
  const n = Math.max(1, Math.floor(SR * fensterMs / 1000)), h = n >> 1, mitte = Math.round(t * SR), halb = Math.round(SR * halbMs / 1000);
  const a = Math.max(0, mitte - halb), b = Math.min(x.length, mitte + halb);
  if (b - a < 4) return null;
  const e = new Float64Array(b - a);
  for (let i = a; i < b; i++) {
    const p = Math.max(0, i - h), q = Math.min(x.length, i - h + n);
    let s = 0;
    for (let k = p; k < q; k++) s += x[k] * x[k];
    e[i - a] = Math.sqrt(s / n);
  }
  let ip = 0;
  for (let i = 1; i < e.length; i++) if (e[i] > e[ip]) ip = i;
  let boden = e[ip];
  for (let i = 0; i <= ip; i++) boden = Math.min(boden, e[i]);
  const spitze = e[ip];
  if (!(spitze > 0) || spitze < 1.2 * boden) return null;
  const thr = boden + schwelle * (spitze - boden);
  let i = ip;
  while (i > 0 && e[i - 1] >= thr) i--;
  return { t: (a + i) / SR, hub: spitze - boden };
}
export const lokalerEinsatz = (x, t, o) => lokalerEinsatzMitHub(x, t, o)?.t ?? null;
export const einsaetzeLokal = (x, zeiten) => zeiten.map((t) => lokalerEinsatz(x, t));
// Z4/Z4b aus zwei Einsatzlisten (gleich lang, null = nicht gefunden); n = Paare, in denen beide gefunden wurden; nDrums = Zahl der Drums-Anschläge
export function vergleichAusEinsaetzen(eD, eO, bpm, vonBeat) {
  const paare = eD.map((d, i) => [d, eO[i]]).filter(([d, o]) => d !== null && o !== null && d !== undefined && o !== undefined);
  const dms = paare.map(([d, o]) => (o - d) * 1000), abs = dms.map(Math.abs);
  const md = median(restFestMs(paare.map(([d]) => d), bpm, vonBeat)), mo = median(restFestMs(paare.map(([, o]) => o), bpm, vonBeat));
  return { n_drums: eD.length, n: paare.length, p90_ms: p90(abs), max_ms: abs.length ? Math.max(...abs) : NaN, median_delta_ms: median(dms),
    median_drums_ms: md, median_orig_ms: mo, median_diff_ms: Math.abs(md - mo) };
}
// Drums-Signal gegen Original-Signal (ein Kanal): Anschläge global nur auf den Drums, Einsätze lokal in beiden; verschiebe = Drums um so viele Samples später
export function anschlagMessung(drums, orig, bpm, vonBeat, verschiebe = 0) {
  let d = hochpass(drums);
  if (verschiebe > 0) { const v = new Float64Array(d.length); v.set(d.subarray(0, d.length - verschiebe), verschiebe); d = v; }
  const o = hochpass(orig), tD = anschlaege(d, SR);
  // Im Original gilt ein Einsatz nur, wenn sein Anstieg mindestens HUB_ANTEIL des Drums-Anstiegs hat: sonst zählt das Hüllkurvenzittern
  // eines tiefen Dauertons (Original ohne Drums) als "Treffer" (gemessen an der Synthese: 61 von 64 Scheintreffern).
  const eD = [], eO = [];
  for (const t of tD) {
    const a = lokalerEinsatzMitHub(d, t), b = lokalerEinsatzMitHub(o, t);
    eD.push(a?.t ?? null); eO.push(a && b && b.hub >= HUB_ANTEIL * a.hub ? b.t : null);
  }
  return vergleichAusEinsaetzen(eD, eO, bpm, vonBeat);
}
export const HUB_ANTEIL = 0.1;   // -20 dB: auch ein leiser Drum-Anteil im Mix hebt die Hüllkurve um mehr als ein Zehntel des Stem-Anstiegs
export const Z4_P90_MS = 1, Z4_MIN_N = 16, Z4_ANTEIL = 0.75, Z4B_MS = 1, NK4_MIN_MS = 4;
// Vorab (Z4a): genug Drums-Anschläge und genug davon im Original wiedergefunden
export const z4aOk = (r) => r.n >= Z4_MIN_N && r.n >= Z4_ANTEIL * r.n_drums;   // n ≤ n_drums, also folgt n_drums ≥ 16
export const z4Ok = (r) => z4aOk(r) && r.p90_ms <= Z4_P90_MS;
export const z4bOk = (r) => z4aOk(r) && r.median_diff_ms <= Z4B_MS;
export const nk4Ok = (r) => z4aOk(r) && r.p90_ms > NK4_MIN_MS;     // ohne genug Paare ist "schlägt an" trügerisch

// M1: Wirkung von Mute und stumm im Export. B = nur Drums, C = vier Stems (Quelle stumm), O = nur Original; je Kanal.
// B gegen C und B gegen O müssen sich messbar unterscheiden: rms(Differenz)/rms(Referenz) >= -30 dB (die drei anderen Stems tragen mindestens 3 %
// des Pegels; Rechenrauschen der Float32-Kette liegt unter -100 dB, das Z5-Gütemaß -20 dB liegt darüber). C gegen O müssen SICH NICHT unterscheiden
// (Z5), aber auch nicht verdoppeln: wirkt stumm nicht (oder bleiben Stems im Original-Export hörbar), steigt der Pegel um 6 dB; Tor |Pegel| <= 3 dB.
export const WIRKUNG_MIN_DB = -30, PEGEL_MAX_DB = 3;
export const pegelDb = (a, b) => 20 * Math.log10(rms(a) / rms(b));
export function wirkung(B, C, O) {
  return { b_c_db: restDb(B, C), b_o_db: restDb(B, O), c_o_pegel_db: pegelDb(C, O) };
}
export const wirkungOk = (w) => w.b_c_db >= WIRKUNG_MIN_DB && w.b_o_db >= WIRKUNG_MIN_DB && Math.abs(w.c_o_pegel_db) <= PEGEL_MAX_DB;

// Z5: 20·log10(rms(Summe − Original)/rms(Original)) über die kürzere Länge; Summe = Stems sample-weise addiert
export function summe(...xs) {
  const n = Math.min(...xs.map((x) => x.length)), s = new Float64Array(n);
  for (const x of xs) for (let i = 0; i < n; i++) s[i] += x[i];
  return s;
}
export function restDb(sum, orig) {
  const n = Math.min(sum.length, orig.length), d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = sum[i] - orig[i];
  const ro = rms(orig, n);
  return ro > 0 ? 20 * Math.log10(Math.max(rms(d, n), 1e-12) / ro) : NaN;
}
export const Z5_RICHTWERT_DB = -20;

// Z6: der vergleichbare Stand (Spuren mit Mute, Clips mit stumm; Zahl der Gruppen)
export const standSchluessel = (p) => JSON.stringify({
  spuren: p.spuren.map((s) => [s.id, !!s.mute, s.clips.map((c) => [c.id, !!c.stumm])]),
  gruppen: (p.gruppen ?? []).length });
