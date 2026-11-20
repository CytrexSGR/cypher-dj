// Path of a factory graph in the repo: djk/instruments/modular_dsp/demos/<name>.json or demos/recipes/<name>.json, the sources the
// starter copies into the user's graph folder (djk/starter/graphs.py, quellen_der_beispiele). Tests read the source, not the user's
// copy, so they run in an empty home (fresh build 2026-11-20: 7 panel tests failed in the container). A graph the repo does not carry
// (an instrument made from the user's own samples) is looked up in the user's graph folder; the tests skip it when it is not there.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'instruments', 'modular_dsp', 'demos');

export function werksgraphPfad(name) {
  const direkt = path.join(WURZEL, `${name}.json`);
  const rezept = path.join(WURZEL, 'recipes', `${name}.json`);
  if (fs.existsSync(direkt)) return direkt;
  if (fs.existsSync(rezept)) return rezept;
  return path.join(os.homedir(), 'cypherdj', 'werke', 'geraete', `${name}.json`);
}
