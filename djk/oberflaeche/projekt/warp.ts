// Warp-Abbildung W(b) und Auto-Warp (Paket 1.13 Warp, Slice 1, ADR 031). Reine Funktionen, kein Server, keine Datei.
// Marker [quell_s, beat]: Quellsekunde und Clip-Beat, beide streng steigend. W(b) ist zwischen zwei Markern linear, davor und danach
// gilt das Randsegment weiter. Dieselbe Rechnung steht in kern/include/cypherdj/warp_abbildung.h (dort in Frames) und in
// oeffentlich/produktion/warp.js; die Referenzdatei vertrag/warp_referenz.json bindet die drei (tests/warp_abbildung.test.mjs).
import type { Warp } from './modell.ts';
import { BEATS_VORGABE } from './modell.ts';   // Wert: Zyklus modell.ts <-> warp.ts, unschädlich (beide nutzen die Werte nur in Funktionen)

export type Marker = readonly [number, number];

// Index i des Segments [marker[i], marker[i+1]) mit marker[i][1] <= b; vor dem ersten Marker 0, hinter dem letzten n − 2
export function segmentVon(marker: readonly Marker[], b: number): number {
  let lo = 0, hi = marker.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (marker[mid][1] <= b) lo = mid; else hi = mid - 1;
  }
  return lo;
}
// Quellsekunde zum Clip-Beat b
export function quellSekunde(marker: readonly Marker[], b: number): number {
  const i = segmentVon(marker, b), [s0, b0] = marker[i], [s1, b1] = marker[i + 1];
  return s0 + (b - b0) * (s1 - s0) / (b1 - b0);
}
// Umkehrung: Clip-Beat zur Quellsekunde s
export function beatBeiQuelle(marker: readonly Marker[], s: number): number {
  let lo = 0, hi = marker.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (marker[mid][0] <= s) lo = mid; else hi = mid - 1;
  }
  const [s0, b0] = marker[lo], [s1, b1] = marker[lo + 1];
  return b0 + (s - s0) * (b1 - b0) / (s1 - s0);
}
// Tempo des Segments i in BPM (Beats je Minute der Quelle)
export function segmentBpm(marker: readonly Marker[], i: number): number {
  const [s0, b0] = marker[i], [s1, b1] = marker[i + 1];
  return 60 * (b1 - b0) / (s1 - s0);
}

// --- Auto-Warp (Slice 1: takte und mediathek; Slice 3a: Werkstatt-Karte, später Traktor) ---------------------------------------------
// Segment-Tempo-Band: absolut 15..800 BPM. Spec 5.1 sagt „Faktor 0,25 bis 4 zum Projekttempo“; gebaut ist die Vereinigung über alle Projekttempi 60..200
// (Entscheidung D4 des Plans Slice 3a: so lassen und die Spec berichtigen). Für ein bestimmtes Projekttempo ist das Band weiter als 0,25..4.
export const SEGMENT_BPM_MIN = 15;      // 0,25 · 60 BPM
export const SEGMENT_BPM_MAX = 800;     // 4 · 200 BPM
export const MAX_KARTE = 4096;          // = MAX_MARKER (modell.ts importiert diese Datei, darum keine Rückrichtung)
// Slice 3a: was die Quellen-Leser liefern (Task 1; dieser Text ersetzt die dort eingefügten Zeilen). Karte: Marker [quell_s, beat] mit Beat 0 = erste Eins
// (Karten-Beat minus erste_eins_quell_beat); Traktor: Anker (erster Schlag) und konstantes BPM. Reine Daten.
export interface KartenDaten { marker: [number, number][]; eins_unsicher: boolean }
export interface TraktorRaster { anker_s: number; bpm: number }
export interface TempoQuelle {
  typ: string | null; bpm: number | null; takte: number | null; dauer_s: number | null;
  instrument?: string | null; kategorie?: string | null;   // Slice 2 (D10): unterscheiden Drum-Loops von melodischen
  karte?: KartenDaten | null;                              // Slice 3a: Werkstatt-Karte (leseKarte)
  traktor?: TraktorRaster | null;                          // Slice 3a: Raster aus Traktor (leseTraktor)
}
export type KartenHinweis = 'karte_zu_gross' | 'karte_unbrauchbar';
// warp + laenge_beats: die Quelle hat Marker geliefert (karten_hinweis: eine bessere Quelle war da, taugte aber nicht);
// hinweis: kein Tempo; null: bewusst ohne Warp
export type AutoErgebnis =
  | { warp: Warp; laenge_beats: number; karten_hinweis?: KartenHinweis }
  | { hinweis: 'kein_tempo' }
  | null;                                // bewusst ohne Warp (One-Shot und andere Typen ohne Tempo)
const WARP_TYPEN = new Set(['loop', 'track']);
const gut = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;

// Slice 2, D10 (Andreas 2026-10-25: „wir brauchen in jedem fall tonhöhen korrektur, sonst passen die tonlagen nicht mehr zusammen“):
// Tracks und melodische Loops warpen mit COMPLEX (Tonhöhe bleibt). Drum-Loops bleiben RE-PITCH, bis die Hörprobe von Task 14 (Drums COMPLEX gegen RE-PITCH)
// entscheidet. Drum-Loop heißt: Instrument aus DRUM_INSTRUMENTE oder eine Kategorie mit „drum“, „perc“, „top loop“ oder „hi loop“; ein Loop ohne beide
// Angaben gilt als melodisch (Tonhöhe halten ist dort der sichere Fehler: ein verschmierter Transient statt einer falschen Tonart).
export const DRUM_INSTRUMENTE = new Set(['perc', 'hihat', 'kick', 'snare', 'clap', 'ride', 'crash', 'tom', 'cymbal', 'drums', 'drum', 'fill']);
export function istDrumLoop(q: TempoQuelle): boolean {
  if (q.typ !== 'loop') return false;
  const i = (q.instrument ?? '').trim().toLowerCase(), k = (q.kategorie ?? '').toLowerCase();
  return DRUM_INSTRUMENTE.has(i) || /drum|perc|top loop|hi loop/.test(k);
}

type Modus = Warp['modus'];
// Slice 3a (T1, T3): die Karte der Werkstatt, alle Schläge als Marker. Unbrauchbar (nie still kürzen, nie die Anlage abbrechen): mehr als 4096 Marker, ein
// Wert nicht endlich oder negativ, Quellzeit oder Beat nicht streng steigend, ein Segment außerhalb 15..800 BPM. Länge = Eins bis Dateiende (D2): der Beat
// der Dateilänge im Randsegment hinter dem letzten Marker.
export function kartenWarp(k: KartenDaten, dauer: number, modus: Modus): { warp: Warp; laenge_beats: number } | { hinweis: KartenHinweis } {
  const m = k.marker;
  if (m.length > MAX_KARTE) return { hinweis: 'karte_zu_gross' };
  if (m.length < 2) return { hinweis: 'karte_unbrauchbar' };
  for (let i = 0; i < m.length; i++) {
    if (!Number.isFinite(m[i][0]) || !Number.isFinite(m[i][1]) || m[i][0] < 0) return { hinweis: 'karte_unbrauchbar' };
    if (i === 0) continue;
    if (!(m[i][0] > m[i - 1][0] && m[i][1] > m[i - 1][1])) return { hinweis: 'karte_unbrauchbar' };
    const bpm = 60 * (m[i][1] - m[i - 1][1]) / (m[i][0] - m[i - 1][0]);
    if (!(bpm >= SEGMENT_BPM_MIN && bpm <= SEGMENT_BPM_MAX)) return { hinweis: 'karte_unbrauchbar' };
  }
  const beats = beatBeiQuelle(m, dauer);
  if (!(beats > 0)) return { hinweis: 'karte_unbrauchbar' };
  const warp: Warp = { an: true, modus, marker: m.map((p): [number, number] => [p[0], p[1]]), versatz_beats: 0, quelle: 'werkstatt',
    transpose_st: 0, detune_ct: 0, ...(k.eins_unsicher ? { eins_unsicher: true } : {}) };
  return { warp, laenge_beats: beats };
}

// Slice 3a (T5): Traktor-Raster. Beat 0 ist der Anker (der erste Schlag; eine Takt-Eins kennt Traktor nicht: immer eins_unsicher), der zweite Marker
// liegt auf dem letzten vollen Beat vor dem Dateiende. Unbrauchbar (Anker hinter der Datei oder negativ, BPM außerhalb 15..800, weniger als ein
// voller Beat): null.
export function traktorWarp(t: TraktorRaster, dauer: number, modus: Modus): { warp: Warp; laenge_beats: number } | null {
  if (!gut(t.bpm) || !Number.isFinite(t.anker_s) || t.anker_s < 0 || t.anker_s >= dauer) return null;
  if (!(t.bpm >= SEGMENT_BPM_MIN && t.bpm <= SEGMENT_BPM_MAX)) return null;
  const n = Math.floor((dauer - t.anker_s) * t.bpm / 60);
  if (n < 1) return null;
  const marker: [number, number][] = [[t.anker_s, 0], [t.anker_s + n * 60 / t.bpm, n]];
  const warp: Warp = { an: true, modus, marker, versatz_beats: 0, quelle: 'traktor', transpose_st: 0, detune_ct: 0, eins_unsicher: true };
  return { warp, laenge_beats: beatBeiQuelle(marker, dauer) };
}

// Spec 1.13 Festlegung 5 und 5.5: loop und track warpen, One-Shots nie. Reihenfolge der Quellen: Werkstatt-Karte (alle Schläge, Beat 0 = erste Eins), danach
// das Traktor-Raster, dann takte (Loop mit takte und passender Dauer auf takte · 4 Beats), dann die BPM der Mediathek (Anfang bei Sekunde 0; bei einem
// Track ist die Takt-Eins damit unbekannt: eins_unsicher). Keine Quelle oder ein Segment-Tempo außerhalb 15..800 BPM: Hinweis kein_tempo.
export function autoWarp(q: TempoQuelle): AutoErgebnis {
  if (q.typ === null || !WARP_TYPEN.has(q.typ)) return null;
  if (!gut(q.dauer_s)) return { hinweis: 'kein_tempo' };
  const dauer = q.dauer_s;
  const modus: Modus = istDrumLoop(q) ? 'repitch' : 'complex';   // D10 (Nachbesserung 4)
  let karten_hinweis: KartenHinweis | undefined;
  if (q.karte) {
    const k = kartenWarp(q.karte, dauer, 'complex');   // D5: mit Karte immer COMPLEX (RE-PITCH zieht die Tonhöhe mit dem Tempo mit)
    if ('warp' in k) return k;
    karten_hinweis = k.hinweis;
  }
  if (q.traktor) {
    const t = traktorWarp(q.traktor, dauer, modus);
    if (t) return { ...t, ...(karten_hinweis ? { karten_hinweis } : {}) };
  }
  const ausTakten = gut(q.takte) ? q.takte * 4 : null;
  // takte gilt, wenn die BPM fehlt oder die Dauer höchstens einen halben Beat von takte · 4 Beats entfernt ist (sonst Anhang oder Stille am Ende)
  const nimmTakte = ausTakten !== null && (!gut(q.bpm) || Math.abs(dauer * q.bpm / 60 - ausTakten) <= 0.5);
  let beats: number, quelle: 'takte' | 'mediathek';
  if (nimmTakte) { beats = ausTakten as number; quelle = 'takte'; }
  else if (gut(q.bpm)) { beats = dauer * q.bpm / 60; quelle = 'mediathek'; }
  else return { hinweis: 'kein_tempo' };
  const bpm = 60 * beats / dauer;
  if (!(bpm >= SEGMENT_BPM_MIN && bpm <= SEGMENT_BPM_MAX)) return { hinweis: 'kein_tempo' };
  const unsicher = quelle === 'mediathek' && q.typ === 'track';
  const warp: Warp = { an: true, modus, marker: [[0, 0], [dauer, beats]], versatz_beats: 0, quelle, transpose_st: 0, detune_ct: 0,
    ...(unsicher ? { eins_unsicher: true } : {}) };
  return { warp, laenge_beats: beats, ...(karten_hinweis ? { karten_hinweis } : {}) };
}

// --- Slice 3b: Marker von Hand (reine Funktionen; die Befehle in befehle.ts und der Server rufen sie) ---------------------------------------
// Eine Ablehnung ist ein WarpFehler mit dem Grund des Befehls (befehle.ts macht daraus einen BefehlFehler).
export class WarpFehler extends Error {
  readonly grund: string;
  constructor(grund: string, text: string) { super(text); this.grund = grund; }
}
const EPS_BEAT = 1e-6;                         // zwei Marker-Beats näher als das gelten als derselbe Marker
const runde9 = (x: number): number => Math.round(x * 1e9) / 1e9;
const ausMarker = (m: readonly Marker[]): [number, number][] => m.map((p): [number, number] => [p[0], p[1]]);
export const handWarp = (w: Warp, marker: [number, number][], extra: Partial<Warp> = {}): Warp => ({ ...w, ...extra, marker, quelle: 'hand' });

// ×2 / :2 (Spec 5.5): die Beats aller Marker und der Versatz werden mit dem Faktor multipliziert, die Quellzeiten bleiben. Jedes Segment-Tempo wird
// damit mit dem Faktor multipliziert; dieselbe Stelle der Quelle liegt dann bei doppelt (halb) so vielen Clip-Beats. Den Clip (Länge, Loop)
// rechnet der Befehl um (befehle.ts). Mit 2 und 0,5 sind alle Produkte exakt.
export function tempoSkalieren(w: Warp, faktor: number): Warp {
  if (faktor !== 2 && faktor !== 0.5) throw new WarpFehler('argument_ungueltig', 'faktor: 2 or 0.5 expected');
  return handWarp(w, w.marker.map((p): [number, number] => [p[0], p[1] * faktor]), { versatz_beats: w.versatz_beats * faktor });
}

export interface MarkerSetze { quell_s: number; beat?: number }
export interface MarkerVerschiebe { beat: number; neu_beat?: number; neu_quell_s?: number }
export interface MarkerAenderung { setze?: MarkerSetze[]; loesche?: number[]; verschiebe?: MarkerVerschiebe[] }
const index = (m: readonly Marker[], beat: number): number => {
  const i = m.findIndex((p) => Math.abs(p[1] - beat) <= EPS_BEAT);
  if (i < 0) throw new WarpFehler('marker_unbekannt', `no marker at beat ${beat}`);
  return i;
};
// Reihenfolge: erst löschen, dann verschieben, dann setzen; löschen und verschieben nennen den Marker mit seinem Beat vor dem Befehl. Ein gesetzter
// Marker ohne beat liegt auf dem Beat, den das Raster dort vor dem Befehl hat (der Klang ändert sich nicht). Ergebnis nach Quellzeit sortiert; ob es
// streng steigt, prüft warpPruefung (ein Marker über seinen Nachbarn hinaus gibt warp_marker).
export function markerAendern(marker: readonly Marker[], a: MarkerAenderung): [number, number][] {
  let m = ausMarker(marker);
  const weg = new Set<number>();
  for (const b of a.loesche ?? []) weg.add(index(marker, b));
  const bewegt = new Map<number, [number, number]>();
  for (const v of a.verschiebe ?? []) {
    const i = index(marker, v.beat);
    if (weg.has(i)) throw new WarpFehler('marker_unbekannt', `marker at beat ${v.beat} is deleted in the same command`);
    if ((v.neu_beat === undefined) === (v.neu_quell_s === undefined)) {
      throw new WarpFehler('argument_ungueltig', 'verschiebe: exactly one of neu_beat and neu_quell_s');
    }
    bewegt.set(i, [v.neu_quell_s ?? marker[i][0], v.neu_beat ?? marker[i][1]]);
  }
  m = m.flatMap((p, i): [number, number][] => (weg.has(i) ? [] : [bewegt.get(i) ?? p]));
  for (const s of a.setze ?? []) {
    const beat = s.beat ?? runde9(beatBeiQuelle(marker, s.quell_s));
    m.push([s.quell_s, beat]);
  }
  return m.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}

// Warp From Here (Straight): ab clip-Beat `beat` ein einziges Segment mit dem Tempo, das dort gilt, bis zur letzten Quellzeit. Liegt `beat` nicht
// vor dem letzten Marker (dort gibt es nichts zu begradigen) ist das Ergebnis null.
export function abHierGerade(marker: readonly Marker[], beat: number): [number, number][] | null {
  const n = marker.length, sLetzt = marker[n - 1][0];
  const nah = marker.findIndex((p) => Math.abs(p[1] - beat) <= EPS_BEAT);
  const s = nah >= 0 ? marker[nah][0] : quellSekunde(marker, beat), b = nah >= 0 ? marker[nah][1] : beat;
  if (!(s < sLetzt)) return null;
  const bpm = segmentBpm(marker, segmentVon(marker, b));
  const links = marker.filter((p) => p[1] < b - EPS_BEAT && p[0] < s);
  return [...ausMarker(links), [s, b], [sLetzt, runde9(b + (sLetzt - s) * bpm / 60)]];
}

// Set 1.1.1 Here: die Stelle `quellS` der Quelle wird Beat 0. Alle Beats rücken um den Beat, den die Stelle bisher hatte (auf einen ganzen Beat
// gerundet, wenn sie näher als EPS_BEAT daran liegt: die Marker der Karte liegen auf ganzen Beats). Der Klang ändert sich nicht, nur die Zählung.
// Der Versatz bleibt, der Clip beginnt danach also an der neuen Eins (seine Länge folgt dem Befehl). eins_unsicher ist erledigt.
export function einsHier(w: Warp, quellS: number): { warp: Warp; verschoben: number } {
  const roh = beatBeiQuelle(w.marker, quellS), ganz = Math.round(roh);
  const b = Math.abs(roh - ganz) <= EPS_BEAT ? ganz : roh;
  return { warp: handWarp(w, w.marker.map((p): [number, number] => [p[0], runde9(p[1] - b)]), { eins_unsicher: false }), verschoben: b };
}

// Das Tempo, bei dem der Clip so lang klingt wie das Stück der Quelle, das er spielt: Beats des Fensters durch Sekunden
// (60 · Länge / (W(v + L) − W(v))). Bei einer Geraden ist das ihr Tempo, bei einer Karte mit Schwankung das Mittel über das gespielte Stück (nicht
// das Segment am Anfang, das bei einer Karte ein Zufallswert ist, Plan Slice 3a E-Se). Auf drei Stellen gerundet.
export function fensterTempo(w: Warp, laenge_beats: number): number {
  const sek = quellSekunde(w.marker, w.versatz_beats + laenge_beats) - quellSekunde(w.marker, w.versatz_beats);
  return Math.round(60 * laenge_beats / sek * 1000) / 1000;
}

// Warp From Here (Start): ab clip-Beat `beat` gilt der Auto-Warp neu. `auto` sind die Marker des Auto-Warps (eigene Zählung, Beat 0 = seine Eins);
// sie werden so verschoben, dass sie an der Stelle der Quelle, die jetzt bei `beat` klingt, denselben Beat haben wie der Clip: das Raster rastet
// dort ohne Sprung ein. Links bleiben die Marker des Clips. Hat `auto` hinter dieser Stelle keinen Marker: null (kein Tempo für den Rest).
export function abHierStart(marker: readonly Marker[], beat: number, auto: readonly Marker[]): [number, number][] | null {
  const s = quellSekunde(marker, beat);
  const rechts = auto.filter((p) => p[0] > s + 1e-9);
  if (rechts.length === 0 || auto.length < 2) return null;
  const d = beat - beatBeiQuelle(auto, s);
  const links = marker.filter((p) => p[1] < beat - EPS_BEAT && p[0] < s);
  return [...ausMarker(links), [s, beat], ...rechts.map((p): [number, number] => [p[0], runde9(p[1] + d)])];
}

export const MAX_BEATS_EINHEITEN = 32_768;   // je Clip (D9); 15 min bei 200 BPM auf 1/32 sind 24 000
// D12 (Fix-Runde Slice 4): im Modus transienten beginnt jede Transienten-Einheit 3 ms vor dem Treffer des Detektors. Herkunft: an echten Loops (Messung der
// Hauptinstanz 2026-10-30) liegt der Treffer im Median am Fuß des Anschlags, im p90 aber 1,6 bis 4,2 ms dahinter, weil er auf der Hälfte des Höchstwerts im
// Suchfenster sitzt (projekt/transienten.ts). Ohne Vorlauf höre man bei langsamem Anschlag eine Einheit, die erst nach dem Beginn des Schlags anfängt. 3 ms
// decken den p90 bis auf den Rest über 3 ms; mehr Vorlauf spielt mehr vom Ausklang der vorigen Einheit mit. quantisiere bleibt beim Treffer selbst.
export const BEATS_VORLAUF_S = 0.003;
const RASTER_BEATS: Readonly<Record<string, number>> = { '1/4': 1, '1/8': 0.5, '1/16': 0.25, '1/32': 0.125 };

// Slice 4: Einheiten des Modus BEATS als [Clip-Beat, Quellsekunde], Beats streng steigend, über [versatz_beats, versatz_beats + laenge) und nur, wo die
// Quelle bei >= 0 s liegt. Raster: je Rasterbeat eine Einheit. transienten: eine Einheit am Anfang des Bereichs, dann je Transient (Quellsekunden) eine;
// ohne Transienten (null oder leer) gilt 1/16 (D7). Die Transienten werden als Kopie aufsteigend sortiert. Wirft nie (D9): hört bei MAX_BEATS_EINHEITEN + 1
// Einträgen auf (nie mehr); die Ablehnung macht uebersetze.
export function beatsEinheiten(w: Warp, laenge_beats: number, transientenS: readonly number[] | null): [number, number][] {
  const b = w.beats ?? BEATS_VORGABE;
  const bis = w.versatz_beats + laenge_beats;
  const anfang = Math.max(w.versatz_beats, beatBeiQuelle(w.marker, 0));
  const aus: [number, number][] = [];
  const voll = (): boolean => aus.length > MAX_BEATS_EINHEITEN;
  const dazu = (beat: number, s: number): void => { aus.push([beat + 0, s + 0]); };   // + 0 macht aus -0 eine 0 (Math.ceil(-4e-9) ist -0)
  if (b.raster === 'transienten' && transientenS && transientenS.length) {
    dazu(anfang, quellSekunde(w.marker, anfang));
    let vorigeS = aus[0][1];
    for (const s of [...transientenS].sort((x, y) => x - y)) {
      const beat = beatBeiQuelle(w.marker, s);
      if (beat >= bis || voll()) break;
      if (beat <= aus[aus.length - 1][0] + 1e-9) continue;
      // Vorlauf (D12): nie vor die vorige Einheit und nie vor den Anfang; Bezug ist der vorige Treffer (am Anfang die Quelle des
      // Bereichsanfangs). Ist der Abstand dazu kleiner als 2 · Vorlauf, gilt die Hälfte des Abstands
      const sv = s - Math.min(BEATS_VORLAUF_S, (s - vorigeS) / 2), bv = beatBeiQuelle(w.marker, sv);
      if (bv > aus[aus.length - 1][0] + 1e-9) dazu(bv, sv); else dazu(beat, s);
      vorigeS = s;
    }
    return aus;
  }
  const r = RASTER_BEATS[b.raster] ?? 0.25;
  const k0 = Math.ceil((anfang - 1e-9) / r);
  // Anfang liegt nicht auf dem Raster (oder nichts im Bereich)
  if (k0 * r > anfang + 1e-9 || k0 * r >= bis - 1e-9) dazu(anfang, quellSekunde(w.marker, anfang));
  for (let k = k0; k * r < bis - 1e-9 && !voll(); k++) dazu(k * r, quellSekunde(w.marker, k * r));
  return aus;
}

// Anzahl der Einheiten ohne Liste; stimmt mit beatsEinheiten(...).length überein (der Raster-Zweig rechnet, der Transienten-Zweig zählt die Liste)
export function beatsEinheitenZahl(w: Warp, laenge_beats: number, transientenS: readonly number[] | null): number {
  const b = w.beats ?? BEATS_VORGABE;
  if (b.raster === 'transienten' && transientenS && transientenS.length) return beatsEinheiten(w, laenge_beats, transientenS).length;
  const bis = w.versatz_beats + laenge_beats;
  const anfang = Math.max(w.versatz_beats, beatBeiQuelle(w.marker, 0));
  const r = RASTER_BEATS[b.raster] ?? 0.25;
  const k0 = Math.ceil((anfang - 1e-9) / r);
  const lim = bis - 1e-9;
  const extra = (k0 * r > anfang + 1e-9 || k0 * r >= lim) ? 1 : 0;
  let kEnd = Math.ceil(lim / r);                       // erstes k mit k·r >= lim, gegen Rundung abgesichert
  while (kEnd > k0 && (kEnd - 1) * r >= lim) kEnd--;
  while (kEnd * r < lim) kEnd++;
  return Math.min(extra + Math.max(0, kEnd - k0), MAX_BEATS_EINHEITEN + 1);
}

// Slice 4 (D8): Quantize Audio. Jeder Transient s im Bereich bekommt einen Marker [s, b + staerke · (z − b)] mit b = W⁻¹(s), z = nächster Rasterbeat;
// Marker zwischen dem ersten und letzten verwendeten Transienten werden ersetzt, die anderen bleiben. Zwei auf demselben Ziel: der nähere bleibt.
// Ergäbe es keine streng steigende Liste, wirft es quantisieren_konflikt (nie still verwerfen). Die Grenzen (800 BPM, 4096 Marker) prüft der Aufrufer.
export function quantisiere(marker: readonly Marker[], transientenS: readonly number[], raster: number, staerke: number,
  bereich: { von_beat?: number; bis_beat?: number; off?: number } = {}): [number, number][] {
  // D13: das Raster gilt im Projekt. off = start_beat − versatz_beats verschiebt die Clip-Beats dorthin: z = round((b + off) / r) · r − off.
  const off = bereich.off ?? 0;
  const von = bereich.von_beat ?? marker[0][1], bis = bereich.bis_beat ?? marker[marker.length - 1][1];
  const sVon = quellSekunde(marker, von), sBis = quellSekunde(marker, bis);
  const besteJeZiel = new Map<number, { s: number; neu: number; weg: number }>();
  for (const s of transientenS) {
    if (s < sVon || s > sBis) continue;
    const b = beatBeiQuelle(marker, s), z = Math.round((b + off) / raster) * raster - off;
    const k = { s, neu: b + staerke * (z - b), weg: Math.abs(z - b) };
    const alt = besteJeZiel.get(z);
    if (!alt || k.weg < alt.weg) besteJeZiel.set(z, k);
  }
  if (!besteJeZiel.size) throw new WarpFehler('keine_transienten', 'keine_transienten: im Bereich liegt kein Transient');
  const innen = [...besteJeZiel.values()].sort((x, y) => x.s - y.s).map((k): [number, number] => [k.s, k.neu]);
  const aussen = marker.filter(([s]) => s < innen[0][0] - 1e-9 || s > innen[innen.length - 1][0] + 1e-9).map((p): [number, number] => [p[0], p[1]]);
  const aus = [...aussen, ...innen].sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < aus.length; i++) {
    if (!(aus[i][0] > aus[i - 1][0]) || !(aus[i][1] > aus[i - 1][1] + 1e-9)) {
      throw new WarpFehler('quantisieren_konflikt', 'quantisieren_konflikt: die Marker lägen nicht streng steigend');
    }
  }
  return aus;
}
