// Vorprüfung beim Annehmen (ADR 023 Entscheidung 1: Form, zu spät, Regler beim Menschen, Überlappung, Hörschein,
// Budget; Autonomie entscheidet autonomie.ts). Codes wörtlich aus SCHNITTSTELLEN §16.2. Der Kern prüft am Start
// noch einmal (§17); diese Prüfung gibt Cypher den Grund sofort und erspart Andreas Vorschläge, die nie laufen.
// Je Teil wird der erste zutreffende Grund gemeldet, in der Reihenfolge der Prüfungen unten.
import type { HoerscheinRegister } from './hoerscheine.ts';
import { deckNrVon, imBereich, kanalVon, reglerInfo } from './regler_info.ts';
import type { Schwellen } from './kopplung.ts';
import { geordnet, type DeckTeil, type Plan, type ReglerTeil, type Teil } from './plan.ts';
import type { Spiegel } from './spiegel.ts';

export interface Grund { teil: number; grund: string; fruehestens_beat?: number }

export interface Pruefumgebung {
  jetztBeat: number;
  bpm: number;
  spiegel: Spiegel;
  hoerscheine: HoerscheinRegister;
  schwellen: Schwellen;
  maxStretcher: number;
  angenommen: Array<{ plan: string; teil: Teil }>; // wartende und laufende Teile anderer angenommener Pläne
  wirdVorschlag: boolean;                          // Andreas' Annahme deckt Cyphers Sprung und Hotcue (I3d)
}

// §3 Vorlauf: Regler-Teil 2 Zyklen (10,7 ms bei 256) plus Transport (max 8,1 ms, 02 NP) → 25 ms Reserve (gesetzt);
// Deck-Teile und Tempo-Rampen 1 Beat.
export const VORLAUF_REGLER_S = 0.025;
export const VORLAUF_DECK_BEATS = 1;
const ABSCHNITT_ZUGABE = 64; // §17 I3a: [quell_von, quell_bis + 64]

export function vorlaufBeats(t: Teil, bpm: number): number {
  return t.art === 'regler' ? (VORLAUF_REGLER_S * bpm) / 60 : VORLAUF_DECK_BEATS;
}

// I4 (§17): Rampen schneiden sich offen; zwei Setzen nur am selben Beat; ein Setzen am Anfang oder Ende einer Rampe ist erlaubt
export function ueberlappt(a: { ab: number; dauer: number }, b: { ab: number; dauer: number }): boolean {
  if (a.dauer > 0 && b.dauer > 0) return a.ab < b.ab + b.dauer && b.ab < a.ab + a.dauer;
  if (a.dauer === 0 && b.dauer === 0) return a.ab === b.ab;
  const [p, r] = a.dauer === 0 ? [a, b] : [b, a];
  return p.ab > r.ab && p.ab < r.ab + r.dauer;
}

// Wert eines Reglers unmittelbar vor Teil t (Spiegel, dann frühere Teile desselben Plans an diesem Regler)
function wertVorTeil(plan: Plan, t: Teil, pfad: string, u: Pruefumgebung): number {
  let v = u.spiegel.wert(pfad);
  for (const x of geordnet(plan.teile)) {
    if (x === t) break;
    if (x.art === 'regler' && x.pfad === pfad) v = x.nach;
  }
  return v;
}

function bpmBei(plan: Plan, beat: number, u: Pruefumgebung): number {
  let bpm = u.bpm;
  for (const x of geordnet(plan.teile)) if (x.art === 'tempo' && x.ab_beat + x.dauer_beats <= beat) bpm = x.ziel_bpm;
  return bpm;
}

function quellBei(plan: Plan, deck: number, beat: number, u: Pruefumgebung): number | null {
  const starts = geordnet(plan.teile).filter((x): x is DeckTeil => x.art === 'deck' && x.deck === deck
    && x.aktion === 'start' && x.ab_beat <= beat);
  const st = starts[starts.length - 1];
  if (st) {
    const basis = u.spiegel.decks.get(deck)?.basis_bpm ?? u.bpm;
    return (st.quell_beat ?? 0) + ((beat - st.ab_beat) * bpmBei(plan, beat, u)) / basis;
  }
  return u.spiegel.quellBeatBei(deck, beat);
}

function offenBei(plan: Plan, t: Teil, kanal: string, u: Pruefumgebung, mitT: boolean): boolean {
  let trim = wertVorTeil(plan, t, `${kanal}/trim`, u);
  let fader = wertVorTeil(plan, t, `${kanal}/fader`, u);
  if (mitT && t.art === 'regler') {
    if (t.pfad === `${kanal}/trim`) trim = t.nach;
    if (t.pfad === `${kanal}/fader`) fader = t.nach;
  }
  return trim + fader > u.schwellen.hoerbarDb;
}

// I3a im Leitstand: öffnet der Teil seinen Kanal, braucht er einen gültigen Hörschein (Codes wie der Kern, dazu
// hoerschein_nicht_sync und hoerschein_pegel für ein Urteil ungleich ok).
function hoerscheinGrund(plan: Plan, t: ReglerTeil, u: Pruefumgebung): string | null {
  if (!/\/(fader|trim)$/.test(t.pfad)) return null;
  const k = kanalVon(t.pfad);
  if (!k || k.startsWith('bus/')) return null;
  if (offenBei(plan, t, k, u, false) || !offenBei(plan, t, k, u, true)) return null;
  const hs = t.hoerschein ? u.hoerscheine.get(t.hoerschein) : undefined;
  if (!hs) return 'kein_hoerschein';
  if (hs.kanal !== k) return 'hoerschein_anderer_kanal';
  if (hs.urteil === 'nicht_sync' || hs.urteil === 'unsicher') return 'hoerschein_nicht_sync';
  if (hs.urteil === 'zu_laut' || hs.urteil === 'zu_leise') return 'hoerschein_pegel';
  const deck = deckNrVon(k);
  if (deck !== null && u.spiegel.inhalt(k) !== hs.inhalt) return 'hoerschein_anderer_inhalt';
  if (Math.abs(bpmBei(plan, t.ab_beat, u) / hs.bpm - 1) > 0.005) return 'hoerschein_anderes_tempo';
  if (u.jetztBeat > hs.gueltig_bis_beat) return 'hoerschein_abgelaufen';
  if (deck !== null && hs.quell_von !== null && hs.quell_bis !== null) {
    const q = quellBei(plan, deck, t.ab_beat, u);
    if (q !== null && (q < hs.quell_von || q > hs.quell_bis + ABSCHNITT_ZUGABE)) return 'hoerschein_anderer_abschnitt';
  }
  return null;
}

// I3d im Leitstand: Cyphers Sprung oder Hotcue auf offenem Deck nur mit gemessenem Ziel oder nach Annahme
function zielGrund(plan: Plan, t: DeckTeil, u: Pruefumgebung): string | null {
  if (u.wirdVorschlag || plan.quelle !== 'cypher' || (t.aktion !== 'sprung' && t.aktion !== 'hotcue')) return null;
  const k = `deck/${t.deck}`;
  if (!offenBei(plan, t, k, u, false)) return null;
  if (t.aktion === 'hotcue') return 'ziel_ungehoert'; // Hotcue-Ziele kennt der Leitstand nicht: nur mit Annahme
  const q = quellBei(plan, t.deck, t.ab_beat, u);
  if (q === null) return 'ziel_ungehoert';
  const ziel = q + (t.delta_beats ?? 0);
  const passt = u.hoerscheine.alle().some((h) => h.kanal === k && h.urteil === 'ok' && u.jetztBeat <= h.gueltig_bis_beat
    && h.inhalt === u.spiegel.inhalt(k) && h.quell_von !== null && h.quell_bis !== null
    && ziel >= h.quell_von && ziel <= h.quell_bis + ABSCHNITT_ZUGABE);
  return passt ? null : 'ziel_ungehoert';
}

function formGrund(t: Teil): string | null {
  if (t.art !== 'regler') return null;
  const info = reglerInfo(t.pfad);
  if (!info) return 'unbekannter_regler';
  if (info.nurHand) return 'nur_hand';
  if (!(t.dauer_beats >= 0) || !imBereich(info, t.nach, t.dauer_beats)) return 'ausserhalb_bereich';
  return null;
}

export function pruefe(plan: Plan, u: Pruefumgebung): Grund[] {
  const gruende: Grund[] = [];
  const teile = geordnet(plan.teile);
  for (const t of teile) {
    const g = ((): Grund | null => {
      const f = formGrund(t);
      if (f) return { teil: t.nr, grund: f };
      const frueh = u.jetztBeat + vorlaufBeats(t, u.bpm);
      if (t.ab_beat < frueh) return { teil: t.nr, grund: 'zu_spaet', fruehestens_beat: Math.ceil(frueh) };
      if (t.art === 'regler' && u.spiegel.halter(t.pfad) === 'mensch') return { teil: t.nr, grund: 'regler_beim_menschen' };
      if (t.art === 'deck' && u.spiegel.halter(`deck/${t.deck}/transport`) === 'mensch') return { teil: t.nr, grund: 'deck_beruehrt' };
      if (t.art === 'regler') {
        const i = { ab: t.ab_beat, dauer: t.dauer_beats };
        if (teile.some((x) => x !== t && x.art === 'regler' && x.pfad === t.pfad && ueberlappt(i, { ab: x.ab_beat, dauer: x.dauer_beats }))) {
          return { teil: t.nr, grund: 'ueberlappung' };
        }
        if (u.angenommen.some((a) => a.teil.art === 'regler' && a.teil.pfad === t.pfad
          && ueberlappt(i, { ab: a.teil.ab_beat, dauer: a.teil.dauer_beats }))) return { teil: t.nr, grund: 'regler_verplant' };
        const h = hoerscheinGrund(plan, t, u);
        if (h) return { teil: t.nr, grund: h };
      }
      if (t.art === 'deck') {
        const z = zielGrund(plan, t, u);
        if (z) return { teil: t.nr, grund: z };
      }
      if (t.art === 'tempo') {
        const brauchen = [...u.spiegel.decks.values()].filter((d) => d.status >= 1 && Math.abs(t.ziel_bpm / d.basis_bpm - 1) >= 1e-6).length;
        if (brauchen > u.maxStretcher) return { teil: t.nr, grund: 'budget_stretcher' };
      }
      return null;
    })();
    if (g) gruende.push(g);
  }
  return gruende.sort((a, b) => a.teil - b.teil);
}

