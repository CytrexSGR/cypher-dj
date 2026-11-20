// Tracker stage 4, task 22: the hand tool proj_neu carries tracker and the tracker templates in its schema and forwards them in the request body.
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

test('proj_neu schema: tracker is a boolean, vorlage knows the tracker templates; the description names them', async (t) => {
  const { c } = await verbinde(t);
  const x = (await c.listTools()).tools.find((y) => y.name === 'proj_neu');
  assert.equal(x.inputSchema.properties.tracker.type, 'boolean');
  assert.deepEqual(x.inputSchema.properties.vorlage.enum, ['techno-130-start', '8bit-4kanal', 'chip']);
  assert.deepEqual(x.inputSchema.required, ['name']);
  assert.match(x.description, /tracker: true creates a tracker project/);
  assert.match(x.description, /8bit-4kanal/);
  assert.match(x.description, /chip/);
});

test('proj_neu forwards tracker and vorlage in the body, and only when given', async (t) => {
  const { c, gesehen } = await verbinde(t);
  await c.callTool({ name: 'proj_neu', arguments: { name: 'Plain' } });
  await c.callTool({ name: 'proj_neu', arguments: { name: 'Tr', tracker: true } });
  await c.callTool({ name: 'proj_neu', arguments: { name: 'Tpl', tracker: true, vorlage: '8bit-4kanal' } });
  await c.callTool({ name: 'proj_neu', arguments: { name: 'Chip', tracker: true, vorlage: 'chip' } });
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad, g.koerper]), [
    ['POST', '/proj/neu?antwort=kurz', { name: 'Plain' }],
    ['POST', '/proj/neu?antwort=kurz', { name: 'Tr', tracker: true }],
    ['POST', '/proj/neu?antwort=kurz', { name: 'Tpl', tracker: true, vorlage: '8bit-4kanal' }],
    ['POST', '/proj/neu?antwort=kurz', { name: 'Chip', tracker: true, vorlage: 'chip' }],
  ]);
});
