// PRODUCTION (Paket 1.13 Warp, Slice 3b): Sample-Editor im Detailbereich, der rechnende Teil. Reine Funktionen, Browser und node, kein DOM.
// Die Welle steht in Quellzeit: Ansicht a = { s0, pxProS } (linker Rand in Quellsekunden, Pixel je Sekunde); x ist immer ein Pixel im Zeichenfeld.
// Eine Geste ergibt höchstens einen Befehl { label, befehle } für ctx.aendere; die Bedienung (warp_editor_bedienung.js) zeichnet und sammelt nur Zeigerdaten.
//   Doppelklick: auf einem Marker löschen, sonst setzen (ohne beat: der Klang ändert sich nicht)
//   Ziehen: ohne Taste bleibt der Beat und die Quellzeit wandert; mit Umschalt bleibt die Quellzeit und der Beat wandert (D4)
//   Rechtsklick: Warp From Here (Straight), Warp From Here (Start), Set 1.1.1 Here, Delete Marker
import { beatBeiQuelle, quellSekunde, segmentBpm, segmentVon } from './warp.js';

export const TREFFER_PX = 6;                 // so nah an einem Marker greift die Maus ihn
export const PX_PRO_S = { min: 2, max: 4000 };
export const SEGMENT_BPM_MIN = 15, SEGMENT_BPM_MAX = 800;   // wie projekt/warp.ts: erlaubtes Segment-Tempo
export const BEAT_RASTER = 1 / 16;           // Umschalt-Ziehen rastet den Beat auf Sechzehntel
const rund6 = (x) => Math.round(x * 1e6) / 1e6;
const klemme = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export const sZuX = (a, s) => (s - a.s0) * a.pxProS;
export const xZuS = (a, x) => a.s0 + x / a.pxProS;

// Ausgangsansicht: der Anfang des gespielten Stücks mit etwas Rand links
export function neueAnsicht(clip, pxProS = 40) {
  const s = clip?.warp ? quellSekunde(clip.warp.marker, clip.warp.versatz_beats) : 0;
  return { s0: Math.max(0, s - 20 / pxProS), pxProS };
}
// Zoom um das Pixel x herum (die Stelle unter der Maus bleibt stehen)
export function zoomAnsicht(a, faktor, x) {
  const s = xZuS(a, x), p = klemme(a.pxProS * faktor, PX_PRO_S.min, PX_PRO_S.max);
  return { s0: Math.max(0, s - x / p), pxProS: p };
}
export const scrolleAnsicht = (a, dx) => ({ ...a, s0: Math.max(0, a.s0 + dx / a.pxProS) });

// Schlussrunde Punkt 1: die Transienten (Quellsekunden) im Bereich des Clips, mit den aktuellen Markern gerechnet, wie sitzung.ts warpLage: Beat über die Marker,
// im Bereich [versatz_beats, versatz_beats + loop_beats ?? laenge_beats). Marker-Züge ändern das Ergebnis, ohne dass die Liste neu geladen wird.
export function transientenImClip(clip, quellS) {
  const w = clip.warp, ende = w.versatz_beats + (clip.loop_beats ?? clip.laenge_beats);
  return (quellS ?? []).filter((q) => { const b = beatBeiQuelle(w.marker, q); return b >= w.versatz_beats && b < ende; });
}

// Slice 4 (T10): x der Transienten (Quellsekunden) im sichtbaren Fenster 0..breite, auf halbe Pixel gerundet wie die Marker
export function transientenPixel(a, transienten, breite) {
  const aus = [], gesehen = new Set();       // je Pixelspalte höchstens ein Wert (Fix-Runde Slice 4): viele Transienten in einer Spalte ergäben sonst überlagerte Linien
  for (const s of transienten ?? []) {
    const px = sZuX(a, s);
    if (px >= 0 && px < breite) { const x = Math.round(px) + 0.5; if (!gesehen.has(x)) { gesehen.add(x); aus.push(x); } }
  }
  return aus;
}

// Index des Markers unter dem Pixel x (der nächste innerhalb TREFFER_PX), sonst −1
export function markerBei(marker, a, x, tol = TREFFER_PX) {
  let best = -1, abstand = Infinity;
  marker.forEach((p, i) => { const d = Math.abs(sZuX(a, p[0]) - x); if (d <= tol && d < abstand) { best = i; abstand = d; } });
  return best;
}
const warpVon = (clip) => (clip?.art === 'audio' && clip.warp ? clip.warp : null);

// Tempo des Segments, das das Pixel x überdeckt (der Marker links davon beginnt es), als Text; vor dem ersten und hinter dem letzten gilt das Randsegment
export function segmentText(clip, a, x) {
  const w = warpVon(clip);
  if (!w) return '';
  const bpm = segmentBpm(w.marker, segmentVon(w.marker, beatBeiQuelle(w.marker, xZuS(a, x))));
  return `${(Math.round(bpm * 10) / 10).toFixed(1)} BPM`;
}
// Beschriftung eines Markers: ein Taktanfang (Beat durch 4) trägt die Taktnummer, die Eins ist „1.1.1“. Vor der Eins zählen die Takte negativ ohne Takt 0
// (wie Live: ein Vorspann von 16 Takten beginnt bei −16.1.1, Margulies, Live 10 Power, Kapitel 12).
export function markerText(beat) {
  if (Math.abs(beat) < 1e-9) return '1.1.1';
  if (!Number.isInteger(beat) || beat % 4 !== 0) return '';
  return String(beat > 0 ? beat / 4 + 1 : beat / 4);
}

export function doppelklick(clip, a, x) {
  const w = warpVon(clip);
  if (!w) return null;
  const i = markerBei(w.marker, a, x);
  if (i >= 0) {
    if (w.marker.length <= 2) return { fehler: 'A warp needs at least two markers' };
    return { label: 'Delete marker', befehle: [{ befehl: 'warp_marker', clip_id: clip.id, loesche: [w.marker[i][1]] }] };
  }
  const s = rund6(xZuS(a, x));
  if (s < 0) return null;
  return { label: 'Add marker', befehle: [{ befehl: 'warp_marker', clip_id: clip.id, setze: [{ quell_s: s }] }] };
}

// Ziehen des Markers i um dx Pixel. Ohne Umschalt: neu_quell_s (der Beat bleibt). Mit Umschalt: neu_beat (die Quellzeit bleibt), um dx/pxProS Sekunden mal das Tempo
// des Segments rechts vom Marker (am letzten Marker des Segments links davon), auf Sechzehntel gerastet. null: zu kurz gezogen oder nichts geändert.
export function ziehen(clip, a, i, dx, umschalt) {
  const w = warpVon(clip);
  if (!w || i < 0 || i >= w.marker.length || Math.abs(dx) < 1) return null;
  const m = w.marker, [s, beat] = m[i], L = i > 0 ? m[i - 1] : null, R = i < m.length - 1 ? m[i + 1] : null;
  const kleinst = SEGMENT_BPM_MIN / 60, groesst = SEGMENT_BPM_MAX / 60;    // Beats je Sekunde
  if (!umschalt) {
    // zwischen den Nachbarn, mit Mindestabstand: jedes der zwei Segmente bleibt in 15..800 BPM (der Beat bleibt, nur die Sekunden wandern)
    let lo = -Infinity, hi = Infinity;
    if (L) { lo = Math.max(lo, L[0] + (beat - L[1]) / groesst); hi = Math.min(hi, L[0] + (beat - L[1]) / kleinst); }
    if (R) { lo = Math.max(lo, R[0] - (R[1] - beat) / kleinst); hi = Math.min(hi, R[0] - (R[1] - beat) / groesst); }
    lo = Math.max(0, Math.ceil(lo * 1e6 + 1) / 1e6); hi = Math.floor(hi * 1e6 - 1) / 1e6;   // innen von den Nachbarn, nie vor Sekunde 0
    if (lo > hi) return null;
    const neu = rund6(klemme(s + dx / a.pxProS, lo, hi));
    if (neu < 0 || neu === s) return null;
    return { label: 'Move marker', befehle: [{ befehl: 'warp_marker', clip_id: clip.id, verschiebe: [{ beat, neu_quell_s: neu }] }] };
  }
  const bpm = segmentBpm(m, Math.min(i, m.length - 2));
  let lo = -Infinity, hi = Infinity;                                       // die Quellzeit bleibt, die Beats der Nachbarn begrenzen
  if (L) { lo = Math.max(lo, L[1] + (s - L[0]) * kleinst); hi = Math.min(hi, L[1] + (s - L[0]) * groesst); }
  if (R) { lo = Math.max(lo, R[1] - (R[0] - s) * groesst); hi = Math.min(hi, R[1] - (R[0] - s) * kleinst); }
  lo = Math.ceil((lo + 1e-6) / BEAT_RASTER) * BEAT_RASTER; hi = Math.floor((hi - 1e-6) / BEAT_RASTER) * BEAT_RASTER;
  if (lo > hi) return null;
  const neu = rund6(klemme(Math.round((beat + (dx / a.pxProS) * bpm / 60) / BEAT_RASTER) * BEAT_RASTER, lo, hi));
  if (neu === beat) return null;
  return { label: 'Move marker (beat)', befehle: [{ befehl: 'warp_marker', clip_id: clip.id, verschiebe: [{ beat, neu_beat: neu }] }] };
}

// Menü am Pixel x: jeder Punkt trägt seinen fertigen Befehl (oder fehler/aus). Liegt x auf einem Marker, gelten dessen Beat und Quellzeit genau, sonst die
// Stelle unter der Maus (Beat aus dem Raster dort).
// transientenZahl: Zahl der Transienten im Clip aus /proj/warp (null = noch nicht geladen oder nicht dekodiert); ohne sie ist Quantize Audio gesperrt.
export function menuPunkte(clip, a, x, transientenZahl = null) {
  const w = warpVon(clip);
  if (!w) return [];
  const i = markerBei(w.marker, a, x);
  const s = i >= 0 ? w.marker[i][0] : rund6(xZuS(a, x)), beat = i >= 0 ? w.marker[i][1] : rund6(beatBeiQuelle(w.marker, s));
  const b = (befehl, extra) => ({ befehl: { befehl, clip_id: clip.id, ...extra } });
  return [
    { id: 'gerade', text: 'Warp From Here (Straight)', label: 'Warp from here (straight)', ...b('warp_ab_hier', { beat, art: 'gerade' }) },
    { id: 'start', text: 'Warp From Here (Start)', label: 'Warp from here (start)', ...b('warp_ab_hier', { beat, art: 'start' }) },
    { id: 'eins', text: 'Set 1.1.1 Here', label: 'Set 1.1.1', ...b('eins_hier', { quell_s: s }) },
    { id: 'loeschen', text: 'Delete Marker', label: 'Delete marker', aus: i < 0 || w.marker.length <= 2, ...b('warp_marker', { loesche: [i >= 0 ? w.marker[i][1] : 0] }) },
    { id: 'quantisieren', text: 'Quantize Audio', label: 'Quantize audio', aus: !(transientenZahl > 0), ...b('audio_quantisieren', { raster: '1/16' }) },   // D10: 1/16, Stärke 1
  ];
}
