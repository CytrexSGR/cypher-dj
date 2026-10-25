// PRODUCTION (D1 V1): Ziehen aus LIBRARY auf eine Audio-Spur (Spec 2.11, M25 Grundform). Reine Funktionen.
// Nur Zeilen der Typen oneshot, loop, track mit Katalog-sha; die Nutzlast ist der sha (und der Titel als Clip-Name), den Pfad löst der Server selbst
// (Spec 3.4 clip_neu). Was der Server ohnehin ablehnte (pfad_da=false, Ableton-geschützt), bietet die Seite gar nicht an.
import { rasten } from './zeitachse.js';

export const ZIEH_TYP = 'application/x-djk-clip';
const ZIEHBAR = new Set(['oneshot', 'loop', 'track']);

// Clip-Name = der Titel der Zeile wie die erste Spalte der Liste (stoebern.js SPALTEN): Track Titel (Mix), Loop/Sample name.
// S2 nennt einen Clip ohne name „Audio“ (clip_neu); darum geht der Titel mit. Höchstens 80 Zeichen (S2 lehnt mehr ab);
// ohne Titel kein Feld (S2 nimmt dann den Dateinamen aus pfad_hinweis oder „Audio“), nie ein leerer Name.
export function clipName(t) {
  const roh = t.typ === 'track' ? (t.mix && t.titel ? `${t.titel} (${t.mix})` : t.titel) : t.name;
  const n = typeof roh === 'string' ? roh.trim().slice(0, 80).trim() : '';
  return n || undefined;
}

export function nutzlast(t) {
  if (!t || !ZIEHBAR.has(t.typ) || typeof t.sha !== 'string' || !/^[0-9a-f]{64}$/.test(t.sha)) return null;
  if (t.pfad_da !== true || t.nur_live === true || !(t.dauer_s > 0)) return null;
  const name = clipName(t);
  return { sha: t.sha, dauer_s: t.dauer_s, ...(name ? { name } : {}) };
}

// Befehl für POST /proj/aendern oder ein Fehlergrund (englischer Text zeigt die Seite).
// Paket 1.13 (F2): warp 'auto' lässt den Server aus den Library-Daten entscheiden: Loops und Tracks mit Tempo laufen sofort im Projekttempo (Länge und
// Warp kommen vom Server), One-Shots und Einträge ohne Tempo bleiben ungewarpt; dann gilt laenge_beats von hier (Sekunden · Projekttempo).
// Das Projekttempo ändert die Ablage nie.
export function ablageBefehl(projekt, nutz, spurIndex, beat, raster) {
  const spur = projekt?.spuren?.[spurIndex];
  if (!spur) return { fehler: 'keine_spur' };
  if (spur.art !== 'audio') return { fehler: 'keine_audiospur' };
  return { befehl: { befehl: 'clip_neu', spur_id: spur.id, art: 'audio', start_beat: Math.max(0, rasten(beat, raster)),
    laenge_beats: (nutz.dauer_s * projekt.tempo_bpm) / 60, sha256: nutz.sha, warp: 'auto', ...(nutz.name ? { name: nutz.name } : {}) } };
}
export const ABLAGE_TEXT = { keine_spur: 'Drop the sample on a track', keine_audiospur: 'Samples go on audio tracks only' };
