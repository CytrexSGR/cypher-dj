// NOTEN (note editor, N16): pure geometry, hit tests and snapping of the editor surface. No DOM, runs in the browser and in node.
// View a = { s0, pxProS, tonOben }: s0 is the source second at the left edge of the note area (right of the key column), pxProS the pixels per second,
// tonOben the pitch of the top row. x is a pixel of the canvas (key column included), y too. Written after production/warp_editor.js (time axis) and
// production/pianoroll.js (rows, key names), not imported from them: this folder stays free of anything outside public/noten/.
import { zeitAnwenden } from './time.js';

export const TASTEN_BREITE = 40;
export const TON_HOEHE = 9;
export const TREFFER_PX = 4;                 // a bar narrower than twice this is grabbed this far beside its edges
export const PX_PRO_S = { min: 2, max: 4000 };
const NAMEN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const klemme = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const rund4 = (x) => Math.round(x * 1e4) / 1e4;

export const tonName = (t) => `${NAMEN[t % 12]}${Math.floor(t / 12) - 2}`;   // 60 = C3, as in production/pianoroll.js
export const istSchwarz = (t) => [1, 3, 6, 8, 10].includes(t % 12);
export const zeilen = (hoehe) => Math.max(1, Math.floor(hoehe / TON_HOEHE));

export const sZuX = (a, s) => TASTEN_BREITE + (s - a.s0) * a.pxProS;
export const xZuS = (a, x) => a.s0 + (x - TASTEN_BREITE) / a.pxProS;
// y of the middle line of the row of pitch `ton` (float pitch moves the line continuously); yZuTon is its inverse and gives a float pitch
export const tonZuY = (a, ton) => (a.tonOben - ton + 0.5) * TON_HOEHE;
export const yZuTon = (a, y) => a.tonOben + 0.5 - y / TON_HOEHE;

const effTon = (n) => n.ton ?? n.qton;
const effA = (n) => n.a ?? n.qa;
const effE = (n) => n.e ?? n.qe;

// Start view: the whole source fits the width, the pitch range of the notes sits in the middle of the rows (without notes around 60)
export function neueAnsicht(sicht, breite, hoehe) {
  const quelleS = sicht?.quelleS > 0 ? sicht.quelleS : 0;
  const pxProS = quelleS > 0 ? klemme((breite - TASTEN_BREITE) / quelleS, PX_PRO_S.min, PX_PRO_S.max) : 40;
  const toene = (sicht?.noten ?? []).map(effTon);
  const mitte = toene.length ? Math.round((Math.min(...toene) + Math.max(...toene)) / 2) : 60;
  const z = zeilen(hoehe);
  return { s0: 0, pxProS, tonOben: klemme(mitte + Math.floor(z / 2), z - 1, 127) };
}
// Zoom around the pixel x: the second under x stays where it is (unless the view hits second 0)
export function zoom(a, faktor, x) {
  const s = xZuS(a, x), p = klemme(a.pxProS * faktor, PX_PRO_S.min, PX_PRO_S.max);
  return { ...a, s0: Math.max(0, s - (x - TASTEN_BREITE) / p), pxProS: p };
}
export const scrolle = (a, dx) => ({ ...a, s0: Math.max(0, a.s0 + dx / a.pxProS) });
export const scrolleTon = (a, dTon, hoehe) => ({ ...a, tonOben: klemme(a.tonOben + dTon, zeilen(hoehe) - 1, 127) });

// The bar of a note: at its target pitch (else the detected one), from its effective start to its effective end
export function notenKasten(a, n) {
  const x = sZuX(a, effA(n));
  return { x, y: tonZuY(a, effTon(n)) - TON_HOEHE / 2, w: Math.max(2, (effE(n) - effA(n)) * a.pxProS), h: TON_HOEHE };
}
// id of the note under (x, y), the later one of the list when bars overlap, else null; the key column hits nothing
export function trefferNote(noten, a, x, y) {
  if (x < TASTEN_BREITE) return null;
  for (let i = noten.length - 1; i >= 0; i--) {
    const k = notenKasten(a, noten[i]), tol = k.w < 2 * TREFFER_PX ? TREFFER_PX : 0;
    if (x >= k.x - tol && x <= k.x + k.w + tol && y >= k.y && y <= k.y + k.h) return noten[i].id;
  }
  return null;
}

// Edge of a bar under (x, y): { id, kante: 'a' | 'e' } within TREFFER_PX of the start or end line (a bar narrower than twice that: only beside its
// edges, so its body stays grabbable), else null. The later note wins when bars overlap; the key column hits nothing.
export function trefferKante(noten, a, x, y) {
  if (x < TASTEN_BREITE) return null;
  for (let i = noten.length - 1; i >= 0; i--) {
    const k = notenKasten(a, noten[i]);
    if (y < k.y || y > k.y + k.h) continue;
    const schmal = k.w < 2 * TREFFER_PX, r = k.x + k.w;
    const nahA = schmal ? x >= k.x - TREFFER_PX && x < k.x : Math.abs(x - k.x) <= TREFFER_PX;
    const nahE = schmal ? x > r && x <= r + TREFFER_PX : Math.abs(x - r) <= TREFFER_PX;
    if (nahA || nahE) {
      if (nahA && nahE) return { id: noten[i].id, kante: Math.abs(x - k.x) <= Math.abs(x - r) ? 'a' : 'e' };
      return { id: noten[i].id, kante: nahA ? 'a' : 'e' };
    }
    if (x >= k.x && x <= r) return null;     // inside a body: the body wins over bars below it
  }
  return null;
}

const rundeS = (x) => Math.round(x * 1e6) / 1e6;
// Time `s` snapped to 1/16 of the clip grid (modus 'raster' with a grid), else free at 0.001 s
function rasteZeit(s, modus, raster) {
  if (modus === 'frei' || !raster) return Math.round(s * 1e3) / 1e3;
  const b = raster.beatBeiS(s), z = raster.sBeiBeat(Math.round(b * 4) / 4);
  return Number.isFinite(z) ? z : Math.round(s * 1e3) / 1e3;
}
// Largest value toward `ziel` (from `von`, which is allowed) that `erlaubt` accepts: the target itself, else 20 steps of bisection
function groesster(von, ziel, erlaubt) {
  if (erlaubt(ziel)) return ziel;
  let ok = von, nein = ziel;
  for (let i = 0; i < 20; i++) { const m = (ok + nein) / 2; if (erlaubt(m)) ok = m; else nein = m; }
  return ok;
}
// The time op for dragging by dxS seconds. kante null: every selected note moves by ONE delta, the anchor's start lands on the snapped time
// ({ art: 'zeit', ids, um_s }); kante 'a' | 'e': that edge of the anchor alone ({ art: 'kante', id, a | e }). The result is clamped toward the pointer to what
// zeitAnwenden accepts. null when nothing moves, the anchor is gone, or not even the smallest step is allowed.
export function zeitZugOp(noten, ids, ankerId, dxS, kante, modus, raster) {
  const anker = noten.find((n) => n.id === ankerId);
  const wahl = noten.filter((n) => ids.includes(n.id));
  if (!anker || !wahl.length) return null;
  const ok = (aend) => !zeitAnwenden(noten, aend).grund;
  if (kante) {
    const feld = kante, alt = feld === 'a' ? effA(anker) : effE(anker);
    const ziel = rundeS(rasteZeit(alt + dxS, modus, raster));
    const wert = rundeS(groesster(alt, ziel, (w) => ok({ ids: [anker.id], [feld]: rundeS(w) })));
    if (wert === alt || !ok({ ids: [anker.id], [feld]: wert })) return null;
    return { art: 'kante', id: anker.id, [feld]: wert };
  }
  const start = effA(anker), ziel = rundeS(rasteZeit(start + dxS, modus, raster)) - start;
  const um = rundeS(groesster(0, ziel, (d) => ok({ ids: wahl.map((n) => n.id), zeitUm: rundeS(d) })));
  if (um === 0 || !ok({ ids: wahl.map((n) => n.id), zeitUm: um })) return null;
  return { art: 'zeit', ids: wahl.map((n) => n.id), um_s: um };
}
// The notes a time op changes (moved notes and neighbours that follow), as they will be: the list that zeitAnwenden gives, restricted to changed notes
export function zeitVorschau(noten, op) {
  if (!op) return [];
  const r = op.art === 'zeit' ? zeitAnwenden(noten, { ids: op.ids, zeitUm: op.um_s })
    : op.art === 'kante' ? zeitAnwenden(noten, { ids: [op.id], ...(op.a !== undefined ? { a: op.a } : { e: op.e }) }) : { grund: 'x' };
  if (r.grund) return [];
  return r.liste.filter((n, i) => n !== noten[i]);
}

// Target pitch of note n when its bar is dragged by dy semitones (rows, positive = up) from its current target.
// halbton: nearest whole MIDI pitch; frei: steps of 0.01; tonart: the project key's tone nearest to the whole pitch (halbton without a key).
// Always inside qton +-24 and 0..127.
export function zielTon(n, dy, modus, rasteTonart) {
  const roh = effTon(n) + dy;
  let ton;
  if (modus === 'frei') ton = Math.round(roh * 100) / 100;
  else {
    ton = Math.round(roh);
    if (modus === 'tonart' && typeof rasteTonart === 'function') { const t = rasteTonart(ton); if (Number.isFinite(t)) ton = t; }
  }
  return klemme(ton, Math.max(0, n.qton - 24), Math.min(127, n.qton + 24));
}
// The `ton` op for dragging the anchor note by dy semitones: ONE um for every selected note (the anchor's new target minus its current one, rounded to 1e-4),
// kept inside the span of every selected note so the command is not refused for a note that cannot follow. null when nothing moves.
export function zugOp(noten, ids, ankerId, dy, modus, rasteTonart) {
  const anker = noten.find((n) => n.id === ankerId);
  const wahl = noten.filter((n) => ids.includes(n.id));
  if (!anker || !wahl.length) return null;
  let lo = -Infinity, hi = Infinity;
  for (const n of wahl) {
    lo = Math.max(lo, Math.max(0, n.qton - 24) - effTon(n));
    hi = Math.min(hi, Math.min(127, n.qton + 24) - effTon(n));
  }
  lo = Math.ceil(lo * 1e4) / 1e4; hi = Math.floor(hi * 1e4) / 1e4;       // rounding must not step over a bound
  if (lo > hi) return null;
  const um = klemme(rund4(zielTon(anker, dy, modus, rasteTonart) - effTon(anker)), lo, hi) || 0;
  if (um === 0) return null;
  return { art: 'ton', ids: wahl.map((n) => n.id), um };
}

// Beat grid lines inside the note area as x positions (takt: bar line). Dense grids thin out to bars, then to every second bar and so on (6 px at least).
export function rasterLinien(raster, a, breite) {
  if (!raster || !(a.pxProS > 0) || breite <= TASTEN_BREITE) return [];
  const b0 = raster.beatBeiS(xZuS(a, TASTEN_BREITE)), b1 = raster.beatBeiS(xZuS(a, breite));
  if (!Number.isFinite(b0) || !Number.isFinite(b1) || b1 <= b0) return [];
  const proTakt = raster.beatsProTakt > 0 ? raster.beatsProTakt : 4;
  const pxBeat = (breite - TASTEN_BREITE) / (b1 - b0);
  let schritt = 1;
  if (pxBeat < 6) { schritt = proTakt; while (pxBeat * schritt < 6 && schritt < 1e6) schritt *= 2; }
  const aus = [];
  for (let b = Math.ceil(b0 / schritt) * schritt; b <= b1 && aus.length < 4000; b += schritt) {
    const x = sZuX(a, raster.sBeiBeat(b));
    if (x >= TASTEN_BREITE && x <= breite) aus.push({ x, takt: ((b % proTakt) + proTakt) % proTakt === 0 });
  }
  return aus;
}

// The detected pitch line inside the note as canvas points, moved by (target - qton); unvoiced frames are left out, at most one point per pixel
export function kurvePunkte(kurve, n, a) {
  if (!kurve || !(kurve.hopS > 0) || !kurve.ct) return [];
  const dauerQ = n.qe - n.qa, start = effA(n), dauer = effE(n) - start, dTon = effTon(n) - n.qton;
  const i0 = Math.max(0, Math.ceil(n.qa / kurve.hopS)), i1 = Math.min(kurve.ct.length - 1, Math.floor(n.qe / kurve.hopS));
  const schritt = Math.max(1, Math.floor(1 / (kurve.hopS * a.pxProS)));
  const aus = [];
  for (let i = i0; i <= i1; i += schritt) {
    const ct = kurve.ct[i];
    if (!(ct > 0)) continue;
    const s = start + (dauerQ > 0 ? ((i * kurve.hopS - n.qa) / dauerQ) * dauer : 0);
    aus.push([sZuX(a, s), tonZuY(a, ct / 100 + dTon)]);
  }
  return aus;
}
