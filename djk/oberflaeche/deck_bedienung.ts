// Plan E9 (Deck-Bedienung wie Traktor): reine Rechnung für den Seiten-Server. Ziel-Beat auf dem Einrastraster (D3),
// Delta eines Sprungs aus dem Kern-Stand (D4), Hotcues je Fassung in einer Datei (D5). Raster 0 = aus.
import fs from 'node:fs';
import path from 'node:path';

export const RASTER_WAHL = [0, 0.25, 1, 4, 16] as const;   // aus · ¼ Beat · 1 Beat · 1 Takt · 4 Takte (Spec E9)

export function naechsterRaster(b: number, r: number): number {
  return r > 0 ? r * Math.ceil(b / r - 1e-9) : b;
}

// Frühester Beat, an dem ein Deck-Teil noch sicher ankommt (Vorlauf, mindestens 0,05 Beat), auf das Raster gelegt.
export function abBeat(beat: number, vorlaufBeats: number, r: number): number {
  const frueh = beat + Math.max(vorlaufBeats, 0.05);
  return r > 0 ? naechsterRaster(frueh, r) : frueh;
}

// Delta zu einem Ziel-Quell-Beat. Läuft das Deck, zählt die Position bei ab_beat (Faktor 1 im Direktweg), und das Delta
// wird aufs Raster gerundet: so bleibt die Phase zum Master, und das Alter des Standes spielt keine Rolle.
// Steht das Deck, rastet das Ziel selbst ein (Raster ab der Takt-Eins der Fassung, Plan-Review E9 Befund 7/8).
export function sprungDelta(o: { laeuft: boolean; quell: number; beat: number; ab: number; ziel: number; raster: number; eins?: number }): number {
  if (!o.laeuft) return (o.raster > 0 ? rasterStelle(o.ziel, o.raster, o.eins ?? 0) : o.ziel) - o.quell;
  const roh = o.ziel - (o.quell + (o.ab - o.beat));
  return o.raster > 0 ? o.raster * Math.round(roh / o.raster) : roh;
}

// Nächste Rasterstelle, gezählt ab der Takt-Eins (erste_eins_quell_beat): bei 24 von 42 Fassungen ist sie ≠ 0 mod 4.
export function rasterStelle(q: number, r: number, eins: number): number {
  return eins + r * Math.round((q - eins) / r);
}

// Hotcue-Stelle aufs Raster; bei „aus“ auf 1 Beat wie der Cue-Punkt (kern_hand.cpp auf_beat).
export function rasterRunden(q: number, r: number, eins: number): number {
  return rasterStelle(q, r > 0 ? r : 1, eins);
}

export type Hotcue = { quell_beat: number; art: 'shot' | 'loop'; laenge?: number };
export type Fassung = { material_id: string; basis_bpm: number; fassung: number };

export const hotcueDatei = (ordner: string, f: Fassung): string =>
  path.join(ordner, `${f.material_id}_${Math.round(f.basis_bpm * 1000)}_r${f.fassung}.json`);

export function leseHotcues(datei: string): Record<string, Hotcue> {
  try {
    const j = JSON.parse(fs.readFileSync(datei, 'utf8')) as unknown;
    return j && typeof j === 'object' && !Array.isArray(j) ? j as Record<string, Hotcue> : {};
  } catch {
    return {};
  }
}

// Eine unlesbare Datei wird vorher gesichert (<datei>.kaputt-<ms>), nicht still überschrieben (Review E9 F8).
export function schreibeHotcues(datei: string, h: Record<string, Hotcue>): void {
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  if (fs.existsSync(datei)) {
    try { JSON.parse(fs.readFileSync(datei, 'utf8')); } catch { fs.renameSync(datei, `${datei}.kaputt-${Date.now()}`); }
  }
  const tmp = `${datei}.${process.pid}.neu`;
  fs.writeFileSync(tmp, JSON.stringify(h));
  fs.renameSync(tmp, datei);
}

// Plan Grid (D2, D4): Raster-Versatz in Frames (48 je ms), höchstens ±4 s wie /k/deck/raster.
export const RASTER_MAX = 192000;   // 4 s: SET braucht bis zu ~3,5 Beats (Eins zur ersten Eins im Track)
export function rasterSchritt(live: number, schrittMs: number): number {
  return Math.max(-RASTER_MAX, Math.min(RASTER_MAX, live + Math.round(schrittMs * 48)));
}

// SET (Traktor „Set Grid Marker“): der Schlag unter dem Kopf wird Takt-Eins. Der Versatz rückt um k ganze Beats mit
// round(quell) − k ≡ eins (mod 4). Unter den Kandidaten k0 + 4n gilt der, bei dem der Quell-Beat `eins` auf die ERSTE Eins
// im Track fällt (Frame in [−½, 3½) Beats): Kern (Laden, Cue) und Anzeige (Takt 1) zählen ab diesem Quell-Beat.
// null: der nötige Versatz liegt über RASTER_MAX.
export function einsSetzen(o: { v: number; quell: number; eins: number; fpb: number; erster: number }): { k: number; v: number } | null {
  const k0 = (((Math.round(o.quell) - o.eins) % 4) + 4) % 4;
  for (let n = -2; n <= 2; n++) {
    const k = k0 + 4 * n, v = o.v + Math.round(k * o.fpb);
    const f = (o.erster + v) / o.fpb + o.eins;     // Lage der Eins in Beats ab Frame 0
    if (f >= -0.5 && f < 3.5) return Math.abs(v) <= RASTER_MAX ? { k, v } : null;
  }
  return null;
}

// Plan Grid (D3): gespeicherter Versatz je Fassung, Name wie die Hotcue-Datei, eigener Ordner.
export const rasterDatei = (ordner: string, f: Fassung): string => hotcueDatei(ordner, f);
export function leseRaster(datei: string): number {
  try {
    const v = (JSON.parse(fs.readFileSync(datei, 'utf8')) as { versatz_frames?: unknown }).versatz_frames;
    return typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= RASTER_MAX ? v : 0;
  } catch {
    return 0;
  }
}
export function schreibeRaster(datei: string, v: number): void {
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  const tmp = `${datei}.${process.pid}.neu`;
  fs.writeFileSync(tmp, JSON.stringify({ versatz_frames: v }));
  fs.renameSync(tmp, datei);
}
