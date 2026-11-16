// Workbench stage 1, task 2: the hand tool proj_neu carries werkbank and vorlage in its schema and forwards them in the request body.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');

async function verbinde(t) {
  const gesehen = [];
  const s = http.createServer((q, a) => {
    let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => {
      gesehen.push({ methode: q.method, pfad: q.url, koerper: b ? JSON.parse(b) : null });
      a.writeHead(200, { 'content-type': 'application/json' }); a.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  return { c, gesehen };
}

test('proj_neu schema: werkbank is a boolean, vorlage an enum; the description says what a module is', async (t) => {
  const { c } = await verbinde(t);
  const x = (await c.listTools()).tools.find((y) => y.name === 'proj_neu');
  assert.equal(x.inputSchema.properties.werkbank.type, 'boolean');
  assert.deepEqual(x.inputSchema.properties.vorlage.enum, ['techno-130-start']);
  assert.deepEqual(x.inputSchema.required, ['name']);
  assert.match(x.description, /workbench module/i);
  assert.match(x.description, /vorlage needs werkbank/i);
});

test('proj_neu forwards werkbank and vorlage in the body, and only when given', async (t) => {
  const { c, gesehen } = await verbinde(t);
  await c.callTool({ name: 'proj_neu', arguments: { name: 'Plain' } });
  await c.callTool({ name: 'proj_neu', arguments: { name: 'Mod', werkbank: true } });
  await c.callTool({ name: 'proj_neu', arguments: { name: 'Tpl', werkbank: true, vorlage: 'techno-130-start' } });
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad, g.koerper]), [
    ['POST', '/proj/neu?antwort=kurz', { name: 'Plain' }],
    ['POST', '/proj/neu?antwort=kurz', { name: 'Mod', werkbank: true }],
    ['POST', '/proj/neu?antwort=kurz', { name: 'Tpl', werkbank: true, vorlage: 'techno-130-start' }],
  ]);
});
