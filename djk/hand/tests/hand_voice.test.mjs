// djk-hand stimme (strand 11 slice 7, task 7.10): runs the stimme_bauen CLI (stub via DJK_STIMME_BAUEN), then cuts the loop
// (POST /sampler/schnitt, raster, scheiben = phrases) and puts the cut on a channel (POST /graph). Fake page server and temp folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');

async function aufbau(t, antworten, stubText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stimme-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stub = path.join(dir, 'stub.sh');
  fs.writeFileSync(stub, stubText ?? `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/args.txt"\necho '{"name":"x","phrasen":3}'\n`, { mode: 0o755 });
  const gesehen = [];
  const s = http.createServer((q, a) => {
    let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => {
      gesehen.push({ methode: q.method, pfad: q.url, koerper: b ? JSON.parse(b) : null });
      const [code, j] = antworten(q.method, q.url) ?? [200, { ok: true }];
      a.writeHead(code, { 'content-type': 'application/json' }); a.end(JSON.stringify(j));
    });
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`],
    env: { ...process.env, DJK_STIMME_BAUEN: stub } }));
  t.after(async () => { await c.close(); s.close(); });
  return { c, gesehen, dir };
}
const server = (m, u) => (u === '/sampler/schnitt' ? [200, { schnitt: { id: 'cut42' } }] : u === '/graph' ? [200, { ok: true }] : null);
const text = (r) => JSON.parse(r.content[0].text);

test('stimme: CLI, then cut, then graph, answer names the notes', async (t) => {
  const { c, gesehen, dir } = await aufbau(t, server);
  const w = (await c.listTools()).tools.find((x) => x.name === 'stimme');
  assert.ok(w, 'the tool exists');
  assert.deepEqual(w.inputSchema.properties.kanal.enum, ['erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2']);
  assert.ok(w.description.includes('make the WAVs first'));
  const r = await c.callTool({ name: 'stimme', arguments: { dateien: ['/a.wav', '/b.wav', '/c.wav'], stil: 'fluester', takte: 2, name: 'v1', kanal: 'erz/5' } });
  assert.ok(!r.isError, JSON.stringify(r));
  const args = fs.readFileSync(path.join(dir, 'args.txt'), 'utf8').split('\n');
  assert.deepEqual(args.slice(0, 3), ['/a.wav', '/b.wav', '/c.wav']);
  assert.ok(args.includes('--stil') && args[args.indexOf('--stil') + 1] === 'fluester');
  assert.equal(args[args.indexOf('--takte') + 1], '2');
  assert.equal(args[args.indexOf('--name') + 1], 'v1');
  assert.match(args[args.indexOf('--loops') + 1], /loops$/);
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad]), [['POST', '/sampler/schnitt'], ['POST', '/graph']]);
  assert.deepEqual(gesehen[0].koerper, { quelle: { art: 'loop', ref: 'v1' }, name: 'v1', methode: 'raster', scheiben: 3 });
  assert.deepEqual(gesehen[1].koerper, { kanal: 'erz/5', name: 'cut42' });
  const j = text(r);
  assert.equal(j.loop, 'v1'); assert.equal(j.schnitt, 'cut42'); assert.equal(j.kanal, 'erz/5');
  assert.equal(j.noten, 'note n-1 = phrase n');
});

test('stimme: scheiben overrides the phrase count; a CLI failure stops before any request', async (t) => {
  const { c, gesehen } = await aufbau(t, server);
  await c.callTool({ name: 'stimme', arguments: { dateien: ['/a.wav'], stil: 'roh', name: 'v2', kanal: 'pad/1', scheiben: 8 } });
  assert.equal(gesehen[0].koerper.scheiben, 8);
  const f = await aufbau(t, server, '#!/bin/sh\necho "loop folder exists" >&2\nexit 1\n');
  const r = await f.c.callTool({ name: 'stimme', arguments: { dateien: ['/a.wav'], stil: 'roh', name: 'v3', kanal: 'erz/6' } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /loop folder exists/);
  assert.equal(f.gesehen.length, 0);
});

test('stimme: bad arguments are refused before the CLI runs', async (t) => {
  const { c, gesehen, dir } = await aufbau(t, server);
  for (const a of [{ dateien: [], stil: 'roh', name: 'v', kanal: 'erz/5' }, { dateien: ['rel.wav'], stil: 'roh', name: 'v', kanal: 'erz/5' },
    { dateien: ['/a.wav'], stil: 'x', name: 'v', kanal: 'erz/5' }, { dateien: ['/a.wav'], stil: 'roh', name: 'v', kanal: 'erz/2' }]) {
    const r = await c.callTool({ name: 'stimme', arguments: a });
    assert.equal(r.isError, true, JSON.stringify(a));
  }
  assert.equal(gesehen.length, 0);
  assert.equal(fs.existsSync(path.join(dir, 'args.txt')), false);
});
