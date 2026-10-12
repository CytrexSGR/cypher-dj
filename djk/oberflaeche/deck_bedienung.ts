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

// --- Korrekturen überleben neue Fassungen (2026-10-11, Bericht grid-phase M7) ---------------------------------------------
// Die Raster-Datei heißt <mid>_<basis·1000>_r<N>.json. Eine neue Fassung (korrigieren, lauf_phase) legt eine neue Nummer an,
// `laden` nimmt die neueste: ihre Datei fehlte, Andreas' Versatz (ganze Beats UND Feinversatz) war verloren. Jetzt gilt bei
// fehlender Datei die der nächstälteren Fassung desselben Materials auf derselben Basis. Der Versatz ist in Frames des
// Basis-Rasters gemessen (fpb = 48000·60/basis), also fassungsübergreifend gleich, solange die Basis gleich ist.
// Nicht doppelt (Review B1, B3): Kern legt den ersten Schlag auf erster_schlag_frame + Versatz. Eine neuere Fassung mit Auto-Phase
// hat erster_schlag_frame verschoben (Audio gleich), das steckt dann nicht mehr im Versatz:
// v_neu = v_alt − (esf_neu − esf_alt) − Δeins·fpb. Δeins nur, wenn die Eins der neuen Fassung aus dieser Raster-Korrektur stammt,
// d. h. die ganzen Beats K = round(v_alt/fpb) ≠ 0 und (eins_alt + K) mod 4 == eins_neu; eine fremde Eins-Änderung bleibt stehen.
function leseRasterWert(datei: string): number | null {
  try {
    const v = (JSON.parse(fs.readFileSync(datei, 'utf8')) as { versatz_frames?: unknown }).versatz_frames;
    return typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= RASTER_MAX ? v : null;
  } catch { return null; }
}

export function rasterErbe(ordner: string, f: Fassung, o: { einsVon: (fassung: number) => { eins: number; esf: number } | null; fpb: number }): { v: number; von: number | null } {
  const eigene = leseRasterWert(rasterDatei(ordner, f));
  if (eigene !== null) return { v: eigene, von: null };
  if (fs.existsSync(rasterDatei(ordner, f))) return { v: 0, von: null };   // Datei da, aber unlesbar oder außerhalb: wie bisher 0, nichts erben
  const muster = new RegExp(`^${f.material_id}_${Math.round(f.basis_bpm * 1000)}_r([1-9][0-9]*)\\.json$`);
  let aelter: number[];
  try { aelter = fs.readdirSync(ordner).map((n) => muster.exec(n)).filter((m) => m !== null).map((m) => Number(m![1])).filter((r) => r < f.fassung).sort((a, b) => b - a); }
  catch { return { v: 0, von: null }; }
  for (const r of aelter) {
    const v = leseRasterWert(rasterDatei(ordner, { ...f, fassung: r }));
    if (v === null) continue;
    const alt = o.einsVon(r), neu = o.einsVon(f.fassung);
    let erbe = v;
    if (alt !== null && neu !== null) {
      erbe -= neu.esf - alt.esf;                       // Auto-Phase (lauf_phase) steckt in erster_schlag_frame: Review B1
      const k = Math.round(v / o.fpb);                 // Eins nur abziehen, wenn sie AUS dieser Raster-Korrektur stammt: Review B3
      if (k !== 0 && ((((alt.eins + k) % 4) + 4) % 4) === (((neu.eins % 4) + 4) % 4)) erbe -= (neu.eins - alt.eins) * o.fpb;
    }
    return Math.abs(erbe) <= RASTER_MAX ? { v: erbe, von: r } : { v: 0, von: null };
  }
  return { v: 0, von: null };
}

// SET/FIX schreibt die Eins ins Material (korrekturen.jsonl, art=eins, §13.3; kette.eins_und_hotcues liest sie, das Tor eins
// gilt dann als sicher). Die ganzen Beats K im Versatz (round(v/fpb)) sind der Halbtakt-Fehler, den Andreas behebt:
// wahre Eins = (eins der Fassung + K) mod 4 (SET: neue Eins = eins + k). Nur der Feinversatz bleibt in der Raster-Datei der
// NEUEN Fassung (rasterErbe zieht die Differenz ab). null: nichts zu schreiben (Eins unverändert oder dieselbe Zeile steht schon).
export function einsNachFix(o: { v: number; fpb: number; eins: number; letzte: number | null }): number | null {
  const k = Math.round(o.v / o.fpb);
  const ziel = (((o.eins + k) % 4) + 4) % 4;
  const gilt = o.letzte ?? (((o.eins % 4) + 4) % 4);
  return ziel === gilt ? null : ziel;
}

const zeitIso = (d: Date): string => d.toISOString().slice(0, 19);
export function einsZeile(f: Fassung, eins: number, k: number, quelle: 'SET' | 'FIX', jetzt: Date = new Date()): Record<string, unknown> {
  return { zeit: zeitIso(jetzt), von: 'andreas', art: 'eins', fassung: `${Math.round(f.basis_bpm * 1000)}_r${f.fassung}`,
    ab_quell_beat: eins, bis_quell_beat: null, versatz_ms: null, nr: null, text: `${quelle}: Eins um ${k < 0 ? '−' : '+'}${Math.abs(k)} Beats gesetzt, Lage ${eins}` };
}

export function letzteEinsZeile(materialOrdner: string): number | null {
  try {
    const zeilen = fs.readFileSync(path.join(materialOrdner, 'korrekturen.jsonl'), 'utf8').split('\n').filter((z) => z.trim());
    for (let i = zeilen.length - 1; i >= 0; i--) {
      const z = JSON.parse(zeilen[i]) as { art?: string; ab_quell_beat?: unknown };
      if (z.art === 'eins' && typeof z.ab_quell_beat === 'number') return ((Math.round(z.ab_quell_beat) % 4) + 4) % 4;
    }
  } catch { /* keine Datei */ }
  return null;
}

// Wie korrektur_anhaengen (werkstatt/bestand.py): eine Zeile in einem write() mit O_APPEND, dann fsync.
export function haengeKorrekturAn(materialOrdner: string, zeile: Record<string, unknown>): void {
  const fd = fs.openSync(path.join(materialOrdner, 'korrekturen.jsonl'), fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT, 0o644);
  try { fs.writeSync(fd, JSON.stringify(zeile) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

// Hat Andreas die Eins gesetzt (irgendeine Zeile art=eins von=andreas)? Dann ist ein älteres Urteil „unsicher“ erledigt.
export function hatHandEins(materialOrdner: string): boolean {
  try {
    return fs.readFileSync(path.join(materialOrdner, 'korrekturen.jsonl'), 'utf8').split('\n').filter((z) => z.trim())
      .some((z) => { const j = JSON.parse(z) as { art?: string; von?: string }; return j.art === 'eins' && j.von === 'andreas'; });
  } catch { return false; }
}

// --- Hotcues erben (2026-10-11) -------------------------------------------------------------------------------------------
// Einheit: quell_beat ist ein Beat der Karte (für alle Fassungen eines Materials dieselbe Zählung). Der Kern legt ihn auf
// Frame = erster_schlag_frame + Raster-Versatz + quell_beat·fpb (kern deck.h:325 schlag0()). Dieselbe Audio-Stelle in einer
// neuen Fassung heißt also: quell_beat' = quell_beat + (A_alt − A_neu)/fpb mit A = erster_schlag_frame + wirksamer Versatz.
// - esf: lauf_phase verschiebt erster_schlag_frame (Audio gleich); ohne geerbten Versatz wandert der Hotcue um Δesf/fpb mit.
// - Eins: wirkt nur mittelbar. Die Eins selbst ist für Hotcues bedeutungslos (Audio-Stellen), aber rasterErbe zieht ihre
//   ganzen Beats aus dem Versatz, wenn die neue Fassung sie eingebaut hat; dann ändert sich A um Δeins·fpb und der Hotcue
//   wandert um Δeins Beats (246 → 244 bei Eins 2 → 0 mit −2 Beats Versatz).
// Nur lesen, nicht schreiben (wie rasterErbe): eine neuere Fassung soll nicht eine Kopie erzwingen, solange niemand etwas
// ändert. Der Server schreibt beim ersten Setzen/Löschen auf der neuen Fassung den vollen (geerbten) Satz in deren eigene Datei;
// ab da ist sie eigen und wird nie wieder überschrieben. Eine vorhandene Datei, auch {} (alle gelöscht), ist immer eigen.
export function hotcuesErbe(ordner: string, f: Fassung, o: { esf: (fassung: number) => number | null; rasterV: (fassung: number) => number; fpb: number }):
  { hotcues: Record<string, Hotcue>; von: number | null } {
  const eigene = hotcueDatei(ordner, f);
  if (fs.existsSync(eigene)) return { hotcues: leseHotcues(eigene), von: null };
  const muster = new RegExp(`^${f.material_id}_${Math.round(f.basis_bpm * 1000)}_r([1-9][0-9]*)\\.json$`);
  let aelter: number[];
  try { aelter = fs.readdirSync(ordner).map((n) => muster.exec(n)).filter((m) => m !== null).map((m) => Number(m![1])).filter((r) => r < f.fassung).sort((a, b) => b - a); }
  catch { return { hotcues: {}, von: null }; }
  for (const r of aelter) {
    let j: unknown;
    try { j = JSON.parse(fs.readFileSync(hotcueDatei(ordner, { ...f, fassung: r }), 'utf8')); } catch { continue; }
    if (!j || typeof j !== 'object' || Array.isArray(j)) continue;
    const eAlt = o.esf(r), eNeu = o.esf(f.fassung);
    const d = eAlt !== null && eNeu !== null ? ((eAlt + o.rasterV(r)) - (eNeu + o.rasterV(f.fassung))) / o.fpb : 0;
    const aus: Record<string, Hotcue> = {};
    for (const [nr, h] of Object.entries(j as Record<string, Hotcue>)) {
      aus[nr] = Number.isFinite(h?.quell_beat) ? { ...h, quell_beat: Math.round((h.quell_beat + d) * 1e4) / 1e4 } : h;
    }
    return { hotcues: aus, von: r };
  }
  return { hotcues: {}, von: null };
}
