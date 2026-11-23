// Strudel place that resolves from the code's own location (package 1.0, spec D5). Twin of orte_strudel in djk/start/orte.sh.
// root = the folder above djk/ (a checkout, or /opt/cypher-dj). The page server and the generator may be started by a transient unit
// without the caller's environment, so the place never depends on the environment alone. (The node binary and the VST3 folders are
// resolved by orte.sh and plugin_scan.py; nothing on the TypeScript side needs them.)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WURZEL = path.resolve(import.meta.dirname, '../..');   // this file is djk/contract/orte.ts

const istOrdner = (p: string): boolean => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/** Folder that holds packages/: parent of STRUDEL_PAKETE (wins, as before), else CYPHERDJ_STRUDEL (must exist), else <root>/strudel when present, else ~/strudel. */
export function strudelOrdner(): string {
  if (process.env.STRUDEL_PAKETE) return path.dirname(process.env.STRUDEL_PAKETE);
  const wahl = process.env.CYPHERDJ_STRUDEL;
  if (wahl) {
    if (!istOrdner(wahl)) throw new Error(`CYPHERDJ_STRUDEL: ${wahl} does not exist`);
    return wahl;
  }
  const eigen = path.join(WURZEL, 'strudel');
  return istOrdner(eigen) ? eigen : path.join(os.homedir(), 'strudel');
}
