// ANALYZE window slice 1, lane D: the hand tool `proj_analyse` posts the strip to /proj/analyse and answers the reduced analysis.
// A stub page records every request.
import { WERKZEUGE_IM_CODE } from './support/werkzeugzahl.mjs';
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
    assert.deepEqual(q.properties.art.enum, k === 'quelle' ? ['spur', 'gruppe', 'return', 'master'] : ['spur', 'gruppe', 'return', 'master', 'datei', 'referenz']);
    assert.equal(q.properties.id.type, 'string');
    assert.deepEqual(q.required, ['art']);
  }
  for (const f of ['pfad', 'sha', 'von_s', 'bis_s']) assert.ok(x.inputSchema.properties.vergleich.properties[f], `vergleich takes ${f}`);
  for (const wort of ['versatz_db', 'diff_db', 'abweichungen', '3 dB', 'median', 'tonal balance', 'no masking', 'bereich', 'referenz_unbekannt', 'quelle_unbekannt', 'format_falsch', '0.68 s', '55 Hz -0.2 dB']) {
    assert.ok(x.description.includes(wort), `the description names ${wort}`);
  }
  assert.ok(!x.description.includes('55 Hz about -5.5 dB in its 1/12 band'), 'the old low note sentence is gone');
  assert.equal(x.inputSchema.properties.fein.type, 'boolean');
  for (const wort of ['korrelation', 'breite_db', 'lufs_s_max', 'lufs_m_max', 'crest_db', 'true_peak_dbtp', 'korrelation_min', '1/3 octave', 'fein', 'bass_nicht_mono', '0.5',
    '-1 dBTP', 'resonanz', '9 dB', 'ueberdeckung_tief', '250 Hz', 'transport_laeuft', 'proj_lautheit', 'stumm', 'DJK_HAND_FRIST_PROJ_ANALYSE_MS', 'measuring floor', 'argument_ungueltig', 'ueberdeckung', 'spur_unbekannt', 'export_bereich']) {
    assert.ok(x.description.includes(wort), `the description names ${wort}`);
  }
});

test('the tool count is the number of entries in hand.ts', async (t) => {
  const { c } = await verbinde(t);
  assert.equal((await c.listTools()).tools.length, WERKZEUGE_IM_CODE);
  const imCode = fs.readFileSync(HAND, 'utf8').split('\n').filter((z) => z.startsWith("  { name: '")).length;
  assert.equal(imCode, WERKZEUGE_IM_CODE);
});

// ---- slice 2 ----
const LIVE = (db) => ({ leer: false, w: 12345, steht: false, stumm: false, spektrum: { hz: Array.from({ length: 120 }, (_, i) => 20.6 * 2 ** (i / 12)), db },
  stereo: { korrelation: 0.9, korrelation_min: 0.8, breite_db: -12, baender: [0, 1, 2, 3].map((i) => ({ hz_von: i, hz_bis: i + 1, korrelation: 0.9, breite_db: -10, pegel_db: -20 })) },
  spitze_db: -3, rms_db: -12, true_peak_dbtp: -2.5, lufs_m: -10.5 });
const live = (c, args = {}) => c.callTool({ name: 'analyse_live', arguments: args });
const referenz = (c, args) => c.callTool({ name: 'analyse_referenz', arguments: args });
const ref120 = () => ({ hz: Array.from({ length: 120 }, (_, i) => i), mittel_db: Array.from({ length: 120 }, () => -30), max_db: Array.from({ length: 120 }, () => -20) });

test('analyse_live: GET /analyse/live, the spectrum is reduced to 30 bands by the power sum of four', async (t) => {
  const { c, gesehen } = await verbinde(t, () => [200, LIVE(Array.from({ length: 120 }, () => -30))]);
  const a = antwort(await live(c));
  assert.equal(gesehen.length, 1);
  assert.equal(gesehen[0].methode, 'GET');
  assert.equal(gesehen[0].pfad, '/analyse/live');
  assert.equal(a.spektrum.hz.length, 30);
  assert.equal(a.spektrum.db.length, 30);
  assert.ok(Math.abs(a.spektrum.db[0] - (-30 + 10 * Math.log10(4))) < 1e-9);
  assert.equal(a.lufs_m, -10.5);
  assert.equal(a.stereo.baender.length, 4);
  assert.equal(a.steht, false);
});

test('analyse_live: fein keeps the 120 bands, leer passes through, a refusal is a tool error', async (t) => {
  let n = 0;
  const { c } = await verbinde(t, () => (n++ === 0 ? [200, LIVE(Array.from({ length: 120 }, (_, i) => -i))]
    : n === 2 ? [200, { leer: true, grund: 'engine not running' }] : [503, { fehler: 'kern_aus', text: 'no core' }]));
  const a = antwort(await live(c, { fein: true }));
  assert.equal(a.spektrum.hz.length, 120);
  assert.equal(a.spektrum.db[7], -7);
  assert.deepEqual(antwort(await live(c)), { leer: true, grund: 'engine not running' });
  const r = await live(c);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /kern_aus/);
});

test('analyse_live: schema and description', async (t) => {
  const { c } = await verbinde(t);
  const x = (await c.listTools()).tools.find((y) => y.name === 'analyse_live');
  assert.ok(x);
  assert.deepEqual(Object.keys(x.inputSchema.properties), ['fein']);
  assert.equal(x.inputSchema.properties.fein.type, 'boolean');
  for (const wort of ['0.34 s', 'leer', 'steht', 'stumm', 'lufs_m', 'true_peak_dbtp', 'spitze_db', 'rms_db', 'korrelation_min', 'pegel_db', 'erz/4', 'solo', '400 ms', 'only reads', 'fein']) {
    assert.ok(x.description.includes(wort), `the description names ${wort}`);
  }
});

test('analyse_referenz: every action sends the right method, path and body', async (t) => {
  const { c, gesehen } = await verbinde(t, (m, u) => [200, u.endsWith('referenzen') ? { referenzen: [], rollen: [] } : u.endsWith('merken') ? { referenz: { id: 'r1' } } : { ok: true }]);
  await referenz(c, { aktion: 'liste' });
  await referenz(c, { aktion: 'merken', name: 'Kick A', rolle: 'kick', quelle: { art: 'datei', pfad: '/a.wav' }, dauer_s: 8 });
  await referenz(c, { aktion: 'merken', name: 'Bass B', rolle: 'bass', projekt: { quelle: { art: 'spur', id: 's1' }, von_beat: 0, bis_beat: 16 } });
  await referenz(c, { aktion: 'loeschen', id: 'r1' });
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad, g.koerper]), [
    ['GET', '/analyse/referenzen', null],
    ['POST', '/analyse/referenz/merken', { name: 'Kick A', rolle: 'kick', quelle: { art: 'datei', pfad: '/a.wav' }, dauer_s: 8 }],
    ['POST', '/analyse/referenz/merken', { name: 'Bass B', rolle: 'bass', projekt: { quelle: { art: 'spur', id: 's1' }, von_beat: 0, bis_beat: 16 } }],
    ['POST', '/analyse/referenz/loeschen', { id: 'r1' }]]);
});

test('analyse_referenz messen: body without fein, spectrum in thirds unless fein', async (t) => {
  const messung = () => ({ messung: { quelle: { art: 'datei', pfad: '/a.wav' }, name: 'a', stumm: false, spektrum: ref120(), bereich: { von_s: 0, bis_s: 8, datei_s: 8, wahl: 'ganz' } } });
  const { c, gesehen } = await verbinde(t, () => [200, messung()]);
  const a = antwort(await referenz(c, { aktion: 'messen', quelle: { art: 'datei', pfad: '/a.wav' }, dauer_s: 8 }));
  assert.equal(gesehen[0].methode, 'POST');
  assert.equal(gesehen[0].pfad, '/analyse/referenz/messen');
  assert.deepEqual(gesehen[0].koerper, { quelle: { art: 'datei', pfad: '/a.wav' }, dauer_s: 8 });
  assert.equal(a.messung.spektrum.hz.length, 30);
  assert.equal(a.messung.spektrum.mittel_db.length, 30);
  assert.equal(a.messung.bereich.wahl, 'ganz');
  const f = antwort(await referenz(c, { aktion: 'messen', quelle: { art: 'referenz', id: 'r1' }, fein: true }));
  assert.equal(f.messung.spektrum.hz.length, 120);
  assert.deepEqual(gesehen[1].koerper, { quelle: { art: 'referenz', id: 'r1' } });
});

test('analyse_referenz: missing arguments are refused before any request, a server refusal is a tool error', async (t) => {
  const { c, gesehen } = await verbinde(t, () => [404, { fehler: 'quelle_unbekannt', text: 'no such file' }]);
  for (const args of [{ aktion: 'messen' }, { aktion: 'merken', name: 'x' }, { aktion: 'merken', name: 'x', rolle: 'kick' }, { aktion: 'loeschen' }]) {
    const r = await referenz(c, args);
    assert.equal(r.isError, true, JSON.stringify(args));
    assert.match(r.content[0].text, /argument_ungueltig/);
  }
  assert.equal(gesehen.length, 0);
  const r = await referenz(c, { aktion: 'messen', quelle: { art: 'datei', sha: 'abc' } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /quelle_unbekannt/);
});

test('analyse_referenz: schema and description', async (t) => {
  const { c } = await verbinde(t);
  const x = (await c.listTools()).tools.find((y) => y.name === 'analyse_referenz');
  assert.ok(x);
  assert.deepEqual(x.inputSchema.required, ['aktion']);
  assert.deepEqual(x.inputSchema.properties.aktion.enum, ['liste', 'messen', 'merken', 'loeschen']);
  assert.deepEqual(x.inputSchema.properties.rolle.enum, ['kick', 'bass', 'drums', 'perc', 'lead', 'pad', 'chord', 'vocal', 'fx', 'master', 'other']);
  for (const wort of ['vergleich {art: referenz', 'dauer_s', 'loudest window', 'whole file', '900', 'fest', 'laut', 'ganz', 'kick', 'bin folder', '1/3 octave', 'fein', 'proj_analyse']) {
    assert.ok(x.description.includes(wort), `the description names ${wort}`);
  }
});

test('proj_analyse passes a reference vergleich through and keeps abgleich and bereich', async (t) => {
  const antw = structuredClone(FIXTURE);
  antw.abgleich = { versatz_db: -3, baender: Array.from({ length: 30 }, (_, i) => ({ hz: i + 1, diff_db: i === 0 ? null : 1 })), abweichungen: [{ hz_von: 80, hz_bis: 160, diff_db: 4.5 }] };
  antw.vergleich = { quelle: { art: 'referenz', id: 'r1' }, name: 'Kick A', stumm: false, rolle: 'kick', bereich: { von_s: 1, bis_s: 9, datei_s: 200, wahl: 'laut' },
    lautheit: antw.quelle.lautheit, stereo: antw.quelle.stereo, spektrum: structuredClone(antw.quelle.spektrum) };
  delete antw.ueberdeckung;
  const { c, gesehen } = await verbinde(t, () => [200, antw]);
  const v = { art: 'referenz', id: 'r1' };
  const a = antwort(await analyse(c, { quelle: QUELLE, vergleich: v }));
  assert.deepEqual(gesehen[0].koerper, { quelle: QUELLE, vergleich: v });
  assert.deepEqual(a, fuerHand(antw, false));
  assert.deepEqual(a.abgleich, antw.abgleich);
  assert.equal(a.vergleich.bereich.wahl, 'laut');
  assert.equal(a.vergleich.spektrum.hz.length, 30);
  assert.ok(!('ueberdeckung' in a));
  const d = { art: 'datei', pfad: '/x.wav', von_s: 1, bis_s: 9 };
  await analyse(c, { quelle: QUELLE, vergleich: d });
  assert.deepEqual(gesehen[1].koerper, { quelle: QUELLE, vergleich: d });
});
