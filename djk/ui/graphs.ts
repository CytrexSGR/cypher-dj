// Baukasten S12: the graph folder of the kern ($HOME/.config/cypherdj/baukasten, one folder for all instances) seen from the page
// server. Pure functions: list the graphs with their art and knob names, check a name. The kern checks again; this only keeps
// obviously wrong requests off the wire and tells the page what exists.
import crypto from 'node:crypto';
import { INSTRUMENT_STROEME, kanalVonStrom } from '../contract/streams.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type GraphArt = 'instrument' | 'effekt';
export type GraphEintrag = { name: string; art: GraphArt; regler_namen: Record<string, string> };
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
    for (const [n, v] of Object.entries(roh)) if (/^[1-8]$/.test(n) && typeof v === 'string' && v.length > 0) regler_namen[n] = v.slice(0, 40);
  }
  return { name, art: effekt ? 'effekt' : 'instrument', regler_namen };
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
