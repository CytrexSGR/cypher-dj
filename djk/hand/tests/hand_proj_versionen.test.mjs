// Project versions B10, task 4: the hand tools proj_versionen, proj_version_sichern and proj_version_zurueck against a stub page server.
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
const text = (r) => JSON.parse(r.content[0].text);

test('the three tools are listed with English descriptions; restore says it saves the current state first', async (t) => {
  const { c } = await verbinde(t);
  const l = (await c.listTools()).tools;
  const v = l.find((x) => x.name === 'proj_versionen'), s = l.find((x) => x.name === 'proj_version_sichern'), z = l.find((x) => x.name === 'proj_version_zurueck');
  assert.ok(v && s && z);
  assert.deepEqual(s.inputSchema.required, ['name']); assert.deepEqual(z.inputSchema.required, ['id']);
  assert.match(z.description, /saves the current state first/i);
});

test('proj_versionen is GET /proj/versionen and returns the answer', async (t) => {
  const { c, gesehen } = await verbinde(t, () => [200, { versionen: [{ id: '20261123T100000000Z', zeit: '2026-11-23T10:00:00.000Z', auto: true }] }]);
  const r = await c.callTool({ name: 'proj_versionen', arguments: {} });
  assert.deepEqual(text(r).versionen[0].id, '20261123T100000000Z');
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad, g.koerper, g.quelle]), [['GET', '/proj/versionen', null, 'cypher']]);
});

test('proj_version_sichern and proj_version_zurueck post their body', async (t) => {
  const { c, gesehen } = await verbinde(t, (m, u) => [200, u === '/proj/version_sichern' ? { ok: true, id: 'X--A' } : { ok: true, gesichert_als: 'Y--before restore' }]);
  assert.equal(text(await c.callTool({ name: 'proj_version_sichern', arguments: { name: 'A' } })).id, 'X--A');
  assert.equal(text(await c.callTool({ name: 'proj_version_zurueck', arguments: { id: 'X--A' } })).gesichert_als, 'Y--before restore');
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad, g.koerper]), [
    ['POST', '/proj/version_sichern', { name: 'A' }],
    ['POST', '/proj/version_zurueck', { id: 'X--A' }],
  ]);
});

test('an error answer comes back as the tool error with fehler and text', async (t) => {
  const { c } = await verbinde(t, () => [404, { ok: false, grund: 'version_unbekannt', fehler: 'version_unbekannt', text: 'that version does not exist in this project' }]);
  const r = await c.callTool({ name: 'proj_version_zurueck', arguments: { id: 'nix' } });
  assert.equal(r.isError, true);
  assert.equal(text(r).fehler, 'version_unbekannt'); assert.match(text(r).text, /does not exist/);
  const g = await verbinde(t, () => [400, { ok: false, grund: 'version_name_leer', text: 'the version needs a name' }]);
  const r2 = await g.c.callTool({ name: 'proj_version_sichern', arguments: { name: '' } });
  assert.equal(r2.isError, true); assert.equal(text(r2).fehler, 'version_name_leer'); assert.match(text(r2).text, /needs a name/);
});
