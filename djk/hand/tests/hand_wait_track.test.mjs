// Slice 7 task 7.1: `warte bis spur_ende` against a fake page server (GET /spur + GET /lage).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');

// stand.beat advances by schritt on every /lage; stand.spuren is the /spur answer; stand.zeiten collects request times of /spur.
async function verbinde(t, stand) {
  stand.zeiten = [];
  const s = http.createServer((q, a) => {
    q.resume();
    let j = { ok: true };
    if (q.url === '/lage') { stand.beat += stand.schritt; stand.bei?.(stand); j = { uhr: { beat: stand.beat, bpm: 124 }, ki: {}, regler: {}, ...(stand.taktart ? { taktart: stand.taktart } : {}) }; }
    else if (q.url === '/spur') { stand.zeiten.push(Date.now()); j = stand.spuren(stand); }
    a.writeHead(200, { 'content-type': 'application/json' }); a.end(JSON.stringify(j));
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  return c;
}
const rufe = async (c, name, args = {}) => { const r = await c.callTool({ name, arguments: args }); return { fehler: r.isError, j: JSON.parse(r.content[0].text) }; };

test('ende_beat approaches: vorher with rest_takte, polls at least 2 s apart', async (t) => {
  // beat 0, +8 per poll, end at 40: after poll 1 rest 32 beats, poll 4 (beat 24) rest 16 <= 4 * 4
  const stand = { beat: -8, schritt: 8, spuren: () => [{ name: 'bogen', ende_beat: 40, anker_beat: 0 }] };
  const c = await verbinde(t, stand);
  const { j } = await rufe(c, 'warte', { bis: 'spur_ende', name: 'bogen', vorher_takte: 4 });
  assert.equal(j.grund, 'vorher');
  assert.equal(j.rest_takte, 4);
  assert.ok(j.uhr.beat >= 24 && stand.zeiten.length === 4, `polls ${stand.zeiten.length}`);
  for (let i = 1; i < stand.zeiten.length; i++) assert.ok(stand.zeiten[i] - stand.zeiten[i - 1] >= 1900, 'poll gap >= 2 s');
});

test('track removed before its end: gestoppt; at its end: beendet; unknown at first poll: spur_unbekannt', async (t) => {
  let n = 0;
  const c1 = await verbinde(t, { beat: 0, schritt: 4, spuren: () => (++n < 2 ? [{ name: 'x', ende_beat: 400 }] : []) });
  assert.equal((await rufe(c1, 'warte', { bis: 'spur_ende', name: 'x', vorher_takte: 0 })).j.grund, 'gestoppt');
  let m = 0;
  const c2 = await verbinde(t, { beat: 0, schritt: 12, spuren: () => (++m < 2 ? [{ name: 'x', ende_beat: 20 }] : []) });
  assert.equal((await rufe(c2, 'warte', { bis: 'spur_ende', name: 'x', vorher_takte: 0 })).j.grund, 'beendet');
  const c3 = await verbinde(t, { beat: 0, schritt: 4, spuren: () => [] });
  const u = await rufe(c3, 'warte', { bis: 'spur_ende', name: 'nope' });
  assert.equal(u.fehler, true);
  assert.equal(u.j.fehler, 'spur_unbekannt');
});

test('takte wait still works without bis', async (t) => {
  const c = await verbinde(t, { beat: 0, schritt: 8, spuren: () => [] });
  assert.ok((await rufe(c, 'warte', { takte: 1 })).j.uhr.beat >= 4);
});

test('B1: a stopped clock ends the wait after 10 s with bis uhr_steht', { timeout: 60000 }, async (t) => {
  const stand = { beat: 0, schritt: 0, spuren: () => [{ name: 'bogen', ende_beat: 400 }] };
  const c = await verbinde(t, stand);
  const t0 = Date.now();
  const { j } = await rufe(c, 'warte', { bis: 'spur_ende', name: 'bogen', vorher_takte: 0 });
  assert.equal(j.bis, 'uhr_steht');
  assert.ok(Date.now() - t0 >= 10_000 && Date.now() - t0 < 20_000, `after ${Date.now() - t0} ms`);
});

test('B1: a clock that crawls hits the one fixed deadline (rest at 60 BPM plus 30 s) with bis frist', { timeout: 90000 }, async (t) => {
  // rest 5 beats = 5 s + 30 s = 35 s; the clock moves a little on every poll, so it is not "stopped"; renewing per poll would never end
  const stand = { beat: 0, schritt: 0.001, spuren: () => [{ name: 'bogen', ende_beat: 5 }] };
  const c = await verbinde(t, stand);
  const t0 = Date.now();
  const { j } = await rufe(c, 'warte', { bis: 'spur_ende', name: 'bogen', vorher_takte: 0 });
  assert.equal(j.bis, 'frist');
  assert.ok(Date.now() - t0 >= 35_000 && Date.now() - t0 < 42_000, `after ${Date.now() - t0} ms`);
});

test('B2: vorher counts bars with the meter of lage (taktart [3, 4])', async (t) => {
  // beat 0, +6 per poll, end at 18: with 3 beats per bar vorher 2 means rest <= 6 beats; poll 2 (beat 12) is rest 6 = 2 bars
  const stand = { beat: -6, schritt: 6, spuren: () => [{ name: 'bogen', ende_beat: 18 }], taktart: [3, 4] };
  const c = await verbinde(t, stand);
  const { j } = await rufe(c, 'warte', { bis: 'spur_ende', name: 'bogen', vorher_takte: 2 });
  assert.equal(j.grund, 'vorher');
  assert.equal(j.rest_takte, 2);
});
