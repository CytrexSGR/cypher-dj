// PRODUCTION (Paket 1.13 Warp, Slice 1): die Abbildung W(b) und die Anzeige-Texte des Warps. Reine Funktionen, Browser und node.
// Dieselbe Rechnung wie projekt/warp.ts und kern/include/cypherdj/warp_abbildung.h (Referenzdatei vertrag/warp_referenz.json).
// Marker: [quell_s, beat] (Quellsekunde, Clip-Beat), beide streng steigend; vor dem ersten und hinter dem letzten gilt das Randsegment.

export function segmentVon(marker, b) {
  let lo = 0, hi = marker.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (marker[mid][1] <= b) lo = mid; else hi = mid - 1;
  }
  return lo;
}
export function quellSekunde(marker, b) {
  const i = segmentVon(marker, b), [s0, b0] = marker[i], [s1, b1] = marker[i + 1];
  return s0 + (b - b0) * (s1 - s0) / (b1 - b0);
}
export function beatBeiQuelle(marker, s) {
  let lo = 0, hi = marker.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (marker[mid][0] <= s) lo = mid; else hi = mid - 1;
  }
  const [s0, b0] = marker[lo], [s1, b1] = marker[lo + 1];
  return b0 + (s - s0) * (b1 - b0) / (s1 - s0);
}
export function segmentBpm(marker, i) {
  const [s0, b0] = marker[i], [s1, b1] = marker[i + 1];
  return 60 * (b1 - b0) / (s1 - s0);
}

export const warpAn = (clip) => clip?.art === 'audio' && clip.warp?.an === true;

// Slice 3a: Tempo über alle Segmente (Mittel = Beats durch Sekunden vom ersten bis zum letzten Marker; min und max der Segmente). Bei einer Werkstatt-Karte mit
// hunderten Markern wäre das erste Segment ein Zufallswert (Median 0,00 BPM daneben, Maximum 4,06 am Bestand), bei zwei Markern ist das Mittel das Segment.
const rund2 = (x) => Math.round(x * 100) / 100;
export function warpTempo(marker) {
  const n = marker?.length ?? 0;
  if (n < 2) return null;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i + 1 < n; i++) { const b = segmentBpm(marker, i); if (b < min) min = b; if (b > max) max = b; }
  return { mittel: rund2(60 * (marker[n - 1][1] - marker[0][1]) / (marker[n - 1][0] - marker[0][0])), min: rund2(min), max: rund2(max) };
}

// Was der Detailbereich zeigt: Schalterstand, Modus, Herkunft, Hinweis auf eine unsichere Takt-Eins, Tempo (Mittel, Spanne), Markerzahl, Analyse-Zustand.
// analyse: 'wartet' | 'laeuft' | null, der Zustand dieses Clips aus GET /proj/aktuell (analyse), siehe detail.js
const MODUS_TEXT = { repitch: 'RE-PITCH', beats: 'BEATS', complex: 'COMPLEX', tones: 'TONES' };
const QUELLE_TEXT = { takte: 'from bars', mediathek: 'from library BPM', werkstatt: 'from analysis', traktor: 'from Traktor grid', hand: 'by hand' };
export function warpAnzeige(clip, analyse = null) {
  const w = clip?.art === 'audio' ? clip.warp : null;
  const analysiert = analyse === 'wartet' || analyse === 'laeuft';
  if (!w) return { vorhanden: false, an: false, modus: '', herkunft: '', downbeatFrage: false, bpm: null, spanne: null, markerZahl: 0, analysiert };
  const t = warpTempo(w.marker);
  return {
    vorhanden: true, an: w.an === true, modus: MODUS_TEXT[w.modus] ?? w.modus, herkunft: QUELLE_TEXT[w.quelle] ?? w.quelle,
    downbeatFrage: w.eins_unsicher === true, bpm: t ? t.mittel : null, spanne: t && t.max - t.min >= 0.5 ? `${rund(t.min)}–${rund(t.max)}` : null,
    markerZahl: w.marker.length, analysiert,
  };
}
// ganze BPM ohne Nachkommastellen, sonst zwei
const rund = (x) => (Number.isInteger(x) ? String(x) : String(rund2(x)));
// Erklärung zu „downbeat?“ (Tooltip): die DJ-Ansicht hat denselben Gedanken (meldungen.js EINS_HINWEIS_TEXT), hier auf die Produktion zugeschnitten
export const EINS_HINWEIS = 'Bar 1 of this track is a guess: the analysis was unsure which beat starts the bar (or the tempo comes from the library, not from the audio). Check it by ear; OFFSET moves the content by whole beats.';

// Slice 5: Transpose und Detune. Gleiche Grenzen wie projekt/modell.ts (TRANSPOSE_MIN, TRANSPOSE_MAX, DETUNE_MAX; Gesamtgrenze Transpose · 100 + Detune): der Test prüft die Seite gegen das Modell nicht,
// darum steht hier dieselbe Zahl; die Prüfung des Servers bleibt maßgeblich (abgelehnte Eingaben melden den Grund).
export const TRANSPOSE_MIN = -12, TRANSPOSE_MAX = 24, DETUNE_MAX = 50;
export function transposeBefehl(clip, feld, eingabe) {
  const w = clip?.art === 'audio' ? clip.warp : null;
  if (!w) return { fehler: 'That clip has no warp yet' };
  if (!tonErlaubt(w)) return { fehler: `${w.modus === 'beats' ? 'BEATS' : 'RE-PITCH'} follows the tempo: no transpose here` };
  const text = String(eingabe).trim().replace(',', '.');
  const v = Number(text);
  const [min, max] = feld === 'transpose_st' ? [TRANSPOSE_MIN, TRANSPOSE_MAX] : [-DETUNE_MAX, DETUNE_MAX];
  if (text === '' || !Number.isFinite(v) || v < min || v > max || (feld === 'transpose_st' && !Number.isInteger(v))) {
    return { fehler: feld === 'transpose_st' ? `Transpose: whole semitones from ${TRANSPOSE_MIN} to ${TRANSPOSE_MAX}` : `Detune: cents from -${DETUNE_MAX} to ${DETUNE_MAX}` };
  }
  const st = feld === 'transpose_st' ? v : w.transpose_st, ct = feld === 'detune_ct' ? v : w.detune_ct;
  const g = st * 100 + ct;
  if (g < TRANSPOSE_MIN * 100 || g > TRANSPOSE_MAX * 100) return { fehler: `Transpose and detune together: ${TRANSPOSE_MIN} to ${TRANSPOSE_MAX} semitones` };
  return v === w[feld] ? { befehl: null } : { befehl: { befehl: 'warp_setzen', clip_id: clip.id, [feld]: v } };
}
// D6b: Transpose und Detune gibt es nur in complex und tones (RE-PITCH und BEATS folgen dem Tempo)
export const tonErlaubt = (w) => !!w && w.modus !== 'repitch' && w.modus !== 'beats';
export function modusBefehl(clip, modus) {
  const w = clip.warp, b = { befehl: 'warp_setzen', clip_id: clip.id, modus };
  if ((modus === 'repitch' || modus === 'beats') && (w.transpose_st !== 0 || w.detune_ct !== 0)) { b.transpose_st = 0; b.detune_ct = 0; }   // RE-PITCH und BEATS kennen keine Verstimmung (transpose_repitch)
  return b;
}

// Slice 3b: ×2 / :2 und „Set project tempo“ als Befehle der Seite. Der Server prüft maßgeblich (warp_faktor, tempo_bereich); die Vorprüfung hier spart
// nur den Weg für den offensichtlichen Fall (ein Segment käme aus 15..800 BPM heraus).
export const SEGMENT_BPM_BAND = [15, 800];
export function tempoBefehl(clip, faktor) {
  const w = clip?.art === 'audio' ? clip.warp : null;
  if (!w) return { fehler: 'That clip has no warp yet' };
  let min = Infinity, max = -Infinity;
  for (let i = 0; i + 1 < w.marker.length; i++) { const b = segmentBpm(w.marker, i); if (b < min) min = b; if (b > max) max = b; }
  if (min * faktor < SEGMENT_BPM_BAND[0] || max * faktor > SEGMENT_BPM_BAND[1]) {
    return { fehler: `${faktor === 2 ? '×2' : ':2'}: a segment would leave ${SEGMENT_BPM_BAND[0]} to ${SEGMENT_BPM_BAND[1]} BPM` };
  }
  return { befehl: { befehl: 'warp_tempo', clip_id: clip.id, faktor }, label: faktor === 2 ? 'Warp tempo ×2' : 'Warp tempo :2' };
}

export function projektTempoBefehl(clip) {
  if (clip?.art !== 'audio' || !clip.warp) return { fehler: 'That clip has no warp yet' };
  return { befehl: { befehl: 'tempo_vom_clip', clip_id: clip.id }, label: 'Set project tempo' };
}

// Slice 4: die drei Felder des Modus BEATS (Preserve, Transient Loop Mode, Transient Envelope). Vorgabe wie Live und wie BEATS_VORGABE im Modell.
export const BEATS_VORGABE = { raster: 'transienten', loop: 'vor', huelle: 100 };
export function beatsAnzeige(clip) {
  const w = clip?.art === 'audio' ? clip.warp : null;
  if (!w || w.modus !== 'beats') return { sichtbar: false, ...BEATS_VORGABE };
  return { sichtbar: true, ...BEATS_VORGABE, ...(w.beats ?? {}) };
}
// feld: 'raster' | 'loop' | 'huelle'; eine Änderung ist ein warp_setzen mit dem ganzen beats-Objekt. Der Server prüft maßgeblich (argument_ungueltig).
export function beatsBefehl(clip, feld, eingabe) {
  const w = clip?.art === 'audio' ? clip.warp : null;
  if (!w || w.modus !== 'beats') return { fehler: 'That clip is not in mode BEATS' };
  const alt = beatsAnzeige(clip);
  let wert = eingabe;
  if (feld === 'huelle') {
    const text = String(eingabe).trim();
    if (!/^\d{1,3}$/.test(text) || Number(text) > 100) return { fehler: 'Transient envelope: a whole number from 0 to 100' };
    wert = Number(text);
  }
  if (alt[feld] === wert) return { befehl: null };
  const beats = { raster: alt.raster, loop: alt.loop, huelle: alt.huelle, [feld]: wert };
  return { befehl: { befehl: 'warp_setzen', clip_id: clip.id, beats }, label: 'Warp beats' };
}

// Slice 4 (Prüfung T7): was detail.js zu den drei Feldern tut, als reine Funktionen (kein DOM in node): die Namen der Felder, ihre Anzeige und die Änderung.
export const BEATS_FELDER = [['beatsraster', 'raster'], ['beatsloop', 'loop'], ['beatshuelle', 'huelle']];     // [data-d-Name, Feld im beats-Objekt]
// teilVersteckt: der Block ist nur im Modus beats sichtbar; gesperrt sind die Felder, wo er versteckt ist; werte je data-d-Name (die Hülle als Text)
export function beatsFeldAnsicht(clip) {
  const b = beatsAnzeige(clip);
  return { teilVersteckt: !b.sichtbar, gesperrt: !b.sichtbar, werte: { beatsraster: b.raster, beatsloop: b.loop, beatshuelle: String(b.huelle) } };
}
export function beatsAenderung(clip, name, wert) {
  const feld = BEATS_FELDER.find((f) => f[0] === name)?.[1];
  return feld ? beatsBefehl(clip, feld, wert) : { fehler: `unknown field ${name}` };
}
