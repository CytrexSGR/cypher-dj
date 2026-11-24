// Node wrapper around djk/tools/zipwerk.py (entpacke from browser plan 1, packe and groesse from plan 5).
// The helper is run with execFile (no shell) and `python3 -I`; exit 2 means refused and becomes a ZipFehler with the helper's reason.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zeitLimitMs } from './einsammeln.ts';

export class ZipFehler extends Error {
  readonly grund: string;
  constructor(grund: string) { super(grund); this.name = 'ZipFehler'; this.grund = grund; }
}
export type ZipBericht = {
  eintraege: number; bytes?: number; uebersprungen: { name: string; grund: string }[]; ausgelassen?: string[];
  hat_kit_json?: boolean; hat_projekt_json?: boolean;
};
type Opt = { signal?: AbortSignal; maxBytes?: number; maxEintraege?: number };

const SKRIPT = (): string => process.env.CYPHERDJ_ZIPWERK
  ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'zipwerk.py');

function lauf(args: string[], frist: number, signal?: AbortSignal): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    execFile('python3', ['-I', SKRIPT(), ...args], { timeout: frist, maxBuffer: 64 * 2 ** 20, signal }, (err, stdout) => {
      if (!err) {
        try { resolve(JSON.parse(stdout) as Record<string, unknown>); } catch { reject(new Error('zipwerk: unreadable answer')); }
        return;
      }
      if ((err as { code?: unknown }).code === 2) {
        let grund = 'unbekannt';
        try { grund = String((JSON.parse(stdout || '{}') as { abgelehnt?: unknown }).abgelehnt ?? grund); } catch { /* generic reason */ }
        return reject(new ZipFehler(grund));
      }
      reject(err);
    });
  });
}

const grenzen = (o?: Opt): string[] => [
  ...(o?.maxBytes !== undefined ? ['--max-bytes', String(o.maxBytes)] : []),
  ...(o?.maxEintraege !== undefined ? ['--max-eintraege', String(o.maxEintraege)] : []),
];
// the helper's own byte cap is 4 GiB: size the time limit for it
const FRIST = zeitLimitMs(4 * 2 ** 30);

/** Unpacks `zip` into the new folder `ziel` (must not exist; the helper creates it). */
export const entpacke = (zip: string, ziel: string, o?: Opt): Promise<ZipBericht> =>
  lauf(['entpacke', zip, ziel, ...grenzen(o)], FRIST, o?.signal) as Promise<ZipBericht>;

/** Zips the tree under `ordner` into the new file `zip`; `ohne` are fnmatch patterns (a trailing "/" = a folder at any depth). */
export const packe = (ordner: string, zip: string, o?: Opt & { ohne?: string[]; nur?: string[]; dazu?: [string, string][]; ersetze?: Record<string,
  string> }): Promise<ZipBericht> =>
  lauf(['packen', ordner, zip, ...(o?.ohne ?? []).flatMap((m) => ['--ohne', m]), ...(o?.nur ?? []).flatMap((m) => ['--nur', m]),
    ...(o?.dazu ?? []).flatMap(([p, f]) => ['--dazu', `${p}=${f}`]), ...Object.entries(o?.ersetze ?? {}).flatMap(([n, f]) => ['--ersetze', `${n}=${f}`]),
      ...grenzen(o)], FRIST, o?.signal) as Promise<ZipBericht>;

/** Entries and declared bytes of a zip, nothing unpacked. */
export const zipGroesse = (zip: string): Promise<{ eintraege: number; bytes: number }> =>
  lauf(['groesse', zip], 120_000) as Promise<{ eintraege: number; bytes: number }>;
