// A test instance (CYPHERDJ_INSTANZ non-empty) must never write into the owner's Baukasten folder (storage kind geraete, ~/.config/cypherdj/baukasten).
// The table gives an instance its own folder (/dev/shm/cypherdj-<i>/geraete, or CYPHERDJ_BK_ORDNER) and the kern reads the same folder from CYPHERDJ_BK_ORDNER
// (djk-start passes it to page and kern units). This guard is the last line: a path under the owner's folder is refused whatever route led there.
import fs from 'node:fs';
import path from 'node:path';
import { ablageOrte, instanz } from '../paths.ts';
import { SchnittFehler } from './schnitt.ts';

const unter = (datei: string, ordner: string): boolean => { const r = path.relative(ordner, datei); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r); };
const echt = (p: string): string => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

/** Throws SchnittFehler 409 `bk_ordner_fehlt` when a test instance is about to write `datei` inside the owner's Baukasten folder. */
export function pruefeBkSchreiben(datei: string): void {
  if (instanz() === '') return;
  const echter = ablageOrte('geraete').alt;
  const d = path.resolve(datei);
  if (unter(d, path.resolve(echter)) || unter(echt(d), echt(echter)) || unter(path.join(echt(path.dirname(d)), path.basename(d)), echt(echter)))
    throw new SchnittFehler(409, 'bk_ordner_fehlt', `test instance ${instanz()} may not write into the owner's device folder ${echter}: set CYPHERDJ_BK_ORDNER to a folder of its own`);
}

/** Reason text when a test instance is about to write kits into the owner's kit folder (the configured one or the old default), else null. A kit folder of the
 *  instance's own (CYPHERDJ_KIT_ORDNER, djk-start --kit-ordner, an explicit option) is never the owner's, so it passes. Kit reads stay open. */
export function kitSchreibGrund(wurzel: string): string | null {
  if (instanz() === '') return null;
  const orte = ablageOrte('kits');
  const w = echt(path.resolve(wurzel));
  for (const e of [orte.alt, orte.neu]) {
    if (e === '' || e === undefined || e === null) continue;
    if (w === echt(path.resolve(e)) || unter(w, echt(path.resolve(e)))) return `test instance ${instanz()} may not write into the owner's kit folder ${e}: set CYPHERDJ_KIT_ORDNER to a folder of its own`;
  }
  return null;
}

/** SchnittFehler 409 `kit_ordner_fehlt` for the sampler kit writers. */
export function pruefeKitSchreiben(wurzel: string): void {
  const g = kitSchreibGrund(wurzel);
  if (g !== null) throw new SchnittFehler(409, 'kit_ordner_fehlt', g);
}
