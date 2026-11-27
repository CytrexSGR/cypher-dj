// The proj_export tool text names every refusal the real-time export can answer, the tempo step included (a deck plays at another tempo than
// the project: the master cannot go to the project tempo).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');

test('proj_export description lists the tempo refusals of the real-time export', async (t) => {
  const s = http.createServer((q, a) => { a.writeHead(404); a.end('{}'); });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  const d = (await c.listTools()).tools.find((x) => x.name === 'proj_export').description;
  const echtzeit = d.slice(d.indexOf('Foreign plugins'));
  for (const grund of ['deck_laeuft', 'tempo_abgelehnt', 'kein_kern', 'rampe_haengt']) assert.ok(echtzeit.includes(grund), `${grund} missing from the real-time refusals`);
});

test('proj_export takes abgabe (array, at most 4 entries) and its text names the delivery files and the answer field', async (t) => {
  const s = http.createServer((q, a) => { a.writeHead(404); a.end('{}'); });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  const w = (await c.listTools()).tools.find((x) => x.name === 'proj_export');
  const a = w.inputSchema.properties.abgabe;
  assert.equal(a.type, 'array');
  assert.equal(a.maxItems, 4);
  assert.equal(a.minItems, 1);
  assert.deepEqual(a.items.properties.format.enum, ['wav', 'flac', 'mp3']);
  assert.deepEqual(a.items.properties.bits.enum, [16, 24, 32]);
  assert.deepEqual(a.items.properties.rate_hz.enum, [44100, 48000, 88200, 96000]);
  assert.deepEqual(a.items.properties.dither.enum, ['tpdf', 'aus']);
  assert.deepEqual(a.items.properties.kbps.enum, [192, 256, 320]);
  for (const g of ['abgaben', '16bit-44k']) assert.ok(w.description.includes(g), `${g} missing from the proj_export text`);
  assert.ok(w.description.includes('Foreign plugins'), 'the real-time sentence stays');
});

test('proj_export passes abgabe through to POST /proj/export unchanged', async (t) => {
  const gesehen = [];
  const s = http.createServer((q, a) => {
    let b = ''; q.on('data', (x) => { b += x; });
    q.on('end', () => { gesehen.push([q.url, b === '' ? null : JSON.parse(b)]); a.writeHead(200, { 'content-type': 'application/json' }); a.end(JSON.stringify({ datei: '/x.wav', abgaben: [] })); });
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  const abgabe = [{ format: 'wav', bits: 16, rate_hz: 44100, dither: 'tpdf' }, { format: 'mp3', kbps: 256 }];
  const r = await c.callTool({ name: 'proj_export', arguments: { abgabe } });
  assert.ok(!r.isError, r.content[0].text);
  assert.deepEqual(gesehen.filter(([u]) => u === '/proj/export').map(([, k]) => k), [{ abgabe }]);
});

test('proj_export takes ziel (two numbers), names the check in its text and passes it through', async (t) => {
  const gesehen = [];
  const s = http.createServer((q, a) => {
    let b = ''; q.on('data', (x) => { b += x; });
    q.on('end', () => { gesehen.push([q.url, b === '' ? null : JSON.parse(b)]); a.writeHead(200, { 'content-type': 'application/json' }); a.end(JSON.stringify({ datei: '/x.wav' })); });
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  const w = (await c.listTools()).tools.find((x) => x.name === 'proj_export');
  const z = w.inputSchema.properties.ziel;
  assert.equal(z.type, 'object');
  assert.deepEqual(Object.keys(z.properties).sort(), ['lufs_i', 'true_peak_dbtp']);
  assert.equal(z.properties.lufs_i.minimum, -40);
  assert.equal(z.properties.lufs_i.maximum, 0);
  assert.equal(z.properties.true_peak_dbtp.minimum, -20);
  assert.equal(z.properties.true_peak_dbtp.maximum, 0);
  for (const g of ['ziel_ok', 'ziel_pruefung', 'tp_ueber', 'never normalised']) assert.ok(w.description.includes(g), `${g} missing from the proj_export text`);
  const ziel = { lufs_i: -14, true_peak_dbtp: -1 };
  const r = await c.callTool({ name: 'proj_export', arguments: { ziel } });
  assert.ok(!r.isError, r.content[0].text);
  assert.deepEqual(gesehen.filter(([u]) => u === '/proj/export').map(([, k]) => k), [{ ziel }]);
});
