// Strand 11, task 7.4 (spec 7b): the arc compiler. A declarative arc (layers per stream with entry and exit bars, fades,
// one break) becomes one ordinary `spur` body: one pattern move per stream per section. Pure; the route (7.5) hands the
// result to spurStart, so every spur rule (AUTO, Stop Cypher, nur_rampe, anchor, probe) still holds.
//
// Semantics (plan-7-8.md task 7.4 and section 11):
// - A layer plays on bars ab_takt <= b < bis_takt; without bis_takt it keeps playing after the arc (patterns persist).
// - rein n: the layer fades in over n bars from ab_takt; raus n: it fades out over the n bars before bis_takt.
//   A section that starts inside a fade carries `.rein(n, schon)` / `.raus(n, schon)` (generator, task 7.3), so the fade
//   continues across the boundary instead of restarting.
// - bruch: every stream not in `behalte` is silent on bars ab_takt .. ab_takt + takte - 1; its stack comes back after (drop).
// - A stream whose layers have all ended goes to `silence`; before its first layer it is not touched.
import { ALLE_STROEME } from '../contract/streams.ts';
import { pruefeSpur, SPUR_NAME, type Fahrt, type Spur } from './track.ts';

export const MAX_BOGEN_TAKTE = 128;
export const MAX_BLENDE = 32;
export const MAX_SCHICHTEN = 64;

export interface Schicht { strom: number; muster: string; ab_takt: number; bis_takt?: number; rein?: number; raus?: number; name?: string }
export interface Bruch { ab_takt: number; takte: number; behalte?: number[] }
export interface Bogen { name: string; takte: number; schichten: Schicht[]; bruch?: Bruch; fahrten?: Fahrt[] }
export interface BogenFahrt extends Fahrt { bezeichnung?: string }
export interface PlanZeile { takt: number; strom: number | null; text: string }   // strom null: the whole arc (break, drop)
export type BogenErgebnis = { spur: Spur; plan: PlanZeile[] } | { fehler: 'bogen'; text: string };

// control characters (below U+0020, and U+007F) are refused in every label
export const STEUERZEICHEN = /[\u0000-\u001f\u007f]/;
const ganz = (x: unknown, a: number, b: number): x is number => Number.isInteger(x) && (x as number) >= a && (x as number) <= b;
const falsch = (text: string): BogenErgebnis => ({ fehler: 'bogen', text });

// Check the input; null when valid, else the error text naming the field (and the layer index)
function pruefe(x: unknown): string | null {
  if (!x || typeof x !== 'object') return 'bogen: object expected';
  const g = x as Record<string, unknown>;
  if (typeof g.name !== 'string' || !SPUR_NAME.test(g.name)) return 'name: [a-z0-9_-]{1,32}';
  if (!ganz(g.takte, 1, MAX_BOGEN_TAKTE)) return `takte: integer 1..${MAX_BOGEN_TAKTE}`;
  const takte = g.takte as number;
  if (!Array.isArray(g.schichten) || g.schichten.length === 0) return 'schichten: non-empty list expected';
  if (g.schichten.length > MAX_SCHICHTEN) return `schichten: at most ${MAX_SCHICHTEN} layers`;
  for (const [i, roh] of g.schichten.entries()) {
    const wo = `schichten[${i}]`;
    if (!roh || typeof roh !== 'object') return `${wo}: object expected`;
    const s = roh as Record<string, unknown>;
    if (!(ALLE_STROEME as readonly number[]).includes(s.strom as number)) return `${wo}.strom: one of ${ALLE_STROEME.join(', ')}`;
    if (typeof s.muster !== 'string' || !s.muster.trim()) return `${wo}.muster: pattern text expected`;
    if (!ganz(s.ab_takt, 1, takte)) return `${wo}.ab_takt: integer 1..${takte}`;
    const ab = s.ab_takt as number;
    if (s.bis_takt !== undefined && !ganz(s.bis_takt, ab + 1, takte + 1)) return `${wo}.bis_takt: integer ${ab + 1}..${takte + 1} (exclusive end)`;
    if (s.rein !== undefined && !ganz(s.rein, 1, MAX_BLENDE)) return `${wo}.rein: integer 1..${MAX_BLENDE}`;
    if (s.raus !== undefined) {
      if (!ganz(s.raus, 1, MAX_BLENDE)) return `${wo}.raus: integer 1..${MAX_BLENDE}`;
      if (s.bis_takt === undefined) return `${wo}.raus: needs bis_takt`;
      if ((s.bis_takt as number) - (s.raus as number) < ab) return `${wo}.raus: bis_takt - raus must be >= ab_takt`;
    }
    if (s.name !== undefined && !(typeof s.name === 'string' && s.name.trim().length >= 1 && s.name.length <= 60)) return `${wo}.name: text 1..60`;
    if (typeof s.name === 'string' && STEUERZEICHEN.test(s.name)) return `${wo}.name: no control characters`;
  }
  if (g.bruch !== undefined) {
    if (!g.bruch || typeof g.bruch !== 'object') return 'bruch: object expected';
    const b = g.bruch as Record<string, unknown>;
    if (!ganz(b.ab_takt, 1, takte)) return `bruch.ab_takt: integer 1..${takte}`;
    if (!ganz(b.takte, 1, takte + 1 - (b.ab_takt as number))) return `bruch.takte: integer 1..${takte + 1 - (b.ab_takt as number)} (the break lies inside the arc)`;
    if (b.behalte !== undefined) {
      if (!Array.isArray(b.behalte)) return 'bruch.behalte: list of streams expected';
      const da = new Set((g.schichten as Schicht[]).map((s) => s.strom));
      for (const [k, s] of b.behalte.entries()) if (!da.has(s)) return `bruch.behalte[${k}]: stream ${String(s)} has no layer in this arc`;
    }
  }
  if (g.fahrten !== undefined && !Array.isArray(g.fahrten)) return 'fahrten: list expected';
  return null;
}

// One layer's text for a section starting at bar b, always as `(\n<text>\n)` (plus the fade modifiers). A trailing `;` is
// dropped; the newlines keep a line comment at the end of the text from swallowing the closing parenthesis or the comma.
function schichtText(s: Schicht, b: number): string {
  const roh = s.muster.trim().replace(/;+\s*$/, '');
  const mods: string[] = [];
  if (s.rein !== undefined && b < s.ab_takt + s.rein) mods.push(b === s.ab_takt ? `.rein(${s.rein})` : `.rein(${s.rein}, ${b - s.ab_takt})`);
  if (s.raus !== undefined && s.bis_takt !== undefined) {
    const von = s.bis_takt - s.raus;
    if (b >= von) mods.push(b === von ? `.raus(${s.raus})` : `.raus(${s.raus}, ${b - von})`);
  }
  return `(\n${roh}\n)${mods.join('')}`;
}

// The stack's closing parenthesis sits on its own line; the single-layer case is the layer text itself
const stapel = (teile: string[]): string => (teile.length === 1 ? teile[0] : `stack(\n${teile.join(',\n')}\n)`);
const nameVon = (s: Schicht) => s.name ?? `strom ${s.strom}`;

export function kompiliereBogen(x: unknown, fahrbar: Set<string> = new Set()): BogenErgebnis {
  const fehler = pruefe(x);
  if (fehler) return falsch(fehler);
  const g = x as Bogen;
  const bruch = g.bruch;
  const behalte = new Set(bruch?.behalte ?? []);
  const imBruch = (strom: number, b: number) => !!bruch && !behalte.has(strom) && b >= bruch.ab_takt && b < bruch.ab_takt + bruch.takte;

  const stroeme = [...new Set(g.schichten.map((s) => s.strom))].sort((a, b) => a - b);
  const zuege: BogenFahrt[] = [];
  const plan: PlanZeile[] = [];
  for (const strom of stroeme) {
    const eigene = g.schichten.filter((s) => s.strom === strom);
    const grenzen = new Set<number>();
    for (const s of eigene) {
      grenzen.add(s.ab_takt);
      if (s.bis_takt !== undefined) grenzen.add(s.bis_takt);
      if (s.raus !== undefined && s.bis_takt !== undefined) grenzen.add(s.bis_takt - s.raus);
    }
    if (bruch && !behalte.has(strom)) { grenzen.add(bruch.ab_takt); grenzen.add(bruch.ab_takt + bruch.takte); }
    let letzt: string | null = null, gespielt = false;
    for (const b of [...grenzen].sort((p, q) => p - q)) {
      const aktiv = eigene.filter((s) => s.ab_takt <= b && (s.bis_takt === undefined || b < s.bis_takt));
      let text: string, bez: string | undefined;
      if (imBruch(strom, b)) text = 'silence';
      else if (aktiv.length) {
        text = stapel(aktiv.map((s) => schichtText(s, b)));
        if (aktiv.some((s) => s.name !== undefined)) {
          const j = aktiv.map(nameVon).join(' + ');
          bez = j.length > 60 ? `${j.slice(0, 59)}…` : j;   // the label limit is 60 characters
        }
      } else if (gespielt) text = 'silence';
      else continue;   // nothing has played on this stream yet: leave whatever runs there
      gespielt = true;
      const schluessel = `${text}\u0000${bez ?? ''}`;
      if (schluessel === letzt) continue;
      letzt = schluessel;
      zuege.push({ ziel: `strom:${strom}`, ab_takt: b, muster: text, ...(bez !== undefined ? { bezeichnung: bez } : {}) });
    }
    for (const s of eigene) {
      plan.push({ takt: s.ab_takt, strom, text: `+ ${nameVon(s)}` });
      if (s.bis_takt !== undefined) plan.push({ takt: s.bis_takt, strom, text: `- ${nameVon(s)}` });
    }
  }
  if (bruch) {
    const k = [...behalte].sort((a, b) => a - b);
    plan.push({ takt: bruch.ab_takt, strom: null, text: k.length ? `break (keeps ${k.join(', ')})` : 'break' });
    plan.push({ takt: bruch.ab_takt + bruch.takte, strom: null, text: 'drop' });
  }
  plan.sort((p, q) => p.takt - q.takt || (p.strom ?? 0) - (q.strom ?? 0));

  const r = pruefeSpur({ name: g.name, fahrten: [...zuege, ...(g.fahrten ?? [])] }, fahrbar);
  if ('fehler' in r) return falsch(r.fehler);
  return { spur: r.spur, plan };
}
