// Coverage of the project commands by the hand (routing 1.10, open flank, "every project command has a hand path with a description text").
// Every command of the project API (ui/project/commands.ts, BEFEHL_NAMEN) reaches Cypher through the tool proj_aendern as a verb
// `<befehl> {args}`. The test reads the description the MCP client really gets (listTools) and checks, per command:
//   1. the verb is listed with an argument block `<befehl> {` and carries a description text (a parenthesis of at least 8 characters, not only the bare block),
//   2. every argument the handler declares with erlaube(a, ...) appears in that verb's text (an accepted argument the hand does not name is a gap).
// The check is a pure function over (verbs, source, description) so that the mutation tests can feed it a damaged description.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { BEFEHL_NAMEN } from '../../ui/project/commands.ts';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const HAND = path.resolve(HIER, '..', 'hand.ts');
const QUELLE = fs.readFileSync(path.resolve(HIER, '..', '..', 'ui', 'project', 'commands.ts'), 'utf8');

// Arguments a handler accepts, from its erlaube(a, 'x', 'y') calls (a call may span lines). Handlers without erlaube yield an empty list.
export function deklarierteArgumente(quelle, befehl) {
  const k = quelle.indexOf('const PRO_BEFEHL');
  const start = quelle.search(new RegExp(`^  ${befehl}\\(`, 'm'));
  if (k < 0 || start < k) throw new Error(`handler ${befehl} not found in PRO_BEFEHL`);
  const rest = quelle.slice(start + 1);
  const ende = rest.search(/^  [a-z_0-9]+\(/m);
  const body = ende < 0 ? rest : rest.slice(0, ende);
  const aus = new Set();
  for (const m of body.matchAll(/erlaube\(a,([^)]*)\)/g)) for (const x of m[1].matchAll(/'([a-z_0-9]+)'/g)) aus.add(x[1]);
  return [...aus];
}

// The text of each verb: from `<verb> {` to the start of the next listed verb
function abschnitte(namen, beschreibung) {
  const pos = namen.map((n) => [n, beschreibung.search(new RegExp(`(^|[^a-z_0-9])${n} \\{`))]).filter(([, p]) => p >= 0).sort((a, b) => a[1] - b[1]);
  const aus = new Map();
  pos.forEach(([n, p], i) => aus.set(n, beschreibung.slice(p, i + 1 < pos.length ? pos[i + 1][1] : beschreibung.length)));
  return aus;
}

export function luecken(namen, quelle, beschreibung) {
  const fehl = [];
  const text = abschnitte(namen, beschreibung);
  for (const n of namen) {
    const t = text.get(n);
    if (!t) { fehl.push(`${n}: not listed as "${n} {" in proj_aendern`); continue; }
    if (!/\([^)]{8,}\)/.test(t)) fehl.push(`${n}: no description text (only the argument block)`);
    for (const a of deklarierteArgumente(quelle, n)) {
      if (!new RegExp(`(^|[^a-z_0-9])${a}([^a-z_0-9]|$)`).test(t)) fehl.push(`${n}: argument ${a} is accepted by the server but not named`);
    }
  }
  return fehl;
}

async function beschreibungVonProjAendern(t) {
  const s = http.createServer((q, a) => { a.writeHead(404); a.end('{}'); });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  const tool = (await c.listTools()).tools.find((x) => x.name === 'proj_aendern');
  assert.ok(tool, 'the tool proj_aendern exists');
  return tool.description;
}

test('every project command has a verb with description text in proj_aendern, and every accepted argument is named', async (t) => {
  const beschreibung = await beschreibungVonProjAendern(t);
  assert.ok(BEFEHL_NAMEN.length >= 40, `the command list is read (${BEFEHL_NAMEN.length} commands)`);
  assert.ok(BEFEHL_NAMEN.includes('comp_waehlen') && BEFEHL_NAMEN.includes('send_setzen'), 'a command of the newest slices is in the list');
  assert.deepEqual(luecken(BEFEHL_NAMEN, QUELLE, beschreibung), []);
});

test('the argument extraction finds arguments (positive control: it must hit, or an empty result would mean nothing)', () => {
  assert.ok(deklarierteArgumente(QUELLE, 'send_setzen').includes('return_id'));
  assert.ok(deklarierteArgumente(QUELLE, 'clip_aendern').includes('entstehung'), 'a multi-line erlaube call is read to its end');
  assert.ok(deklarierteArgumente(QUELLE, 'clip_neu').includes('pfad_hinweis'));
  assert.ok(deklarierteArgumente(QUELLE, 'spur_aendern').length >= 10);
});

test('mutations: a verb missing from the description, an unnamed argument and a verb without text are each found', async (t) => {
  const beschreibung = await beschreibungVonProjAendern(t);
  // 1. the verb comp_waehlen is renamed in the description: not listed
  const m1 = beschreibung.replace('comp_waehlen {', 'comp_waehle {');
  assert.ok(m1 !== beschreibung);
  assert.ok(luecken(BEFEHL_NAMEN, QUELLE, m1).some((f) => /^comp_waehlen: not listed/.test(f)), 'missing verb found');
  // 2. an accepted argument is removed from its verb text (return_id of send_setzen)
  const i = beschreibung.indexOf('send_setzen {'), j = beschreibung.indexOf('return_id', i);
  const m2 = beschreibung.slice(0, j) + 'xxxxxxxxx' + beschreibung.slice(j + 'return_id'.length);
  assert.ok(luecken(BEFEHL_NAMEN, QUELLE, m2).some((f) => /^send_setzen: argument return_id/.test(f)), 'unnamed argument found');
  // 3. the argument of pfad_hinweis (fixed in this change) is found again when it is cut out
  const m3 = beschreibung.replace(/pfad_hinweis\?/g, 'hinweis?');
  assert.ok(luecken(BEFEHL_NAMEN, QUELLE, m3).some((f) => /^clip_neu: argument pfad_hinweis/.test(f)), 'the fixed gap would be found again');
  // 4. a verb with only its argument block (the state of ten verbs before this change) has no description text
  const m4 = beschreibung.replace(/clip_loeschen \{clip_id\} \([^)]*\)/, 'clip_loeschen {clip_id}');
  assert.ok(m4 !== beschreibung);
  assert.ok(luecken(BEFEHL_NAMEN, QUELLE, m4).some((f) => /^clip_loeschen: no description text/.test(f)), 'a verb without text found');
});

// Plan live-module task 4: the hand tools of the live modules call the page server's routes with the arguments (recording stand-in server).
// Cypher can never confirm opening the live container (no bestaetigt argument): live_oeffnen posts an empty body.
test('live module hand tools: modul_export, modul_leeren, modul_stems, modul_stand and live_oeffnen call their routes with the arguments and source cypher', async (t) => {
  const gesehen = [];
  const s = http.createServer((q, a) => {
    let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => {
      gesehen.push({ methode: q.method, pfad: q.url, quelle: q.headers['x-djk-quelle'], koerper: b ? JSON.parse(b) : null });
      a.writeHead(200, { 'content-type': 'application/json' }); a.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  const tools = (await c.listTools()).tools;
  const namen = ['modul_export', 'modul_leeren', 'modul_stems', 'modul_stand', 'live_oeffnen'];
  for (const n of namen) {
    const x = tools.find((y) => y.name === n);
    assert.ok(x, `the tool ${n} exists`);
    assert.ok(x.description.length > 80, `${n} has a description text`);
  }
  assert.deepEqual(tools.find((y) => y.name === 'modul_export').inputSchema.required, ['deck']);
  assert.deepEqual(tools.find((y) => y.name === 'modul_leeren').inputSchema.required.sort(), ['slot', 'takte']);
  await c.callTool({ name: 'modul_export', arguments: { deck: 3, slot: 'B' } });
  await c.callTool({ name: 'modul_export', arguments: { deck: 3 } });
  await c.callTool({ name: 'modul_leeren', arguments: { slot: 'A', takte: 8 } });
  await c.callTool({ name: 'modul_stems', arguments: { slot: 'B' } });
  await c.callTool({ name: 'modul_stand', arguments: {} });
  await c.callTool({ name: 'live_oeffnen', arguments: { bestaetigt: true } });
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad, g.koerper]), [
    ['POST', '/modul/export', { deck: 3, slot: 'B' }],
    ['POST', '/modul/export', { deck: 3 }],
    ['POST', '/modul/leeren', { slot: 'A', takte: 8 }],
    ['POST', '/modul/stems', { slot: 'B' }],
    ['GET', '/modul/stand', null],
    ['POST', '/live/oeffnen', {}],
  ]);
  assert.ok(gesehen.every((g) => g.quelle === 'cypher'));
});
