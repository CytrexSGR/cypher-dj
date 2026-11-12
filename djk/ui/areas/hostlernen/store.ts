// Host learn: the table host_ziele.json next to lernen.json (controller folder). It maps a slot row of a live channel, `<kanal>/bk/<n>`, to the
// parameter of the instrument host that CC moves: {gruppe, art, name}. The kern knows nothing of it; the learn table only knows slot -> CC.
// Written atomically; a file that does not parse is reported ("kaputt") and never overwritten.
import fs from 'node:fs';
import path from 'node:path';
import { schreibeAtomar } from '../devices/edges.ts';
import { LernFehler } from '../learn/store.ts';

export type HostArt = 'surge' | 'rb338' | 'vst3';
export interface HostZiel { gruppe: string; art: HostArt; name: string }
export interface HostStand { datei: 'fehlt' | 'ok' | 'kaputt'; ziele: Record<string, HostZiel> }
export const SLOTS = 64;

const istObjekt = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const SLOT = /^(erz\/[23])\/bk\/([1-9]|[1-5][0-9]|6[0-4])$/;
export const slotKanal = (pfad: string): string | null => SLOT.exec(pfad)?.[1] ?? null;
export const slotNr = (pfad: string): number | null => { const m = SLOT.exec(pfad); return m ? Number(m[2]) : null; };

export class HostSpeicher {
  readonly datei: string;
  constructor(ordner: string) { this.datei = path.join(ordner, 'host_ziele.json'); }

  lies(): HostStand {
    let text: string;
    try { text = fs.readFileSync(this.datei, 'utf8'); } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'ENOENT' ? { datei: 'fehlt', ziele: {} } : { datei: 'kaputt', ziele: {} };
    }
    let j: unknown;
    try { j = JSON.parse(text); } catch { return { datei: 'kaputt', ziele: {} }; }
    if (!istObjekt(j) || j.version !== 1 || !istObjekt(j.ziele)) return { datei: 'kaputt', ziele: {} };
    const ziele: Record<string, HostZiel> = {};
    for (const [pfad, z] of Object.entries(j.ziele)) {
      if (!SLOT.test(pfad) || !istObjekt(z) || typeof z.gruppe !== 'string' || typeof z.name !== 'string' || !['surge', 'rb338', 'vst3'].includes(z.art as string)) return { datei: 'kaputt', ziele: {} };
      ziele[pfad] = { gruppe: z.gruppe, art: z.art as HostArt, name: z.name };
    }
    return { datei: 'ok', ziele };
  }

  private gesund(): HostStand {
    const s = this.lies();
    if (s.datei === 'kaputt') throw new LernFehler('host_ziele_kaputt', 409, 'host_ziele.json is damaged; it was left untouched');
    return s;
  }
  private schreibe(ziele: Record<string, HostZiel>): void {
    const sortiert = Object.fromEntries(Object.entries(ziele).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
    schreibeAtomar(this.datei, `${JSON.stringify({ version: 1, ziele: sortiert }, null, 1)}\n`);
  }

  setze(pfad: string, ziel: HostZiel): void {
    const s = this.gesund();
    if (!SLOT.test(pfad)) throw new LernFehler('argument_ungueltig', 400, 'pfad: erz/2|3/bk/1..64');
    this.schreibe({ ...s.ziele, [pfad]: ziel });
  }
  /** true when there was an entry */
  entferne(pfad: string): boolean {
    const s = this.gesund();
    if (!(pfad in s.ziele)) return false;
    const rest = { ...s.ziele };
    delete rest[pfad];
    this.schreibe(rest);
    return true;
  }
}

/** The lowest slot 1..64 of `kanal` that is not in `belegt` (a set of slot numbers); null when all 64 are taken. */
export function freierSlot(belegt: ReadonlySet<number>): number | null {
  for (let n = 1; n <= SLOTS; n++) if (!belegt.has(n)) return n;
  return null;
}
