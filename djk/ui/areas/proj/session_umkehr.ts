import type { Projekt } from '../../project/model.ts';
import { rueckgaengig, wiederholen } from '../../project/history.ts';
import { type Quelle, type Quittung, type ReglerErgebnis, quittungOk } from './core_path.ts';
import { setzeDekodiert, vergleiche } from '../../project/commands.ts';
import { PatchFehler, wende } from '../../project/patch.ts';
import { alleRegler } from './mapping.ts';
import type { Stift } from '../../steckfeld.ts';
import type { StiftAenderung } from '../../project/commands_helpers.ts';
import { type Antwort, type Koerper, type Offen, ProjFehler } from './session_helpers.ts';
import type { ProjSitzung } from './session.ts';

export function umkehr(this: ProjSitzung, art: 'undo' | 'redo', d: Koerper, quelle: Quelle): Promise<Antwort> {
  return this.seriell(async () => {
    const o = this.brauchOffen();
    this.riegel(quelle);
    this.pruefeRev(o, d.rev);
    return this.umkehrVollzug(o, art, quelle);
  });
}

// The undo/redo step after the checks of the caller (also the roll-back of a change the core refused after the swap, see vollziehe)
export function umkehrVollzug(this: ProjSitzung, o: Offen, art: 'undo' | 'redo', quelle: Quelle): Promise<Antwort> {
  const ziel = art === 'undo' ? o.verlauf.naechstesUndo() : o.verlauf.naechstesRedo();
  let probe: Projekt;
  try { probe = wende(o.projekt, art === 'undo' ? ziel.zurueck : ziel.vor); } catch (e) {
    if (e instanceof PatchFehler) throw new ProjFehler(409, 'verlauf_inkonsistent', { detail: e.message });   // R2: deutsche Meldung nur als detail
    throw e;
  }
  setzeDekodiert(probe, (sha) => this.zustandVon(sha));
  if (probe.tempo_bpm !== o.projekt.tempo_bpm && this.lage.deckLaeuft()) throw new ProjFehler(409, 'deck_laeuft');
  const vergleich = vergleiche(o.projekt, probe);
  this.pruefeSperre(o.projekt, probe, vergleich.betrifft_wiedergabe);
  const f = art === 'undo' ? rueckgaengig : wiederholen;
  // Spec 6.31 (Leistung): die Probe ist der Stand; der Verlauf wendet den Patch nicht noch einmal an (gültig wie in aendern, über die rev-Prüfung)
  const projekt = o.projekt;
  return this.vollziehe(o, quelle, vergleich.regler_aenderungen, (h) => f(o.verlauf, projekt, { quelle }, h, { ziel, stand: probe, vergleich }), new Map(),
    vergleich.betrifft_wiedergabe, [], probe);
}

// Kraken patch field: the accepted pins of a refused or stale change go back to the value `stand` holds (0 = no pin, also when the track or its
// list is gone).
// A track whose device has no `stifte` plays the graph defaults after a rebuild; the pin is then sent as 0, like the plan says (the project is the truth).
export async function stifteZurueck(
  this: ProjSitzung,
  stand: Projekt,
  liste: readonly StiftAenderung[],
  quittungen: readonly Quittung[],
  quelle: Quelle,
): Promise<void> {
  const zurueck = liste.flatMap((e, i) => {
    if (!quittungOk(quittungen[i] ?? null)) return [];
    const g = stand.spuren.find((x) => x.nr === e.nr)?.geraet;
    const l: readonly Stift[] = g?.art === 'intern' && g.name === 'bk' ? g.stifte ?? [] : [];
    const alt = l.find((x) => x[0] === e.satz && x[1] === e.zeile && x[2] === e.spalte);
    return [{ ...e, wert: alt ? alt[3] : 0 }];
  });
  if (zurueck.length) await this.kern.stifte(zurueck, quelle);
}

// Angenommene Regler einer abgelehnten Änderung auf den alten Stand zurück.
export async function reglerZurueck(this: ProjSitzung, alt: Projekt, ergebnis: ReglerErgebnis[], quelle: Quelle): Promise<void> {
  const vorher = new Map(alleRegler(alt).map((r) => [r.pfad, r.wert] as const));
  const zurueck = ergebnis.filter((r) => r.ok && vorher.has(r.pfad)).map((r) => ({ pfad: r.pfad, wert: vorher.get(r.pfad) as number }));
  if (zurueck.length) await this.kern.setzeRegler(zurueck, quelle);
}
