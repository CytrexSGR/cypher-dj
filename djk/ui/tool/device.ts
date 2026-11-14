// Device tool: `node tool/device.ts neu <name> --von <existing graph> [--familie drums|mono|poly|neuro|fx] [--wurzel DIR]` starts a device as a copy
// of a working one (graph, panel, doc, register entry); `node tool/device.ts pruefen [--wurzel DIR]` checks that every device is complete and exits 1 with
// one line per problem. --wurzel points both at another repo root (tests use a temp copy). See docs/devices/VORLAGE.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAPH_NAME, findeGraph, listeGraphen, pruefePanel, normalisierePanel, reglerBereiche, pruefeKategorien, KATEGORIE_TEXT_MAX } from '../graphs.ts';
import { FAMILIEN, autoPanel, parameterTabelle, pfadeVon, pruefeGeraete, ladeRegister, ladeRegisterStreng, type Geraet, type RegisterEintrag } from '../devices_parameter.ts';
import { REPO } from '../paths.ts';


/** Markdown table of a panel's controls: section, control, parameter, range (from the parameter table). */
export function knobTabelle(panel: Record<string, unknown>, geraet: Geraet, ordner: string): string {
  const par = new Map(parameterTabelle(geraet, ordner).map((p) => [p.name, p]));
  const zeilen = ['| Section | Control | Parameter | Range |', '|---|---|---|---|'];
  for (const s of (panel.sections ?? []) as { title?: string; id: string; controls: Record<string, unknown>[] }[]) {
    for (const c of s.controls) {
      const b = (c.bind ?? {}) as Record<string, unknown>;
      const namen = c.type === 'xy' ? [(b.x as { param?: string })?.param, (b.y as { param?: string })?.param] : c.type === 'touchpad' ? [(b.x as { param?: string })?.param, (b.touch as { param?: string })?.param] : [b.param as string | undefined];
      const ps = namen.filter((x): x is string => typeof x === 'string');
      if (!ps.length) continue;
      const bereich = ps.map((n) => { const p = par.get(n); return !p ? '?' : p.stufen ? p.stufen.join(' / ') : `${p.min} .. ${p.max}${p.einheit ? ` ${p.einheit}` : ''}${p.log ? ' log' : ''}`; }).join(', ');
      zeilen.push(`| ${s.title ?? s.id} | ${String(c.label ?? c.id)} | ${ps.map((n) => `\`${n}\``).join(', ')} | ${bereich} |`);
    }
  }
  return zeilen.join('\n');
}

const DOKU_VORLAGE = (name: string, familie: string, tabelle: string, von: string) => `# GERAET-${name}: ${name}

Status: started by \`device.ts neu\` as a copy of \`${von}\`, not yet filled in. Family \`${familie}\`.

## 1. What it is

TODO: one paragraph. What does the device do, what is it for, what does it sound like.

## 2. Knob map

Generated from \`paneele/${name}.json\`. Change the graph and the panel, then regenerate this table.

${tabelle}

## 3. Play notes

TODO: which notes or MIDI channels play it, useful ranges, what to avoid.

## 4. Presets

TODO: factory presets in \`djk/ui/presets/werk/baukasten\` (graph \`${name}\`), one line each.
`;

/** Write through a temp file in the same folder and rename it, so a reader never sees half a file and a failed write leaves the old file. */
function schreibe(datei: string, text: string) {
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  const tmp = `${datei}.tmp-${process.pid}`;
  try { fs.writeFileSync(tmp, text); fs.renameSync(tmp, datei); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
}
const registerText = (r: RegisterEintrag[]) => `[\n${r.map((e) => `  ${JSON.stringify(e).replace(/":/g, '": ').replace(/,"/g, ', "')}`).join(',\n')}\n]\n`;

/** Start a device as a copy of the graph `von`: graph (renamed), panel (graph renamed, title = name; the automatic panel when `von` has none), doc from the
 *  template with the knob map, register entry. familie/akzent from `familie` or from the register entry of `von`. Throws (nothing written) when the
 *  source is unknown, the name is bad or taken, or no family can be found. */
export function neu(name: string, von: string, familie: string | undefined, wurzel: string = REPO): string[] {
  if (!GRAPH_NAME.test(name)) throw new Error('name must match [a-z0-9_-]{1,32}');
  const P = pfadeVon(wurzel);
  const quelle = path.join(P.beispiele, `${von}.json`);
  if (!GRAPH_NAME.test(von) || !fs.existsSync(quelle) || !findeGraph(von, P.beispiele)) throw new Error(`unknown source graph "${von}"`);
  const reg = ladeRegisterStreng(wurzel);   // a register that does not parse is never rewritten
  const vorbild = reg.find((e) => e.art === 'bk' && e.name === von);
  const fam = familie ?? vorbild?.familie;
  if (!fam || !Object.keys(FAMILIEN).includes(fam)) throw new Error(`familie must be one of ${Object.keys(FAMILIEN).join(', ')} (${familie ? 'given' : `"${von}" is not in the register, so --familie is needed`})`);
  const graph = path.join(P.beispiele, `${name}.json`), panelDatei = path.join(P.paneele, `${name}.json`), doku = path.join(P.doku, `GERAET-${name}.md`);
  for (const [was, ok] of [['graph', fs.existsSync(graph)], ['panel', fs.existsSync(panelDatei)], ['doc', fs.existsSync(doku)], ['register entry', reg.some((e) => e.name === name)]] as const)
    if (ok) throw new Error(`${name} exists already (${was}); nothing written`);
  const akzent = (familie ? FAMILIEN[fam] : vorbild?.akzent ?? FAMILIEN[fam]) as string;
  const geschrieben: string[] = [];
  let kategorieZurueck: (() => void) | null = null;   // kategorien.json is shared: a failed run restores it instead of deleting it
  const schreibeUndMerke = (datei: string, text: string) => { schreibe(datei, text); geschrieben.push(datei); };
  try {
    const g = JSON.parse(fs.readFileSync(quelle, 'utf8')) as Record<string, unknown>;
    schreibeUndMerke(graph, JSON.stringify({ ...g, name }, null, 1) + '\n');
    const geraet: Geraet = { art: 'bk', graph: name };
    const panelQuelle = path.join(P.paneele, `${von}.json`);
    const alt = fs.existsSync(panelQuelle) ? normalisierePanel(JSON.parse(fs.readFileSync(panelQuelle, 'utf8'))) : autoPanel(geraet, parameterTabelle(geraet, P.beispiele), name);
    const panel = { ...alt, geraet, title: name.slice(0, 40), akzent };
    schreibeUndMerke(panelDatei, JSON.stringify(panel, null, 1) + '\n');
    schreibeUndMerke(doku, DOKU_VORLAGE(name, fam, knobTabelle(panel, geraet, P.beispiele), von));
    const katAlt = fs.existsSync(P.kategorien) ? fs.readFileSync(P.kategorien, 'utf8') : null;   // category and description of the source: "Copy of ..."
    let kat: Record<string, unknown> = {};
    try { const k = JSON.parse(katAlt ?? '{}'); if (k && typeof k === 'object' && !Array.isArray(k)) kat = k; } catch { /* unreadable: start a new file */ }
    const kq = kat[von] as { kategorie?: string; text?: string } | undefined;
    if (kq?.kategorie) {
      kat[name] = { kategorie: kq.kategorie, text: `Copy of ${von}: ${kq.text ?? ''}`.slice(0, KATEGORIE_TEXT_MAX) };
      schreibe(P.kategorien, JSON.stringify(Object.fromEntries(Object.entries(kat).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), null, 1) + '\n');
      geschrieben.push(P.kategorien);
      kategorieZurueck = () => { if (katAlt === null) fs.rmSync(P.kategorien, { force: true }); else fs.writeFileSync(P.kategorien, katAlt); };
    }
    reg.push({ name, art: 'bk', familie: fam, akzent, doku: path.relative(wurzel, doku) });
    schreibe(P.register, registerText(reg));   // last: only a complete device is ever listed
  } catch (e) {
    for (const d of geschrieben) if (d !== P.kategorien) fs.rmSync(d, { force: true });   // take back what this run wrote
    kategorieZurueck?.();
    throw e;
  }
  return [graph, panelDatei, doku, ...(kategorieZurueck ? [P.kategorien] : []), P.register].map((p) => path.relative(wurzel, p));
}

/** Every problem of the device set under `wurzel`, one line each ([] = complete). */
export function pruefen(wurzel: string = REPO): string[] {
  const f = pruefeGeraete(wurzel);   // register entries: fields, doc, hand panel (v2, valid, accent)
  const P = pfadeVon(wurzel);
  const listed = new Set(ladeRegister(wurzel).map((e) => e.name));
  // panels that are not registered still must bind known parameters
  for (const d of fs.existsSync(P.paneele) ? fs.readdirSync(P.paneele).filter((x) => x.endsWith('.json')) : []) {
    const name = d.slice(0, -5);
    if (listed.has(name)) continue;
    try {
      const panel = normalisierePanel(JSON.parse(fs.readFileSync(path.join(P.paneele, d), 'utf8'))) as { geraet?: Geraet };
      const art = panel?.geraet?.art;
      const geraet: Geraet = art === 'rb338' || art === 'surge' ? { art } : { art: 'bk', graph: name };
      const regler = geraet.art === 'bk' ? reglerBereiche(JSON.parse(fs.readFileSync(path.join(P.beispiele, `${name}.json`), 'utf8'))) : {};
      for (const m of pruefePanel(panel, name, regler, parameterTabelle(geraet, P.beispiele, P.surge).map((p) => p.name))) f.push(`${name}: panel: ${m}`);
    } catch (e) { f.push(`${name}: panel unreadable (${(e as Error).message})`); }
  }
  // every instrument graph needs a valid category and description in kategorien.json
  const graphen = listeGraphen(P.beispiele).graphen;
  let katRoh: unknown = null;
  try { katRoh = JSON.parse(fs.readFileSync(P.kategorien, 'utf8')); } catch { f.push(`kategorien.json is missing or not valid JSON (${path.relative(wurzel, P.kategorien)})`); }
  if (katRoh !== null) {
    const kp = pruefeKategorien(katRoh);
    for (const m of kp.fehler) f.push(`kategorien.json: ${m}`);
    for (const g of graphen) if (g.art === 'instrument' && !(g.name in kp.gueltig) && !kp.fehler.some((m) => m.startsWith(`${g.name}: `))) f.push(`${g.name}: instrument graph without a category in kategorien.json`);
  }
  // every graph with knobs: the automatic panel must be valid
  const knobs = new Map<string, Set<number>>();
  for (const g of graphen) {
    let regler = {};
    try { regler = reglerBereiche(JSON.parse(fs.readFileSync(path.join(P.beispiele, `${g.name}.json`), 'utf8'))); } catch { /* listed, so readable */ }
    const nrs = Object.keys(regler).map(Number);
    knobs.set(g.name, new Set(nrs));
    if (!nrs.length) continue;
    const geraet: Geraet = { art: 'bk', graph: g.name };
    for (const m of pruefePanel(autoPanel(geraet, parameterTabelle(geraet, P.beispiele), g.name), g.name, regler)) f.push(`${g.name}: auto panel: ${m}`);
  }
  // factory presets
  for (const d of fs.existsSync(P.werkPresets) ? fs.readdirSync(P.werkPresets).filter((x) => x.endsWith('.json')).sort() : []) {
    let p: { graph?: unknown; werte?: Record<string, unknown> };
    try { p = JSON.parse(fs.readFileSync(path.join(P.werkPresets, d), 'utf8')); } catch { f.push(`preset ${d}: not valid JSON`); continue; }
    const graph = String(p.graph ?? '');
    if (!findeGraph(graph, P.beispiele)) { f.push(`preset ${d}: graph "${graph}" does not exist`); continue; }
    const vorhanden = knobs.get(graph) ?? new Set<number>();
    const zu = Object.keys(p.werte ?? {}).map((k) => /^knob(\d+)$/.exec(k)).filter((m): m is RegExpExecArray => !!m).map((m) => Number(m[1])).filter((n) => !vorhanden.has(n));
    if (zu.length) f.push(`preset ${d}: knob${Math.min(...zu)} is no knob of graph ${graph} (it has ${[...vorhanden].sort((a, b) => a - b).join(',') || 'none'})`);
  }
  return f;
}

function main(argv: string[]): number {
  const opt = (n: string): string | undefined => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const usage = 'usage: device.ts neu <name> --von <graph> [--familie drums|mono|poly|neuro|fx] [--wurzel DIR] | device.ts pruefen [--wurzel DIR]';
  for (const o of ['wurzel', 'von', 'familie']) {
    const i = argv.indexOf(`--${o}`);
    if (i >= 0 && (argv[i + 1] === undefined || argv[i + 1]!.startsWith('--'))) { console.error(`geraet: --${o} needs a value\n${usage}`); return 2; }
  }
  const wurzel = path.resolve(opt('wurzel') ?? REPO);
  const [cmd, name] = argv;
  try {
    if (cmd === 'neu' && name) {
      const von = opt('von');
      if (!von) throw new Error('--von <existing graph> is required');
      for (const d of neu(name, von, opt('familie'), wurzel)) console.log(`wrote ${d}`);
      return 0;
    }
    if (cmd === 'pruefen') {
      const f = pruefen(wurzel);
      for (const z of f) console.log(z);
      if (!f.length) console.log('geraet pruefen: complete');
      return f.length ? 1 : 0;
    }
  } catch (e) { console.error(`geraet: ${(e as Error).message}`); return 1; }
  console.error(usage);
  return 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
