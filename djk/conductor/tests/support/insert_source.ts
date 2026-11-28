// The insert vocabulary as the tests count it: read straight from docs/interfaces/insert_module.json (the one source), not from the
// generated files, so a count here is an independent check of them. Rows of one instance = parameters + group parameters x group size
// + the trailing parameters (the order and shape generate_insert.py ausfalten() expands). A new parameter or pool slot changes the json
// and nothing in the tests that use this module.
import fs from 'node:fs';
import path from 'node:path';

interface Par { name: string }
interface Art { art: string; praefix: string; instanzen: number; tabelle: boolean; parameter: Par[]; gruppen?: { anzahl: number; parameter: Par[] }[]; parameter_nach?: Par[] }

const QUELLE = path.join(import.meta.dirname, '..', '..', '..', '..', 'docs', 'interfaces', 'insert_module.json');
const ARTEN: Art[] = JSON.parse(fs.readFileSync(QUELLE, 'utf8')).arten;

function art(name: string): Art {
  const a = ARTEN.find((x) => x.art === name);
  if (!a) throw new Error(`insert_module.json has no kind ${name}`);
  return a;
}

/** controller rows of one instance of the kind */
export function zeilenJeInstanz(name: string): number {
  const a = art(name);
  return a.parameter.length + (a.gruppen ?? []).reduce((s, g) => s + g.anzahl * g.parameter.length, 0) + (a.parameter_nach ?? []).length;
}
/** pool size of the kind */
export const instanzen = (name: string): number => art(name).instanzen;
/** controller rows of the whole pool of the kind */
export const zeilen = (name: string): number => instanzen(name) * zeilenJeInstanz(name);
/** all rows under `ins/` (kinds with table rows whose prefix is ins/) */
export const insZeilen = (): number => ARTEN.filter((a) => a.tabelle && a.praefix.startsWith('ins/')).reduce((s, a) => s + zeilen(a.art), 0);
