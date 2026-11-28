// Harmony lane file of a stream folder (plan strand 7, task 2.2): `harmonie.json` beside strom1.js holds {eintraege: [...]} with the
// entries of public/harmonie.js laneEintrag(). The page server writes it into every stream folder; a missing file means no lane.
import fs from 'node:fs';
import path from 'node:path';

export const HARMONIE_DATEI = 'harmonie.json';

const eintragOk = (e) => e && typeof e === 'object' && Number.isInteger(e.ab_zyklus) && e.ab_zyklus >= 0
  && Number.isInteger(e.takte_je_akkord) && e.takte_je_akkord >= 1 && Array.isArray(e.folge)
  && e.folge.every((a) => a && Array.isArray(a.toene) && a.toene.every(Number.isInteger) && Number.isInteger(a.grundton))
  && (e.folge.length === 0 || (e.tonart && Number.isInteger(e.tonart.grundton) && Array.isArray(e.tonart.stufen) && e.tonart.stufen.length > 0));

// ENOENT -> [] (no lane, the file is gone on purpose). Any other read error, broken JSON or an invalid shape -> `letzter` (keep the last good lane).
export function leseHarmonie(ordner, letzter = []) {
  let text;
  try { text = fs.readFileSync(path.join(ordner, HARMONIE_DATEI), 'utf8'); } catch (e) { return e.code === 'ENOENT' ? [] : letzter; }
  try {
    const j = JSON.parse(text);
    return Array.isArray(j?.eintraege) && j.eintraege.every(eintragOk) ? j.eintraege : letzter;
  } catch {
    return letzter;
  }
}
