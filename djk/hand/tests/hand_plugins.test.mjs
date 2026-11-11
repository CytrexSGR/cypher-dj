// Plan 1.11 task 8 (hand part): the tool `plugins` against a stand-in page server, and the Stop Cypher rule on the real session.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');
const PLUGINS = [{ id: 'a1', name: 'Fake EQ', art: 'effekt', status: 'ok' }, { id: 'b2', name: 'Synth', art: 'instrument', status: 'ok' }];

async function aufbau(t) {
  const gesehen = [];
  const s = http.createServer((q, a) => {
    let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => {
      gesehen.push({ methode: q.method, pfad: q.url, quelle: q.headers['x-djk-quelle'], koerper: b ? JSON.parse(b) : null });
      let code = 200, j = {};
      if (q.url.startsWith('/plugins')) j = { plugins: new URL(q.url, 'http://x').searchParams.get('art') ? PLUGINS.filter((x) => x.art === 'effekt') : PLUGINS, scan: {} };
      else if (q.url.endsWith('/parameter')) j = { parameter: [{ index: 0, name: 'Gain', wert: 0.5 }] };
      else if (q.url.endsWith('/param')) j = { ok: true, werte: JSON.parse(b).werte };
      else code = 404;
      a.writeHead(code, { 'content-type': 'application/json' }); a.end(JSON.stringify(j));
    });
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  return { c, gesehen };
}
const ruf = async (c, arguments_) => { const r = await c.callTool({ name: 'plugins', arguments: arguments_ }); return { fehler: r.isError === true, j: JSON.parse(r.content[0].text) }; };

test('plugins: liste returns the entries (art filter goes to the server), zeige finds one, an unknown id is plugin_unbekannt', async (t) => {
  const { c, gesehen } = await aufbau(t);
  assert.deepEqual((await ruf(c, { aktion: 'liste' })).j.plugins.map((x) => x.id), ['a1', 'b2']);
  assert.deepEqual((await ruf(c, { aktion: 'liste', art: 'effekt' })).j.plugins.map((x) => x.id), ['a1']);
  assert.ok(gesehen.every((x) => x.quelle === 'cypher'));
  assert.equal((await ruf(c, { aktion: 'zeige', id: 'b2' })).j.name, 'Synth');
  const u = await ruf(c, { aktion: 'zeige', id: 'zz' });
  assert.deepEqual([u.fehler, u.j.fehler], [true, 'plugin_unbekannt']);
});

test('plugins: parameter and param go to the insert routes; no rescan or window action exists', async (t) => {
  const { c, gesehen } = await aufbau(t);
  assert.equal((await ruf(c, { aktion: 'parameter', insert_id: 'i1' })).j.parameter[0].name, 'Gain');
  assert.deepEqual((await ruf(c, { aktion: 'param', insert_id: 'i1', werte: { 0: 0.8 } })).j.werte, { 0: 0.8 });
  const p = gesehen.find((x) => x.pfad === '/proj/insert/i1/param');
  assert.deepEqual([p.methode, p.quelle, p.koerper], ['POST', 'cypher', { werte: { 0: 0.8 } }]);
  for (const aktion of ['rescan', 'entsperren', 'fenster']) assert.equal((await ruf(c, { aktion })).fehler, true, aktion);
  assert.equal((await ruf(c, { aktion: 'param', insert_id: '../x', werte: {} })).fehler, true);
  assert.equal(gesehen.filter((x) => x.methode === 'POST').length, 1, 'the refused calls sent nothing');
  const tools = (await c.listTools()).tools;
  const d = tools.find((x) => x.name === 'proj_aendern').description;
  for (const w of ['art: "host"', 'plugin_id', 'insert_latenz_extra', 'plugin_blockiert', 'kein_effekt', 'plugin_unbekannt']) assert.ok(d.includes(w), w);
});

test('plugins (task 17): parameter and param take spur_id of a plugin instrument track; both ids or a malformed one are refused without a request; the descriptions name the device', async (t) => {
  const { c, gesehen } = await aufbau(t);
  assert.equal((await ruf(c, { aktion: 'parameter', spur_id: 's1' })).j.parameter[0].name, 'Gain');
  assert.deepEqual((await ruf(c, { aktion: 'param', spur_id: 's1', werte: { 0: 0.3 } })).j.werte, { 0: 0.3 });
  const p = gesehen.find((x) => x.pfad === '/proj/spur/s1/geraet/param');
  assert.deepEqual([p.methode, p.quelle, p.koerper], ['POST', 'cypher', { werte: { 0: 0.3 } }]);
  assert.ok(gesehen.some((x) => x.pfad === '/proj/spur/s1/geraet/parameter'));
  const vor = gesehen.length;
  for (const a of [{ aktion: 'parameter', spur_id: 's1', insert_id: 'i1' }, { aktion: 'parameter', spur_id: '../x' }, { aktion: 'param', spur_id: 'x1', werte: {} }]) {
    assert.equal((await ruf(c, a)).fehler, true, JSON.stringify(a));
  }
  assert.equal(gesehen.length, vor);
  const tools = (await c.listTools()).tools;
  assert.ok(tools.find((x) => x.name === 'plugins').description.includes('name: "plugin"'));
  assert.ok(tools.find((x) => x.name === 'proj_aendern').description.includes('name plugin + plugin_id'));
});
