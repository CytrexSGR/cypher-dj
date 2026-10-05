// Planform (SCHNITTSTELLEN §14.1, kanonisch in Beats), Umrechnung der Menschenform aus plan_einreichen (§10), und die
// OSC-Nachricht je Teil (§4.2 Tempo, §4.3 Regler, §4.4 Deck). Die Kopplung (Gruppe) und die Politik setzt kopplung.ts.
import type { Felder } from './adressen.ts';

export type DeckAktion = 'start' | 'stopp' | 'loop' | 'roll' | 'sprung' | 'hotcue';

export interface ReglerTeil {
  nr: number; art: 'regler'; pfad: string; ab_beat: number; dauer_beats: number; nach: number;
  form: 0 | 1; politik: 0 | 1; gruppe: string; hoerschein: string;
}
// hotcue_nr und roll_art: /k/deck/hotcue trägt nr, /k/deck/roll art; im Plan-Teil heißen nr und art schon Teil-Nummer
// und Teil-Art (offener Befund von Scheibe 09 in plan.schema.json). Bis die Hauptinstanz entscheidet, nennt der
// Leitstand sie hotcue_nr und roll_art.
export interface DeckTeil {
  nr: number; art: 'deck'; deck: number; aktion: DeckAktion; ab_beat: number; politik: 0 | 1 | 2; gruppe: string;
  hoerschein: string; quell_beat?: number; laenge_beats?: number; delta_beats?: number; raster_beats?: number;
  hotcue_nr?: number; roll_art?: number;
}
export interface TempoTeil { nr: number; art: 'tempo'; ab_beat: number; ziel_bpm: number; dauer_beats: number }
export type Teil = ReglerTeil | DeckTeil | TempoTeil;

export interface Plan {
  id: string; quelle: string; spielart: string | null; wahl_id: string | null; einstieg_quell_beat: number | null;
  hoerscheine: string[]; grund: string; teile: Teil[];
}

// §10 plan_einreichen, Menschenform (Schema mcp.schema.json#/$defs/plan_einreichen_eingabe prüft der Hub)
export interface MenschenTeil { regler: string; art: 'rampe' | 'setze'; ab_takt: number; ab_schlag?: number; dauer_takte?: number; nach: number }
export interface MenschenPlan { spielart?: string; hoerschein?: string; grund: string; teile: MenschenTeil[] }

export class FormFehler extends Error {}

// §10: ab_beat = (ab_takt − 1)·4 + (ab_schlag − 1), dauer_beats = dauer_takte·4. Den Plan-Hörschein verteilt
// setzeHoerschein (braucht den Spiegel), Gruppe und Politik vergibt kopplung.ts.
export function ausMenschenform(e: MenschenPlan, id: string, quelle: string): Plan {
  const teile: ReglerTeil[] = e.teile.map((t, nr) => {
    if (t.art === 'rampe' && !(typeof t.dauer_takte === 'number' && t.dauer_takte > 0)) {
      throw new FormFehler(`Teil ${nr}: rampe braucht dauer_takte > 0 (§10)`);
    }
    if (t.art === 'setze' && t.dauer_takte !== undefined) {
      throw new FormFehler(`Teil ${nr}: setze hat keine dauer_takte (§10)`);
    }
    return {
      nr, art: 'regler', pfad: t.regler, ab_beat: (t.ab_takt - 1) * 4 + ((t.ab_schlag ?? 1) - 1),
      dauer_beats: t.art === 'rampe' ? (t.dauer_takte as number) * 4 : 0, nach: t.nach, form: 0, politik: 0,
      gruppe: '', hoerschein: '',
    };
  });
  return {
    id, quelle, spielart: e.spielart ?? null, wahl_id: null, einstieg_quell_beat: null,
    hoerscheine: e.hoerschein ? [e.hoerschein] : [], grund: e.grund, teile,
  };
}

// Plan-Hörschein an jeden Fader- oder Trim-Teil, der nach oben geht, also einen Kanal öffnen kann (§4.3 Feld 12, Beispiel
// §14.1 Teile 2 und 3). Kanalunabhängig: passt der Hörschein nicht zum Kanal, meldet die Vorprüfung
// hoerschein_anderer_kanal statt kein_hoerschein. wert: Reglerwert vor dem Plan (Spiegel).
export function setzeHoerschein(plan: Plan, hsId: string, wert: (pfad: string) => number): void {
  const zuletzt = new Map<string, number>();
  for (const t of geordnet(plan.teile)) {
    if (t.art !== 'regler') continue;
    const vor = zuletzt.get(t.pfad) ?? wert(t.pfad);
    if (/\/(fader|trim)$/.test(t.pfad) && t.nach > vor && t.hoerschein === '') t.hoerschein = hsId;
    zuletzt.set(t.pfad, t.nach);
  }
}

export function kanalVonTeil(t: Teil): string | null {
  if (t.art === 'regler') return t.pfad.split('/').length >= 3 ? t.pfad.split('/').slice(0, 2).join('/') : null;
  if (t.art === 'deck') return `deck/${t.deck}`;
  return null;
}

export function endeBeat(t: Teil): number {
  return t.art === 'deck' ? t.ab_beat : t.ab_beat + t.dauer_beats;
}

// Reihenfolge der Anwendung: nach ab_beat, am selben Beat nach Teil-Nummer (§14.1 Anmerkungen, §17 Reihenfolge)
export function geordnet<T extends Teil>(teile: T[]): T[] {
  return [...teile].sort((a, b) => a.ab_beat - b.ab_beat || a.nr - b.nr);
}

export interface OscBefehl { adresse: string; felder: Felder }

// Die OSC-Nachricht eines Teils. id: Befehls-ID (§1.4), quelle: Absender, hoerschein: bei Deck-Teilen eines
// angenommenen Vorschlags annahme:<vorschlag_id> (§4.4).
export function oscFuer(plan: Plan, t: Teil, id: number, quelle: string, annahme: string | null): OscBefehl {
  if (t.art === 'regler') {
    return { adresse: '/k/teil', felder: {
      id, quelle, plan: plan.id, teil: t.nr, pfad: t.pfad, ab_beat: t.ab_beat, dauer_beats: t.dauer_beats, nach: t.nach,
      form: t.form, politik: t.politik, gruppe: t.gruppe, hoerschein: t.hoerschein,
    } };
  }
  if (t.art === 'tempo') {
    return { adresse: '/k/tempo/rampe', felder: { id, quelle, ab_beat: t.ab_beat, ziel_bpm: t.ziel_bpm, dauer_beats: t.dauer_beats } };
  }
  const hoerschein = annahme ?? t.hoerschein;
  const kopf = { id, quelle, plan: plan.id, gruppe: t.gruppe, hoerschein, deck: t.deck, ab_beat: t.ab_beat };
  const raster = t.raster_beats ?? 0;
  switch (t.aktion) {
    case 'start': return { adresse: '/k/deck/start', felder: { ...kopf, quell_beat: t.quell_beat ?? 0, politik: t.politik } };
    case 'stopp': return { adresse: '/k/deck/stopp', felder: { ...kopf, politik: t.politik } };
    case 'loop': return { adresse: '/k/deck/loop', felder: { ...kopf, laenge_beats: t.laenge_beats ?? 0, politik: t.politik, raster_beats: raster } };
    case 'roll': return { adresse: '/k/deck/roll', felder: { ...kopf, laenge_beats: t.laenge_beats ?? 0, art: t.roll_art ?? 0, politik: t.politik, raster_beats: raster } };
    case 'sprung': return { adresse: '/k/deck/sprung', felder: { ...kopf, delta_beats: t.delta_beats ?? 0, politik: t.politik, raster_beats: raster } };
    case 'hotcue': return { adresse: '/k/deck/hotcue', felder: { ...kopf, nr: t.hotcue_nr ?? 1, politik: t.politik, raster_beats: raster } };
  }
}
