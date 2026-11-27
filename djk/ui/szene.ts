// Strand 11 slice 5 (task 5.2): live scene snapshot and exact restore. Live scenes are files in <project folder>/szenen/; they are NOT the
// launcher scenes of the field `szenen` in project.json, which this module never reads or writes. Pure parts of POST /szene: the stored format, collect, diff and the restore plan.
// File access is limited to the live scene folder of the open live project (<project>/szenen/<name>.json), written atomically (temp file + rename).
import fs from 'node:fs';
import path from 'node:path';
import type { Fahrt } from './track.ts';

export const SZENE_NAME = /^[a-z0-9_-]{1,32}$/;
export const SZENE_MAX_TAKTE = 16;
export const SZENE_ORDNER = 'szenen';
/** A name starting with `_` is automatic (`_vor_stille`, `_vor_laden`): a save replaces it, it never answers szene_vorhanden. */
export const istAutomatisch = (name: string): boolean => name.startsWith('_');

export interface SzeneSpur { name: string; fahrten: Fahrt[]; schleife_takte: number }
export interface SzeneKlang { art: string; patch_b64?: string; params?: Record<string, number> }
export interface Szene {
  v: 1;
  geschrieben: string;
  takt: number;
  bpm: number | null;
  muster: Record<string, string>;
  /** phase offset per stream at save time (only nonzero ones): a pattern restored from an earlier restore keeps its phase */
  versatz?: Record<string, number>;
  /** switch bar per stream: the absolute bar at which the running pattern of that stream took effect (time zero of its .rein/.raus) */
  anker?: Record<string, number>;
  /** stream label (bezeichnung) per stream, written together with the pattern at save time (only streams that have one) */
  bezeichnung?: Record<string, string>;
  regler: Record<string, number>;
  graphen: Record<string, string>;
  fx: unknown;
  fx_zuweisung: unknown;
  fx_routing: unknown;
  klang: Record<string, SzeneKlang>;
  spuren: SzeneSpur[];
  info: { plaetze: unknown; decks: unknown };
}

/** The control rows a scene keeps: stand.regler without the automatic trim, the project rows, the headphone level and the transport holders. */
export function reglerFuerSzene(regler: Record<string, number>, ueberProjekt: (pfad: string) => boolean): Record<string, number> {
  const aus: Record<string, number> = {};
  for (const [p, w] of Object.entries(regler)) {
    if (typeof w !== 'number' || !Number.isFinite(w)) continue;
    if (p.endsWith('/trim_auto') || p === 'cue/pegel' || p === 'transport' || p.endsWith('/transport') || ueberProjekt(p)) continue;
    aus[p] = w;
  }
  return aus;
}

/** True when no stream of the scene sounds: every pattern text is `silence` or empty (A3: then `_vor_stille` is not written). */
export function allesStill(s: Pick<Szene, 'muster'>): boolean {
  return Object.values(s.muster ?? {}).every((t) => typeof t !== 'string' || t.trim() === '' || t.trim() === 'silence' || t.trim() === 'silence;');
}

/** How many automatic generations are kept: `_vor_stille`, `_vor_stille-1`, `_vor_stille-2`. */
export const AUTO_STUFEN = 3;
/** The automatic names that rotate on each save. */
export const AUTO_ROTIERT: readonly string[] = ['_vor_stille', '_vor_laden'];

export const szenenOrdner = (projektOrdner: string): string => path.join(projektOrdner, SZENE_ORDNER);
export const szeneDatei = (projektOrdner: string, name: string): string => path.join(szenenOrdner(projektOrdner), `${name}.json`);

export function schreibeSzene(projektOrdner: string, name: string, s: Szene): void {
  const ordner = szenenOrdner(projektOrdner);
  fs.mkdirSync(ordner, { recursive: true });
  const ziel = szeneDatei(projektOrdner, name);
  const tmp = `${ziel}.${process.pid}.neu`;
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, ziel);
}

/** An automatic save (A3): the older generations move one step down (`<name>-1` to `<name>-2`, `<name>` to `<name>-1`), then the new one is written. */
export function schreibeAutomatisch(projektOrdner: string, name: string, s: Szene): void {
  const ordner = szenenOrdner(projektOrdner);
  fs.mkdirSync(ordner, { recursive: true });
  const stufe = (i: number): string => szeneDatei(projektOrdner, i === 0 ? name : `${name}-${i}`);
  for (let i = AUTO_STUFEN - 2; i >= 0; i--) {
    try { fs.renameSync(stufe(i), stufe(i + 1)); } catch { /* that generation does not exist */ }
  }
  schreibeSzene(projektOrdner, name, s);
}

/** The stored scene, or null when the file is missing or not a scene of format 1. */
export function leseSzene(projektOrdner: string, name: string): Szene | null {
  try {
    const s = JSON.parse(fs.readFileSync(szeneDatei(projektOrdner, name), 'utf8')) as Szene;
    return s && s.v === 1 && typeof s.muster === 'object' && typeof s.regler === 'object' ? s : null;
  } catch { return null; }
}

export function szeneDa(projektOrdner: string, name: string): boolean { return fs.existsSync(szeneDatei(projektOrdner, name)); }

export function loescheSzene(projektOrdner: string, name: string): boolean {
  try { fs.unlinkSync(szeneDatei(projektOrdner, name)); return true; } catch { return false; }
}

/** The stored scenes, sorted by name: {name, geschrieben, takt, automatisch}. */
export function listeSzenen(projektOrdner: string): { name: string; geschrieben: string | null; takt: number | null; automatisch: boolean }[] {
  let namen: string[];
  try { namen = fs.readdirSync(szenenOrdner(projektOrdner)); } catch { return []; }
  return namen.filter((n) => n.endsWith('.json') && SZENE_NAME.test(n.slice(0, -5))).map((n) => n.slice(0, -5)).sort().map((name) => {
    const s = leseSzene(projektOrdner, name);
    return { name, geschrieben: s?.geschrieben ?? null, takt: s?.takt ?? null, automatisch: istAutomatisch(name) };
  });
}

export interface Jetzt { muster: Record<string, string>; bezeichnung?: Record<string, string | null>; regler: Record<string, number>; graphen: Record<string, string>; versatz?: Record<string, number> }
export interface LadePlan {
  graphen: { kanal: string; name: string }[];
  /** strom:<n> moves at bar 1: a stream whose text or phase differs, and `silence` for a stream that plays now but has none in the scene */
  muster: { strom: number; text: string; versatz: number; bezeichnung?: string }[];
  /** control moves at bar 1: switches as sets, continuous rows as sets (takte 0) or ramps over takte */
  regler: Fahrt[];
}

/** Rows a restore never writes: Andreas' headphones (`.../pfl`) and kills (`.../kill/...`). */
export const nieWiederherstellen = (pfad: string): boolean => /(^|\/)pfl$/.test(pfad) || /(^|\/)kill(\/|$)/.test(pfad);

/** The graph part of the diff alone (A4: graphs load before the anchor is chosen). */
export function planeGraphen(s: Pick<Szene, 'graphen'>, jetzt: Pick<Jetzt, 'graphen'>): LadePlan['graphen'] {
  const graphen = Object.entries(s.graphen ?? {}).filter(([k, n]) => (jetzt.graphen[k] ?? '') !== n).map(([kanal, name]) => ({ kanal, name }));
  // a channel that carries a graph now but none in the scene loses it
  for (const [k, n] of Object.entries(jetzt.graphen)) if (n && !(k in (s.graphen ?? {}))) graphen.push({ kanal: k, name: '' });
  return graphen;
}

/** A stored label is only handed on when it would pass the spur check (1..60 characters, no control characters). */
const gueltigeBez = (b: unknown): b is string => typeof b === 'string' && b.length >= 1 && b.length <= 60 && !/[\u0000-\u001f\u007f]/.test(b);

const klingt = (t: unknown): t is string => typeof t === 'string' && t.trim() !== '' && t.trim() !== 'silence';

/** Diff of a stored scene against the live state: only what differs is restored. `istSchalter` names the switch rows (they never ramp).
 *  ankerTakt = the absolute bar the restore takes effect at: the phase offset of a stream is its stored versatz + ankerTakt - scene bar, and its
 *  fades continue (blendenFortsetzen with the stored switch bar). */
export function planeLaden(s: Szene, jetzt: Jetzt, takte: number, istSchalter: (pfad: string) => boolean, ankerTakt: number = s.takt): LadePlan {
  const graphen = planeGraphen(s, jetzt);
  const muster: LadePlan['muster'] = [];
  for (const [st, t] of Object.entries(s.muster ?? {})) {
    if (typeof t !== 'string' || t.trim() === '') continue;
    const anker = s.anker?.[st];
    const text = blendenFortsetzen(t, typeof anker === 'number' ? s.takt - anker : -1);
    const versatz = (s.versatz?.[st] ?? 0) + ankerTakt - s.takt;
    const bez = gueltigeBez(s.bezeichnung?.[st]) ? s.bezeichnung![st] : undefined;
    if (jetzt.muster[st] === text && (jetzt.versatz?.[st] ?? 0) === versatz && (jetzt.bezeichnung?.[st] ?? undefined) === (bez ?? undefined)) continue;
    muster.push({ strom: Number(st), text, versatz, ...(bez !== undefined ? { bezeichnung: bez } : {}) });
  }
  for (const [st, t] of Object.entries(jetzt.muster)) if (klingt(t) && !klingt(s.muster?.[st])) {
    if (!muster.some((m) => m.strom === Number(st))) muster.push({ strom: Number(st), text: 'silence', versatz: 0 });
  }
  muster.sort((a, b) => a.strom - b.strom);
  const regler: Fahrt[] = [];
  for (const [p, w] of Object.entries(s.regler ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (jetzt.regler[p] === w || nieWiederherstellen(p)) continue;
    regler.push(takte > 0 && !istSchalter(p) ? { ziel: p, ab_takt: 1, takte, nach: w } : { ziel: p, ab_takt: 1, nach: w });
  }
  return { graphen, muster, regler };
}

// A2: fades continue on restore. The text of a stream is rewritten before it is sent: every `.rein(n)`, `.raus(n)`, `.rein(n, s)`, `.raus(n, s)` with
// numeric arguments gets the bars of its fade that had already elapsed at save time: elapsed = vergangen + s, where vergangen = scene bar - switch bar.
// rein: elapsed >= n removes the call (full level), else `.rein(n, elapsed)`. raus: elapsed >= n is silent: on the top-level pattern of a single
// expression the text becomes `silence`, elsewhere `.raus(n, n - 0.001)` (a scaling, so a later `.gain` keeps it silent); else `.raus(n, elapsed)`. vergangen < 0 (unknown anchor) or no
// such call: the text stays as it is. Calls inside string literals and calls with non-numeric arguments are left untouched.
const ZAHL = String.raw`[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`;
const BLENDE = new RegExp(String.raw`^\.(rein|raus)\(\s*(${ZAHL})\s*(?:,\s*(${ZAHL})\s*)?\)`);

/** Positions outside string literals and comments, with the bracket depth at each position (-1 inside a literal). */
function tiefen(text: string): number[] {
  const t: number[] = new Array(text.length).fill(-1);
  let tiefe = 0, quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 1; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') { t[i] = tiefe; tiefe++; continue; }
    if (c === ')' || c === ']' || c === '}') { tiefe = Math.max(0, tiefe - 1); t[i] = tiefe; continue; }
    t[i] = tiefe;
  }
  return t;
}

/** True when the text is one expression: no `;` (other than a trailing one), `=` or line-separated statement at depth 0 outside literals. */
function einAusdruck(text: string, t: number[]): boolean {
  const ende = text.replace(/[\s;]+$/, '').length;
  for (let i = 0; i < ende; i++) {
    if (t[i] !== 0) continue;
    const c = text[i];
    if (c === ';') return false;
    if (c === '=' && text[i + 1] !== '=' && text[i + 1] !== '>' && !'=!<>'.includes(text[i - 1] ?? '')) return false;
    if (/^(const|let|var|function|setcps|setcpm)\b/.test(text.slice(i)) && (i === 0 || /[\s;]/.test(text[i - 1]))) return false;
  }
  return true;
}

const zahlText = (x: number): string => String(Math.round(x * 1e6) / 1e6);

export function blendenFortsetzen(text: string, vergangen: number): string {
  if (!Number.isFinite(vergangen) || vergangen < 0) return text;
  const t = tiefen(text);
  let aus = '', i = 0;
  while (i < text.length) {
    const m = text[i] === '.' && t[i] >= 0 ? BLENDE.exec(text.slice(i)) : null;
    if (!m) { aus += text[i]; i++; continue; }
    const art = m[1], n = Number(m[2]), schon = m[3] === undefined ? 0 : Number(m[3]);
    if (!(n > 0) || !Number.isFinite(schon)) { aus += m[0]; i += m[0].length; continue; }
    const vorbei = vergangen + schon;
    if (art === 'rein') aus += vorbei >= n ? '' : `.rein(${m[2]}, ${zahlText(vorbei)})`;
    else if (vorbei < n) aus += `.raus(${m[2]}, ${zahlText(vorbei)})`;
    else if (t[i] === 0 && einAusdruck(text, t)) return 'silence';
    else aus += `.raus(${m[2]}, ${zahlText(n - 1e-3)})`;   // a finished fade-out stays a scaling (about -120 dB, silent after 1/1000 bar): a later .gain(x) cannot lift it again
    i += m[0].length;
  }
  return aus;
}
