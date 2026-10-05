// Hörschein-Register des Leitstands (ARCHITEKTUR §3.3, SCHNITTSTELLEN §4.5, §14.5): nimmt Hörscheine der Analyse an (WS
// typ hoerschein, §9.4), registriert nur Urteil ok beim Kern (/k/hoerschein, gleiche hs_id ersetzt), zieht einen
// registrierten zurück (/k/hoerschein/weg), sobald eine Erneuerung nicht mehr ok ist.
import type { Felder } from './adressen.ts';

export interface Hoerschein {
  id: string; kanal: string; inhalt: string; deck?: number | null; bpm: number;
  gemessen_von_beat: number; gemessen_bis_beat: number; gueltig_bis_beat: number;
  quell_von: number | null; quell_bis: number | null; erneuerung: number;
  sync_ms: number | null; deck_gegen_deck_ms?: number | null; flam_anteil?: number | null;
  lufs_kurz: number | null; pegel_diff_db: number | null; baender_db?: number[];
  urteil: 'ok' | 'zu_laut' | 'zu_leise' | 'nicht_sync' | 'unsicher'; gruende?: string[];
}

export type HsAktion = { adresse: '/k/hoerschein' | '/k/hoerschein/weg'; felder: Felder } | null;

const zahl = (x: number | null | undefined): number => (typeof x === 'number' ? x : NaN);

export class HoerscheinRegister {
  private readonly map = new Map<string, Hoerschein>();
  private readonly amKern = new Set<string>();

  get(id: string): Hoerschein | undefined { return this.map.get(id); }
  alle(): Hoerschein[] { return [...this.map.values()]; }
  istAmKern(id: string): boolean { return this.amKern.has(id); }

  // Nimmt einen Hörschein auf; Rückgabe: was an den Kern geht (id und quelle ergänzt der Aufrufer).
  aufnehmen(h: Hoerschein): HsAktion {
    this.map.set(h.id, h);
    if (h.urteil === 'ok') {
      this.amKern.add(h.id);
      return { adresse: '/k/hoerschein', felder: {
        hs_id: h.id, kanal: h.kanal, inhalt: h.inhalt, urteil: 'ok', bpm_messung: h.bpm,
        gueltig_bis_beat: h.gueltig_bis_beat, quell_von: zahl(h.quell_von), quell_bis: zahl(h.quell_bis),
        sync_ms: zahl(h.sync_ms), pegel_diff_db: zahl(h.pegel_diff_db), lufs_kurz: zahl(h.lufs_kurz),
      } };
    }
    if (this.amKern.delete(h.id)) return { adresse: '/k/hoerschein/weg', felder: { hs_id: h.id } };
    return null;
  }

  // §14.7 Takt-Zustand: hoerscheine [{id, kanal, gueltig_bis_takt, urteil}]; abgelaufene fallen nach 16 Takten heraus
  liste(beatJetzt: number): Array<{ id: string; kanal: string; gueltig_bis_takt: number; urteil: string }> {
    for (const [id, h] of this.map) if (h.gueltig_bis_beat + 64 < beatJetzt) { this.map.delete(id); this.amKern.delete(id); }
    return this.alle().map((h) => ({ id: h.id, kanal: h.kanal, gueltig_bis_takt: Math.floor(h.gueltig_bis_beat / 4) + 1, urteil: h.urteil }));
  }
}
