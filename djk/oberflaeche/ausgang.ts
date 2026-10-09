// Glanz 2.1 (F22): Stand der Digital-Out-Wache (djk/start/digitalwache.py) für GET /ausgang, /lage.ausgang und den
// Punkt OUT der Seite. Die Wache schreibt höchstens alle takt_ms (Vorgabe 1 s) ein Lebenszeichen; älter als
// WACHE_STUMM_S heißt: die Wache steht, ihr letzter Stand gilt nicht mehr.
import fs from 'node:fs';

export type AusgangZustand = 'gut' | 'aus' | 'kampf' | 'karte_fehlt' | 'unlesbar' | 'unbewacht' | 'wache_stumm';
export interface Ausgang {
  zustand: AusgangZustand; karte: number | null; faelle: number; letzter: Record<string, unknown> | null; alter_s: number | null;
}
export const WACHE_STUMM_S = 5;
const VON_DER_WACHE = new Set(['gut', 'aus', 'kampf', 'karte_fehlt', 'unlesbar']);

export function leseAusgang(datei: string | undefined, jetztMs: number = Date.now()): Ausgang {
  const ohne = (zustand: AusgangZustand): Ausgang => ({ zustand, karte: null, faelle: 0, letzter: null, alter_s: null });
  if (!datei) return ohne('unbewacht');
  let d: Record<string, unknown>;
  try {
    const roh: unknown = JSON.parse(fs.readFileSync(datei, 'utf8'));
    if (roh === null || typeof roh !== 'object' || Array.isArray(roh)) return ohne('unbewacht');
    d = roh as Record<string, unknown>;
  } catch { return ohne('unbewacht'); }
  const alter = (jetztMs - Date.parse(String(d.lebenszeichen))) / 1000;
  const z = String(d.zustand);
  const zustand: AusgangZustand = !Number.isFinite(alter) || alter > WACHE_STUMM_S ? 'wache_stumm'
    : VON_DER_WACHE.has(z) ? z as AusgangZustand : 'unlesbar';
  return { zustand, karte: typeof d.karte === 'number' ? d.karte : null, faelle: Number(d.faelle) || 0,
    letzter: d.letzter && typeof d.letzter === 'object' ? d.letzter as Record<string, unknown> : null,
    alter_s: Number.isFinite(alter) ? Math.round(alter * 10) / 10 : null };
}
