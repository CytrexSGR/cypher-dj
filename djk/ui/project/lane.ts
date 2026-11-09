// Automation Slice 1 (ADR 032, D2): die Auswertung einer Lane, rein. Dieselbe Formel rechnen der Kern (C++, arr_auto.h) und die Seite (lanes.js);
// eine unabhängig erzeugte Referenzdatei (core/tests/data/lane_ref.json) bindet alle drei.
// Keine Importe: die Stumm-Konstanten spiegeln core/signalbox/include/cypherdj/signalbox/types.h (STUMM, STUMM_GRENZE, STUMM_RAMPE).
export type LaneForm = 'linear' | 's' | 'sprung';
export interface Punkt { beat: number; wert: number; form?: LaneForm }

const STUMM = -200, STUMM_GRENZE = -120, STUMM_RAMPE = -60;

// Wert der Lane am Projekt-Beat (dB bei `fader`, sonst der Rohwert des Ziels).
// Vor dem ersten Punkt gilt dessen Wert, nach dem letzten der letzte. Zwischen zwei Punkten gilt die Form des
// rechten (linear | s: 3u²−2u³ | sprung: hält den linken Wert bis zum Beat des rechten). Bei gleichem Beat gilt ab diesem Beat der rechte Wert.
// Stumm-Regel wie das Stellwerk (core.cpp:213): Rampen von/nach einem Punkt ≤ −120 dB laufen intern bis −60, der Punkt selbst liefert −200.
// Slice 2: the dB rule is for `fader` only; every other target (pan, mute, solo, geraet.*) interpolates its raw values (ziel is required).
export function laneWert(punkte: readonly Punkt[], beat: number, ziel: string): number {
  const n = punkte.length;
  if (n === 0) return 0;
  if (!(beat >= punkte[0].beat)) return punkte[0].wert;
  let lo = 0, hi = n - 1;                          // letzter Index mit punkte[i].beat <= beat
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (punkte[mid].beat <= beat) lo = mid; else hi = mid - 1;
  }
  const i = lo;
  const a = punkte[i];
  if (i === n - 1 || beat === a.beat) return a.wert;
  const b = punkte[i + 1];
  const form = b.form ?? 'linear';
  if (form === 'sprung') return a.wert;
  const u = (beat - a.beat) / (b.beat - a.beat);
  const g = form === 's' ? u * u * (3 - 2 * u) : u;
  let va = a.wert, vb = b.wert;
  if (ziel !== 'fader') return va + (vb - va) * g;
  if (va <= STUMM_GRENZE && vb > STUMM_GRENZE) va = Math.min(STUMM_RAMPE, vb);
  if (vb <= STUMM_GRENZE) vb = va <= STUMM_GRENZE ? STUMM : Math.min(STUMM_RAMPE, va);
  return va + (vb - va) * g;
}
