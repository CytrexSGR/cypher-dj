// Kraken patch field task 5: the hand tool `steckfeld` (show, set, clear, empty, copy). A stub page records every request; it stands in for
// GET /proj/steckfeld and POST /proj/aendern of the page server (task 4 shapes: answer { spur_id, graph, zeilen, spalten, stifte, eigene, rev }).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');

const ZEILEN = ['VCO 1', 'VCO 2', 'Noise', 'Filter', 'Gate', 'Env', 'LFO', 'Key', 'Velocity', 'Out L', 'Out R', 'Fold', 'Wave', 'Delay', 'Mix', 'Aux'];
const SPALTEN = ['Pitch 1', 'Pitch 2', 'Cutoff', 'Reso', 'Gate In', 'Filter In', 'Drive', 'Pan', 'Level', 'Fold', 'Wave', 'Delay', 'Rate', 'Depth', 'Mix', 'Aux'];
const FELD = (extra = {}) => ({ spur_id: 's1', graph: 'kraken', zeilen: ZEILEN, spalten: SPALTEN, stifte: [[0, 0, 2, 0.4], [0, 3, 3, -0.25], [1, 1, 0, 1]], eigene: true, rev: 7, ...extra });

async function verbinde(t, feld = FELD(), aendern = () => [200, { rev: 8 }]) {
  const gesehen = [];
  const s = http.createServer((q, a) => {
    let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => {
      gesehen.push({ methode: q.method, pfad: q.url, koerper: b ? JSON.parse(b) : null, quelle: q.headers['x-djk-quelle'] });
      let code = 200, j = { ok: true };
      if (q.method === 'GET' && q.url.startsWith('/proj/steckfeld')) [code, j] = feld === null ? [409, { fehler: 'kein_steckfeld', text: 'no matrix' }] : [200, feld];
      else if (q.method === 'GET' && q.url.startsWith('/proj/aktuell')) j = { rev: 7 };
      else if (q.method === 'POST' && q.url.startsWith('/proj/aendern')) [code, j] = aendern();
      a.writeHead(code, { 'content-type': 'application/json' }); a.end(JSON.stringify(j));
    });
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  return { c, gesehen };
}
const steck = (c, args) => c.callTool({ name: 'steckfeld', arguments: args });
const text = (r) => r.content[0].text;
const posts = (gesehen) => gesehen.filter((g) => g.methode === 'POST');

test('steckfeld schema: aktion enum, spur_id required, zeile/spalte label or index, wert -1..1, satz A/B; description names field, sets, morph and zeige', async (t) => {
  const { c } = await verbinde(t);
  const w = (await c.listTools()).tools.find((x) => x.name === 'steckfeld');
  assert.ok(w, 'tool steckfeld is listed');
  const p = w.inputSchema.properties;
  assert.deepEqual(p.aktion.enum, ['zeige', 'setze', 'loesche', 'leere', 'kopiere']);
  assert.deepEqual(w.inputSchema.required, ['aktion', 'spur_id']);
  assert.equal(p.spur_id.type, 'string');
  assert.deepEqual(p.satz.enum, ['A', 'B']);
  assert.equal(p.wert.minimum, -1);
  assert.equal(p.wert.maximum, 1);
  assert.deepEqual(p.zeile.anyOf.map((x) => x.type), ['string', 'integer']);
  assert.deepEqual(p.spalte.anyOf.map((x) => x.type), ['string', 'integer']);
  for (const wort of ['16 x 16', 'two sets', 'morph', 'zeige']) assert.ok(w.description.includes(wort), `description names ${wort}`);
});

test('zeige: GET /proj/steckfeld, both sets as lines with labels, labels listed, own pins noted', async (t) => {
  const { c, gesehen } = await verbinde(t);
  const r = await steck(c, { aktion: 'zeige', spur_id: 's1' });
  assert.notEqual(r.isError, true);
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad, g.quelle]), [['GET', '/proj/steckfeld?spur_id=s1', 'cypher']]);
  const z = text(r).split('\n');
  assert.ok(z.includes('A  VCO 1 > Cutoff  +0.40'), text(r));
  assert.ok(z.includes('A  Filter > Reso  -0.25'), text(r));
  assert.ok(z.includes('B  VCO 2 > Pitch 1  +1.00'), text(r));
  assert.ok(text(r).includes('Rows: VCO 1, VCO 2'), 'row labels are listed');
  assert.ok(text(r).includes('Columns: Pitch 1, Pitch 2'), 'column labels are listed');
  assert.ok(/own pins/.test(z[0]) && !/defaults/.test(z[0]), z[0]);
});

test('zeige: graph defaults are said so, an empty set is said so; the route error passes through', async (t) => {
  const { c } = await verbinde(t, FELD({ eigene: false, stifte: [[0, 0, 0, 0.5]] }));
  const r = await steck(c, { aktion: 'zeige', spur_id: 's1' });
  assert.ok(/graph defaults/.test(text(r).split('\n')[0]), text(r));
  assert.ok(text(r).split('\n').includes('B  (no pins)'), text(r));
  const k = await verbinde(t, null);
  const e = await steck(k.c, { aktion: 'zeige', spur_id: 's1' });
  assert.equal(e.isError, true);
  assert.equal(JSON.parse(text(e)).fehler, 'kein_steckfeld');
});

test('setze: label and index give the same body (0-based), satz default A, rev from /proj/aktuell', async (t) => {
  const { c, gesehen } = await verbinde(t);
  const a = await steck(c, { aktion: 'setze', spur_id: 's1', zeile: 'vco 1', spalte: 'CUTOFF', wert: 0.4 });
  assert.notEqual(a.isError, true, text(a));
  const b = await steck(c, { aktion: 'setze', spur_id: 's1', zeile: 1, spalte: 3, wert: 0.4 });
  assert.notEqual(b.isError, true, text(b));
  const ps = posts(gesehen);
  assert.equal(ps.length, 2);
  for (const q of ps) {
    assert.equal(q.pfad, '/proj/aendern?antwort=kurz');
    assert.equal(q.koerper.rev, 7);
    assert.deepEqual(q.koerper.befehle, [{ befehl: 'geraet_stift_setzen', spur_id: 's1', satz: 0, zeile: 0, spalte: 2, wert: 0.4 }]);
  }
  assert.deepEqual(ps[0].koerper, ps[1].koerper);
});

test('setze satz B, last index 16, wert 1 and -1 are in range; an explicit rev is used', async (t) => {
  const { c, gesehen } = await verbinde(t);
  await steck(c, { aktion: 'setze', spur_id: 's1', satz: 'B', zeile: 16, spalte: 16, wert: -1, rev: 3 });
  const q = posts(gesehen)[0];
  assert.equal(q.koerper.rev, 3);
  assert.deepEqual(q.koerper.befehle, [{ befehl: 'geraet_stift_setzen', spur_id: 's1', satz: 1, zeile: 15, spalte: 15, wert: -1 }]);
});

test('loesche: the same command with wert 0', async (t) => {
  const { c, gesehen } = await verbinde(t);
  const r = await steck(c, { aktion: 'loesche', spur_id: 's1', zeile: 'Filter', spalte: 'Reso', satz: 'B' });
  assert.notEqual(r.isError, true, text(r));
  assert.deepEqual(posts(gesehen)[0].koerper.befehle, [{ befehl: 'geraet_stift_setzen', spur_id: 's1', satz: 1, zeile: 3, spalte: 3, wert: 0 }]);
});

test('leere: geraet_stifte_setzen with the satz and an empty list', async (t) => {
  const { c, gesehen } = await verbinde(t);
  await steck(c, { aktion: 'leere', spur_id: 's1' });
  await steck(c, { aktion: 'leere', spur_id: 's1', satz: 'B' });
  assert.deepEqual(posts(gesehen).map((q) => q.koerper.befehle), [
    [{ befehl: 'geraet_stifte_setzen', spur_id: 's1', satz: 0, stifte: [] }],
    [{ befehl: 'geraet_stifte_setzen', spur_id: 's1', satz: 1, stifte: [] }]]);
});

test('kopiere: reads the field, sends set A as satz 1 into set B', async (t) => {
  const { c, gesehen } = await verbinde(t);
  const r = await steck(c, { aktion: 'kopiere', spur_id: 's1' });
  assert.notEqual(r.isError, true, text(r));
  assert.equal(gesehen[0].pfad, '/proj/steckfeld?spur_id=s1');
  assert.deepEqual(posts(gesehen)[0].koerper.befehle, [{ befehl: 'geraet_stifte_setzen', spur_id: 's1', satz: 1, stifte: [[1, 0, 2, 0.4], [1, 3, 3, -0.25]] }]);
});

test('kopiere with an empty set A empties set B', async (t) => {
  const { c, gesehen } = await verbinde(t, FELD({ stifte: [[1, 1, 0, 1]] }));
  await steck(c, { aktion: 'kopiere', spur_id: 's1' });
  assert.deepEqual(posts(gesehen)[0].koerper.befehle, [{ befehl: 'geraet_stifte_setzen', spur_id: 's1', satz: 1, stifte: [] }]);
});

test('local refusals: argument_ungueltig and no write request', async (t) => {
  const { c, gesehen } = await verbinde(t);
  const alle = [
    { aktion: 'setze', spur_id: 's1', zeile: 'Nope', spalte: 'Cutoff', wert: 0.1 },       // unknown label
    { aktion: 'setze', spur_id: 's1', zeile: 'VCO 1', spalte: 'Nope', wert: 0.1 },
    { aktion: 'setze', spur_id: 's1', zeile: 0, spalte: 1, wert: 0.1 },                    // index out of range
    { aktion: 'setze', spur_id: 's1', zeile: 1, spalte: 17, wert: 0.1 },
    { aktion: 'setze', spur_id: 's1', zeile: 1.5, spalte: 1, wert: 0.1 },
    { aktion: 'setze', spur_id: 's1', zeile: 1, spalte: 1, wert: 1.5 },                     // wert out of range
    { aktion: 'setze', spur_id: 's1', zeile: 1, spalte: 1, wert: -1.01 },
    { aktion: 'setze', spur_id: 's1', zeile: 1, spalte: 1 },                                // wert missing
    { aktion: 'setze', spur_id: 's1', zeile: 1, spalte: 1, wert: 'x' },
    { aktion: 'setze', spur_id: 's1', spalte: 1, wert: 0.1 },                               // zeile missing
    { aktion: 'loesche', spur_id: 's1', zeile: 1 },                                         // spalte missing
    { aktion: 'setze', spur_id: 's1', zeile: 1, spalte: 1, wert: 0.1, satz: 'C' },
    { aktion: 'leere', spur_id: 's1', satz: 2 },
    { aktion: 'setze', zeile: 1, spalte: 1, wert: 0.1 },                                    // spur_id missing
    { aktion: 'setze', spur_id: '', zeile: 1, spalte: 1, wert: 0.1 },
    { aktion: 'tanze', spur_id: 's1' },
  ];
  for (const a of alle) {
    const r = await steck(c, a);
    assert.equal(r.isError, true, JSON.stringify(a));
    assert.equal(JSON.parse(text(r)).fehler, 'argument_ungueltig', JSON.stringify(a));
  }
  assert.deepEqual(posts(gesehen), [], 'no write request went out');
});

test('an ambiguous label is refused without a write', async (t) => {
  const zeilen = [...ZEILEN]; zeilen[5] = 'vco 1';
  const { c, gesehen } = await verbinde(t, FELD({ zeilen }));
  const r = await steck(c, { aktion: 'setze', spur_id: 's1', zeile: 'VCO 1', spalte: 3, wert: 0.2 });
  assert.equal(r.isError, true);
  const j = JSON.parse(text(r));
  assert.equal(j.fehler, 'argument_ungueltig');
  assert.ok(/ambiguous/.test(j.text), j.text);
  assert.deepEqual(posts(gesehen), []);
});

test('a server refusal passes through as a tool error with its reason', async (t) => {
  const { c } = await verbinde(t, FELD(), () => [409, { fehler: 'geraet_falsch', text: 'not a bk track' }]);
  const r = await steck(c, { aktion: 'setze', spur_id: 's1', zeile: 1, spalte: 1, wert: 0.5 });
  assert.equal(r.isError, true);
  assert.equal(JSON.parse(text(r)).fehler, 'geraet_falsch');
});
