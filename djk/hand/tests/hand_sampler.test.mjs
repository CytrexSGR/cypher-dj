// Sampler A1 task 9 and Sampler A2 task 9: the hand tool `sampler` (sources, list, create, read, to track, cut again, markers, original order). A stub page records every request.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');

// `antwort(methode, pfad)` returns [status, body]; the default answers 200 {ok: true}
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

test('sampler schema: aktion is an enum of eleven, scheiben an enum of the grid counts, quelle names art, ref and stem', async (t) => {
  const { c } = await verbinde(t);
  const x = (await c.listTools()).tools.find((y) => y.name === 'sampler');
  assert.ok(x, 'tool sampler is listed');
  const p = x.inputSchema.properties;
  assert.deepEqual(p.aktion.enum, ['quellen', 'liste', 'neu', 'lies', 'spur', 'kit', 'ton', 'schneiden', 'marke', 'ursprung', 'loeschen']);
  assert.equal(p.ton_graph.type, 'string');
  assert.deepEqual(p.methode.enum, ['raster', 'anschlag'], 'hand is never a way to cut: it comes from marker edits');
  assert.equal(p.empfindlichkeit.type, 'number');
  assert.equal(p.empfindlichkeit.minimum, 0);
  assert.equal(p.empfindlichkeit.maximum, 1);
  assert.deepEqual(p.art.enum, ['schieben', 'neu', 'weg']);
  assert.equal(p.scheibe.type, 'integer');
  assert.equal(p.scheibe.minimum, 2);
  assert.equal(p.beat.type, 'number');
  assert.equal(p.einrasten.type, 'boolean');
  assert.equal(p.spur_id.type, 'string');
  assert.equal(p.von.minimum, 1, 'ton: slices from 1');
  assert.equal(p.spur.type, 'boolean', 'ton: spur is a flag, not the id of a track');
  assert.deepEqual(x.inputSchema.required, ['aktion']);
  assert.deepEqual(p.scheiben.enum, [4, 8, 16, 32, 64]);
  assert.deepEqual(p.quelle.properties.art.enum, ['loop', 'modul']);
  assert.deepEqual(p.quelle.required, ['art', 'ref']);
  assert.equal(p.quelle.properties.ref.type, 'string');
  assert.equal(p.quelle.properties.stem.type, 'string');
  assert.equal(p.id.type, 'string');
  assert.equal(p.name.type, 'string');
  // plan C: the fields of `ton`
  assert.equal(p.von.type, 'integer');
  assert.equal(p.von.minimum, 1);
  assert.equal(p.bis.type, 'integer');
  assert.equal(p.grund.type, 'integer');
  assert.deepEqual([p.grund.minimum, p.grund.maximum], [16, 95]);
  assert.equal(p.spur.type, 'boolean');
});

test('sampler description: numbering from 1, note n - 1 and n + 63 reversed, spur needs an open workbench module, patterns go through proj_aendern', async (t) => {
  const { c } = await verbinde(t);
  const d = (await c.listTools()).tools.find((y) => y.name === 'sampler').description;
  assert.match(d, /numbered from 1/i);
  assert.match(d, /note n - 1/);
  assert.match(d, /note n \+ 63/);
  assert.match(d, /open workbench module/i);
  assert.match(d, /proj_aendern/);
  assert.match(d, /noten_neu/);
  assert.match(d, /noten_aendern/);
});

test('sampler quellen and liste are plain GETs without a body', async (t) => {
  const { c, gesehen } = await verbinde(t);
  await sampler(c, { aktion: 'quellen' });
  await sampler(c, { aktion: 'liste' });
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad, g.koerper, g.quelle]), [
    ['GET', '/sampler/quellen', null, 'cypher'],
    ['GET', '/sampler/liste', null, 'cypher'],
  ]);
});

test('sampler neu posts quelle, name and scheiben to /sampler/schnitt, and only what is given', async (t) => {
  const { c, gesehen } = await verbinde(t);
  await sampler(c, { aktion: 'neu', quelle: { art: 'loop', ref: 'Amen' } });
  await sampler(c, { aktion: 'neu', quelle: { art: 'modul', ref: 'm1', stem: 'drums' }, name: 'My cut', scheiben: 16 });
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad, g.koerper]), [
    ['POST', '/sampler/schnitt', { quelle: { art: 'loop', ref: 'Amen' } }],
    ['POST', '/sampler/schnitt', { quelle: { art: 'modul', ref: 'm1', stem: 'drums' }, name: 'My cut', scheiben: 16 }],
  ]);
});

test('sampler lies asks for format=text and the answer text is the tool text', async (t) => {
  const { c, gesehen } = await verbinde(t, () => [200, { id: 'amen-1a2b', text: 'Cut amen-1a2b\nSlice 1: 0 .. 0.25 beat' }]);
  const r = await sampler(c, { aktion: 'lies', id: 'amen-1a2b' });
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad]), [['GET', '/sampler/schnitt?id=amen-1a2b&format=text']]);
  assert.ok(!r.isError);
  assert.equal(r.content[0].text, 'Cut amen-1a2b\nSlice 1: 0 .. 0.25 beat');
});

test('sampler lies encodes the id in the query', async (t) => {
  const { c, gesehen } = await verbinde(t);
  await sampler(c, { aktion: 'lies', id: 'a&b=c' });
  assert.equal(gesehen[0].pfad, '/sampler/schnitt?id=a%26b%3Dc&format=text');
});

test('sampler spur with an id posts only the id; with a quelle it posts quelle, name and scheiben', async (t) => {
  const { c, gesehen } = await verbinde(t);
  await sampler(c, { aktion: 'spur', id: 'amen-1a2b' });
  await sampler(c, { aktion: 'spur', quelle: { art: 'loop', ref: 'Amen' }, name: 'Chops', scheiben: 8 });
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad, g.koerper]), [
    ['POST', '/sampler/spur', { id: 'amen-1a2b' }],
    ['POST', '/sampler/spur', { quelle: { art: 'loop', ref: 'Amen' }, name: 'Chops', scheiben: 8 }],
  ]);
});

test('sampler spur without id and without quelle, and with both, is refused argument_ungueltig before any request', async (t) => {
  const { c, gesehen } = await verbinde(t);
  const leer = await sampler(c, { aktion: 'spur' });
  const beide = await sampler(c, { aktion: 'spur', id: 'x', quelle: { art: 'loop', ref: 'Amen' } });
  for (const r of [leer, beide]) {
    assert.equal(r.isError, true);
    assert.equal(JSON.parse(r.content[0].text).fehler, 'argument_ungueltig');
  }
  assert.equal(gesehen.length, 0, 'no request was sent');
});

test('sampler refuses a wrong shape locally without a request: unknown aktion, lies without id, neu without quelle, bad quelle, bad scheiben', async (t) => {
  const { c, gesehen } = await verbinde(t);
  const faelle = [
    [{ aktion: 'nix' }, 'aktion_unbekannt'],
    [{}, 'aktion_unbekannt'],
    [{ aktion: 'lies' }, 'argument_ungueltig'],
    [{ aktion: 'lies', id: '' }, 'argument_ungueltig'],
    [{ aktion: 'neu' }, 'argument_ungueltig'],
    [{ aktion: 'neu', quelle: 'Amen' }, 'argument_ungueltig'],
    [{ aktion: 'neu', quelle: { art: 'datei', ref: 'x' } }, 'argument_ungueltig'],
    [{ aktion: 'neu', quelle: { art: 'loop' } }, 'argument_ungueltig'],
    [{ aktion: 'neu', quelle: { art: 'loop', ref: 'Amen', stem: 3 } }, 'argument_ungueltig'],
    [{ aktion: 'neu', quelle: { art: 'loop', ref: 'Amen' }, scheiben: 12 }, 'argument_ungueltig'],
    [{ aktion: 'neu', quelle: { art: 'loop', ref: 'Amen' }, name: 5 }, 'argument_ungueltig'],
    [{ aktion: 'spur', id: 7 }, 'argument_ungueltig'],
  ];
  for (const [args, grund] of faelle) {
    const r = await sampler(c, args);
    assert.equal(r.isError, true, JSON.stringify(args));
    assert.equal(JSON.parse(r.content[0].text).fehler, grund, JSON.stringify(args));
  }
  assert.equal(gesehen.length, 0, 'no request was sent');
});

test('sampler: a 409 answer becomes isError with the server\'s reason and text', async (t) => {
  const { c } = await verbinde(t, () => [409, { fehler: 'kein_werkbank', text: 'the open project is not a workbench module' }]);
  const r = await sampler(c, { aktion: 'spur', id: 'amen-1a2b' });
  assert.equal(r.isError, true);
  const j = JSON.parse(r.content[0].text);
  assert.equal(j.fehler, 'kein_werkbank');
  assert.equal(j.text, 'the open project is not a workbench module');
});

test('sampler lies: a 404 answer is an error with the server\'s text, not an empty text', async (t) => {
  const { c } = await verbinde(t, () => [404, { fehler: 'schnitt_unbekannt', text: 'cut nope does not exist' }]);
  const r = await sampler(c, { aktion: 'lies', id: 'nope' });
  assert.equal(r.isError, true);
  assert.equal(JSON.parse(r.content[0].text).fehler, 'schnitt_unbekannt');
});

// ---- Sampler C task 6: aktion ton ----
test('sampler description (plan C): ton names slices from 1, the root as a note, the NOTE track and the reload', async (t) => {
  const { c } = await verbinde(t);
  const d = (await c.listTools()).tools.find((y) => y.name === 'sampler').description;
  assert.match(d, /ton \{id, von/);
  assert.match(d, /16 to 95/);
  assert.match(d, /60 = C3/);
  assert.match(d, /NOTE track/);
  assert.match(d, /confidence/);
});

test('sampler ton sends the slice numbers from 0 and spur true by default', async (t) => {
  const { c, gesehen } = await verbinde(t);
  await sampler(c, { aktion: 'ton', id: 'x', von: 3, bis: 4 });
  await sampler(c, { aktion: 'ton', id: 'x', von: 1 });
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad, g.koerper, g.quelle]), [
    ['POST', '/sampler/ton', { id: 'x', von: 2, bis: 3, spur: true }, 'cypher'],
    ['POST', '/sampler/ton', { id: 'x', von: 0, spur: true }, 'cypher'],
  ]);
});

test('sampler ton passes spur false, the root and the name', async (t) => {
  const { c, gesehen } = await verbinde(t);
  await sampler(c, { aktion: 'ton', id: 'x', von: 3, bis: 4, spur: false, grund: 57 });
  await sampler(c, { aktion: 'ton', id: 'x', von: 2, bis: 2, name: 'Stab', grund: 16, spur: true });
  await sampler(c, { aktion: 'ton', id: 'x', von: 2, grund: 95 });
  assert.deepEqual(gesehen.map((g) => g.koerper), [
    { id: 'x', von: 2, bis: 3, spur: false, grund: 57 },
    { id: 'x', von: 1, bis: 1, spur: true, grund: 16, name: 'Stab' },
    { id: 'x', von: 1, spur: true, grund: 95 },
  ]);
});

test('sampler ton: the answer text is the tool text of the route (it names device, root and confidence)', async (t) => {
  const text = 'tone ton-x-1 "Break x \u00b7 3-4"  cut x  slices 3-4  root A2 (note 57, from detection)  detected A2  confidence 0.93';
  const { c } = await verbinde(t, () => [200, { ton: { graph: 'ton-x-1' }, text, rev: 5, spur_id: 's4' }]);
  const r = await sampler(c, { aktion: 'ton', id: 'x', von: 3, bis: 4 });
  assert.ok(!r.isError);
  assert.equal(r.content[0].text, text);
});

test('sampler ton refuses a wrong shape locally without a request (von 0, bis before von, root outside 16..95, no id, wrong types)', async (t) => {
  const { c, gesehen } = await verbinde(t);
  const faelle = [
    { aktion: 'ton', von: 1 },
    { aktion: 'ton', id: '', von: 1 },
    { aktion: 'ton', id: 7, von: 1 },
    { aktion: 'ton', id: 'x' },
    { aktion: 'ton', id: 'x', von: 0 },
    { aktion: 'ton', id: 'x', von: -2 },
    { aktion: 'ton', id: 'x', von: 1.5 },
    { aktion: 'ton', id: 'x', von: '2' },
    { aktion: 'ton', id: 'x', von: 4, bis: 3 },
    { aktion: 'ton', id: 'x', von: 2, bis: 0 },
    { aktion: 'ton', id: 'x', von: 2, bis: 2.5 },
    { aktion: 'ton', id: 'x', von: 2, bis: '3' },
    { aktion: 'ton', id: 'x', von: 2, grund: 96 },
    { aktion: 'ton', id: 'x', von: 2, grund: 15 },
    { aktion: 'ton', id: 'x', von: 2, grund: 60.5 },
    { aktion: 'ton', id: 'x', von: 2, grund: '60' },
    { aktion: 'ton', id: 'x', von: 2, name: 5 },
    { aktion: 'ton', id: 'x', von: 2, name: '' },
    { aktion: 'ton', id: 'x', von: 2, spur: 'yes' },
  ];
  for (const args of faelle) {
    const r = await sampler(c, args);
    assert.equal(r.isError, true, JSON.stringify(args));
    assert.equal(JSON.parse(r.content[0].text).fehler, 'argument_ungueltig', JSON.stringify(args));
  }
  assert.equal(gesehen.length, 0, 'no request was sent');
});

test('sampler description: hits carry strength and grid distance, a moved marker leaves patterns alone, adding or removing renumbers the open module', async (t) => {
  const { c } = await verbinde(t);
  const d = (await c.listTools()).tools.find((y) => y.name === 'sampler').description;
  assert.match(d, /strength 0\.\.1/);
  assert.match(d, /grid distance in beats/);
  assert.match(d, /never changes a pattern/i);
  assert.match(d, /renumbers the patterns of the open module/i);
  assert.match(d, /schneiden/);
  assert.match(d, /ursprung/);
});

test('sampler neu and spur pass methode and empfindlichkeit, and only what is given', async (t) => {
  const { c, gesehen } = await verbinde(t);
  const q = { art: 'loop', ref: 'Amen' };
  await sampler(c, { aktion: 'neu', quelle: q, methode: 'anschlag', empfindlichkeit: 0.7 });
  await sampler(c, { aktion: 'neu', quelle: q, methode: 'raster', scheiben: 16 });
  await sampler(c, { aktion: 'spur', quelle: q, name: 'Hits', methode: 'anschlag' });
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad, g.koerper]), [
    ['POST', '/sampler/schnitt', { quelle: q, methode: 'anschlag', empfindlichkeit: 0.7 }],
    ['POST', '/sampler/schnitt', { quelle: q, methode: 'raster', scheiben: 16 }],
    ['POST', '/sampler/spur', { quelle: q, name: 'Hits', methode: 'anschlag' }],
  ]);
});

test('sampler neu and spur refuse a wrong methode or a mismatched option locally, without a request', async (t) => {
  const { c, gesehen } = await verbinde(t);
  const q = { art: 'loop', ref: 'Amen' };
  const faelle = [
    { aktion: 'neu', quelle: q, methode: 'hand' },
    { aktion: 'neu', quelle: q, methode: 7 },
    { aktion: 'neu', quelle: q, methode: 'anschlag', scheiben: 16 },
    { aktion: 'neu', quelle: q, methode: 'raster', empfindlichkeit: 0.5 },
    { aktion: 'neu', quelle: q, empfindlichkeit: 0.5 },
    { aktion: 'neu', quelle: q, methode: 'anschlag', empfindlichkeit: 1.5 },
    { aktion: 'neu', quelle: q, methode: 'anschlag', empfindlichkeit: 'hoch' },
    { aktion: 'spur', id: 'x', methode: 'anschlag' },
  ];
  for (const args of faelle) {
    const r = await sampler(c, args);
    assert.equal(r.isError, true, JSON.stringify(args));
    assert.equal(JSON.parse(r.content[0].text).fehler, 'argument_ungueltig', JSON.stringify(args));
  }
  assert.equal(gesehen.length, 0, 'no request was sent');
});

test('sampler ton: a 409 answer becomes isError with the server\'s reason and text', async (t) => {
  const { c } = await verbinde(t, () => [409, { fehler: 'werkbank_voll', text: 'a module holds at most 8 instrument tracks' }]);
  const r = await sampler(c, { aktion: 'ton', id: 'x', von: 2 });
  assert.equal(r.isError, true);
  const j = JSON.parse(r.content[0].text);
  assert.equal(j.fehler, 'werkbank_voll');
  assert.equal(j.text, 'a module holds at most 8 instrument tracks');
});

const SCHNITT_TEXT = 'Cut amen-1a2b\nmethod anschlag 0.50\nSlice 1: 0 .. 0.25 beat';
function schnittAntwort(post) {
  return (m, pfad) => (m === 'GET' ? [200, { id: 'amen-1a2b', text: SCHNITT_TEXT }] : pfad === '/sampler/neu_schneiden' || pfad === '/sampler/marke' ? [200, post] : [200, { ok: true }]);
}

test('sampler schneiden posts id, methode and the options to /sampler/neu_schneiden, then reads the cut as text; the tool text is the answer text plus the cut', async (t) => {
  const { c, gesehen } = await verbinde(t, schnittAntwort({ schnitt: { id: 'amen-1a2b' }, spuren: [], text: 'Cut again: 9 slices by hits.' }));
  const r = await sampler(c, { aktion: 'schneiden', id: 'amen-1a2b', methode: 'anschlag', empfindlichkeit: 0.7 });
  assert.ok(!r.isError);
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad, g.koerper]), [
    ['POST', '/sampler/neu_schneiden', { id: 'amen-1a2b', methode: 'anschlag', empfindlichkeit: 0.7 }],
    ['GET', '/sampler/schnitt?id=amen-1a2b&format=text', null],
  ]);
  assert.equal(r.content[0].text, `Cut again: 9 slices by hits.\n${SCHNITT_TEXT}`);
  const { c: c2, gesehen: g2 } = await verbinde(t, schnittAntwort({ text: 'Cut again: 16 slices by grid.' }));
  await sampler(c2, { aktion: 'schneiden', id: 'amen-1a2b', methode: 'raster', scheiben: 16 });
  assert.deepEqual(g2[0].koerper, { id: 'amen-1a2b', methode: 'raster', scheiben: 16 });
});

test('sampler schneiden is refused locally without a request: methode hand, no methode, no id, mismatched options', async (t) => {
  const { c, gesehen } = await verbinde(t);
  const faelle = [
    { aktion: 'schneiden', id: 'x', methode: 'hand' },
    { aktion: 'schneiden', id: 'x' },
    { aktion: 'schneiden', methode: 'raster' },
    { aktion: 'schneiden', id: '', methode: 'raster' },
    { aktion: 'schneiden', id: 'x', methode: 'raster', empfindlichkeit: 0.5 },
    { aktion: 'schneiden', id: 'x', methode: 'anschlag', scheiben: 8 },
    { aktion: 'schneiden', id: 'x', methode: 'raster', scheiben: 12 },
    { aktion: 'schneiden', id: 'x', methode: 'anschlag', empfindlichkeit: -0.1 },
  ];
  for (const args of faelle) {
    const r = await sampler(c, args);
    assert.equal(r.isError, true, JSON.stringify(args));
    assert.equal(JSON.parse(r.content[0].text).fehler, 'argument_ungueltig', JSON.stringify(args));
  }
  assert.equal(gesehen.length, 0, 'no request was sent');
});

test('sampler marke: scheibe 4 is sent as marke 3; beat and einrasten pass; the tool text is the answer text plus the cut', async (t) => {
  const { c, gesehen } = await verbinde(t, schnittAntwort({ schnitt: { id: 'amen-1a2b' }, text: 'Marker 3 moved to frame 4410. The patterns are unchanged.', rev: 5, projekt: { huge: true } }));
  const r = await sampler(c, { aktion: 'marke', id: 'amen-1a2b', art: 'schieben', scheibe: 4, beat: 1.5, einrasten: false });
  assert.ok(!r.isError);
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad, g.koerper]), [
    ['POST', '/sampler/marke', { id: 'amen-1a2b', art: 'schieben', marke: 3, beat: 1.5, einrasten: false }],
    ['GET', '/sampler/schnitt?id=amen-1a2b&format=text', null],
  ]);
  assert.equal(r.content[0].text, `Marker 3 moved to frame 4410. The patterns are unchanged.\n${SCHNITT_TEXT}`);
  assert.ok(!r.content[0].text.includes('huge'), 'the whole project is not dumped into the tool text');
});

test('sampler marke neu sends beat without marke, weg sends marke without beat', async (t) => {
  const { c, gesehen } = await verbinde(t, schnittAntwort({ text: 'ok' }));
  await sampler(c, { aktion: 'marke', id: 'a', art: 'neu', beat: 2 });
  await sampler(c, { aktion: 'marke', id: 'a', art: 'weg', scheibe: 2 });
  const posts = gesehen.filter((g) => g.methode === 'POST');
  assert.deepEqual(posts.map((g) => [g.pfad, g.koerper]), [
    ['/sampler/marke', { id: 'a', art: 'neu', beat: 2 }],
    ['/sampler/marke', { id: 'a', art: 'weg', marke: 1 }],
  ]);
});

test('sampler marke without scheibe for schieben (or weg), and other wrong shapes, are refused argument_ungueltig before any request', async (t) => {
  const { c, gesehen } = await verbinde(t);
  const faelle = [
    { aktion: 'marke', id: 'x', art: 'schieben', beat: 1 },
    { aktion: 'marke', id: 'x', art: 'weg' },
    { aktion: 'marke', id: 'x', art: 'schieben', scheibe: 1, beat: 1 },
    { aktion: 'marke', id: 'x', art: 'schieben', scheibe: 2.5, beat: 1 },
    { aktion: 'marke', id: 'x', art: 'schieben', scheibe: 3 },
    { aktion: 'marke', id: 'x', art: 'weg', scheibe: 3, beat: 1 },
    { aktion: 'marke', id: 'x', art: 'neu' },
    { aktion: 'marke', id: 'x', art: 'neu', beat: 1, scheibe: 3 },
    { aktion: 'marke', id: 'x', art: 'drehen', scheibe: 3, beat: 1 },
    { aktion: 'marke', art: 'neu', beat: 1 },
    { aktion: 'marke', id: 'x', art: 'neu', beat: 'bald' },
    { aktion: 'marke', id: 'x', art: 'neu', beat: 1, einrasten: 'ja' },
  ];
  for (const args of faelle) {
    const r = await sampler(c, args);
    assert.equal(r.isError, true, JSON.stringify(args));
    assert.equal(JSON.parse(r.content[0].text).fehler, 'argument_ungueltig', JSON.stringify(args));
  }
  assert.equal(gesehen.length, 0, 'no request was sent');
});

test('sampler marke: a 409 becomes isError with the server\'s reason and text, and the cut is not read', async (t) => {
  const { c, gesehen } = await verbinde(t, () => [409, { fehler: 'marke_zu_nah', text: 'a marker at frame 12 would leave a slice shorter than 4 frames' }]);
  const r = await sampler(c, { aktion: 'marke', id: 'amen-1a2b', art: 'schieben', scheibe: 3, beat: 0.001 });
  assert.equal(r.isError, true);
  const j = JSON.parse(r.content[0].text);
  assert.equal(j.fehler, 'marke_zu_nah');
  assert.equal(j.text, 'a marker at frame 12 would leave a slice shorter than 4 frames');
  assert.equal(gesehen.length, 1, 'only the POST was sent');
});

test('sampler schneiden: a 422 keine_anschlaege is an error with the server\'s text', async (t) => {
  const { c } = await verbinde(t, () => [422, { fehler: 'keine_anschlaege', text: 'no hits found at sensitivity 0.50; raise it or cut by grid' }]);
  const r = await sampler(c, { aktion: 'schneiden', id: 'amen-1a2b', methode: 'anschlag' });
  assert.equal(r.isError, true);
  assert.equal(JSON.parse(r.content[0].text).fehler, 'keine_anschlaege');
});

test('sampler ursprung posts spur_id to /sampler/ursprung and answers the text of the route', async (t) => {
  const { c, gesehen } = await verbinde(t, () => [200, { rev: 7, projekt: { huge: true }, text: 'Original order: 9 notes, one per slice, on track Amen.' }]);
  const r = await sampler(c, { aktion: 'ursprung', spur_id: 'sp1' });
  assert.ok(!r.isError);
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad, g.koerper]), [['POST', '/sampler/ursprung', { spur_id: 'sp1' }]]);
  assert.equal(r.content[0].text, 'Original order: 9 notes, one per slice, on track Amen.');
});

test('sampler ursprung without spur_id is refused locally; a 409 kein_schnitt_geraet stays an error', async (t) => {
  const { c, gesehen } = await verbinde(t, () => [409, { fehler: 'kein_schnitt_geraet', text: 'track Bass does not play a sampler cut' }]);
  for (const args of [{ aktion: 'ursprung' }, { aktion: 'ursprung', spur_id: '' }, { aktion: 'ursprung', spur_id: 4 }]) {
    const r = await sampler(c, args);
    assert.equal(r.isError, true, JSON.stringify(args));
    assert.equal(JSON.parse(r.content[0].text).fehler, 'argument_ungueltig');
  }
  assert.equal(gesehen.length, 0);
  const r = await sampler(c, { aktion: 'ursprung', spur_id: 'sp2' });
  assert.equal(r.isError, true);
  assert.equal(JSON.parse(r.content[0].text).fehler, 'kein_schnitt_geraet');
});

test('sampler: aktion_unbekannt names the valid actions', async (t) => {
  const { c } = await verbinde(t);
  const r = await sampler(c, { aktion: 'nix' });
  assert.equal(r.isError, true);
  const j = JSON.parse(r.content[0].text);
  assert.equal(j.fehler, 'aktion_unbekannt');
  assert.match(j.text, /quellen, liste, neu, lies, spur, kit, ton, schneiden, marke, ursprung/);
});

test('sampler loeschen with id posts {id} to /sampler/loeschen and answers the route answer', async (t) => {
  const { c, gesehen } = await verbinde(t, () => [200, { ok: true }]);
  const r = await sampler(c, { aktion: 'loeschen', id: 'amen-1a2b' });
  assert.ok(!r.isError);
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad, g.koerper]), [['POST', '/sampler/loeschen', { id: 'amen-1a2b' }]]);
  assert.deepEqual(JSON.parse(r.content[0].text), { ok: true });
});

test('sampler loeschen with ton_graph posts {graph} to /sampler/ton/loeschen', async (t) => {
  const { c, gesehen } = await verbinde(t, () => [200, { ok: true }]);
  const r = await sampler(c, { aktion: 'loeschen', ton_graph: 'smp-ton-amen-1a2b-s3' });
  assert.ok(!r.isError);
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad, g.koerper]), [['POST', '/sampler/ton/loeschen', { graph: 'smp-ton-amen-1a2b-s3' }]]);
});

test('sampler loeschen is refused locally without a request: neither, both, wrong types', async (t) => {
  const { c, gesehen } = await verbinde(t);
  const faelle = [
    { aktion: 'loeschen' },
    { aktion: 'loeschen', id: 'x', ton_graph: 'y' },
    { aktion: 'loeschen', id: '' },
    { aktion: 'loeschen', id: 7 },
    { aktion: 'loeschen', ton_graph: '' },
    { aktion: 'loeschen', ton_graph: 7 },
    { aktion: 'loeschen', id: ['x'] },
  ];
  for (const args of faelle) {
    const r = await sampler(c, args);
    assert.equal(r.isError, true, JSON.stringify(args));
    assert.equal(JSON.parse(r.content[0].text).fehler, 'argument_ungueltig', JSON.stringify(args));
  }
  assert.equal(gesehen.length, 0, 'no request was sent');
});

test('sampler loeschen: a refusal names the places that still use the device (fundstellen and spuren), for the cut and for a tone', async (t) => {
  const fund = ['track "Chops" of the open project "Demo"', 'module "Old break"'];
  for (const [fehler, args] of [['schnitt_in_gebrauch', { aktion: 'loeschen', id: 'amen-1a2b' }], ['ton_in_gebrauch', { aktion: 'loeschen', ton_graph: 'smp-ton-x' }]]) {
    const { c } = await verbinde(t, () => [409, { fehler, text: 'in use by track "Chops" of the open project "Demo", module "Old break"; remove it there first', spuren: ['sp1'], fundstellen: fund }]);
    const r = await sampler(c, args);
    assert.equal(r.isError, true);
    const j = JSON.parse(r.content[0].text);
    assert.equal(j.fehler, fehler);
    assert.match(j.text, /remove it there first/);
    assert.deepEqual(j.detail.fundstellen, fund);
    assert.deepEqual(j.detail.spuren, ['sp1']);
  }
});

test('sampler loeschen: a 404 stays an error with the server\'s reason', async (t) => {
  const { c } = await verbinde(t, () => [404, { fehler: 'ton_unbekannt', text: 'tone nope does not exist' }]);
  const r = await sampler(c, { aktion: 'loeschen', ton_graph: 'nope' });
  assert.equal(r.isError, true);
  assert.equal(JSON.parse(r.content[0].text).fehler, 'ton_unbekannt');
});

test('sampler description: loeschen, liste shows what exists, marke counting bridge, kit ascending order', async (t) => {
  const { c } = await verbinde(t);
  const d = (await c.listTools()).tools.find((y) => y.name === 'sampler').description;
  assert.match(d, /loeschen \{id\}/);
  assert.match(d, /ton_graph/);
  assert.match(d, /schnitt_in_gebrauch/);
  assert.match(d, /fundstellen/);
  assert.match(d, /liste shows the cuts that exist/);
  assert.match(d, /scheibe 2 is marker 1/);
  assert.match(d, /markers 1\.\.n - 1/);
  assert.match(d, /ascending slice order/);
  assert.ok(!/in the order of the numbers/.test(d), 'the old kit wording is gone');
});
