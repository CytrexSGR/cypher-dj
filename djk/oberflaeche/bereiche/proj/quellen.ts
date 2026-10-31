// Paket 1.13 Warp, Slice 3a: die Quellen des Auto-Warps außerhalb des Katalogs. Nur lesen, nichts entscheiden.
//  - leseKarte: die Werkstatt-Karte aus der Analyse-Ablage (<ablage>/<sha[:16]>/material.json, Format INTERFACES.md:1202). Schlüssel ist
//    die volle sha256 des Clips; das Dokument trägt quelle.sha256 zur Gegenprobe (eine andere Kodierung desselben Stücks hat eine andere sha
//    und damit keine Karte).
//  - leseTraktor: das Raster aus Tabelle marke der Mediathek.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { beatBeiQuelle, quellSekunde, type KartenDaten, type TraktorRaster } from '../../projekt/warp.ts';
import { einsZeile, haengeKorrekturAn, type Fassung } from '../../deck_bedienung.ts';

const SHA = /^[0-9a-f]{64}$/;
const endlich = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

// Marker-Beat = Karten-Beat − erste_eins_quell_beat (0..3, ein Beat der Karte); Beat 0 ist damit die erste Eins. Die Prüfung der Marker (Anzahl, Steigen,
// Segment-Tempo) gehört dem Auto-Warp (kartenWarp), nicht dem Leser.
export function leseKarte(ablage: string | null | undefined, sha: string, bestand: string | null = null):
  { karte: KartenDaten; dauer_s: number | null } | null {
  if (!ablage || !SHA.test(sha)) return null;
  let m: any;   // eslint-disable-line @typescript-eslint/no-explicit-any
  try { m = JSON.parse(fs.readFileSync(path.join(ablage, sha.slice(0, 16), 'material.json'), 'utf8')); } catch { return null; }
  if (m?.schema !== 1 || m?.quelle?.sha256 !== sha) return null;
  const roh = m.tempo_karte_quelle;
  let eins = m.raster?.erste_eins_quell_beat, unsicher = m.raster?.erste_eins_unsicher !== false;
  if (!Array.isArray(roh) || roh.length < 2 || !Number.isInteger(eins) || eins < 0 || eins > 3) return null;
  const k = einsKorrektur(bestand, sha, roh);
  if (k !== null) { eins = k.eins; if (k.hand) unsicher = false; }
  const marker: [number, number][] = [];
  for (const p of roh) {
    if (!Array.isArray(p) || p.length !== 2 || !endlich(p[0]) || !endlich(p[1])) return null;
    marker.push([p[0], p[1] - eins]);
  }
  // Karten vor dem 2026-10-11 haben das Feld nicht (INTERFACES.md:1723): unbekannt zählt als unsicher
  return { karte: { marker, eins_unsicher: unsicher }, dauer_s: endlich(m.quelle.dauer_s) ? m.quelle.dauer_s : null };
}

// Traktor-Raster: die früheste Zeile art = 'grid' (quelle = 'traktor') des Tracks. nummer ist der Hotcue-Slot der CUE_V2-Zeile, nicht die Rolle
// (leser2.py:75-77): nur 356 von 2367 Raster-Zeilen haben −1, ein Filter darauf verlöre 85 %. Mehrfachzeilen (16 Tracks) tragen dasselbe BPM.
// Die Datei gehört dem Mediathek-Timer (Beatport, WAL): wie Mediathek.oeffne() je Abfrage lesend öffnen und schließen. Kein Index auf marke:
// ein Lauf über rund 15 000 Zeilen.
export function leseTraktor(mediathek: string | null | undefined, sha: string): TraktorRaster | null {
  if (!mediathek || !SHA.test(sha) || !fs.existsSync(mediathek)) return null;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(mediathek, { readOnly: true });
    const z = db.prepare("SELECT start_s, bpm FROM marke WHERE inhalt_sha256 = ? AND quelle = 'traktor' AND art = 'grid' AND bpm > 0 AND start_s >= 0 "
      + 'ORDER BY start_s ASC LIMIT 1')
      .get(sha) as { start_s: number; bpm: number } | undefined;
    return z && endlich(z.start_s) && endlich(z.bpm) ? { anker_s: z.start_s, bpm: z.bpm } : null;
  } catch { return null; } finally { try { db?.close(); } catch { /* schon zu */ } }
}
// --- Slice 3b (D3): die Takt-Eins von Hand, aus und in den Bestand des DJ-Decks (bestand/<sha[:16]>/korrekturen.jsonl, INTERFACES.md §13.3) -----
type Karte = [number, number][];
// Python round(): Halbe gehen zur geraden Zahl (2,5 → 2, 3,5 → 4, −2,5 → −2); die Kette liest ab_quell_beat so (kette.py)
export const rundeGerade = (x: number): number => Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : Math.round(x);
const lageVon = (x: number): number => ((rundeGerade(x) % 4) + 4) % 4;
function leseJson(datei: string): any {   // eslint-disable-line @typescript-eslint/no-explicit-any
  try { return JSON.parse(fs.readFileSync(datei, 'utf8')); } catch { return null; }
}
// Zeile für Zeile: eine kaputte Zeile oder eine schemawidrige eins-Zeile (von, fassung nach korrektur.schema.json, ab_quell_beat) fällt laut weg
// (console.error wie projekt/verlauf.ts), die gültigen davor und danach gelten weiter.
function leseKorrekturen(ordner: string): { art?: string; von?: string; ab_quell_beat?: unknown }[] {
  let text: string;
  try { text = fs.readFileSync(path.join(ordner, 'korrekturen.jsonl'), 'utf8'); } catch { return []; }
  const aus: { art?: string; von?: string; ab_quell_beat?: unknown }[] = [];
  text.split('\n').forEach((z, i) => {
    if (!z.trim()) return;
    const warne = (grund: string): void => { console.error(`korrekturen.jsonl ${ordner} Zeile ${i + 1} übersprungen: ${grund}`); };
    let x: any;   // eslint-disable-line @typescript-eslint/no-explicit-any
    try { x = JSON.parse(z); } catch (e) { warne(`kein JSON (${(e as Error).message})`); return; }
    if (x === null || typeof x !== 'object' || Array.isArray(x)) { warne('kein Objekt'); return; }
    if (x.art === 'eins') {
      if (x.von !== 'andreas' && x.von !== 'werkstatt') { warne('von fehlt oder ist unbekannt'); return; }
      if (typeof x.fassung !== 'string' || !/^[1-9][0-9]*_r[1-9][0-9]*$/.test(x.fassung)) { warne('fassung passt nicht zum Schema'); return; }
      if (!endlich(x.ab_quell_beat)) { warne('ab_quell_beat ist keine Zahl'); return; }
    }
    aus.push(x);
  });
  return aus;
}
const einsZeilen = (ordner: string): { von?: string; ab_quell_beat: number }[] =>
  leseKorrekturen(ordner).filter((x) => x.art === 'eins' && endlich(x.ab_quell_beat)) as { von?: string; ab_quell_beat: number }[];
// Der Bestand des Decks hat zum Track ein Material mit eigener Karte (dieselbe Datei: sha256 gleich). Zurück: Ordner, Karte, Eins der Analyse; sonst null.
function bestandMaterial(bestand: string | null | undefined, sha: string): { ordner: string; karte: Karte; eins: number } | null {
  if (!bestand || !SHA.test(sha)) return null;
  const ordner = path.join(bestand, sha.slice(0, 16)), m = leseJson(path.join(ordner, 'material.json'));
  if (m?.schema !== 1 || m?.quelle?.sha256 !== sha || !Array.isArray(m.tempo_karte_quelle) || m.tempo_karte_quelle.length < 2) return null;
  if (!m.tempo_karte_quelle.every((p: unknown) => Array.isArray(p) && p.length === 2 && endlich(p[0]) && endlich(p[1]))) return null;
  return { ordner, karte: m.tempo_karte_quelle, eins: Number.isInteger(m.raster?.erste_eins_quell_beat) ? m.raster.erste_eins_quell_beat : 0 };
}
// Die letzte Zeile art = eins im Bestand ersetzt die Eins der Analyse (so liest sie auch die Kette, werkstatt/kette.py eins_und_hotcues: Lage =
// ab_quell_beat gerundet mod 4, die letzte Zeile gilt). Beide Karten zählen ihre Beats für sich: übersetzt wird über die Quellzeit der Eins (Beat →
// Sekunde in der Karte des Bestands, Sekunde → Beat in der Karte der Analyse). hand: eine Zeile von Andreas macht die Eins sicher (kette.py
// tor_eins). Ohne Bestand oder Zeile: null.
function einsKorrektur(bestand: string | null, sha: string, roh: Karte): { eins: number; hand: boolean } | null {
  const b = bestandMaterial(bestand, sha);
  if (!b) return null;
  const z = einsZeilen(b.ordner);
  if (z.length === 0) return null;
  const lage = lageVon(z[z.length - 1].ab_quell_beat);
  return { eins: lageVon(beatBeiQuelle(roh, quellSekunde(b.karte, lage))), hand: z.some((x) => x.von === 'andreas') };
}

// Die jüngste Fassung des Materials (wie werkstatt/bestand.py fassungen_von: sortiert nach Basis-BPM, dann Nummer; die letzte)
function juengsteFassung(ordner: string, materialId: string): Fassung | null {
  let namen: string[];
  try { namen = fs.readdirSync(path.join(ordner, 'fassungen')); } catch { return null; }
  const f = namen.map((n) => /^([1-9][0-9]*)_r([1-9][0-9]*)$/.exec(n)).filter((m): m is RegExpExecArray => m !== null)
    .filter((m) => fs.existsSync(path.join(ordner, 'fassungen', m[0], 'fassung.json')))
    .map((m) => ({ basis: Number(m[1]), r: Number(m[2]) })).sort((a, b) => a.basis - b.basis || a.r - b.r);
  const l = f[f.length - 1];
  return l ? { material_id: materialId, basis_bpm: l.basis / 1000, fassung: l.r } : null;
}
// Set 1.1.1 Here zurück an die Analyse: eine Zeile art = eins von andreas in korrekturen.jsonl des Materials (ein write mit O_APPEND, fsync), wenn der
// Bestand zu dieser Datei (sha256) ein Material mit Karte und mindestens einer Fassung hat. 'kein_bestand': es gibt keinen Rückweg, nichts geschrieben.
// ab_quell_beat ist der Beat der Bestandskarte, der die Eins wird (der nächste ganze Beat der Stelle quellS). Ein Schreibfehler wirft.
export function schreibeEinsKorrektur(bestand: string | null | undefined, sha: string, quellS: number, jetzt: Date = new Date()):
  { status: 'geschrieben'; ab_quell_beat: number } | { status: 'kein_bestand' } {
  const b = bestandMaterial(bestand, sha);
  if (!b) return { status: 'kein_bestand' };
  const f = juengsteFassung(b.ordner, sha.slice(0, 16));
  if (!f) return { status: 'kein_bestand' };
  const ab = Math.round(beatBeiQuelle(b.karte, quellS)), lage = lageVon(ab);
  const alt = einsZeilen(b.ordner).map((x) => lageVon(x.ab_quell_beat)).pop() ?? b.eins;
  const zeile = { ...einsZeile(f, ab, lage - alt, 'SET', jetzt), text: `Set 1.1.1 Here (PRODUCTION): map beat ${ab} is the bar one, slot ${lage}` };
  haengeKorrekturAn(b.ordner, zeile);
  return { status: 'geschrieben', ab_quell_beat: ab };
}
