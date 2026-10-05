// Die JSON-Schemas des Vertrags (djk/vertrag/, Scheiben 02 und 09) als Prüffunktionen (ajv, Entwurf 2020-12).
// Die Dateinamen stehen nur hier (SCHEMA_*). Liefern 02 oder 09 andere Namen, ändert sich nur diese Datei.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

export const VERTRAG_ORDNER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'vertrag');
export const SCHEMA_ORDNER = path.join(VERTRAG_ORDNER, 'schemas');
export const SCHEMA_WS = 'schemas/ws_nachricht.schema.json';       // 09: Umschlag §9.1, daten je typ §9.2 bis §9.4
export const SCHEMA_JOURNAL = 'schemas/journal_zeile.schema.json'; // 09: §15
export const SCHEMA_MCP = 'schemas/mcp.schema.json';               // 09: §10, $defs/mit_jetzt
export const SCHEMA_KONFIG = 'konfig.schema.json';                 // 02: §2.1, $defs["leitstand.toml"]

export interface Pruefung { ok: boolean; fehler: string }
export type Pruefer = (wert: unknown) => Pruefung;
type Ajv = InstanceType<typeof Ajv2020.default>;

const instanzen = new Map<boolean, Ajv>();

// Zwei Instanzen: mit Vorgaben (füllt fehlende Schlüssel aus "default", nur für die Konfiguration) und
// ohne (prüft Nachrichten, ohne sie zu verändern: ein Vorgabewert darf kein fehlendes Pflichtfeld verdecken).
function lade(mitVorgaben: boolean): Ajv {
  const da = instanzen.get(mitVorgaben);
  if (da) return da;
  // strict: false, weil konfig.schema.json eigene Schlüssel wie x-typ trägt
  const a = new Ajv2020.default({ strict: false, allErrors: true, useDefaults: mitVorgaben });
  const dateien = fs.readdirSync(SCHEMA_ORDNER).filter((n) => n.endsWith('.schema.json')).sort()
    .map((n) => path.join(SCHEMA_ORDNER, n));
  for (const p of [...dateien, path.join(VERTRAG_ORDNER, SCHEMA_KONFIG)]) {
    a.addSchema(JSON.parse(fs.readFileSync(p, 'utf8')));
  }
  instanzen.set(mitVorgaben, a);
  return a;
}

function idVon(datei: string): string {
  const id = JSON.parse(fs.readFileSync(path.join(VERTRAG_ORDNER, datei), 'utf8')).$id;
  if (typeof id !== 'string') throw new Error(`${datei} hat kein $id`);
  return id;
}

// pruefer(SCHEMA_WS) oder pruefer(SCHEMA_KONFIG, '#/$defs/leitstand.toml', true)
export function pruefer(datei: string, zeiger = '', mitVorgaben = false): Pruefer {
  const ref = idVon(datei) + zeiger;
  const v = lade(mitVorgaben).getSchema(ref);
  if (!v) throw new Error(`Schema ${ref} nicht gefunden`);
  return (wert: unknown) => {
    const ok = v(wert) as boolean;
    const fehler = ok ? '' : (v.errors ?? []).slice(0, 3)
      .map((e) => `${e.instancePath || '/'} ${e.message ?? ''} ${JSON.stringify(e.params)}`)
      .join('; ');
    return { ok, fehler };
  };
}
