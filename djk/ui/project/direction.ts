// 1.9 U4 (O28, spec 4.3, E6): description to sound. A per-device direction table maps a word of the closed preset vocabulary
// (presets/vokabular.json inhalt.charakter) to bounded parameter steps. `wendeAn` is pure: it returns the new parameter object or a reason;
// the command geraet_richtung (commands.ts) makes the undo step of it. The RB-338 and Surge have a table (bk and kit refuse every word, spec E7).
// RB-338 parameters are the project's normalised values 0..1. A step is SCHRITT_BASIS · staerke · faktor, clamped to 0..1. A parameter the track
// does not hold yet starts from the plugin default (rb_mapping.ts), and only the parameters of the word are written.
//
// The measured move of each word (the gate of AK-O1) is in spec 4.3 and reported per word in the unit report u4.md:
//   bright    cutoff +, env_mod +        spectral centroid up       >= 10 %
//   dark      cutoff -, env_mod -        spectral centroid down     >= 10 %
//   aggressive resonanz +, accent +      energy share 1-5 kHz up    >= 1.5 dB
//   soft      resonanz -, accent -       the same share down        >= 1.5 dB
//   tight     decay -                    share of the energy above 1 kHz in the last half of each 16th, down >= 0.3 dB
//                                        (spec 4.3 said all energy and 2 dB: the RB-338 decay is the filter envelope's,
//                                        it never shapes the amplitude tail; ledger D57)
//   deep      cutoff - (2.5 steps)       energy share below 120 Hz up >= 1 dB (ledger D58)
import { RB_VORGABE_NORM7 } from './rb_mapping.ts';

export interface Schritt { param: string; vorzeichen: 1 | -1; faktor?: number }
export const SCHRITT_BASIS = 0.12;
export const STAERKE_MIN = 1;
export const STAERKE_MAX = 3;
// deep: spec 4.3 wrote half a step; measured on the fixed 8-bar bass (u4-abnahme-1) that moves the share below 120 Hz by 0.011 dB, the gate is +1 dB.
// A cutoff move of 2.5 steps (0.30) gives about +1.7 dB (ledger D58).
export const DEEP_FAKTOR = 2.5;
export const RICHTUNGEN: Readonly<Record<'rb338', Readonly<Record<string, readonly Schritt[]>>>> = {
  rb338: {
    bright: [{ param: 'cutoff', vorzeichen: 1 }, { param: 'env_mod', vorzeichen: 1 }],
    dark: [{ param: 'cutoff', vorzeichen: -1 }, { param: 'env_mod', vorzeichen: -1 }],
    aggressive: [{ param: 'resonanz', vorzeichen: 1 }, { param: 'accent', vorzeichen: 1 }],
    soft: [{ param: 'resonanz', vorzeichen: -1 }, { param: 'accent', vorzeichen: -1 }],
    tight: [{ param: 'decay', vorzeichen: -1 }],
    deep: [{ param: 'cutoff', vorzeichen: -1, faktor: DEEP_FAKTOR }],
  },
};

// 1.9 U5 (O28 on Surge, spec 4.3): the Surge table. Values are Surge DISPLAY units (the units of hosts/carla/surge_bereiche.json: cutoff in semitones,
// envelope times in log2 seconds, resonance 0..1); `schritt` is the move at staerke 1, multiplied by staerke and clamped to the parameter's range.
// A parameter the track's map does not hold yet starts from the value the host plays now (umfeld.ist; the server reads it from the host).
// The step sizes come from a measured sweep on the frozen render of a Surge track (acceptance acceptance_i19_direction.mjs --surge --sweep, instance e,
// 2026-11-05; Templates/Init Saw with filter 1 low-pass, cutoff 24, resonance 0.5, sustain 0.3, decay -1, release -4; gate = spec 4.3 at staerke 1):
//   cutoff        12 -> centroid -17.5 % (gate -10 %), +12 -> +15.7 % (gate +10 %); a step of 6 gives only -8.5 % / +8.3 %, too small for the gate.
//   resonance     0.25 -> 1-5 kHz band -3.2 dB, 0.75 -> +4.3 dB (gate 1.5 dB): a step of 0.2 is about 2.5 dB down and 3.5 dB up with margin.
//   decay+release -1 each -> share of the late half of all energy -2.1 dB (gate -2 dB, no margin), -1.5 each -> -3.8 dB, -2 -> -3.4 dB, -3 -> -1.4 dB:
//                 the effect saturates and turns back once the decay is shorter than a 16th, so staerke 2 and 3 do NOT tighten further (information only).
//   release alone -1 -> -0.2 dB, sustain 0.3 -> 0.1 -> 0 dB: only the decay carries the word; release stays in the table for the gate after the note.
// The word is measured with the sound that starts the table (Init Saw plus the values above); a patch with another start measures differently.
// The factory Init Saw has filter 1 OFF (a_filter1_type 0); the sweep above set it to low-pass first.
// On a patch with filter 1 off the filter words are refused.
export interface SurgeSchritt { param: string; vorzeichen: 1 | -1; schritt: number }
export const SURGE_RICHTUNGEN: Readonly<Record<string, readonly SurgeSchritt[]>> = {
  bright: [{ param: 'a_filter1_cutoff', vorzeichen: 1, schritt: 12 }],
  dark: [{ param: 'a_filter1_cutoff', vorzeichen: -1, schritt: 12 }],
  aggressive: [{ param: 'a_filter1_resonance', vorzeichen: 1, schritt: 0.2 }],
  soft: [{ param: 'a_filter1_resonance', vorzeichen: -1, schritt: 0.2 }],
  tight: [{ param: 'a_env1_release', vorzeichen: -1, schritt: 1.5 }, { param: 'a_env1_decay', vorzeichen: -1, schritt: 1.5 }],
};
// filter1An: is filter 1 (a_filter1_type other than 0 = Off) on in the patch the host plays; null/absent = not known, the word is then not blocked.
// A word whose parameters all hang on filter 1 does nothing audible while it is off (Templates/Init Saw ships with a_filter1_type 0), so it is refused
// richtung_wirkungslos instead of moving a project value nobody hears. The filter is not switched on silently: a type change reloads the state and clicks.
export interface SurgeUmfeld { bereich: (name: string) => [number, number] | null; ist: (name: string) => number | null; filter1An?: () => boolean | null }
export const nurFilter1 = (wort: string): boolean => SURGE_RICHTUNGEN[wort].every((s) => s.param.startsWith('a_filter1_'));
export const SURGE_WORTE = Object.keys(SURGE_RICHTUNGEN).sort();
export const surgeParameterVon = (wort: string): string[] => (Object.hasOwn(SURGE_RICHTUNGEN, wort) ? SURGE_RICHTUNGEN[wort].map((s) => s.param) : []);

export type RichtungGrund = 'richtung_unbekannt' | 'richtung_grenze' | 'argument_ungueltig' | 'wirt_wert_unbekannt' | 'richtung_wirkungslos';
export type RichtungErgebnis = { parameter: Record<string, number> } | { grund: RichtungGrund; text: string };

const tabelle = (geraet: string): Readonly<Record<string, readonly Schritt[]>> | null =>
  Object.hasOwn(RICHTUNGEN, geraet) ? RICHTUNGEN[geraet as 'rb338'] : null;
export const richtungsWorte = (geraet: string): string[] => (geraet === 'surge' ? SURGE_WORTE : Object.keys(tabelle(geraet) ?? {}).sort());
const rund = (x: number): number => Math.round(x * 1e9) / 1e9;   // 0.4 + 0.12 stays 0.52 in the project file

const rundSurge = (x: number): number => Math.round(x * 1e6) / 1e6;
// Surge: parameter is the track's sparse map (display values); umfeld gives the ranges and the host's current values
function wendeSurgeAn(parameter: Readonly<Record<string, number>>, wort: string, staerke: number, umfeld: SurgeUmfeld | undefined): RichtungErgebnis {
  if (nurFilter1(wort) && umfeld?.filter1An?.() === false) {
    return { grund: 'richtung_wirkungslos',
      text: `${wort} moves filter 1, and filter 1 is off in the patch this Surge host plays; load a patch with filter 1 on, or use another word` };
  }
  const neu: Record<string, number> = { ...parameter };
  let bewegt = false;
  for (const s of SURGE_RICHTUNGEN[wort]) {
    const b = umfeld?.bereich(s.param) ?? null;
    if (b === null) return { grund: 'argument_ungueltig', text: `${s.param} is not a Surge parameter of surge_bereiche.json` };
    const alt = parameter[s.param] ?? umfeld?.ist(s.param) ?? null;
    if (alt === null) {
      return { grund: 'wirt_wert_unbekannt',
        text: `the current value of ${s.param} is not in the project and the Surge host did not tell it; `
          + 'start the host (djk-instrumente --arr<slot>) or set the parameter first' };
    }
    const ziel = rundSurge(Math.min(b[1], Math.max(b[0], alt + s.vorzeichen * s.schritt * staerke)));
    if (ziel !== alt) bewegt = true;
    neu[s.param] = ziel;
  }
  if (!bewegt) {
    const seite = SURGE_RICHTUNGEN[wort][0].vorzeichen > 0 ? 'upper' : 'lower';
    const namen = SURGE_RICHTUNGEN[wort].map((s) => s.param).join(', ');
    return { grund: 'richtung_grenze', text: `${wort} cannot go further: ${namen} already at the ${seite} bound` };
  }
  return { parameter: neu };
}

export function wendeAn(geraet: string, parameter: Readonly<Record<string, number>>, wort: string, staerke: unknown, umfeld?: SurgeUmfeld): RichtungErgebnis {
  const t = tabelle(geraet);
  const worte = richtungsWorte(geraet);
  const bekannt = worte.length ? ` (known: ${worte.join(', ')})` : ' (this device has no direction table)';
  if (geraet === 'surge') {
    if (typeof wort !== 'string' || !Object.hasOwn(SURGE_RICHTUNGEN, wort)) {
      return { grund: 'richtung_unbekannt', text: `unknown direction word ${JSON.stringify(wort)} for ${geraet}${bekannt}` };
    }
    if (typeof staerke !== 'number' || !Number.isInteger(staerke) || staerke < STAERKE_MIN || staerke > STAERKE_MAX) {
      return { grund: 'argument_ungueltig', text: `staerke: a whole number from ${STAERKE_MIN} to ${STAERKE_MAX} is expected` };
    }
    return wendeSurgeAn(parameter, wort, staerke, umfeld);
  }
  if (t === null || typeof wort !== 'string' || !Object.hasOwn(t, wort)) {
    return { grund: 'richtung_unbekannt',
      text: `unknown direction word ${JSON.stringify(wort)} for ${geraet}${bekannt}` };
  }
  if (typeof staerke !== 'number' || !Number.isInteger(staerke) || staerke < STAERKE_MIN || staerke > STAERKE_MAX) {
    return { grund: 'argument_ungueltig', text: `staerke: a whole number from ${STAERKE_MIN} to ${STAERKE_MAX} is expected` };
  }
  const neu: Record<string, number> = { ...parameter };
  let bewegt = false;
  for (const s of t[wort]) {
    const alt = parameter[s.param] ?? RB_VORGABE_NORM7[s.param];
    const ziel = rund(Math.min(1, Math.max(0, alt + s.vorzeichen * (s.faktor ?? 1) * SCHRITT_BASIS * staerke)));
    if (ziel !== alt) bewegt = true;
    neu[s.param] = ziel;
  }
  if (!bewegt) {
    const seite = t[wort][0].vorzeichen > 0 ? 'upper' : 'lower';
    return { grund: 'richtung_grenze', text: `${wort} cannot go further: ${t[wort].map((s) => s.param).join(', ')} already at the ${seite} bound` };
  }
  return { parameter: neu };
}
