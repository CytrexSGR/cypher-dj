// Audit U28 repro: warte {takte} must wait for the target bar also at 60 BPM, where 8 bars take 32 s (more than a fixed 30 s cap),
// and must not report a cut-short wait as a plain success.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');

async function aufbau(t, beatVon) {
  const t0 = Date.now();
  const s = http.createServer((q, a) => {
    q.resume(); q.on('end', () => {
      a.writeHead(200, { 'content-type': 'application/json' });
      a.end(JSON.stringify({ uhr: { beat: beatVon((Date.now() - t0) / 1000), bpm: 60 }, decks: [] }));
    });
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  return c;
}

test('audit U28: warte 8 bars at 60 BPM returns only once the target beat is reached', async (t) => {
  const c = await aufbau(t, (sek) => 100 + sek);   // 1 beat per second = 60 BPM
  const r = await c.callTool({ name: 'warte', arguments: { takte: 8 } });
  const beat = JSON.parse(r.content[0].text).uhr.beat;
  assert.ok(!r.isError, r.content[0].text);
  assert.ok(beat >= 132, `returned at beat ${beat}, target 132`);
});

test('audit U28: warte answers a timeout error (not the bare lage) when the clock does not advance', async (t) => {
  const c = await aufbau(t, () => 100);   // stalled clock
  const r = await c.callTool({ name: 'warte', arguments: { takte: 1 } });
  assert.equal(r.isError, true, r.content[0].text);
  assert.match(r.content[0].text, /warte_frist/);
});
