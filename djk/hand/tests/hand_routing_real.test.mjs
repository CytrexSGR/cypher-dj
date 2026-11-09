// 1.10 slices 5 to 8, AK25 on the real stack: the REAL hand (stdio) against the page server of a test instance with the REAL core, no page open. Cypher builds the whole
// routing through the MCP tools only: groups, returns, sends pre and post, a keyed compressor (duck_durch_kick and insert_setzen with its required pos), reads proj_routing,
// resamples a group, exports. History shows the source cypher; with Stop Cypher every write is refused ki_gestoppt; the matrix shows the same project to the page (GET /proj/routing).
// It needs a running test instance (b to e), because the core must play for the resample:
//   DJK=<worktree>/djk djk/start/djk-start --instanz e --arr1       (silent)
//   HAND_ROUTING_URL=http://127.0.0.1:52300 node --test djk/hand/tests/hand_routing_real.test.mjs
// Without HAND_ROUTING_URL the test is skipped ("skipped", never "passed"); the stand-in core of the other hand tests cannot play a resample.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');
const SEITE = process.env.HAND_ROUTING_URL;
const port = SEITE ? Number(new globalThis.URL(SEITE).port) : 0;
const buchstabe = port >= 48300 && port <= 56300 && (port - 47300) % 1000 === 0 ? String.fromCharCode(96 + (port - 47300) / 1000) : null;

test('AK25 (real hand, real core): Cypher builds the routing through MCP only; history source cypher; Stop Cypher refuses every write; the page sees the same matrix',
  { skip: !SEITE ? 'HAND_ROUTING_URL not set (needs a running test instance with the real core)' : !/^[bcde]$/.test(buchstabe ?? '') ? `HAND_ROUTING_URL ${SEITE}: only the instances b, c, d, e` : false },
  async (t) => {
    const c = new Client({ name: 'test', version: '0' });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', SEITE] }));
    t.after(() => c.close());
    const tools = (await c.listTools()).tools.map((x) => x.name);
    for (const n of ['proj_neu', 'proj_aendern', 'proj_routing', 'proj_resample', 'proj_export', 'proj_verlauf']) assert.ok(tools.includes(n), `tool ${n}`);
    const roh = async (name, args = {}) => c.callTool({ name, arguments: args });
    const ruft = async (name, args = {}) => {
      const r = await roh(name, args);
      assert.ok(!r.isError, `${name}: ${r.content[0].text.slice(0, 400)}`);
      return JSON.parse(r.content[0].text);
    };
    const aendern = async (label, befehle) => ruft('proj_aendern', { label, befehle });
    const seite = async (pfad) => (await fetch(SEITE + pfad)).json();
    const slugNeu = `r5-ak25-${Date.now()}`;
    t.after(async () => {
      await fetch(`${SEITE}/taste`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'freigabe' }) }).catch(() => null);
      await fetch(`${SEITE}/proj/transport`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-djk-quelle': 'cypher' }, body: JSON.stringify({ aktion: 'stopp' }) }).catch(() => null);
      fs.rmSync(path.join('/dev/shm', `cypherdj-${buchstabe}`, 'projekte', slugNeu), { recursive: true, force: true });
    });

    await ruft('proj_neu', { name: slugNeu });
    const notenFolge = (ton) => Array.from({ length: 8 }, (_, i) => ({ beat: i, laenge: 0.5, ton, vel: 110 }));
    await aendern('AK25 tracks', [{ befehl: 'tempo_setzen', bpm: 120 }, ...['Kick', 'Bass', 'Pad'].map((name) => ({ befehl: 'spur_neu', art: 'instrument', name }))]);
    await aendern('AK25 clips', [36, 43, 48].map((ton, i) => ({ befehl: 'clip_neu', spur_id: `s${i + 1}`, art: 'midi', start_beat: 0, laenge_beats: 8, noten: notenFolge(ton) }))
      .concat([{ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 }]));
    // groups, returns, sends pre and post
    await aendern('AK25 routing', [{ befehl: 'gruppenspur_neu', mitglieder: ['s2', 's3'] }, { befehl: 'return_neu', name: 'Pre return', hall: { an: false } },
      { befehl: 'return_neu', name: 'Post return', hall: { an: false } }]);
    await aendern('AK25 sends', [{ befehl: 'return_aendern', return_id: 'r1', pre: true }, { befehl: 'send_setzen', strang_id: 's3', return_id: 'r1', db: -9 },
      { befehl: 'send_setzen', strang_id: 's3', return_id: 'r2', db: -12 }, { befehl: 'send_setzen', strang_id: 'g1', return_id: 'r2', db: -15 }]);
    // keyed compressors: duck by kick on the bass track, and a stage with its required pos keyed by the group, post, on the return
    await aendern('AK25 duck', [{ befehl: 'duck_durch_kick', spur_id: 's2', kick_id: 's1' }]);
    await aendern('AK25 return stage', [{ befehl: 'insert_setzen', strang_id: 'r2', pos: 0, art: 'komp', werte: { schwelle: -30, ratio: 4 }, key: { quelle: 'grp', nr: 1, punkt: 'post' } }]);
    // without pos the command is refused (the field is required)
    const ohnePos = await roh('proj_aendern', { label: 'AK25 no pos', befehle: [{ befehl: 'insert_setzen', strang_id: 's1', art: 'komp' }] });
    assert.equal(ohnePos.isError, true, 'insert_setzen without pos is refused');
    console.log(`# AK25 insert_setzen without pos: ${ohnePos.content[0].text.slice(0, 160)}`);

    // proj_routing reads the project: groups, returns, sends, stages and keys
    const matrix = await ruft('proj_routing');
    const strang = (id) => matrix.straenge.find((x) => x.id === id);
    assert.equal(matrix.straenge.filter((x) => x.art === 'gruppe').length, 1, 'one group');
    assert.equal(matrix.returns.length, 2, 'two returns');
    assert.equal(matrix.returns.find((x) => x.id === 'r1').pre, true, 'return 1 takes its sends pre fader');
    assert.ok(!matrix.returns.find((x) => x.id === 'r2').pre, 'return 2 is post');
    assert.deepEqual(strang('s3').sends.map((x) => [x.return_id, x.db]).sort(), [['r1', -9], ['r2', -12]]);
    assert.deepEqual(strang('g1').sends.map((x) => [x.return_id, x.db]), [['r2', -15]]);
    assert.deepEqual(strang('s2').stufen.map((x) => [x.art, x.schluessel]), [['komp', { quelle: 'spur', nr: 1, punkt: 'pre' }]], 'duck by kick: the bass stage is keyed by track 1 pre');
    assert.deepEqual(strang('r2').stufen.map((x) => [x.art, x.schluessel]), [['komp', { quelle: 'grp', nr: 1, punkt: 'post' }]]);
    // the page sees the same matrix: the tool is GET /proj/routing
    assert.deepEqual(await seite('/proj/routing'), matrix, 'GET /proj/routing (what the page fetches) equals proj_routing');
    // a refused key reaches Cypher with the reason
    const spaet = await roh('proj_aendern', { label: 'AK25 late key', befehle: [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', key: { quelle: 'grp', nr: 1, punkt: 'post' } }] });
    assert.equal(spaet.isError, true);
    assert.match(spaet.content[0].text, /sidechain_spaet/);

    // resample the group once in real time, then export
    await new Promise((r) => setTimeout(r, 2500));   // the playback settles in the core
    const rs = await ruft('proj_resample', { strang_id: 'g1', punkt: 'post' });
    assert.ok(rs.frames > 0 && fs.existsSync(rs.datei), `the resample wrote ${rs.datei}`);
    assert.equal(rs.quelle, 'g1');
    const lage = await ruft('proj_lage');
    assert.ok((lage.projekt ?? lage).spuren.some((s) => /resampled/.test(s.name)), 'the resampled track is in the project');
    console.log(`# AK25 resample g1: ${rs.frames} frames, track ${rs.spur_id}`);
    await new Promise((r) => setTimeout(r, 1500));
    let ex = null;
    for (let i = 0; i < 40 && !ex; i++) {   // the new clip is decoded first: audio_fehlt means "try again in a moment"
      const r = await roh('proj_export', { von_beat: 0, bis_beat: 8 });
      if (!r.isError) ex = JSON.parse(r.content[0].text);
      else { assert.match(r.content[0].text, /audio_fehlt/, r.content[0].text.slice(0, 300)); await new Promise((q) => setTimeout(q, 500)); }
    }
    assert.ok(ex, 'the export succeeded within 20 s');
    assert.ok(ex.frames > 0 && fs.existsSync(ex.datei), 'the export wrote its file');
    console.log(`# AK25 export: ${ex.frames} frames, peak ${ex.spitze_db} dBFS, ${ex.datei}`);

    // history: everything above came from Cypher
    const verlauf = await ruft('proj_verlauf');
    const eintraege = verlauf.eintraege ?? verlauf;
    const eigene = eintraege.filter((e) => /^(AK25|Resample)/.test(e.label));
    assert.ok(eigene.length >= 6, `${eigene.length} history entries of this run`);
    assert.ok(eigene.every((e) => e.quelle === 'cypher'), `source cypher for every entry: ${JSON.stringify(eigene.map((e) => e.quelle))}`);

    // Stop Cypher: every write is refused ki_gestoppt
    const vorStopp = await seite('/proj/routing');
    const stopp = await fetch(`${SEITE}/taste`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'stopp' }) });
    assert.equal(stopp.status, 200);
    for (let i = 0; i < 50 && (await seite('/lage')).ki?.gestoppt !== true; i++) await new Promise((r) => setTimeout(r, 100));
    const stopp1 = [['proj_aendern', { label: 'AK25 stopped', befehle: [{ befehl: 'send_setzen', strang_id: 's3', return_id: 'r2', db: -3 }] }],
      ['proj_aendern', { label: 'AK25 stopped duck', befehle: [{ befehl: 'duck_durch_kick', spur_id: 's3', kick_id: 's1' }] }],
      ['proj_resample', { strang_id: 'g1' }], ['proj_export', { von_beat: 0, bis_beat: 8 }], ['proj_undo', {}]];
    for (const [name, args] of stopp1) {
      const r = await roh(name, args);
      assert.equal(r.isError, true, `${name} is refused with Stop Cypher`);
      assert.match(r.content[0].text, /ki_gestoppt/, `${name}: ${r.content[0].text.slice(0, 200)}`);
    }
    assert.deepEqual(await seite('/proj/routing'), vorStopp, 'nothing changed while Cypher was stopped');
    // reading stays possible
    assert.ok((await ruft('proj_routing')).straenge.length > 0);
    await fetch(`${SEITE}/taste`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'freigabe' }) });
  });
