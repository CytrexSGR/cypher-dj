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

// ---- package 1.16 rest U6 (S3): devices from the DEVICES list (geraete_browser.js), drag type application/x-djk-geraet ----
// The payload is the catalogue entry of GET /presets/katalog. An instrument always makes a new track (spur_neu), wherever it is dropped; an effect
// becomes a stage at the end of the chain of the track row it is dropped on (insert_setzen). Inactive kinds give no command, only their reason.
import { MAX_PLAETZE, freieKomp, straenge } from './inserts.js';
export const GERAET_TYP = 'application/x-djk-geraet';
export const GERAET_TEXT = {
  keine_spur: 'Drop the effect on a track row', kette_voll: `All ${MAX_PLAETZE} stages of this strip are used`, ins_voll: 'No free compressor in the project',
};
const GRAPH = /^[a-z0-9_-]{1,32}$/;
export function geraetNutzlast(e) {
  if (!e || typeof e !== 'object' || typeof e.titel !== 'string') return null;
  if (e.ziel === 'spur_neu' && (e.geraet === 'rb338' || e.geraet === 'surge')) return { geraet: e.geraet, titel: e.titel, ziel: e.ziel };
  if (e.ziel === 'spur_neu' && e.geraet === 'bk' && typeof e.graph === 'string' && GRAPH.test(e.graph)) return { geraet: 'bk', titel: e.titel, ziel: e.ziel, graph: e.graph };
  if (e.ziel === 'insert' && typeof e.geraet === 'string') return { geraet: e.geraet, titel: e.titel, ziel: e.ziel, aktiv: e.aktiv === true, ...(e.grund ? { grund: e.grund } : {}) };
  return null;
}
// rb338 as spurkoepfe.js NEU['neu-rb'], surge as NEU['neu-surge'] (one host slot), a graph as a bk device
export function instrumentBefehl(n) {
  const geraet = n.geraet === 'rb338' ? { art: 'intern', name: 'rb338', parameter: {} }
    : n.geraet === 'surge' ? { art: 'wirt', name: 'surge', slot: 1 } : { art: 'intern', name: 'bk', graph: n.graph, parameter: {} };
  return { label: `Add ${n.titel} track`, befehl: { befehl: 'spur_neu', art: 'instrument', name: n.titel.slice(0, 80), geraet } };
}
export function effektBefehl(projekt, strangId, n) {
  if (!n.aktiv) return { fehler: 'art_nicht_aktiv', text: n.grund ?? 'not available yet' };
  const s = straenge(projekt).find((x) => x.id === strangId);
  if (!s) return { fehler: 'keine_spur', text: GERAET_TEXT.keine_spur };
  if (s.inserts.length >= MAX_PLAETZE) return { fehler: 'kette_voll', text: GERAET_TEXT.kette_voll };
  if (n.geraet === 'komp' && freieKomp(projekt) <= 0) return { fehler: 'ins_voll', text: GERAET_TEXT.ins_voll };
  return { label: `Add ${n.titel} to ${s.name}`, befehl: { befehl: 'insert_setzen', strang_id: strangId, pos: s.inserts.length, art: n.geraet } };
}
// A drop on the arrangement: spurIndex is the track row under the pointer (-1 or past the end: none)
export function geraetAblage(projekt, n, spurIndex) {
  if (n.ziel === 'spur_neu') { const r = instrumentBefehl(n); return { label: r.label, befehle: [r.befehl] }; }
  const spur = projekt?.spuren?.[spurIndex];
  if (!spur) return { fehler: 'keine_spur', text: GERAET_TEXT.keine_spur };
  const r = effektBefehl(projekt, spur.id, n);
  return r.befehl ? { label: r.label, befehle: [r.befehl] } : r;
}
