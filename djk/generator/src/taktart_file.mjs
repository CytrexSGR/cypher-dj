// Meter file of a stream folder (plan studio-taktart M1): `taktart` beside strom1.js holds the beats per bar as an integer.
// It exists ONLY while the meter is not 4; a missing file means exactly 4.
import fs from 'node:fs';
import path from 'node:path';
import { atomar } from './pattern_state.mjs';

export const TAKTART_DATEI = 'taktart';

export function schreibeTaktart(ordner, proTakt) {
  const datei = path.join(ordner, TAKTART_DATEI);
  if (proTakt === 4) {
    try { fs.unlinkSync(datei); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return;
  }
  fs.mkdirSync(ordner, { recursive: true });
  atomar(datei, String(proTakt));
}

// ENOENT -> 4 (the file is gone on purpose). Any other read error or a broken text -> `letzter` (keep the last good value).
export function leseTaktart(ordner, letzter = 4) {
  let text;
  try { text = fs.readFileSync(path.join(ordner, TAKTART_DATEI), 'utf8'); } catch (e) { return e.code === 'ENOENT' ? 4 : letzter; }
  const t = text.trim();
  if (!/^\d+$/.test(t)) return letzter;
  const n = Number(t);
  return n >= 2 && n <= 12 ? n : letzter;
}
