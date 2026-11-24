// Provenance relations for the tag store (made_from, used_in) and the tags derived from preset descriptions. A lazy scan: the page
// reads (GET /tags, /tags/suche) call frisch() first; it looks at presets, kits, projects and loops, rereads only what changed
// (signatures kept in stand.scan_<art>), at most once per 30 s after a scan ended. The scan runs in the background in time slices (setImmediate, about 20 ms each, one
// transaction per slice); the request that triggered it never waits for it and answers with the store as it is.
// The scan reads through narrow readers (BezugQuellen), so tests inject fakes; echteQuellen() builds the real ones from the existing
// listing functions. It never opens a project (Projekte.oeffne), it reads project.json through the read-only Projekte.lies.
// It writes only relations of herkunft 'scan' and derived tags of quelle 'preset' of its own sources; erbe, messen, melde and manual
// rows are never touched (TagSpeicher.anwendeBezuege).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { FREI, pruefeItemId, pruefeTag } from './model.ts';
import { KIT_NAME } from '../project/model.ts';
import { itemVokabular } from './vocabulary_item.ts';
import type { BezugSatz, TagSpeicher } from './store.ts';

export interface PresetQ { id: string; name: string; geraet: string; sig: string;
  beschreibung: { art?: string; unterart?: string; charakter?: string[]; genre?: string[]; einsatz?: string[]; energie?: number } | null; tags: string[] }
type Vielleicht<T> = T | Promise<T>;   // a reader may answer at once or asynchronously; the scan awaits either
export interface KitQ { name: string; sig: string; lies(): Vielleicht<{ quelle: string[] }> }
export interface ProjektInhalt { clips: string[]; zellen: string[]; presets: string[]; kits: string[]; takes: string[]; exporte: string[] }
export interface ProjektQ { slug: string; sig: string; lies(): Vielleicht<ProjektInhalt> }
export interface LoopQ { name: string; sig: string; lies(): Vielleicht<{ sha: string | null }> }
export interface BezugQuellen { presets(): Vielleicht<PresetQ[]>; kits(): Vielleicht<KitQ[]>; projekte(): Vielleicht<ProjektQ[]>; loops(): Vielleicht<LoopQ[]> }
export interface BezugOptionen { jetzt?: () => number; log?: (z: Record<string, unknown>) => void; intervallMs?: number; scheibeMs?: number }

const SHA = /^[0-9a-f]{64}$/;
// Kit sound origins that need resolving (kit.json klaenge[].quelle): a cut, a loop, a wav file path
const VERMITTELT = /^(schnitt|loop|wav):/;
const MAX_HASH_BYTES = 200 * 1024 * 1024;
const hashCache = new Map<string, string>();   // path|size|mtime -> sha256 (the file is read once per change)
const KIT_QUELLE = /^datei:([0-9a-f]{64})(?:\/[0-9]+)?$/;

// Tags of a preset description: those that fit the item vocabulary and grammar, nothing else
export function presetTags(p: PresetQ): string[] {
  const vok = itemVokabular();
  const aus = new Set<string>();
  const nimm = (t: string): void => { if (pruefeTag(t, vok)) aus.add(t); };
  const b = p.beschreibung;
  if (b) {
    if (b.unterart) nimm(`typ:${b.unterart}`);
    if (b.art) nimm(`typ:${b.art}`);
    for (const w of b.charakter ?? []) nimm(`charakter:${w}`);
    for (const w of b.genre ?? []) nimm(`genre:${w}`);
    for (const w of b.einsatz ?? []) nimm(`einsatz:${w}`);
    if (Number.isInteger(b.energie)) nimm(`energie:${b.energie}`);
  }
  for (const t of p.tags) if (typeof t === 'string' && FREI.test(t)) nimm(`frei:${t}`);
  return [...aus];
}

const presetSatz = (p: PresetQ): BezugSatz => {
  const eigner = `preset:${p.id}`;
  return { eigner, name: p.name, tags: presetTags(p), relationen: pruefeItemId(`geraet:${p.geraet}`) ? [['made_from', eigner, `geraet:${p.geraet}`]] : [] };
};
const kitSatz = (k: KitQ, quelle: string[]): BezugSatz => {
  const eigner = `kit:${k.name}`;
  const shas = new Set<string>();
  for (const q of quelle) { const m = KIT_QUELLE.exec(String(q)); if (m) shas.add(m[1]); }   // schnitt: forms and anything else is skipped
  return { eigner, name: k.name, relationen: [...shas].sort().map((s): ['made_from', string, string] => ['made_from', eigner, `datei:${s}`]) };
};
const projektSatz = (slug: string, i: ProjektInhalt): BezugSatz => {
  const eigner = `projekt:${slug}`;
  const rel: BezugSatz['relationen'] = [];
  for (const s of new Set([...i.clips, ...i.zellen])) if (SHA.test(s)) rel.push(['used_in', `datei:${s}`, eigner]);
  for (const p of new Set(i.presets)) rel.push(['used_in', `preset:${p}`, eigner]);
  for (const k of new Set(i.kits)) rel.push(['used_in', `kit:${k}`, eigner]);
  for (const f of new Set(i.takes)) rel.push(['made_from', `take:${slug}/${f}`, eigner]);
  for (const f of new Set(i.exporte)) rel.push(['made_from', `export:${slug}/${f}`, eigner]);
  return { eigner, name: slug, relationen: rel };
};
const loopSatz = (name: string, sha: string | null): BezugSatz => {
  const eigner = `loop:${name}`;
  return { eigner, name, relationen: sha !== null && SHA.test(sha) ? [['made_from', eigner, `datei:${sha}`]] : [] };
};

type Art = 'preset' | 'kit' | 'projekt' | 'loop';
interface Einheit { eigner: string; sig: string; baue(): Vielleicht<BezugSatz> }
export interface Bezuege {
  /** Starts a scan in the background when the last one is older than the interval; never blocks and never throws. */
  frisch(): void;
  /** Resolves when no scan is running (for tests and shutdown). */
  fertig(): Promise<void>;
  /** Number of time slices the scans have used so far. */
  scheiben(): number;
  /** No further slice touches the store after this. */
  stopp(): void;
}

// A slice ends after about scheibeMs of reading or after this many sources: the write of a slice (one transaction, one inheritance run) costs about 0.3 ms per source
const SCHEIBE_MAX = 10;   // measured on the real store: 50 preset writes in one transaction blocked about 100 ms, ten stay well below 50 ms
const naechste = (): Promise<void> => new Promise((ok) => setImmediate(ok));

export function bezuegeBereit(speicher: TagSpeicher, quellen: BezugQuellen, opt: BezugOptionen = {}): Bezuege {
  const jetzt = opt.jetzt ?? Date.now, log = opt.log ?? (() => {});
  const intervall = opt.intervallMs ?? 30_000, scheibeMs = opt.scheibeMs ?? 20;
  const uhr = (): number => performance.now();
  let letzte: number | null = null, lauf: Promise<void> | null = null, gestoppt = false, scheiben = 0;

  const einheiten = async (art: Art): Promise<Einheit[]> => {
    switch (art) {
      case 'preset': return (await quellen.presets()).map((p) => ({ eigner: `preset:${p.id}`, sig: p.sig, baue: () => presetSatz(p) }));
      case 'kit': return (await quellen.kits()).map((k) => ({ eigner: `kit:${k.name}`, sig: k.sig, baue: async () => kitSatz(k, (await k.lies()).quelle) }));
      case 'projekt': return (await quellen.projekte()).map((p) => ({ eigner: `projekt:${p.slug}`, sig: p.sig, baue: async () => projektSatz(p.slug, await p.lies()) }));
      case 'loop': return (await quellen.loops()).map((l) => ({ eigner: `loop:${l.name}`, sig: l.sig, baue: async () => loopSatz(l.name, (await l.lies()).sha) }));
    }
  };

  // One art. Work happens in slices of about scheibeMs: the sources of a slice are applied in ONE transaction (one inheritance run), then
  // the event loop gets its turn. The signatures are stored after each slice, so a stop or a crash loses at most that slice.
  const scanne = async (art: Art): Promise<void> => {
    if (gestoppt) return;
    await naechste();   // each kind starts in a turn of its own: the listing of one kind never follows the write of the last slice at once
    if (gestoppt) return;
    let liste: Einheit[];
    try { liste = await einheiten(art); } catch (e) { log({ typ: 'tags_scan_uebersprungen', art, fehler: (e as Error)?.message ?? String(e) }); return; }
    const schluessel = `scan_${art}`;
    let alt: Record<string, string> = {};
    try { const roh = speicher.lesStand(schluessel); if (roh) alt = JSON.parse(roh) as Record<string, string>; } catch { alt = {}; }
    const neu: Record<string, string> = { ...alt };
    const da = new Set(liste.map((e) => e.eigner));
    let saetze: BezugSatz[] = [];
    let sigs: [string, string | null][] = [];
    const leere = (): void => {
      if (saetze.length === 0 && sigs.length === 0) return;
      speicher.anwendeBezuege(saetze);
      for (const [e, g] of sigs) { if (g === null) delete neu[e]; else neu[e] = g; }
      speicher.schreibeStand(schluessel, JSON.stringify(neu));
      saetze = []; sigs = [];
    };
    const scheibe = async (start: number): Promise<number> => {
      if (uhr() - start < scheibeMs && saetze.length < SCHEIBE_MAX) return start;
      leere(); scheiben++;
      await naechste();
      return uhr();
    };
    let start = uhr();
    for (const eigner of Object.keys(alt)) {   // gone: remove what the scan wrote for it
      if (da.has(eigner)) continue;
      saetze.push({ eigner, relationen: [], ...(art === 'preset' ? { tags: [] } : {}) }); sigs.push([eigner, null]);
      start = await scheibe(start); if (gestoppt) return;
    }
    for (const e of liste) {
      if (alt[e.eigner] === e.sig) continue;
      try { const satz = await e.baue(); if (gestoppt) return; saetze.push(satz); } catch (x) {
        log({ typ: 'tags_scan_uebersprungen', art, eigner: e.eigner, fehler: (x as Error)?.message ?? String(x) });   // not read again until it changes
      }
      sigs.push([e.eigner, e.sig]);
      start = await scheibe(start); if (gestoppt) return;
    }
    if (!gestoppt) { leere(); scheiben++; }
  };

  const lauf1 = async (): Promise<void> => {
    try {
      await naechste();   // the request that started the scan answers first
      for (const art of ['preset', 'kit', 'projekt', 'loop'] as Art[]) { if (gestoppt) break; await scanne(art); }
    } catch (e) { log({ typ: 'tags_scan_fehler', fehler: (e as Error)?.message ?? String(e) }); }
    finally { letzte = jetzt(); lauf = null; }
  };

  return {
    frisch(): void {
      if (gestoppt || lauf) return;
      if (letzte !== null && jetzt() - letzte < intervall) return;
      lauf = lauf1();
    },
    fertig: async () => { while (lauf) await lauf; },
    scheiben: () => scheiben,
    stopp: () => { gestoppt = true; },
  };
}

// The real readers over the listing functions that exist already. `projekte` is the read-only Projekte (liste, lies, wurzelPfad).
export interface EchteQuellenOptionen {
  presets: { liste(): { herkunft: string; geraet: string; slug: string; name: string; tags: string[]; geaendert: string | null;
    beschreibung: PresetQ['beschreibung']; fehler?: string }[] };
  projekte: { wurzelPfad: string; liste(): { slug: string; geaendert: string; fehler?: string }[]; lies(slug: string): unknown;
    /** Reads project.json without blocking the event loop; absent: the synchronous `lies` is used. */ liesAsync?(slug: string): Promise<unknown> };
  kitsOrdner: () => string; loopOrdner: () => string;
  listeLoops: (dir: string) => { name: string }[];
  /** Catalogue sha of a material id (deck cuts write the 16 hex prefix, not the sha); null when the catalogue does not know it. */
  katalogSha?: (materialId: string) => string | null;
  /** One cut of the sampler (`<sampler>/<id>/schnitt.json`): where the sound came from. Kit pads are raw files, so their origin runs through the cut. */
  schnitt?: (id: string) => { quelle?: { art?: string; ref?: unknown } } | null;
}
const MAX_DATEIEN = 200;
const stat = (p: string): string => { try { const s = fs.statSync(p); return `${s.mtimeMs}:${s.size}`; } catch { return 'weg'; } };
const namen = (dir: string, ok: (n: string) => boolean): string[] => {
  try { return fs.readdirSync(dir).filter(ok).sort().slice(0, MAX_DATEIEN); } catch { return []; }
};

const namenAsync = async (dir: string, ok: (n: string) => boolean): Promise<string[]> => {
  try { return (await fsp.readdir(dir)).filter(ok).sort().slice(0, MAX_DATEIEN); } catch { return []; }
};

export function echteQuellen(o: EchteQuellenOptionen): BezugQuellen {
  // A loop's source file as a catalogue sha: herkunft.sha when present, else herkunft.material_id (deck cuts) through the catalogue
  const loopSha = async (dir: string, name: string): Promise<string | null> => {
    const j = JSON.parse(await fsp.readFile(path.join(dir, name, 'loop.json'), 'utf8')) as { herkunft?: { sha?: unknown; material_id?: unknown } | null };
    const h = j.herkunft;
    if (typeof h?.sha === 'string' && SHA.test(h.sha)) return h.sha;
    if (typeof h?.material_id === 'string' && h.material_id !== '' && o.katalogSha) { try { return o.katalogSha(h.material_id); } catch { return null; } }
    return null;
  };
  const schnittSha = async (id: string): Promise<string | null> => {
    const q = o.schnitt?.(id)?.quelle;
    if (!q || typeof q.ref !== 'string') return null;
    if (q.art === 'katalog') return SHA.test(q.ref) ? q.ref : null;
    if (q.art === 'loop') { try { return await loopSha(o.loopOrdner(), q.ref); } catch { return null; } }
    return null;   // datei (a path) and modul have no catalogue sha
  };
  // A wav path is the catalogue's own key: the sha256 of the file is the catalogue sha (measured: 12 of 12 catalogued files). Read as a stream, never in one block.
  const dateiSha = async (p: string): Promise<string | null> => {
    try {
      const st = await fsp.stat(p);
      if (!st.isFile() || st.size > MAX_HASH_BYTES) return null;
      const k = `${p}|${st.size}|${st.mtimeMs}`;
      const alt = hashCache.get(k);
      if (alt) return alt;
      const h = createHash('sha256');
      for await (const stueck of fs.createReadStream(p)) h.update(stueck as Buffer);
      const sha = h.digest('hex');
      hashCache.set(k, sha);
      return sha;
    } catch { return null; }
  };
  // A kit pad's origin as a catalogue sha, from the forms the real kits use; null = not resolvable
  const quelleSha = async (q: string): Promise<string | null> => {
    const m = /^(schnitt|loop|wav):(.+)$/.exec(q);
    if (!m) return null;
    if (m[1] === 'schnitt') { const c = /^([^/]+)\/[0-9]+$/.exec(m[2]); return c ? schnittSha(c[1]) : null; }   // the pad file itself matches no catalogue sha
    if (m[1] === 'loop') { try { return await loopSha(o.loopOrdner(), m[2]); } catch { return null; } }
    return (await dateiSha(m[2])) ?? (await dateiSha(m[2].replace(/\/[0-9]+$/, '')));
  };
  return {
    presets: () => o.presets.liste().filter((e) => e.fehler === undefined).map((e) => ({
      id: `${e.herkunft}:${e.geraet}/${e.slug}`, name: e.name, geraet: e.geraet, sig: String(e.geaendert), beschreibung: e.beschreibung, tags: e.tags })),
    kits: () => { const dir = o.kitsOrdner(); return namen(dir, (n) => KIT_NAME.test(n) && fs.existsSync(path.join(dir, n, 'kit.json'))).map((n) => ({ name: n })).map((k) => ({ name: k.name, sig: stat(path.join(dir, k.name, 'kit.json')), lies: async () => {
      const j = JSON.parse(await fsp.readFile(path.join(dir, k.name, 'kit.json'), 'utf8')) as { klaenge?: { quelle?: unknown }[] };
      const aus: string[] = [];
      for (const x of j.klaenge ?? []) {
        if (typeof x.quelle !== 'string') continue;
        const sha = await quelleSha(x.quelle);
        if (sha) aus.push(`datei:${sha}`); else if (!VERMITTELT.test(x.quelle)) aus.push(x.quelle);   // datei:<sha> passes on; unresolvable forms give nothing
      }
      return { quelle: aus };
    } })); },
    loops: () => { const dir = o.loopOrdner(); return o.listeLoops(dir).map((l) => ({ name: l.name, sig: stat(path.join(dir, l.name, 'loop.json')), lies: async () => ({ sha: await loopSha(dir, l.name) }) })); },
    projekte: () => o.projekte.liste().filter((p) => p.fehler === undefined).map((p) => {
      const ordner = path.join(o.projekte.wurzelPfad, p.slug);
      return { slug: p.slug, sig: `${p.geaendert}|${stat(path.join(ordner, 'aufnahmen'))}|${stat(path.join(ordner, 'export'))}`,
        lies: async () => projektInhalt(o.projekte.liesAsync ? await o.projekte.liesAsync(p.slug) : o.projekte.lies(p.slug), ordner) };
    }),
  };
}

/** project.json read asynchronously (the page server passes it as `liesAsync`); an unreadable file throws and the scan skips that project. */
export const liesProjektDatei = async (wurzel: string, slug: string): Promise<unknown> => JSON.parse(await fsp.readFile(path.join(wurzel, slug, 'project.json'), 'utf8'));

// What a project.json refers to (structure read loosely: unknown shapes give nothing)
export async function projektInhalt(pj: unknown, ordner: string): Promise<ProjektInhalt> {
  const i: ProjektInhalt = { clips: [], zellen: [], presets: [], kits: [], takes: [], exporte: [] };
  const obj = (x: unknown): Record<string, unknown> | null => (x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : null);
  const geraet = (g: unknown): void => {
    const d = obj(g); if (!d) return;
    if (typeof d.preset === 'string') i.presets.push(d.preset);
    if (d.name === 'kit' && typeof d.kit === 'string') i.kits.push(d.kit);
    if (Array.isArray(d.glieder)) for (const gl of d.glieder) geraet(obj(gl)?.geraet);
  };
  const spuren = obj(pj)?.spuren;
  for (const s of Array.isArray(spuren) ? spuren : []) {
    const sp = obj(s); if (!sp) continue;
    for (const c of Array.isArray(sp.clips) ? sp.clips : []) { const h = obj(obj(c)?.quelle)?.sha256; if (typeof h === 'string') i.clips.push(h); }
    for (const z of Array.isArray(sp.zellen) ? sp.zellen : []) { const h = obj(z)?.sha256; if (typeof h === 'string') i.zellen.push(h); }
    for (const x of Array.isArray(sp.inserts) ? sp.inserts : []) { const p = obj(x)?.preset; if (typeof p === 'string') i.presets.push(p); }
    geraet(sp.geraet);
  }
  i.takes = await namenAsync(path.join(ordner, 'aufnahmen'), (n) => n.endsWith('.wav'));
  i.exporte = await namenAsync(path.join(ordner, 'export'), (n) => /^.+-\d{8}-\d{6}(-\d+)?(\.wav)?$/.test(n));
  return i;
}
