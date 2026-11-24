// djk-hand: proj_aufnahme aktion gerettet_platzieren places a recovered take through POST /proj/gerettet_platzieren.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');

async function aufbau(t, antworten) {
  const gesehen = [];
  const s = http.createServer((q, a) => {
    let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => {
      gesehen.push({ methode: q.method, pfad: q.url, quelle: q.headers['x-djk-quelle'], koerper: b ? JSON.parse(b) : null });
      const [code, j] = antworten(q.method, q.url) ?? [404, { fehler: 'unbekannt' }];
      a.writeHead(code, { 'content-type': 'application/json' }); a.end(JSON.stringify(j));
    });
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  return { c, gesehen };
}
const antworten = (m, u) => {
  if (m !== 'POST') return null;
  if (u === '/proj/gerettet_platzieren') return [200, { ok: true, clip_id: 'c5' }];
  if (u === '/proj/aufnahme') return [200, { aufnahme: 'laeuft', kennung: 5 }];
  return null;
};

test('proj_aufnahme gerettet_platzieren: one POST with exactly {datei}, source cypher, answer unchanged', async (t) => {
  const { c, gesehen } = await aufbau(t, antworten);
  const r = JSON.parse((await c.callTool({ name: 'proj_aufnahme', arguments: { aktion: 'gerettet_platzieren', datei: 'take-9-1-gerettet.wav' } })).content[0].text);
  assert.deepEqual(r, { ok: true, clip_id: 'c5' });
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad, g.quelle, g.koerper]),
    [['POST', '/proj/gerettet_platzieren', 'cypher', { datei: 'take-9-1-gerettet.wav' }]]);
});

test('proj_aufnahme gerettet_platzieren without datei: local 400, nothing is sent', async (t) => {
  const { c, gesehen } = await aufbau(t, antworten);
  for (const a of [{ aktion: 'gerettet_platzieren' }, { aktion: 'gerettet_platzieren', datei: '' }]) {
    const r = await c.callTool({ name: 'proj_aufnahme', arguments: a });
    assert.ok(r.isError);
  }
  assert.equal(gesehen.length, 0);
});

test('proj_aufnahme start and stopp are unchanged', async (t) => {
  const { c, gesehen } = await aufbau(t, antworten);
  await c.callTool({ name: 'proj_aufnahme', arguments: { aktion: 'start', von_beat: 4 } });
  await c.callTool({ name: 'proj_aufnahme', arguments: { aktion: 'stopp' } });
  assert.deepEqual(gesehen.map((g) => [g.pfad, g.koerper]), [['/proj/aufnahme', { aktion: 'start', von_beat: 4 }], ['/proj/aufnahme', { aktion: 'stopp' }]]);
});

test('tools/list shows proj_aufnahme once with the three actions', async (t) => {
  const { c } = await aufbau(t, antworten);
  const l = (await c.listTools()).tools.filter((x) => x.name === 'proj_aufnahme');
  assert.equal(l.length, 1);
  assert.deepEqual(l[0].inputSchema.properties.aktion.enum, ['start', 'stopp', 'gerettet_platzieren']);
  assert.equal(l[0].inputSchema.properties.datei.type, 'string');
});
