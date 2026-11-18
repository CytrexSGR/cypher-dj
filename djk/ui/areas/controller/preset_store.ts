// Controller presets on disk: one small JSON file per preset, for two roots.
//   werk   - factory presets, plain files in the repository (areas/controller/werk/<model>/<slug>.json), read-only here; the folder may be absent or empty
//   nutzer - user presets in <controller folder>/presets/<model>/<slug>.json, written only by this class (atomic: temp file + rename)
// Two kinds: `instrument` (bound to a graph, entries name a control of the device and a knob number, resolved onto a base when applied) and `fest`
// (a snapshot of a place's table with absolute targets). A control is named by its catalogue name (Enc 1, K1 ...), so a preset does not care on which
// channel a port sends it. Ids: `werk:<model>/<slug>` or `nutzer:<model>/<slug>`. For an instrument preset the slug is the graph name, so there is at
// most one user file and one factory file per (model, graph); a user file wins. A file that does not parse or has the wrong shape is left out of the
// list and never repaired. Delete moves the file into <nutzer>/.papierkorb.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { schreibeAtomar } from '../devices/edges.ts';
import { LernFehler } from '../learn/store.ts';

export const WERK_VORGABE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'werk');
export type PresetArt = 'instrument' | 'fest';
export type Herkunft = 'werk' | 'nutzer';
/** `stufen` (2..16): the control is a button or pad that steps the knob through that many positions (a selector with N options). */
export interface InstrumentEintrag { regler: string; knopf: number; stufen?: number }
export interface FestEintrag { regler: string; pfad: string }
interface Kopf { schema: 1; name: string; modell: string }
/** `seiten`: the entries per page of the synth's panel (page id of the panel file: main, mod, fx ...). A place that follows a focus with a page takes the
 *  entries of that page; `eintraege` is what it takes when the focus names no page or the preset has none for it. */
/** A program: what the controls of the device drive at one time. `seite` is the panel page it belongs to (the device window shows that page). */
export interface Programm { name: string; seite?: string; eintraege: InstrumentEintrag[] }
/** `programme`: the programs of the synth in order (Page up/down on the device steps through them); a place that follows takes the entries of its
 *  current program. Without programs the entries per page (`seiten`) and then `eintraege` are taken. */
export type InstrumentPreset = Kopf & { art: 'instrument'; graph: string; eintraege: InstrumentEintrag[]; seiten?: Record<string, InstrumentEintrag[]>; programme?: Programm[] };
export type FestPreset = Kopf & { art: 'fest'; eintraege: FestEintrag[] };
export type Preset = InstrumentPreset | FestPreset;
export interface PresetZeile { id: string; name: string; modell: string; art: PresetArt; graph?: string; herkunft: Herkunft; eintraege_zahl: number }

export const SLUG = /^[a-z0-9-]{1,48}$/;
export const MODELL = /^[a-z0-9-]{1,16}$/;
const ID = /^(werk|nutzer):([a-z0-9-]{1,16})\/([a-z0-9-]{1,48})$/;
const NAME_MAX = 60;
const EINTRAEGE_MAX = 64;
const DATEI_MAX = 64 * 1024;
export const SEITE = /^[a-z0-9_-]{1,24}$/;   // a page id of a panel file
const SEITEN_MAX = 12;
const PROGRAMME_MAX = 16;

/** The slug of a name: lower case, every run of other characters becomes one `-`, no `-` at the ends, at most 48 characters; '' when nothing is left. */
export function slugVon(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 48).replace(/-+$/, '');
}

const istObjekt = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const ungueltig = (t: string): LernFehler => new LernFehler('argument_ungueltig', 400, t);
const unbekannt = (): LernFehler => new LernFehler('preset_unbekannt', 404);

/** The preset in `x` or null when it is not a well-formed preset file. Strict on shape (so a foreign file is no preset), nothing about what the entries point at. */
export function alsPreset(x: unknown): Preset | null {
  if (!istObjekt(x) || x.schema !== 1 || typeof x.name !== 'string' || x.name.length < 1 || x.name.length > NAME_MAX || typeof x.modell !== 'string' || !MODELL.test(x.modell)) return null;
  if (!Array.isArray(x.eintraege) || x.eintraege.length > EINTRAEGE_MAX) return null;
  const kopf = { schema: 1 as const, name: x.name, modell: x.modell };
  if (x.art === 'instrument') {
    if (typeof x.graph !== 'string' || x.graph.length < 1 || x.graph.length > 64 || slugVon(x.graph) === '') return null;
    const e = x.eintraege;
    const gut = (l: unknown): l is Record<string, unknown>[] => Array.isArray(l) && l.length <= EINTRAEGE_MAX && l.every((z) => istObjekt(z) && typeof z.regler === 'string' && z.regler.length > 0 && z.regler.length <= 40 && Number.isInteger(z.knopf)
      && (z.stufen === undefined || (Number.isInteger(z.stufen) && (z.stufen as number) >= 2 && (z.stufen as number) <= 16)));
    const sauber = (l: Record<string, unknown>[]): InstrumentEintrag[] => l.map((z) => ({ regler: z.regler as string, knopf: z.knopf as number, ...(z.stufen !== undefined ? { stufen: z.stufen as number } : {}) }));
    if (!gut(e)) return null;
    let seiten: Record<string, InstrumentEintrag[]> | undefined;
    if (x.seiten !== undefined) {
      if (!istObjekt(x.seiten) || Object.keys(x.seiten).length > SEITEN_MAX) return null;
      seiten = {};
      for (const [id, l] of Object.entries(x.seiten)) { if (!SEITE.test(id) || !gut(l)) return null; seiten[id] = sauber(l); }
    }
    let programme: Programm[] | undefined;
    if (x.programme !== undefined) {
      if (!Array.isArray(x.programme) || x.programme.length > PROGRAMME_MAX) return null;
      programme = [];
      for (const pr of x.programme) {
        if (!istObjekt(pr) || typeof pr.name !== 'string' || pr.name.length < 1 || pr.name.length > NAME_MAX || !gut(pr.eintraege)) return null;
        if (pr.seite !== undefined && (typeof pr.seite !== 'string' || !SEITE.test(pr.seite))) return null;
        programme.push({ name: pr.name, ...(pr.seite !== undefined ? { seite: pr.seite } : {}), eintraege: sauber(pr.eintraege) });
      }
    }
    return { ...kopf, art: 'instrument', graph: x.graph, eintraege: sauber(e), ...(seiten ? { seiten } : {}), ...(programme && programme.length ? { programme } : {}) };
  }
  if (x.art === 'fest') {
    const e = x.eintraege;
    if (!e.every((z) => istObjekt(z) && typeof z.regler === 'string' && z.regler.length > 0 && z.regler.length <= 40 && typeof z.pfad === 'string' && z.pfad.length > 0 && z.pfad.length <= 64)) return null;
    return { ...kopf, art: 'fest', eintraege: e.map((z) => ({ regler: z.regler as string, pfad: z.pfad as string })) };
  }
  return null;
}

export interface SpeicherOptionen { werk?: string; nutzer: string }
export class ControllerPresets {
  readonly werk: string;
  readonly nutzer: string;
  constructor(opt: SpeicherOptionen) { this.werk = opt.werk ?? WERK_VORGABE; this.nutzer = opt.nutzer; }

  private datei(herkunft: Herkunft, modell: string, slug: string): string {
    return path.join(herkunft === 'werk' ? this.werk : this.nutzer, modell, `${slug}.json`);
  }
  private leseDatei(datei: string): Preset | null {
    try {
      if (fs.statSync(datei).size > DATEI_MAX) return null;
      return alsPreset(JSON.parse(fs.readFileSync(datei, 'utf8')));
    } catch { return null; }
  }
  private zeile(id: string, p: Preset, herkunft: Herkunft): PresetZeile {
    return { id, name: p.name, modell: p.modell, art: p.art, ...(p.art === 'instrument' ? { graph: p.graph } : {}), herkunft, eintraege_zahl: p.eintraege.length };
  }

  /** Every readable preset, the user ones first; `modell` narrows the list. */
  liste(modell?: string): PresetZeile[] {
    const aus: PresetZeile[] = [];
    for (const herkunft of ['nutzer', 'werk'] as const) {
      const wurzel = herkunft === 'werk' ? this.werk : this.nutzer;
      let modelle: string[] = [];
      try { modelle = fs.readdirSync(wurzel, { withFileTypes: true }).filter((d) => d.isDirectory() && MODELL.test(d.name)).map((d) => d.name).sort(); } catch { /* a missing folder is an empty list */ }
      for (const m of modelle) {
        if (modell !== undefined && m !== modell) continue;
        let namen: string[] = [];
        try { namen = fs.readdirSync(path.join(wurzel, m)).sort(); } catch { continue; }
        for (const n of namen) {
          const slug = n.endsWith('.json') ? n.slice(0, -5) : '';
          if (!SLUG.test(slug)) continue;   // temp files and everything that is no slug
          const p = this.leseDatei(this.datei(herkunft, m, slug));
          if (p && p.modell === m) aus.push(this.zeile(`${herkunft}:${m}/${slug}`, p, herkunft));
        }
      }
    }
    return aus;
  }

  /** The preset with this id (preset_unbekannt 404 for a malformed id, a missing or an unreadable file). */
  lies(id: string): { id: string; herkunft: Herkunft; preset: Preset } {
    const m = typeof id === 'string' ? ID.exec(id) : null;
    if (!m) throw unbekannt();
    const p = this.leseDatei(this.datei(m[1] as Herkunft, m[2], m[3]));
    if (!p || p.modell !== m[2]) throw unbekannt();
    return { id, herkunft: m[1] as Herkunft, preset: p };
  }

  /** The instrument preset of (model, graph): the user file if there is one, else the factory file; null without. */
  findeInstrument(modell: string, graph: string): { id: string; herkunft: Herkunft; preset: InstrumentPreset } | null {
    const slug = slugVon(graph);
    if (!MODELL.test(modell) || slug === '') return null;
    for (const herkunft of ['nutzer', 'werk'] as const) {
      const p = this.leseDatei(this.datei(herkunft, modell, slug));
      if (p && p.art === 'instrument' && p.graph === graph && p.modell === modell) return { id: `${herkunft}:${modell}/${slug}`, herkunft, preset: p };
    }
    return null;
  }

  /** Save as a user preset (an instrument preset by its graph, a fest preset by the slug of its name) and replace the file of that slug. Answers the id. */
  speichere(p: Preset): string {
    const ok = alsPreset(p);
    if (!ok) throw ungueltig('preset: not a valid controller preset');
    const slug = slugVon(ok.art === 'instrument' ? ok.graph : ok.name);
    if (slug === '') throw ungueltig('name: needs at least one letter or digit');
    schreibeAtomar(this.datei('nutzer', ok.modell, slug), `${JSON.stringify(ok, null, 1)}\n`);
    return `nutzer:${ok.modell}/${slug}`;
  }

  /** Remove a user preset (into the trash folder). Factory presets are never touched: werk_preset 409. */
  loesche(id: string): void {
    const m = typeof id === 'string' ? ID.exec(id) : null;
    if (!m) throw unbekannt();
    if (m[1] === 'werk') { if (!this.leseDatei(this.datei('werk', m[2], m[3]))) throw unbekannt(); throw new LernFehler('werk_preset', 409); }
    const datei = this.datei('nutzer', m[2], m[3]);
    if (!fs.existsSync(datei)) throw unbekannt();
    const korb = path.join(this.nutzer, '.papierkorb');
    fs.mkdirSync(korb, { recursive: true });
    fs.renameSync(datei, path.join(korb, `${m[2]}-${m[3]}-${Date.now()}.json`));
  }
}
