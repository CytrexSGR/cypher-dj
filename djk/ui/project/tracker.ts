// Tracker view (stage 1): the project marker `tracker` and its limits. A project with the marker shows the tracker view; the marker is
// an ordinary optional /2 field, never set together with `live` or `werkbank`, and never written when absent.
import type { Note, Projekt } from './model.ts';   // type only: model.ts imports this file at runtime

export type TrackerAbschnitt = { id: string; name?: string; laenge_beats: number };
// lpb / ticks: view and effect timing settings, absent = the default (4 / 6); abschnitte: the section list, absent = the default list
export type TrackerMarke = { schema: 1; lpb?: number; ticks?: number; abschnitte?: TrackerAbschnitt[] };

export const LPB_WERTE: readonly number[] = [2, 3, 4, 6, 8, 12, 16];
export const TICKS_MIN = 1;
export const TICKS_MAX = 24;
export const ABSCHNITTE_MAX = 256;
export const ABSCHNITT_BEATS_MAX = 1024;
export const ABSCHNITT_ID = /^a[0-9]{1,6}$/;
export const ABSCHNITT_NAME_MAX = 40;

const FELDER = ['schema', 'lpb', 'ticks', 'abschnitte'];
const ABSCHNITT_FELDER = ['id', 'name', 'laenge_beats'];
const istObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const fehler = (text: string): { grund: string; text: string } => ({ grund: 'tracker', text: `tracker: ${text}` });

// A length is valid when it is a whole multiple of 1/48 beat (D10: every LPB of the list gives whole rows)
const ganzeAchtundvierzigstel = (x: number): boolean => Math.abs(x * 48 - Math.round(x * 48)) < 1e-9;

// The check of a marker (null = fine), as {grund, text}: grund is always `tracker`, text says what is expected.
export function trackerPruefung(x: unknown): { grund: string; text: string } | null {
  if (!istObj(x)) return fehler('an object {schema: 1} expected');
  const extra = Object.keys(x).find((k) => !FELDER.includes(k));
  if (extra !== undefined) return fehler(`unknown field ${extra}`);
  if (x.schema !== 1) return fehler('schema: 1 expected');
  if ('lpb' in x && !(typeof x.lpb === 'number' && LPB_WERTE.includes(x.lpb))) {
    return fehler(`lpb: one of ${LPB_WERTE.join(', ')} expected (absent for the default)`);
  }
  if ('ticks' in x && !(Number.isInteger(x.ticks) && (x.ticks as number) >= TICKS_MIN && (x.ticks as number) <= TICKS_MAX)) {
    return fehler(`ticks: whole number ${TICKS_MIN}..${TICKS_MAX} expected (absent for the default)`);
  }
  if ('abschnitte' in x) {
    const l = x.abschnitte;
    if (!Array.isArray(l) || l.length < 1 || l.length > ABSCHNITTE_MAX) {
      return fehler(`abschnitte: list of 1..${ABSCHNITTE_MAX} sections expected (absent for the default list)`);
    }
    const ids = new Set<string>();
    for (let i = 0; i < l.length; i++) {
      const a: unknown = l[i], wo = `abschnitte[${i}]`;
      if (!istObj(a)) return fehler(`${wo}: an object {id, laenge_beats} expected`);
      const f = Object.keys(a).find((k) => !ABSCHNITT_FELDER.includes(k));
      if (f !== undefined) return fehler(`${wo}: unknown field ${f}`);
      if (typeof a.id !== 'string' || !ABSCHNITT_ID.test(a.id)) return fehler(`${wo}.id: an id like a1 expected`);
      if (ids.has(a.id)) return fehler(`${wo}.id: ${a.id} is used twice`);
      ids.add(a.id);
      if (typeof a.laenge_beats !== 'number' || !Number.isFinite(a.laenge_beats) || a.laenge_beats <= 0 || a.laenge_beats > ABSCHNITT_BEATS_MAX) {
        return fehler(`${wo}.laenge_beats: a number of beats > 0 and <= ${ABSCHNITT_BEATS_MAX} expected`);
      }
      if (!ganzeAchtundvierzigstel(a.laenge_beats)) return fehler(`${wo}.laenge_beats: a whole multiple of 1/48 beat expected`);
      if ('name' in a && !(typeof a.name === 'string' && a.name.length >= 1 && a.name.length <= ABSCHNITT_NAME_MAX)) {
        return fehler(`${wo}.name: text of 1..${ABSCHNITT_NAME_MAX} characters expected (absent for none)`);
      }
    }
  }
  return null;
}

export const istTracker = (p: Projekt): boolean => p.tracker !== undefined;

// ---- templates (stage 4, D24) ---------------------------------------------------------------------------------------------------------
// A template is a tracker project with a short start pattern: one section of 64 rows (16 beats at the default LPB 4), 125 BPM, A minor,
// i - VI - III - VII (Am F C G), four tracks. The music is written as tables of rows; a row is a sixteenth (0.25 beat).
type VorlagenNote = Omit<Note, 'id'>;
type VorlagenFx = { beat: number; spalte: 0; code: string; wert: number };
export type TrackerVorlage = {
  id: string; name: string; text: string; tempo_bpm: number;
  fader_db?: number;   // level of every track, default -6
  spuren: { name: string; graph: string; pan?: number; noten: VorlagenNote[]; fx: VorlagenFx[] }[];
};

const ZEILE = 0.25;                         // beats per row at LPB 4
const TAKT = 16;                            // rows per bar
const STUFEN: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
// the piano roll's naming (D1): 'C-3' = MIDI 60
const ton = (name: string): number => (Number(name.slice(-1)) + 2) * 12 + STUFEN[name.slice(0, -2)];

// the four chords, one per bar: bass root, arpeggio root and its ARP value (3,7 = minor; 4,7 = major)
const AKKORDE = [
  { bass: 'A-1', arp: 'A-2', arpWert: 0x37 },   // Am
  { bass: 'F-1', arp: 'F-2', arpWert: 0x47 },   // F
  { bass: 'C-2', arp: 'C-3', arpWert: 0x47 },   // C
  { bass: 'G-1', arp: 'G-2', arpWert: 0x47 },   // G
];
// bass figure of one bar: [row in the bar, length in rows, semitones above the root]
const BASS_FIGUR: [number, number, number][] = [[0, 2, 0], [4, 2, 0], [6, 2, 12], [8, 2, 0], [12, 2, 0], [14, 2, 7]];
// melody: [row, note, length in rows]
const MELODIE: [number, string, number][] = [
  [0, 'A-3', 4], [4, 'C-4', 2], [6, 'B-3', 2], [8, 'A-3', 4], [12, 'E-3', 4],                               // Am
  [16, 'F-3', 4], [20, 'A-3', 2], [22, 'C-4', 2], [24, 'A-3', 4], [28, 'F-3', 2], [30, 'G-3', 2],           // F
  [32, 'C-4', 4], [36, 'E-4', 2], [38, 'D-4', 2], [40, 'C-4', 4], [44, 'G-3', 4],                           // C
  [48, 'D-4', 4], [52, 'B-3', 2], [54, 'G-3', 2], [56, 'B-3', 4], [60, 'A-3', 4],                           // G
];
const MELODIE_VIB = [0, 8, 12, 16, 24, 32, 40, 44, 48, 56];   // starts of the long notes: VIB 44 on each of their 4 rows
const MELODIE_SLU = [30, 31];                                  // SLU 04 under the G of bar 2: it rises toward the C of bar 3
const MELODIE_GLD = 60;                                        // GLD 08: the last A is reached by a glide from the B before it
// drums, one character per row (k kick, s snare, h hat, . empty); every hit is a short note of one row
const SCHLAG_TAKT = 'k.h.s.h.k.h.s.h.';
const SCHLAG_FILL = 'k.h.s.h.k.h.s.ss';                       // last bar: snare roll at the end
const SCHLAG: Record<string, [string, number]> = { k: ['C-1', 120], s: ['C-3', 105], h: ['C-4', 70] };

type Plaetze = [number, number, number, number] | null;
// The four patterns: bass, arpeggio, melody, drums. `plaetze` (amiga only): the slot of each track, written as Note.platz.
function startMuster(plaetze: Plaetze): { noten: VorlagenNote[]; fx: VorlagenFx[] }[] {
  const note = (reihe: number, t: number, laenge: number, vel: number, spur: number): VorlagenNote =>
    ({ beat: reihe * ZEILE, laenge: laenge * ZEILE, ton: t, vel, ...(plaetze !== null ? { platz: plaetze[spur] } : {}) });
  const fx = (reihe: number, code: string, wert: number): VorlagenFx => ({ beat: reihe * ZEILE, spalte: 0, code, wert });
  const bass = AKKORDE.flatMap((a, t) => BASS_FIGUR.map(([r, l, h]) => note(t * TAKT + r, ton(a.bass) + h, l, 110, 0)));
  const arp = AKKORDE.flatMap((a, t) => Array.from({ length: TAKT / 2 }, (_, k) => note(t * TAKT + 2 * k, ton(a.arp), 2, 80, 1)));
  const arpFx = AKKORDE.flatMap((a, t) => Array.from({ length: TAKT }, (_, r) => fx(t * TAKT + r, 'ARP', a.arpWert)));
  const lead = MELODIE.map(([r, n, l]) => note(r, ton(n), l, 100, 2));
  const leadFx = [
    ...MELODIE_VIB.flatMap((r) => [0, 1, 2, 3].map((k) => fx(r + k, 'VIB', 0x44))),
    ...MELODIE_SLU.map((r) => fx(r, 'SLU', 0x04)), fx(MELODIE_GLD, 'GLD', 0x08),
  ].sort((x, y) => x.beat - y.beat);
  const reihen = SCHLAG_TAKT.repeat(3) + SCHLAG_FILL;
  const schlag = [...reihen].flatMap((c, r) => (c === '.' ? [] : [note(r, ton(SCHLAG[c][0]), 1, SCHLAG[c][1], 3)]));
  return [{ noten: bass, fx: [] }, { noten: arp, fx: arpFx }, { noten: lead, fx: leadFx }, { noten: schlag, fx: [] }];
}

const musterMit = (namen: string[], graphen: string[], pans: (number | undefined)[], plaetze: Plaetze): TrackerVorlage['spuren'] =>
  startMuster(plaetze).map((m, i) => ({ name: namen[i], graph: graphen[i], ...(pans[i] !== undefined ? { pan: pans[i] } : {}), ...m }));

// amiga: Ch 1 bass (slot 3 saw), Ch 2 arpeggio (slot 1 square), Ch 3 melody (slot 2 triangle), Ch 4 drums (slot 4 noise burst); D24: pans -1, +1, +1, -1
export const TRACKER_VORLAGEN: readonly TrackerVorlage[] = [{
  id: '8bit-4kanal', name: '8-BIT · 4 CHANNELS', text: 'Four amiga channels (bass, arpeggio, melody, drums), A minor, 125 BPM, 64 rows',
  tempo_bpm: 125,
  fader_db: -9,   // four sample voices sum to a peak that the master limiter pulled down by 2 dB at -6 dB (offline render 2026-11-19); at -9 dB it stays idle
  spuren: musterMit(['Ch 1', 'Ch 2', 'Ch 3', 'Ch 4'], ['amiga', 'amiga', 'amiga', 'amiga'], [-1, 1, 1, -1], [3, 1, 2, 4]),
}, {
  id: 'chip', name: 'CHIP', text: 'Two pulse voices (arpeggio, lead), triangle bass and noise drums, A minor, 125 BPM, 64 rows',
  tempo_bpm: 125,
  spuren: (() => {   // Pulse 1 = lead, Pulse 2 = arpeggio, Triangle = bass, Noise = drums
    const m = musterMit(['Triangle', 'Pulse 2', 'Pulse 1', 'Noise'], ['chip-dreieck', 'chip-puls', 'chip-puls', 'chip-rauschen'], [], null);
    return [m[2], m[1], m[0], m[3]];
  })(),
}];

export const trackerVorlageVon = (id: unknown): TrackerVorlage | null =>
  typeof id === 'string' ? TRACKER_VORLAGEN.find((v) => v.id === id) ?? null : null;
export const trackerVorlagenListe = (): { id: string; name: string; text: string }[] => TRACKER_VORLAGEN.map(({ id, name, text }) => ({ id, name, text }));

// The command list that turns an empty tracker project into the template: tempo, loop over the section, the section list (abschnitt_laenge to the
// length it already has writes the list a1 = 16 beats), then per track the instrument track (-6 dB, pan), its clip with the notes and the effects.
// The ids are the ones a fresh project hands out (s1.., c1..): the template is only ever applied to a project that was just created.
export function trackerVorlageBefehle(v: TrackerVorlage): unknown[] {
  const befehle: unknown[] = [
    { befehl: 'tempo_setzen', bpm: v.tempo_bpm },
    { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 16 },
    { befehl: 'abschnitt_laenge', id: 'a1', zeilen: 64 },
  ];
  v.spuren.forEach((s, i) => {
    const spur = `s${i + 1}`, clip = `c${i + 1}`;
    befehle.push(
      { befehl: 'spur_neu', art: 'instrument', name: s.name, geraet: { art: 'intern', name: 'bk', graph: s.graph, parameter: {} } },
      { befehl: 'spur_aendern', spur_id: spur, fader_db: v.fader_db ?? -6, ...(s.pan !== undefined ? { pan: s.pan } : {}) },
      { befehl: 'clip_neu', spur_id: spur, art: 'midi', start_beat: 0, laenge_beats: 16, name: s.name, noten: s.noten },
      ...(s.fx.length > 0 ? [{ befehl: 'fx_setzen', clip_id: clip, eintraege: s.fx }] : []),
    );
  });
  return befehle;
}
