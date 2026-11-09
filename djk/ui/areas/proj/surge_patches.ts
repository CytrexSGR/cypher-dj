// The Surge patch library as the project server sees it: the same two folders and the same name rule as djk-klang (hosts/carla/djk-klang finde_klang and
// liste): an own sound is <own folder>/<name>.fxp (CYPHERDJ_KLAENGE, else ~/.config/cypherdj/klaenge), a factory patch <factory folder>/<name>.fxp
// (CYPHERDJ_SURGE_PATCHES, else ~/.local/share/cypherdj/surge-daten/usr/share/surge-xt/patches_factory) with the path below it as the name ("Pads/Warm Pad").
// The own folder wins. Both are read at every call (a test instance points them elsewhere). geraet.patch of a Surge track holds such a name.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { istPatchName } from '../../project/model.ts';

export const eigeneOrdner = (): string => (process.env.CYPHERDJ_KLAENGE
  ? process.env.CYPHERDJ_KLAENGE : path.join(os.homedir(), '.config', 'cypherdj', 'klaenge'));
export const werkOrdner = (): string => (process.env.CYPHERDJ_SURGE_PATCHES
  ? process.env.CYPHERDJ_SURGE_PATCHES : path.join(os.homedir(), '.local', 'share', 'cypherdj', 'surge-daten', 'usr', 'share', 'surge-xt', 'patches_factory'));

// the file of a library name, null when the name breaks the rule or no such patch exists (the name rule first: no path leaves the folders)
export function surgePatchDatei(name: string): string | null {
  if (!istPatchName(name)) return null;
  for (const wurzel of [eigeneOrdner(), werkOrdner()]) {
    const datei = path.join(wurzel, `${name}.fxp`);
    try { if (fs.statSync(datei).isFile()) return datei; } catch { /* next folder */ }
  }
  return null;
}

export interface PatchEintrag { name: string; art: 'own' | 'factory' }
function lies(wurzel: string, art: PatchEintrag['art'], tief: boolean): PatchEintrag[] {
  const aus: PatchEintrag[] = [];
  const geh = (ordner: string, vor: string): void => {
    let eintraege: fs.Dirent[];
    try { eintraege = fs.readdirSync(ordner, { withFileTypes: true }); } catch { return; }
    for (const e of eintraege.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory() && tief) geh(path.join(ordner, e.name), `${vor}${e.name}/`);
      else if (e.isFile() && e.name.endsWith('.fxp')) { const name = `${vor}${e.name.slice(0, -4)}`; if (istPatchName(name)) aus.push({ name, art }); }
    }
  };
  geh(wurzel, '');
  return aus;
}
// what the picker offers: own sounds, then the factory patches, as `klang liste` prints them (own sounds are flat, the factory folder has subfolders)
export const listeSurgePatches = (): PatchEintrag[] => [...lies(eigeneOrdner(), 'own', false), ...lies(werkOrdner(), 'factory', true)];
