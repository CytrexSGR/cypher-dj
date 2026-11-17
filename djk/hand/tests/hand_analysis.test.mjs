// ANALYZE window slice 1, lane D: the hand tool `proj_analyse` posts the strip to /proj/analyse and answers the reduced analysis.
// A stub page records every request.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fuerHand } from '../../ui/project/sound_contract.ts';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');
const FIXTURE = JSON.parse(fs.readFileSync(path.resolve(path.dirname(HAND), '..', 'ui', 'tests', 'fixtures', 'analyse_antwort.json'), 'utf8'));

async function verbinde(t, antwort = () => [200, FIXTURE]) {
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
const analyse = (c, args) => c.callTool({ name: 'proj_analyse', arguments: args });
const antwort = (r) => JSON.parse(r.content[0].text);
const QUELLE = { art: 'spur', id: 's1' }, VERGLEICH = { art: 'spur', id: 's2' };

test('proj_analyse posts the source as cypher and answers without the time picture, in thirds', async (t) => {
  const { c, gesehen } = await verbinde(t);
  const r = await analyse(c, { quelle: QUELLE, vergleich: VERGLEICH });
  assert.ok(!r.isError, r.content[0].text.slice(0, 300));
  assert.equal(gesehen.length, 1);
  assert.equal(gesehen[0].methode, 'POST');
  assert.equal(gesehen[0].pfad, '/proj/analyse');
  assert.equal(gesehen[0].quelle, 'cypher');
  assert.deepEqual(gesehen[0].koerper, { quelle: QUELLE, vergleich: VERGLEICH });
  const a = antwort(r);
  assert.deepEqual(a, fuerHand(FIXTURE, false));
  assert.ok(!('zeitbild' in a.quelle));
  assert.ok(!JSON.stringify(a).includes('zeitbild'));
  assert.equal(a.quelle.spektrum.hz.length, 30);
});

test('fein keeps the 1/12 octave and is not sent', async (t) => {
  const { c, gesehen } = await verbinde(t);
  const r = await analyse(c, { quelle: QUELLE, fein: true });
  const a = antwort(r);
  assert.equal(a.quelle.spektrum.hz.length, 120);
  assert.deepEqual(a, fuerHand(FIXTURE, true));
  assert.ok(!('zeitbild' in a.quelle));
  assert.deepEqual(gesehen[0].koerper, { quelle: QUELLE });
  assert.ok(!('fein' in gesehen[0].koerper));
});

test('range arguments are passed only when given', async (t) => {
  const { c, gesehen } = await verbinde(t);
  await analyse(c, { quelle: { art: 'master' }, von_beat: 4, bis_beat: 12 });
  assert.deepEqual(gesehen[0].koerper, { quelle: { art: 'master' }, von_beat: 4, bis_beat: 12 });
});

test('a refusal is a tool error with reason and text', async (t) => {
  const { c } = await verbinde(t, () => [409, { fehler: 'transport_laeuft', text: 'the transport is running; stop it first' }]);
  const r = await analyse(c, { quelle: QUELLE });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /transport_laeuft/);
  assert.match(r.content[0].text, /stop it first/);
});

test('the schema and the description', async (t) => {
  const { c } = await verbinde(t);
  const x = (await c.listTools()).tools.find((y) => y.name === 'proj_analyse');
  assert.ok(x, 'proj_analyse is listed');
  assert.deepEqual(Object.keys(x.inputSchema.properties).sort(), ['bis_beat', 'fein', 'quelle', 'vergleich', 'von_beat']);
  assert.deepEqual(x.inputSchema.required, ['quelle']);
  for (const k of ['quelle', 'vergleich']) {
    const q = x.inputSchema.properties[k];
    assert.equal(q.type, 'object');
    assert.deepEqual(q.properties.art.enum, ['spur', 'gruppe', 'return', 'master']);
    assert.equal(q.properties.id.type, 'string');
    assert.deepEqual(q.required, ['art']);
  }
  assert.equal(x.inputSchema.properties.fein.type, 'boolean');
  for (const wort of ['korrelation', 'breite_db', 'lufs_s_max', 'lufs_m_max', 'crest_db', 'true_peak_dbtp', 'korrelation_min', '1/3 octave', 'fein', 'bass_nicht_mono', '0.5',
    '-1 dBTP', 'resonanz', '9 dB', 'ueberdeckung_tief', '250 Hz', 'transport_laeuft', 'proj_lautheit', 'stumm', 'DJK_HAND_FRIST_PROJ_ANALYSE_MS', 'measuring floor', 'argument_ungueltig', 'ueberdeckung', 'spur_unbekannt', 'export_bereich']) {
    assert.ok(x.description.includes(wort), `the description names ${wort}`);
  }
});

test('the tool count is 93', async (t) => {
  const { c } = await verbinde(t);
  assert.equal((await c.listTools()).tools.length, 93);
  const imCode = fs.readFileSync(HAND, 'utf8').split('\n').filter((z) => z.startsWith("  { name: '")).length;
  assert.equal(imCode, 93);
});
