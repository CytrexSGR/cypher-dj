// Container core U7: djk-hand follows the container model. The stream list comes from contract/streams.ts, the tool descriptions name containers
// and aliases and no longer pad slots, loop boxes, ausgang_platz or decks 3/4 as strips. A recording stand-in server stands in for the page.
import fs from 'node:fs';
import { ALLE_STROEME } from '../../contract/streams.ts';
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
      gesehen.push({ methode: q.method, pfad: q.url, koerper: b ? JSON.parse(b) : null });
      const [code, j] = antworten(q.method, q.url, gesehen[gesehen.length - 1].koerper) ?? [404, { fehler: 'unbekannt' }];
      a.writeHead(code, { 'content-type': 'application/json' }); a.end(JSON.stringify(j));
    });
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  return { c, gesehen };
}
const beschreibungen = async (c) => (await c.listTools()).tools.map((x) => [x.name, x.description ?? '']);

test('the strudel strom enum is the stream table of streams.ts', async (t) => {
  const { c } = await aufbau(t, () => null);
  const schema = (await c.listTools()).tools.find((x) => x.name === 'strudel').inputSchema;
  assert.deepEqual(schema.properties.strom.enum, [...ALLE_STROEME]);
});

test('no description names a pad as an instrument slot, streams 9 and 10 as pads, ausgang_platz, loop boxes or decks 3 and 4 as strips', async (t) => {
  const { c } = await aufbau(t, () => null);
  // L1/L2 as old loop box names are banned; the session column labels L1.1 .. L2.4 are the names the page shows.
  const VERBOTEN = [/ausgang_platz/, /loop boxes?/i, /\bL[12]\b(?!\.\d)/, /pad boxes?/i, /9, 10 \(pad/, /pad\/1 carries/, /pad\/2 slot B/,
    /deck\/1\.\.4|deck\/3|deck\/4/, /instrument slots?: [^.]*pad\/1/, /the loop of box N/, /loop slots/];
  const treffer = [];
  for (const [name, d] of await beschreibungen(c)) for (const re of VERBOTEN) { const m = re.exec(d); if (m) treffer.push(`${name}: ${m[0]}`); }
  assert.deepEqual(treffer, []);
  const graph = (await c.listTools()).tools.find((x) => x.name === 'graph').inputSchema.properties.kanal.enum;
  assert.ok(!graph.includes('deck/3') && !graph.includes('deck/4'), 'graph enum has no deck/3 or deck/4');
  for (const k of ['deck/1', 'deck/2', 'pad/1', 'pad/2', 'fx/3', 'fx/4', 'master']) assert.ok(graph.includes(k), k);
});

test('the descriptions of lage, regler and strudel say what the container model says', async (t) => {
  const { c } = await aufbau(t, () => null);
  const d = Object.fromEntries(await beschreibungen(c));
  assert.match(d.lage, /plaetze/); assert.match(d.lage, /container/);
  assert.match(d.regler, /pad\/1 and pad\/2 are the strips of places C and D/);
  assert.match(d.regler, /erz\/<n>\/\(fader\|pfl\|eq\/\*\|kill\/\*\|filter\|bk\/k\)/);
  assert.match(d.regler, /kein_strudel_modul/);
  assert.match(d.strudel, /kein_strudel_modul/);
  assert.match(d.strudel, /ordinary streams?/);
});

test('strudel passes strom 10 on unchanged, a 409 kein_strudel_modul comes back as a tool error with the reason', async (t) => {
  let antwort = [200, { ok: true }];
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/strudel' ? antwort : null));
  const ok = await c.callTool({ name: 'strudel', arguments: { code: 's("bd")', strom: 10 } });
  assert.ok(!ok.isError, ok.content[0].text);
  assert.deepEqual(gesehen.find((x) => x.pfad === '/strudel').koerper, { text: 's("bd")', strom: 10 });
  antwort = [409, { fehler: 'kein_strudel_modul', text: 'no place holds a strudel module' }];
  const r = await c.callTool({ name: 'strudel', arguments: { code: 's("bd")' } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /kein_strudel_modul/);
});

test('regler posts an alias path unchanged: the page server resolves it, the hand does not', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/regler' ? [200, { ok: true, felder: { id: 1 }, quittung: { status: 2, grund: '' } }] : null));
  const r = await c.callTool({ name: 'regler', arguments: { pfad: 'erz/2/fader', nach: 0.5 } });
  assert.ok(!r.isError, r.content[0].text);
  assert.equal(gesehen.find((x) => x.pfad === '/regler').koerper.pfad, 'erz/2/fader');
});

test('hand.ts keeps no numeric stream list of its own', () => {
  const q = fs.readFileSync(HAND, 'utf8');
  assert.doesNotMatch(q, /\[\s*1,\s*2,\s*3,\s*5,\s*6,\s*7,\s*9,\s*10\s*\]/);
  assert.doesNotMatch(q, /STUDIO_STROEME/);
  assert.match(q, /ALLE_STROEME/);
});
