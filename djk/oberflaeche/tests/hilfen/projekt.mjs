// Gemeinsame Bausteine der projekt_*-Tests (Paket S2-Kern): das Beispielprojekt aus D1-SPEC 3.3 und kleine Werkzeuge.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { kanonisch } from '../../projekt/modell.ts';

export const SHA_A = 'a'.repeat(64);
export const SHA_B = 'b'.repeat(64);

export const tmpOrdner = (t, praefix = 'djk-proj-') => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), praefix));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};

// das Beispiel aus Spec 3.3 (Fassung 2), die Hex-Platzhalter durch echte Länge ersetzt
export function specProjekt() {
  return {
    format: 'cypherdj-projekt/1', name: 'First Track', rev: 17, wiedergabe_rev: 15, tempo_bpm: 124, taktart: [4, 4],
    loop: { an: true, von_beat: 0, bis_beat: 32 },
    metronom: { an: false, pegel_db: -12, ziel: 'master' },
    spuren: [
      { id: 's1', nr: 1, name: 'Kick', farbe: '#e0563b', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false,
        clips: [{ id: 'c1', art: 'audio', name: 'kick', start_beat: 0, laenge_beats: 1,
          quelle: { sha256: SHA_A, pfad_hinweis: '/abs/kick.wav' }, dekodiert: 'fertig',
          offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 }] },
      { id: 's2', nr: 2, name: 'Bass', farbe: '#3b8de0', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} },
        fader_db: 0, pan: 0, mute: false, solo: false,
        clips: [{ id: 'c2', art: 'midi', name: 'bassline', start_beat: 0, laenge_beats: 16,
          noten: [{ id: 'n1', beat: 0, laenge: 0.5, ton: 36, vel: 100 }] }] },
      { id: 's3', nr: 3, name: 'Lead', farbe: '#9b59d0', art: 'instrument', geraet: { art: 'wirt', name: 'surge', slot: 1 },
        freeze: null, fader_db: 0, pan: 0, mute: false, solo: false, clips: [] },
    ],
  };
}

export const kopie = (x) => JSON.parse(JSON.stringify(x));

// feste Zufallsfolge (mulberry32), damit Fuzz-Läufe reproduzierbar sind
export function zufall(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Wie kanonisch, aber ohne abgeleitete Felder (`dekodiert`): Patches tragen sie nur neutral (Spec 6.6), nach Undo/Redo gleicht der Server sie ab.
// Auch ohne die ID-Zähler (naechste_id, naechste_noten_id; Spec 6.26): sie steigen nur und stehen in keinem Patch, ein zurückgedrehter Stand
// behält den höheren Zähler.
const OHNE = new Set(['dekodiert', 'naechste_id', 'naechste_noten_id']);
export const ohneAbgeleitetes = (x) => kanonisch(JSON.parse(JSON.stringify(x, (k, v) => (OHNE.has(k) ? undefined : v))));
// Das Projekt, wie es nach dem Laden aussieht: eine Spur ohne von gilt als andreas (Spec 6.22), fehlende Zähler setzt das Laden (Spec 6.35).
// Die Zähler als feste Erwartung (Fix5 K6), nicht mit setzeFehlendeZaehler gerechnet, der geprüften Funktion. Vorgabe: specProjekt() trägt
// s1 bis s3, c1 und c2, die Note n1, also naechste_id {spur: 4, clip: 3} und naechste_noten_id 2. Wer ein anderes Projekt prüft, gibt seine mit.
export const SPEC_ZAEHLER = { naechste_id: { spur: 4, clip: 3 }, naechste_noten_id: 2 };
export const mitVon = (p, zaehler = SPEC_ZAEHLER) => {
  const q = kopie(p);
  for (const s of q.spuren) s.von ??= 'andreas';
  return { ...q, ...kopie(zaehler) };
};
