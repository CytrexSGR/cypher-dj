// Arrangement markers (project field `marker`, commands marker_setzen / marker_loeschen): the limits and the pure helpers shared by the server
// (project/marker.ts reads the limits from here) and the page. No DOM, no imports.

export const MARKER_MAX = 64;          // markers per project
export const MARKER_NAME_MAX = 40;     // characters of a name (code points)
export const MARKER_FARBE_MAX = 15;    // colour index 0..15, the table the cells and scenes use
const STEUER = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;   // C0, DEL, C1 (U+0085 NEL included), line and paragraph separator

/** Error text for a marker name, or null when it is valid (1..40 characters, no control characters). */
export function markerNameFehler(name) {
  if (typeof name !== 'string') return `name: text of 1 to ${MARKER_NAME_MAX} characters expected`;
  const n = Array.from(name).length;
  if (n < 1 || n > MARKER_NAME_MAX) return `name: text of 1 to ${MARKER_NAME_MAX} characters expected`;
  if (STEUER.test(name)) return 'name: no control characters (line breaks included) allowed';
  return name.trim() === '' ? 'name: not only blanks allowed' : null;
}

/** The end of the last clip of the project (main clips of every track), 0 without a clip. */
export const markerProjektEnde = (projekt) => Math.max(0, ...(projekt?.spuren ?? []).flatMap((s) => (s.clips ?? []).map((c) => c.start_beat + c.laenge_beats)));

/**
 * The stretch of the marker `id`: from its beat to the beat of the next marker, for the last marker to the end of the last clip. Returns null for an
 * unknown id or when that stretch is shorter than one beat (a marker at or behind the end of the last clip, or two markers closer than a beat):
 * loop_setzen refuses a loop under one beat, so the page must not send one.
 */
export function markerBereich(projekt, id) {
  const liste = [...(projekt?.marker ?? [])].sort((a, b) => a.beat - b.beat);
  const i = liste.findIndex((m) => m.id === id);
  if (i < 0) return null;
  const von = liste[i].beat;
  const bis = i + 1 < liste.length ? liste[i + 1].beat : markerProjektEnde(projekt);
  return bis - von >= 1 ? { von_beat: von, bis_beat: bis } : null;
}

// ---- the marker strip of the PRODUCTION view (pure helpers; the DOM is marker_operation.js) ----

export const MARKER_ZUG_PX = 4;        // a press that moves this far is a drag, below it a click
export const MARKER_LEISTE_HOEHE = 16; // px, the strip above the ruler (production.css .p-marker-leiste has the same value)
export const MARKER_FLAGGE_MAX_PX = 240; // widest flag the strip culls for (a flag further left than this is out of view)

/** The name of a new marker: `Marker <n>`, n counting up from the number of markers + 1 until the name is free. */
export function markerVorgabeName(liste) {
  const belegt = new Set((liste ?? []).map((m) => m.name));
  let n = (liste ?? []).length + 1;
  while (belegt.has(`Marker ${n}`)) n++;
  return `Marker ${n}`;
}

/** The beat a drag lands on: the start beat moved by `dxPx`, rounded to `schritt` beats (0 = no snapping), never before beat 0. */
export function markerZielBeat(beat, dxPx, pxProBeat, schritt) {
  const roh = Math.max(0, beat + dxPx / pxProBeat);
  return schritt > 0 ? Math.max(0, Math.round(roh / schritt) * schritt) : roh;
}

/** True once a press has moved far enough to count as a drag. */
export const markerZugErkannt = (dxPx) => Math.abs(dxPx) >= MARKER_ZUG_PX;

/** Whether a flag at pixel `x` can be seen in a strip `breite` px wide (a flag has no fixed width: it is culled by its left edge). */
export const markerSichtbar = (x, breite) => x <= breite && x >= -MARKER_FLAGGE_MAX_PX;
