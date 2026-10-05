// Die Schlüssel aus kern.toml, die der Leitstand für seine Vorprüfung braucht (SCHNITTSTELLEN §2.1): hoerbar_db,
// tief_offen_db (§1.6), max_stretcher (§4.4, Grund budget_stretcher) und arbeitsbestand (§6.4: Ziel der Kopie, die
// laden vor /k/deck/laden anlegt). Nur lesen; fehlt die Datei, gelten die Vorgaben aus djk/vertrag/konfig.schema.json.
// Pfad wie der Kern, mit Prüfinstanz nach ROADMAP Z2.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import { mitInstanz } from './konfig.ts';
import { pruefer, SCHEMA_KONFIG } from './vertrag.ts';

export interface KernWerte {
  hoerbar_db: number; tief_offen_db: number; max_stretcher: number; arbeitsbestand_pfad: string; quelle: string;
}

const pruefe = pruefer(SCHEMA_KONFIG, '#/$defs/kern.toml', true);

export function ladeKernWerte(pfad: string | undefined, instanz: string): KernWerte {
  const standard = path.join(os.homedir(), '.config', instanz ? `cypherdj-${instanz}` : 'cypherdj', 'kern.toml');
  const p = pfad ?? standard;
  let roh: Record<string, unknown> = { version: 1 };
  let quelle = 'vorgaben';
  if (fs.existsSync(p)) {
    roh = parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
    quelle = p;
  } else if (pfad) {
    throw new Error(`kern.toml ${pfad} fehlt`);
  }
  const k = structuredClone(roh);
  const e = pruefe(k);
  if (!e.ok) throw new Error(`${quelle}: ${e.fehler} (SCHNITTSTELLEN §2.1)`);
  return {
    hoerbar_db: k.hoerbar_db as number, tief_offen_db: k.tief_offen_db as number, max_stretcher: k.max_stretcher as number,
    arbeitsbestand_pfad: mitInstanz(k.arbeitsbestand as string, instanz), quelle,
  };
}
