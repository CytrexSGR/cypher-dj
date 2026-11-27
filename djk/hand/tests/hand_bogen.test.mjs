// djk-hand bogen: arguments reach POST /bogen unchanged, the description names the arc concepts (fake page server).
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

const SCHICHTEN = [
  { strom: 1, muster: 's("hh*8")', ab_takt: 1, rein: 8, name: 'hats' },
  { strom: 1, muster: 's("cp")', ab_takt: 5, bis_takt: 25, raus: 4 },
  { strom: 2, muster: 'note("c1")', ab_takt: 1 },
];
const BRUCH = { ab_takt: 13, takte: 4, behalte: [1] };
const FAHRT = [{ ziel: 'deck/1/eq/tief', ab_takt: 13, takte: 2, nach: -20 }];

test('bogen: description and schema name the arc concepts', async (t) => {
  const { c } = await aufbau(t);
  const w = (await c.listTools()).tools.find((x) => x.name === 'bogen');
  assert.ok(w, 'tool bogen is listed');
  for (const wort of ['schichten', 'bruch', 'behalte', 'rein', 'raus', 'bis_takt', 'probe', 'kompiliert', 'plan', 'spur_stopp', 'bogen_schleife', 'spur_ende', 'bogen.naechste']) assert.ok(w.description.includes(wort), `names ${wort}`);
  assert.deepEqual(w.inputSchema.required, ['name', 'takte', 'schichten']);
  assert.equal(w.inputSchema.properties.anker_takt.type, 'integer');
  assert.equal(w.inputSchema.properties.probe.type, 'boolean');
  assert.equal(w.inputSchema.properties.takte.maximum, 128);
});

test('bogen: every argument reaches POST /bogen unchanged, absent ones stay absent', async (t) => {
  const { c, gesehen } = await aufbau(t);
  await c.callTool({ name: 'bogen', arguments: { name: 'a', takte: 16, schichten: SCHICHTEN } });
  await c.callTool({ name: 'bogen', arguments: { name: 'a', takte: 16, schichten: SCHICHTEN, bruch: BRUCH, fahrten: FAHRT, anker_takt: 17, probe: true } });
  await c.callTool({ name: 'bogen', arguments: { name: 'a', takte: 16, schichten: SCHICHTEN, ab: 'phrase', probe: false } });
  assert.ok(gesehen.every((x) => x.methode === 'POST' && x.pfad === '/bogen'));
  const k = gesehen.map((x) => x.koerper);
  assert.deepEqual(k[0], { name: 'a', takte: 16, schichten: SCHICHTEN });
  assert.deepEqual(k[1], { name: 'a', takte: 16, schichten: SCHICHTEN, bruch: BRUCH, fahrten: FAHRT, anker_takt: 17, probe: true });
  assert.deepEqual(k[2], { name: 'a', takte: 16, schichten: SCHICHTEN, ab: 'phrase', probe: false });
});
