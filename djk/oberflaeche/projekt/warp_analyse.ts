// Paket 1.13 Warp, Slice 3a: Analyse auf Abruf, die reinen Entscheidungen. brauchtAnalyse (T4): wann ein Auto-Warp eine Analyse anfordert;
// ankunftBefehle (Task 13): was bei Ankunft der Karte am Clip zu tun ist.
import { autoWarp, type AutoErgebnis, type TempoQuelle } from './warp.ts';
import type { AudioClip, Warp } from './modell.ts';

export const ANALYSE_AB_S = 60;   // „lang“: nur Tracks ab einer Minute (Loops und One-Shots haben nie eine Karte, E-S 2)

// Ein Auftrag lohnt, wenn der Track lang ist, keine Karte da ist (auch keine unbrauchbare: dieselbe Analyse gäbe dieselbe Karte) und die beste Quelle nur der
// Mediathek-Warp, die Takte oder gar nichts ist. Ein Traktor-Raster genügt (Spec 5.5: Quelle 2; es ist von Hand korrigierbar).
// D1 (F2): der Clip bekommt trotzdem sofort den Warp der besten Quelle (loeseQuellenAuf); gerufen wird nur, solange die Analyse nicht gescheitert ist.
export function brauchtAnalyse(q: TempoQuelle, r: AutoErgebnis): boolean {
  if (q.typ !== 'track' || typeof q.dauer_s !== 'number' || !(q.dauer_s >= ANALYSE_AB_S)) return false;
  if (q.karte) return false;
  if (r === null) return false;
  if ('warp' in r) return r.warp.quelle === 'takte' || r.warp.quelle === 'mediathek';
  return true;   // { hinweis: 'kein_tempo' }
}

// Der Stand beim Auftrag: Warp (oder keiner) und Länge des Clips
export interface AnalyseStand { warp: Warp | null; laenge_beats: number }
// T11: „unangefasst“ = die Teile, die der Auto-Warp selbst gesetzt hat, sind noch dieselben. an, modus, transpose_st, detune_ct darf der Nutzer ändern.
const unangefasst = (jetzt: Warp | null, vorher: Warp | null): boolean => {
  if (jetzt === null || vorher === null) return jetzt === vorher;
  return jetzt.quelle === vorher.quelle && jetzt.versatz_beats === vorher.versatz_beats && (jetzt.eins_unsicher === true) === (vorher.eins_unsicher === true)
    && jetzt.marker.length === vorher.marker.length && jetzt.marker.every((m, i) => m[0] === vorher.marker[i][0] && m[1] === vorher.marker[i][1]);
};
export type Ankunft = { befehle: Record<string, unknown>[] } | { lassen: 'angefasst' | 'keine_karte' | 'schon_werkstatt' };
// Was bei Ankunft der Karte am Clip zu tun ist; q trägt die Karte (tempoQuelleFuer nach dem Ende der Analyse)
export function ankunftBefehle(clip: AudioClip, vorher: AnalyseStand, q: TempoQuelle): Ankunft {
  const jetzt = clip.warp ?? null;
  if (!unangefasst(jetzt, vorher.warp)) return { lassen: 'angefasst' };
  if (jetzt?.quelle === 'werkstatt') return { lassen: 'schon_werkstatt' };
  const r = autoWarp(q);
  if (r === null || !('warp' in r) || r.warp.quelle !== 'werkstatt') return { lassen: 'keine_karte' };
  const warp: Warp = { ...r.warp, ...(jetzt ? { an: jetzt.an, modus: jetzt.modus, transpose_st: jetzt.transpose_st, detune_ct: jetzt.detune_ct,
    ...(jetzt.beats ? { beats: structuredClone(jetzt.beats) } : {}) } : {}) };
  const befehle: Record<string, unknown>[] = [{ befehl: 'warp_setzen', clip_id: clip.id, warp }];
  if (clip.laenge_beats === vorher.laenge_beats && Math.abs(r.laenge_beats - clip.laenge_beats) > 1e-9) {
    befehle.push({ befehl: 'clip_aendern', clip_id: clip.id, laenge_beats: r.laenge_beats });   // nur wenn der Nutzer die Länge nicht angefasst hat
  }
  return { befehle };
}
// D1: klingt der Clip gerade? Der Transport spielt (status 2; 0 steht, 1 wartet, 3 Freeze) und der Kopf liegt im Clip. arr ist lage.arr (der letzte Stand aus
// /zustand/arr, beim Spielen 50 Hz); null = der Kern hat nichts gemeldet. Strukturtyp statt ArrZustand: warp_analyse.ts kennt den Bereich proj nicht.
export function klingtGerade(arr: { status: number; projekt_beat: number } | null, clip: { start_beat: number; laenge_beats: number }): boolean {
  if (arr === null || arr.status !== 2) return false;
  return arr.projekt_beat >= clip.start_beat && arr.projekt_beat < clip.start_beat + clip.laenge_beats;
}
