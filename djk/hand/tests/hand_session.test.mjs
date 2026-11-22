// djk-hand session (session view M7): every aktion hits its route with its fields only and the cypher header, against a fake page server.
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
  [{ aktion: 'stand' }, 'GET', '/session/stand', null],
  [{ aktion: 'start', spur_id: 's5', zelle: 3, raster: '1/2' }, 'POST', '/session/start', { spur_id: 's5', zelle: 3, raster: '1/2' }],
  [{ aktion: 'start', spur_id: 's5', zelle: 3, deck: 1, unbekannt: 1 }, 'POST', '/session/start', { spur_id: 's5', zelle: 3 }],
  [{ aktion: 'stopp' }, 'POST', '/session/stopp', {}],
  [{ aktion: 'stopp', spur_id: 's5' }, 'POST', '/session/stopp', { spur_id: 's5' }],
  [{ aktion: 'szene', zeile: 4 }, 'POST', '/session/szene', { zeile: 4 }],
  [{ aktion: 'raster', raster: '4takte' }, 'POST', '/session/raster', { raster: '4takte' }],
  [{ aktion: 'szene_neu' }, 'POST', '/session/szene_neu', {}],
  [{ aktion: 'szene_neu', nach: 0 }, 'POST', '/session/szene_neu', { nach: 0 }],
  [{ aktion: 'szene_fangen', nach: 2 }, 'POST', '/session/szene_fangen', { nach: 2 }],
  [{ aktion: 'szene_aendern', zeile: 2, name: 'Drop', farbe: 5, bpm: 130, takte: 8 }, 'POST', '/session/szene_aendern', { zeile: 2, name: 'Drop', farbe: 5, bpm: 130, takte: 8 }],
  [{ aktion: 'szene_aendern', zeile: 2, bpm: null, takte: null }, 'POST', '/session/szene_aendern', { zeile: 2, bpm: null, takte: null }],
  [{ aktion: 'szene_doppeln', zeile: 3 }, 'POST', '/session/szene_doppeln', { zeile: 3 }],
  [{ aktion: 'szene_loeschen', zeile: 1 }, 'POST', '/session/szene_loeschen', { zeile: 1 }],
  [{ aktion: 'zelle', spur_id: 's5', zelle: 2, transponieren: 3, rueckwaerts: true, blende: true, keylock: true, scheiben: { teilung: '1/8' }, deck: 1 }, 'POST', '/session/zelle', { spur_id: 's5', zelle: 2, transponieren: 3, rueckwaerts: true, blende: true, keylock: true, scheiben: { teilung: '1/8' } }],
  [{ aktion: 'zelle', spur_id: 's5', zelle: 2, transponieren: null, scheiben: null }, 'POST', '/session/zelle', { spur_id: 's5', zelle: 2, transponieren: null, scheiben: null }],
  [{ aktion: 'huelle', spur_id: 's5', zelle: 2, ziel: 'gain', punkte: [{ beat: 0, wert: 1 }], zeile: 3 }, 'POST', '/session/huelle', { spur_id: 's5', zelle: 2, ziel: 'gain', punkte: [{ beat: 0, wert: 1 }] }],
  [{ aktion: 'scheiben', spur_id: 's5', zelle: 2, teilung: 'transienten' }, 'POST', '/session/scheiben', { spur_id: 's5', zelle: 2, teilung: 'transienten' }],
  [{ aktion: 'neue_zelle', spur_id: 's5', zelle: 2 }, 'POST', '/session/neue_zelle', { spur_id: 's5', zelle: 2 }],
  [{ aktion: 'zum_sampler', spur_id: 's5', zelle: 2 }, 'POST', '/session/zum_sampler', { spur_id: 's5', zelle: 2 }],
  [{ aktion: 'vorhoeren', spur_id: 's5', zelle: 2, slot: 4 }, 'POST', '/session/vorhoeren', { spur_id: 's5', zelle: 2, slot: 4 }],
];

test('session: every aktion hits its route with its fields only and the cypher header', async (t) => {
  const { c, gesehen } = await aufbau(t, () => null);
  const w = (await c.listTools()).tools.find((x) => x.name === 'session');
  assert.ok(w, 'the tool exists');
  assert.deepEqual(w.inputSchema.properties.aktion.enum, [...new Set(FAELLE.map((f) => f[0].aktion))]);
  assert.deepEqual(w.inputSchema.properties.raster.enum, ['1/4', '1/2', '1', 'takt', '4takte']);
  for (const wort of ['kein_projekt', 'zelle_leer', 'spur_unbekannt', 'keine_uhr', 'zelle_laedt', 'zeilen_voll', 'ki_gestoppt', 'beschaeftigt', 'argument_ungueltig',
    'loopdeck szene', 'session szene', 'launches one deck', 'across all columns', 'neue_zelle', 'zum_sampler', 'nur_keylock', 'zellen_ungueltig', 'einmal_zu_lang']) assert.ok(w.description.includes(wort), `description names ${wort}`);
  // the model stores `blende: true` only and `transponieren` as an integer of at most 24 semitones: the schema says so
  assert.deepEqual(w.inputSchema.properties.blende.enum, [true, null]);
  assert.deepEqual([w.inputSchema.properties.transponieren.type, w.inputSchema.properties.transponieren.minimum, w.inputSchema.properties.transponieren.maximum], [['integer', 'null'], -24, 24]);
  for (const [args, methode, pfad, koerper] of FAELLE) {
    const r = await c.callTool({ name: 'session', arguments: args });
    assert.ok(!r.isError, args.aktion);
    assert.deepEqual(gesehen.at(-1), { methode, pfad, quelle: 'cypher', koerper }, JSON.stringify(args));
  }
});

test('session: an unknown aktion is refused before any request', async (t) => {
  const { c, gesehen } = await aufbau(t, () => null);
  const r = await c.callTool({ name: 'session', arguments: { aktion: 'wegwerfen', zeile: 1 } });
  assert.equal(r.isError, true);
  assert.equal(gesehen.length, 0);
});

test('session: ki_gestoppt comes back as the tool error text', async (t) => {
  const { c } = await aufbau(t, () => [409, { ok: false, grund: 'ki_gestoppt', text: 'Stop Cypher is on.' }]);
  const r = await c.callTool({ name: 'session', arguments: { aktion: 'szene', zeile: 1 } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /ki_gestoppt/);
});
