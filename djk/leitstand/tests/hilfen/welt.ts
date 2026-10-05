// Attrappen-Umgebung der Annahme ohne Prozess und Netz (wie in tests/annahme.test.ts): sammelt, was an den Kern, an die
// Clients, als Ansage und ins Journal ginge. Genutzt von tests/positivliste.test.ts und tests/hinweise.test.ts.
import type { Felder } from '../../src/adressen.ts';
import { Annahme, type Umgebung } from '../../src/annahme.ts';
import { H2 } from './faelle.ts';

export interface Welt {
  u: Umgebung; beat: { jetzt: number }; gesendet: Array<{ adresse: string; felder: Felder }>;
  ereignisse: Array<{ art: string; daten: Record<string, unknown>; beat?: number }>;
  ansagen: Array<{ text: string; art: string }>;
  journal: Array<{ typ: string; von: string; daten: Record<string, unknown> }>;
}

export function welt(): Welt {
  const w: Welt = { beat: { jetzt: 20 }, gesendet: [], ereignisse: [], ansagen: [], journal: [], u: null as unknown as Umgebung };
  let id = 1000;
  w.u = {
    sende: (adresse, felder) => { w.gesendet.push({ adresse, felder }); },
    ereignis: (art, daten, beat) => { w.ereignisse.push({ art, daten, beat }); },
    ansage: (text, art) => { w.ansagen.push({ text, art }); },
    journal: (typ, daten) => { w.journal.push({ typ, von: 'leitstand', daten }); },
    jetztBeat: () => w.beat.jetzt, bpm: () => 128, kernBereit: () => true, neueId: () => ++id,
  };
  return w;
}

// Deck 1 (A, Andreas' Deck) hörbar, Deck 2 (B) läuft hinter geschlossenem Fader mit Hörschein h2, Deck 3 ist KI-Spur
// mit Fader −6 dB, erz/1 ist KI-Spur mit Send 1 auf −10 dB.
export function annahme(w: Welt, stufe = 1, kiSpur = ['deck/3', 'erz/1'], mutationen: string[] = []): Annahme {
  const a = new Annahme(w.u, { stufe, kiSpur, schwellen: { hoerbarDb: -26, tiefOffenDb: -12 }, maxStretcher: 4, mutationen });
  for (const [adresse, felder] of [
    ['/e/geladen', { deck: 1, material_id: 'f0000000000000a1', basis_bpm: 128, fassung: 1, mit_stems: 1, sample: 0 }],
    ['/e/geladen', { deck: 2, material_id: 'f0000000000000b2', basis_bpm: 128, fassung: 1, mit_stems: 0, sample: 0 }],
    ['/zustand/deck', { deck: 1, status: 2, material_id: 'f0000000000000a1', basis_bpm: 128, fassung: 1, quell_beat: 12,
      beats_bis_ende: 400, faktor: 1, vorlauf_ms: 0, hoerweg: 0, stretcher_fuell: -1, versatz_intern_ms: 0 }],
    ['/zustand/deck', { deck: 2, status: 2, material_id: 'f0000000000000b2', basis_bpm: 128, fassung: 1, quell_beat: 12,
      beats_bis_ende: 200, faktor: 1, vorlauf_ms: 0, hoerweg: 0, stretcher_fuell: -1, versatz_intern_ms: 0 }],
    ['/e/regler', { pfad: 'deck/1/fader', wert: 0, halter: 'frei', sample: 0, beat: 0 }],
    ['/e/regler', { pfad: 'deck/3/fader', wert: -6, halter: 'frei', sample: 0, beat: 0 }],
    ['/e/regler', { pfad: 'erz/1/send/1', wert: -10, halter: 'frei', sample: 0, beat: 0 }],
  ] as Array<[string, Felder]>) a.spiegel.aufnehmen({ adresse, felder });
  a.hoerschein(H2);
  return a;
}

export const anKern = (w: Welt, adresse?: string) =>
  w.gesendet.filter((g) => (adresse ? g.adresse === adresse : /^\/k\/(teil|deck\/|tempo\/)/.test(g.adresse)));
