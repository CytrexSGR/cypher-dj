// S17: sound snapshot of a project (which Baukasten graph sits on which live channel and the graph knob values, 8..64 numbers).
// Pure leaf module: no runtime import of model.ts or commands.ts (those import this file), results are { grund, text } /
// { wo, text } that the callers turn into their own error type. Plan 2026-11-01-baukasten-s17.md.

export interface BkKanal { id: string; graph: string; regler: number[]; sha256?: string }
// regler: the kern has <kanal>/bk/1..64 (the restore sends the knobs; a snapshot holds 8..64 numbers, see bkReglerKanonisch);
// vorgabe: a plain "save sound" captures this channel
export interface BkKanalDef { id: string; kanal: string; regler: boolean; vorgabe: boolean }

// ONE table for every slice: a new channel, or kern knobs on fx/3 and fx/4, are one row / one flag here.
// ids carry no "/" because patch paths split on "/" (model.ts ID rule).
export const BK_KANAELE: readonly BkKanalDef[] = [
  { id: 'erz2', kanal: 'erz/2', regler: true, vorgabe: true },
  { id: 'erz3', kanal: 'erz/3', regler: true, vorgabe: true },
  { id: 'deck1', kanal: 'deck/1', regler: true, vorgabe: true },
  { id: 'deck2', kanal: 'deck/2', regler: true, vorgabe: true },
  { id: 'deck3', kanal: 'deck/3', regler: true, vorgabe: true },
  { id: 'deck4', kanal: 'deck/4', regler: true, vorgabe: true },
  { id: 'fx3', kanal: 'fx/3', regler: false, vorgabe: false },   // the kern has no fx/N/bk/* knobs yet
  { id: 'fx4', kanal: 'fx/4', regler: false, vorgabe: false },
  { id: 'erz5', kanal: 'erz/5', regler: true, vorgabe: false },
  { id: 'erz6', kanal: 'erz/6', regler: true, vorgabe: false },
  { id: 'erz7', kanal: 'erz/7', regler: true, vorgabe: false },
  { id: 'pad1', kanal: 'pad/1', regler: true, vorgabe: false },
  { id: 'pad2', kanal: 'pad/2', regler: true, vorgabe: false },
];
export const BK_REGLER_ZAHL = 64;       // knobs per graph (the kern's <kanal>/bk/1..64)
export const BK_REGLER_MIN = 8;         // shortest stored `regler` array: the pre-32 project format, readable by old builds
export const BK_VORGABE_WERT = 0.5;
export const BK_GRAPH_NAME = /^[a-z0-9_-]{1,32}$/;   // = graphs.ts GRAPH_NAME (kern kit_name_ok); a test asserts equality
const SHA = /^[0-9a-f]{64}$/;

export const bkKanalVon = (kanal: string): BkKanalDef | null => BK_KANAELE.find((d) => d.kanal === kanal) ?? null;
export const bkDefVonId = (id: string): BkKanalDef | null => BK_KANAELE.find((d) => d.id === id) ?? null;

const istObjekt = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const reglerFehler = (r: unknown, wo: string): string | null => {
  if (!Array.isArray(r) || r.length < BK_REGLER_MIN || r.length > BK_REGLER_ZAHL) return `${wo}: ${BK_REGLER_MIN}..${BK_REGLER_ZAHL} numbers expected`;
  for (let i = 0; i < r.length; i++) {
    if (typeof r[i] !== 'number' || !Number.isFinite(r[i]) || r[i] < 0 || r[i] > 1) return `${wo}[${i}]: number 0..1 expected`;
  }
  return null;
};

// The graph's start position per knob (`vorgabe`, index 0 = knob 1) by graph name; null when the graph is unknown. The storage layer
// and the commands get it by injection (this file stays a leaf, graphs.ts imports it); the page server wires graphs.ts `vorgabenVon`.
// ONE source for fill and trim: trimming against 0.5 while filling with a `vorgabe` would lose a stored 0.5 on a knob whose start is 0.
export type VorgabenQuelle = (graph: string) => readonly number[] | null;
let vorgabenQuelle: VorgabenQuelle = () => null;
export const setzeVorgabenQuelle = (f: VorgabenQuelle | null): void => { vorgabenQuelle = f ?? (() => null); };
export const vorgabenVonGraph = (graph: string): readonly number[] | null => vorgabenQuelle(graph);

const vorgabeAn = (v: readonly number[] | null | undefined, i: number): number => {
  const w = v?.[i];
  return typeof w === 'number' && Number.isFinite(w) ? w : BK_VORGABE_WERT;
};
// Reading: pads a stored `regler` array (8..64 numbers, an old project holds 8 or 32) to 64 with the graph's `vorgabe` per knob
// (0.5 where `v` is null, i.e. the graph file is unknown, or has no entry).
export const bkReglerAuffuellen = (r: readonly number[], v: readonly number[] | null = null): number[] => {
  const aus = r.slice(0, BK_REGLER_ZAHL);
  while (aus.length < BK_REGLER_ZAHL) aus.push(vorgabeAn(v, aus.length));
  return aus;
};
// Writing: with the graph's `vorgabe` list, pad to 64 and cut trailing values equal to the same `vorgabe` down to BK_REGLER_MIN. A project that
// does not touch a knob beyond 8 is written with exactly 8 numbers and stays readable by builds from before the 32-knob limit.
// Without a list (graph file unknown, renamed, half written) the array is NOT cut: it may have been stored against a `vorgabe` list, and cutting
// against 0.5 would lose values (stored 0.5 on a knob whose start is 0 reads back as 0 once the graph is there). It is kept as stored, at least 8 numbers.
export const bkReglerKanonisch = (r: readonly number[], v: readonly number[] | null = null): number[] => {
  if (v === null) {
    const roh = r.slice(0, BK_REGLER_ZAHL);
    while (roh.length < BK_REGLER_MIN) roh.push(BK_VORGABE_WERT);
    return roh;
  }
  const aus = bkReglerAuffuellen(r, v);
  while (aus.length > BK_REGLER_MIN && aus[aus.length - 1] === vorgabeAn(v, aus.length - 1)) aus.pop();
  return aus;
};

// Stored `werte` of a bk insert stage: an old project holds k1..k8 only. k9..k64 are optional in the file, read as 0.5 and not
// written while they are 0.5 (effect graphs carry no `vorgabe`, Task 8 pins that), so a project that never touches them stays readable by older builds.
export const BK_INSERT_OPTIONAL: readonly string[] = Array.from({ length: BK_REGLER_ZAHL - BK_REGLER_MIN }, (_, i) => `k${BK_REGLER_MIN + 1 + i}`);
export const bkInsertAuffuellen = (werte: Record<string, number>): void => {
  for (const k of BK_INSERT_OPTIONAL) if (!(k in werte)) werte[k] = BK_VORGABE_WERT;
};
export const bkInsertKanonisch = (werte: Record<string, number>): void => {
  for (const k of BK_INSERT_OPTIONAL) if (werte[k] === BK_VORGABE_WERT) delete werte[k];
};

// File validation of Projekt.baukasten (the caller checks that the key is present).
export function pruefeBkListe(x: unknown): { wo: string; text: string } | null {
  if (!Array.isArray(x) || x.length < 1) return { wo: 'baukasten', text: 'non-empty list expected (absent when nothing is saved)' };
  if (x.length > BK_KANAELE.length) return { wo: 'baukasten', text: `at most ${BK_KANAELE.length} entries` };
  const ids = new Set<string>();
  for (let i = 0; i < x.length; i++) {
    const wo = `baukasten[${i}]`, e = x[i];
    if (!istObjekt(e)) return { wo, text: 'object expected' };
    for (const k of Object.keys(e)) if (!['id', 'graph', 'regler', 'sha256'].includes(k)) return { wo: `${wo}.${k}`, text: 'unknown field' };
    for (const k of ['id', 'graph', 'regler']) if (!(k in e)) return { wo: `${wo}.${k}`, text: 'missing' };
    if (typeof e.id !== 'string' || !bkDefVonId(e.id)) return { wo: `${wo}.id`, text: `one of ${BK_KANAELE.map((d) => d.id).join(', ')} expected` };
    if (ids.has(e.id)) return { wo: `${wo}.id`, text: `duplicate (${e.id})` };
    ids.add(e.id);
    if (typeof e.graph !== 'string' || !BK_GRAPH_NAME.test(e.graph)) return { wo: `${wo}.graph`, text: 'graph name (a-z 0-9 _ -, 1..32) expected' };
    const rf = reglerFehler(e.regler, `${wo}.regler`);
    if (rf) return { wo: `${wo}.regler`, text: rf };
    if ('sha256' in e && (typeof e.sha256 !== 'string' || !SHA.test(e.sha256))) return { wo: `${wo}.sha256`, text: '64 lower-case hex characters expected' };
  }
  return null;
}

// Command bk_setzen {kanal, graph | null, regler?, sha256?} on the current list. Returns a NEW list, never mutates.
// graph null removes the entry; regler omitted keeps the old values of the same channel, else the graph's `vorgabe` throughout (0.5 for an unknown graph);
// the stored array is canonical (bkReglerKanonisch);
// sha256 omitted is kept only when the graph name is unchanged.
export function bkSetzen(liste: readonly BkKanal[] | undefined, a: Record<string, unknown>): { liste: BkKanal[] } | { grund: string; text: string } {
  const ab = (grund: string, text: string) => ({ grund, text });
  for (const k of Object.keys(a)) if (!['befehl', 'kanal', 'graph', 'regler', 'sha256'].includes(k)) return ab('argument_unbekannt', k);
  const def = typeof a.kanal === 'string' ? bkKanalVon(a.kanal) : null;
  if (!def) return ab('argument_ungueltig', `kanal: one of ${BK_KANAELE.map((d) => d.kanal).join(', ')} expected`);
  const alt = (liste ?? []).find((e) => e.id === def.id);
  const rest = (liste ?? []).filter((e) => e.id !== def.id);
  if (a.graph === null) {
    if (!alt) return ab('argument_ungueltig', `graph: nothing saved for ${def.kanal}`);
    return { liste: rest };
  }
  if (typeof a.graph !== 'string' || !BK_GRAPH_NAME.test(a.graph)) return ab('argument_ungueltig', 'graph: graph name (a-z 0-9 _ -, 1..32) or null expected');
  if (a.regler !== undefined) { const f = reglerFehler(a.regler, 'regler'); if (f) return ab('argument_ungueltig', f); }
  if (a.sha256 !== undefined && (typeof a.sha256 !== 'string' || !SHA.test(a.sha256))) {
    return ab('argument_ungueltig', 'sha256: 64 lower-case hex characters expected');
  }
  // omitted `regler`: the old values were cut against the OLD graph's list, so on a graph change they are filled with that list, not the new one
  // (a new graph without a list does not cut, so the stored array stays as it is)
  const neueListe = vorgabenQuelle(a.graph);
  const altRegler = !alt ? [] : alt.graph === a.graph || neueListe === null ? alt.regler : bkReglerAuffuellen(alt.regler, vorgabenQuelle(alt.graph));
  const neu: BkKanal = {
    id: def.id, graph: a.graph,
    regler: bkReglerKanonisch(a.regler !== undefined ? (a.regler as number[]) : altRegler, neueListe),
  };
  const sha = a.sha256 !== undefined ? (a.sha256 as string) : alt && alt.graph === a.graph ? alt.sha256 : undefined;
  if (sha !== undefined) neu.sha256 = sha;
  const aus = [...rest, neu];
  aus.sort((x, y) => BK_KANAELE.findIndex((d) => d.id === x.id) - BK_KANAELE.findIndex((d) => d.id === y.id));   // table order, stable files
  return { liste: aus };
}
