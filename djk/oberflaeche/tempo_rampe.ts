// Ein Tempo-Weg (Spec D1 2.7): die Felder von /k/tempo/rampe, wie POST /tempo sie seit dem Plan Tempo-Folge baut: Rampe ab dem nächsten
// Takt über 4 Beats, Ziel auf 0,01 BPM gerundet, 60..200. server.ts (POST /tempo) und der Bereich proj (Transport-Start, tempo_setzen)
// rechnen beide hiermit, damit es nur eine Stelle gibt, an der „ab wann, wie lange, wohin“ entschieden wird.
import { abBeat } from './deck_bedienung.ts';
import { AB } from './hand_bedienung.ts';

export const TEMPO_MIN = 60;
export const TEMPO_MAX = 200;
export const RAMPE_BEATS = 4;
export const rundeBpm = (bpm: number): number => Math.round(bpm * 100) / 100;
// Vorlauf wie server.ts abVon: 10,7 ms (zwei Zyklen bei Quantum 256) in Beats, mindestens 0,1 Beat
export const vorlaufBeats = (bpmJetzt: number): number => Math.max(10.7 / 1000 * bpmJetzt / 60, 0.1);
export function abBeatVon(beat: number, bpmJetzt: number, wahl: string): number {
  return abBeat(beat, vorlaufBeats(bpmJetzt), AB[wahl]);
}
export interface Rampe { ab_beat: number; ziel_bpm: number; dauer_beats: number }
export function tempoRampe(beat: number, bpmJetzt: number, zielBpm: number): Rampe | null {
  if (typeof zielBpm !== 'number' || !Number.isFinite(zielBpm)) return null;
  const ziel = rundeBpm(zielBpm);
  if (!(ziel >= TEMPO_MIN && ziel <= TEMPO_MAX)) return null;
  return { ab_beat: abBeatVon(beat, bpmJetzt, 'takt'), ziel_bpm: ziel, dauer_beats: RAMPE_BEATS };
}
