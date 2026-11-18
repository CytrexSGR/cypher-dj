// The proj_export tool text names every refusal the real-time export can answer, the tempo step included (a deck plays at another tempo than
// the project: the master cannot go to the project tempo).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');

test('proj_export description lists the tempo refusals of the real-time export', async (t) => {
  const s = http.createServer((q, a) => { a.writeHead(404); a.end('{}'); });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  const d = (await c.listTools()).tools.find((x) => x.name === 'proj_export').description;
  const echtzeit = d.slice(d.indexOf('Foreign plugins'));
  for (const grund of ['deck_laeuft', 'tempo_abgelehnt', 'kein_kern', 'rampe_haengt']) assert.ok(echtzeit.includes(grund), `${grund} missing from the real-time refusals`);
});
