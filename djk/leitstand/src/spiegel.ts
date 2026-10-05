// Was der Leitstand vom Kern weiß, nur aus dessen Meldungen (§5.4 bis §5.9): Reglerwerte und Halter, geladene und
// laufende Decks, KI-Stopp. Dient der Vorprüfung beim Annehmen; entschieden wird am Start im Kern (§17).
import type { Dekodiert } from './adressen.ts';
import { REGLER } from './regler_info.ts';

export interface DeckStand {
  deck: number; material_id: string; basis_bpm: number; fassung: number; mit_stems: number;
  status: number;     // §5.5: 0 leer, 1 geladen, 2 läuft, 3 Loop, 4 Roll, 5 Rückfall
  quell_beat: number; // hörbare Position bei beat
  faktor: number;
  beat: number;       // Master-Beat, zu dem quell_beat gemeldet wurde
}

export class Spiegel {
  private readonly werte = new Map<string, number>();
  private readonly halterMap = new Map<string, string>();
  readonly decks = new Map<number, DeckStand>();
  kiGestoppt = false;
  private readonly beatJetzt: () => number;

  constructor(beatJetzt: () => number) { this.beatJetzt = beatJetzt; }

  wert(pfad: string): number { return this.werte.get(pfad) ?? REGLER.get(pfad)?.vorgabe ?? NaN; }
  halter(pfad: string): string { return this.halterMap.get(pfad) ?? 'frei'; }

  // §4.5 inhalt eines Decks: <material_id>/<bpm·1000>_r<fassung>
  inhalt(kanal: string): string | null {
    const m = /^deck\/([1-4])$/.exec(kanal);
    if (!m) return null;
    const d = this.decks.get(Number(m[1]));
    return d ? `${d.material_id}/${Math.round(d.basis_bpm * 1000)}_r${d.fassung}` : null;
  }

  // Quellposition eines Decks bei Master-Beat beat, hochgerechnet aus der letzten Meldung; null, wenn unbekannt
  // (leer, Loop, Roll, Rückfall: dort springt die Position, das prüft allein der Kern).
  quellBeatBei(deck: number, beat: number): number | null {
    const d = this.decks.get(deck);
    if (!d) return null;
    if (d.status === 1) return d.quell_beat;
    if (d.status === 2) return d.quell_beat + (beat - d.beat) * d.faktor;
    return null;
  }

  laeuft(deck: number): boolean { const s = this.decks.get(deck)?.status ?? 0; return s >= 2 && s <= 5; }

  aufnehmen(d: Dekodiert): void {
    const f = d.felder;
    switch (d.adresse) {
      case '/e/regler':
        this.werte.set(f.pfad as string, f.wert as number);
        this.halterMap.set(f.pfad as string, f.halter as string);
        break;
      case '/e/halter':
        this.halterMap.set(f.pfad as string, f.halter as string);
        break;
      case '/e/hand':
        if (REGLER.has(f.pfad as string)) this.werte.set(f.pfad as string, f.wert as number);
        break;
      case '/e/geladen':
        this.decks.set(f.deck as number, {
          deck: f.deck as number, material_id: f.material_id as string, basis_bpm: f.basis_bpm as number,
          fassung: f.fassung as number, mit_stems: f.mit_stems as number, status: 1, quell_beat: 0, faktor: 1,
          beat: this.beatJetzt(),
        });
        break;
      case '/zustand/deck': {
        const n = f.deck as number;
        if ((f.status as number) === 0) { this.decks.delete(n); break; }
        this.decks.set(n, {
          deck: n, material_id: f.material_id as string, basis_bpm: f.basis_bpm as number, fassung: f.fassung as number,
          mit_stems: this.decks.get(n)?.mit_stems ?? 0, status: f.status as number, quell_beat: f.quell_beat as number,
          faktor: f.faktor as number, beat: this.beatJetzt(),
        });
        break;
      }
      case '/e/ki':
        this.kiGestoppt = (f.gestoppt as number) === 1;
        break;
      case '/zustand/kern':
        this.kiGestoppt = (f.ki_gestoppt as number) === 1;
        break;
      default:
        break;
    }
  }
}
