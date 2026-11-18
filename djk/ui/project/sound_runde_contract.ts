// FIND SOUND, part 1 (variant round for knob values): the contract between the pure round logic (sound_runde.ts), the request handling
// (areas/proj/sound_runde.ts), the Workbench window (public/werkbank/sound_runde.js) and the hand tool klang_runde.
// Design: docs/superpowers/specs/2026-11-17-find-sound-design.md. No logic here beyond constants and the tree shape check.

// The three levels of the round are three levels of audibility, not three step sizes: a candidate is a place only when its audibility D
// (hoerDiff in sound_runde.ts) to A reaches the target of the level. The keys stay fein / normal / grob (request, memory, stored window choice).
// Calibration on the listening verdict of 2026-11-18 (module base, track fm-bass, one bar with a 909 kick, studio monitors): the old normal step
// (Brightness 1 -> 1.36, Decay 1 -> 0.56, Drive 6 -> 3.84) "can hardly be heard", the old coarse step (Brightness 1 -> 0.3, Decay 1 -> 3.09, Drive 6 -> 10.2)
// "yes, a little". The fixture is recorded on the real module (pattern and knob values of project.json of 2026-11-18, tests/support/sound_runde_record.mjs);
// its positive controls pass (highs of the normal Brightness step +5.99 dB, levels -0.99, +1.35, +1.33 dB). D of the six candidates with k = 0.34:
// normal 1.01 / 0.61 / 0.22 (Brightness, Decay, Drive), coarse 1.97 / 1.00 / 0.50. HOER.k sets the median D of the three coarse candidates to 1.0;
// subtle = 1.2 lies above the strongest old normal step (1.01), so those are never offered, and the median coarse step sits at 0.83 of it;
// clear = default = 2.9 is 1.47 x the strongest old coarse step (1.97); strong = 4.6. The bands (target to UEBERSCHUSS x target) of the levels do not overlap.
// KNOWN LIMIT: across knobs the order is not the verdict's: the normal Brightness step (1.01, a +7 dB rise in a loud mid band) measures above the coarse
// Drive step (0.50, highs that sit 50 to 90 dB under the loudest band of the bass alone) and equal to the coarse Decay step. No weight of the spectral term
// (loudness exponent 0.05 to 1.2, floor 40 to 80 dB) fixes it; the owner heard the bass with the kick, which masks part of what the bass alone shows.
// Per knob the order is right (normal below coarse). A knob that stays under the target of the level at its range end but reaches ZIELE.fein is a range-end
// place (Platz.anschlag), see auffuellen in sound_runde.ts. Test: tests/klang_runde_hoerbar.test.mjs.
export const ZIELE = { fein: 1.2, normal: 2.9, grob: 4.6 } as const;
export type Schritt = keyof typeof ZIELE;
export const STUFEN_NAME: Record<Schritt, 'subtle' | 'clear' | 'strong'> = { fein: 'subtle', normal: 'clear', grob: 'strong' };
export const istSchritt = (x: unknown): x is Schritt => typeof x === 'string' && Object.hasOwn(ZIELE, x);

/** Constants of the audibility measure D: `alpha` loudness exponent (power of the level difference), `boden` bands further than this many dB below
 *  the loudest band of A do not count, the `s_*` are the units of the spectral share (percent of A's loudness that changed), the effective length
 *  and the level, `k` the one global factor set by the calibration. */
export const HOER = { alpha: 0.3, boden: 60, s_spek: 6, s_fuelle: 1.5, s_pegel: 6, k: 0.34 } as const;

/** Marker at the end of the text of a place at the range end of its knob, and the state text of a round in which no knob is audible. */
export const ANSCHLAG_TEXT = 'max';
export const KEIN_KNOPF_TEXT = 'no knob of this sound makes an audible difference on this pattern';

/** One measurement as the round needs it: the features and the 30 third-octave levels (dB) of the mean spectrum (silent: 30 x -200). */
export interface Messung { m: Merkmale; bild: readonly number[] }

/** Level match of the audition: the gain is -pegel_db, at most this many dB either way, and a difference under AUSGLEICH_MIN_DB is not matched. */
export const AUSGLEICH_MAX_DB = 12, AUSGLEICH_MIN_DB = 0.2;

export const PLAETZE = ['A', 'B', 'C', 'D'] as const;
export type PlatzName = typeof PLAETZE[number];
export const istPlatz = (x: unknown): x is PlatzName => typeof x === 'string' && (PLAETZE as readonly string[]).includes(x);

/** The measured features of one rendered sound. Units: hell octaves (log2 Hz), everything else dB. `fuelle` is the effective length of the sound
 *  in the range: 0 dB = it sounds throughout at one level, -3 dB = half of the time, lower = shorter. */
export const MERKMALE = ['hell', 'sub', 'hoehen', 'bewegung', 'fuelle', 'breite', 'punch', 'pegel'] as const;
export type MerkmalName = typeof MERKMALE[number];
export type Merkmale = Record<MerkmalName, number>;

/** One unit of effect per feature (about one clearly audible step). First estimates, tuned on the target. */
export const SKALA: Merkmale = { hell: 0.15, sub: 2, hoehen: 3, bewegung: 2, fuelle: 1, breite: 3, punch: 2, pegel: 1.5 };
/** The words of a variant: [feature rose, feature fell]. `pegel` never names a variant. */
export const WORTE: Record<Exclude<MerkmalName, 'pegel'>, [string, string]> = {
  hell: ['brighter', 'darker'], sub: ['more sub', 'less sub'], hoehen: ['more highs', 'fewer highs'], bewegung: ['more movement', 'steadier'],
  fuelle: ['longer', 'shorter'], breite: ['wider', 'narrower'], punch: ['punchier', 'smoother'],
};
/** A feature names a place only when its effect is at least this (in SKALA units) and at least half of the strongest one. */
export const WORT_MIN = 0.5;
/** Two accepted candidates must point in different directions: cosine of their effect vectors below this. */
export const COS_GLEICH = 0.85;
/** A round renders at most this many variants (every try of a knob is one render), in batches of STAPEL; while no audible one was found it goes on
 *  up to MAX_MESSUNGEN_LEER (a drum machine whose pattern plays one voice has many knobs that change nothing). */
export const MAX_MESSUNGEN = 24;
export const MAX_MESSUNGEN_LEER = 48;
export const STAPEL = 4;
/** The ladder of the step of a knob, as shares of its travel (1 = the range end). A try that stays under the target of the level is followed by the
 *  next rung; at most MAX_STUFEN_KNOPF tries per knob and direction, and the last allowed try is always the range end. The first try of a knob
 *  with no remembered sensitivity is rung START_RUNGE (index). */
export const RUNGEN = [0.18, 0.35, 0.6, 1] as const;
export const MAX_STUFEN_KNOPF = 3;
export const START_RUNGE = 1;
/** The ladder only widens; a try whose D is over UEBERSCHUSS x the target is too strong for its level (a sensitive knob would give the same place at
 *  subtle, clear and strong). The round then narrows that knob's step to aim at ZIEL_FAKTOR x the target (D is about linear in the travel for small
 *  moves), at most down to MIN_WEG. The too strong try stays as a fall-back for the fill-up when the narrower one does not reach the target. A place
 *  therefore has D between 1 and 1.5 x the target (up to 1.5 x only where the knob allows), so the three levels do not overlap (1.5 < 2, 3 < 3.5). */
export const UEBERSCHUSS = 1.5;
export const ZIEL_FAKTOR = 1.2;
/** A move of less than this share of the travel is no variant (the edge of a knob only goes inward). */
export const MIN_WEG = 0.09;
/** The round renders at most this many beats from the start of its range. */
export const MAX_BEATS = 16;
/** A candidate that is silent or this many dB quieter than A is no sound variant (a level, gate or mix knob turned down). */
export const PEGEL_WEG = 20;
/** Order value of a candidate whose sensitivity (D per unit of travel, remembered from earlier rounds) is not known yet: known sensitive ones first,
 *  known weak ones last. */
export const VORWISSEN_UNBEKANNT = 5;

/** COMPARE: one bar of A, one bar of the selected place, switching on the bar line of the open project. */
export interface Vergleich { an: boolean; platz: PlatzName | null; klingt: PlatzName; ab_beat: number | null }
/** The core plan name of the scheduled COMPARE parts (at most 31 characters). */
export const VERGLEICH_PLAN = 'klang';
/** COMPARE ends by itself when the round got no request for this long (a dead page must not alternate until the idle end). */
export const VERGLEICH_TOTMANN_MS = 30_000;

/** One place of the round. A is the sound as the project has it (`param` null). */
export interface Platz {
  platz: PlatzName;
  /** The moved knob (`k<n>`), null for A. */
  param: string | null;
  /** Label of the knob from the parameter table, '' for A. */
  label: string;
  /** Normalised knob value of this place, null for A. */
  wert: number | null;
  /** Display values before and after ('' for A), e.g. '420' and '610'. */
  von_text: string;
  nach_text: string;
  /** The word of the strongest feature ('current' for A). */
  wort: string;
  /** Audibility D of the difference to A (0 for A; 1 = subtle level, see ZIELE). */
  staerke: number;
  /** Level difference to A in dB (0 for A): the true difference, whatever the audition plays. */
  pegel_db: number;
  /** The gain in dB the audition adds to the track fader so the place sounds at the level of A (0 for A and when level match does not apply). A pick never
   *  writes it. */
  ausgleich_db: number;
  merkmale: Merkmale;
  /** The whole line the window shows, e.g. 'brighter · Cutoff 420 → 610'; ends with ' · max' for a place at the range end of its knob. */
  text: string;
  /** True only for a place at the range end of its knob that stays under the target of the level but is audible at the lowest level (D >= the subtle
   *  target): the strongest this knob can do, not the level that was asked for. Absent otherwise. */
  anschlag?: boolean;
}

export type RundeZustand = 'misst' | 'fertig' | 'veraltet' | 'fehler';

/** The state of the round (answer of POST /proj/klang/runde, GET /proj/klang/runde, POST /proj/klang/hoeren). */
export interface RundeLage {
  /** Number of this round; every start gives a new one. Requests that act on a round send it back, a stale number is refused (runde_veraltet). */
  runde: number;
  spur_id: string;
  spur_name: string;
  graph: string;
  /** Project revision the round was measured on. */
  rev: number;
  zustand: RundeZustand;
  schritt: Schritt;
  von_beat: number;
  bis_beat: number;
  /** `gemessen`: renders so far (A not counted, every widening try counts); `hoechstens`: the smaller of the budget (MAX_MESSUNGEN, or
   *  MAX_MESSUNGEN_LEER while nothing audible was found) and the renders planned so far (candidates plus widening tries). */
  fortschritt: { gemessen: number; hoechstens: number };
  /** The place the instrument plays right now. */
  aktiv: PlatzName;
  /** COMPARE: while `an`, the server alternates the audition between A and `platz` on every bar line; `klingt` is what sounds now (= `aktiv`),
   *  `ab_beat` the core beat of the bar line the next switch is scheduled for (null while none is pending). */
  vergleich: Vergleich;
  /** A first, then the accepted neighbours in the order they were found (0 to 4 entries; empty until A is measured). */
  plaetze: Platz[];
  /** The family tree of the track when its graph is the graph of the track, else null. */
  stammbaum: Stammbaum | null;
  /** The path of the tree from the root to the active node (wegVon); `zweige` = other branches of that node. Empty without a tree. */
  weg: { id: string; text: string; zweige: number }[];
  /** BACK has somewhere to go: the active node has a parent, or knobs were turned by hand since the active node. */
  zurueck_moeglich: boolean;
  /** With zustand 'fertig' and no place: no knob of the sound is audible (D under the subtle target even at its range end),
   *  KEIN_KNOPF_TEXT. Absent otherwise. */
  hinweis?: string;
  /** With zustand 'fehler': the refusal reason and its text. */
  grund?: string;
  text?: string;
}

/** Answer of POST /proj/klang/waehlen and /proj/klang/zurueck: the caller sends `befehle` to POST /proj/aendern with `rev` (the revision the plan was
 *  computed on; a project that moved on answers rev_veraltet and the caller starts a new round). */
export interface RundePlan { weg: 'proj'; rev: number; label: string; befehle: Record<string, unknown>[] }

// --- family tree (optional field `stammbaum` of a track) ---------------------------------------------------------------------------------------
export const STAMM_MAX_KNOTEN = 200;
export const STAMM_TEXT_MAX = 80;
export interface StammKnoten {
  /** 'n1', 'n2', ... unique within the tree. */
  id: string;
  /** null for the root (exactly one, the first node); a child names an earlier node. */
  eltern: string | null;
  /** Root: all knob values of the starting point. Child: the knobs that differ from the parent. Keys k1..k64, values 0..1. */
  werte: Record<string, number>;
  text: string;
}
export interface Stammbaum { graph: string; aktiv: string; knoten: StammKnoten[] }

const ID = /^n[1-9][0-9]{0,5}$/, KNOPF = /^k([1-9]|[1-5][0-9]|6[0-4])$/, GRAPH = /^[a-z0-9_-]{1,32}$/;

/** Shape check of a family tree; an empty list means valid. `wo` prefixes the messages. */
export function pruefeStammbaum(x: unknown, wo = 'stammbaum'): string[] {
  const f: string[] = [];
  if (!x || typeof x !== 'object' || Array.isArray(x)) return [`${wo}: an object is required`];
  const b = x as Record<string, unknown>;
  for (const k of Object.keys(b)) if (!['graph', 'aktiv', 'knoten'].includes(k)) f.push(`${wo}: unknown field ${k}`);
  if (typeof b.graph !== 'string' || !GRAPH.test(b.graph)) f.push(`${wo}.graph: a graph name is required`);
  if (!Array.isArray(b.knoten) || b.knoten.length < 1 || b.knoten.length > STAMM_MAX_KNOTEN) {
    return [...f, `${wo}.knoten: 1 to ${STAMM_MAX_KNOTEN} nodes are required`];
  }
  const ids = new Set<string>();
  b.knoten.forEach((y, i) => {
    const w = `${wo}.knoten[${i}]`;
    if (!y || typeof y !== 'object' || Array.isArray(y)) { f.push(`${w}: an object is required`); return; }
    const n = y as Record<string, unknown>;
    for (const k of Object.keys(n)) if (!['id', 'eltern', 'werte', 'text'].includes(k)) f.push(`${w}: unknown field ${k}`);
    if (typeof n.id !== 'string' || !ID.test(n.id)) f.push(`${w}.id: n1, n2, ... is required`);
    else if (ids.has(n.id)) f.push(`${w}.id: ${n.id} is used twice`);
    if (i === 0 ? n.eltern !== null : typeof n.eltern !== 'string' || !ids.has(n.eltern)) {
      f.push(`${w}.eltern: ${i === 0 ? 'the first node is the root (null)' : 'an earlier node is required'}`);
    }
    if (typeof n.id === 'string') ids.add(n.id);
    if (typeof n.text !== 'string' || n.text.length > STAMM_TEXT_MAX) f.push(`${w}.text: a text of at most ${STAMM_TEXT_MAX} characters is required`);
    if (!n.werte || typeof n.werte !== 'object' || Array.isArray(n.werte)) { f.push(`${w}.werte: an object is required`); return; }
    for (const [k, v] of Object.entries(n.werte as Record<string, unknown>)) {
      if (!KNOPF.test(k)) f.push(`${w}.werte: unknown knob ${k}`);
      else if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) f.push(`${w}.werte.${k}: a number from 0 to 1 is required`);
    }
  });
  if (typeof b.aktiv !== 'string' || !ids.has(b.aktiv)) f.push(`${wo}.aktiv: a node of the tree is required`);
  return f;
}
