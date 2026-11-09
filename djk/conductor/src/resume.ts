// Leitstand-Neustart ohne --set-id (systemd startet die Unit neu): der neue Leitstand setzt das laufende Set fort, wenn
// <sets>/aktuell ein Set nennt, dessen Journal in den letzten FORTSETZEN_S Sekunden geschrieben wurde; sonst beginnt
// ein neues Set. 600 s sind gesetzt (ein Neustart dauert Sekunden; nach zehn Minuten Stille ist das Set vorbei).
import fs from 'node:fs';
import path from 'node:path';
import { SET_ID_FORM } from './journal.ts';

export const FORTSETZEN_S = 600;

export function fortsetzbar(setsPfad: string, jetztMs = Date.now()): string | null {
  let id: string;
  try { id = fs.readFileSync(path.join(setsPfad, 'aktuell'), 'utf8').trim(); } catch { return null; }
  if (!SET_ID_FORM.test(id)) return null;
  try {
    const j = fs.statSync(path.join(setsPfad, id, 'journal.jsonl'));
    return jetztMs - j.mtimeMs <= FORTSETZEN_S * 1000 ? id : null;
  } catch { return null; }
}

export function merkeAktuell(setsPfad: string, setId: string): void {
  fs.mkdirSync(setsPfad, { recursive: true });
  const tmp = path.join(setsPfad, `aktuell.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${setId}\n`);
  fs.renameSync(tmp, path.join(setsPfad, 'aktuell'));
}
