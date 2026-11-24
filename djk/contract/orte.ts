// Strudel place that resolves from the code's own location (package 1.0, spec D5). Twin of orte_strudel in djk/start/orte.sh.
// root = the folder above djk/ (a checkout, or /opt/cypher-dj). The page server and the generator may be started by a transient unit
// without the caller's environment, so the place never depends on the environment alone. (The node binary and the VST3 folders are
// resolved by orte.sh and plugin_scan.py. eigeneVst3Pfade below is the one TypeScript twin of the VST3 list, only to label the rows of
// GET /plugins/pfade; plugin_pfade.txt is never part of it, only the Python scan reads that file.)
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

export type Vst3Quelle = 'nutzer' | 'umgebung' | 'paket';
/** The own VST3 bundle folders in resolution order, twin of orte_vst3_pfade (orte.sh) and eigene_pfade() (plugin_scan.py): ~/.local/lib/cypherdj/vst3,
 *  one row per non-empty element of CYPHERDJ_VST3_PFADE, <root>/lib/vst3 when it is a folder. plugin_pfade.txt never feeds this list (a user folder must not shadow rb338.vst3). */
export function eigeneVst3Pfade(opt: { home?: string; env?: NodeJS.ProcessEnv; wurzel?: string } = {}): { pfad: string; quelle: Vst3Quelle }[] {
  const home = opt.home ?? os.homedir(), env = opt.env ?? process.env;
  const liste: { pfad: string; quelle: Vst3Quelle }[] = [{ pfad: path.join(home, '.local/lib/cypherdj/vst3'), quelle: 'nutzer' }];
  for (const p of (env.CYPHERDJ_VST3_PFADE ?? '').split(':')) if (p) liste.push({ pfad: p, quelle: 'umgebung' });
  const paket = path.join(opt.wurzel ?? WURZEL, 'lib', 'vst3');
  if (istOrdner(paket)) liste.push({ pfad: paket, quelle: 'paket' });
  return liste;
}
