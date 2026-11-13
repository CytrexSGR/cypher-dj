// 1.9 (L10): the status files of the production hosts (djk-instrumente --arr1, --arr2). instrument_host.py writes /dev/shm/cypherdj[-i]/wirt-arr<s>.json
// ({name, pid, bereit, fehler, sock, klang, art, fahrbar}); this module answers whether a slot's host is alive and, if not, why (spec E3).
import fs from 'node:fs';
import path from 'node:path';
import { WIRT_SLOTS } from '../../project/model.ts';

// instrument_host.py writes these entries right before it exits 2 (engine_init, add_plugin, vst3, sfz, steuerung); the others
// (wache, bereiche, aktiv-klang) are written while it keeps playing. Only a fatal entry of a host that is not alive turns wirt_fehlt into wirt_fehler.
export const WIRT_FATAL = ['engine_init', 'add_plugin', 'vst3', 'sfz', 'steuerung'];

export const wirtDatei = (ordner: string, slot: number): string => path.join(ordner, `wirt-arr${slot}.json`);

// S3-Fix W2: gilt die Status-Datei eines Wirts noch? Ja nur, wenn bereit true ist, pid eine ganze Zahl > 0 ist, /proc/<pid> lebt und der
// Prozess instrument_host.py ausführt (ein Argument der Befehlszeile heißt instrument_host.py: so fängt es eine wiederverwendete pid ab).
// Jeder Lese- oder Formatfehler heißt: nein.
export function wirtLebt(datei: string): boolean {
  try {
    const st = JSON.parse(fs.readFileSync(datei, 'utf8')) as { bereit?: unknown; pid?: unknown } | null;
    if (st?.bereit !== true || typeof st.pid !== 'number' || !Number.isInteger(st.pid) || st.pid <= 0) return false;
    return fs.readFileSync(`/proc/${st.pid}/cmdline`, 'utf8').split('\0').some((a) => path.basename(a) === 'instrument_host.py');
  } catch { return false; }
}

// The `fehler` list of the status file: the strings in it; a missing or damaged file or a field of another shape gives [].
export function wirtFehler(datei: string): string[] {
  try {
    const st = JSON.parse(fs.readFileSync(datei, 'utf8')) as { fehler?: unknown } | null;
    return Array.isArray(st?.fehler) ? st.fehler.filter((e): e is string => typeof e === 'string') : [];
  } catch { return []; }
}

export const istFatal = (eintrag: string): boolean => WIRT_FATAL.some((p) => eintrag.startsWith(`${p}:`));

// The state of one slot for the refusal: lebt = the host is alive (whatever its `fehler` holds); fatal = the first fatal entry of a host that is not
// alive (null otherwise). output.ts turns it into wirt_fehler (fatal entry) or wirt_fehlt (none).
export function wirtStand(ordner: string, slot: number): { lebt: boolean; fatal: string | null } {
  const datei = wirtDatei(ordner, slot);
  if (wirtLebt(datei)) return { lebt: true, fatal: null };
  return { lebt: false, fatal: wirtFehler(datei).find(istFatal) ?? null };
}

// proj_lage: {1: {laeuft, fehler[]}, 2: {...}}; fehler lists every entry (also the non-fatal ones, which never refuse anything)
export function wirtLage(ordner: string): Record<string, { laeuft: boolean; fehler: string[] }> {
  const lage: Record<string, { laeuft: boolean; fehler: string[] }> = {};
  for (let s = 1; s <= WIRT_SLOTS; s++) lage[String(s)] = { laeuft: wirtLebt(wirtDatei(ordner, s)), fehler: wirtFehler(wirtDatei(ordner, s)) };
  return lage;
}
