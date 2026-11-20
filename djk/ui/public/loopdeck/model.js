// Loop deck view state (plan loop deck P2): pure functions, no DOM. The page server's GET /loopdeck/stand and the SSE event
// { a: 'loopdeck', f: { deck, spur, lauf } } become what the view draws; the play position comes from the page's beat clock.

// Cell colours, index 0..15 (the Traktor Kontrol S8 bridge uses the same table).
export const FARBEN = ['#ff4030', '#ff8020', '#ffbe20', '#e6e628', '#96e628', '#32dc46', '#1edc8c', '#1edcdc',
  '#28a0ff', '#3c5aff', '#8250ff', '#be46f0', '#f046c8', '#ff5082', '#c8c8c8', '#8c96aa'];
export const farbeVon = (i) => FARBEN[Number.isInteger(i) && i >= 0 && i < FARBEN.length ? i : 14];

// Grid values of the server and the labels of the selector.
export const RASTER = [['1/4', '1/4'], ['1/2', '1/2'], ['1', '1'], ['takt', 'BAR'], ['4takte', '4']];
export const rasterText = (r) => RASTER.find(([w]) => w === r)?.[1] ?? String(r ?? '');

export const SPUREN = 4, ZELLEN = 8, SR = 48000;
export const leerLauf = () => ({ zelle: null, verwaist: false, ab_beat: 0, versatz_beats: 0, wartend: null, zuletzt: null });

// The clock: the last known core beat and tempo with the local time they arrived. Extrapolates between events.
export const neueUhr = () => ({ beat: 0, bpm: 0, ms: 0, da: false });
export function uhrMelde(uhr, beat, bpm, ms) {
  if (!Number.isFinite(beat) || !Number.isFinite(bpm)) return uhr;
  uhr.beat = beat; uhr.bpm = bpm; uhr.ms = ms; uhr.da = true;
  return uhr;
}
export const beatJetzt = (uhr, ms) => (uhr.da ? uhr.beat + Math.max(0, ms - uhr.ms) * uhr.bpm / 60000 : null);

// Length of a cell in beats: its own field, else from the decoded length at the tempo.
export function zellBeats(z, bpm) {
  if (!z) return null;
  if (Number.isFinite(z.beats) && z.beats > 0) return z.beats;
  const t = Number.isFinite(z.bpm) && z.bpm > 0 ? z.bpm : bpm;
  return Number.isFinite(z.frames) && z.frames > 0 && t > 0 ? z.frames / SR * t / 60 : null;
}

// Play position 0..1 of a cell: p = ((beat - ab_beat + versatz) mod beats) / beats. A one-shot does not wrap (stays at 1 once played out).
// null: nothing to show (no clock, no length, not playing).
export function spielPos(lauf, zelle, beat, bpm) {
  if (!lauf || !lauf.zelle || lauf.verwaist || beat === null || beat === undefined) return null;
  const n = zellBeats(zelle, bpm);
  if (!n) return null;
  const roh = beat - lauf.ab_beat + (lauf.versatz_beats ?? 0);
  if (zelle.art === 'einmal') return Math.min(1, Math.max(0, roh / n));
  if (roh < 0) return Math.max(0, (lauf.versatz_beats ?? 0) / n);   // before the launch took effect: the start position
  return (roh % n) / n;
}

// State of one cell row: leer | voll | wartend | spielt (a pending start of this cell wins over playing while it replays).
export function zellZustand(spur, i) {
  const z = spur.zellen?.[i] ?? null;
  if (!z) return 'leer';
  const nr = i + 1, l = spur.lauf ?? leerLauf();
  if (l.wartend && l.wartend.zelle === nr) return 'wartend';
  if (l.zelle === nr && !l.verwaist) return 'spielt';
  return 'voll';
}

// What one deck shows. `deck` is the Deck of the stand or null (the empty grid, a deck that does not exist yet).
export function deckAnsicht(deck, nr) {
  const spuren = Array.from({ length: SPUREN }, (_, k) => {
    const s = deck?.spuren?.[k] ?? { nr: k + 1, name: `L${nr}.${k + 1}`, fader_db: 0, mute: false, filter: 0, zellen: [], lauf: leerLauf() };
    const lauf = s.lauf ?? leerLauf();
    const zellen = Array.from({ length: ZELLEN }, (_, i) => {
      const z = s.zellen?.[i] ?? null;
      return { nr: i + 1, zustand: zellZustand({ zellen: s.zellen, lauf }, i), name: z?.name ?? '', art: z?.art ?? 'loop', farbe: z ? farbeVon(z.farbe) : null, sha: z?.sha256 ?? null,
        laedt: !!z && z.frames === null };   // the stand says `frames: null` until the audio is decoded
    });
    const spielt = !!lauf.zelle;
    const z = spielt && !lauf.verwaist ? s.zellen?.[lauf.zelle - 1] ?? null : null;
    return {
      nr: s.nr ?? k + 1, name: s.name, faderDb: s.fader_db ?? 0, mute: !!s.mute, filter: s.filter ?? 0, zellen, lauf,
      spielt, verwaist: spielt && !!lauf.verwaist, stoppWartet: !!lauf.wartend && lauf.wartend.zelle === null,
      titel: z ? z.name : (spielt && lauf.verwaist ? 'playing (cell replaced)' : ''), sha: z?.sha256 ?? null, spielZelle: z,
    };
  });
  return { deck: nr, name: `LOOP ${nr}`, da: !!deck, raster: deck?.raster ?? '1', spuren };
}

// SSE { deck, spur, lauf }: replaces the run state of one track, returns true when the stand held that track.
export function laufEreignis(stand, f) {
  const s = stand?.decks?.[String(f?.deck)]?.spuren?.[Number(f?.spur) - 1];
  if (!s || !f.lauf) return false;
  const l = { ...leerLauf(), ...f.lauf };
  l.zelle = l.zelle || null;   // 0 = silent in the core state
  if (l.wartend) l.wartend = { ...l.wartend, zelle: l.wartend.zelle || null };
  s.lauf = l;
  return true;
}
