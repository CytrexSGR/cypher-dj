// Baukasten S12: the graph folder of the kern ($HOME/.config/cypherdj/baukasten, one folder for all instances) seen from the page
// server. Pure functions: list the graphs with their art and knob names, check a name. The kern checks again; this only keeps
// obviously wrong requests off the wire and tells the page what exists.
import crypto from 'node:crypto';
import { INSTRUMENT_STROEME, kanalVonStrom } from '../contract/streams.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type GraphArt = 'instrument' | 'effekt';
export type GraphEintrag = { name: string; art: GraphArt; regler_namen: Record<string, string>; kategorie?: string; text?: string };
/** Instrument categories (ids of kategorien.json). `host` is the Surge/plugin entry the page adds itself, so no graph carries it by default, but it is valid. */
export const KATEGORIE_IDS = ['drums', 'bass', 'lead', 'pad', 'keys', 'textur', 'host'];
export const KATEGORIE_TEXT_MAX = 90;
export type KategorieEintrag = { kategorie: string; text: string };
export type GraphListe = { graphen: GraphEintrag[]; uebersprungen: string[] };

// Same rule as the kern (net_erz.cpp kit_name_ok): [a-z0-9_-], 1..32 characters. The graph name is the FILE name.
export const GRAPH_NAME = /^[a-z0-9_-]{1,32}$/;

// The kern always reads $HOME/.config/cypherdj/baukasten, whatever the instance. CYPHERDJ_BK_ORDNER is for tests.
export function graphenOrdner(): string {
  return process.env.CYPHERDJ_BK_ORDNER || path.join(os.homedir(), '.config', 'cypherdj', 'baukasten');
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
  return { name, art: effekt ? 'effekt' : 'instrument', regler_namen };
}

/** kategorien.json ({graph: {kategorie, text}}) as installed next to the panels (<graph folder>/panels/kategorien.json, copied by djk-start). Entries that are not
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
    gueltig[n] = { kategorie: e.kategorie, text: e.text };
  }
  return { gueltig, fehler };
}

export function listeGraphen(ordner: string = graphenOrdner()): GraphListe {
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
  for (const g of graphen) if (g.art === 'instrument' && kat[g.name]) { g.kategorie = kat[g.name].kategorie; g.text = kat[g.name].text; }
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
// Effects: the decks and the send returns fx/3, fx/4.
export const INSTRUMENT_KANAELE: string[] = INSTRUMENT_STROEME.map((s) => kanalVonStrom(s) as string);
export const EFFEKT_KANAELE = ['deck/1', 'deck/2', 'deck/3', 'deck/4', 'fx/3', 'fx/4'];
export const GRAPH_KANAELE = ['erz/1', ...INSTRUMENT_KANAELE, ...EFFEKT_KANAELE];

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
const TYPEN = ['knob', 'fader', 'switch', 'selector', 'xy', 'value', 'label', 'spacer', 'huelle', 'lfoform', 'filterkurve', 'spektrum'];
const ANZEIGEN = ['huelle', 'lfoform', 'filterkurve', 'spektrum'];   // displays: bind nothing, never sent to the engine
const MIT_BIND = ['knob', 'fader', 'switch', 'selector'];

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
    return { ...c, bind: c.type === 'xy' ? { ...b, x: bind(b.x), y: bind(b.y) } : bind(b) };
  };
  const sektion = (s: unknown): unknown => (istObjekt(s) && Array.isArray(s.controls) ? { ...s, controls: s.controls.map(steuer) } : s);
  return { format: PANEL_V2, geraet: { art: 'bk', graph }, ...rest, ...(Array.isArray(rest.sections) ? { sections: rest.sections.map(sektion) } : {}) };
}

/** Check a parsed panel (v1 is read as v2 first) against the device it belongs to. bk: the graph `graphName` and its `regler` ranges (binds k<n>);
 *  rb338/surge: the binds must be names in `parameterNamen` (the device's parameterTabelle). Returns every problem found (empty list: the panel is good). */
export function pruefePanel(roh: unknown, graphName: string, regler: ReglerBereiche, parameterNamen: readonly string[] = []): string[] {
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
  const werte: { id: string; of: string }[] = [];
  const anzeigen: { wo: string; c: Record<string, unknown> }[] = [];
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
    });
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
      if (c.label !== undefined && !text(c.label, 24)) f.push(`${wo}: label must be a text of 1..24 characters`);
      if (c.unit !== undefined && !text(c.unit, 8)) f.push(`${wo}: unit must be a text of 1..8 characters`);
      if (c.format !== undefined && !FORMATE.includes(String(c.format))) f.push(`${wo}: format must be one of ${FORMATE.join(', ')}`);
      for (const a of ['xformat', 'yformat']) if (c[a] !== undefined && (typ !== 'xy' || !FORMATE.includes(String(c[a])))) f.push(`${wo}: ${a} is only for xy and must be one of ${FORMATE.join(', ')}`);
      if (c.span !== undefined && !(typeof c.span === 'number' && Number.isInteger(c.span) && c.span >= 1 && c.span <= 8)) f.push(`${wo}: span must be an integer 1..8`);
      const bind = istObjekt(c.bind) ? c.bind : null;
      if (MIT_BIND.includes(typ)) {
        if (!bind) f.push(`${wo}: bind is missing`); else binde(bind.param, wo);
        if (c.default !== undefined && !(typeof c.default === 'number' && Number.isFinite(c.default))) f.push(`${wo}: default must be a number`);
        if (typ !== 'selector' && typeof c.default === 'number' && !(c.default >= 0 && c.default <= 1)) f.push(`${wo}: default is normalised and must be within 0..1`);
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
      if (typ === 'value') {
        if (typeof c.of !== 'string') f.push(`${wo}: of must name another control`); else werte.push({ id: wo, of: c.of });
      }
      if (ANZEIGEN.includes(typ)) anzeigen.push({ wo, c });
      if (typ === 'label' && !text(c.text, 40)) f.push(`${wo}: text must be a text of 1..40 characters`);
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
    else if (t === 'xy' ? !(achse === 'x' || achse === 'y') : achse !== undefined) f.push(`${w.id}: of "${w.of}" ${t === 'xy' ? 'needs .x or .y' : 'takes no axis'}`);
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
  const fehler = pruefePanel(normal, name, regler);
  return { name, art: e.art, regler, panel: fehler.length ? null : normal, fehler };
}
