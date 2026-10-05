// Zusammenbau der Kern-Attrappe: Maschine plus Fachmodule in Aufrufreihenfolge. Die Haken nachSample und nachBlock
// laufen in dieser Reihenfolge: erst die Invarianten, dann der Frist-Wächter. Jeder Task, der ein Modul bringt,
// trägt es hier ein (und die Mutationen, die es kennt).

import { Kern, verbindung } from './kern.mjs';
import regler from './regler.mjs';
import decks from './decks.mjs';
import hand from './hand.mjs';
import hoerschein from './hoerschein.mjs';
import erzeuger from './erzeuger.mjs';
import ki from './ki.mjs';
import invarianten from './invarianten.mjs';
import frist from './frist.mjs';
import fxRouting from './fx_routing.mjs';

export const MODULE = [verbindung, regler, decks, hand, hoerschein, erzeuger, ki, invarianten, frist, fxRouting];

// Mutationen für den Fehlerfall der Abnahme: je eine Regel aus (SCHNITTSTELLEN §17, ROADMAP Scheibe 13)
export const MUTATIONEN = ['i1_aus', 'i2_aus', 'i3a_aus', 'i3b_aus', 'i3c_aus', 'i3d_aus', 'i4_aus', 'frist_aus'];

export function neuerKern({ cfg = {}, sende = () => {}, mutationen = [] } = {}) {
  for (const m of mutationen) if (!MUTATIONEN.includes(m)) throw new Error(`unbekannte Mutation ${m}`);
  return new Kern({ cfg, sende, module: MODULE, mutationen });
}
