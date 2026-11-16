// Sampler B task 4: the hand tool `sampler {aktion: 'kit'}` (slices to a drum kit). A stub page records every request.
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
const sampler = (c, args) => c.callTool({ name: 'sampler', arguments: args });
const GESCHRIEBEN = { kit: 'brk', klaenge: [{ scheibe: 0, note: 36, name: 'bd:0', datei: '36.f32', frames: 5625 }, { scheibe: 2, note: 37, name: 'sd:0', datei: '37.f32', frames: 5625 }] };

test('schema: aktion has kit, nummern is an integer array, namen a string array, kit a string', async (t) => {
  const { c } = await verbinde(t);
  const x = (await c.listTools()).tools.find((y) => y.name === 'sampler');
  const p = x.inputSchema.properties;
  assert.deepEqual(p.aktion.enum, ['quellen', 'liste', 'neu', 'lies', 'spur', 'kit', 'ton', 'schneiden', 'marke', 'ursprung', 'loeschen']);
  assert.equal(p.nummern.type, 'array');
  assert.equal(p.nummern.items.type, 'integer');
  assert.equal(p.nummern.items.minimum, 1);
  assert.equal(p.namen.type, 'array');
  assert.equal(p.namen.items.type, 'string');
  assert.equal(p.kit.type, 'string');
  assert.deepEqual(x.inputSchema.required, ['aktion']);
  const tools = (await c.listTools()).tools;
  assert.equal(tools.length, 92, 'the tool count stays 92');
});

test('description: proposed banks, per-bank numbers, 10 s, kit_vorhanden, the way to a track and to a Strudel text, the live stream', async (t) => {
  const { c } = await verbinde(t);
  const d = (await c.listTools()).tools.find((y) => y.name === 'sampler').description;
  assert.match(d, /low\/mid\/high/);
  assert.match(d, /bd, sd, bd become bd:0, sd:0, bd:1/);
  assert.match(d, /at most 10 s/);
  assert.match(d, /kit_vorhanden/);
  assert.match(d, /proj_aendern werkbank_spur_neu \{name, geraet: \{art: 'intern', name: 'kit', kit\}\}/);
  assert.match(d, /proj_muster/);
  assert.match(d, /s\("bd sd"\)/);
  assert.match(d, /live DRUMS stream does not see a new kit/);
  assert.match(d, /note 36/);
});

test('kit {id, nummern: [1, 3], namen} sends the 0-based slices and the banks, and only what is given', async (t) => {
  const { c, gesehen } = await verbinde(t, () => [200, GESCHRIEBEN]);
  await sampler(c, { aktion: 'kit', id: 'amen-1a2b', nummern: [1, 3], namen: ['bd', 'sd'] });
  await sampler(c, { aktion: 'kit', id: 'amen-1a2b', nummern: [2] });
  await sampler(c, { aktion: 'kit', id: 'amen-1a2b', nummern: [2, 4], kit: 'brk' });
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad, g.koerper, g.quelle]), [
    ['POST', '/sampler/kit', { id: 'amen-1a2b', scheiben: [0, 2], banken: ['bd', 'sd'] }, 'cypher'],
    ['POST', '/sampler/kit', { id: 'amen-1a2b', scheiben: [1] }, 'cypher'],
    ['POST', '/sampler/kit', { id: 'amen-1a2b', scheiben: [1, 3], kit: 'brk' }, 'cypher'],
  ]);
});

test('the tool text names the kit and each sound, and keeps the JSON', async (t) => {
  const { c } = await verbinde(t, () => [200, GESCHRIEBEN]);
  const r = await sampler(c, { aktion: 'kit', id: 'amen-1a2b', nummern: [1, 3], namen: ['bd', 'sd'] });
  assert.ok(!r.isError);
  const [kopf, rest] = r.content[0].text.split('\n');
  assert.equal(kopf, 'kit brk: bd:0 = slice 1 (note 36), sd:0 = slice 3 (note 37)');
  assert.deepEqual(JSON.parse(rest), GESCHRIEBEN);
});

test('a 409 kit_vorhanden is isError with the server text; a 400 klang_zu_lang too', async (t) => {
  const { c } = await verbinde(t, () => [409, { fehler: 'kit_vorhanden', text: 'a kit named brk exists already; choose another name' }]);
  const r = await sampler(c, { aktion: 'kit', id: 'amen-1a2b', nummern: [1], kit: 'brk' });
  assert.equal(r.isError, true);
  const j = JSON.parse(r.content[0].text);
  assert.equal(j.fehler, 'kit_vorhanden');
  assert.equal(j.text, 'a kit named brk exists already; choose another name');
  const l = await verbinde(t, () => [400, { fehler: 'klang_zu_lang', text: 'slice 2 is 12.0 s long' }]);
  const r2 = await sampler(l.c, { aktion: 'kit', id: 'x', nummern: [2] });
  assert.equal(r2.isError, true);
  assert.equal(JSON.parse(r2.content[0].text).fehler, 'klang_zu_lang');
});

test('kit without id, with nummern empty, holding 0 or a non-integer, or namen of another length is refused locally before any request', async (t) => {
  const { c, gesehen } = await verbinde(t);
  const faelle = [
    [{ aktion: 'kit', nummern: [1] }],
    [{ aktion: 'kit', id: '', nummern: [1] }],
    [{ aktion: 'kit', id: 7, nummern: [1] }],
    [{ aktion: 'kit', id: 'x' }],
    [{ aktion: 'kit', id: 'x', nummern: [] }],
    [{ aktion: 'kit', id: 'x', nummern: [0, 1] }],
    [{ aktion: 'kit', id: 'x', nummern: [-1] }],
    [{ aktion: 'kit', id: 'x', nummern: [1.5] }],
    [{ aktion: 'kit', id: 'x', nummern: ['1'] }],
    [{ aktion: 'kit', id: 'x', nummern: 3 }],
    [{ aktion: 'kit', id: 'x', nummern: [1, 2], namen: ['bd'] }],
    [{ aktion: 'kit', id: 'x', nummern: [1], namen: ['bd', 'sd'] }],
    [{ aktion: 'kit', id: 'x', nummern: [1], namen: [5] }],
    [{ aktion: 'kit', id: 'x', nummern: [1], namen: 'bd' }],
    [{ aktion: 'kit', id: 'x', nummern: [1], kit: 5 }],
  ];
  for (const [args] of faelle) {
    const r = await sampler(c, args);
    assert.equal(r.isError, true, JSON.stringify(args));
    assert.equal(JSON.parse(r.content[0].text).fehler, 'argument_ungueltig', JSON.stringify(args));
  }
  assert.equal(gesehen.length, 0, 'no request was sent');
});
