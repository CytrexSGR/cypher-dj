// The stand of the session view (session view M5), pure: the live project as containers A..D with the columns of the loop decks that sound in them.
// A loop deck in a container gives 4 columns (L<letter><1..4>); other container types give none in S1 and only carry their name. A loop deck no place
// holds is parked (silent) and listed in `geparkt`. The mirror state (`lauf`) and the decode bookkeeping (`frames`) come from the caller.
import { loopDeckGruppe, loopDeckSpuren, platzVonGruppe, sessionRaster, sessionSzenen, sucheGruppe, istHalten,
  type LoopRaster, type Projekt, type SessionSzene, type PlatzTyp } from '../../project/model.ts';
import { deckSpurSicht, type DeckSpur, type Lauf, type ZelleSicht } from './loopdeck.ts';

export type SessionSpalte = Omit<DeckSpur, 'zellen'> & { solo: boolean; arm: boolean; kurz: string; art: 'audio'; deck: 1 | 2; spur: 1 | 2 | 3 | 4;
  // which returns of the deck exist (what an envelope target `send.hall` / `send.delay` of a cell needs; the translator resolves the same way). Optional extension of index 1.2.
  rueckgaenge?: { hall: boolean; delay: boolean };
  zellen: (ZelleSicht | { halten: true } | null)[] };
export type SessionContainer = { buchstabe: 'A' | 'B' | 'C' | 'D'; typ: PlatzTyp; name: string; spalten: SessionSpalte[] };
// beat and bpm are null before the first /uhr (as in GET /loopdeck/stand)
export type SessionStand = { raster: LoopRaster; szenen: SessionSzene[]; beat: number | null; bpm: number | null; container: SessionContainer[]; geparkt: SessionSpalte[][] };

const BUCHSTABEN = ['A', 'B', 'C', 'D'] as const;

function spalten(p: Projekt, deck: 1 | 2, kuerzel: string, lauf: (spurId: string) => Lauf, frames: (sha: string) => number | null): SessionSpalte[] {
  const g = loopDeckGruppe(p, deck);
  if (!g?.loopdeck) return [];
  const rueck = (art: 'hall' | 'delay') => (p.returns ?? []).some((x) => x.loopdeck?.platz === deck && x.loopdeck.art === art);
  const rueckgaenge = { hall: rueck('hall'), delay: rueck('delay') };
  return loopDeckSpuren(p, g).map((s, i) => {
    const d = deckSpurSicht(p, s, deck, lauf(s.id), frames);
    // the loop deck view shows a halten slot as empty; the session view needs to tell it apart
    const zellen = d.zellen.map((z, k) => (s.zellen?.[k] && istHalten(s.zellen[k]) ? { halten: true as const } : z));
    // nr is the project track number (`regler spur/<nr>`); solo and arm come from the project track
    return { ...d, zellen, solo: s.solo, arm: s.aufnahme?.scharf === true, kurz: `${kuerzel}${i + 1}`, art: 'audio' as const, rueckgaenge: { ...rueckgaenge }, deck, spur: (i + 1) as 1 | 2 | 3 | 4 };
  });
}

export function sessionStand(p: Projekt | undefined, lauf: (spurId: string) => Lauf, frames: (sha: string) => number | null,
  uhr: { beat: number; bpm: number } | null): SessionStand | null {
  if (!p?.live) return null;
  const container = (p.plaetze ?? []).map((pl, i): SessionContainer => {
    const buchstabe = BUCHSTABEN[i];
    const g = 'gruppe' in pl ? sucheGruppe(p, pl.gruppe) : undefined;
    const name = g?.name ?? '';
    if (pl.typ !== 'loops' || !g?.loopdeck) return { buchstabe, typ: pl.typ, name, spalten: [] };
    return { buchstabe, typ: 'loops', name, spalten: spalten(p, g.loopdeck.platz, buchstabe, lauf, frames) };
  });
  const geparkt = ([1, 2] as const).flatMap((deck) => {
    const g = loopDeckGruppe(p, deck);
    return g?.loopdeck && platzVonGruppe(p, g.id) === null ? [spalten(p, deck, `L${deck}.`, lauf, frames)] : [];
  });
  return { raster: sessionRaster(p), szenen: sessionSzenen(p), beat: uhr ? uhr.beat : null, bpm: uhr ? uhr.bpm : null, container, geparkt };
}
