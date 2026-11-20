// Tracker task 9: the hand tool `tracker` forwards each action to the tracker routes or to /proj/aendern (stand-in HTTP server).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');

async function verbinde(t) {
  const gesehen = [];
  const s = http.createServer((q, a) => {
    let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => {
      gesehen.push({ methode: q.method, pfad: q.url, koerper: b ? JSON.parse(b) : null });
      a.writeHead(200, { 'content-type': 'application/json' });
      a.end(JSON.stringify(q.url.startsWith('/proj/aktuell') ? { rev: 7 } : { ok: true, text: 'section 00' }));
    });
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  return { c, gesehen, rufe: (a) => c.callTool({ name: 'tracker', arguments: a }) };
}
const ohneRev = (g) => g.filter((x) => !x.pfad.startsWith('/proj/aktuell'));

test('tracker: schema lists the actions, the description explains the grammar', async (t) => {
  const { c } = await verbinde(t);
  const x = (await c.listTools()).tools.find((y) => y.name === 'tracker');
  assert.deepEqual(x.inputSchema.properties.aktion.enum, ['song', 'lesen', 'schreiben', 'import_mod', 'abschnitt_neu', 'abschnitt_duplizieren', 'abschnitt_loeschen',
    'abschnitt_verschieben', 'abschnitt_laenge', 'abschnitt_umbenennen']);
  assert.deepEqual(x.inputSchema.required, ['aktion']);
  for (const w of ['NOTE VOL DLY CHN RPT', '===', 'K01', '~~~', 'from', 'one undo step', 'argument_ungueltig', 'ohne_aenderung']) {
    assert.ok(x.description.includes(w), `description names ${w}`);
  }
});

test('song and lesen read through GET /tracker/song and GET /tracker/text', async (t) => {
  const { gesehen, rufe } = await verbinde(t);
  await rufe({ aktion: 'song' });
  await rufe({ aktion: 'lesen', abschnitt: 'a2' });
  await rufe({ aktion: 'lesen', abschnitt: 'a1', von: 4, bis: 7, spuren: 'A,B' });
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad]), [['GET', '/tracker/song'], ['GET', '/tracker/text?abschnitt=a2'],
    ['GET', '/tracker/text?abschnitt=a1&von=4&bis=7&spuren=A%2CB']]);
});

test('schreiben posts the text with the current rev (one write)', async (t) => {
  const { gesehen, rufe } = await verbinde(t);
  await rufe({ aktion: 'schreiben', text: 'section 00 ""  rows 64  lpb 4  ticks 6\nrow | A x\n' });
  await rufe({ aktion: 'schreiben', text: 'x', rev: 3 });
  assert.deepEqual(ohneRev(gesehen).map((g) => [g.methode, g.pfad, g.koerper]), [
    ['POST', '/tracker/text?antwort=kurz', { text: 'section 00 ""  rows 64  lpb 4  ticks 6\nrow | A x\n', rev: 7 }],
    ['POST', '/tracker/text?antwort=kurz', { text: 'x', rev: 3 }]]);
});

test('each section action is a one-command list to /proj/aendern', async (t) => {
  const { gesehen, rufe } = await verbinde(t);
  await rufe({ aktion: 'abschnitt_neu', nach: 'a1', zeilen: 32, name: 'drop' });
  await rufe({ aktion: 'abschnitt_neu' });
  await rufe({ aktion: 'abschnitt_duplizieren', id: 'a1', als: 'verknuepft' });
  await rufe({ aktion: 'abschnitt_loeschen', id: 'a2' });
  await rufe({ aktion: 'abschnitt_verschieben', id: 'a2', richtung: -1 });
  await rufe({ aktion: 'abschnitt_laenge', id: 'a1', zeilen: 48 });
  await rufe({ aktion: 'abschnitt_umbenennen', id: 'a1', name: null });
  const b = ohneRev(gesehen).map((g) => { assert.deepEqual([g.methode, g.pfad], ['POST', '/proj/aendern?antwort=kurz']); assert.equal(g.koerper.rev, 7);
    assert.equal(g.koerper.befehle.length, 1); assert.equal(typeof g.koerper.label, 'string'); return g.koerper.befehle[0]; });
  assert.deepEqual(b, [
    { befehl: 'abschnitt_neu', nach: 'a1', zeilen: 32, name: 'drop' }, { befehl: 'abschnitt_neu' },
    { befehl: 'abschnitt_duplizieren', id: 'a1', als: 'verknuepft' }, { befehl: 'abschnitt_loeschen', id: 'a2' },
    { befehl: 'abschnitt_verschieben', id: 'a2', richtung: -1 }, { befehl: 'abschnitt_laenge', id: 'a1', zeilen: 48 },
    { befehl: 'abschnitt_umbenennen', id: 'a1', name: null }]);
});

test('missing arguments are refused by the tool without a request', async (t) => {
  const { gesehen, rufe } = await verbinde(t);
  for (const a of [{ aktion: 'lesen' }, { aktion: 'schreiben' }, { aktion: 'abschnitt_loeschen' }, { aktion: 'abschnitt_duplizieren', id: 'a1' },
    { aktion: 'abschnitt_verschieben', id: 'a1' }, { aktion: 'abschnitt_laenge', id: 'a1' }, { aktion: 'abschnitt_umbenennen', id: 'a1' }, { aktion: 'nope' }]) {
    const r = await rufe(a);
    assert.match(JSON.stringify(r.content), /argument_ungueltig/, JSON.stringify(a));
  }
  assert.equal(gesehen.length, 0);
});

test('the description of the tracker tool: effect and knob values 00..FF, VOL 01..7F, the effect codes with their units, the hidden head and the note off rule', async (t) => {
  const { c } = await verbinde(t);
  const d = (await c.listTools()).tools.find((x) => x.name === 'tracker').description;
  assert.match(d, /VOL is hex 01\.\.7F; the effect and knob values are hex 00\.\.FF/);
  assert.ok(!d.includes('(00..7F)'));
  for (const code of ['ARP xy', 'SLU xx', 'SLD xx', 'GLD xx', 'VIB xy', 'TRM xy', 'VSL xy', 'LVL xx', 'RTG 0y', 'PAN xx', 'OFS xx', 'REV 01']) assert.ok(d.includes(code), code);
  assert.match(d, /"VIB 46"/);
  assert.match(d, /note off where no note sounds/);
  assert.match(d, /hidden: <letter> <n>/);
});
