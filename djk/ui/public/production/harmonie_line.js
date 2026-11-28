// Production chord lane row (plan strand 7, 5.3): pure helpers for the row under the ruler. The project field is `harmonie: {eintraege:
// [{beat, grundton, skala, akkord?}]}`; every gesture ends in ONE command `harmonie_setzen {eintraege | null}` that replaces the whole lane
// (harmonieBefehl). Each helper takes the current list and returns the new list, or null when the gesture is refused (beat taken, bad text).
// No DOM, no imports of the page; the DOM is harmonie_line_operation.js.
import { akkordSymbol, laneTonart, SKALEN, SKALA_TEXT, TON_NAMEN } from '../harmonie.js';

export const HARMONIE_ZEILE_MAX = 512;       // entries (model.ts HARMONIE_MAX)
export const HARMONIE_ZEILE_HOEHE = 16;      // px (production.css .p-harmonie-zeile has the same value)
export const HARMONIE_BLOCK_MAX_PX = 240;
export const HARMONIE_GLEICH = 1e-9;

const WURZELN = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** What a block shows: the chord symbol when the entry has one, else the key ("A minor"). */
export const harmonieAnzeige = (e) => e.akkord ?? `${TON_NAMEN[e.grundton]} ${SKALA_TEXT[e.skala].toLowerCase()}`;

/** A key text ("A minor", "C# major", "Bb dorian", "D harmonic_minor") -> {grundton, skala}, or null when it is not one. */
export function tonartLesen(text) {
  const m = /^([A-G])([#b]?)\s+([A-Za-z_ ]+)$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const name = m[3].trim().toLowerCase().replace(/\s+/g, '_');
  const skala = Object.keys(SKALEN).find((k) => k === name);
  if (!skala) return null;
  return { grundton: (WURZELN[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12, skala };
}

/** Text typed into a block -> the entry fields {grundton, skala, akkord?}: a chord symbol (key derived from the chord) or a key. Null when neither. */
export function harmonieText(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const k = tonartLesen(t);
  if (k) return { grundton: k.grundton, skala: k.skala };
  try {
    const a = akkordSymbol(t);
    const tonart = laneTonart([a]);
    return { grundton: tonart.grundton, skala: tonart.skala, akkord: a.name };
  } catch { return null; }
}

const sortiert = (liste) => [...liste].sort((a, b) => a.beat - b.beat);
const belegt = (liste, beat, ausser = -1) => liste.findIndex((e, i) => i !== ausser && Math.abs(e.beat - beat) < HARMONIE_GLEICH) >= 0;

/** A new entry at `beat` from `text`; null when the beat is taken, the list is full, the beat is negative or the text is neither chord nor key. */
export function harmonieHinzu(liste, beat, text) {
  const f = harmonieText(text);
  const l = liste ?? [];
  if (!f || !(beat >= 0) || l.length >= HARMONIE_ZEILE_MAX || belegt(l, beat)) return null;
  return sortiert([...l, { beat, ...f }]);
}

/** The entry at index `i` moved to `beat`; null when that beat is taken by another entry. An unchanged beat returns the list as it is. */
export function harmonieBewege(liste, i, beat) {
  const l = liste ?? [];
  if (!l[i] || !(beat >= 0) || belegt(l, beat, i)) return null;
  return sortiert(l.map((e, j) => (j === i ? { ...e, beat } : e)));
}

/** The entry at index `i` with new text; null on a bad text. */
export function harmonieUmschreiben(liste, i, text) {
  const f = harmonieText(text);
  const l = liste ?? [];
  if (!f || !l[i]) return null;
  return l.map((e, j) => (j === i ? { beat: e.beat, ...f } : e));
}

/** The list without entry `i`; an empty result is an empty list (harmonieBefehl turns it into null: the lane is removed). */
export function harmonieLoesche(liste, i) {
  const l = liste ?? [];
  return l[i] ? l.filter((_, j) => j !== i) : null;
}

/** The one command of a gesture: the whole lane, or null when no entry is left (the field is absent when there is no lane). */
export const harmonieBefehl = (liste) => ({ befehl: 'harmonie_setzen', eintraege: liste.length ? liste : null });

/** Whether a block at pixel `x` can be seen in a row `breite` px wide (culled by its left edge, like the marker flags). */
export const harmonieSichtbar = (x, breite) => x <= breite && x >= -HARMONIE_BLOCK_MAX_PX;
