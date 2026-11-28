#!/usr/bin/env node
// djk-hand: Cyphers Hand an djk als MCP-Server (stdio). Plan docs/superpowers/plans/2026-09-28-djk-hand-mcp.md.
// Jeder Aufruf geht als HTTP an den Seiten-Server mit dem Kopf x-djk-quelle: cypher; der Server setzt damit die Quelle
// cypher in jeden Kern-Befehl (Stop Cypher blockt, Andreas' Hand bricht Rampen ab, „nur Hand“-Regler lehnt der Kern ab,
// geschlossene Kanäle öffnen und auf offene Decks springen sperrt der Server, bis das Ohr Hörscheine ausstellt).
// Aufruf: node hand.ts [--seite http://127.0.0.1:47300]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { SkillsExtension, type SkillFiles } from '@modelcontextprotocol/server/ext/skills';
import { nodeSkillFiles } from '@modelcontextprotocol/server/ext/skills/node';
import { SEITE, FEHL_STATUS, type Json, AUFRUF, AUFRUF_PRAEFIX, type Werkzeug } from './hand_core.ts';
import { WERKZEUGE_LIVE } from './hand_live.ts';
import { WERKZEUGE_BIBLIOTHEK } from './hand_library.ts';
import { WERKZEUGE_PROJ } from './hand_proj.ts';
import { WERKZEUGE_PROJ_CLIPS } from './hand_proj_clips.ts';
import { WERKZEUGE_SAMPLER } from './hand_sampler.ts';

let aufrufZaehler = 0;
const W: Werkzeug[] = [
  ...WERKZEUGE_LIVE,
  ...WERKZEUGE_BIBLIOTHEK,
  ...WERKZEUGE_PROJ,
  ...WERKZEUGE_PROJ_CLIPS,
  ...WERKZEUGE_SAMPLER,
];

// Ergebnis → MCP: HTTP ≥ 400 oder eine Quittung mit Fehlerstatus ist ein Werkzeugfehler mit Grund
function antwort(r: { code: number; j: Json; text?: string; roh?: string }): { content: { type: 'text'; text: string }[]; isError?: boolean } {
  const q = r.j.quittung as { status: number; grund: string } | null | undefined;
  const fehler = r.code >= 400 || (q && FEHL_STATUS.has(q.status));
  if (fehler && r.roh !== undefined) return { content: [{ type: 'text', text: r.roh }], isError: true };   // plan 7: the tag tools carry {ok, grund, text} of the page unchanged
  const text = fehler
    // Ohr T11: kein_hoerschein trägt urteil/gruende des letzten Scheins (server.ts regler()) — mitgeben, sonst
    // verschwindet der Beleg für den Fehlerfall hinter der generischen Fehlerform.
    // ziel: welche Fahrt einer Spur abgelehnt wurde (ueber_projekt, D1 Spec 6.22/6.30)
    // seq_geleert: a stopped track of a SEQ deck place was ejected by this refused open; the same call may succeed now (plan seq-fader-frei)
    ? JSON.stringify({ fehler: r.j.fehler ?? q?.grund ?? `http ${r.code}`, text: r.j.text, detail: r.j.detail, details: r.j.details, ziel: r.j.ziel, urteil: r.j.urteil, gruende: r.j.gruende, seq_geleert: r.j.seq_geleert, quittung: q ?? undefined })
    : r.text ?? JSON.stringify(r.j);
  return fehler ? { content: [{ type: 'text', text }], isError: true } : { content: [{ type: 'text', text }] };
}

// MCP 2026-07-28: djk-hand ships the agent skills with its tools (skills over MCP), so a client that connects the hand
// gets them without copying files. Source: the public skills of the project, found next to the program (skills/ at the
// root of a checkout or the package; docs/veroeffentlichung/public/skills in the working repo). DJK_HAND_SKILLE names
// another folder of skill folders, DJK_HAND_SKILLE_NUR limits it to a comma list. No folder: no skills, tools unaffected.
const HIER = path.dirname(fileURLToPath(import.meta.url));
const SKILL_WURZEL = process.env.DJK_HAND_SKILLE
  ?? [path.resolve(HIER, '../../skills'), path.resolve(HIER, '../../docs/veroeffentlichung/public/skills')].find((d) => fs.existsSync(d));
const SKILL_NUR = process.env.DJK_HAND_SKILLE_NUR ? new Set(process.env.DJK_HAND_SKILLE_NUR.split(',').map((x) => x.trim()).filter(Boolean)) : undefined;
function nurDiese(f: SkillFiles, nur: Set<string>): SkillFiles {
  const erlaubt = (p: string) => nur.has(p.split('/')[0]);
  return {
    list: async (dir) => (dir === '' ? (await f.list(dir)).filter((e) => nur.has(e.name)) : (erlaubt(dir) ? f.list(dir) : [])),
    read: async (p) => { if (!erlaubt(p)) throw new Error(`skill not served: ${p}`); return f.read(p); },
  };
}

let skille: SkillsExtension | undefined;
try {
  if (!SKILL_WURZEL) throw new Error('no skills folder');
  const dateien = nodeSkillFiles(SKILL_WURZEL);
  const katalog = await SkillsExtension.load(SKILL_NUR ? nurDiese(dateien, SKILL_NUR) : dateien, { onWarning: (w) => console.error('djk-hand skill:', JSON.stringify(w)) });
  skille = katalog;
  console.error(`djk-hand: ${katalog.entries.length} skills`);
} catch (e) { console.error(`djk-hand: no skills (${(e as Error).message})`); }

// serveStdio picks the era from the opening exchange: 2026-07-28 (server/discover) or 2025 (initialize), one instance per connection
serveStdio(() => {
  const mcp = new McpServer({ name: 'djk-hand', version: '0.2.0' }, { capabilities: { tools: {} } });
  mcp.server.setRequestHandler('tools/list', async () => ({ tools: W.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }));
  mcp.server.setRequestHandler('tools/call', async (req) => {
    const w = W.find((x) => x.name === req.params.name);
    if (!w) return { content: [{ type: 'text', text: `unknown tool ${req.params.name}` }], isError: true };
    const args = (req.params.arguments ?? {}) as Json;
    const kopf = { werkzeug: w.name, aktion: typeof args.aktion === 'string' ? args.aktion : null, aufruf: `${AUFRUF_PRAEFIX}-${++aufrufZaehler}` };
    try { return antwort(await AUFRUF.run(kopf, () => w.lauf(args))); }
    catch (e) { return { content: [{ type: 'text', text: JSON.stringify({ fehler: 'seite_nicht_erreichbar', text: (e as Error).message, seite: SEITE }) }], isError: true }; }
  });
  skille?.attach(mcp);
  return mcp;
});
