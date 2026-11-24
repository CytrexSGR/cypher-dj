// The hand tool proj_dateien against a stand-in page server (browser plan 2).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');

async function aufbau(t) {
  const gesehen = [];
  const s = http.createServer((q, a) => {
    let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => {
      gesehen.push({ methode: q.method, pfad: q.url, quelle: q.headers['x-djk-quelle'], koerper: b ? JSON.parse(b) : null });
      a.writeHead(200, { 'content-type': 'application/json' }); a.end(JSON.stringify({ ok: true, audio: [] }));
    });
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  return { c, gesehen };
}

test('proj_dateien is listed and without aktion reads GET /proj/dateien', async (t) => {
  const { c, gesehen } = await aufbau(t);
  assert.ok((await c.listTools()).tools.some((x) => x.name === 'proj_dateien'));
  const r = await c.callTool({ name: 'proj_dateien', arguments: {} });
  assert.equal(r.isError ?? false, false);
  assert.deepEqual([gesehen[0].methode, gesehen[0].pfad], ['GET', '/proj/dateien']);
});

test('proj_umbenennen posts slug and name to /proj/umbenennen as cypher', async (t) => {
  const { c, gesehen } = await aufbau(t);
  assert.ok((await c.listTools()).tools.some((x) => x.name === 'proj_umbenennen'));
  await c.callTool({ name: 'proj_umbenennen', arguments: { slug: 'alpha', name: 'Gamma ä' } });
  assert.deepEqual(gesehen.map((x) => [x.methode, x.pfad, x.quelle, x.koerper]), [['POST', '/proj/umbenennen', 'cypher', { slug: 'alpha', name: 'Gamma ä' }]]);
});

test('proj_dateien with aktion posts to finden, relink and aufraeumen', async (t) => {
  const { c, gesehen } = await aufbau(t);
  await c.callTool({ name: 'proj_dateien', arguments: { aktion: 'aufraeumen', nur_zeigen: true } });
  await c.callTool({ name: 'proj_dateien', arguments: { aktion: 'finden', sha256: 'ab' } });
  await c.callTool({ name: 'proj_dateien', arguments: { aktion: 'relink', sha256: 'ab', pfad: '/x/y.wav' } });
  assert.deepEqual(gesehen.map((x) => [x.methode, x.pfad, x.quelle, x.koerper]), [
    ['POST', '/proj/aufraeumen', 'cypher', { nur_zeigen: true }],
    ['POST', '/proj/finden', 'cypher', { sha256: 'ab' }],
    ['POST', '/proj/relink', 'cypher', { sha256: 'ab', pfad: '/x/y.wav' }]]);
  const falsch = await c.callTool({ name: 'proj_dateien', arguments: { aktion: 'loeschen' } });
  assert.equal(falsch.isError, true);
});

test('AUFRUF.md documents both tools and their arguments', async () => {
  const fs = await import('node:fs');
  const doc = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'AUFRUF.md'), 'utf8');
  for (const w of ['proj_dateien', 'proj_umbenennen', 'aktion', 'sha256', 'pfad', 'nur_zeigen', 'slug', 'name']) assert.ok(doc.includes(w), `AUFRUF.md names ${w}`);
  assert.match(doc, /\| `proj_dateien` \|/);
  assert.match(doc, /\| `proj_umbenennen` \|/);
});
