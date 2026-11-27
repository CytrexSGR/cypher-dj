// djk-hand spur: anker_takt and probe are passed through to POST /spur, ab stays the default, descriptions name the new fields (fake page server).
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

const F = [{ ziel: 'strom:6', ab_takt: 1, muster: 's("bd")' }];

test('spur: descriptions and schema name the stream list, anker_takt and probe; lage names the uhr fields', async (t) => {
  const { c } = await aufbau(t);
  const tools = (await c.listTools()).tools;
  const w = tools.find((x) => x.name === 'spur');
  for (const wort of ['strom:<n>', '1, 2, 3, 5, 6, 7, 9, 10', 'anker_takt', 'probe', 'strom_ohne_erzeuger', 'anker_vorbei', 'fruehester_takt', 'bar 1 mod 8']) assert.ok(w.description.includes(wort), `names ${wort}`);
  assert.equal(w.inputSchema.properties.anker_takt.type, 'integer');
  assert.equal(w.inputSchema.properties.anker_takt.minimum, 1);
  assert.equal(w.inputSchema.properties.probe.type, 'boolean');
  const l = tools.find((x) => x.name === 'lage').description;
  assert.ok(l.includes('uhr.naechster_takt') && l.includes('uhr.naechste_phrase_takt'));
});

test('spur: arguments reach POST /spur', async (t) => {
  const { c, gesehen } = await aufbau(t);
  await c.callTool({ name: 'spur', arguments: { name: 'a', fahrten: F } });
  await c.callTool({ name: 'spur', arguments: { name: 'a', fahrten: F, anker_takt: 17, probe: true } });
  await c.callTool({ name: 'spur', arguments: { name: 'a', fahrten: F, ab: 'phrase', probe: false } });
  await c.callTool({ name: 'spur', arguments: { name: 'a', fahrten: F, ab: 'takt', anker_takt: 9 } });
  const k = gesehen.map((x) => x.koerper);
  assert.ok(gesehen.every((x) => x.methode === 'POST' && x.pfad === '/spur'));
  assert.deepEqual(k[0].ab, 'takt'); assert.ok(!('anker_takt' in k[0]) && !('probe' in k[0]));
  assert.equal(k[1].anker_takt, 17); assert.equal(k[1].probe, true); assert.ok(!('ab' in k[1]));
  assert.equal(k[2].ab, 'phrase'); assert.equal(k[2].probe, false);
  assert.equal(k[3].ab, 'takt'); assert.equal(k[3].anker_takt, 9); // both passed: the server refuses it
  assert.equal(k[1].spur.fahrten[0].ziel, 'strom:6');
});
