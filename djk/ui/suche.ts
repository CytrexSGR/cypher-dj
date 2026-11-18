// One search across the shelf (media browser slice B4): GET /suche. The engine asks the sources the shelf already has, each with its own search
// logic (the catalogue through Katalog.seite, the small own lists filtered in memory); there is no new index and no new database.
// A hit carries the fields of the row the shelf draws for that kind, so the page renders it with its existing row code.
import { camelotNachbarn, Katalog, KatalogFehler, type Filter, type Typ, type Vorrang, type Zeile } from './catalog.ts';
import type { GraphEintrag } from './graphs.ts';
import { suchTerme } from './search_text.ts';

export const ARTEN = ['samples', 'loops', 'instrumente', 'geraete', 'presets', 'module', 'schnitte'] as const;
export type Art = (typeof ARTEN)[number];
export const GRUPPEN_NAME: Record<Art, string> = {
  samples: 'Samples', loops: 'Loops', instrumente: 'Instruments', geraete: 'Devices', presets: 'Presets', module: 'Modules', schnitte: 'Cuts',
};
export const JE_VORGABE = 5, JE_MAX = 50;
export const Q_MAX = 200;
/** What "fits the running music" means for one request: the project tempo and its key on the Camelot wheel (null: the project has no usable key). */
export interface Passt { bpm: number; camelot: string | null }
export interface Anfrage { q: string; je: number; passt: Passt | null }
export type Gruppe = { art: Art; name: string; zahl: number; treffer: Record<string, unknown>[]; fehler?: string };
export type Quelle = (a: Anfrage & { woerter: string[] }) => { zahl: number; treffer: Record<string, unknown>[] } | Promise<{ zahl: number; treffer: Record<string, unknown>[] }>;
export type Quellen = Record<Art, Quelle>;

// Folding for the in-memory lists: Unicode-normalised lower case. Symbols stay what they are: there is no pattern language here.
export const faltung = (s: string): string => s.normalize('NFC').toLowerCase();
export const woerterVon = (q: string): string[] => faltung(q).split(/\s+/).filter(Boolean);
export const trifftAlle = (heuhaufen: string, woerter: readonly string[]): boolean => { const h = faltung(heuhaufen); return woerter.every((w) => h.includes(w)); };

const CAMELOT_MOLL = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];   // Camelot number of the minor key on each pitch class (C = 0)
/** The key of the project on the Camelot wheel; only major and minor sit on it, every other scale has none. */
export function camelotVon(t: { grundton?: unknown; skala?: unknown } | null | undefined): string | null {
  if (!t || !Number.isInteger(t.grundton) || (t.skala !== 'minor' && t.skala !== 'major')) return null;
  const pk = (t.grundton as number) % 12;
  if (pk < 0) return null;
  return t.skala === 'minor' ? `${CAMELOT_MOLL[pk]}A` : `${CAMELOT_MOLL[(pk + 9) % 12]}B`;
}
/** Tempo within 6 percent of the project tempo, of half of it or of double it. */
export const tempoBereiche = (bpm: number): [number, number][] => [1, 0.5, 2].map((f) => [bpm * f * 0.94, bpm * f * 1.06] as [number, number]);

export async function suche(quellen: Quellen, a: Anfrage, arten: readonly Art[]): Promise<{ q: string; gruppen: Gruppe[] }> {
  const woerter = woerterVon(a.q);
  const gewollt = ARTEN.filter((x) => arten.includes(x));
  const gruppen = await Promise.all(gewollt.map(async (art): Promise<Gruppe> => {
    try {
      const r = await quellen[art]({ ...a, woerter });
      return { art, name: GRUPPEN_NAME[art], zahl: r.zahl, treffer: r.treffer.slice(0, a.je) };
    } catch (e) {
      // a source that fails is an empty group with its reason; the message of an internal error stays in the server
      return { art, name: GRUPPEN_NAME[art], zahl: 0, treffer: [], fehler: e instanceof KatalogFehler ? e.fehler : 'suche_quelle' };
    }
  }));
  return { q: a.q, gruppen };
}

export interface SucheDeps {
  katalog: Katalog;
  /** Folders of this catalogue type that are not reachable now (the priority order puts their files last). */
  fehlend(typ: Typ): string[];
  rang(): { tabelle: ReadonlyMap<string, number>; favorit(sha: string): boolean };
  /** The row of the shelf for a catalogue row (what GET /stoebern gives). */
  zeile(z: Zeile, favorit: boolean): Record<string, unknown>;
  graphen(): readonly GraphEintrag[];
  /** The rows of GET /sampler/instrumente. */
  instrumente(): Record<string, unknown>[];
  /** The rows of GET /sampler/liste (cuts). */
  schnitte(): Record<string, unknown>[];
  /** The presets that match q by the preset store's own search. */
  presets(q: string): Record<string, unknown>[];
  /** The entries of GET /proj/liste. */
  module(): Record<string, unknown>[];
}

const GENERIERT = /^(ins|smp|ton)-/;   // graphs the sampler builds for its instruments and cuts: the instruments and cuts are listed themselves
const nach = (a: string, b: string): number => a.localeCompare(b, 'en', { sensitivity: 'base' });
// SQLite COLLATE NOCASE (the catalog's name order): ASCII letters folded, everything else by code point
const nocase = (a: string, b: string): number => { const x = a.replace(/[A-Z]/g, (c) => c.toLowerCase()), y = b.replace(/[A-Z]/g, (c) => c.toLowerCase()); return x < y ? -1 : x > y ? 1 : 0; };
const text = (x: unknown): string => (typeof x === 'string' ? x : '');

function katalogQuelle(d: SucheDeps, typ: Typ): Quelle {
  return ({ q, je, passt }) => {
    const t = suchTerme(q);
    if (t.terme.length === 0 && t.ordner.length === 0) {   // symbols only: nothing (not everything); a missing file still shows
      if (!d.katalog.vorhanden()) throw new KatalogFehler(503, 'katalog_fehlt');
      return { zahl: 0, treffer: [] };
    }
    const rang = d.rang();
    const fehlend = d.fehlend(typ);
    const vorrang: Vorrang = { fehlend, rang: rang.tabelle };
    const basis: Filter = { text: q, ohneSchutz: true };
    const hole = (f: Filter): { zeilen: Zeile[]; gesamt: number } => d.katalog.seite(typ, f, 'name', false, 0, je, vorrang);
    if (!passt) { const r = hole(basis); return { zahl: r.gesamt, treffer: r.zeilen.map((z) => d.zeile(z, rang.favorit(z.sha))) }; }
    // FITS: the catalogue filter takes one range, so each range is asked (they never overlap) and the rows are merged in the shelf's order
    // almost no catalog loop carries a key (measured 2026-11-17: 1 of 8 116): a row without a key passes, only a far key is dropped
    const key: Filter = passt.camelot ? { camelot: passt.camelot, nachbarn: true, keyOffen: true } : {};
    let zahl = 0; const sicht = new Map<string, Zeile>();
    for (const b of tempoBereiche(passt.bpm)) {
      const r = hole({ ...basis, ...key, bpm: b });
      zahl += r.gesamt;
      for (const z of r.zeilen) sicht.set(z.sha, z);
    }
    const weg = (z: Zeile): number => (z.ordner === null || fehlend.includes(z.ordner) ? 1 : 0);
    const zeilen = [...sicht.values()].sort((x, y) => weg(x) - weg(y) || (rang.tabelle.get(x.sha) ?? 1000) - (rang.tabelle.get(y.sha) ?? 1000)
      || nocase(text(x.name), text(y.name)) || x.id - y.id);
    return { zahl, treffer: zeilen.slice(0, je).map((z) => d.zeile(z, rang.favorit(z.sha))) };
  };
}

const gefiltert = (liste: Record<string, unknown>[], woerter: string[], feld: (x: Record<string, unknown>) => string): Record<string, unknown>[] =>
  liste.filter((x) => trifftAlle(feld(x), woerter));

export function baueQuellen(d: SucheDeps): Quellen {
  return {
    samples: katalogQuelle(d, 'oneshot'),
    loops: katalogQuelle(d, 'loop'),
    instrumente: ({ woerter }) => {
      // the sampler's instruments (the rows of the INSTRUMENTS tab, newest first) and the Baukasten instrument graphs
      const smp = gefiltert(d.instrumente(), woerter, (x) => text(x.name))
        .sort((x, y) => text(y.erstellt).localeCompare(text(x.erstellt)) || nach(text(x.name), text(y.name)));
      const bk = d.graphen().filter((g) => g.art === 'instrument' && !GENERIERT.test(g.name) && trifftAlle(`${g.name} ${g.kategorie ?? ''} ${g.text ?? ''}`, woerter))
        .map((g) => ({ name: g.name, art: g.art, ...(g.kategorie ? { kategorie: g.kategorie } : {}), ...(g.text ? { text: g.text } : {}) }));
      return { zahl: smp.length + bk.length, treffer: [...smp, ...bk] };
    },
    geraete: ({ woerter }) => {
      const t = d.graphen().filter((g) => g.art === 'effekt' && !GENERIERT.test(g.name) && trifftAlle(`${g.name} ${g.kategorie ?? ''} ${g.text ?? ''}`, woerter))
        .map((g) => ({ name: g.name, art: g.art, ...(g.kategorie ? { kategorie: g.kategorie } : {}), ...(g.text ? { text: g.text } : {}) }));
      return { zahl: t.length, treffer: t };
    },
    presets: ({ q }) => { const t = d.presets(q); return { zahl: t.length, treffer: t }; },
    module: ({ woerter }) => {
      // the shelf lists the workbench modules, and a broken entry so that the person sees it
      const t = gefiltert(d.module().filter((x) => x.werkbank === true || x.fehler !== undefined), woerter, (x) => text(x.name))
        .sort((x, y) => nach(text(x.name), text(y.name)));
      return { zahl: t.length, treffer: t };
    },
    schnitte: ({ woerter }) => { const t = gefiltert(d.schnitte(), woerter, (x) => text(x.name)); return { zahl: t.length, treffer: t }; },
  };
}
