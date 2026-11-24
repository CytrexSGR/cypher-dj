// Browser plan 1, task 9: the hand tools `import_datei` and `bibliothek_bauen`. A stub page records every request.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');

async function verbinde(t, antwort = () => [200, { ok: true }]) {
  const gesehen = [];
  const s = http.createServer((q, a) => {
    let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => {
      gesehen.push({ methode: q.method, pfad: q.url, koerper: b ? JSON.parse(b) : null, quelle: q.headers['x-djk-quelle'] });
      const [code, j] = antwort(q.method, q.url);
      a.writeHead(code, { 'content-type': 'application/json' }); a.end(JSON.stringify(j));
    });
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  return { c, gesehen };
}
const werkzeug = async (c, name) => (await c.listTools()).tools.find((y) => y.name === name);

test('both tools are listed', async (t) => {
  const { c } = await verbinde(t);
  assert.ok(await werkzeug(c, 'import_datei'));
  assert.ok(await werkzeug(c, 'bibliothek_bauen'));
});

test('schema: import_datei needs pfad, ziel is an enum', async (t) => {
  const { c } = await verbinde(t);
  const x = await werkzeug(c, 'import_datei');
  assert.deepEqual(x.inputSchema.required, ['pfad']);
  assert.deepEqual(x.inputSchema.properties.ziel.enum, ['auto', 'bibliothek', 'projekt']);
});

test('import_datei posts /import/pfad with ziel auto by default, source cypher', async (t) => {
  const { c, gesehen } = await verbinde(t);
  const r = await c.callTool({ name: 'import_datei', arguments: { pfad: '/home/x/a.wav' } });
  assert.ok(!r.isError);
  assert.deepEqual(gesehen, [{ methode: 'POST', pfad: '/import/pfad', koerper: { pfad: '/home/x/a.wav', ziel: 'auto' }, quelle: 'cypher' }]);
});

test('a 403 pfad_ausserhalb returns the reason text, not a thrown error', async (t) => {
  const { c } = await verbinde(t, () => [403, { ok: false, grund: 'pfad_ausserhalb', text: 'outside the allowed folders' }]);
  const r = await c.callTool({ name: 'import_datei', arguments: { pfad: '/etc/passwd', ziel: 'bibliothek' } });
  assert.equal(r.isError, true);
  const j = JSON.parse(r.content[0].text);
  assert.equal(j.fehler, 'pfad_ausserhalb');
  assert.equal(j.text, 'outside the allowed folders');
});

test('bibliothek_bauen posts /bibliothek/bauen by default', async (t) => {
  const { c, gesehen } = await verbinde(t);
  await c.callTool({ name: 'bibliothek_bauen', arguments: {} });
  assert.equal(gesehen.length, 1);
  assert.equal(gesehen[0].methode, 'POST');
  assert.equal(gesehen[0].pfad, '/bibliothek/bauen');
  assert.equal(gesehen[0].quelle, 'cypher');
});

test('aktion stand and quellen are GET reads', async (t) => {
  const { c, gesehen } = await verbinde(t);
  await c.callTool({ name: 'bibliothek_bauen', arguments: { aktion: 'stand' } });
  await c.callTool({ name: 'bibliothek_bauen', arguments: { aktion: 'quellen' } });
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad]), [['GET', '/bibliothek/stand'], ['GET', '/bibliothek/quellen']]);
});

test('aktion dazu posts pfad and typ; without pfad it is refused before any request', async (t) => {
  const { c, gesehen } = await verbinde(t);
  const nein = await c.callTool({ name: 'bibliothek_bauen', arguments: { aktion: 'dazu' } });
  assert.equal(nein.isError, true);
  assert.match(nein.content[0].text, /pfad/);
  assert.equal(gesehen.length, 0);
  await c.callTool({ name: 'bibliothek_bauen', arguments: { aktion: 'dazu', pfad: '/home/x/loops', typ: 'loop' } });
  assert.equal(gesehen[0].pfad, '/bibliothek/quellen/dazu');
  assert.deepEqual(gesehen[0].koerper, { pfad: '/home/x/loops', typ: 'loop' });
});
