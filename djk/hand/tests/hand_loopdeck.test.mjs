// djk-hand loopdeck (loop deck H1): every aktion hits its route with the right body and the cypher header, against a fake page server.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');

async function aufbau(t, antworten) {
  const gesehen = [];
  const s = http.createServer((q, a) => {
    let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => {
      gesehen.push({ methode: q.method, pfad: q.url, quelle: q.headers['x-djk-quelle'], koerper: b ? JSON.parse(b) : null });
      const [code, j] = antworten(q.method, q.url) ?? [200, { ok: true }];
      a.writeHead(code, { 'content-type': 'application/json' }); a.end(JSON.stringify(j));
    });
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  return { c, gesehen };
}

const FAELLE = [
  [{ aktion: 'stand' }, 'GET', '/loopdeck/stand', null],
  [{ aktion: 'laden', deck: 1, spur: 2, zelle: 3, quelle: { loop: 'kick-4' } }, 'POST', '/loopdeck/laden', { deck: 1, spur: 2, zelle: 3, quelle: { loop: 'kick-4' } }],
  [{ aktion: 'start', deck: 1, spur: 2, zelle: 3, versatz_beats: 1, raster: '1/2' }, 'POST', '/loopdeck/start', { deck: 1, spur: 2, zelle: 3, versatz_beats: 1, raster: '1/2' }],
  [{ aktion: 'stopp', deck: 2 }, 'POST', '/loopdeck/stopp', { deck: 2 }],
  [{ aktion: 'szene', deck: 1, zeile: 5 }, 'POST', '/loopdeck/szene', { deck: 1, zeile: 5 }],
  [{ aktion: 'sprung', deck: 1, spur: 4, slice: 8 }, 'POST', '/loopdeck/sprung', { deck: 1, spur: 4, slice: 8 }],
  [{ aktion: 'raster', deck: 2, raster: '4takte' }, 'POST', '/loopdeck/raster', { deck: 2, raster: '4takte' }],
  [{ aktion: 'zelle', deck: 1, spur: 1, zelle: 2, name: 'hat', farbe: 7, art: 'einmal', gain_db: -3, beats: 2 }, 'POST', '/loopdeck/zelle', { deck: 1, spur: 1, zelle: 2, name: 'hat', farbe: 7, art: 'einmal', gain_db: -3, beats: 2 }],
  [{ aktion: 'zelle', deck: 1, spur: 1, zelle: 2, leeren: true }, 'POST', '/loopdeck/zelle', { deck: 1, spur: 1, zelle: 2, leeren: true }],
  [{ aktion: 'set_speichern', deck: 1, name: 'peak' }, 'POST', '/loopset/speichern', { deck: 1, name: 'peak' }],
  [{ aktion: 'set_laden', deck: 2, name: 'peak' }, 'POST', '/loopset/laden', { deck: 2, name: 'peak' }],
  [{ aktion: 'sets' }, 'GET', '/loopsets', null],
  [{ aktion: 'spur', deck: 1, spur: 2, eq: { tief: -200 } }, 'POST', '/loopdeck/spur', { deck: 1, spur: 2, eq: { tief: -200 } }],
  [{ aktion: 'spur', deck: 1, spur: 2, fader_db: -6, mute: true, filter: 0.5, eq: { tief: 0, mitte: -3, hoch: 6 }, kill: { tief: true, hoch: false }, send: { hall: -12, delay: -200 }, unbekannt: 1 }, 'POST', '/loopdeck/spur', { deck: 1, spur: 2, fader_db: -6, mute: true, filter: 0.5, eq: { tief: 0, mitte: -3, hoch: 6 }, kill: { tief: true, hoch: false }, send: { hall: -12, delay: -200 } }],
  [{ aktion: 'effekt', deck: 1, spur: 1, graph: 'fx-remix' }, 'POST', '/loopdeck/effekt', { deck: 1, spur: 1, graph: 'fx-remix' }],
  [{ aktion: 'effekt', deck: 2, spur: 3, an: false }, 'POST', '/loopdeck/effekt', { deck: 2, spur: 3, an: false }],
  [{ aktion: 'effekt', deck: 1, spur: 1, graph: '' }, 'POST', '/loopdeck/effekt', { deck: 1, spur: 1, graph: '' }],
  [{ aktion: 'effekte' }, 'GET', '/loopdeck/effekte', null],
];

test('loopdeck: every aktion hits its route with the right body and the cypher header', async (t) => {
  const { c, gesehen } = await aufbau(t, () => null);
  const w = (await c.listTools()).tools.find((x) => x.name === 'loopdeck');
  assert.deepEqual(w.inputSchema.properties.aktion.enum, [...new Set(FAELLE.map((f) => f[0].aktion))]);
  const e = w.inputSchema.properties;
  assert.deepEqual(e.raster.enum, ['1/4', '1/2', '1', 'takt', '4takte']);
  assert.deepEqual([e.farbe.type, e.farbe.minimum, e.farbe.maximum], ['integer', 0, 15]);
  assert.deepEqual(e.art.enum, ['loop', 'einmal']);
  const sp = e.spur; assert.ok(sp);
  assert.deepEqual([e.fader_db.type, e.fader_db.minimum, e.fader_db.maximum], ['number', -200, 6]);
  assert.deepEqual([e.filter.type, e.filter.minimum, e.filter.maximum], ['number', -1, 1]);
  assert.equal(e.mute.type, 'boolean');
  assert.deepEqual(Object.keys(e.eq.properties), ['tief', 'mitte', 'hoch']);
  assert.deepEqual(Object.keys(e.kill.properties), ['tief', 'mitte', 'hoch']);
  assert.deepEqual(Object.keys(e.send.properties), ['hall', 'delay']);
  assert.deepEqual([e.graph.type, e.an.type], ['string', 'boolean']);
  for (const grund of ['kein_platz', 'graph_unbekannt', 'tief', 'mitte', 'hoch', 'container', 'strip']) assert.ok(w.description.includes(grund), `description names ${grund}`);
  for (const grund of ['ki_gestoppt', 'zelle_leer', 'deck_voll', 'audio_budget', 'zu_lang', 'quelle_unbekannt', 'kein_loopdeck', 'nichts_gespielt', 'set_unbekannt', 'projekt_offen', 'modul_nicht_umwandelbar', 'set_defekt', 'audio_fehlt', 'keine_uhr', 'zelle_laedt']) {
    assert.ok(w.description.includes(grund), `description names ${grund}`);
  }
  for (const [args, methode, pfad, koerper] of FAELLE) {
    const r = await c.callTool({ name: 'loopdeck', arguments: args });
    assert.ok(!r.isError, args.aktion);
    assert.deepEqual(gesehen.at(-1), { methode, pfad, quelle: 'cypher', koerper }, args.aktion);
  }
});

test('loopdeck: an unknown aktion is refused before any request', async (t) => {
  const { c, gesehen } = await aufbau(t, () => null);
  const r = await c.callTool({ name: 'loopdeck', arguments: { aktion: 'wegwerfen', deck: 1 } });
  assert.equal(r.isError, true);
  assert.equal(gesehen.length, 0);
});

test('loopdeck: a 409 reason comes back as the tool error text', async (t) => {
  const { c } = await aufbau(t, () => [409, { ok: false, grund: 'zelle_leer', text: 'cell is empty' }]);
  const r = await c.callTool({ name: 'loopdeck', arguments: { aktion: 'start', deck: 1, spur: 1, zelle: 1 } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /zelle_leer/);
});

test('loop_nach_box posts /loopdeck/laden with a deck source; box laden loads a library loop into a cell of that loop deck', async (t) => {
  const { c, gesehen } = await aufbau(t, () => null);
  assert.ok(!(await c.callTool({ name: 'loop_nach_box', arguments: { deck: 3, box: 2 } })).isError);
  assert.deepEqual([gesehen.at(-1).pfad, gesehen.at(-1).koerper], ['/loopdeck/laden', { deck: 2, quelle: { von_deck: 3 } }]);
  assert.ok(!(await c.callTool({ name: 'box', arguments: { box: 1, aktion: 'laden', name: 'kick-4', spur: 2, zelle: 5 } })).isError);
  assert.deepEqual([gesehen.at(-1).pfad, gesehen.at(-1).koerper], ['/loopdeck/laden', { deck: 1, spur: 2, zelle: 5, quelle: { loop: 'kick-4' } }]);
  await c.callTool({ name: 'box', arguments: { box: 2, aktion: 'laden', name: 'x' } });
  assert.deepEqual(gesehen.at(-1).koerper, { deck: 2, quelle: { loop: 'x' } });
});

test('loopdeck: zelle_laedt is a tool error; szene and stopp answers with abgelehnt pass through unchanged', async (t) => {
  const szene = { ok: true, ab_beat: 8, gestartet: [1], gestoppt: [], abgelehnt: [{ spur: 2, grund: 'zelle_laedt' }] };
  const { c } = await aufbau(t, (m, u) => (u === '/loopdeck/szene' || u === '/loopdeck/stopp' ? [200, szene] : [409, { ok: false, grund: 'zelle_laedt', text: 'That cell is still loading.' }]));
  const r = await c.callTool({ name: 'loopdeck', arguments: { aktion: 'start', deck: 1, spur: 1, zelle: 1 } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /zelle_laedt/);
  for (const args of [{ aktion: 'szene', deck: 1, zeile: 1 }, { aktion: 'stopp', deck: 1 }]) {
    const o = await c.callTool({ name: 'loopdeck', arguments: args });
    assert.ok(!o.isError);
    assert.deepEqual(JSON.parse(o.content[0].text), szene);
  }
});
