// Helpers for the tag tests: a store as the Python side leaves it (the shared schema file), rows written directly.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_DATEI } from '../../tags/store.ts';

export const sha = (n) => String(n).padStart(4, '0').repeat(16);
export const dat = (n) => `datei:${sha(n)}`;

// Opens (creating) the store file with the schema; returns the open DatabaseSync (caller closes)
export function oeffneStore(pfad) {
  fs.mkdirSync(path.dirname(pfad), { recursive: true });
  const d = new DatabaseSync(pfad);
  d.exec('PRAGMA journal_mode = WAL');
  d.exec(fs.readFileSync(SCHEMA_DATEI, 'utf8'));
  return d;
}

// item: { id, art?, name?, weg?, geaendert?, tags?: [tag | [tag, herkunft, an]] }
export function schreibeItems(d, items) {
  const i = d.prepare('INSERT OR REPLACE INTO item(id, art, name, kopf, katalog, weg, geaendert) VALUES (?, ?, ?, ?, 1, ?, ?)');
  const t = d.prepare('INSERT OR REPLACE INTO item_tag(item, tag, herkunft, quelle, an, wert, zeit) VALUES (?, ?, ?, ?, ?, NULL, ?)');
  d.exec('BEGIN');
  for (const it of items) {
    i.run(it.id, it.art ?? 'loop', it.name ?? '', '', it.weg ? 1 : 0, it.geaendert ?? 1);
    for (const x of it.tags ?? []) {
      const [tag, herkunft = 'gemessen', an = 1] = Array.isArray(x) ? x : [x];
      const manuell = herkunft === 'nutzer' || herkunft === 'agent';
      t.run(it.id, tag, herkunft, manuell ? '' : herkunft === 'gemessen' ? 'messen' : 'erbe', an, 1 + (manuell ? 1 : 0));
    }
  }
  d.exec('COMMIT');
}

export function schreibeBezug(d, von, art, nach, herkunft = 'melde', wert = null) {
  d.prepare('INSERT OR REPLACE INTO relation(von, art, nach, herkunft, wert, zeit) VALUES (?, ?, ?, ?, ?, 1)').run(von, art, nach, herkunft, wert);
}
