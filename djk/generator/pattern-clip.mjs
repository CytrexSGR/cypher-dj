#!/usr/bin/env node
// strudel-clip: the Strudel side of clip_aus_muster in a child process of the page server (areas/proj/pattern_run.ts).
// stdin: {"code": "...", "takte": 8 | null}; stdout: one line "MUSTER-CLIP <json>" (Strudel itself prints a banner to stdout, so the answer is marked).
// Runs under node --permission (read only: djk and Strudel), with a time limit and a memory cap set by the caller.
import { musterZuEreignissen } from './src/pattern_ereignisse.mjs';

// no network API for the pattern code (node --permission has no network switch in Node 22: a pattern can still import node:http, a known limit)
for (const k of ['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource']) delete globalThis[k];
delete process.getBuiltinModule;

let roh = '';
for await (const b of process.stdin) roh += b;
let aus;
try {
  const a = JSON.parse(roh);
  aus = musterZuEreignissen({ code: a.code, takte: a.takte ?? null });
} catch (e) {
  aus = { ok: false, grund: 'muster_fehler', fehler: `Zeile 1: ${String(e?.message ?? e).slice(0, 300)}` };
}
process.stdout.write(`\nMUSTER-CLIP ${JSON.stringify(aus)}\n`);
