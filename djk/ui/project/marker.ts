// Arrangement markers (project field `marker`): the model check and the moves of the time operations. Imports only a type and the limits of the page
// module (public/production/marker.js, no imports of its own), so the model (model.ts) and time.ts can use it without a cycle.
import type { Marker, Projekt } from './model.ts';
import { MARKER_FARBE_MAX, MARKER_MAX, markerNameFehler } from '../public/production/marker.js';

const EPS = 1e-9;
const ID = /^m[1-9][0-9]*$/;

/** Error text for a whole `marker` value (model check), or null: 1..64 entries, ids m<n> once each, beats 0..maxBeat once each and ascending. */
export function markerFehler(x: unknown, maxBeat: number): string | null {
  if (!Array.isArray(x)) return 'marker: list expected';
  if (x.length < 1) return 'marker: not empty expected (absent when there is none)';
  if (x.length > MARKER_MAX) return `marker: at most ${MARKER_MAX} markers`;
  const ids = new Set<string>();
  let vorher = -Infinity;
  for (let i = 0; i < x.length; i += 1) {
    const m: unknown = x[i], wo = `marker[${i}]`;
    if (typeof m !== 'object' || m === null || Array.isArray(m)) return `${wo}: object expected`;
    const o = m as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!['id', 'beat', 'name', 'farbe'].includes(k)) return `${wo}.${k}: unknown field`;
    if (typeof o.id !== 'string' || !ID.test(o.id)) return `${wo}.id: m<n> expected`;
    if (ids.has(o.id)) return `${wo}.id: ${o.id} twice`;
    ids.add(o.id);
    if (typeof o.beat !== 'number' || !Number.isFinite(o.beat) || o.beat < 0 || o.beat > maxBeat) return `${wo}.beat: number 0..${maxBeat} expected`;
    if (o.beat <= vorher + EPS) return `${wo}.beat: ascending beats, one marker per beat expected`;
    vorher = o.beat;
    const n = markerNameFehler(o.name);
    if (n) return `${wo}.${n}`;
    if ('farbe' in o && !(typeof o.farbe === 'number' && Number.isInteger(o.farbe) && o.farbe >= 0 && o.farbe <= MARKER_FARBE_MAX)) {
      return `${wo}.farbe: whole number 0..${MARKER_FARBE_MAX} expected`;
    }
  }
  return null;
}

/** Sort the markers by beat; an empty list is removed (the field is never written empty). */
export function ordneMarker(p: Projekt): void {
  if (!p.marker) return;
  if (p.marker.length === 0) delete p.marker; else p.marker.sort((a, b) => a.beat - b.beat);
}

/**
 * Move the markers with a time operation: `ziel` gives the new beat of a marker, or null when it goes. The result stays sorted and, when no marker is
 * left, the field is removed. A time operation moves a whole stretch by one distance and drops what lies inside a removed range, so two markers never
 * end on one beat.
 */
export function bewegeMarker(p: Projekt, ziel: (beat: number) => number | null): void {
  if (!p.marker) return;
  const neu: Marker[] = [];
  for (const m of p.marker) {
    const b = ziel(m.beat);
    if (b !== null) neu.push({ ...m, beat: b });
  }
  p.marker = neu;
  ordneMarker(p);
}
