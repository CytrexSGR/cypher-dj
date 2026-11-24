// A synthetic tag store the size of the real catalogue (default 90,000 items, about 4.5 tag rows each, 6,000 made_from relations),
// generated into a temp file at test time. Nothing of it is committed. The shapes follow the real store: datei items with the catalogue
// typ as art, measured typ/charakter/genre/energie/tempo rows, a few manual rows, kits and loops made from files.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_DATEI } from '../../tags/store.ts';

const TYP = ['kick', 'snare', 'hihat', 'bass', 'clap', 'perc', 'synth', 'tom'];
const CHARAKTER = ['dark', 'bright', 'warm', 'punchy', 'deep', 'airy', 'tight', 'wide'];
const GENRE = ['techno', 'house', 'trance', 'dnb', 'ambient', 'electro'];
const WOERTER = ['Garage', 'Spartan', 'Houseloops', 'Rim', 'Saw', 'Vault', 'Neon', 'Grain', 'Pulse', 'Ember'];

export const itemId = (i) => `datei:${(i + 1).toString(16).padStart(64, '0')}`;
export const itemName = (i) => `${WOERTER[i % WOERTER.length]} ${WOERTER[(i * 7) % WOERTER.length]} ${String(i).padStart(6, '0')}`;

export function baueGross(pfad, n = 90000) {
  const d = new DatabaseSync(pfad);
  d.exec('PRAGMA journal_mode = WAL'); d.exec('PRAGMA synchronous = OFF');
  d.exec(fs.readFileSync(SCHEMA_DATEI, 'utf8').split('\n').filter((z) => !z.trim().startsWith('--')).join('\n').split(';').map((x) => x.trim()).filter(Boolean).join(';\n'));
  d.exec('PRAGMA user_version = 99');
  const item = d.prepare("INSERT INTO item(id, art, name, kopf, katalog, weg, geaendert) VALUES (?, ?, ?, '', 1, 0, ?)");
  const tag = d.prepare("INSERT INTO item_tag(item, tag, herkunft, quelle, an, wert, zeit) VALUES (?, ?, 'gemessen', 'messen', 1, NULL, 1)");
  const manuell = d.prepare("INSERT INTO item_tag(item, tag, herkunft, quelle, an, wert, zeit) VALUES (?, ?, 'nutzer', '', ?, NULL, 5)");
  const rel = d.prepare("INSERT OR IGNORE INTO relation(von, art, nach, herkunft, wert, zeit) VALUES (?, 'made_from', ?, 'scan', NULL, 1)");
  d.exec('BEGIN');
  for (let i = 0; i < n; i++) {
    const id = itemId(i);
    item.run(id, i % 3 === 0 ? 'loop' : 'oneshot', itemName(i), 1 + i / n);
    tag.run(id, `typ:${TYP[i % TYP.length]}`);
    tag.run(id, `charakter:${CHARAKTER[(i * 3) % CHARAKTER.length]}`);
    tag.run(id, `energie:${1 + (i % 5)}`);
    if (i % 2 === 0) tag.run(id, `genre:${GENRE[i % GENRE.length]}`);
    if (i % 4 === 0) tag.run(id, `tempo:${100 + (i % 80)}`);
    if (i % 50 === 0) manuell.run(id, `frei:fav ${i % 7}`, 1);
    if (i % 997 === 0) manuell.run(id, `charakter:${CHARAKTER[(i * 3) % CHARAKTER.length]}`, 0);   // a manual removal
  }
  // loops and kits made from files
  const hulle = d.prepare("INSERT INTO item(id, art, name, geaendert) VALUES (?, ?, ?, 1)");
  for (let i = 0; i < n / 15; i++) {
    const von = `loop:l${i}`;
    hulle.run(von, 'loop', `l${i}`);
    rel.run(von, itemId(i * 11 % n));
  }
  for (let i = 0; i < 60; i++) {
    const von = `kit:k${i}`;
    hulle.run(von, 'kit', `k${i}`);
    for (let j = 0; j < 8; j++) rel.run(von, itemId((i * 131 + j * 17) % n));
  }
  d.exec('COMMIT');
  d.exec('PRAGMA user_version = 2');
  d.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  d.close();
}
