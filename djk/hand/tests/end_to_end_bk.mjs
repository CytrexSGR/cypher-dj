// arr-bk slices 3 and 4, end to end on a test instance with the REAL core: the real Hand (stdio) builds a delay return through `proj_aendern`
// (`return_neu` with `effekt`), turns up the send, exports offline and the echo is measured in the exported WAV; the refusals (unknown graph,
// instrument graph, pool full) come back with their reasons; a knob lane drives k2 of the stage. Not a ctest or node --test file (it needs a
// running instance). Run:
//   DJK=<worktree>/djk djk/start/djk-start --instanz b            (silent sink, never --ton-frei)
//   node djk/hand/tests/end_to_end_bk.mjs http://127.0.0.1:49300 /dev/shm/cypherdj-b/projekte out.json
//   djk/start/djk-stop --instanz b
// `out.json` lists the exported files per case; the measurement itself is djk/hand/tests/durchstich_bk_messen.py.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const SEITE = process.argv[2], PROJEKTE = process.argv[3], AUS = process.argv[4];
if (!SEITE || !PROJEKTE || !AUS) { console.error('usage: end_to_end_bk.mjs <page url of the test instance> <projects folder> <out.json>'); process.exit(2); }

const c = new Client({ name: 'durchstich-bk', version: '0' });
await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(HIER, '..', 'hand.ts'), '--seite', SEITE] }));
const roh = (name, args = {}) => c.callTool({ name, arguments: args });
const ruft = async (name, args = {}) => {
  const r = await roh(name, args);
  const t = r.content[0].text;
  if (r.isError) throw new Error(`${name}: ${t.slice(0, 500)}`);
  try { return JSON.parse(t); } catch { return t; }
};
const log = (...a) => console.log(...a);
let rc = 0;
const pruef = (ok, was) => { log(`${ok ? 'OK  ' : 'FAIL'} ${was}`); if (!ok) rc = 1; };
const aendern = (label, befehle) => ruft('proj_aendern', { label, befehle });
const aktuell = async () => (await (await fetch(`${SEITE}/proj/aktuell`)).json()).projekt;
const dateien = {};
const exportiere = async (fall) => {
  let ex = null;
  for (let i = 0; i < 40 && !ex; i++) {
    const r = await roh('proj_export', { von_beat: 0, bis_beat: 4 });
    if (!r.isError) ex = JSON.parse(r.content[0].text);
    else { if (!/audio_fehlt/.test(r.content[0].text)) throw new Error(`proj_export ${fall}: ${r.content[0].text.slice(0, 300)}`); await new Promise((q) => setTimeout(q, 500)); }
  }
  if (!ex || !fs.existsSync(ex.datei)) throw new Error(`proj_export ${fall}: no file`);
  const kopie = path.join(path.dirname(AUS), `export-${fall}.wav`);
  fs.copyFileSync(ex.datei, kopie);
  dateien[fall] = kopie;
  log(`# export ${fall}: ${ex.frames} frames, peak ${ex.spitze_db} dBFS -> ${kopie}`);
};

const name = `arr-bk-delay-${Date.now()}`;
const neu = await ruft('proj_neu', { name });
const slug = neu.slug ?? neu.projekt?.slug ?? name;
log('# proj_neu:', JSON.stringify(neu).slice(0, 200));

// the graph list knows the shipped delay as an effect graph (the `graphen` tool reads the same folder as the core)
const graphen = await ruft('graphen');
const liste = graphen.graphen ?? graphen;
const delay = liste.find((g) => g.name === 'fx-delay-sync');
pruef(delay?.art === 'effekt', `graphen lists fx-delay-sync as an effect graph (${JSON.stringify(delay)?.slice(0, 160)})`);

// source: the one-impulse kit track, a single hit at beat 0, tempo 120
await aendern('bk: tempo and track', [{ befehl: 'tempo_setzen', bpm: 120 },
  { befehl: 'spur_neu', art: 'instrument', name: 'Impulse', geraet: { art: 'intern', name: 'kit', kit: 'pruef-impuls' } }]);
await aendern('bk: hit', [{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4, noten: [{ beat: 0, laenge: 0.25, ton: 0, vel: 127 }] }]);
await exportiere('a120');   // dry only: no return yet

// the delay return: the shipped standard case, then the send turned up
const r = await aendern('bk: delay return', [{ befehl: 'return_neu', name: 'Delay', effekt: { graph: 'fx-delay-sync' } }]);
log('# return_neu answer:', JSON.stringify(r).slice(0, 300));
let p = await aktuell();
const ret = p.returns?.[0];
pruef(ret && ret.hall?.an === false && ret.inserts?.[0]?.art === 'bk' && ret.inserts[0].graph === 'fx-delay-sync', `the return carries the bk stage and its Hall is off (${JSON.stringify(ret?.inserts)})`);
const stufe = ret.inserts[0].id;
await aendern('bk: send 0 dB', [{ befehl: 'send_setzen', strang_id: 's1', return_id: ret.id, db: 0 }]);
await exportiere('b120');
await aendern('bk: send -12 dB', [{ befehl: 'send_setzen', strang_id: 's1', return_id: ret.id, db: -12 }]);
await exportiere('c120');
// a knob lane: Level (k2) ramps 0 -> 1 over the four beats (send 0 dB again)
await aendern('bk: send 0 dB, k2 lane', [{ befehl: 'send_setzen', strang_id: 's1', return_id: ret.id, db: 0 },
  { befehl: 'auto_neu', strang_id: ret.id, ziel: `insert.${stufe}.k2`, punkte: [{ beat: 0, wert: 0 }, { beat: 4, wert: 1 }] }]);
await exportiere('d120');
// tempo 90: the echo follows the project tempo (the lane stays, so the pair is a90 and b90 without the lane)
const lanes = (await aktuell()).auto_lanes ?? [];
log(`# lanes in the project: ${lanes.length}`);
await aendern('bk: tempo 90', [{ befehl: 'tempo_setzen', bpm: 90 }]);
await exportiere('d90');

// refusals through the same door, each with its speaking reason
const abgelehnt = async (was, befehl, muster) => {
  const x = await roh('proj_aendern', { label: `bk: ${was}`, befehle: [befehl] });
  const t = x.content[0].text;
  pruef(x.isError === true && muster.test(t), `${was} is refused (${t.slice(0, 170)})`);
};
await abgelehnt('unknown graph', { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'bk', graph: 'gibt-es-nicht' }, /argument_ungueltig|unknown graph/);
const instrument = liste.find((g) => g.art === 'instrument')?.name ?? 'fm-bass';
await abgelehnt('instrument graph', { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'bk', graph: instrument }, /argument_ungueltig|instrument/);
await abgelehnt('missing graph', { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'bk' }, /argument_ungueltig|graph/);
// pool of eight: the return holds one, seven more on the track and the master, the ninth is refused
const sieben = [];
for (let i = 0; i < 3; i++) sieben.push({ befehl: 'insert_setzen', strang_id: 's1', pos: i, art: 'bk', graph: 'fx-echo-achtel' });
for (let i = 0; i < 4; i++) sieben.push({ befehl: 'insert_setzen', strang_id: 'master', pos: i, art: 'bk', graph: 'fx-echo-achtel' });
await aendern('bk: pool fill', sieben);
p = await aktuell();
const zahl = [...(p.spuren ?? []), ...(p.returns ?? []), ...(p.gruppen ?? []), p.master].flatMap((s) => s?.inserts ?? []).filter((i) => i.art === 'bk').length;
pruef(zahl === 8, `eight bk stages in the project (${zahl})`);
await abgelehnt('ninth stage', { befehl: 'insert_setzen', strang_id: 'r1', pos: 1, art: 'bk', graph: 'fx-echo-achtel' }, /ins_voll/);

// the project reaches the core whole: opening sends every row, none is refused
const o = await ruft('proj_oeffnen', { slug });
const kern = o.kern ?? o.j?.kern ?? {};
log('# proj_oeffnen kern:', JSON.stringify(kern).slice(0, 300));
pruef(Array.isArray(kern.regler_fehler) ? kern.regler_fehler.length === 0 : true, `the core refused no row on open (regler_fehler ${JSON.stringify(kern.regler_fehler)}, regler ${kern.regler})`);
await c.close();
fs.rmSync(path.join(PROJEKTE, slug), { recursive: true, force: true });
fs.writeFileSync(AUS, JSON.stringify({ stufe, dateien }, null, 1));
log(rc === 0 ? 'DURCHSTICH GRUEN' : 'DURCHSTICH ROT');
process.exit(rc);
