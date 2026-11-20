// Baukasten S12: the graph folder of the kern ($HOME/.config/cypherdj/baukasten, one folder for all instances) seen from the page
// server. Pure functions: list the graphs with their art and knob names, check a name. The kern checks again; this only keeps
// obviously wrong requests off the wire and tells the page what exists.
import crypto from 'node:crypto';
import { INSTRUMENT_STROEME, kanalVonStrom } from '../contract/streams.ts';
import fs from 'node:fs';
import { ablageOrdner } from './paths.ts';
import path from 'node:path';
import { liesSchnitt, type Ordner } from './sampler/schnitt.ts';
import { instrumentKategorieText } from './sampler/instrument.ts';
import { tonKategorieText } from './sampler/tone.ts';
import { geraetFx, type FxRollen } from './devices_parameter.ts';
import { normaleStifte, stiftEinzelFehler, STIFT_SPALTEN, STIFT_ZEILEN, type Steckfeld, type Stift } from './steckfeld.ts';

export type GraphArt = 'instrument' | 'effekt';
/** `latenz`: samples the graph delays its signal at 48 kHz (0 = none), see graphLatenz. */
export type GraphEintrag = { name: string; art: GraphArt; regler_namen: Record<string, string>; latenz: number; kategorie?: string; prinzip?: string; text?: string;
  /** true: a duplicate the instrument pickers do not offer (kategorien.json `verborgen`); the graph stays loadable by name. Absent = not hidden. */ verborgen?: boolean;
  /** Tracker (D16), from the device register: the device runs its effect commands as jumps per tick; absent = smooth. */ fx_stufig?: true;
  /** Tracker (D16), from the device register: knob numbers of the roles slot, start and reverse (latched knobs); absent = no roles. */ rollen?: FxRollen };
/** Instrument categories (ids of kategorien.json). `host` is the Surge/plugin entry the page adds itself, so no graph carries it by default, but it is valid. */
export const KATEGORIE_IDS = ['drums', 'bass', 'lead', 'pad', 'keys', 'textur', 'host', 'sampler'];
export const KATEGORIE_TEXT_MAX = 90;
/** Synthesis types of the instruments (`prinzip` of kategorien.json): the picker's second grouping axis next to the role (`kategorie`). The page adds the
 *  groups `host` and `sonst` (Other) itself; no graph carries them. */
export const PRINZIP_IDS = ['analog', 'wavetable', 'fm', 'physik', 'granular', 'sampler', 'drums', 'feedback'] as const;
export type KategorieEintrag = { kategorie: string; prinzip?: string; text: string; verborgen?: true };
export type GraphListe = { graphen: GraphEintrag[]; uebersprungen: string[] };

// Same rule as the kern (net_erz.cpp kit_name_ok): [a-z0-9_-], 1..32 characters. The graph name is the FILE name.
export const GRAPH_NAME = /^[a-z0-9_-]{1,32}$/;

// The kern always reads $HOME/.config/cypherdj/baukasten, whatever the instance. CYPHERDJ_BK_ORDNER is for tests.
export function graphenOrdner(): string {
  return ablageOrdner('geraete');
}

// Effect graphs have a node with art "eingang" (they sit as an insert on a channel), instruments do not.
function eintrag(name: string, text: string): GraphEintrag | null {
  let g: unknown;
  try { g = JSON.parse(text); } catch { return null; }
  if (typeof g !== 'object' || g === null || Array.isArray(g)) return null;
  const knoten = (g as { knoten?: unknown }).knoten;
  if (!Array.isArray(knoten)) return null;
  const effekt = knoten.some((k) => typeof k === 'object' && k !== null && (k as { art?: unknown }).art === 'eingang');
  const roh = (g as { regler_namen?: unknown }).regler_namen;
  const regler_namen: Record<string, string> = {};
  if (typeof roh === 'object' && roh !== null && !Array.isArray(roh)) {
    for (const [n, v] of Object.entries(roh)) if (/^([1-9]|[1-5][0-9]|6[0-4])$/.test(n) && typeof v === 'string' && v.length > 0) regler_namen[n] = v.slice(0, 40);
  }
  return { name, art: effekt ? 'effekt' : 'instrument', regler_namen, latenz: graphLatenz(g) };
}

// Latency of a graph in samples at 48 kHz, 0 when it adds none. The engine knows this only after translating the graph (instruments/modular_dsp
// uebersetzen.rs, Programm::latenz, D4); the page server does not link the engine, so this repeats the rule on the file: a limiter delays by
// round(vorlauf * 48) - 1 (vorlauf in ms, default 2), a falter or a labor with ueber = 1 (their default) by the half-band filter, 69 samples (eq_dsp
// ueberabtastung MITTE), and a node's latency is its own plus the largest latency of its inputs; edges with a delay (verzoegerung 1, or into a
// leitung's x) do not count; the graph's latency is the largest at an `ausgang`. Macros are not expanded: a macro node counts the sum of the latency
// blocks inside it, an upper bound (a graph may be left out of a choice too early, never offered with latency). Keep in step with the engine.
const LATENZ_SR = 48000, LATENZ_HALBBAND = 69;
const LATENZ_FREI: Record<string, Record<string, number>> = { limiter: { vorlauf: 2 }, falter: { ueber: 1 }, labor: { ueber: 1 } };
type RohKnoten = { art?: unknown; [w: string]: unknown };
function knotenLatenz(k: RohKnoten): number {
  const art = typeof k.art === 'string' ? k.art : '';
  const w = (n: string): number => (typeof k[n] === 'number' ? (k[n] as number) : (LATENZ_FREI[art]?.[n] ?? 0));
  if (art === 'limiter') return Math.max(Math.round(Math.fround(w('vorlauf') * LATENZ_SR / 1000)), 1) - 1;
  if (art === 'falter') return w('ueber') === 1 ? LATENZ_HALBBAND : 0;
  if (art === 'labor') return Math.trunc(w('ueber')) === 0 || Math.trunc(w('ueber')) === 2 ? 0 : LATENZ_HALBBAND;
  return 0;
}
export function graphLatenz(graph: unknown): number {
  const g = graph as { knoten?: unknown; kanten?: unknown; makros?: unknown } | null;
  if (typeof g !== 'object' || g === null || !Array.isArray(g.knoten)) return 0;
  const knoten = new Map<string, RohKnoten>();
  for (const k of g.knoten) if (typeof k === 'object' && k !== null && typeof (k as { id?: unknown }).id === 'string') knoten.set((k as { id: string }).id, k as RohKnoten);
  const makroLatenz = (name: string): number => {
    const m = (g.makros as Record<string, { knoten?: unknown }> | undefined)?.[name];
    return Array.isArray(m?.knoten) ? m.knoten.reduce((s: number, k: unknown) => s + (typeof k === 'object' && k !== null ? knotenLatenz(k as RohKnoten) : 0), 0) : 0;
  };
  const ein = new Map<string, string[]>();   // node -> sources over edges without delay
  for (const e of Array.isArray(g.kanten) ? g.kanten : []) {
    const { von, nach, verzoegerung } = (e ?? {}) as { von?: unknown; nach?: unknown; verzoegerung?: unknown };
    if (typeof von !== 'string' || typeof nach !== 'string') continue;
    const [vk] = von.split('.'), [nk, np] = nach.split('.');
    if (!knoten.has(vk) || !knoten.has(nk) || verzoegerung === 1 || (knoten.get(nk)?.art === 'leitung' && np === 'x')) continue;
    (ein.get(nk) ?? ein.set(nk, []).get(nk)!).push(vk);
  }
  const memo = new Map<string, number>(), offen = new Set<string>();
  const lat = (id: string): number => {
    const m = memo.get(id);
    if (m !== undefined) return m;
    if (offen.has(id)) return 0;   // a loop without delay: the engine refuses the graph
    offen.add(id);
    const k = knoten.get(id)!;
    const eigen = typeof k.art === 'string' && k.art.startsWith('makro:') ? makroLatenz(k.art.slice(6)) : knotenLatenz(k);
    const r = eigen + Math.max(0, ...(ein.get(id) ?? []).map(lat));
    offen.delete(id);
    memo.set(id, r);
    return r;
  };
  let aus = 0;
  for (const [id, k] of knoten) if (k.art === 'ausgang') aus = Math.max(aus, lat(id));
  return aus;
}

/** kategorien.json ({graph: {kategorie, prinzip?, text}}) as installed next to the panels (<graph folder>/panels/kategorien.json, copied by djk-start). Entries that are not
 *  valid (unknown category, empty or over-long text) are left out; a missing or unreadable file gives {}. */
export function ladeKategorien(ordner: string = graphenOrdner()): Record<string, KategorieEintrag> {
  let roh: unknown;
  try { roh = JSON.parse(fs.readFileSync(path.join(ordner, 'panels', 'kategorien.json'), 'utf8')); } catch { return {}; }
  return pruefeKategorien(roh).gueltig;
}
export function pruefeKategorien(roh: unknown): { gueltig: Record<string, KategorieEintrag>; fehler: string[] } {
  const gueltig: Record<string, KategorieEintrag> = {}, fehler: string[] = [];
  if (typeof roh !== 'object' || roh === null || Array.isArray(roh)) return { gueltig, fehler: ['kategorien.json is not an object'] };
  for (const [n, v] of Object.entries(roh)) {
    const e = v as { kategorie?: unknown; text?: unknown };
    if (typeof e?.kategorie !== 'string' || !KATEGORIE_IDS.includes(e.kategorie)) { fehler.push(`${n}: kategorie must be one of ${KATEGORIE_IDS.join(', ')}`); continue; }
    if (typeof e.text !== 'string' || !e.text.trim() || e.text.length > KATEGORIE_TEXT_MAX) { fehler.push(`${n}: text must be 1..${KATEGORIE_TEXT_MAX} characters`); continue; }
    // prinzip is optional on read (an older install has none); a wrong one is reported but the entry stays, without it
    const p = (v as { prinzip?: unknown }).prinzip;
    const prinzipOk = typeof p === 'string' && (PRINZIP_IDS as readonly string[]).includes(p);
    if (p !== undefined && !prinzipOk) fehler.push(`${n}: prinzip must be one of ${PRINZIP_IDS.join(', ')}`);
    // verborgen is optional on read (an older install has none); only `true` hides, a non-boolean is reported and the entry stays without it
    const vb = (v as { verborgen?: unknown }).verborgen;
    if (vb !== undefined && typeof vb !== 'boolean') fehler.push(`${n}: verborgen must be true or false`);
    gueltig[n] = { kategorie: e.kategorie, ...(prinzipOk ? { prinzip: p } : {}), text: e.text, ...(vb === true ? { verborgen: true as const } : {}) };
  }
  return { gueltig, fehler };
}

/** `o` is the sampler store (cuts, tones, instruments) the generated devices are named from; absent = the default folders. */
export function listeGraphen(ordner: string = graphenOrdner(), o: Ordner = {}, fxVon: (graph: string) => { stufig: boolean; rollen: FxRollen } = geraetFx): GraphListe {
  const graphen: GraphEintrag[] = [], uebersprungen: string[] = [];
  let dateien: string[] = [];
  try { dateien = fs.readdirSync(ordner).filter((d) => d.endsWith('.json')); } catch { /* no folder: empty list */ }
  for (const d of dateien.sort()) {
    const name = d.slice(0, -5);
    if (!GRAPH_NAME.test(name)) { uebersprungen.push(name); continue; }
    let text: string;
    try { text = fs.readFileSync(path.join(ordner, d), 'utf8'); } catch { uebersprungen.push(name); continue; }
    const e = eintrag(name, text);
    if (e) graphen.push(e); else uebersprungen.push(name);
  }
  graphen.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const kat = ladeKategorien(ordner);   // instruments only; entries without one carry no fields (the page files them under "Other")
  for (const g of graphen) if (g.art === 'instrument' && kat[g.name]) { g.kategorie = kat[g.name].kategorie; if (kat[g.name].prinzip) g.prinzip = kat[g.name].prinzip; g.text = kat[g.name].text; if (kat[g.name].verborgen) g.verborgen = true; }
  // Sampler A1 D10: the generated devices of the cut store (smp-<id>) belong to the category `sampler`, named after their cut; no entry of kategorien.json
  for (const g of graphen) {
    if (g.art !== 'instrument' || !g.name.startsWith('smp-')) continue;
    g.kategorie = 'sampler';
    g.prinzip = 'sampler';
    const schnitt = liesSchnitt(g.name.slice(4), o);
    g.text = schnitt ? `Slices of ${schnitt.name}`.slice(0, KATEGORIE_TEXT_MAX) : 'Sliced sample';
  }
  // Sampler C: the generated tones (ton-<cut>-<n>) are filed under `sampler` as well; the text names the tone and its root
  for (const g of graphen) {
    if (g.art !== 'instrument' || !g.name.startsWith('ton-')) continue;
    g.kategorie = 'sampler';
    g.prinzip = 'sampler';
    g.text = tonKategorieText(g.name, o);
  }
  // Sample player stage 2: the generated instruments (ins-<id>) are filed under `sampler` too
  for (const g of graphen) {
    if (g.art !== 'instrument' || !g.name.startsWith('ins-')) continue;
    g.kategorie = 'sampler';
    g.prinzip = 'sampler';
    g.text = instrumentKategorieText(g.name, o);
  }
  // tracker D16: the register's description of a device (a graph `amiga-<id>` takes the entry of `amiga`); an entry without the fields stays as it was
  for (const g of graphen) {
    if (g.art !== 'instrument') continue;
    const fx = fxVon(g.name);
    if (fx.stufig) g.fx_stufig = true;
    if (Object.keys(fx.rollen).length > 0) g.rollen = fx.rollen;
  }
  return { graphen, uebersprungen };
}

export function findeGraph(name: string, ordner: string = graphenOrdner()): GraphEintrag | null {
  if (!GRAPH_NAME.test(name)) return null;
  try { return eintrag(name, fs.readFileSync(path.join(ordner, `${name}.json`), 'utf8')); } catch { return null; }
}

// S17: sha256 (hex) of the graph file bytes, the fingerprint a project snapshot stores. null for a bad name, a missing or unreadable file.
export function graphHash(name: string, ordner: string = graphenOrdner()): string | null {
  if (!GRAPH_NAME.test(name)) return null;
  try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(ordner, `${name}.json`))).digest('hex'); } catch { return null; }
}

// Where a graph can go. Instruments: the channels of the instrument streams of the shared table (djk/contract/streams.ts):
// erz/2, erz/3 (studio streams), erz/5..7 and pad/1, pad/2 (Baukasten streams 5, 6, 7, 9, 10, served by generator_bk.mjs).
// Stream 1 runs in kit mode, its notes are kit indices. A graph on pad/N is summed with the loop of box N.
// Effects: the decks, the send returns fx/3, fx/4, the DJ master sum (`master`) and, as an insert on the channel, the three Strudel streams erz/1..3 and
// the loop slots pad/1, pad/2. A channel holds one graph: on erz/2, erz/3, pad/1, pad/2 an instrument or an effect, not both (POST /graph says `belegt`).
export const INSTRUMENT_KANAELE: string[] = INSTRUMENT_STROEME.map((s) => kanalVonStrom(s) as string);
export const EFFEKT_KANAELE = ['deck/1', 'deck/2', 'deck/3', 'deck/4', 'fx/3', 'fx/4', 'master', 'erz/1', 'erz/2', 'erz/3', 'pad/1', 'pad/2'];
export const GRAPH_KANAELE = [...new Set(['erz/1', ...INSTRUMENT_KANAELE, ...EFFEKT_KANAELE])];

// Kern restart (Kanban t_e998388c): the kern keeps no graph over a restart, the page server loads again what was loaded. `vorher` is the server's map
// before it clears it, `besitzer` the source of the last load per channel (unknown counts as andreas: a graph that was sounding comes back), and
// `projektKanaele` the channels of the open project's sound snapshot, which the project restore (session.ts nachNeustart) loads itself.
export function graphenNachNeustart(vorher: Record<string, string>, besitzer: Record<string, string>, projektKanaele: readonly string[]): { kanal: string; name: string; besitzer: string }[] {
  return Object.entries(vorher)
    .filter(([kanal, name]) => name !== '' && GRAPH_KANAELE.includes(kanal) && !projektKanaele.includes(kanal))
    .map(([kanal, name]) => ({ kanal, name, besitzer: besitzer[kanal] === 'cypher' ? 'cypher' : 'andreas' }));
}

// ---- Front panels (sidecar files) -----------------------------------------------------------------------------------------------
// A panel is a separate description of how a graph's knobs are laid out on the page: <graph folder>/panels/<graph>.json, format
// "cypherdj-panel/2" (v1 "baukasten-panel/1" files are read as v2). The graph file stays untouched (the core rejects unknown keys and its sha256 is a project fingerprint). The
// folder scan above reads only top-level *.json, so the subfolder is inert for it. Range and scaling come from the graph's `regler`
// nodes, never from the panel; the scaling itself lives in public/panel_skala.js (shared with the page).
import { FORMATE } from './public/panel_skala.js';
import { GLYPHEN } from './public/panel_glyphen.js';
import { BK_REGLER_ZAHL } from './project/modular.ts';

/** `mitte`: value at knob position 0.5 (absent: the plain range). `vorgabe`: the knob position the graph starts at (0.5 where the node has none). */
export type ReglerBereich = { min: number; max: number; log: boolean; mitte?: number; vorgabe: number };
export type ReglerBereiche = Record<string, ReglerBereich>;
export type PanelAntwort = { name: string; art: GraphArt; regler: ReglerBereiche; panel: Record<string, unknown> | null; fehler: string[] };

export const AKZENTE = ['rot', 'orange', 'gelb', 'gruen', 'tuerkis', 'blau', 'violett'];
export const GERAET_ARTEN = ['bk', 'rb338', 'surge', 'plugin'];
export const PANEL_FORMATE = ['baukasten-panel/1', 'cypherdj-panel/2'];
const PANEL_V1 = 'baukasten-panel/1', PANEL_V2 = 'cypherdj-panel/2';
const PANEL_ID = /^[a-z0-9_-]{1,24}$/;
const TYPEN = ['knob', 'fader', 'switch', 'selector', 'xy', 'value', 'label', 'spacer', 'huelle', 'lfoform', 'filterkurve', 'wavetable', 'spektrum', 'lever', 'touchpad', 'matrix'];
const ANZEIGEN = ['huelle', 'lfoform', 'filterkurve', 'wavetable', 'spektrum'];   // displays: bind nothing, never sent to the engine
const MIT_BIND = ['knob', 'fader', 'switch', 'selector', 'lever'];
const MIT_ZONEN = ['lever', 'touchpad'];   // `zones`: 1..8 short texts beside the sections of the travel / the field

export function panelOrdner(ordner: string = graphenOrdner()): string { return path.join(ordner, 'panels'); }

/** {nr: {min, max, log, mitte?, vorgabe}} of the graph's `regler` nodes (first node per number wins). Entries the engine would refuse are left out. */
export function reglerBereiche(graph: unknown): ReglerBereiche {
  const aus: ReglerBereiche = {};
  const knoten = (graph as { knoten?: unknown } | null)?.knoten;
  if (!Array.isArray(knoten)) return aus;
  for (const k of knoten) {
    if (typeof k !== 'object' || k === null || (k as { art?: unknown }).art !== 'regler') continue;
    const { nr, min, max, log, mitte, vorgabe } = k as { nr?: unknown; min?: unknown; max?: unknown; log?: unknown; mitte?: unknown; vorgabe?: unknown };
    if (typeof nr !== 'number' || !Number.isInteger(nr) || nr < 1 || nr > BK_REGLER_ZAHL || String(nr) in aus) continue;
    if (typeof min !== 'number' || typeof max !== 'number' || !Number.isFinite(min) || !Number.isFinite(max)) continue;
    const l = log === 1 || log === true;
    if (l && !(min > 0 && max > 0)) continue;   // the engine refuses this node (uebersetzen.rs)
    let v = 0.5;
    if (vorgabe !== undefined) {
      if (typeof vorgabe !== 'number' || !(vorgabe >= 0 && vorgabe <= 1)) continue;   // the engine refuses this node
      v = vorgabe;
    }
    if (mitte === undefined) { aus[String(nr)] = { min, max, log: l, vorgabe: v }; continue; }
    // the engine refuses a mitte that is not strictly between min and max, one with a vorgabe other than 0.5, and (log) one with min <= 0
    if (typeof mitte !== 'number' || v !== 0.5 || !((min < mitte && mitte < max) || (max < mitte && mitte < min)) || (l && !(min > 0))) continue;
    aus[String(nr)] = { min, max, log: l, mitte, vorgabe: v };
  }
  return aus;
}

/** The `regler` ranges of the graph file `<name>.json` in the graph folder (first node per number wins); null when the file is unknown or unreadable. */
export function reglerVonGraph(graphName: string, ordner: string = graphenOrdner()): ReglerBereiche | null {
  if (!GRAPH_NAME.test(graphName)) return null;
  let g: unknown;
  try { g = JSON.parse(fs.readFileSync(path.join(ordner, `${graphName}.json`), 'utf8')); } catch { return null; }
  return reglerBereiche(g);
}

/** The graph's start position per knob, index 0 = knob 1, `BK_REGLER_ZAHL` entries (0.5 where the graph defines none), from the graph file `<name>.json` in the
 *  graph folder; null when the file is unknown or unreadable. Same rule as the engine (`Programm::regler_vorgaben`): the first node of a number wins. */
export function vorgabenVon(graphName: string, ordner: string = graphenOrdner()): number[] | null {
  const b = reglerVonGraph(graphName, ordner);
  if (!b) return null;
  return Array.from({ length: BK_REGLER_ZAHL }, (_, i) => b[String(i + 1)]?.vorgabe ?? 0.5);
}

/** Kraken patch field: the labels and default pins of the graph's `matrix` node (the first one; a graph holds at most one). `zeilen` and `spalten` are the 16
 *  labels each, `stifte` the default pins in normal form (entries the engine would refuse are left out, an absent list is empty). null when the graph has no
 *  matrix node or its labels are not 16 texts (the engine refuses such a node). */
export function steckfeldAusGraph(graph: unknown): Steckfeld | null {
  const knoten = (graph as { knoten?: unknown } | null)?.knoten;
  if (!Array.isArray(knoten)) return null;
  const k = knoten.find((x) => typeof x === 'object' && x !== null && (x as { art?: unknown }).art === 'matrix') as Record<string, unknown> | undefined;
  if (!k) return null;
  const namen = (x: unknown, n: number): string[] | null => (Array.isArray(x) && x.length === n && x.every((e) => typeof e === 'string') ? [...x] as string[] : null);
  const zeilen = namen(k.zeilen, STIFT_ZEILEN), spalten = namen(k.spalten, STIFT_SPALTEN);
  if (!zeilen || !spalten) return null;
  const roh = Array.isArray(k.stifte) ? k.stifte : [];
  const stifte = normaleStifte(roh.filter((e) => stiftEinzelFehler(e) === null) as Stift[]);
  return { zeilen, spalten, stifte };
}

/** The patch field of the graph file `<name>.json` in the graph folder; null when the file is unknown or unreadable or the graph has no matrix node. */
export function steckfeldVon(graphName: string, ordner: string = graphenOrdner()): Steckfeld | null {
  if (!GRAPH_NAME.test(graphName)) return null;
  let g: unknown;
  try { g = JSON.parse(fs.readFileSync(path.join(ordner, `${graphName}.json`), 'utf8')); } catch { return null; }
  return steckfeldAusGraph(g);
}

const istObjekt = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const text = (x: unknown, max: number): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;

/** Read a panel as cypherdj-panel/2. A v1 panel (top-level `graph`, binds `{regler: n}`) becomes `geraet: {art: 'bk', graph}` with binds
 *  `{param: 'k<n>'}`; a v2 panel and anything of an unknown format pass unchanged (pruefePanel reports what is wrong). Pure, never throws. */
export function normalisierePanel(p: unknown): Record<string, unknown> {
  if (!istObjekt(p) || p.format !== PANEL_V1) return p as Record<string, unknown>;
  const { format: _f, graph, ...rest } = p;
  const bind = (b: unknown): unknown => {
    if (!istObjekt(b)) return b;
    if (typeof b.regler === 'number' && Number.isInteger(b.regler)) { const { regler, ...r } = b; return { param: `k${regler}`, ...r }; }
    return b;
  };
  const steuer = (c: unknown): unknown => {
    if (!istObjekt(c) || !istObjekt(c.bind)) return c;
    const b = c.bind;
    return { ...c, bind: c.type === 'xy' ? { ...b, x: bind(b.x), y: bind(b.y) } : c.type === 'touchpad' ? { ...b, x: bind(b.x), touch: bind(b.touch) } : bind(b) };
  };
  const sektion = (s: unknown): unknown => (istObjekt(s) && Array.isArray(s.controls) ? { ...s, controls: s.controls.map(steuer) } : s);
  return { format: PANEL_V2, geraet: { art: 'bk', graph }, ...rest, ...(Array.isArray(rest.sections) ? { sections: rest.sections.map(sektion) } : {}) };
}

/** Check a parsed panel (v1 is read as v2 first) against the device it belongs to. bk: the graph `graphName` and its `regler` ranges (binds k<n>);
 *  rb338/surge: the binds must be names in `parameterNamen` (the device's parameterTabelle). `steckfeld` (bk): the graph's patch field as steckfeldAusGraph reads it,
 *  null = the graph has none; a `matrix` control needs one (undefined = not known to the caller, not checked). Returns every problem found (empty list: the panel is good). */
export function pruefePanel(roh: unknown, graphName: string, regler: ReglerBereiche, parameterNamen: readonly string[] = [], steckfeld: Steckfeld | null | undefined = undefined): string[] {
  const f: string[] = [];
  const panel = normalisierePanel(roh);
  if (!istObjekt(panel)) return ['the panel is not a JSON object'];
  if (!PANEL_FORMATE.includes(panel.format as string)) f.push(`format must be "${PANEL_V1}" or "${PANEL_V2}"`);
  const geraet = istObjekt(panel.geraet) ? panel.geraet : null;
  if (!geraet) f.push('geraet must be an object {art, graph}');
  else {
    if (!GERAET_ARTEN.includes(geraet.art as string)) f.push('geraet.art must be "bk", "rb338", "surge" or "plugin"');
    else if (geraet.art === 'bk' && geraet.graph !== graphName) f.push(`graph is "${String(geraet.graph)}" but the panel belongs to "${graphName}"`);
  }
  if (panel.akzent !== undefined && !AKZENTE.includes(panel.akzent as string)) f.push(`akzent must be one of ${AKZENTE.join(', ')}`);
  if (panel.title !== undefined && !text(panel.title, 40)) f.push('title must be a text of 1..40 characters');
  if (!Array.isArray(panel.sections) || panel.sections.length === 0) { f.push('sections must be a non-empty list'); return f; }
  const ids = new Set<string>(), gebunden = new Map<string, string>(), eigene = new Map<string, string>();   // eigene: control id -> type
  const eigeneSeite = new Map<string, unknown>();   // control id -> page of its section
  const werte: { id: string; of: string }[] = [];
  const anzeigen: { wo: string; c: Record<string, unknown> }[] = [];
  const matrizen: { wo: string; c: Record<string, unknown>; sektion: unknown }[] = [];
  const seiten = new Set<string>();
  const sektionIds = new Set<string>();
  const sektionSeiten: { sw: string; seite: unknown }[] = [];
  const optionen = new Map<string, number>();   // selector id -> number of options
  const binde = (param: unknown, wo: string) => {
    if (typeof param !== 'string' || param === '') { f.push(`${wo}: bind.param must be a parameter name`); return; }
    if (geraet?.art === 'rb338' || geraet?.art === 'surge' || geraet?.art === 'plugin') {   // device with a fixed parameter table
      if (!parameterNamen.includes(param)) { f.push(`${wo}: parameter ${param} is not defined by the device`); return; }
      const schon = gebunden.get(param);
      if (schon) f.push(`${wo}: parameter ${param} is already bound by ${schon}`); else gebunden.set(param, wo);
      return;
    }
    const m = /^k(\d+)$/.exec(param);   // bk device: the parameters are the graph's knobs k1..k64
    if (!m || !(String(Number(m[1])) in regler) || m[1] !== String(Number(m[1]))) { f.push(`${wo}: parameter ${param} is not defined by the device`); return; }
    const schon = gebunden.get(param);
    if (schon) f.push(`${wo}: parameter ${param} is already bound by ${schon}`); else gebunden.set(param, wo);
  };
  if (panel.pages !== undefined) {
    if (!Array.isArray(panel.pages) || panel.pages.length === 0) f.push('pages must be a non-empty list of {id, title}');
    else panel.pages.forEach((p, i) => {
      if (!istObjekt(p) || !(typeof p.id === 'string' && PANEL_ID.test(p.id)) || !text(p.title, 16)) f.push(`pages[${i}]: needs an id [a-z0-9_-]{1,24} and a title of 1..16 characters`);
      else if (seiten.has(p.id)) f.push(`pages: id "${p.id}" used twice`); else seiten.add(p.id);
      if (istObjekt(p) && p.all !== undefined && typeof p.all !== 'boolean') f.push(`pages[${i}]: all must be true or false`);
    });
    const alle = Array.isArray(panel.pages) ? panel.pages.filter((p) => istObjekt(p) && p.all === true).length : 0;
    if (alle > 1) f.push(`pages: at most one page may carry all (${alle} found)`);
  }
  panel.sections.forEach((s, si) => {
    if (!istObjekt(s)) { f.push(`sections[${si}] is not an object`); return; }
    const sw = `section ${typeof s.id === 'string' ? `"${s.id}"` : si}`;
    if (typeof s.id === 'string') sektionIds.add(s.id);
    if (s.page !== undefined) sektionSeiten.push({ sw, seite: s.page });
    if (!(typeof s.id === 'string' && PANEL_ID.test(s.id))) f.push(`${sw}: id must match [a-z0-9_-]{1,24}`);
    if (s.title !== undefined && !text(s.title, 24)) f.push(`${sw}: title must be a text of 1..24 characters`);
    if (s.cols !== undefined && !(typeof s.cols === 'number' && Number.isInteger(s.cols) && s.cols >= 1 && s.cols <= 8)) f.push(`${sw}: cols must be an integer 1..8`);
    if (!Array.isArray(s.controls) || s.controls.length === 0) { f.push(`${sw}: controls must be a non-empty list`); return; }
    s.controls.forEach((c, ci) => {
      if (!istObjekt(c)) { f.push(`${sw}: controls[${ci}] is not an object`); return; }
      const id = typeof c.id === 'string' ? c.id : '';
      const wo = `control "${id || `${si}.${ci}`}"`;
      if (!PANEL_ID.test(id)) f.push(`${wo}: id must match [a-z0-9_-]{1,24}`);
      else if (ids.has(id)) f.push(`${wo}: id used twice`); else ids.add(id);
      const typ = c.type;
      if (typeof typ !== 'string' || !TYPEN.includes(typ)) { f.push(`${wo}: type must be one of ${TYPEN.join(', ')}`); return; }
      eigene.set(id, typ);
      eigeneSeite.set(id, s.page);
      if (c.label !== undefined && !text(c.label, 24)) f.push(`${wo}: label must be a text of 1..24 characters`);
      if (c.unit !== undefined && !text(c.unit, 8)) f.push(`${wo}: unit must be a text of 1..8 characters`);
      if (c.format !== undefined && !FORMATE.includes(String(c.format))) f.push(`${wo}: format must be one of ${FORMATE.join(', ')}`);
      for (const a of ['xformat', 'yformat']) if (c[a] !== undefined && (typ !== 'xy' || !FORMATE.includes(String(c[a])))) f.push(`${wo}: ${a} is only for xy and must be one of ${FORMATE.join(', ')}`);
      if (c.span !== undefined && !(typeof c.span === 'number' && Number.isInteger(c.span) && c.span >= 1 && c.span <= 8)) f.push(`${wo}: span must be an integer 1..8`);
      const bind = istObjekt(c.bind) ? c.bind : null;
      if (MIT_BIND.includes(typ)) {
        if (!bind) f.push(`${wo}: bind is missing`); else binde(bind.param, wo);
        if (typ === 'lever') { if (c.default !== undefined) f.push(`${wo}: a lever rests at 0.5 and takes no default`); }
        else if (c.default !== undefined && !(typeof c.default === 'number' && Number.isFinite(c.default))) f.push(`${wo}: default must be a number`);
        if (typ !== 'selector' && typ !== 'lever' && typeof c.default === 'number' && !(c.default >= 0 && c.default <= 1)) f.push(`${wo}: default is normalised and must be within 0..1`);
      }
      if (c.einheitlos !== undefined && c.einheitlos !== true) f.push(`${wo}: einheitlos must be true`);
      if (c.scale !== undefined) {
        const sc = istObjekt(c.scale) ? c.scale : null;
        if (!sc || !(sc.ticks !== undefined || sc.labels !== undefined)) f.push(`${wo}: scale must be {ticks} or {labels}`);
        else {
          if (sc.ticks !== undefined && !(typeof sc.ticks === 'number' && Number.isInteger(sc.ticks) && sc.ticks >= 2 && sc.ticks <= 21)) f.push(`${wo}: scale.ticks must be an integer 2..21`);
          if (sc.labels !== undefined && !(Array.isArray(sc.labels) && sc.labels.length >= 2 && sc.labels.length <= 21 && sc.labels.every((x) => text(x, 6)))) f.push(`${wo}: scale.labels must be 2..21 texts of 1..6 characters`);
        }
      }
      if (typ === 'fader' && c.orientation !== undefined && c.orientation !== 'vertical' && c.orientation !== 'horizontal') f.push(`${wo}: orientation must be vertical or horizontal`);
      if (typ === 'selector') {
        const o = c.options;
        if (!(Array.isArray(o) && o.length >= 2 && o.length <= 8 && o.every((x) => text(x, 12)))) f.push(`${wo}: options must be 2..8 texts of 1..12 characters`);
        else if (c.default !== undefined && !(Number.isInteger(c.default) && (c.default as number) >= 0 && (c.default as number) < o.length)) f.push(`${wo}: default must be an option index 0..${o.length - 1}`);
      }
      if (typ === 'selector' && Array.isArray(c.options)) optionen.set(id, c.options.length);
      if (c.mitte_aus !== undefined && (typ !== 'switch' || typeof c.mitte_aus !== 'boolean')) f.push(`${wo}: mitte_aus is only for switch and must be true or false`);
      if (c.glyphs !== undefined) {
        const n = typ === 'switch' ? 2 : Array.isArray(c.options) ? c.options.length : -1;
        if (typ !== 'selector' && typ !== 'switch') f.push(`${wo}: glyphs is only for selector and switch`);
        else if (!Array.isArray(c.glyphs) || (n >= 0 && c.glyphs.length !== n)) f.push(`${wo}: glyphs needs one entry per option (${n})`);
        else for (const g of c.glyphs) if (g !== null && !GLYPHEN.includes(g as string)) f.push(`${wo}: unknown glyph "${String(g)}"`);
      }
      if (typ === 'switch' && c.default !== undefined && c.default !== 0 && c.default !== 1) f.push(`${wo}: default must be 0 or 1`);
      if (typ === 'xy') {
        const bx = istObjekt(bind?.x) ? bind.x : null, by = istObjekt(bind?.y) ? bind.y : null;
        if (!bx || !by) f.push(`${wo}: bind needs x and y`); else { binde(bx.param, `${wo} x`); binde(by.param, `${wo} y`); }
        if (c.default !== undefined && !istObjekt(c.default)) f.push(`${wo}: default must be {x, y}`);
        else if (istObjekt(c.default)) for (const a of ['x', 'y']) {
          const d = c.default[a];
          if (d !== undefined && !(typeof d === 'number' && d >= 0 && d <= 1)) f.push(`${wo}: default.${a} must be within 0..1`);
        }
      }
      if (typ === 'touchpad') {
        const bx = istObjekt(bind?.x) ? bind.x : null, bt = istObjekt(bind?.touch) ? bind.touch : null;
        if (!bx || !bt) f.push(`${wo}: bind needs x and touch`); else { binde(bx.param, `${wo} x`); binde(bt.param, `${wo} touch`); }
        if (c.default !== undefined && !(istObjekt(c.default) && (c.default.x === undefined || (typeof c.default.x === 'number' && c.default.x >= 0 && c.default.x <= 1)))) f.push(`${wo}: default must be {x} within 0..1`);
      }
      if (c.zones !== undefined) {
        if (!MIT_ZONEN.includes(typ)) f.push(`${wo}: zones is only for lever and touchpad`);
        else if (!(Array.isArray(c.zones) && c.zones.length >= 1 && c.zones.length <= 8 && c.zones.every((x) => text(x, 8)))) f.push(`${wo}: zones must be 1..8 texts of 1..8 characters`);
      }
      if (typ === 'value') {
        if (typeof c.of !== 'string') f.push(`${wo}: of must name another control`); else werte.push({ id: wo, of: c.of });
      }
      if (ANZEIGEN.includes(typ)) anzeigen.push({ wo, c });
      if (typ === 'matrix') matrizen.push({ wo, c, sektion: s });
      if (typ === 'label' && !text(c.text, 140)) f.push(`${wo}: text must be a text of 1..140 characters`);
    });
  });
  const reihen = istObjekt(panel.layout) ? panel.layout.rows : undefined;
  if (panel.layout !== undefined) {
    if (!istObjekt(panel.layout) || !Array.isArray(reihen) || !reihen.every((r) => Array.isArray(r) && r.every((x) => typeof x === 'string'))) f.push('layout.rows must be a list of lists of section ids');
    else {
      const genannt = new Set<string>();
      for (const r of reihen as string[][]) for (const id of r) {
        if (!sektionIds.has(id)) f.push(`layout: unknown section "${id}"`);
        else if (genannt.has(id)) f.push(`layout: section "${id}" named twice`); else genannt.add(id);
      }
    }
  }
  for (const { sw, seite } of sektionSeiten) if (!(typeof seite === 'string' && seiten.has(seite))) f.push(`${sw}: page "${String(seite)}" is not in pages`);
  const werkelt = (id: unknown): boolean => typeof id === 'string' && ['knob', 'fader'].includes(eigene.get(id) ?? '');
  // patch field: one `matrix` control at most, no bind, a graph with a matrix node, `of.morph` names a knob or fader that sits on the page `patch` like the matrix
  if (matrizen.length > 1) f.push(`control "matrix": a panel holds at most one matrix control (${matrizen.length} found)`);
  for (const { wo, c, sektion } of matrizen) {
    if (c.bind !== undefined) f.push(`${wo}: a matrix control takes no bind (the pins are not knobs)`);
    if (geraet?.art !== undefined && geraet.art !== 'bk') f.push(`${wo}: a matrix control belongs on a Baukasten device`);
    else if (steckfeld === null) f.push(`${wo}: the graph "${graphName}" has no matrix node`);
    const seiteVon = (sek: unknown) => (istObjekt(sek) ? sek.page : undefined);
    if (seiteVon(sektion) !== 'patch') f.push(`${wo}: its section must be on the page "patch"`);
    const of = istObjekt(c.of) ? c.of : null;
    if (c.of !== undefined && !of) f.push(`${wo}: of must be {morph?, quellen?, ziele?, bereiche?}`);
    if (of) {
      for (const k of Object.keys(of)) if (!['morph', 'quellen', 'ziele', 'bereiche'].includes(k)) f.push(`${wo}: of.${k} is unknown (only of.morph, quellen, ziele, bereiche)`);
      // cabinet view (page with all): the section of each source row, the control or section of each destination column, the range of each column (at pin amount 1)
      const sechzehn = (name: string): unknown[] | null => {
        const l = of[name];
        if (l === undefined) return null;
        if (!Array.isArray(l) || l.length !== 16) { f.push(`${wo}: of.${name} must be a list of exactly 16 entries`); return null; }
        return l;
      };
      const q = sechzehn('quellen');
      if (q) q.forEach((x, i) => { if (x !== null && !(typeof x === 'string' && sektionIds.has(x))) f.push(`${wo}: of.quellen[${i}] ${JSON.stringify(x)} does not name a section`); });
      const zl = sechzehn('ziele');
      if (zl) zl.forEach((x, i) => { if (x !== null && !(typeof x === 'string' && (eigene.has(x) || sektionIds.has(x)))) f.push(`${wo}: of.ziele[${i}] ${JSON.stringify(x)} does not name a control or a section`); });
      const br = sechzehn('bereiche');
      if (br) br.forEach((x, i) => {
        if (x === null) return;
        if (!(istObjekt(x) && typeof x.wert === 'number' && Number.isFinite(x.wert) && text(x.einheit, 8))) f.push(`${wo}: of.bereiche[${i}] must be null or {wert: number, einheit: text of 1..8 characters}`);
      });
      const m = of.morph;
      if (m !== undefined) {
        if (typeof m !== 'string' || !werkelt(m)) f.push(`${wo}: of.morph ${JSON.stringify(m)} does not name a knob or fader`);
        else if (eigeneSeite.get(m) !== 'patch') f.push(`${wo}: of.morph "${m}" must sit in a section on the page "patch"`);
      }
    }
  }
  const glyphe = (g: unknown, wo: string) => { if (typeof g !== 'string' || !GLYPHEN.includes(g)) f.push(`${wo}: unknown glyph "${String(g)}"`); };
  for (const { wo, c } of anzeigen) {
    const of = istObjekt(c.of) ? c.of : {};
    const hat = (k: string, brauchtZahl = false) => {
      const v = of[k];
      if (v === undefined) { f.push(`${wo}: of.${k} is missing`); return false; }
      if (brauchtZahl && typeof v === 'number') {   // a fixed stage: seconds (>= 0), but the sustain stage is a level (0..1)
        if (k === 's' ? v >= 0 && v <= 1 : v >= 0) return true;
        f.push(`${wo}: of.${k} ${v} is out of range (${k === 's' ? '0 to 1' : 'seconds, 0 or more'})`); return false;
      }
      if (typeof v === 'string' && !eigene.has(v)) { f.push(`${wo}: of.${k} "${v}" does not name a control`); return false; }
      if (!werkelt(v)) { f.push(`${wo}: of.${k} ${JSON.stringify(v)} does not name a knob or fader`); return false; }
      return true;
    };
    if (c.type === 'huelle') for (const k of ['a', 'd', 's', 'r']) hat(k, true);
    else if (c.type === 'lfoform') {
      const fo = c.formen;
      if (!Array.isArray(fo)) { f.push(`${wo}: formen must be a list of glyph ids`); continue; }
      fo.forEach((g) => glyphe(g, wo));
      if (of.form === undefined) { if (fo.length !== 1) f.push(`${wo}: formen needs one entry without of.form`); }
      else if (typeof of.form !== 'string' || !optionen.has(of.form)) f.push(`${wo}: of.form ${JSON.stringify(of.form)} does not name a selector`);
      else if (fo.length !== optionen.get(of.form)) f.push(`${wo}: formen has ${fo.length} entries but "${of.form}" has ${optionen.get(of.form)} options`);
    } else if (c.type === 'filterkurve') {
      hat('cutoff'); hat('reso');
      const ty = c.typen;
      if (!Array.isArray(ty)) { f.push(`${wo}: typen must be a list of {art, pole}`); continue; }
      ty.forEach((t) => { if (!istObjekt(t) || !['lp', 'bp', 'hp'].includes(t.art as string) || (t.pole !== 2 && t.pole !== 4)) f.push(`${wo}: typen entries need art lp, bp or hp and pole 2 or 4`); });
      if (of.typ === undefined) { if (ty.length !== 1) f.push(`${wo}: typen needs one entry without of.typ`); }
      else if (typeof of.typ !== 'string' || !optionen.has(of.typ)) f.push(`${wo}: of.typ ${JSON.stringify(of.typ)} does not name a selector`);
      else if (ty.length !== optionen.get(of.typ)) f.push(`${wo}: typen has ${ty.length} entries but "${of.typ}" has ${optionen.get(of.typ)} options`);
    }
  }
  for (const w of werte) {
    const [basis, achse] = w.of.split('.');
    const t = eigene.get(basis ?? '');
    if (!t || t === 'value' || t === 'label' || t === 'spacer') f.push(`${w.id}: of "${w.of}" does not name a control with a value`);
    else if (t === 'xy' ? !(achse === 'x' || achse === 'y') : t === 'touchpad' ? !(achse === undefined || achse === 'x') : achse !== undefined) f.push(`${w.id}: of "${w.of}" ${t === 'xy' ? 'needs .x or .y' : t === 'touchpad' ? 'may only name .x' : 'takes no axis'}`);
  }
  return f;
}

/** The panel of one graph for GET /graphen/panel: the graph's knob ranges plus the panel when a valid sidecar exists. `fehler` lists why a
 *  sidecar was refused (the page then keeps the slider field). null: no such graph. */
export function ladePanel(name: string, ordner: string = graphenOrdner()): PanelAntwort | null {
  if (!GRAPH_NAME.test(name)) return null;
  let graph: unknown, text0: string;
  try { text0 = fs.readFileSync(path.join(ordner, `${name}.json`), 'utf8'); graph = JSON.parse(text0); } catch { return null; }
  const e = eintrag(name, text0);
  if (!e) return null;
  const regler = reglerBereiche(graph);
  let roh: string;
  try { roh = fs.readFileSync(path.join(panelOrdner(ordner), `${name}.json`), 'utf8'); } catch { return { name, art: e.art, regler, panel: null, fehler: [] }; }
  let panel: unknown;
  try { panel = JSON.parse(roh); } catch { return { name, art: e.art, regler, panel: null, fehler: ['the panel file is not valid JSON'] }; }
  const normal = normalisierePanel(panel);
  const fehler = pruefePanel(normal, name, regler, [], steckfeldAusGraph(graph));
  return { name, art: e.art, regler, panel: fehler.length ? null : normal, fehler };
}
