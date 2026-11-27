// djk-hand proj_noten (note editor slice 1, task B5): read the notes of a clip, start the detection and wait for its end, cancel it; against a stub page server.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');

async function aufbau(t, antworten, env = {}) {
  const gesehen = [];
  const s = http.createServer((q, a) => {
    let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => {
      gesehen.push({ methode: q.method, pfad: q.url, quelle: q.headers['x-djk-quelle'], koerper: b ? JSON.parse(b) : null });
      const [code, j] = antworten(q.method, q.url, gesehen) ?? [200, { ok: true }];
      a.writeHead(code, { 'content-type': 'application/json' }); a.end(JSON.stringify(j));
    });
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`],
    env: { ...process.env, ...env } }));
  t.after(async () => { await c.close(); s.close(); });
  return { c, gesehen };
}

const NOTEN = [
  { id: 't1', qa: 0.5, qe: 1.25, qton: 60.12, p: 0.8 },
  { id: 't2', qa: 1.25, qe: 2, qton: 62.04, p: 0.7, ton: 64 },
];
const LESEN = { clip_id: 'c3', quelle_sha: 'ab'.repeat(32), kurve: { id: 'pyin-1.noten_hmm-1', detektor: 'pyin', stimmhaft_anteil: 0.6, mono: { mehrstimmig: false } },
  noten: NOTEN, analyse: null, render: { zustand: 'bereit', schluessel: 'k1', sekunden: 0.4 } };
const text = (r) => r.content[0].text;

test('proj_noten reads the notes of a clip (GET /proj/noten with clip_id)', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u.startsWith('/proj/noten?') ? [200, LESEN] : null));
  const w = (await c.listTools()).tools.find((x) => x.name === 'proj_noten');
  assert.ok(w, 'tool proj_noten is listed');
  assert.deepEqual(w.inputSchema.properties.abbrechen.type, 'integer');
  assert.equal(w.inputSchema.properties.erkennen.type, 'boolean');
  assert.equal(w.inputSchema.properties.neu.type, 'boolean');
  const r = await c.callTool({ name: 'proj_noten', arguments: { clip_id: 'c3' } });
  assert.ok(!r.isError, text(r));
  assert.deepEqual(JSON.parse(text(r)), LESEN);
  assert.deepEqual(gesehen, [{ methode: 'GET', pfad: '/proj/noten?clip_id=c3', quelle: 'cypher', koerper: null }]);
  // an id with special characters is encoded
  await c.callTool({ name: 'proj_noten', arguments: { clip_id: 'a b&c' } });
  assert.equal(gesehen.at(-1).pfad, '/proj/noten?clip_id=a%20b%26c');
});

test('proj_noten: the description names the notes, the render states, every refusal and hint, and proj_aendern for edits', async (t) => {
  const { c } = await aufbau(t, () => null);
  const w = (await c.listTools()).tools.find((x) => x.name === 'proj_noten');
  for (const wort of ['source seconds', 'float MIDI', 'qton', 'proj_aendern', 'audio_noten_aendern',
    'quelle', 'rechnet', 'alt', 'bereit', 'fehler',
    'noten_vorhanden', 'noten_laeuft', 'noten_mehrstimmig', 'noten_fehler', 'noten_zeitlimit', 'noten_programm_fehlt', 'noten_render_fehler', 'noten_kurve_fehlt', 'noten_unbekannt',
    'kein_projekt', 'clip_unbekannt', 'feld_nur_audio', 'audio_fehlt', 'stems_laeuft', 'ki_gestoppt', 'nur_andreas_spur', 'argument_ungueltig', 'argument_unbekannt',
    'kein_auftrag', 'zu_spaet', 'abgebrochen', 'veraltet', 'keine_noten', 'wenig_stimmhaft', 'netz_fehler', 'laeuft', 'auftrag_id', 'DJK_HAND_FRIST_PROJ_NOTEN_MS',
    'More than one note at a time', 'No notes found in this clip.', 'Little pitched sound found']) {
    assert.ok(w.description.includes(wort), `description names ${wort}`);
  }
  assert.ok(!/—/.test(w.description), 'no em dash');
});

test('erkennen posts, waits for fertig and returns the notes; a refusal comes back with its English text', async (t) => {
  let abfragen = 0;
  const stand = (zustand, mehr = {}) => ({ slug: 'p', projekt: {}, kern: {}, noten: { slug: 'p', auftrag_id: 7, clip_id: 'c3', zustand, stufe: 'analyse', prozent: 40, ...mehr } });
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (m === 'POST' && u === '/proj/noten/erkennen') return [200, { auftrag_id: 7 }];
    if (u.startsWith('/proj/aktuell')) { abfragen++; return [200, abfragen < 2 ? stand('laeuft') : stand('fertig', { noten: 2, detektor: 'pyin', sekunden: 3.2 })]; }
    if (u.startsWith('/proj/noten?')) return [200, LESEN];
    return null;
  });
  const r = await c.callTool({ name: 'proj_noten', arguments: { clip_id: 'c3', erkennen: true, neu: true } });
  assert.ok(!r.isError, text(r));
  assert.deepEqual(gesehen[0], { methode: 'POST', pfad: '/proj/noten/erkennen', quelle: 'cypher', koerper: { clip_id: 'c3', neu: true } });
  assert.ok(abfragen >= 2, 'it polled /proj/aktuell until the stand ended');
  const j = JSON.parse(text(r));
  assert.deepEqual(j.noten, NOTEN, 'the note list');
  assert.equal(j.analyse.zustand, 'fertig');
  assert.equal(j.analyse.auftrag_id, 7);
  assert.equal(j.analyse.noten, 2);
  assert.equal(gesehen.at(-1).pfad, '/proj/noten?clip_id=c3');

  // without neu the body carries no neu
  const { c: c2, gesehen: g2 } = await aufbau(t, (m, u) => (u === '/proj/noten/erkennen' ? [200, { auftrag_id: 1 }]
    : u.startsWith('/proj/aktuell') ? [200, { noten: { auftrag_id: 1, clip_id: 'c3', zustand: 'fertig', noten: 0, hinweis: 'keine_noten', text: 'No notes found in this clip.' } }] : [200, { ...LESEN, noten: [] }]));
  const r2 = await c2.callTool({ name: 'proj_noten', arguments: { clip_id: 'c3', erkennen: true } });
  assert.deepEqual(g2[0].koerper, { clip_id: 'c3' });
  assert.equal(JSON.parse(text(r2)).analyse.hinweis, 'keine_noten');

  // a refusal of the POST is a tool error with the reason and its text
  const { c: c3 } = await aufbau(t, () => [409, { fehler: 'noten_vorhanden', text: 'the clip already has notes; send neu: true to detect them again (the edits are lost)', clip_id: 'c3' }]);
  const r3 = await c3.callTool({ name: 'proj_noten', arguments: { clip_id: 'c3', erkennen: true } });
  assert.equal(r3.isError, true);
  assert.equal(JSON.parse(text(r3)).fehler, 'noten_vorhanden');
  assert.match(JSON.parse(text(r3)).text, /send neu: true/);

  // noten_laeuft: the running auftrag_id is not lost
  const { c: c4 } = await aufbau(t, () => [409, { fehler: 'noten_laeuft', text: 'a note detection is already running', auftrag_id: 5 }]);
  const r4 = await c4.callTool({ name: 'proj_noten', arguments: { clip_id: 'c3', erkennen: true } });
  assert.equal(r4.isError, true);
  assert.match(text(r4), /noten_laeuft/);
  assert.match(text(r4), /auftrag_id 5/);

  // a run that ends with a reason (not fertig) comes back as that end stand, without a note read
  const { c: c5, gesehen: g5 } = await aufbau(t, (m, u) => (u === '/proj/noten/erkennen' ? [200, { auftrag_id: 9 }]
    : [200, { noten: { auftrag_id: 9, clip_id: 'c3', zustand: 'fehler', grund: 'noten_mehrstimmig', text: 'More than one note at a time. Separate stems first, then detect notes on a stem.' } }]));
  const r5 = await c5.callTool({ name: 'proj_noten', arguments: { clip_id: 'c3', erkennen: true } });
  assert.deepEqual([JSON.parse(text(r5)).zustand, JSON.parse(text(r5)).grund], ['fehler', 'noten_mehrstimmig']);
  assert.ok(!g5.some((g) => g.pfad.startsWith('/proj/noten?')));
});

test('erkennen past the deadline answers laeuft with the auftrag_id', async (t) => {
  const { c } = await aufbau(t, (m, u) => (u === '/proj/noten/erkennen' ? [200, { auftrag_id: 4 }]
    : [200, { noten: { slug: 'p', auftrag_id: 4, clip_id: 'c3', zustand: 'laeuft', stufe: 'analyse', prozent: 10 } }]), { DJK_HAND_FRIST_PROJ_NOTEN_MS: '600' });
  const r = await c.callTool({ name: 'proj_noten', arguments: { clip_id: 'c3', erkennen: true } });
  assert.ok(!r.isError, text(r));
  const j = JSON.parse(text(r));
  assert.deepEqual([j.zustand, j.auftrag_id], ['laeuft', 4]);
  assert.match(j.text, /goes on/);
});

test('abbrechen posts the auftrag_id', async (t) => {
  const { c, gesehen } = await aufbau(t, () => [200, { auftrag_id: 4, zustand: 'abbrechen' }]);
  const r = await c.callTool({ name: 'proj_noten', arguments: { abbrechen: 4 } });
  assert.ok(!r.isError, text(r));
  assert.deepEqual(gesehen, [{ methode: 'POST', pfad: '/proj/noten/abbrechen', quelle: 'cypher', koerper: { auftrag_id: 4 } }]);
  assert.deepEqual(JSON.parse(text(r)), { auftrag_id: 4, zustand: 'abbrechen' });
  // a refusal (kein_auftrag) is a tool error
  const { c: c2 } = await aufbau(t, () => [404, { fehler: 'kein_auftrag', text: 'no note detection with this id is running' }]);
  const r2 = await c2.callTool({ name: 'proj_noten', arguments: { abbrechen: 99 } });
  assert.equal(r2.isError, true);
  assert.match(text(r2), /kein_auftrag/);
});

test('proj_noten: wrong argument combinations are refused before any request', async (t) => {
  const { c, gesehen } = await aufbau(t, () => null);
  for (const args of [{}, { clip_id: 'c3', neu: true }, { clip_id: 'c3', erkennen: true, abbrechen: 1 }, { clip_id: '' }, { clip_id: 'c3', erkennen: false, neu: true }]) {
    const r = await c.callTool({ name: 'proj_noten', arguments: args });
    assert.equal(r.isError, true, JSON.stringify(args));
    assert.equal(JSON.parse(text(r)).fehler, 'argument_ungueltig', JSON.stringify(args));
  }
  assert.equal(gesehen.length, 0);
});
