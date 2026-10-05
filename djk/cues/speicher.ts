// Cue-Daten je Track als JSON (Schema djk.cues/1, siehe docs/architektur/stand/cues-werkzeug.md).
// Dateiname: sha1(pfad_rel).json unter <daten>/; im Inhalt der volle Schlüssel (pfad_rel, groesse, sha1_erste_mib).
// Takt, Schlag und quell_beat rechnet der Server beim Speichern aus dem Raster neu (raster.js), die Seite liefert
// nur Sekunde, Slot, Name, Farbe. Die MP3 wird nur gelesen (sha1 der ersten MiB).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cueFelder, LAENGEN_TAKTE, loopFelder, rasterFelder } from './oeffentlich/raster.js';
import { schreibeAtomar } from './welle.ts';

export const SCHEMA = 'djk.cues/1';
export const SLOTS = 8;

export interface Cue {
  slot: number; s: number; quell_beat: number; takt: number; schlag: number; name: string; farbe: string;
  quantisiert: boolean; gesetzt: string;
  // Loop (optional): laenge_takte gesetzt -> ende_s/ende_takt aus dem Raster gerechnet (raster.js loopFelder)
  laenge_takte?: number; ende_s?: number; ende_takt?: number;
}
export interface Raster { bpm: number; eins_s: number; quelle: string; }
export interface CueDatei {
  schema: string;
  schluessel: { pfad_rel: string; groesse: number; sha1_erste_mib: string };
  datei: { titel: string | null; artist: string | null; tbpm: number | null; tkey: string | null };
  raster: ReturnType<typeof rasterFelder>;
  cues: Cue[];
  angelegt: string; geaendert: string;
}

export class EingabeFehler extends Error {}

export function dateiName(rel: string): string { return `${crypto.createHash('sha1').update(rel).digest('hex')}.json`; }

export function sha1ErsteMib(datei: string): string {
  const fd = fs.openSync(datei, 'r');
  try {
    const b = Buffer.alloc(1 << 20);
    const n = fs.readSync(fd, b, 0, b.length, 0);
    return crypto.createHash('sha1').update(b.subarray(0, n)).digest('hex');
  } finally { fs.closeSync(fd); }
}

export function lade(daten: string, rel: string): CueDatei | null {
  try { return JSON.parse(fs.readFileSync(path.join(daten, dateiName(rel)), 'utf8')) as CueDatei; } catch { return null; }
}

// Prüft die Eingabe der Seite; wirft EingabeFehler (-> 400, nichts geschrieben)
export function pruefe(e: unknown, dauer: number): { raster: Raster; cues: { slot: number; s: number; name: string; farbe: string; quantisiert: boolean; gesetzt?: string; laenge_takte?: number }[] } {
  const o = e as Record<string, unknown>;
  if (!o || typeof o !== 'object') throw new EingabeFehler('Körper ist kein Objekt');
  const r = o.raster as Record<string, unknown>;
  if (!r || !(typeof r.bpm === 'number' && r.bpm >= 40 && r.bpm <= 300)) throw new EingabeFehler('raster.bpm fehlt oder außerhalb 40..300');
  if (typeof r.eins_s !== 'number' || !Number.isFinite(r.eins_s)) throw new EingabeFehler('raster.eins_s fehlt');
  if (!Array.isArray(o.cues)) throw new EingabeFehler('cues ist keine Liste');
  const gesehen = new Set<number>();
  const cues = o.cues.map((c: Record<string, unknown>) => {
    if (!Number.isInteger(c.slot) || (c.slot as number) < 1 || (c.slot as number) > SLOTS) throw new EingabeFehler(`slot ${c.slot} außerhalb 1..${SLOTS}`);
    if (gesehen.has(c.slot as number)) throw new EingabeFehler(`slot ${c.slot} doppelt`);
    gesehen.add(c.slot as number);
    if (typeof c.s !== 'number' || !Number.isFinite(c.s) || c.s < 0 || c.s > dauer + 0.5) throw new EingabeFehler(`s ${c.s} außerhalb 0..${dauer.toFixed(1)}`);
    if (c.laenge_takte !== undefined && !LAENGEN_TAKTE.includes(c.laenge_takte as number)) throw new EingabeFehler(`laenge_takte ${c.laenge_takte} ungültig (erlaubt: ${LAENGEN_TAKTE.join(', ')})`);
    const name = typeof c.name === 'string' ? c.name.slice(0, 40) : '';
    const farbe = typeof c.farbe === 'string' && /^#[0-9a-f]{6}$/i.test(c.farbe) ? c.farbe.toLowerCase() : '#2fd6c3';
    return {
      slot: c.slot as number, s: c.s, name, farbe, quantisiert: c.quantisiert !== false,
      gesetzt: typeof c.gesetzt === 'string' ? c.gesetzt : undefined,
      laenge_takte: c.laenge_takte as number | undefined,
    };
  });
  return { raster: { bpm: r.bpm, eins_s: r.eins_s, quelle: typeof r.quelle === 'string' ? r.quelle.slice(0, 20) : 'andreas' }, cues };
}

// Schreibt die Datei (atomar). Ohne Cues und mit unverändertem Vorschlagsraster wird die Datei entfernt: leerer Stand.
export function speichere(daten: string, wurzel: string, rel: string, meta: CueDatei['datei'], eingabe: unknown, dauer: number): CueDatei | null {
  const { raster, cues } = pruefe(eingabe, dauer);
  const ziel = path.join(daten, dateiName(rel));
  const alt = lade(daten, rel);
  if (cues.length === 0 && raster.quelle !== 'andreas') { fs.rmSync(ziel, { force: true }); return null; }
  const abs = path.join(wurzel, rel);
  const jetzt = new Date().toISOString();
  const altNachSlot = new Map((alt?.cues ?? []).map((c) => [c.slot, c]));
  const d: CueDatei = {
    schema: SCHEMA,
    schluessel: { pfad_rel: rel, groesse: fs.statSync(abs).size, sha1_erste_mib: sha1ErsteMib(abs) },
    datei: meta,
    raster: rasterFelder(raster),
    cues: cues.sort((a, b) => a.slot - b.slot).map((c) => {
      const a = altNachSlot.get(c.slot);
      const gleich = a && Math.abs(a.s - c.s) < 1e-4 && (a.laenge_takte ?? undefined) === (c.laenge_takte ?? undefined);
      const loop = c.laenge_takte ? { laenge_takte: c.laenge_takte, ...loopFelder(raster, c.s, c.laenge_takte) } : {};
      return { slot: c.slot, ...cueFelder(raster, c.s), ...loop, name: c.name, farbe: c.farbe, quantisiert: c.quantisiert, gesetzt: gleich ? a.gesetzt : (c.gesetzt ?? jetzt) };
    }),
    angelegt: alt?.angelegt ?? jetzt,
    geaendert: jetzt,
  };
  schreibeAtomar(ziel, `${JSON.stringify(d, null, 2)}\n`);
  return d;
}

// Zähler "Cues gesetzt" je pfad_rel über alle Dateien im Datenordner
export function zaehleAlle(daten: string): Map<string, number> {
  const aus = new Map<string, number>();
  let dateien: string[] = [];
  try { dateien = fs.readdirSync(daten).filter((f) => f.endsWith('.json')); } catch { return aus; }
  for (const f of dateien) {
    try { const d = JSON.parse(fs.readFileSync(path.join(daten, f), 'utf8')) as CueDatei; aus.set(d.schluessel.pfad_rel, d.cues.length); } catch { /* kaputt: nicht zählen */ }
  }
  return aus;
}
