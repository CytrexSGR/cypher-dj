// D1 S3: Freeze einer Wirt-Spur im Projekt (Spec 2.5, 3.3, 3.4, 6.2, 6.14, 6.17). Reine Funktionen plus Dateizugriff im Arbeitsordner, kein
// Kern, kein Server. Der Kern schreibt <arr_ordner>/freeze-<spur>-<kennung>.f32 (Paket K3); hier entstehen Bereich, Prüfung der fertigen
// Datei samt sha256 (6.2: beim Einfrieren berechnet) und der neue Projektstand. `freeze.datei` ist relativ zum Arbeitsordner (6.14).
// Die Kennung vergibt nicht diese Datei: sie kommt aus dem einen Wiedergabe-Zähler der Instanz (Spec 6.25, ProjZugang.naechsteNummer).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sucheSpur, type Freeze, type MidiClip, type Projekt, type Spur } from './modell.ts';

export const FREEZE_MAX_BEATS = 256;          // Grenze des Kerns für bis − von (K3, Abweichung 5)
export const FREEZE_NACHLAUF_BEATS = 2;       // Spec 3.1: Nachlauf 2 Beats

// text: englisch (Spec 6.34)
export class FreezeFehler extends Error {
  readonly grund: string;
  readonly text: string;
  constructor(grund: string, text = '') { super(text ? `${grund}: ${text}` : grund); this.grund = grund; this.text = text; }
}

export const istWirt = (s: Spur): boolean => s.art === 'instrument' && s.geraet?.art === 'wirt';
// Spec 6.17: im Loop-Clip klingen nur Noten vor loop_beats (der Übersetzer rollt [0, loop_beats) bis laenge_beats aus); ohne Loop die vor
// dem Clip-Ende. loop_beats ≤ laenge_beats (Modell), also ist die Grenze nie größer als die Clip-Länge.
const grenze = (c: MidiClip): number => c.loop_beats ?? c.laenge_beats;
export function klingendeNoten(s: Spur): number {
  let n = 0;
  for (const c of s.clips) if (c.art === 'midi') for (const x of c.noten) if (x.beat < grenze(c)) n++;
  return n;
}
// Eine Wirt-Spur ohne Freeze, die klingt, muss vor einem Export eingefroren werden (Spec 2.5); eine stumme braucht es nicht.
export const brauchtFreeze = (s: Spur): boolean => istWirt(s) && !s.freeze && klingendeNoten(s) > 0;

// Bereich eines Freeze: vom frühesten bis zum spätesten MIDI-Clip mit klingenden Noten, mindestens 1 Beat (Kern: bis − von ≥ 1).
// Der ganze Inhalt der Spur, nicht nur der Export-Bereich: der Freeze gilt, bis Noten, Gerät oder Tempo sich ändern (befehle.ts).
// Ein Loop-Clip zählt mit seiner ganzen Länge (die Wiederholungen klingen bis laenge_beats).
export function freezeBereich(s: Spur): { von_beat: number; bis_beat: number } | null {
  let von = Infinity, bis = -Infinity;
  for (const c of s.clips) {
    if (c.art !== 'midi' || !c.noten.some((n) => n.beat < grenze(c))) continue;
    von = Math.min(von, c.start_beat);
    bis = Math.max(bis, c.start_beat + c.laenge_beats);
  }
  return Number.isFinite(von) ? { von_beat: von, bis_beat: Math.max(bis, von + 1) } : null;
}

export const freezeDateiName = (nr: number, kennung: number): string => `freeze-${nr}-${kennung}.f32`;

// Prüft die vom Kern geschriebene Datei (Größe = frames · 8, f32 Stereo) und rechnet ihren sha256 im Strom (bis ~100 MB, Spec 6.2).
export async function pruefeFreezeDatei(arbeitsordner: string, nr: number, kennung: number, frames: number): Promise<string> {
  const name = freezeDateiName(nr, kennung), datei = path.join(arbeitsordner, name);
  let groesse: number;
  try { groesse = (await fs.promises.stat(datei)).size; } catch { throw new FreezeFehler('freeze_fehler', `the freeze file ${name} is missing`); }
  if (!Number.isInteger(frames) || frames < 1 || groesse !== frames * 8) {
    throw new FreezeFehler('freeze_fehler', `the freeze file has ${groesse} bytes, expected ${frames} frames × 8`);
  }
  const h = crypto.createHash('sha256');
  for await (const teil of fs.createReadStream(datei)) h.update(teil as Buffer);
  return h.digest('hex');
}

// Neuer Stand mit gesetztem oder verworfenem Freeze der Spur; das Eingabeprojekt bleibt unberührt.
export function setzeFreeze(p: Projekt, spurId: string, freeze: Freeze | null): Projekt {
  const neu = structuredClone(p);
  const s = sucheSpur(neu, spurId);
  if (!s) throw new FreezeFehler('spur_unbekannt', `there is no track ${spurId}`);
  if (!istWirt(s)) throw new FreezeFehler('keine_wirtspur', `${s.name} is not a Surge track`);
  s.freeze = freeze;
  return neu;
}
