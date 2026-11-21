// Where a new module goes (export, loop library, module library): a place that holds nothing (`leer` or `track`), whose container strip is closed.
// A wanted place stays strict (taken is slot_belegt, open is kanal_offen). Without a wish the places are scanned 3, 4, 1, 2 and the first free place with
// a closed strip wins; refused only when no free place is left or every free strip is open.
import { pultContainerPfad } from '../../../contract/pult.ts';
import type { Projekt } from '../../project/model.ts';
import { platzSlot, slotPlatz, type Slot } from '../../project/live.ts';
import { ProjFehler } from '../proj/session.ts';

const SUCHREIHENFOLGE = [3, 4, 1, 2] as const;

export const platzFrei = (p: Projekt, slot: Slot): boolean => { const t = p.plaetze?.[slotPlatz(slot) - 1]?.typ; return t === 'leer' || t === 'track'; };
export const slotBelegt = (slot: Slot): ProjFehler => new ProjFehler(409, 'slot_belegt', { slot, text: `place ${slot} (${slotPlatz(slot)}) is taken` });
export function kanalOffenFehler(slot: Slot): ProjFehler {
  const kanal = pultContainerPfad[slotPlatz(slot) - 1];
  return new ProjFehler(409, 'kanal_offen', { slot, kanal, text: `the channel ${kanal} of place ${slot} is open; close it before a module is placed` });
}

export function waehleModulSlot(p: Projekt, wunsch: Slot | undefined, kanalOffen: ((kanal: string) => boolean) | undefined, besetzt: ReadonlySet<Slot> = new Set()): Slot {
  const offen = (s: Slot): boolean => kanalOffen?.(pultContainerPfad[slotPlatz(s) - 1]) ?? false;
  const frei = (s: Slot): boolean => platzFrei(p, s) && !besetzt.has(s);
  if (wunsch !== undefined) {
    if (!frei(wunsch)) throw slotBelegt(wunsch);
    if (offen(wunsch)) throw kanalOffenFehler(wunsch);
    return wunsch;
  }
  const freie = SUCHREIHENFOLGE.map(platzSlot).filter(frei);
  if (freie.length === 0) throw new ProjFehler(409, 'slot_belegt', { text: 'no free place for a module' });
  const s = freie.find((x) => !offen(x));
  if (s === undefined) {
    const kanaele = freie.map((x) => pultContainerPfad[slotPlatz(x) - 1]);
    throw new ProjFehler(409, 'kanal_offen', { kanal: kanaele[0], text: `the channel of every free place is open (${kanaele.join(', ')}); close one before a module is placed` });
  }
  return s;
}
