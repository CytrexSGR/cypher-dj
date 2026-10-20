// D1 S3: ein neuer Projektstand als EINE undo-fähige Änderung (Spec 3.3) für Änderungen, die kein Befehl aus /proj/aendern sind
// (Freeze setzen und verwerfen, Spec 3.4 /proj/freeze). Derselbe Weg wie verlauf.ts aendere(): Patch aus dem Vergleich der Stände
// (patch.ts unterschied, Pfade über IDs), rev + 1, erst project.json speichern (Haken speichere, Spec 6.7), dann der Eintrag in
// undo.jsonl; scheitert das Log, steht project.json wieder auf dem alten Stand. Eigene Datei statt einer Änderung an verlauf.ts, damit
// S3 die Datei der S2-Integration nicht anfasst (Spec 4: nacheinander, nie parallel).
import { vergleiche } from './befehle.ts';
import { pruefeFehler, type Projekt } from './modell.ts';
import { unterschied } from './patch.ts';
import type { Haken, Meta, Verlauf, Wirkung } from './verlauf.ts';

// text: englisch (Spec 6.34: jede Antwort mit Grund trägt einen englischen text); die deutsche Prüfmeldung des Modells steht in detail
export class StandFehler extends Error {
  readonly grund: string;
  readonly text: string;
  readonly detail: string;
  constructor(grund: string, text: string, detail = '') {
    super(`${grund}: ${text}${detail ? ` (${detail})` : ''}`);
    this.grund = grund; this.text = text; this.detail = detail;
  }
}

// `neu` ist ein eigener Stand (z. B. structuredClone von `alt` mit Änderung); rev und wiedergabe_rev darin zählen nicht (der Verlauf zählt).
export function aendereStand(v: Verlauf, alt: Projekt, neu: Projekt, meta: Meta, haken: Haken = {}): Wirkung {
  v.pruefeMeta(meta);
  const fehler = pruefeFehler(neu);
  if (fehler !== null) throw new StandFehler('projekt_ungueltig', 'the new project state is invalid; nothing was saved', fehler);
  const vor = unterschied(alt, neu);
  if (vor.length === 0) return { projekt: alt, eintrag: null, betrifft_wiedergabe: false, regler_aenderungen: [] };
  const zurueck = unterschied(neu, alt);
  const ergebnis: Projekt = { ...neu, rev: alt.rev + 1, wiedergabe_rev: alt.wiedergabe_rev };
  v.pruefeRev(ergebnis.rev);                                             // vor dem Speichern: ein veralteter Stand schreibt nichts
  haken.speichere?.(ergebnis);
  try {
    const eintrag = v.haengeAn({ rev: ergebnis.rev, quelle: meta.quelle, label: meta.label, vor, zurueck });
    return { projekt: ergebnis, eintrag, ...vergleiche(alt, ergebnis) };
  } catch (e) {
    try { haken.speichere?.(alt); } catch { /* auch das Zurückschreiben scheitert: das Projekt bleibt dem Log voraus, beim Öffnen unkritisch */ }
    throw e;
  }
}
