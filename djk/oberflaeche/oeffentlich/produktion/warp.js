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

// Was der Detailbereich zeigt: Schalterstand, Modus, Herkunft, Hinweis auf eine unsichere Takt-Eins, Tempo des ersten Segments
const MODUS_TEXT = { repitch: 'RE-PITCH' };
const QUELLE_TEXT = { takte: 'from bars', mediathek: 'from library BPM', werkstatt: 'from analysis', traktor: 'from Traktor grid', hand: 'by hand' };
export function warpAnzeige(clip) {
  const w = clip?.art === 'audio' ? clip.warp : null;
  if (!w) return { vorhanden: false, an: false, modus: '', herkunft: '', downbeatFrage: false, bpm: null };
  return {
    vorhanden: true, an: w.an === true, modus: MODUS_TEXT[w.modus] ?? w.modus, herkunft: QUELLE_TEXT[w.quelle] ?? w.quelle,
    downbeatFrage: w.eins_unsicher === true, bpm: w.marker.length >= 2 ? Math.round(segmentBpm(w.marker, 0) * 100) / 100 : null,
  };
}
