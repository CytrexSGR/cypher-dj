// Browser plan 6, task 11: the hand tool preset_vorhoeren, driven over stdio with the SDK client against the REAL POST /presets/vorhoeren
// (Router, same dispatch as server.ts) with a fake PresetVorhoerer and a fake headphone previewer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Router } from '../../ui/http/router.ts';
import { json, postAbgewiesen } from '../../ui/http/transport.ts';
import { presetsBereich } from '../../ui/presets/area.ts';
import { PresetVorhoerFehler } from '../../ui/presets/prelisten.ts';
import { VorhoerFehler } from '../../ui/prelisten.ts';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');

async function stapel(t, { vorhoerer, spiele } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hand-pvh-'));
  const gespielt = [];
  let nr = 0;
  const vh = vorhoerer ?? { pruefe: () => {}, vorhoer: async () => ({ schluessel: 'k'.repeat(64), datei: '/cache/k.wav', aus_cache: nr++ > 0, dauer_s: 3, spitze_db: -6, rms_db: -9, render_ms: 1 }) };
  const router = new Router();
  router.melde(presetsBereich({ log: () => {}, quelle: () => 'andreas' }, { werk: path.join(d, 'werk'), nutzer: path.join(d, 'nutzer'), vorhoerer: vh, spiele: spiele ?? (async (e) => { gespielt.push(e); }) }));
  let port = 0;
  const server = http.createServer(async (q, a) => {
    const url = new URL(q.url ?? '/', 'http://127.0.0.1');
    const r = router.finde(q.method ?? '', url.pathname);
    if (!r) return json(a, 404, { fehler: 'keine_route' });
    if (r.schutz === 'fremdePost' && q.method === 'POST' && postAbgewiesen(q, a, port)) return;
    await r.handler(q, a, url);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${port}`] }));
  t.after(async () => { await c.close(); server.close(); fs.rmSync(d, { recursive: true, force: true }); });
  return { c, gespielt };
}
const lies = (r) => JSON.parse(r.content[0].text);

test('the tool is listed with an object schema and the tools/list count equals the entries in hand.ts', async (t) => {
  const { c } = await stapel(t);
  const tools = (await c.listTools()).tools;
  const w = tools.find((x) => x.name === 'preset_vorhoeren');
  assert.ok(w); assert.equal(w.inputSchema.type, 'object'); assert.deepEqual(w.inputSchema.required, ['id']);
  assert.match(w.description, /headphone/); assert.match(w.description, /kein_kopfhoerer/); assert.match(w.description, /Andreas/);
  const quelle = fs.readFileSync(HAND, 'utf8');
  assert.equal(tools.length, (quelle.match(/^ {2}\{ name: '/gm) ?? []).length);
});

test('a call with an id plays and returns { ok, aus_cache }; the second call is from the cache', async (t) => {
  const { c, gespielt } = await stapel(t);
  const a = await c.callTool({ name: 'preset_vorhoeren', arguments: { id: 'werk:rb338/x' } });
  assert.deepEqual(lies(a), { ok: true, aus_cache: false }); assert.ok(!a.isError);
  assert.deepEqual(lies(await c.callTool({ name: 'preset_vorhoeren', arguments: { id: 'werk:rb338/x' } })), { ok: true, aus_cache: true });
  assert.equal(gespielt.length, 2);
});

test('a call without id answers argument_fehlt and sends nothing', async (t) => {
  const { c, gespielt } = await stapel(t);
  const r = await c.callTool({ name: 'preset_vorhoeren', arguments: {} });
  assert.equal(r.isError, true); assert.equal(lies(r).fehler, 'argument_fehlt'); assert.equal(gespielt.length, 0);
});

test('a refusal of the route is passed on: hall without a target, and kein_kopfhoerer', async (t) => {
  const hall = await stapel(t, { vorhoerer: { pruefe: () => {}, vorhoer: async () => { throw new PresetVorhoerFehler(422, 'vorhoeren_nicht_moeglich', 'a hall preset has nothing to preview'); } } });
  const r = await hall.c.callTool({ name: 'preset_vorhoeren', arguments: { id: 'werk:hall/saal' } });
  assert.equal(r.isError, true); assert.equal(lies(r).fehler, 'vorhoeren_nicht_moeglich'); assert.ok(lies(r).text);
  const kein = await stapel(t, { spiele: async () => { throw new VorhoerFehler(409, 'kein_kopfhoerer'); } });
  const k = await kein.c.callTool({ name: 'preset_vorhoeren', arguments: { id: 'werk:rb338/x' } });
  assert.equal(k.isError, true); assert.equal(lies(k).fehler, 'kein_kopfhoerer');
});
