// Strand 11 slice 7 (task 7.7, spec 7a): stored session setups for POST /aufbau. A setup is a live scene (slice 5 format v1) plus a block
// `aufbau {bpm, kanaele, graphen, live_oeffnen}`. Setups live outside any project (<ordner>/<name>.json, ordner = aufbauOrdnerVorgabe), file mode 0600,
// written atomically (temp file + rename). Pure parts: check, read, write, list, delete into papierkorb/, and the restore input of a setup.
import fs from 'node:fs';
import path from 'node:path';
import { SZENE_NAME, type Szene } from './szene.ts';

export const AUFBAU_NAME = SZENE_NAME;
/** The four container channel strips whose fader level a setup holds (after a core restart they sit at -200 dB). */
export const AUFBAU_KANAELE = ['deck/1', 'deck/2', 'pad/1', 'pad/2'] as const;
export type AufbauKanal = typeof AUFBAU_KANAELE[number];
export const AUFBAU_PAPIERKORB = 'papierkorb';

export interface AufbauBlock {
  bpm: number | null;
  /** fader level in dB per container strip (`<kanal>/fader`) */
  kanaele: Partial<Record<AufbauKanal, number>>;
  /** graph per Baukasten stream channel (`erz/<n>`) */
  graphen: Record<string, string>;
  live_oeffnen: true;
}
/** A container fader at or below this level counts as closed (a core restart leaves the strips at -200 dB): it is not stored, a later load would mute it. */
export const AUFBAU_GESCHLOSSEN_DB = -90;
export interface Aufbau { v: 1; geschrieben: string; aufbau: AufbauBlock; szene: Szene }

export const aufbauDatei = (ordner: string, name: string): string => path.join(ordner, `${name}.json`);
export const aufbauDa = (ordner: string, name: string): boolean => fs.existsSync(aufbauDatei(ordner, name));

/** The block of a setup from the running studio: the four container faders that are known, the tempo and the graphs of the Baukasten streams. */
export function aufbauBlock(regler: Record<string, number>, bpm: number | null | undefined, graphen: Record<string, string>,
  istBkKanal: (kanal: string) => boolean): AufbauBlock {
  const kanaele: AufbauBlock['kanaele'] = {};
  for (const k of AUFBAU_KANAELE) {
    const w = regler[`${k}/fader`];
    if (typeof w !== 'number' || !Number.isFinite(w)) continue;
    if (w > AUFBAU_GESCHLOSSEN_DB) kanaele[k] = w;
  }
  const g: Record<string, string> = {};
  for (const [k, n] of Object.entries(graphen)) if (n && istBkKanal(k)) g[k] = n;
  return { bpm: typeof bpm === 'number' && Number.isFinite(bpm) ? bpm : null, kanaele, graphen: g, live_oeffnen: true };
}

/** The container strips that sit closed (at or below -90 dB) and were therefore left out of the block. */
export function aufbauWarnung(regler: Record<string, number>): { kanal: AufbauKanal; grund: 'geschlossen_nicht_gesichert' }[] {
  return AUFBAU_KANAELE.filter((k) => { const w = regler[`${k}/fader`]; return typeof w === 'number' && Number.isFinite(w) && w <= AUFBAU_GESCHLOSSEN_DB; })
    .map((kanal) => ({ kanal, grund: 'geschlossen_nicht_gesichert' as const }));
}

/** A stored setup is valid when it is format 1 with a block and an embedded scene of format 1. */
export function pruefeAufbau(x: unknown): x is Aufbau {
  const a = x as Aufbau | null;
  if (!a || typeof a !== 'object' || a.v !== 1 || !a.aufbau || typeof a.aufbau !== 'object') return false;
  const b = a.aufbau;
  if (b.bpm !== null && typeof b.bpm !== 'number') return false;
  if (!b.kanaele || typeof b.kanaele !== 'object' || !b.graphen || typeof b.graphen !== 'object') return false;
  if (Object.entries(b.kanaele).some(([k, w]) => !(AUFBAU_KANAELE as readonly string[]).includes(k) || typeof w !== 'number' || !Number.isFinite(w))) return false;
  if (Object.values(b.graphen).some((n) => typeof n !== 'string')) return false;
  const s = a.szene;
  return !!s && s.v === 1 && typeof s.muster === 'object' && typeof s.regler === 'object';
}

export function schreibeAufbau(ordner: string, name: string, a: Aufbau): void {
  fs.mkdirSync(ordner, { recursive: true, mode: 0o700 });
  const ziel = aufbauDatei(ordner, name);
  const tmp = `${ziel}.${process.pid}.neu`;
  fs.writeFileSync(tmp, JSON.stringify(a), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);   // the umask cannot widen it, an existing temp file keeps no other mode
  fs.renameSync(tmp, ziel);
}

/** The stored setup, or null when the file is missing or not a valid setup. */
export function leseAufbau(ordner: string, name: string): Aufbau | null {
  try {
    const a = JSON.parse(fs.readFileSync(aufbauDatei(ordner, name), 'utf8')) as unknown;
    return pruefeAufbau(a) ? a : null;
  } catch { return null; }
}

/** The stored setups, sorted by name: {name, geschrieben, bpm}. */
export function listeAufbauten(ordner: string): { name: string; geschrieben: string | null; bpm: number | null }[] {
  let namen: string[];
  try { namen = fs.readdirSync(ordner); } catch { return []; }
  return namen.filter((n) => n.endsWith('.json') && AUFBAU_NAME.test(n.slice(0, -5))).map((n) => n.slice(0, -5)).sort().map((name) => {
    const a = leseAufbau(ordner, name);
    return { name, geschrieben: a?.geschrieben ?? null, bpm: a?.aufbau.bpm ?? null };
  });
}

/** Moves the setup to <ordner>/papierkorb/ (an older copy of the same name there gets a time suffix). Answers the new path, null if there was none. */
export function loescheAufbau(ordner: string, name: string, jetzt: Date = new Date()): string | null {
  const quelle = aufbauDatei(ordner, name);
  if (!fs.existsSync(quelle)) return null;
  const korb = path.join(ordner, AUFBAU_PAPIERKORB);
  fs.mkdirSync(korb, { recursive: true, mode: 0o700 });
  let ziel = path.join(korb, `${name}.json`);
  if (fs.existsSync(ziel)) ziel = path.join(korb, `${name}.${jetzt.toISOString().replace(/[:.]/g, '-')}.json`);
  fs.renameSync(quelle, ziel);
  return ziel;
}

/** The restore input of a setup: its scene with the setup's graphs written over the scene's graphs and the four container fader rows taken out
 *  (they go through the control path as ramps, see the server), and the fader moves of the block. */
export function aufbauZumLaden(a: Aufbau): { szene: Szene; kanaele: { kanal: AufbauKanal; pfad: string; nach: number }[] } {
  const regler = { ...(a.szene.regler ?? {}) };
  const kanaele: { kanal: AufbauKanal; pfad: string; nach: number }[] = [];
  for (const k of AUFBAU_KANAELE) {
    const pfad = `${k}/fader`;
    const nach = a.aufbau.kanaele[k] ?? regler[pfad];
    delete regler[pfad];
    // a closed level (an older setup, or the scene's own row) is never restored: it would mute the strip
    if (typeof nach === 'number' && Number.isFinite(nach) && nach > AUFBAU_GESCHLOSSEN_DB) kanaele.push({ kanal: k, pfad, nach });
  }
  return { szene: { ...a.szene, regler, graphen: { ...(a.szene.graphen ?? {}), ...a.aufbau.graphen } }, kanaele };
}
