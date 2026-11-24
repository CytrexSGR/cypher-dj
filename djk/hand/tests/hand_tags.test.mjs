// Plan 7 task 10: the hand tools `tags` and `verwandt` against a stub page that records every request. The pinned tool count is not touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const HAND = path.resolve(HIER, '..', 'hand.ts');

async function verbinde(t, antwort = () => [200, { ok: true }]) {
  const gesehen = [];
  const s = http.createServer((q, a) => {
    let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => {
      gesehen.push({ methode: q.method, pfad: q.url, koerper: b ? JSON.parse(b) : null });
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
const tags = (c, args) => c.callTool({ name: 'tags', arguments: args });
const antwortJson = (r) => JSON.parse(r.content[0].text);
const ID = `datei:${'a'.repeat(64)}`;

test('tools/list has tags and verwandt, and no duplicate names', async (t) => {
  const { c } = await verbinde(t);
  const namen = (await c.listTools()).tools.map((x) => x.name);
  assert.ok(namen.includes('tags') && namen.includes('verwandt'));
  assert.equal(new Set(namen).size, namen.length);
  const d = (await c.listTools()).tools.find((x) => x.name === 'tags');
  assert.ok(d.description.split(/(?<=\.)\s/).length <= 5 && /<art>:<wort>/.test(d.description) && /500/.test(d.description) && /beats a measured/.test(d.description));
  assert.deepEqual(d.inputSchema.properties.aktion.enum, ['lesen', 'setzen', 'suchen', 'vokabular', 'gespeichert', 'merken', 'vergessen']);
});

test('every aktion sends its method, path, query and body, and returns the page answer unchanged', async (t) => {
  const ANTWORT = { stand: 'x', liste: [1, 2] };
  const { c, gesehen } = await verbinde(t, () => [200, ANTWORT]);
  const faelle = [
    [{ aktion: 'lesen', item: ID }, 'GET', `/tags?item=${encodeURIComponent(ID)}`, null],
    [{ aktion: 'setzen', items: [ID, 'kit:k1'], tags: ['typ:kick', 'frei:my tag'], an: false }, 'POST', '/tags/setzen', { items: [ID, 'kit:k1'], tags: ['typ:kick', 'frei:my tag'], an: false }],
    [{ aktion: 'setzen', items: [ID], tags: ['typ:kick'] }, 'POST', '/tags/setzen', { items: [ID], tags: ['typ:kick'], an: true }],
    [{ aktion: 'suchen', tags: ['typ:kick', 'frei:my tag'], text: 'dark kick', art: 'loop' }, 'GET', `/tags/suche?tags=${encodeURIComponent('typ:kick')},${encodeURIComponent('frei:my tag')}&text=${encodeURIComponent('dark kick')}&art=loop`, null],
    [{ aktion: 'suchen' }, 'GET', '/tags/suche', null],
    [{ aktion: 'vokabular' }, 'GET', '/tags/vokabular', null],
    [{ aktion: 'gespeichert' }, 'GET', '/tags/gespeichert', null],
    [{ aktion: 'merken', name: 'dark kicks', tags: ['typ:kick'], text: 'dark', art: 'loop' }, 'POST', '/tags/gespeichert', { name: 'dark kicks', tags: ['typ:kick'], text: 'dark', art: 'loop' }],
    [{ aktion: 'merken', name: 'only text', text: 'bass' }, 'POST', '/tags/gespeichert', { name: 'only text', tags: [], text: 'bass' }],
    [{ aktion: 'vergessen', name: 'dark kicks' }, 'POST', '/tags/gespeichert/weg', { name: 'dark kicks' }],
  ];
  for (const [args, methode, pfad, koerper] of faelle) {
    gesehen.length = 0;
    const r = await tags(c, args);
    assert.ok(!r.isError, JSON.stringify(args));
    assert.deepEqual(antwortJson(r), ANTWORT);
    assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad, g.koerper]), [[methode, pfad, koerper]], JSON.stringify(args));
  }
  gesehen.length = 0;
  const v = await c.callTool({ name: 'verwandt', arguments: { item: 'loop:l 1' } });
  assert.deepEqual(antwortJson(v), ANTWORT);
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad]), [['GET', '/tags/verwandt?item=loop%3Al%201']]);
});

test('an unknown aktion and missing arguments are refused before any request', async (t) => {
  const { c, gesehen } = await verbinde(t);
  for (const a of [{ aktion: 'loeschen' }, { aktion: 'lesen' }, { aktion: 'setzen', tags: ['typ:kick'] }, { aktion: 'setzen', items: [ID] }, { aktion: 'setzen', items: [], tags: ['typ:kick'] },
    { aktion: 'setzen', items: [ID], tags: ['typ:kick'], an: 'yes' }, { aktion: 'suchen', tags: 'typ:kick' }, { aktion: 'merken' }, { aktion: 'vergessen' }, {}]) {
    const r = await tags(c, a);
    assert.equal(r.isError, true, JSON.stringify(a));
    const j = antwortJson(r);
    assert.deepEqual([j.ok, j.grund], [false, 'argument_ungueltig'], JSON.stringify(a));
    assert.equal(typeof j.text, 'string');
  }
  const v = await c.callTool({ name: 'verwandt', arguments: {} });
  assert.equal(v.isError, true);
  assert.equal(gesehen.length, 0, 'no request was sent');
});

test('a refusal of the page comes back as ok false, grund, text', async (t) => {
  const { c } = await verbinde(t, () => [400, { ok: false, grund: 'tag_ungueltig', fehler: 'tag_ungueltig', text: 'that is not a valid tag', betroffen: 'typ:nope' }]);
  const r = await tags(c, { aktion: 'setzen', items: [ID], tags: ['typ:nope'] });
  assert.equal(r.isError, true);
  assert.deepEqual(antwortJson(r), { ok: false, grund: 'tag_ungueltig', text: 'that is not a valid tag', betroffen: 'typ:nope' });
  const v = await c.callTool({ name: 'verwandt', arguments: { item: 'x' } });
  assert.equal(antwortJson(v).grund, 'tag_ungueltig');
});

test('AUFRUF.md has a row for each of the two tools', () => {
  const t = fs.readFileSync(path.resolve(HIER, '..', 'AUFRUF.md'), 'utf8');
  assert.match(t, /^\| `tags \{aktion/m);
  assert.match(t, /^\| `verwandt \{item\}`/m);
});
