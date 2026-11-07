// 1.9 (L25): the kit folder as the project server sees it. A kit is a folder <kit folder>/<name>/ holding kit.json (kern/src/kit.cpp lade_kit).
// The folder is kitsOrdnerVorgabe() (CYPHERDJ_KIT_ORDNER of a test instance, else the configured one), read at every call. The server only checks the
// JSON shape here; the core loads and validates the sound files itself and refuses the playback with `format` when a kit does not load.
import fs from 'node:fs';
import path from 'node:path';
import { KIT_NAME } from '../../projekt/modell.ts';
import { kitsOrdnerVorgabe } from '../../pfade.ts';

export interface KitEintrag { name: string; klaenge: number }

// The shape lade_kit demands first: an object, schema 1, klaenge an array with at least one entry that has an integer note.
function leseKit(ordner: string): number | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ordner, 'kit.json'), 'utf8')) as { schema?: unknown; klaenge?: unknown };
    if (typeof j !== 'object' || j === null || j.schema !== 1 || !Array.isArray(j.klaenge) || j.klaenge.length === 0) return null;
    if (!j.klaenge.every((k) => typeof k === 'object' && k !== null && Number.isInteger((k as { note?: unknown }).note))) return null;
    return j.klaenge.length;
  } catch { return null; }
}

// Does the kit folder hold a kit of this name (the name rule first: no path leaves the folder)
export function kitDa(name: string): boolean {
  if (!KIT_NAME.test(name)) return false;
  try { return fs.statSync(path.join(kitsOrdnerVorgabe(), name, 'kit.json')).isFile(); } catch { return false; }
}

// The kits the picker offers: folder names that pass the name rule and hold a kit.json of the right shape, sorted by name
export function listeKits(): KitEintrag[] {
  const wurzel = kitsOrdnerVorgabe();
  let namen: string[];
  try { namen = fs.readdirSync(wurzel); } catch { return []; }
  const aus: KitEintrag[] = [];
  for (const name of namen.sort()) {
    if (!KIT_NAME.test(name)) continue;
    const n = leseKit(path.join(wurzel, name));
    if (n !== null) aus.push({ name, klaenge: n });
  }
  return aus;
}
