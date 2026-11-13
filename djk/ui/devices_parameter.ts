// Parameter tables per device kind and the automatic front panel. A device is a Baukasten graph (art 'bk'), the RB-338 plug-in or Surge.
// The table says what a device exposes (name, label, display range, default); autoPanel turns it into a valid cypherdj-panel/2 so every
// device has a panel even without a hand-made sidecar file. Pure apart from reading the graph file / surge_bereiche.json.
import fs from 'node:fs';
import path from 'node:path';
import { skaliere } from './public/panel_skala.js';
import { findeGraph, graphenOrdner, panelOrdner, ladePanel, reglerBereiche, type ReglerBereich, pruefePanel, normalisierePanel, GRAPH_NAME, AKZENTE, GERAET_ARTEN } from './graphs.ts';
import { REPO, REPO_PFADE } from './paths.ts';
import { RB_DEFS, RB_VORGABE_NORM7 } from './project/rb_mapping.ts';

/** min/max in display units; the panel and the device views work in normalised 0..1 travel, `vorgabe` is normalised 0..1. EXCEPTION Surge: the project
 *  (`geraet.parameter` of a Surge track) and POST /klang fahre hold DISPLAY values (ranges of surge_bereiche.json); the page maps the travel through `punkte`. `stufen`: the parameter is a discrete choice.
 *  `skew` (nih-plug skew factor): display = norm^(1/skew) * (max - min) + min instead of linear or log; `gainDb`: min/max are dB and the skewed range
 *  runs over the linear gain (display = 20 log10 of that gain). `punkte` (Surge): display values at norm 0, 1/4 .. 1 (surge_bereiche.json), linear between them. `anzeigeWert` is the one place that turns a normalised value into display units. */
export type Parameter = { name: string; label: string; min: number; max: number; log: boolean; einheit?: string; vorgabe: number; mitte?: number; stufen?: string[]; skew?: number; gainDb?: boolean; punkte?: number[] };

/** Normalised 0..1 -> display units of a parameter (the same maths as the plug-in and as project/rb_mapping.ts rbPlain). */
export function anzeigeWert(p: Parameter, norm: number): number {
  const k = Math.min(1, Math.max(0, norm));
  if (p.punkte && p.punkte.length >= 2) {
    const n = p.punkte.length - 1, x = k * n, i = Math.min(n - 1, Math.floor(x));
    return (p.punkte[i] as number) + (x - i) * ((p.punkte[i + 1] as number) - (p.punkte[i] as number));
  }
  if (p.mitte !== undefined) return skaliere(k, p);   // graph knob with a centre value (regler `mitte`)
  if (p.gainDb) {
    const lo = 10 ** (p.min / 20), hi = 10 ** (p.max / 20);
    return 20 * Math.log10(k ** (1 / (p.skew ?? 1)) * (hi - lo) + lo);
  }
  if (p.skew !== undefined) return k ** (1 / p.skew) * (p.max - p.min) + p.min;
  return p.log && p.min > 0 && p.max > 0 ? p.min * (p.max / p.min) ** k : p.min + k * (p.max - p.min);
}
/** The seven parameter names of the RB-338 plug-in as a host reports them (lib.rs FloatParam/BoolParam::new): what POST /klang param and the host learn may set on an RB-338 host.
 *  The one source; tests/devices_parameter.test.mjs pins it to lib.rs. */
export const RB338_PARAM_NAMEN: ReadonlySet<string> = new Set(['Volume', 'Square', 'Cutoff', 'Resonance', 'Env Mod', 'Decay', 'Accent']);

export type Geraet = { art: 'bk'; graph: string } | { art: 'rb338' } | { art: 'surge' };

const SEITE = 8;   // controls per section
const kuerze = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n).trimEnd());

// RB-338: names, ranges, skew and defaults come from project/rb_mapping.ts (RB_DEFS, in plug-in field order; a test pins them to lib.rs); only the
// labels and units are written here.
const RB_ANZEIGE: Record<string, { label: string; einheit?: string; stufen?: string[] }> = {
  lautstaerke: { label: 'Volume', einheit: 'dB' }, wellenform: { label: 'Wave', stufen: ['Saw', 'Square'] }, cutoff: { label: 'Cutoff', einheit: 'Hz' },
  resonanz: { label: 'Resonance' }, env_mod: { label: 'Env Mod' }, decay: { label: 'Decay', einheit: 's' }, accent: { label: 'Accent' },
};
function rb338Tabelle(): Parameter[] {
  return Object.entries(RB_DEFS).map(([name, d]) => {
    const a = RB_ANZEIGE[name] as { label: string; einheit?: string; stufen?: string[] };
    const vorgabe = RB_VORGABE_NORM7[name] as number;
    const kopf = { name, label: a.label, ...(a.einheit ? { einheit: a.einheit } : {}), vorgabe, ...(a.stufen ? { stufen: [...a.stufen] } : {}) };
    if (d.art === 'schalter') return { ...kopf, min: 0, max: 1, log: false };
    if (d.art === 'linear') return { ...kopf, min: d.min, max: d.max, log: false };
    return name === 'lautstaerke' ? { ...kopf, min: -48, max: 0, log: false, skew: d.faktor, gainDb: true } : { ...kopf, min: d.min, max: d.max, log: false, skew: d.faktor };
  });
}

function bkTabelle(graph: string, ordner: string): Parameter[] {
  let g: unknown;
  try { g = JSON.parse(fs.readFileSync(path.join(ordner, `${graph}.json`), 'utf8')); } catch { return []; }
  const namen = findeGraph(graph, ordner)?.regler_namen ?? {};
  const bereiche = reglerBereiche(g);
  return Object.keys(bereiche).map(Number).sort((a, b) => a - b).map((n) => {
    const b = bereiche[String(n)] as ReglerBereich;
    return { name: `k${n}`, label: kuerze(namen[String(n)] || `Knob ${n}`, 24), min: b.min, max: b.max, log: b.log, vorgabe: b.vorgabe, ...(b.mitte !== undefined ? { mitte: b.mitte } : {}) };   // the graph's start position, 0.5 without a `vorgabe`
  });
}

/** Units of Surge parameters that are MEASURED (plan 2026-11-11 task 9, `~/messungen/2026-11-11-oberflaechen/surge-fenster.md`): envelope times display x = 2^x seconds
 *  (`log2 s`), mixer levels and volume are amplitude = x^3 (`amp3`, shown in dB). Cutoff, pitch, LFO rate, glide and sends are not confirmed and stay bare. */
const SURGE_EINHEIT: [RegExp, string][] = [[/^[ab]_env[12]_(attack|decay|release)$/, 'log2 s'], [/^[ab]_(level_(o1|o2|o3|noise|ring12|ring23)|volume)$/, 'amp3']];

function surgeTabelle(datei: string): Parameter[] {
  let roh: { parameter?: Record<string, { carla?: string; punkte?: number[] }> };
  try { roh = JSON.parse(fs.readFileSync(datei, 'utf8')); } catch { return []; }
  return Object.entries(roh.parameter ?? {}).map(([name, p]) => {
    const pk = Array.isArray(p.punkte) && p.punkte.length ? p.punkte : [0, 1];
    const einheit = SURGE_EINHEIT.find(([re]) => re.test(name))?.[1];
    return { name, label: kuerze(p.carla || name, 24), min: pk[0] as number, max: pk[pk.length - 1] as number, log: false, vorgabe: 0.5, punkte: pk, ...(einheit ? { einheit } : {}) };
  });
}

/** The parameters of a device: bk k<n> of the graph's `regler` nodes in knob order (label from `regler_namen`, else `Knob n`), rb338 the seven
 *  plug-in ids in source order, surge every key of surge_bereiche.json. An unknown or unreadable graph gives []. */
export function parameterTabelle(geraet: Geraet, ordner: string = graphenOrdner(), surgeDatei: string = REPO_PFADE.surgeBereiche): Parameter[] {
  if (geraet.art === 'rb338') return rb338Tabelle();
  if (geraet.art === 'surge') return surgeTabelle(surgeDatei);
  return GRAPH_NAME.test(geraet.graph) ? bkTabelle(geraet.graph, ordner) : [];
}

/** Accent of each family (the register stores the result per device; `device.ts neu` takes it from here). */
export const FAMILIEN: Record<string, string> = { drums: 'rot', mono: 'orange', poly: 'blau', neuro: 'violett', fx: 'tuerkis' };

// ---- device register: djk/instruments/modular_dsp/geraete.json (single source of family and accent) ----
export type RegisterEintrag = { name: string; art: 'bk' | 'rb338' | 'surge'; familie: string; akzent: string; doku: string };
/** The directories of a repo copy (`wurzel`, default the repo this file lives in). Tests and `device.ts --wurzel` point it at a temp copy. */
export function pfadeVon(wurzel: string = REPO) {
  const bk = path.join(wurzel, 'djk', 'instruments', 'modular_dsp');
  return { wurzel, bk, surge: path.join(wurzel, 'djk', 'hosts', 'carla', 'surge_bereiche.json'), register: path.join(bk, 'geraete.json'), beispiele: path.join(bk, 'demos'), paneele: path.join(bk, 'paneele'), kategorien: path.join(bk, 'kategorien.json'),
    doku: path.join(wurzel, 'docs', 'presets', 'devices'), werkPresets: path.join(wurzel, 'djk', 'ui', 'presets', 'werk', 'baukasten') };
}
export function ladeRegister(wurzel: string = REPO): RegisterEintrag[] {
  try { const r = JSON.parse(fs.readFileSync(pfadeVon(wurzel).register, 'utf8')); return Array.isArray(r) ? r : []; } catch { return []; }
}
/** The register as `neu` needs it: throws when the file is missing, not valid JSON or not a list (the lenient ladeRegister would answer []). */
export function ladeRegisterStreng(wurzel: string = REPO): RegisterEintrag[] {
  const datei = pfadeVon(wurzel).register;
  let r: unknown;
  try { r = JSON.parse(fs.readFileSync(datei, 'utf8')); } catch (e) { throw new Error(`register ${datei} cannot be read (${(e as Error).message}); nothing written`); }
  if (!Array.isArray(r)) throw new Error(`register ${datei} is not a list; nothing written`);
  return r as RegisterEintrag[];
}
export const geraetName = (g: Geraet): string => (g.art === 'bk' ? g.graph : g.art);
const eintragVon = (g: Geraet) => ladeRegister().find((e) => e.art === g.art && e.name === geraetName(g));

function akzentVon(geraet: Geraet): string {
  const e = eintragVon(geraet);   // listed devices: the register decides
  if (e && AKZENTE.includes(e.akzent)) return e.akzent;
  if (geraet.art === 'rb338') return 'gelb';   // fallbacks for devices the register does not list
  if (geraet.art === 'surge') return 'gruen';
  const n = geraet.graph;
  if (/^drums/.test(n)) return 'rot';
  if (/^fx-/.test(n)) return 'tuerkis';
  return findeGraph(n)?.art === 'effekt' ? 'tuerkis' : 'orange';
}
export { AKZENTE };

/** A valid cypherdj-panel/2 for the table: sections of at most 8 controls in parameter order, a knob per parameter (a selector for `stufen`). */
export function autoPanel(geraet: Geraet, parameter: Parameter[], titel: string): Record<string, unknown> {
  const sections: unknown[] = [];
  const ids = new Set<string>();
  for (let s = 0; s * SEITE < parameter.length; s++) {
    const teil = parameter.slice(s * SEITE, (s + 1) * SEITE);
    const von = s * SEITE + 1;
    const controls = teil.map((p, i) => {
      let id = /^[a-z0-9_-]{1,24}$/.test(p.name) && !ids.has(p.name) ? p.name : `p${von + i}`;
      while (ids.has(id)) id += '_';
      ids.add(id);
      const c: Record<string, unknown> = { id, label: kuerze(p.label, 24), bind: { param: p.name } };
      if (p.stufen && p.stufen.length >= 2) {
        c.type = 'selector';
        c.options = p.stufen.slice(0, 8).map((o) => kuerze(o, 12));
        c.default = Math.min(c.options.length - 1, Math.max(0, Math.round(p.vorgabe * (p.stufen.length - 1))));
      } else {
        c.type = 'knob';
        if (p.vorgabe !== 0.5) c.default = p.vorgabe;   // 0.5 is what the control table starts with anyway
        if (p.einheit) c.unit = kuerze(p.einheit, 8);
      }
      return c;
    });
    sections.push({ id: `s${s + 1}`, title: `${geraet.art === 'bk' ? 'KNOBS' : 'PARAMETERS'} ${von}-${von + teil.length - 1}`, cols: Math.min(4, teil.length), controls });
  }
  return { format: 'cypherdj-panel/2', geraet, title: kuerze(titel || 'Device', 40), akzent: akzentVon(geraet), sections };
}

export type GeraetePanel = { geraet: Geraet; parameter: Parameter[]; panel: Record<string, unknown> | null; quelle: 'datei' | 'auto'; fehler: string[] };

/** The hand panel of rb338 or surge: `<graph folder>/panels/<art>.json` (installed by djk-start from paneele/). {panel, fehler}: panel null when the file is
 *  missing (no fehler) or refused (fehler says why). */
function ladeGeraetePanelDatei(geraet: { art: 'rb338' | 'surge' }, parameter: Parameter[]): { panel: Record<string, unknown> | null; fehler: string[] } {
  let roh: string;
  try { roh = fs.readFileSync(path.join(panelOrdner(), `${geraet.art}.json`), 'utf8'); } catch { return { panel: null, fehler: [] }; }
  let panel: unknown;
  try { panel = JSON.parse(roh); } catch { return { panel: null, fehler: ['the panel file is not valid JSON'] }; }
  const normal = normalisierePanel(panel);
  const fehler = pruefePanel(normal, geraet.art, {}, parameter.map((p) => p.name));
  const g = (normal as { geraet?: { art?: unknown } }).geraet;
  if (g?.art !== geraet.art) fehler.push(`geraet.art is "${String(g?.art)}" but the panel belongs to "${geraet.art}"`);
  return { panel: fehler.length ? null : normal, fehler };
}

/** Answer of GET /geraete/panel. A valid hand panel file wins (quelle 'datei'): bk from the graph's panels/<name>.json, rb338 and surge from
 *  panels/<art>.json. Missing or invalid: the automatic panel (quelle 'auto'), `fehler` lists the file's problems. panel is null only when the device
 *  exposes no parameter. */
export function geraetePanel(geraet: Geraet, titel?: string): GeraetePanel {
  const parameter = parameterTabelle(geraet);
  let fehler: string[] = [];
  if (geraet.art === 'bk') {
    const datei = ladePanel(geraet.graph);
    if (datei?.panel) return { geraet, parameter, panel: datei.panel, quelle: 'datei', fehler: [] };
    fehler = datei?.fehler ?? [];
  } else {
    const datei = ladeGeraetePanelDatei(geraet, parameter);
    if (datei.panel) return { geraet, parameter, panel: datei.panel, quelle: 'datei', fehler: [] };
    fehler = datei.fehler;
  }
  const t = titel ?? (geraet.art === 'bk' ? geraet.graph : geraet.art === 'rb338' ? 'RB-338' : 'Surge');
  return { geraet, parameter, panel: parameter.length ? autoPanel(geraet, parameter, t) : null, quelle: 'auto', fehler };
}

/** Completeness of the device register under `wurzel`: one line per problem, [] when everything is in order. Per entry: the register fields, the
 *  doc file, a hand panel in paneele/ that is v2, valid against the device's parameter table, and whose accent equals the register's. */
export function pruefeGeraete(wurzel: string = REPO): string[] {
  const f: string[] = [];
  const P = pfadeVon(wurzel);
  let roh: unknown;
  try { roh = JSON.parse(fs.readFileSync(P.register, 'utf8')); } catch { return [`register ${P.register} is missing or not valid JSON`]; }
  if (!Array.isArray(roh)) return ['register is not a list'];
  const gesehen = new Set<string>();
  for (const e of roh as Partial<RegisterEintrag>[]) {
    const name = String(e?.name ?? '');
    if (!/^[a-z0-9_-]{1,32}$/.test(name)) { f.push(`register entry "${name}": name must match [a-z0-9_-]{1,32}`); continue; }
    if (gesehen.has(name)) { f.push(`${name}: listed twice`); continue; }
    gesehen.add(name);
    if (!GERAET_ARTEN.includes(e.art as string)) { f.push(`${name}: art must be one of ${GERAET_ARTEN.join(', ')}`); continue; }
    if (!Object.keys(FAMILIEN).includes(String(e.familie))) f.push(`${name}: familie must be one of ${Object.keys(FAMILIEN).join(', ')}`);
    if (!AKZENTE.includes(String(e.akzent))) f.push(`${name}: akzent must be one of ${AKZENTE.join(', ')}`);
    if (typeof e.doku !== 'string' || !e.doku || !fs.existsSync(path.join(wurzel, e.doku))) f.push(`${name}: no doc file (${String(e.doku)})`);
    const datei = path.join(P.paneele, `${name}.json`);
    if (!fs.existsSync(datei)) { f.push(`${name}: no panel`); continue; }
    let panel: unknown;
    try { panel = JSON.parse(fs.readFileSync(datei, 'utf8')); } catch { f.push(`${name}: panel is not valid JSON`); continue; }
    const geraet: Geraet = e.art === 'bk' ? { art: 'bk', graph: name } : { art: e.art as 'rb338' | 'surge' };
    if ((panel as { format?: unknown })?.format !== 'cypherdj-panel/2') f.push(`${name}: panel must be cypherdj-panel/2`);
    const tabelle = parameterTabelle(geraet, P.beispiele, P.surge);
    let regler = {};
    if (e.art === 'bk') {
      try { regler = reglerBereiche(JSON.parse(fs.readFileSync(path.join(P.beispiele, `${name}.json`), 'utf8'))); } catch { f.push(`${name}: no graph in beispiele/`); continue; }
    }
    const pg = (normalisierePanel(panel) as { geraet?: { art?: unknown; graph?: unknown } })?.geraet;
    if (pg?.art !== e.art || (e.art === 'bk' && pg?.graph !== name)) f.push(`${name}: panel geraet is ${JSON.stringify(pg ?? null)} but the register says ${JSON.stringify(geraet)}`);
    for (const m of pruefePanel(normalisierePanel(panel), name, regler, tabelle.map((p) => p.name))) f.push(`${name}: panel: ${m}`);
    const ak = (panel as { akzent?: unknown })?.akzent;
    if (ak !== e.akzent) f.push(`${name}: panel akzent ${String(ak)} differs from the register (${String(e.akzent)})`);
  }
  return f;
}
