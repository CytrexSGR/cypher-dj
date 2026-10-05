// Kern- und Notbahn-Meldungen → WS-Ereignis-Art (SCHNITTSTELLEN §9.3) und Ansage-Satz (ADR 019).
// Was hier keine Art hat (/e/regler, /e/taste, /e/frist, /e/raster, /e/hotcue, /e/rueckweg, /e/protokollfehler,
// /q, /q/stand), geht nur ins Journal: §9.3 kennt dafür keine Art; Pläne und Teile kommen mit Scheibe 21.
import type { Felder } from './adressen.ts';

export const ART_JE_ADRESSE: Record<string, string> = {
  '/e/geladen': 'geladen',
  '/e/halter': 'halter',
  '/e/invariante': 'invariante',
  '/e/rueckfall': 'rueckfall',
  '/e/luecke': 'luecke',
  '/e/quantum': 'quantum',
  '/e/ki': 'ki_stopp',
  '/e/tempo': 'tempo',
  '/e/neustart': 'neustart',
  '/e/hand': 'hand',
  '/nb': 'notbahn',
};

// Hochfrequente Ströme gehen nicht ins Journal (§18 Punkt 5, §15 Pflichtliste): /uhr je Zyklus wären
// 187,5 Zeilen je Sekunde, /zustand/kern und /pegel je 20 Hz, /zustand/deck 50 Hz je Deck.
export const NICHT_INS_JOURNAL = new Set(['/uhr', '/zustand/kern', '/zustand/deck', '/pegel']);

// Jede Adresse, die dieser Leitstand liest oder schreibt; tests/adressen.test.ts prüft, dass der Vertrag
// (djk/vertrag/osc_adressen.ts) sie alle kennt.
export const GENUTZT = [
  '/k/hallo', '/k/tschuess', '/k/willkommen', '/uhr', '/takt', '/q', '/q/stand', '/e/protokollfehler',
  ...Object.keys(ART_JE_ADRESSE),
  // Scheibe 21: Annahme, Hörschein-Register, KI, LEDs, Tasten, Spiegel
  '/k/teil', '/k/abbruch', '/k/tempo/rampe', '/k/deck/start', '/k/deck/stopp', '/k/deck/loop', '/k/deck/roll',
  '/k/deck/sprung', '/k/deck/hotcue', '/k/hoerschein', '/k/hoerschein/weg', '/k/ki/spur', '/k/ki/stufe', '/k/led',
  '/k/vorschlag_kanal', '/e/regler', '/e/taste', '/zustand/deck', '/zustand/kern', '/test/hand',
];

export type AnsageArt = 'vorschlag' | 'plan' | 'rueckfall' | 'warnung' | 'info';
export interface Ansage { text: string; art: AnsageArt }

const NB_ZUSTAND = ['durchreichen', 'Schleife', 'ausgeblendet', 'Rückgabe'];

// Ein Satz mit Takt; null heißt: keine Ansage (zu häufig oder nichts für Andreas' Augen).
export function ansageFuer(adresse: string, f: Felder, takt: number, nbVorher: number | null): Ansage | null {
  const t = `T ${takt}`;
  switch (adresse) {
    case '/e/luecke':
      return { text: `${t}: Lücke im Kern, ${f.frames} Frames in ${f.zyklen} Zyklen`, art: 'warnung' };
    case '/e/neustart':
      return { text: `${t}: Kern neu gestartet, Generation ${f.generation}`, art: 'warnung' };
    case '/e/rueckfall':
      return { text: `${t}: Rückfall-Loop Deck ${f.deck} ${f.an === 1 ? 'an' : 'aus'}`, art: 'rueckfall' };
    case '/e/invariante':
      return { text: `${t}: Invariante ${f.art} hält Plan ${f.plan} Teil ${f.teil}`, art: 'warnung' };
    case '/e/ki':
      return { text: `${t}: KI ${f.gestoppt === 1 ? 'gestoppt' : 'frei'} (${f.grund})`, art: 'warnung' };
    case '/e/quantum':
      return { text: `${t}: Quantum ${f.alt} → ${f.neu}`, art: 'info' };
    case '/e/geladen':
      return { text: `${t}: Deck ${f.deck} geladen, ${f.material_id} r${f.fassung}`, art: 'info' };
    case '/e/protokollfehler':
      return { text: `${t}: Kern meldet Protokollfehler ${f.grund} bei ${f.adresse || '?'}`, art: 'warnung' };
    case '/nb': {
      const z = f.zustand as number;
      if (nbVorher === z) return null; // /nb kommt mit 1 Hz; angesagt wird nur der Wechsel
      if (nbVorher === null && z === 0) return null;
      return { text: `${t}: Notbahn ${NB_ZUSTAND[z] ?? z}`, art: z === 0 ? 'info' : 'warnung' };
    }
    default:
      return null;
  }
}
