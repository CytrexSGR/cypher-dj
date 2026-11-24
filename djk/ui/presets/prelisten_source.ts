// Preset preview, pure part: which phrase an instrument preset plays, which starter loop runs through an effect preset, and the cache key.
// No file access except the data table next to this file, no rendering (prelisten.ts). The key follows the SOUND (the register's klang hash)
// and the content hash of the preset's graph file, never the preset file bytes: renaming or re-tagging keeps a rendered preview, editing a graph drops it.
// Everything else that shapes the heard result is in the key too: the role's art and transposition, the loops.json content, the renderer build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kanonisch, sha256 } from './vocabulary.ts';
import type { Preset } from './model.ts';

/** bump to force a re-render of every cached preview */
export const VORHOEREN_VERSION = 2;
export const ROLLEN = ['bass', 'lead', 'pad', 'keys', 'pluck', 'drums', 'percussion', 'fx'] as const;
export type Rolle = (typeof ROLLEN)[number];
export const EFFEKT_ARTEN = ['reverb', 'delay', 'compressor', 'eq', 'saturation', 'filter', 'modulation', 'utility'] as const;
type EffektArt = (typeof EFFEKT_ARTEN)[number];

export interface LoopEintrag { name: string; graph: string; beats: number; off_beats?: number; hits: string[] }
export type LoopsDatei = readonly LoopEintrag[];
export interface PhraseNote { ton: number; beat: number; vel: number; laenge_beats: number }
export interface Phrase { loop: string; bpm: 128; takte: 2; noten: PhraseNote[] }

interface Tabelle { rollen: Record<Rolle, { loop: string; transponiere: number }>; effekte: Record<EffektArt, string> }
const TABELLE: Tabelle = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'vorhoeren_phrasen.json'), 'utf8')) as Tabelle;

const PHRASE_BEATS = 8;
const VIERTEL = 0.25;

// device defaults when a preset's description names no usable kind
const ROLLE_VORGABE: Record<string, Rolle> = { rb338: 'bass', baukasten: 'keys' };
const EFFEKT_VORGABE: Record<string, EffektArt> = { eq: 'eq', komp: 'compressor', hall: 'reverb', saett: 'saturation' };

const art = (p: Preset): unknown => (p.beschreibung as { art?: unknown } | undefined)?.art;

export function rolleVon(p: Preset): Rolle | null {
  if (p.geraet_typ === 'effekt') return null;
  const a = art(p);
  if (typeof a === 'string' && (ROLLEN as readonly string[]).includes(a)) return a as Rolle;
  return ROLLE_VORGABE[p.geraet] ?? 'keys';
}

export function phraseFuer(rolle: Rolle, loops: LoopsDatei): Phrase {
  const def = TABELLE.rollen[rolle];
  const l = loops.find((x) => x.name === def.loop);
  if (!l) throw new Error(`starter loop ${def.loop} is missing from loops.json`);
  const laenge = l.off_beats !== undefined && l.off_beats > 0 ? l.off_beats : VIERTEL;
  const noten: PhraseNote[] = [];
  for (const h of l.hits) {
    const m = /^(\d+)@([0-9.]+)(?::([0-9.]+))?$/.exec(h);
    if (!m) throw new Error(`loops.json ${l.name}: bad hit ${h}`);
    const beat = Number(m[2]);
    if (beat >= PHRASE_BEATS) continue;
    const vel = m[3] === undefined ? 100 : Math.max(1, Math.min(127, Math.round(Number(m[3]) * 127)));
    noten.push({ ton: Math.max(0, Math.min(127, Number(m[1]) + def.transponiere)), beat, vel, laenge_beats: Math.min(laenge, PHRASE_BEATS - beat) });
  }
  return { loop: l.name, bpm: 128, takte: 2, noten };
}

/** the transposition in semitones the table gives a role (0 for an effect preview) */
export function transponiereFuer(rolle: Rolle | null): number { return rolle === null ? 0 : TABELLE.rollen[rolle].transponiere; }

export function effektEingang(p: Preset): { loop: string } {
  const a = art(p);
  const k: EffektArt = typeof a === 'string' && (EFFEKT_ARTEN as readonly string[]).includes(a) ? (a as EffektArt) : (EFFEKT_VORGABE[p.geraet] ?? 'utility');
  return { loop: TABELLE.effekte[k] };
}

/** the sound hash, the same recipe as the register's `klang` (register.ts); a test pins both equal */
export function klangVon(p: Pick<Preset, 'geraet' | 'werte' | 'graph' | 'stifte'>): string {
  return sha256(kanonisch({ geraet: p.geraet, werte: p.werte, ...(p.graph ? { graph: p.graph } : {}), ...(p.stifte ? { stifte: p.stifte } : {}) }));
}

/** What besides the sound decides how a preview sounds: the phrase transposition, the loops.json content hash (instruments), the renderer build. */
export interface VorhoerQuelle { loop: string; transponiere?: number; loopsHash?: string | null; renderer?: string; starter?: string | null; kit?: string }

/** graphHashe: content hash of the preset's graph file (graphHash() of graphs.ts), null for a device without a graph */
export function vorhoerSchluessel(p: Preset, quelle: VorhoerQuelle, graphHashe: string | null): string {
  const a = art(p);
  return sha256(kanonisch({ klang: klangVon(p), graph: graphHashe, v: VORHOEREN_VERSION, loop: quelle.loop, art: typeof a === 'string' ? a : null,
    transp: quelle.transponiere ?? 0, loops: quelle.loopsHash ?? null, renderer: quelle.renderer ?? '', starter: quelle.starter ?? null, kit: quelle.kit ?? '' }));
}
