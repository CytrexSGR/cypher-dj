// Strand 7 task 2.4: the hand tool `harmonie` (live harmony lane). A stub page records every request.
import { WERKZEUGE_IM_CODE } from './support/werkzeugzahl.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');

async function verbinde(t, antwort = () => [200, { ok: true }]) {
  const gesehen = [];
  const s = http.createServer((q, a) => {
    let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => {
      gesehen.push({ methode: q.method, pfad: q.url, koerper: b ? JSON.parse(b) : null, quelle: q.headers['x-djk-quelle'] });
      const [code, j] = antwort(q.method, q.url);
      a.writeHead(code, { 'content-type': 'application/json' }); a.end(JSON.stringify(j));
    });
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  return { c, gesehen };
}

test('listed, schema, count is the number of entries in the code', async (t) => {
  const { c } = await verbinde(t);
  const tools = (await c.listTools()).tools;
  assert.equal(tools.length, WERKZEUGE_IM_CODE);
  const x = tools.find((y) => y.name === 'harmonie');
  assert.ok(x);
  const p = x.inputSchema.properties;
  assert.equal(p.folge.type, 'string');
  assert.deepEqual(p.takte_je_akkord.enum, [1, 2, 4, 8]);
  assert.equal(p.tonart.type, 'string');
  assert.deepEqual(p.ab.enum, ['takt', 'phrase']);
  assert.equal(p.anker_takt.type, 'integer');
  assert.equal(p.probe.type, 'boolean');
  assert.equal(p.aus.type, 'boolean');
  assert.ok(!x.inputSchema.required || x.inputSchema.required.length === 0, 'folge is not required (aus)');
});

test('description: the lane, both methods with an example, one call one downbeat, fremd; strudel points to .harm()', async (t) => {
  const { c } = await verbinde(t);
  const tools = (await c.listTools()).tools;
  const d = tools.find((y) => y.name === 'harmonie').description;
  assert.match(d, /\.harm\(oktave\)/);
  assert.match(d, /\.akkordton\(oktave\)/);
  assert.match(d, /n\("0 2 4 7"\)\.harm\(2\)/);
  assert.match(d, /n\("\[0,1,2\]"\)\.akkordton\(4\)/);
  assert.match(d, /ONE call/);
  assert.match(d, /same downbeat/);
  assert.match(d, /harmonie\.fremd/);
  assert.match(tools.find((y) => y.name === 'strudel').description, /\.harm\(oktave\)/);
});

test('posts the body unchanged to POST /harmonie and returns the answer', async (t) => {
  const { c, gesehen } = await verbinde(t, () => [200, { tonart: 'A minor', folge: ['Am7'], takte_je_akkord: 2, ab_takt: 9 }]);
  const body = { folge: 'Am7 Dm7', takte_je_akkord: 2, tonart: 'A minor', ab: 'phrase', probe: true };
  const r = await c.callTool({ name: 'harmonie', arguments: body });
  const g = gesehen.filter((x) => x.pfad === '/harmonie');
  assert.equal(g.length, 1);
  assert.equal(g[0].methode, 'POST');
  assert.deepEqual(g[0].koerper, body);
  assert.equal(g[0].quelle, 'cypher');
  assert.ok(!r.isError);
  assert.match(JSON.stringify(r.content), /A minor/);
});

test('aus and anker_takt pass through; a server refusal is an error result', async (t) => {
  const { c, gesehen } = await verbinde(t, () => [409, { fehler: 'anker_vorbei' }]);
  const r = await c.callTool({ name: 'harmonie', arguments: { aus: true, anker_takt: 3 } });
  assert.deepEqual(gesehen.find((x) => x.pfad === '/harmonie').koerper, { anker_takt: 3, aus: true });
  assert.equal(r.isError, true);
  assert.match(JSON.stringify(r.content), /anker_vorbei/);
});
