// Package 1.14 slice 4 (bounce, N08, spec R12): "Bounce Track in Place", "Bounce to New Track", "Copy for Bounced Paste" in the clip menu and
// "Paste Bounced Audio" on an empty spot of an audio track. Pure functions like merge.js (texts and the sender come in as parameters). The server
// stays the truth (every reason also comes from there); the page only saves the detour.
import { mergeSpuren, mergeBereich } from './merge.js';
import { rasten, rasterBeats, xZuBeat } from './zeitachse.js';
import { spurIndexBeiTabelle } from './layout.js';

const MAX_BEATS = 1024;
const EPS = 1e-9;                                     // the tolerance of the server hull (projekt/bounce.ts huelle, spec D4)
const rund = (x) => Math.round(x * 100) / 100;

export const BOUNCE_TEXT = {
  an_ort: 'Bounce Track in Place',
  neue_spur: 'Bounce to New Track',
  kopieren: 'Copy for Bounced Paste',
  einfuegen: 'Paste Bounced Audio',
  nur_audio: 'Only an audio track can be bounced in place: use Bounce to New Track, or Freeze for a Surge track',
  ziel_art: 'Bounced audio can only be pasted onto an audio track',
  lauf: 'A run is going on',
  roh: 'An audio clip is still being prepared',
  bereich: 'The range must be 1 to 1024 beats',
  freeze: 'Freeze the Surge track first',
  weg: 'A copied track no longer exists: copy again',
  fertig_an_ort: 'Bounced the track in place; the old clips wait in the take lane "Before bounce"',
  fertig_neue_spur: 'Bounced to a new track; the source is muted',
  fertig_einfuegen: 'Pasted the bounced audio',
  quellen_laenger: ' (the source is muted completely, also outside the range)',
};

// Spec D4: floor(first start + EPS) to ceil(last end - EPS), like the server; null without clips
export function bounceHuelle(clips) {
  if (!clips?.length) return null;
  const von = Math.min(...clips.map((c) => c.start_beat)), bis = Math.max(...clips.map((c) => c.start_beat + c.laenge_beats));
  return { von_beat: Math.floor(von + EPS), bis_beat: Math.ceil(bis - EPS) };
}

const imBereich = (c, b) => c.start_beat < b.bis_beat && c.start_beat + c.laenge_beats > b.von_beat;
const roh = (spuren, b) => spuren.some((s) => s.clips.some((c) => c.art === 'audio' && imBereich(c, b) && c.dekodiert !== 'fertig'));
const ungefroren = (spuren, b) => spuren.some((s) => s.geraet?.art === 'wirt' && !s.freeze
  && s.clips.some((c) => c.art === 'midi' && imBereich(c, b) && (c.noten?.length ?? 0) > 0));
const bereichFalsch = (b) => !(b.bis_beat - b.von_beat >= 1) || b.bis_beat - b.von_beat > MAX_BEATS;
const punkt = (id, text, grund, extra) => ({ id, text, aus: grund !== null, ...(grund ? { grund } : {}), ...extra });

// Menu items of a clip: in place for the track of the clicked clip, to new track only when the chosen clips lie on exactly one track (with two
// or more, Merge Tracks is the bounce to new track), and the copy for a later paste (tracks and range like mergeBereich).
export function bouncePunkte(projekt, auswahl, clip, lauf) {
  const alle = projekt?.spuren ?? [];
  const spuren = mergeSpuren(projekt, auswahl, clip.id);
  const geklickt = alle.find((s) => s.clips.some((c) => c.id === clip.id));
  if (!geklickt) return [];
  const aus = [];
  const h = bounceHuelle(geklickt.clips);
  let g = null;
  if (geklickt.art !== 'audio') g = BOUNCE_TEXT.nur_audio;
  else if (lauf) g = BOUNCE_TEXT.lauf;
  else if (!h || bereichFalsch(h)) g = `The track spans more than ${MAX_BEATS} beats`;
  else if (roh([geklickt], h)) g = BOUNCE_TEXT.roh;
  aus.push(punkt('an_ort', BOUNCE_TEXT.an_ort, g, { koerper: { art: 'an_ort', spur_id: geklickt.id } }));
  const b = mergeBereich(projekt, spuren), gewaehlt = alle.filter((s) => spuren.includes(s.id));
  if (spuren.length === 1) {
    let n = null;
    if (lauf) n = BOUNCE_TEXT.lauf;
    else if (bereichFalsch(b)) n = BOUNCE_TEXT.bereich;
    else if (roh(gewaehlt, b)) n = BOUNCE_TEXT.roh;
    else if (ungefroren(gewaehlt, b)) n = BOUNCE_TEXT.freeze;
    aus.push(punkt('neue_spur', `${BOUNCE_TEXT.neue_spur} (beats ${b.von_beat}–${b.bis_beat})`, n,
      { koerper: { art: 'neue_spur', spur_ids: spuren, von_beat: b.von_beat, bis_beat: b.bis_beat } }));
  }
  aus.push(punkt('kopieren', BOUNCE_TEXT.kopieren, bereichFalsch(b) ? BOUNCE_TEXT.bereich : null,
    { ablage: { spur_ids: spuren, von_beat: b.von_beat, bis_beat: b.bis_beat } }));
  return aus;
}

// The paste item for the track at index spurIndex at the grid-snapped beat (raster in beats, 0 = off), or null (no copy, not on a track row)
export function einfuegenPunkt(projekt, ablage, spurIndex, beat, raster, lauf) {
  if (!ablage) return null;
  const ziel = (projekt?.spuren ?? [])[spurIndex];
  if (!ziel) return null;
  const b = Math.max(0, rund(rasten(beat, raster)));
  let g = null;
  if (ziel.art !== 'audio') g = BOUNCE_TEXT.ziel_art;
  else if (lauf) g = BOUNCE_TEXT.lauf;
  else if (!ablage.spur_ids.every((id) => projekt.spuren.some((s) => s.id === id))) g = BOUNCE_TEXT.weg;
  return punkt('einfuegen', `${BOUNCE_TEXT.einfuegen} (beat ${b})`, g, { koerper: { art: 'einfuegen', spur_ids: ablage.spur_ids,
    von_beat: ablage.von_beat, bis_beat: ablage.bis_beat, ziel_spur_id: ziel.id, ziel_beat: b } });
}

// The paste item under the mouse (offsetX, offsetY on the arrangement): the row from the row table, the beat from the view and the grid value
export function einfuegenBeiMaus(projekt, ablage, zeilen, ansicht, x, y, rasterWert, lauf) {
  return einfuegenPunkt(projekt, ablage, spurIndexBeiTabelle(zeilen, y), xZuBeat(ansicht, x), rasterBeats(rasterWert), lauf);
}

// Item chosen: Copy only stores the tracks and the range in the page (ctx.setzeBounceAblage); every other item is one ctx.bounce(koerper) call,
// which answers the answer or null (the frame already showed the reason). fehlerText is the fallback for an answer with a status.
export async function bounceAktion(p, { bounce, melde, fehlerText, setzeBounceAblage }) {
  if (p.id === 'kopieren') {
    setzeBounceAblage(p.ablage);
    const n = p.ablage.spur_ids.length;
    melde(`Copied ${n} ${n === 1 ? 'track' : 'tracks'} (beats ${p.ablage.von_beat}–${p.ablage.bis_beat}) for bounced paste: right click an empty spot of an audio track`);
    return;
  }
  const r = await bounce(p.koerper);
  if (r === null || r === undefined) return;
  if (r.status !== undefined && r.status !== 200) { melde(fehlerText(r), true); return; }
  // spec R10: content of a neue_spur source outside the range is muted as well (merge D8); say so, as mergeAktion does
  melde(`${BOUNCE_TEXT[`fertig_${p.koerper.art}`]}${r.hinweis === 'quellen_laenger' ? BOUNCE_TEXT.quellen_laenger : ''}`);
}
