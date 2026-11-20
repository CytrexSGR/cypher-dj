// GET /proj/steckfeld: the patch field of one bk track (names of the rows and columns, the pins in force, whether the track holds its own list).
import type { Projekt } from '../../project/model.ts';
import type { Steckfeld, Stift } from '../../steckfeld.ts';
import { ProjFehler } from './session.ts';

export interface SteckfeldSicht { spur_id: string; graph: string; zeilen: string[]; spalten: string[]; stifte: Stift[]; eigene: boolean; rev: number }

/** Pure. Throws ProjFehler: 404 spur_unbekannt, 409 geraet_falsch (no bk device), 409 kein_steckfeld (the graph has no matrix node or is unknown). */
export function steckfeldSicht(projekt: Projekt, spurId: string, lookup: (graph: string) => Steckfeld | null): SteckfeldSicht {
  const s = projekt.spuren.find((x) => x.id === spurId);
  if (!s) throw new ProjFehler(404, 'spur_unbekannt', { spur_id: spurId });
  const g = s.geraet;
  if (!g || g.art !== 'intern' || g.name !== 'bk') throw new ProjFehler(409, 'geraet_falsch', { spur_id: spurId });
  const feld = lookup(g.graph);
  if (!feld) throw new ProjFehler(409, 'kein_steckfeld', { spur_id: spurId, graph: g.graph });
  const eigene = g.stifte !== undefined;
  return { spur_id: spurId, graph: g.graph, zeilen: feld.zeilen, spalten: feld.spalten,
    stifte: (eigene ? g.stifte! : feld.stifte).map((e) => [...e] as Stift), eigene, rev: projekt.rev };
}
