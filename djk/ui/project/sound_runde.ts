// FIND SOUND, part 1: the pure round logic (features of a measurement, effect of a knob move, candidate order, acceptance, place texts,
// family tree operations). No I/O. Contract: sound_runde_contract.ts. Design: docs/superpowers/specs/2026-11-17-find-sound-design.md.
import {
  SKALA, WORTE, WORT_MIN, HOER, COS_GLEICH, PEGEL_WEG, VORWISSEN_UNBEKANNT, STAMM_MAX_KNOTEN, STAMM_TEXT_MAX, MERKMALE, RUNGEN, MAX_STUFEN_KNOPF, START_RUNGE,
  MIN_WEG, UEBERSCHUSS, ZIEL_FAKTOR, AUSGLEICH_MAX_DB, AUSGLEICH_MIN_DB, ZIELE, ANSCHLAG_TEXT,
} from './sound_runde_contract.ts';
import type { Merkmale, MerkmalName, Messung, Platz, PlatzName, Stammbaum, StammKnoten } from './sound_runde_contract.ts';
import type { Teilmessung } from './sound_measurement.ts';
import { terzVon } from './sound_contract.ts';

type Fuehrend = Exclude<MerkmalName, 'pegel'>;
const OHNE_PEGEL = MERKMALE.filter((n): n is Fuehrend => n !== 'pegel');
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const dbVon = (p: number): number => 10 * Math.log10(p);

const STILL: Merkmale = { hell: 0, sub: -60, hoehen: -60, bewegung: 0, fuelle: -40, breite: -40, punch: 0, pegel: -200 };

/** Reduces one measurement to the feature vector. A silent measurement gives the fixed vector. */
export function merkmale(t: Teilmessung): Merkmale {
  if (t.stumm) return { ...STILL };
  const hz = t.spektrum.hz, db = t.spektrum.mittel_db;
  let sum = 0, mitLog = 0, tief = 0, hoch = 0;
  for (let i = 0; i < hz.length; i++) {
    const p = 10 ** (db[i] / 10);
    sum += p; mitLog += p * Math.log2(hz[i]);
    if (hz[i] < 100) tief += p;
    if (hz[i] > 4000) hoch += p;
  }
  const anteilDb = (x: number): number => (sum > 0 ? Math.max(-60, dbVon(Math.max(x / sum, 1e-6))) : -60);
  const { bewegung, fuelle } = zeitMerkmale(t.spaltenTerz, t.spalten);
  return {
    hell: sum > 0 ? mitLog / sum : 0, sub: anteilDb(tief), hoehen: anteilDb(hoch), bewegung, fuelle,
    breite: clamp(t.stereo.breite_db, -40, 12), punch: t.crest_db, pegel: t.rms_db,
  };
}

// Movement and length from the third-octave picture (`spalten` columns of 30 dB cells, column after column).
// Movement is the change of the timbre: every column is taken relative to its own level, so a sound that only fades (a shorter or longer decay)
// does not move, a filter sweep, a pitch drop or a wavetable ride does. Columns more than 40 dB below the loudest one are not looked at.
function zeitMerkmale(zellen: Float32Array, spalten: number): { bewegung: number; fuelle: number } {
  if (!(spalten > 0)) return { bewegung: 0, fuelle: -40 };
  const pegel = new Float64Array(spalten), kraft = new Float64Array(spalten);
  let lauteste = -Infinity;
  for (let c = 0; c < spalten; c++) {
    let p = 0;
    for (let j = 0; j < 30; j++) p += 10 ** (zellen[c * 30 + j] / 10);
    kraft[c] = p; pegel[c] = dbVon(p);
    if (pegel[c] > lauteste) lauteste = pegel[c];
  }
  if (!Number.isFinite(lauteste)) return { bewegung: 0, fuelle: -40 };
  let summe = 0, anzahl = 0;
  for (let c = 1; c < spalten; c++) {
    if (pegel[c] < lauteste - 40 || pegel[c - 1] < lauteste - 40) continue;
    for (let j = 0; j < 30; j++) {
      // the share of the band in its column, floored 40 dB under the column level
      const a = Math.max(zellen[(c - 1) * 30 + j] - pegel[c - 1], -40), b = Math.max(zellen[c * 30 + j] - pegel[c], -40);
      if (Math.max(a, b) > -30) { summe += Math.abs(b - a); anzahl++; }
    }
  }
  // effective length: with the amplitude a of every column, (sum a)^2 / (n * sum a^2) is 1 for a sound that holds its level through the range,
  // 1/2 for one that sounds half of the time, and falls smoothly with a shorter decay (no threshold that a small change would not cross)
  let sa = 0, sa2 = 0;
  for (let c = 0; c < spalten; c++) { sa += Math.sqrt(kraft[c]); sa2 += kraft[c]; }
  const fuelle = sa2 > 0 ? Math.max(-40, dbVon(sa * sa / (spalten * sa2))) : -40;
  return { bewegung: anzahl ? summe / anzahl : 0, fuelle };
}

/** The 30 third-octave levels (dB) of the mean spectrum of a measurement; a silent one gives 30 x -200. */
export function bildVon(t: Teilmessung): readonly number[] {
  return t.stumm ? Array.from({ length: 30 }, () => -200) : terzVon(t.spektrum.mittel_db);
}

/** The audibility D of the difference between A and a variant: how much of A's loudness changes, not how many dB a band moves. The variant is
 *  compared at A's level (a pure level step is matched away, only a weak level term remains). Every band counts with its specific loudness
 *  relative to A's loudest band (10^(alpha*dB/10), nothing below `boden`), so a large change in a band where the sound has little energy stays
 *  small. The percent of A's loudness that changed is combined with the change of the effective length, the crest, the timbre movement, the stereo
 *  width and the level. `k` is a parameter for tests; the default is the calibrated HOER.k. Silent sounds give d 0 (the level rule of `taugt` and
 *  the silent-track refusal of the round deal with them). */
export type HoerTeile = Record<'spek' | 'fuelle' | 'punch' | 'bewegung' | 'breite' | 'pegel', number>;
export function hoerDiff(a: Messung, v: Messung, k: number = HOER.k): { d: number; teile: HoerTeile } {
  const teile = { spek: 0, fuelle: 0, punch: 0, bewegung: 0, breite: 0, pegel: 0 };
  if (a.m.pegel <= -150 || v.m.pegel <= -150) return { d: 0, teile };
  const shift = v.m.pegel - a.m.pegel, ref = Math.max(...a.bild);
  const n = (l: number): number => (l < ref - HOER.boden ? 0 : 10 ** (HOER.alpha * (l - ref) / 10));
  let diff = 0, summe = 0;
  for (let i = 0; i < a.bild.length; i++) {
    const na = n(a.bild[i]);
    diff += Math.abs(n(v.bild[i] - shift) - na); summe += na;
  }
  teile.spek = summe > 0 ? 100 * diff / summe / HOER.s_spek : 0;
  teile.fuelle = (v.m.fuelle - a.m.fuelle) / HOER.s_fuelle;
  teile.punch = (v.m.punch - a.m.punch) / (2 * SKALA.punch);
  teile.bewegung = (v.m.bewegung - a.m.bewegung) / (2 * SKALA.bewegung);
  teile.breite = (v.m.breite - a.m.breite) / (2 * SKALA.breite);
  teile.pegel = shift / HOER.s_pegel;
  let q = 0;
  for (const x of Object.values(teile)) q += x * x;
  return { d: k * Math.sqrt(q), teile };
}

/** Effect of a move: feature difference per scale unit, its strength and leading feature (all without the level), and the word. */
export function wirkung(a: Merkmale, v: Merkmale): { e: Merkmale; staerke: number; fuehrend: Fuehrend; wort: string } {
  const e = {} as Merkmale;
  for (const n of MERKMALE) e[n] = (v[n] - a[n]) / SKALA[n];
  let fuehrend: Fuehrend = OHNE_PEGEL[0], best = -1, q = 0;
  for (const n of OHNE_PEGEL) {
    q += e[n] * e[n];
    if (Math.abs(e[n]) > best) { best = Math.abs(e[n]); fuehrend = n; }
  }
  return { e, staerke: Math.sqrt(q), fuehrend, wort: WORTE[fuehrend][e[fuehrend] > 0 ? 0 : 1] };
}

/** The word of an effect that is not taken yet: the strongest feature whose word is free and whose effect is at least WORT_MIN and half of the
 *  strongest one. Null when there is none: such a candidate is not offered (a word is never repeated in one round). */
export function wortFrei(e: Merkmale, vergeben: ReadonlySet<string>): string | null {
  const reihe = OHNE_PEGEL.map((n) => ({ n, b: Math.abs(e[n]) })).sort((x, y) => y.b - x.b);
  const grenze = Math.max(WORT_MIN, 0.5 * reihe[0].b);
  for (const { n, b } of reihe) {
    const w = WORTE[n][e[n] > 0 ? 0 : 1];
    if (b >= grenze && !vergeben.has(w)) return w;
  }
  return null;
}

/** Cosine of two effect vectors without the level; 0 when one of them has length 0. */
export function kosinus(x: Merkmale, y: Merkmale): number {
  let xy = 0, xx = 0, yy = 0;
  for (const n of OHNE_PEGEL) { xy += x[n] * y[n]; xx += x[n] * x[n]; yy += y[n] * y[n]; }
  return xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0;
}

/** One try of a knob: `jetzt` the project value, `wert` the value tried, `weg` the share of the travel between them, `stufe` the index of the rung
 *  (RUNGEN) it came from, `versuch` the number of the try of this key (1 = first). */
export interface Kandidat { param: string; richtung: 1 | -1; wert: number; jetzt: number; weg: number; stufe: number; versuch: number }
export interface Gemessen extends Kandidat { merkmale: Merkmale; e: Merkmale; staerke: number; wort: string; anschlag?: boolean }

/** The key of a candidate: 'k3+' or 'k3-'. */
export const schluesselVon = (k: { param: string; richtung: 1 | -1 }): string => `${k.param}${k.richtung > 0 ? '+' : '-'}`;

/** The ladder of one knob and direction: the distinct clamped values of the rungs (rounded to 1e-4), moves under MIN_WEG dropped. The last entry is the
 *  range end (empty when even that is under MIN_WEG). `stufe` is the first rung that gives the value. */
export function stufenWerte(jetzt: number, richtung: 1 | -1): { wert: number; weg: number; stufe: number }[] {
  const aus: { wert: number; weg: number; stufe: number }[] = [];
  RUNGEN.forEach((rung, stufe) => {
    const wert = Math.round(clamp(jetzt + richtung * rung, 0, 1) * 1e4) / 1e4, weg = Math.round(Math.abs(wert - jetzt) * 1e4) / 1e4;
    if (weg >= MIN_WEG - 1e-9 && !aus.some((x) => x.wert === wert)) aus.push({ wert, weg, stufe });
  });
  return aus;
}

// A move of `weg` of the travel from `jetzt` in `richtung`, clamped and rounded like the ladder values; null when it is under MIN_WEG.
function schrittWert(jetzt: number, richtung: 1 | -1, weg: number): { wert: number; weg: number } | null {
  const wert = Math.round(clamp(jetzt + richtung * weg, 0, 1) * 1e4) / 1e4, w = Math.round(Math.abs(wert - jetzt) * 1e4) / 1e4;
  return w >= MIN_WEG - 1e-9 ? { wert, weg: w } : null;
}

// The narrower move that aims at ZIEL_FAKTOR x `schwelle` when `staerke` was reached with `weg` (linear in the travel), in whole hundredths (rounded
// up) but not under MIN_WEG; null when that is not narrower than `weg`.
function engerWeg(jetzt: number, richtung: 1 | -1, weg: number, staerke: number, schwelle: number): { wert: number; weg: number } | null {
  const ziel = Math.max(MIN_WEG, Math.ceil(100 * weg * ZIEL_FAKTOR * schwelle / staerke - 1e-9) / 100), s = schrittWert(jetzt, richtung, ziel);
  return s && s.weg < weg - 1e-9 ? s : null;
}

/** All one-knob moves in the order they are measured: known sensitive first, unknown next in rotated table order, known weak last. The first try of
 *  a key is the smallest rung that is predicted to reach `schwelle` from the remembered sensitivity (D per travel), the start rung without one; a key
 *  predicted to stay under half of the subtle target (ZIELE.fein) even at the range end is not listed (a knob that reaches only the subtle level
 *  at its range end is still a fallback place, so the memory must not drop it for a higher level). */
export function kandidaten(o: {
  tabelle: readonly { name: string; vorgabe: number }[]; werte: Readonly<Record<string, number>>; schwelle: number;
  gesperrt: ReadonlySet<string>; nicht: ReadonlySet<string>; vorwissen: ReadonlyMap<string, number>; versatz: number;
}): Kandidat[] {
  const n = o.tabelle.length, aus: Kandidat[] = [];
  if (!n) return aus;
  const start = ((Math.trunc(o.versatz) % n) + n) % n;
  // two passes over the rotated table, so that a round measures different knobs before it measures the other direction of the same knob:
  // pass 0 takes one direction per knob (up and down alternate from knob to knob), pass 1 the other one
  for (const lauf of [0, 1]) {
    for (let i = 0; i < n; i++) {
      const knopf = o.tabelle[(start + i) % n];
      if (o.gesperrt.has(knopf.name)) continue;
      const jetzt = o.werte[knopf.name] ?? knopf.vorgabe;
      const richtung = ((i % 2 === 0) === (lauf === 0) ? 1 : -1) as 1 | -1;
      const leiter = stufenWerte(jetzt, richtung);
      if (!leiter.length || o.nicht.has(schluesselVon({ param: knopf.name, richtung }))) continue;
      const sens = o.vorwissen.get(schluesselVon({ param: knopf.name, richtung }));
      let p: number;
      if (sens === undefined) {
        p = leiter.findIndex((x) => x.stufe >= START_RUNGE);
        if (p < 0) p = leiter.length - 1;
      } else {
        if (sens * leiter[leiter.length - 1].weg < 0.5 * Math.min(o.schwelle, ZIELE.fein)) continue;
        p = leiter.findIndex((x) => sens * x.weg >= o.schwelle);
        if (p < 0) p = leiter.length - 1;
        // even the smallest rung is predicted to overshoot: narrower than the ladder
        const eng = p === 0 && sens * leiter[0].weg > UEBERSCHUSS * o.schwelle
          ? engerWeg(jetzt, richtung, leiter[0].weg, sens * leiter[0].weg, o.schwelle) : null;
        if (eng) { aus.push({ param: knopf.name, richtung, jetzt, versuch: 1, stufe: 0, ...eng }); continue; }
      }
      aus.push({ param: knopf.name, richtung, jetzt, versuch: 1, ...leiter[p] });
    }
  }
  const rang = (k: Kandidat): number => o.vorwissen.get(schluesselVon(k)) ?? VORWISSEN_UNBEKANNT;
  return aus.map((k, i) => ({ k, i })).sort((a, b) => rang(b.k) - rang(a.k) || a.i - b.i).map((x) => x.k);
}

/** The next try of the same key after a measured one: a narrower step when D overshoots UEBERSCHUSS x `schwelle`, else the next rung, or the
 *  range end when it would be the last allowed try (MAX_STUFEN_KNOPF); after a narrowed try that stays under `schwelle` a wider one (same aim).
 *  Null when the try reached `schwelle`, was the range end or the last allowed try, or when it is silent or far quieter than A (wider is no better). */
export function weiter(g: Gemessen, schwelle: number): Kandidat | null {
  if (g.staerke > UEBERSCHUSS * schwelle * (1 + 1e-9)) {
    // too strong for the level: one narrower try (see UEBERSCHUSS); not when it is silent or far quieter than A, at three tries or at the smallest move
    const eng = g.versuch >= MAX_STUFEN_KNOPF || g.e.pegel * SKALA.pegel <= -PEGEL_WEG ? null : engerWeg(g.jetzt, g.richtung, g.weg, g.staerke, schwelle);
    return eng ? { param: g.param, richtung: g.richtung, jetzt: g.jetzt, versuch: g.versuch + 1, stufe: g.stufe, ...eng } : null;
  }
  if (g.staerke >= schwelle || g.versuch >= MAX_STUFEN_KNOPF || g.e.pegel * SKALA.pegel <= -PEGEL_WEG) return null;
  const leiter = stufenWerte(g.jetzt, g.richtung), p = leiter.findIndex((x) => x.wert === g.wert);
  if (p < 0) {
    // a narrowed try (not on the ladder) that stayed under the target: aim again from its D
    const s = schrittWert(g.jetzt, g.richtung, Math.ceil(100 * g.weg * ZIEL_FAKTOR * schwelle / Math.max(g.staerke, 1e-6) - 1e-9) / 100);
    return s && s.weg > g.weg + 1e-9 ? { param: g.param, richtung: g.richtung, jetzt: g.jetzt, versuch: g.versuch + 1, stufe: g.stufe, ...s } : null;
  }
  if (p >= leiter.length - 1) return null;
  const versuch = g.versuch + 1, naechste = leiter[versuch >= MAX_STUFEN_KNOPF ? leiter.length - 1 : p + 1];
  return { param: g.param, richtung: g.richtung, jetzt: g.jetzt, versuch, ...naechste };
}

/** A measured candidate is accepted when it is audible (D >= schwelle), on a new knob, points another way than every accepted one and gets a word
 *  no accepted place carries. Returns that word, null when it is not accepted. */
export function annehmbar(k: Gemessen, angenommen: readonly Gemessen[], schwelle: number): string | null {
  if (!taugt(k, schwelle) || !angenommen.every((a) => a.param !== k.param && kosinus(k.e, a.e) < COS_GLEICH)) return null;
  return wortFrei(k.e, new Set(angenommen.map((a) => a.wort)));
}

/** A measured candidate is a sound variant at all: audible (D at least `schwelle`), and not silent or far quieter than A (a level, gate or
 *  mix knob turned down would otherwise read as the strongest "darker" there is). */
export function taugt(k: Gemessen, schwelle: number): boolean {
  return k.staerke >= schwelle && k.e.pegel * SKALA.pegel > -PEGEL_WEG;
}

/** A measured candidate at the range end of its knob that stays under `schwelle` but is audible at the lowest level (D >= ZIELE.fein): the strongest
 *  the knob can do. Not for a silent or far quieter one (the level rule of `taugt`). */
export function anschlagPlatz(k: Gemessen, schwelle: number): boolean {
  return (k.wert === 0 || k.wert === 1) && k.staerke < schwelle && taugt(k, ZIELE.fein);
}

/** Extends the accepted ones to `ziel` from the measured ones, in four passes: audible ones on a new knob, range-end fallbacks (anschlagPlatz) on a new
 *  knob, audible ones on a new key of a knob already offered, fallbacks on such a key; each pass strongest first. A place from another knob is preferred
 *  to a second place from the same knob, and a candidate that reaches the target to a fallback. A fallback carries `anschlag: true`. */
export function auffuellen(gemessen: readonly Gemessen[], angenommen: readonly Gemessen[], schwelle: number, ziel = 3): Gemessen[] {
  const aus = [...angenommen];
  const reihe = (f: (k: Gemessen) => boolean): Gemessen[] => gemessen.map((k, i) => ({ k, i })).filter((x) => f(x.k))
    .sort((a, b) => b.k.staerke - a.k.staerke || a.i - b.i).map((x) => x.k);
  const hoerbar = reihe((k) => taugt(k, schwelle)), rest = reihe((k) => anschlagPlatz(k, schwelle));
  const schluessel = new Set(aus.map(schluesselVon)), knoepfe = new Set(aus.map((k) => k.param));
  const nimm = (liste: Gemessen[], neuerKnopf: boolean, anschlag: boolean): void => {
    for (const k of liste) {
      if (aus.length >= ziel) break;
      if (schluessel.has(schluesselVon(k)) || (neuerKnopf && knoepfe.has(k.param))) continue;
      const wort = wortFrei(k.e, new Set(aus.map((a) => a.wort)));
      if (wort === null) continue;
      aus.push({ ...k, wort, ...(anschlag ? { anschlag: true } : {}) }); knoepfe.add(k.param); schluessel.add(schluesselVon(k));
    }
  };
  nimm(hoerbar, true, false); nimm(rest, true, true); nimm(hoerbar, false, false); nimm(rest, false, true);
  return aus;
}

/** Three significant digits without trailing zeros, always plain digits (no exponent). */
export function zahlText(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  const r = Number(x.toPrecision(3));
  if (r === 0) return '0';
  const s = String(r);
  return s.includes('e') ? r.toFixed(20).replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** Place A: the sound as the project has it. */
export function platzA(m: Merkmale): Platz {
  return {
    platz: 'A', param: null, label: '', wert: null, von_text: '', nach_text: '', wort: 'current', staerke: 0, pegel_db: 0, ausgleich_db: 0, merkmale: m,
    text: 'current',
  };
}

/** The gain in dB that plays a place at the level of A: -pegelDb, clamped to +-AUSGLEICH_MAX_DB and so that the fader (faderDb + gain) stays at or under
 *  its maximum of +6 dB; 0 under AUSGLEICH_MIN_DB, for a silent or non-finite level and for a track whose fader is off (-200). */
export function ausgleichDb(pegelDb: number, faderDb: number): number {
  if (!Number.isFinite(pegelDb) || !Number.isFinite(faderDb) || pegelDb <= -150 || faderDb <= -200) return 0;
  const x = Math.max(-AUSGLEICH_MAX_DB, Math.min(AUSGLEICH_MAX_DB, 6 - faderDb, -pegelDb));
  return Math.abs(x) < AUSGLEICH_MIN_DB ? 0 : Math.round(x * 10) / 10;
}

/** A place from a measured candidate; `anzeige` maps a normalised knob value to the number the person sees. */
export function bauePlatz(platz: PlatzName, k: Gemessen,
  o: { label: string; basisWert: number; basis: Merkmale; anzeige: (norm: number) => number; ausgleich?: number }): Platz {
  const von = zahlText(o.anzeige(o.basisWert)), nach = zahlText(o.anzeige(k.wert));
  const diff = Math.round((k.merkmale.pegel - o.basis.pegel) * 10) / 10;
  return {
    platz, param: k.param, label: o.label, wert: k.wert, von_text: von, nach_text: nach, wort: k.wort, staerke: k.staerke,
    pegel_db: diff === 0 ? 0 : diff, ausgleich_db: o.ausgleich ?? 0, merkmale: k.merkmale,
    text: `${k.wort} · ${o.label} ${von} → ${nach}${k.anschlag ? ` · ${ANSCHLAG_TEXT}` : ''}`, ...(k.anschlag ? { anschlag: true } : {}),
  };
}

// --- family tree --------------------------------------------------------------------------------------------------------------------------
const TOLERANZ = 1e-6;
const nummer = (id: string): number => Number(id.slice(1));
const knotenVon = (b: Stammbaum, id: string): StammKnoten | undefined => b.knoten.find((x) => x.id === id);
const neueId = (b: Stammbaum): string => `n${Math.max(0, ...b.knoten.map((x) => nummer(x.id))) + 1}`;
const kopie = (b: Stammbaum): Stammbaum => ({ graph: b.graph, aktiv: b.aktiv, knoten: b.knoten.map((x) => ({ ...x, werte: { ...x.werte } })) });

const ID_MAX = 999999;
const idZahl = (id: string): number => Number(id.slice(1));

/** All knob values at a node (default: the active one): the root values overlaid with every node on the way down. */
export function aufgeloest(b: Stammbaum, id: string = b.aktiv): Record<string, number> {
  const weg: StammKnoten[] = [];
  for (let k = knotenVon(b, id); k; k = k.eltern === null ? undefined : knotenVon(b, k.eltern)) weg.unshift(k);
  const aus: Record<string, number> = {};
  for (const k of weg) Object.assign(aus, k.werte);
  return aus;
}

// The knobs of `werte` that differ from `basis` (tolerance 1e-6), with the value of `basis`. A knob missing in `basis` is not compared.
function abweichung(werte: Readonly<Record<string, number>>, basis: Readonly<Record<string, number>>): Record<string, number> {
  const aus: Record<string, number> = {};
  for (const [k, v] of Object.entries(werte)) if (k in basis && Math.abs(basis[k] - v) > TOLERANZ) aus[k] = basis[k];
  return aus;
}

// Appends the knobs turned by hand since the active node as a node 'manual' under it and makes it active. Mutates `b` (a private copy).
function handNotieren(b: Stammbaum, basis: Readonly<Record<string, number>>): void {
  const werte = abweichung(aufgeloest(b), basis);
  if (!Object.keys(werte).length) return;
  const id = neueId(b);
  b.knoten.push({ id, eltern: b.aktiv, werte, text: 'manual' });
  b.aktiv = id;
}

/** The tree after a pick: a manual change since the active node is recorded first, then the pick becomes the active node. */
export function stammbaumNachWahl(o: {
  baum: Stammbaum | null; graph: string; basis: Readonly<Record<string, number>>; param: string; wert: number; text: string;
}): Stammbaum {
  let b: Stammbaum | null = null;
  if (o.baum && o.baum.graph === o.graph) {
    b = kopie(o.baum);
    handNotieren(b, o.basis);
    // a full tree, or one whose ids would leave the six digits of the shape check, starts again at the current sound
    if (b.knoten.length + 1 > STAMM_MAX_KNOTEN || idZahl(neueId(b)) > ID_MAX) b = null;
  }
  if (!b) b = { graph: o.graph, aktiv: 'n1', knoten: [{ id: 'n1', eltern: null, werte: { ...o.basis }, text: 'start' }] };
  const id = neueId(b);
  b.knoten.push({ id, eltern: b.aktiv, werte: { [o.param]: o.wert }, text: o.text.slice(0, STAMM_TEXT_MAX) });
  b.aktiv = id;
  return b;
}

/** Back to `ziel` (default: the parent of the active node). `werte` are the knobs to write; null when there is nowhere to go. */
export function stammbaumZurueck(o: {
  baum: Stammbaum; ziel?: string; basis: Readonly<Record<string, number>>;
}): { baum: Stammbaum; werte: Record<string, number> } | null {
  const b = kopie(o.baum);
  const aktiv = knotenVon(b, b.aktiv);
  const ziel = o.ziel ?? aktiv?.eltern ?? null;
  if (!aktiv || ziel === null || !knotenVon(b, ziel)) return null;
  const hand = Object.keys(abweichung(aufgeloest(b), o.basis)).length > 0;
  if (ziel === b.aktiv && !hand) return null;
  // A manual change is recorded unless the tree is full (then the move still happens, the change is not kept).
  if (hand && b.knoten.length < STAMM_MAX_KNOTEN && idZahl(neueId(b)) <= ID_MAX) handNotieren(b, o.basis);
  b.aktiv = ziel;
  return { baum: b, werte: zielWerte(b, ziel, o.basis) };
}

// The knobs whose value at `ziel` differs from `basis`, with the value at `ziel`.
function zielWerte(b: Stammbaum, ziel: string, basis: Readonly<Record<string, number>>): Record<string, number> {
  const w = aufgeloest(b, ziel), aus: Record<string, number> = {};
  for (const [k, v] of Object.entries(w)) if (k in basis && Math.abs(basis[k] - v) > TOLERANZ) aus[k] = v;
  return aus;
}

/** The path from the root to the active node; `zweige` counts the children of a node that are not on this path (its other branches). */
export function wegVon(b: Stammbaum): { id: string; text: string; zweige: number }[] {
  const weg: { id: string; text: string; zweige: number }[] = [];
  let kind: string | null = null;
  for (let k = knotenVon(b, b.aktiv); k; k = k.eltern === null ? undefined : knotenVon(b, k.eltern)) {
    weg.unshift({ id: k.id, text: k.text, zweige: b.knoten.filter((x) => x.eltern === k!.id && x.id !== kind).length });
    kind = k.id;
  }
  return weg;
}
