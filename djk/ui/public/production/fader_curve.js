// PRODUCTION: the fader taper (one module for every volume fader and the y axis of the fader lane). The stored value stays dB everywhere (project format,
// server, OSC, core); only the page maps the position of a slider or a lane row to dB. A linear -60..+6 dB slider put -27 dB at half travel, which is
// practically inaudible in a mix; this is a mixing-desk taper: the useful range 0 .. -24 dB takes about half the travel.
// ANKER: [position 0..1, dB], position ascending. Between the anchors the dB value is interpolated linearly. -200 (off) sits at position 0, the segment
// 0 .. 0.05 runs from -200 to -60 (the page treats everything at or below -60 as off, see faderWert in track_heads.js).
export const ANKER = [[0, -200], [0.05, -60], [0.2, -40], [0.4, -24], [0.6, -12], [0.72, -6], [0.85, 0], [1, 6]];
export const DB_AUS = -200, DB_MAX = 6;
export const REGLER_MAX = 1000, REGLER_SCHRITT = 5;   // range input: 0..1000 in steps of 5 (all anchors lie on this grid); a key press is one slider step (about 0.2 dB at 0 dB, 0.7 dB at most), but see tasteDb: the page makes it move the stored dB by at least one rounding step

// dB -> position 0..1 (monotonic; -200 and below = 0, +6 and above = 1)
export function posVonDb(db) {
  if (typeof db !== 'number' || Number.isNaN(db) || db <= ANKER[0][1]) return 0;
  if (db >= ANKER.at(-1)[1]) return 1;
  for (let i = 1; i < ANKER.length; i++) {
    const [p1, d1] = ANKER[i];
    if (db <= d1) { const [p0, d0] = ANKER[i - 1]; return p0 + ((db - d0) / (d1 - d0)) * (p1 - p0); }
  }
  return 1;
}

// position 0..1 -> dB, rounded to 0.5 dB above -40 dB and to whole dB at and below it (the 0.5 dB step near 0 dB stays)
export function dbVonPos(p) {
  if (typeof p !== 'number' || Number.isNaN(p) || p <= 0) return DB_AUS;
  if (p >= 1) return DB_MAX;
  for (let i = 1; i < ANKER.length; i++) {
    const [p1, d1] = ANKER[i];
    if (p <= p1) {
      const [p0, d0] = ANKER[i - 1];
      const db = d0 + ((p - p0) / (p1 - p0)) * (d1 - d0);
      return (db > -40 ? Math.round(db * 2) / 2 : Math.round(db)) + 0;
    }
  }
  return DB_MAX;
}

// the range input: its value (a number 0..REGLER_MAX, or the string of the input) <-> dB
export const reglerVonDb = (db) => Math.round(posVonDb(db) * REGLER_MAX);
export const dbVonRegler = (wert) => dbVonPos(Number(wert) / REGLER_MAX);

// One key press on a fader: the slider moves by `schritt` steps (+1 up, -1 down), but the 0.5 dB / 1 dB rounding of dbVonPos can swallow it. Returns the
// dB the press must send: the rounded value of the new position, and if that equals the old dB, one rounding step further in the direction of the press.
export function tasteDb(alteDb, neuerRegler, richtung) {
  const neu = dbVonRegler(neuerRegler);
  if (richtung > 0 ? neu > alteDb : neu < alteDb) return neu;
  const schritt = (richtung > 0 ? alteDb >= -40 : alteDb > -40) ? 0.5 : 1;
  return Math.min(DB_MAX, Math.max(DB_AUS, alteDb + richtung * schritt));
}

// The page side of tasteDb: tasteMerke(r, key) on keydown remembers the dB of the thumb before the browser moves it; tasteWert(r) in the input handler returns
// the dB to send (and puts the thumb on it). Without a key press within TASTE_MS (a mouse drag, a double click) it is plain dbVonRegler(r.value).
const TASTE_RICHTUNG = { ArrowUp: 1, ArrowRight: 1, PageUp: 1, End: 1, ArrowDown: -1, ArrowLeft: -1, PageDown: -1, Home: -1 };
export const TASTE_MS = 150;
export function tasteMerke(r, key) {
  const richtung = TASTE_RICHTUNG[key];
  if (richtung) r.tasteStand = { alt: dbVonRegler(r.value), richtung, t: Date.now() };
}
export function tasteWert(r) {
  const s = r.tasteStand; r.tasteStand = null;
  if (!s || Date.now() - s.t > TASTE_MS) return dbVonRegler(r.value);
  const v = tasteDb(s.alt, r.value, s.richtung);
  r.value = String(reglerVonDb(v));
  return v;
}
