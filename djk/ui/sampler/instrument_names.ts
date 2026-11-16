// Sample player stage 2, strand S: reading a folder as a multisample instrument, the pure part. The file name reader (note, velocity layer, take, variant
// tokens), the choice of the variant, the octave convention, the key ranges and the velocity ranges. No file is touched here; the pitch detection that decides
// the octave convention and the decoding live in instrument.ts.
import { AUDIO_ENDUNG } from './file.ts';

export const MIN_NOTEN = 3;
/** The engine holds 1..=1024 zones per node. */
export const ZONEN_MAX = 1024;
/** Keys the lowest note reaches down and the highest note reaches up. */
export const REICHWEITE = 12;

const DYNAMIK = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];
const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 } as const;
const NOTE = /^([a-g])([#bs]?)(-?\d{1,2})$/i;
const NOTE_OHNE_ZIFFER = /^[a-g][#b]$/i;
const ZIFFER = /^-?\d{1,2}$/;

export type Lage = { schluessel: number; text: string };
/** What the name of one file says. `klasse` is the semitone of the note name inside its octave (0..11, B# = 12, Cb = -1 are kept as written), `oktave` the
 *  number in the name; `rest` are the tokens that are neither note, layer nor take. */
export type DateiLese = { name: string; klasse: number | null; oktave: number | null; lage: Lage | null; take: number | null; rest: string[] };

/** The MIDI note of a name under an octave convention: `versatz` 1 is C4 = 60 (scientific), 2 is C3 = 60. */
export const noteVon = (k: number, oktave: number, versatz: 1 | 2): number => 12 * (oktave + versatz) + k;

function teile(basis: string): string[] {
  const aus: string[] = [];
  for (const t of basis.split(/[ _.]+/).filter((x) => x !== '')) {
    if (!t.includes('-') || NOTE.test(t)) { aus.push(t); continue; }
    for (const u of t.split('-').filter((x) => x !== '')) aus.push(u);
  }
  return aus;
}

/** Reads the tokens of a file name (separated by space, `_`, `.` and `-`): `rr<n>` is the take, `vl<n>`, `v<n>` or a dynamic mark (ppp pp p mp mf f ff fff)
 *  the velocity layer, the first `C3`, `F#2`, `Gs4`, `Bb1`, `A#-1` (or `A# 1`, a sharp or flat followed by its octave as the next token) the note. */
export function leseInstrumentDateiname(name: string): DateiLese {
  const basis = name.replace(AUDIO_ENDUNG, '');
  const t = teile(basis);
  let klasse: number | null = null, oktave: number | null = null, lage: Lage | null = null, take: number | null = null;
  const rest: string[] = [];
  for (let i = 0; i < t.length; i++) {
    const x = t[i];
    let m: RegExpExecArray | null;
    if (take === null && (m = /^rr(\d{1,3})$/i.exec(x))) { take = Number(m[1]); continue; }
    if (lage === null && (m = /^vl?(\d{1,3})$/i.exec(x))) { lage = { schluessel: 100 + Number(m[1]), text: x.toLowerCase() }; continue; }
    if (lage === null && DYNAMIK.includes(x.toLowerCase())) { lage = { schluessel: DYNAMIK.indexOf(x.toLowerCase()), text: x.toLowerCase() }; continue; }
    if (klasse === null && (m = NOTE.exec(x))) {
      klasse = PC[m[1].toLowerCase() as keyof typeof PC] + (m[2] === '#' || m[2].toLowerCase() === 's' ? 1 : m[2] === 'b' ? -1 : 0);
      oktave = Number(m[3]); continue;
    }
    if (klasse === null && NOTE_OHNE_ZIFFER.test(x) && i + 1 < t.length && ZIFFER.test(t[i + 1])) {
      klasse = PC[x[0].toLowerCase() as keyof typeof PC] + (x[1] === '#' ? 1 : -1);
      oktave = Number(t[i + 1]); i++; continue;
    }
    rest.push(x);
  }
  return { name, klasse, oktave, lage, take, rest };
}

export type Eintrag = DateiLese & { rel: string };
export type Analyse = {
  /** The files of the chosen variant that carry a note name, in the order of the zone table (note, layer, take, name). */
  eintraege: Eintrag[];
  /** Distinct notes (the same under both octave conventions), distinct layers, most takes of one note and layer, files used. */
  noten: number; lagen: number; takes: number; dateien: number;
  /** The labels of the variants that were not chosen. */
  varianten: string[];
};

/** Reads the files of one folder (`rel` is what the zone table keeps, `name` what the reader parses): leaves out files without a note name, splits the rest into
 *  variants by their other tokens (the tokens every file has do not count), takes the variant with the most files (the first in name order on a tie) and
 *  names the others. */
export function analysiereDateien(dateien: { name: string; rel: string }[]): Analyse {
  const mit = dateien.map((d) => ({ ...leseInstrumentDateiname(d.name), rel: d.rel })).filter((e) => e.klasse !== null);
  const gemein = new Set<string>(mit.length > 0 ? mit[0].rest : []);
  for (const e of mit) for (const x of [...gemein]) if (!e.rest.includes(x)) gemein.delete(x);
  const label = (e: Eintrag): string => e.rest.filter((x) => !gemein.has(x)).join(' ');
  const gruppen = new Map<string, Eintrag[]>();
  for (const e of mit) { const k = label(e).toLowerCase(); const g = gruppen.get(k); if (g) g.push(e); else gruppen.set(k, [e]); }
  let besteK = '', beste: Eintrag[] = [];
  for (const [k, g] of gruppen) if (g.length > beste.length) { besteK = k; beste = g; }
  const varianten = [...gruppen.entries()].filter(([k]) => k !== besteK).map(([, g]) => label(g[0]) || 'plain');
  const eintraege = [...beste].sort((a, b) => (a.klasse! + 12 * a.oktave!) - (b.klasse! + 12 * b.oktave!) || (a.lage?.schluessel ?? 0) - (b.lage?.schluessel ?? 0)
    || (a.take ?? 0) - (b.take ?? 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const noten = new Set(eintraege.map((e) => e.klasse! + 12 * e.oktave!));
  const lagen = new Set(eintraege.map((e) => e.lage?.schluessel ?? -1));
  const proLage = new Map<string, number>();
  for (const e of eintraege) { const k = `${e.klasse! + 12 * e.oktave!}/${e.lage?.schluessel ?? -1}`; proLage.set(k, (proLage.get(k) ?? 0) + 1); }
  return { eintraege, noten: noten.size, lagen: lagen.size, takes: Math.max(0, ...proLage.values()), dateien: eintraege.length, varianten };
}

/** What a folder listing says about a folder: null when it does not read as an instrument (fewer than 3 different notes). */
export function ordnerAlsInstrumentKurz(dateien: { name: string; rel: string }[]): { noten: number; lagen: number; takes: number; dateien: number; varianten?: string[] } | null {
  const a = analysiereDateien(dateien);
  if (a.noten < MIN_NOTEN) return null;
  return { noten: a.noten, lagen: a.lagen, takes: a.takes, dateien: a.dateien, ...(a.varianten.length > 0 ? { varianten: a.varianten } : {}) };
}

/** 1..127 split evenly over `n` layers: the `i`-th (0-based, soft to loud) gets [vlo, vhi]. */
export function geteilteAnschlaege(n: number, i: number): [number, number] {
  return [1 + Math.floor(i * 127 / n), Math.floor((i + 1) * 127 / n)];
}

export type ZoneLese = { rel: string; grund: number; lo: number; hi: number; vlo: number; vhi: number; lage?: string; rr?: number };

/** The zone table of an analysis under an octave convention. A file whose note falls outside 0..127 is left out. Every note covers the keys up to the midpoint
 *  to its neighbours (the lower note takes the middle key), the lowest reaches 12 keys down and the highest 12 keys up, inside 0..127. The layers a note has
 *  split 1..127 evenly; takes of one note and layer get the same ranges. */
export function baueZonenTabelle(a: Analyse, versatz: 1 | 2): ZoneLese[] {
  const mit = a.eintraege.map((e) => ({ e, note: noteVon(e.klasse!, e.oktave!, versatz) })).filter((x) => x.note >= 0 && x.note <= 127);
  const noten = [...new Set(mit.map((x) => x.note))].sort((p, q) => p - q);
  const lo = new Map<number, number>(), hi = new Map<number, number>();
  noten.forEach((n, i) => {
    lo.set(n, i === 0 ? Math.max(0, n - REICHWEITE) : Math.floor((noten[i - 1] + n) / 2) + 1);
    hi.set(n, i === noten.length - 1 ? Math.min(127, n + REICHWEITE) : Math.floor((n + noten[i + 1]) / 2));
  });
  const aus: ZoneLese[] = [];
  for (const n of noten) {
    const dieNote = mit.filter((x) => x.note === n);
    const lagen = [...new Set(dieNote.map((x) => x.e.lage?.schluessel ?? -1))].sort((p, q) => p - q);
    lagen.forEach((l, li) => {
      const [vlo, vhi] = geteilteAnschlaege(lagen.length, li);
      for (const x of dieNote.filter((y) => (y.e.lage?.schluessel ?? -1) === l)) {
        aus.push({ rel: x.e.rel, grund: n, lo: lo.get(n)!, hi: hi.get(n)!, vlo, vhi, ...(x.e.lage ? { lage: x.e.lage.text } : {}), ...(x.e.take !== null ? { rr: x.e.take } : {}) });
      }
    });
  }
  return aus;
}
