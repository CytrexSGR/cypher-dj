// djk-hand szene (strand 11 slice 5, task 5.3): every aktion hits POST /szene with its fields only and the cypher header,
// stille saves _vor_stille before its first silence, and the class row lets the reading aktionen through.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { HAND_KLASSEN } from '../../ui/http/hand_klassen.ts';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');

async function aufbau(t, antworten) {
  const gesehen = [];
  const s = http.createServer((q, a) => {
    let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => {
      gesehen.push({ methode: q.method, pfad: q.url, quelle: q.headers['x-djk-quelle'], koerper: b ? JSON.parse(b) : null });
      const x = antworten(q.method, q.url);
      if (x === 'haengen') return;   // never answers
      const [code, j] = x ?? [200, { ok: true }];
      a.writeHead(code, { 'content-type': 'application/json' }); a.end(JSON.stringify(j));
    });
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.closeAllConnections(); s.close(); });
  return { c, gesehen };
}

const FAELLE = [
  [{ aktion: 'sichern', name: 'intro' }, { aktion: 'sichern', name: 'intro' }],
  [{ aktion: 'ersetzen', name: 'intro' }, { aktion: 'ersetzen', name: 'intro' }],
  [{ aktion: 'laden', name: 'intro', takte: 4 }, { aktion: 'laden', name: 'intro', takte: 4 }],
  [{ aktion: 'laden', name: '_vor_laden' }, { aktion: 'laden', name: '_vor_laden' }],
  [{ aktion: 'liste' }, { aktion: 'liste' }],
  [{ aktion: 'zeige', name: 'intro' }, { aktion: 'zeige', name: 'intro' }],
  [{ aktion: 'loeschen', name: 'intro', unbekannt: 1 }, { aktion: 'loeschen', name: 'intro' }],
];

test('szene: the six aktionen hit POST /szene with their fields only and the cypher header', async (t) => {
  const { c, gesehen } = await aufbau(t, () => null);
  const w = (await c.listTools()).tools.find((x) => x.name === 'szene');
  assert.ok(w, 'the tool exists');
  assert.deepEqual(w.inputSchema.properties.aktion.enum, ['sichern', 'ersetzen', 'laden', 'liste', 'zeige', 'loeschen']);
  assert.deepEqual([w.inputSchema.properties.takte.minimum, w.inputSchema.properties.takte.maximum], [0, 16]);
  for (const wort of ['_vor_laden', 'ausgelassen', '_vor_stille', 'next bar', 'szene laden _vor_laden']) assert.ok(w.description.includes(wort), `description names ${wort}`);
  for (const [args, koerper] of FAELLE) {
    const r = await c.callTool({ name: 'szene', arguments: args });
    assert.ok(!r.isError, JSON.stringify(args));
    assert.deepEqual(gesehen.at(-1), { methode: 'POST', pfad: '/szene', quelle: 'cypher', koerper }, JSON.stringify(args));
  }
});

test('szene: an unknown aktion is refused before any request; a server refusal is the tool error', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/szene' ? [409, { fehler: 'szene_vorhanden', name: 'intro' }] : null));
  const r = await c.callTool({ name: 'szene', arguments: { aktion: 'wegwerfen' } });
  assert.equal(r.isError, true);
  assert.equal(gesehen.length, 0);
  const r2 = await c.callTool({ name: 'szene', arguments: { aktion: 'sichern', name: 'intro' } });
  assert.equal(r2.isError, true);
  assert.match(r2.content[0].text, /szene_vorhanden/);
});

test('szene: the class row lets liste and zeige through as reading, ersetzen and loeschen are destructive, laden writes', () => {
  const e = HAND_KLASSEN.szene;
  assert.equal(e.stufe, 'schreiben');
  assert.deepEqual(e.lesendePost, ['/szene']);
  assert.equal(e.aktionen.liste.stufe, 'lesen');
  assert.equal(e.aktionen.zeige.stufe, 'lesen');
  assert.equal(e.aktionen.ersetzen.stufe, 'zerstoerend');
  assert.equal(e.aktionen.loeschen.stufe, 'zerstoerend');
  assert.equal(e.aktionen.laden, undefined);
  assert.equal(e.aktionen.sichern, undefined);
});

test('stille: sends the _vor_stille snapshot before the first silence', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/strudel' ? [200, { ok: true }] : null));
  const r = await c.callTool({ name: 'stille', arguments: {} });
  assert.ok(!r.isError, r.content[0].text);
  const posts = gesehen.filter((x) => x.methode === 'POST');
  assert.deepEqual(posts[0], { methode: 'POST', pfad: '/szene', quelle: 'cypher', koerper: { aktion: 'sichern', name: '_vor_stille' } });
  assert.ok(posts.slice(1).every((x) => x.pfad === '/strudel'));
  assert.ok(posts.length >= 2);
  assert.match(r.content[0].text, /_vor_stille/);
});

test('stille: a failed snapshot never stops the silence and is reported in the answer', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/szene' ? [409, { fehler: 'kein_liveprojekt' }] : u === '/strudel' ? [200, { ok: true }] : null));
  const r = await c.callTool({ name: 'stille', arguments: {} });
  assert.ok(!r.isError, r.content[0].text);
  assert.ok(gesehen.filter((x) => x.pfad === '/strudel').length >= 1);
  assert.match(r.content[0].text, /kein_liveprojekt/);
});

test('stille: over a silence the server keeps the older snapshot, the answer says schon_still', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/szene' ? [200, { ok: true, name: '_vor_stille', geschrieben: false, grund: 'schon_still' }] : u === '/strudel' ? [200, { ok: true }] : null));
  const r = await c.callTool({ name: 'stille', arguments: {} });
  assert.ok(!r.isError, r.content[0].text);
  assert.ok(gesehen.some((x) => x.pfad === '/strudel'));
  assert.match(r.content[0].text, /"szene_vorher":\s*"schon_still"/);
});

test('stille: a snapshot that hangs is given up after 1.5 s and the silence still goes out', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/szene' ? 'haengen' : u === '/strudel' ? [200, { ok: true }] : null));
  const t0 = Date.now();
  const r = await c.callTool({ name: 'stille', arguments: {} });
  assert.ok(!r.isError, r.content[0].text);
  assert.ok(Date.now() - t0 < 5000, 'did not wait for the hanging snapshot');
  assert.ok(gesehen.filter((x) => x.pfad === '/strudel').length >= 1);
  assert.match(r.content[0].text, /zeitlimit/);
});
