// Paket 1.13 Slice 7 (D14): "Merge Tracks" on the page. Pure functions only (the only import is the pure brauchtSlot: texts and the sender come in as parameters), like stems.js.
// The server stays the truth (every reason also comes from there); the page only saves the detour.
import { brauchtSlot } from './rack_device.js';
const MAX_BEATS = 1024;
const rund = (x) => Math.round(x * 100) / 100;

// Track ids in track order: the tracks of the chosen clips. A right click outside the selection selects anew (as everywhere): [clicked].
export function mergeSpuren(projekt, auswahlClipIds, geklickterClip) {
  const gewaehlt = auswahlClipIds.includes(geklickterClip) ? auswahlClipIds : [geklickterClip];
  return (projekt?.spuren ?? []).filter((s) => s.clips.some((c) => gewaehlt.includes(c.id))).map((s) => s.id);
}

// Range of the merge (deviation from the spec: there is no time selection on the time axis): the loop bracket when it is on and at least 1 beat,
// else the hull of the clips of the chosen tracks. Both ends rounded to two decimals.
export function mergeBereich(projekt, spuren) {
  const l = projekt?.loop;
  if (l?.an === true && l.bis_beat - l.von_beat >= 1 && l.bis_beat - l.von_beat <= MAX_BEATS) return { von_beat: rund(l.von_beat), bis_beat: rund(l.bis_beat) };
  let von = Infinity, bis = -Infinity;
  for (const s of projekt?.spuren ?? []) {
    if (!spuren.includes(s.id)) continue;
    for (const c of s.clips) { von = Math.min(von, c.start_beat); bis = Math.max(bis, c.start_beat + c.laenge_beats); }
  }
  return Number.isFinite(von) ? { von_beat: rund(von), bis_beat: rund(bis) } : { von_beat: 0, bis_beat: 0 };
}

// Menu items: [] for a MIDI clip without a second track; else one item { id: 'merge', text, aus, grund?, koerper }.
// aus is true for: a running run, fewer than two tracks, a range over 1024 or under 1 beat, an audio clip in the range that is not decoded,
// a Surge track with notes and no freeze, solo on only some of the tracks.
// 1.14 slice 4 (plan 3.1): with one track there is no merge item (Bounce to New Track takes its place, bounce.js).
export function mergePunkte(projekt, auswahl, clip, lauf) {
  const spuren = mergeSpuren(projekt, auswahl, clip.id);
  if (spuren.length < 2) return [];
  const b = mergeBereich(projekt, spuren), n = b.bis_beat - b.von_beat;
  const gewaehlt = (projekt?.spuren ?? []).filter((s) => spuren.includes(s.id));
  const imBereich = (c) => c.start_beat < b.bis_beat && c.start_beat + c.laenge_beats > b.von_beat;
  const solos = gewaehlt.filter((s) => s.solo).length;
  let grund = null;
  if (lauf) grund = 'A run is going on';
  else if (spuren.length < 2) grund = 'Select clips on at least two tracks';
  else if (!(n >= 1) || n > MAX_BEATS) grund = 'The range must be 1 to 1024 beats';
  else if (gewaehlt.some((s) => s.clips.some((c) => c.art === 'audio' && imBereich(c) && c.dekodiert !== 'fertig'))) {
    grund = 'An audio clip is still being prepared';
  }
  else if (gewaehlt.some((s) => brauchtSlot(s) && !s.freeze && s.clips.some((c) => c.art === 'midi' && imBereich(c) && (c.noten?.length ?? 0) > 0))) {
    grund = 'Freeze the Surge track first';
  } else if (solos > 0 && solos < gewaehlt.length) grund = 'Solo all or none';
  const wort = spuren.length === 1 ? 'track' : 'tracks';
  return [{ id: 'merge', text: `Merge Tracks (${spuren.length} ${wort}, beats ${b.von_beat}–${b.bis_beat})`, aus: grund !== null, ...(grund ? { grund } : {}),
    koerper: { spur_ids: spuren, von_beat: b.von_beat, bis_beat: b.bis_beat } }];
}

// Item chosen: ctx.zusammenfuehren(koerper) answers the project answer or null (the frame already showed the error text of the reason, never "Rejected").
// fehlerText stays as the fallback for an answer without a project: the text of the reason.
export async function mergeAktion(p, { zusammenfuehren, melde, fehlerText }) {
  const r = await zusammenfuehren(p.koerper);
  if (r === null || r === undefined) return;
  if (r.status !== undefined && r.status !== 200) { melde(fehlerText(r), true); return; }
  const n = p.koerper.spur_ids.length;
  melde(`Merged ${n} tracks into one${r.hinweis === 'quellen_laenger' ? ' (the sources are muted completely, also outside the range)' : ''}`);
}
