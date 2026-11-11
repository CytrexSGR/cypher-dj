// arr-bk slice 4: the delay return LIVE against the offline export, on a test instance with the real core. The same project is exported offline
// (proj_export) and played live (proj_transport) while the silent sink of the instance is recorded with pw-record; end_to_end_bk_live_measure.py
// compares the two. Run:
//   DJK=<worktree>/djk djk/start/djk-start --instanz b            (silent sink, never --ton-frei)
//   node djk/hand/tests/end_to_end_bk_live.mjs http://127.0.0.1:49300 cypher_stumm-b <out folder>
//   djk/start/djk-stop --instanz b
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const SEITE = process.argv[2], SENKE = process.argv[3], AUS = process.argv[4];
if (!SEITE || !SENKE || !AUS) { console.error('usage: end_to_end_bk_live.mjs <page url> <silent sink node name of the instance> <out folder>'); process.exit(2); }
fs.mkdirSync(AUS, { recursive: true });
const c = new Client({ name: 'durchstich-bk-live', version: '0' });
await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(HIER, '..', 'hand.ts'), '--seite', SEITE] }));
const roh = (name, args = {}) => c.callTool({ name, arguments: args });
const ruft = async (name, args = {}) => {
  const r = await roh(name, args);
  const t = r.content[0].text;
  if (r.isError) throw new Error(`${name}: ${t.slice(0, 500)}`);
  try { return JSON.parse(t); } catch { return t; }
};
const aendern = (label, befehle) => ruft('proj_aendern', { label, befehle });
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

await ruft('proj_neu', { name: `arr-bk-live-${Date.now()}` });
await aendern('live: tempo and track', [{ befehl: 'tempo_setzen', bpm: 120 },
  { befehl: 'spur_neu', art: 'instrument', name: 'Impulse', geraet: { art: 'intern', name: 'kit', kit: 'pruef-impuls' } },
  { befehl: 'return_neu', name: 'Delay', effekt: { graph: 'fx-delay-sync' } }]);
await aendern('live: hit, send, loop', [{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4, noten: [{ beat: 0, laenge: 0.25, ton: 0, vel: 127 }] },
  { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: 0 }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 4 }]);

// offline
let ex = null;
for (let i = 0; i < 40 && !ex; i++) {
  const r = await roh('proj_export', { von_beat: 0, bis_beat: 4 });
  if (!r.isError) ex = JSON.parse(r.content[0].text); else await schlaf(500);
}
if (!ex) throw new Error('no export');
fs.copyFileSync(ex.datei, path.join(AUS, 'export.wav'));
console.log(`# export: ${ex.frames} frames, ${ex.datei}`);

// live: record the silent sink, start the transport at beat 0, stop after 3.2 s (a bit more than one 2 s loop pass and the echo tail)
const rec = spawn('pw-record', ['--target', SENKE, '-P', 'stream.capture.sink=true', '--channels', '2', '--rate', '48000', '--format', 'f32', path.join(AUS, 'live.wav')], { stdio: 'ignore' });
await schlaf(800);
const t = await ruft('proj_transport', { aktion: 'start', beat: 0 });
console.log('# transport start:', JSON.stringify(t).slice(0, 200));
await schlaf(3200);
await roh('proj_transport', { aktion: 'stopp' });
await schlaf(300);
rec.kill('SIGINT');
await schlaf(500);
await c.close();
console.log('# recorded', fs.statSync(path.join(AUS, 'live.wav')).size, 'bytes');
