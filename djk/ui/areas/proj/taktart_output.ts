// Meter publisher (plan studio-taktart M2): writes the meter file `taktart` into every generator stream folder.
// 4 (or no project) removes the file and never creates a folder; the generator reads a missing file as 4.
// @ts-expect-error pure .mjs without types (djk/generator)
import { schreibeTaktart } from '../../../generator/src/taktart_file.mjs';

type Schreibe = (ordner: string, proTakt: number) => void;

export function veroeffentlicheTaktart(ordner: readonly string[], proTakt: number, schreibe: Schreibe = schreibeTaktart,
  fehler?: (ordner: string, e: Error) => void): void {
  for (const o of ordner) {
    try { schreibe(o, proTakt); } catch (e) { fehler?.(o, e as Error); }   // one broken folder must not stop the others
  }
}
