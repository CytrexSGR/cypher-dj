// djk-hand aufbau (strand 11 slice 7, task 7.8): every aktion hits POST /aufbau with its fields only and the cypher header;
// the class row lets liste and zeige through as reading.
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
  [{ aktion: 'laden', name: 'intro' }, { aktion: 'laden', name: 'intro' }],
  [{ aktion: 'liste' }, { aktion: 'liste' }],
  [{ aktion: 'zeige', name: 'intro' }, { aktion: 'zeige', name: 'intro' }],
  [{ aktion: 'loeschen', name: 'intro', unbekannt: 1 }, { aktion: 'loeschen', name: 'intro' }],
];

test('aufbau: the six aktionen hit POST /aufbau with their fields only and the cypher header', async (t) => {
  const { c, gesehen } = await aufbau(t, () => null);
  const w = (await c.listTools()).tools.find((x) => x.name === 'aufbau');
  assert.ok(w, 'the tool exists');
  assert.deepEqual(w.inputSchema.properties.aktion.enum, ['sichern', 'ersetzen', 'laden', 'liste', 'zeige', 'loeschen']);
  for (const wort of ['kein_hoerschein', 'ausgelassen', 'live_laeuft', 'aufbau_vorhanden', 'papierkorb', '2 bars']) assert.ok(w.description.includes(wort), `description names ${wort}`);
  for (const [args, koerper] of FAELLE) {
    const r = await c.callTool({ name: 'aufbau', arguments: args });
    assert.ok(!r.isError, JSON.stringify(args));
    assert.deepEqual(gesehen.at(-1), { methode: 'POST', pfad: '/aufbau', quelle: 'cypher', koerper }, JSON.stringify(args));
  }
});

test('aufbau: an unknown aktion is refused before any request; a server refusal is the tool error', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/aufbau' ? [409, { fehler: 'aufbau_vorhanden', name: 'intro' }] : null));
  const r = await c.callTool({ name: 'aufbau', arguments: { aktion: 'wegwerfen' } });
  assert.equal(r.isError, true);
  assert.equal(gesehen.length, 0);
  const r2 = await c.callTool({ name: 'aufbau', arguments: { aktion: 'sichern', name: 'intro' } });
  assert.equal(r2.isError, true);
  assert.match(r2.content[0].text, /aufbau_vorhanden/);
});

test('aufbau: the class row lets liste and zeige through as reading, ersetzen and loeschen are destructive, laden writes', () => {
  const e = HAND_KLASSEN.aufbau;
  assert.equal(e.stufe, 'schreiben');
  assert.deepEqual(e.lesendePost, ['/aufbau']);
  assert.equal(e.aktionen.liste.stufe, 'lesen');
  assert.equal(e.aktionen.zeige.stufe, 'lesen');
  assert.equal(e.aktionen.ersetzen.stufe, 'zerstoerend');
  assert.equal(e.aktionen.loeschen.stufe, 'zerstoerend');
  assert.equal(e.aktionen.laden, undefined);
  assert.equal(e.aktionen.sichern, undefined);
});
