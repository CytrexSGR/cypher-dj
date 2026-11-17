// Harmony helpers (2026-11-17): the key of a project (root and scale) and what the note editors do with it. Pure functions, browser and node, no DOM.
// A key is { grundton: 0..11 (C = 0), skala: a name of SKALEN }. Pitches are MIDI notes 0..127. Notes are project notes { id, beat, laenge, ton, vel }.
// Used by the step grid of the studio (werkbank/grid_view.js), the piano roll of PRODUCTION (production/pianoroll_operation.js) and the project
// model (project/model.ts checks the field, project/commands.ts the command tonart_setzen).

export const TON_NAMEN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// Semitones above the root. The order is the order of the menus and the tie-break of the key search (minor first: the house default).
export const SKALEN = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  melodic_minor: [0, 2, 3, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  minor_pentatonic: [0, 3, 5, 7, 10],
  major_pentatonic: [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
};
export const SKALA_TEXT = {
  minor: 'Minor', major: 'Major', dorian: 'Dorian', phrygian: 'Phrygian', harmonic_minor: 'Harmonic minor', melodic_minor: 'Melodic minor',
  mixolydian: 'Mixolydian', lydian: 'Lydian', locrian: 'Locrian', minor_pentatonic: 'Minor pentatonic', major_pentatonic: 'Major pentatonic', blues: 'Blues',
};
const SUCH_SKALEN = ['minor', 'major', 'dorian', 'phrygian', 'harmonic_minor', 'melodic_minor', 'mixolydian', 'lydian', 'locrian'];   // seven-tone scales only
export const ARP_MODI = ['up', 'down', 'updown'];
const EPS = 1e-9;
const runde = (x) => Math.round(x * 1e9) / 1e9;
const pk = (ton) => ((ton % 12) + 12) % 12;   // pitch class

// The text of what is wrong with a key, or null. A key object carries exactly grundton and skala.
export function tonartFehler(t) {
  if (typeof t !== 'object' || t === null || Array.isArray(t)) return 'tonart: an object {grundton, skala} expected';
  const extra = Object.keys(t).filter((k) => k !== 'grundton' && k !== 'skala');
  if (extra.length) return `tonart: unknown field ${extra[0]}`;
  if (!Number.isInteger(t.grundton) || t.grundton < 0 || t.grundton > 11) return 'tonart.grundton: whole number 0..11 expected (C = 0)';
  if (typeof t.skala !== 'string' || !Object.hasOwn(SKALEN, t.skala)) return `tonart.skala: one of ${Object.keys(SKALEN).join(', ')} expected`;
  return null;
}
export const tonartOk = (t) => tonartFehler(t) === null;
export const tonartText = (t) => (tonartOk(t) ? `${TON_NAMEN[t.grundton]} ${SKALA_TEXT[t.skala].toLowerCase()}` : '');

// The pitch classes of a key, ascending from the root (as offsets) and as a set of absolute pitch classes.
const stufenVon = (t) => SKALEN[t.skala];
export const klassen = (t) => new Set(stufenVon(t).map((s) => pk(t.grundton + s)));
export const inSkala = (ton, t) => !tonartOk(t) || klassen(t).has(pk(ton));
export const istGrundton = (ton, t) => tonartOk(t) && pk(ton) === t.grundton;

// The nearest pitch of the key (a pitch of the key stays; a tie goes down, the darker choice). Without a key the pitch stays.
export function rasteEin(ton, t) {
  if (!tonartOk(t)) return ton;
  const k = klassen(t);
  for (let d = 0; d < 12; d++) {
    if (ton - d >= 0 && k.has(pk(ton - d))) return ton - d;
    if (ton + d <= 127 && k.has(pk(ton + d))) return ton + d;
  }
  return ton;
}
// `n` steps of the key up (positive) or down from a pitch. A pitch outside the key first moves to the next pitch of the key in that direction, which
// counts as the first step. Without a key a step is a semitone. null when the result leaves 0..127.
export function stufenSchritt(ton, t, n) {
  if (!tonartOk(t)) { const z = ton + n; return z < 0 || z > 127 ? null : z; }
  const k = klassen(t), r = Math.sign(n);
  let z = ton;
  for (let i = 0; i < Math.abs(n); i++) {
    do { z += r; } while (z >= 0 && z <= 127 && !k.has(pk(z)));
    if (z < 0 || z > 127) return null;
  }
  return z;
}
// The chord on a pitch: `anzahl` pitches in thirds of the key (every second step), lowest first. Without a key a minor triad (root, minor third, fifth).
// Pitches above 127 are left out.
export function akkord(ton, t, anzahl = 3) {
  if (!tonartOk(t)) return [0, 3, 7, 10, 14].slice(0, anzahl).map((d) => ton + d).filter((z) => z <= 127);
  const aus = [rasteEin(ton, t)];
  while (aus.length < anzahl) {
    const z = stufenSchritt(aus[aus.length - 1], t, 2);
    if (z === null) break;
    aus.push(z);
  }
  return aus;
}

// The chord on a step of the key (`stufe` 1 = the root of the key) in an octave (C3 = 60, so octave 3 starts at 60), lowest first.
export function stufenAkkord(t, stufe, oktave = 3, anzahl = 3) {
  const s = stufenVon(t), i = ((stufe - 1) % s.length + s.length) % s.length;
  return akkord((oktave + 2) * 12 + t.grundton + s[i], t, anzahl);
}
// Voice leading: the pitches of a chord placed so that they move as little as possible from the chord before it. A pitch class the chord before holds
// stays where it is (a common tone), every other pitch takes the octave nearest to the middle of the chord before. Lowest first; without a chord
// before the pitches stay.
export function fuehre(vorher, toene) {
  if (!vorher.length) return [...toene].sort((a, b) => a - b);
  const mitte = vorher.reduce((a, b) => a + b, 0) / vorher.length;
  const aus = toene.map((ton) => {
    const gleich = vorher.find((v) => pk(v) === pk(ton));
    if (gleich !== undefined) return gleich;
    let z = ton;
    while (z - mitte > 6 && z - 12 >= 0) z -= 12;
    while (mitte - z > 6 && z + 12 <= 127) z += 12;
    return z;
  });
  return [...new Set(aus)].sort((a, b) => a - b);
}

// ---------- chords inside a note list ----------
// Notes that start together are one chord: groups by start (same beat within `toleranz` beats), in time order, each with its notes lowest first.
export function akkordGruppen(noten, toleranz = 1e-6) {
  const sortiert = [...noten].sort((a, b) => a.beat - b.beat || a.ton - b.ton);
  const aus = [];
  for (const n of sortiert) {
    const g = aus[aus.length - 1];
    if (g && n.beat - g.beat <= toleranz) g.noten.push(n); else aus.push({ beat: n.beat, noten: [n] });
  }
  for (const g of aus) { g.noten.sort((a, b) => a.ton - b.ton); g.ende = Math.max(...g.noten.map((n) => n.beat + n.laenge)); }
  return aus;
}
// Changes [{ id, ton }] that move every note by `halb` semitones; none at all when one of them would leave 0..127.
export function transponiere(noten, halb) {
  if (!halb || noten.some((n) => n.ton + halb < 0 || n.ton + halb > 127)) return [];
  return noten.map((n) => ({ id: n.id, ton: n.ton + halb }));
}
// Changes that move every note by `n` steps of the key (stufenSchritt); none at all when one would leave the range.
export function transponiereStufen(noten, t, n) {
  const aus = [];
  for (const x of noten) { const z = stufenSchritt(x.ton, t, n); if (z === null) return []; if (z !== x.ton) aus.push({ id: x.id, ton: z }); }
  return aus;
}
// Inversion: in every chord of the list the lowest note goes an octave up (`richtung` > 0) or the highest an octave down. A chord of one note and a
// note that would leave 0..127 or land on a pitch the chord already holds stay.
export function umkehrung(noten, richtung) {
  const aus = [];
  for (const g of akkordGruppen(noten)) {
    if (g.noten.length < 2) continue;
    const n = richtung > 0 ? g.noten[0] : g.noten[g.noten.length - 1], z = n.ton + (richtung > 0 ? 12 : -12);
    if (z < 0 || z > 127 || g.noten.some((x) => x.ton === z)) continue;
    aus.push({ id: n.id, ton: z });
  }
  return aus;
}
// Changes that put every note outside the key on the nearest pitch of the key (rasteEin).
export function inTonart(noten, t) {
  return noten.filter((n) => !inSkala(n.ton, t)).map((n) => ({ id: n.id, ton: rasteEin(n.ton, t) }));
}

// ---------- arpeggio ----------
// Every chord of the list (two pitches or more) becomes single notes of `schritt` beats, one after the other for as long as the chord sounds: lowest
// first ('up'), highest first ('down') or up and down without repeating the turning notes ('updown'). A note takes the velocity of the chord note of
// its pitch. -> { loeschen: [ids of the chord notes], neu: [notes without id] }; chords of one pitch stay as they are.
export function arpeggio(noten, schritt, modus = 'up') {
  if (!(schritt > 0)) return { loeschen: [], neu: [] };
  const loeschen = [], neu = [];
  for (const g of akkordGruppen(noten)) {
    const toene = [...new Map(g.noten.map((n) => [n.ton, n])).values()];
    if (toene.length < 2) continue;
    const auf = toene, ab = [...toene].reverse();
    const folge = modus === 'down' ? ab : modus === 'updown' ? [...auf, ...ab.slice(1, -1)] : auf;
    const zahl = Math.max(1, Math.round((g.ende - g.beat) / schritt - EPS));
    for (let i = 0; i < zahl; i++) {
      const q = folge[i % folge.length];
      neu.push({ beat: runde(g.beat + i * schritt), laenge: schritt, ton: q.ton, vel: q.vel });
    }
    loeschen.push(...g.noten.map((n) => n.id));
  }
  return { loeschen, neu };
}

// ---------- which key fits ----------
// The keys that fit a note list, best first: [{ grundton, skala, anteil }] with `anteil` = the share of the sounding time that lies in the key (0..1).
// Keys with the same pitches (A minor, C major, D dorian ...) are told apart by the root: how long it sounds, whether the lowest note of the first chord
// and a note of the last chord are the root; then by the order of SKALEN. An empty list gives no key.
export function passendeTonarten(noten, anzahl = 5) {
  if (!noten.length) return [];
  const gewicht = new Array(12).fill(0);
  let summe = 0;
  for (const n of noten) { const w = Math.max(n.laenge, 0.0625); gewicht[pk(n.ton)] += w; summe += w; }
  const gruppen = akkordGruppen(noten);
  const ersterTief = pk(gruppen[0].noten[0].ton), letzte = new Set(gruppen[gruppen.length - 1].noten.map((n) => pk(n.ton)));
  const aus = [];
  for (const skala of SUCH_SKALEN) {
    for (let grundton = 0; grundton < 12; grundton++) {
      const k = klassen({ grundton, skala });
      let drin = 0;
      for (const c of k) drin += gewicht[c];
      const wurzel = gewicht[grundton] / summe + (ersterTief === grundton ? 0.5 : 0) + (letzte.has(grundton) ? 0.25 : 0);
      aus.push({ grundton, skala, anteil: runde(drin / summe), wurzel });
    }
  }
  aus.sort((a, b) => b.anteil - a.anteil || b.wurzel - a.wurzel || SUCH_SKALEN.indexOf(a.skala) - SUCH_SKALEN.indexOf(b.skala));
  return aus.slice(0, anzahl).map(({ grundton, skala, anteil }) => ({ grundton, skala, anteil }));
}
