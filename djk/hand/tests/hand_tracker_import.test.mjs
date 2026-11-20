// Tracker stage 6, task 26: the tracker action import_mod {pfad} posts the module path to /tracker/import_mod and refuses a missing pfad itself.
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
      a.writeHead(200, { 'content-type': 'application/json' }); a.end(JSON.stringify({ slug: 'x', text: 'Imported' }));
    });
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  return { c, gesehen };
}

test('tracker import_mod: in the schema and the description, pfad is a text', async (t) => {
  const { c } = await verbinde(t);
  const x = (await c.listTools()).tools.find((y) => y.name === 'tracker');
  assert.ok(x.inputSchema.properties.aktion.enum.includes('import_mod'));
  assert.equal(x.inputSchema.properties.pfad.type, 'string');
  assert.match(x.description, /import_mod \{pfad\}/);
});

test('tracker import_mod posts the path; a missing or empty pfad is refused before any request', async (t) => {
  const { c, gesehen } = await verbinde(t);
  const r = await c.callTool({ name: 'tracker', arguments: { aktion: 'import_mod', pfad: 'mods/a.mod' } });
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad.split('?')[0], g.koerper]), [['POST', '/tracker/import_mod', { pfad: 'mods/a.mod' }]]);
  assert.match(r.content[0].text, /Imported/);
  for (const a of [{ aktion: 'import_mod' }, { aktion: 'import_mod', pfad: '' }]) {
    const f = await c.callTool({ name: 'tracker', arguments: a });
    assert.match(f.content[0].text, /import_mod needs pfad/);
  }
  assert.equal(gesehen.length, 1);
});
