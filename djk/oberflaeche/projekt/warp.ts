// Warp-Abbildung W(b) und Auto-Warp (Paket 1.13 Warp, Slice 1, ADR 031). Reine Funktionen, kein Server, keine Datei.
// Marker [quell_s, beat]: Quellsekunde und Clip-Beat, beide streng steigend. W(b) ist zwischen zwei Markern linear, davor und danach
// gilt das Randsegment weiter. Dieselbe Rechnung steht in kern/include/cypherdj/warp_abbildung.h (dort in Frames) und in
// oeffentlich/produktion/warp.js; die Referenzdatei vertrag/warp_referenz.json bindet die drei (tests/warp_abbildung.test.mjs).
import type { Warp } from './modell.ts';

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

// --- Auto-Warp (Slice 1: Quellen takte und mediathek; werkstatt und traktor kommen mit Slice 3) --------------------------------------
export const SEGMENT_BPM_MIN = 15;      // 0,25 · 60 BPM; mit SEGMENT_BPM_MAX gilt für jedes Projekttempo 60..200 der Faktor 0,25 bis 4
export const SEGMENT_BPM_MAX = 800;     // 4 · 200 BPM
export interface TempoQuelle { typ: string | null; bpm: number | null; takte: number | null; dauer_s: number | null }
export type AutoErgebnis =
  | { warp: Warp; laenge_beats: number }
  | { hinweis: 'kein_tempo' }
  | null;                                // bewusst ohne Warp (One-Shot und andere Typen ohne Tempo)
const WARP_TYPEN = new Set(['loop', 'track']);
const gut = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;

// Spec 1.13 Festlegung 5: loop und track warpen, One-Shots nie. Ein Loop mit takte (und passender Dauer) wird auf takte · 4 Beats
// gelegt (Quelle takte), sonst gilt die BPM der Mediathek (Quelle mediathek, Anfang bei Sekunde 0; bei einem Track ist die Takt-Eins
// damit unbekannt: eins_unsicher). Ohne Tempo oder mit einem Segment-Tempo außerhalb 15..800 BPM: Hinweis kein_tempo.
export function autoWarp(q: TempoQuelle): AutoErgebnis {
  if (q.typ === null || !WARP_TYPEN.has(q.typ)) return null;
  if (!gut(q.dauer_s)) return { hinweis: 'kein_tempo' };
  const dauer = q.dauer_s;
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
  const warp: Warp = { an: true, modus: 'repitch', marker: [[0, 0], [dauer, beats]], versatz_beats: 0, quelle, transpose_st: 0, detune_ct: 0,
    ...(unsicher ? { eins_unsicher: true } : {}) };
  return { warp, laenge_beats: beats };
}
