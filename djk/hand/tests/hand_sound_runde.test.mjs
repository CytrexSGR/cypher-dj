// FIND SOUND, part 1: the hand tool klang_runde talks to the /proj/klang/* routes of a stub page server that records every request.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');

async function verbinde(t, antwort) {
  const gesehen = [];
  const s = http.createServer((q, a) => {
    let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => {
      const e = { methode: q.method, pfad: q.url, koerper: b ? JSON.parse(b) : null, quelle: q.headers['x-djk-quelle'] };
      gesehen.push(e);
      const [code, j] = antwort(e);
      a.writeHead(code, { 'content-type': 'application/json' }); a.end(JSON.stringify(j));
    });
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  return { c, gesehen };
}
const runde = (c, args) => c.callTool({ name: 'klang_runde', arguments: args });
const antwort = (r) => JSON.parse(r.content[0].text);
const LAGE = (zustand, extra = {}) => ({ runde: 3, spur_id: 's1', spur_name: 'Bass', graph: 'bass', rev: 7, zustand, schritt: 'normal', von_beat: 0, bis_beat: 16,
  fortschritt: { gemessen: 0, hoechstens: 8 }, aktiv: 'A', plaetze: [], stammbaum: null, weg: [], zurueck_moeglich: false, ...extra });
const PLAN = { weg: 'proj', rev: 7, label: 'Find sound: brighter · Cutoff 420 → 610', befehle: [{ befehl: 'geraet_param_setzen', spur_id: 's1', param: 'k1', wert: 0.6 }] };

test('start waits for the end of measuring and answers the state', async (t) => {
  let n = 0;
  const { c, gesehen } = await verbinde(t, (e) => {
    if (e.methode === 'POST' && e.pfad === '/proj/klang/runde') return [200, LAGE('misst')];
    if (e.methode === 'GET' && e.pfad === '/proj/klang/runde') return [200, ++n < 2 ? LAGE('misst') : LAGE('fertig', { fortschritt: { gemessen: 6, hoechstens: 6 } })];
    return [404, { fehler: 'unerwartet', text: e.pfad }];
  });
  const r = await runde(c, { aktion: 'start', spur_id: 's1', schritt: 'fein' });
  assert.ok(!r.isError, r.content[0].text.slice(0, 300));
  assert.equal(antwort(r).zustand, 'fertig');
  assert.equal(antwort(r).fortschritt.gemessen, 6);
  assert.deepEqual(gesehen[0], { methode: 'POST', pfad: '/proj/klang/runde', koerper: { spur_id: 's1', schritt: 'fein' }, quelle: 'cypher' });
  assert.ok(gesehen.length >= 3 && gesehen.slice(1).every((e) => e.methode === 'GET' && e.pfad === '/proj/klang/runde'));
});

test('start without a schritt sends only the track; a state that is not measuring is answered at once', async (t) => {
  const { c, gesehen } = await verbinde(t, (e) => [200, LAGE(e.methode === 'POST' ? 'fehler' : 'fertig', { grund: 'spur_still', text: 'the track is silent' })]);
  const a = antwort(await runde(c, { aktion: 'start', spur_id: 's1' }));
  assert.deepEqual(gesehen[0].koerper, { spur_id: 's1' });
  assert.equal(gesehen.length, 1);
  assert.equal(a.zustand, 'fehler');
  assert.equal(a.grund, 'spur_still');
});

test('lage reads, hoeren and ende post', async (t) => {
  const { c, gesehen } = await verbinde(t, (e) => [200, e.pfad === '/proj/klang/ende' ? { ok: true } : LAGE('fertig', { aktiv: 'B' })]);
  assert.equal(antwort(await runde(c, { aktion: 'lage' })).aktiv, 'B');
  assert.equal(antwort(await runde(c, { aktion: 'hoeren', platz: 'B', runde: 1 })).aktiv, 'B');
  assert.deepEqual(antwort(await runde(c, { aktion: 'ende' })), { ok: true });
  assert.deepEqual(gesehen.map((e) => [e.methode, e.pfad, e.koerper]), [
    ['GET', '/proj/klang/runde', null], ['POST', '/proj/klang/hoeren', { platz: 'B', runde: 1 }], ['POST', '/proj/klang/ende', {}]]);
});

test('hoeren passes vergleich, a non-boolean is refused without a request', async (t) => {
  const { c, gesehen } = await verbinde(t, () => [200, LAGE('fertig', { aktiv: 'B' })]);
  await runde(c, { aktion: 'hoeren', platz: 'B', runde: 3, vergleich: true });
  await runde(c, { aktion: 'hoeren', platz: 'B', runde: 3, vergleich: false });
  assert.deepEqual(gesehen.map((e) => e.koerper), [{ platz: 'B', runde: 3, vergleich: true }, { platz: 'B', runde: 3, vergleich: false }]);
  const r = await runde(c, { aktion: 'hoeren', platz: 'B', runde: 3, vergleich: 'ja' });
  assert.equal(r.isError, true);
  assert.equal(gesehen.length, 2);
});

test('waehlen sends the plan with the open rev', async (t) => {
  const { c, gesehen } = await verbinde(t, (e) => (e.pfad === '/proj/klang/waehlen' ? [200, PLAN] : [200, { rev: 8, label: PLAN.label }]));
  const r = await runde(c, { aktion: 'waehlen', platz: 'C', runde: 1 });
  assert.ok(!r.isError, r.content[0].text.slice(0, 300));
  assert.deepEqual(gesehen.map((e) => [e.methode, e.pfad.split('?')[0]]), [['POST', '/proj/klang/waehlen'], ['POST', '/proj/aendern']]);
  assert.deepEqual(gesehen[0].koerper, { platz: 'C', runde: 1 });
  assert.equal(gesehen[1].quelle, 'cypher');
  assert.deepEqual(gesehen[1].koerper, { rev: 7, label: PLAN.label, befehle: PLAN.befehle });
  assert.deepEqual(antwort(r), { label: PLAN.label, rev: 8 });
});

test('zurueck with a node', async (t) => {
  const { c, gesehen } = await verbinde(t, (e) => (e.pfad === '/proj/klang/zurueck' ? [200, { ...PLAN, label: 'Find sound: back to start' }] : [200, { rev: 9 }]));
  const a = antwort(await runde(c, { aktion: 'zurueck', knoten: 'n1', runde: 1 }));
  assert.deepEqual(gesehen[0].koerper, { knoten: 'n1', runde: 1 });
  assert.equal(gesehen[1].pfad.split('?')[0], '/proj/aendern');
  assert.deepEqual(a, { label: 'Find sound: back to start', rev: 9 });
  await runde(c, { aktion: 'zurueck', runde: 1 });
  assert.deepEqual(gesehen[2].koerper, { runde: 1 });
});

test('missing arguments are refused without a request', async (t) => {
  const { c, gesehen } = await verbinde(t, () => [200, {}]);
  for (const args of [{ aktion: 'start' }, { aktion: 'hoeren' }, { aktion: 'waehlen' }, { aktion: 'hoeren', platz: 'A', schritt: 'x' }, { aktion: 'hoeren', platz: 'A' }, { aktion: 'waehlen', platz: 'B' }, { aktion: 'zurueck' }, { aktion: 'start', spur_id: 's1', schritt: 'riesig' },
    { aktion: 'waehlen', platz: 'Z' }]) {
    const r = await runde(c, args);
    assert.equal(r.isError, true, JSON.stringify(args));
    assert.match(r.content[0].text, /argument_ungueltig/);
  }
  assert.equal(gesehen.length, 0);
});

test('the refusal of the page server is passed on, for the plan and for the write', async (t) => {
  const a1 = await verbinde(t, () => [409, { fehler: 'runde_veraltet', text: 'the round is stale' }]);
  const r1 = await runde(a1.c, { aktion: 'waehlen', platz: 'B', runde: 1 });
  assert.equal(r1.isError, true);
  assert.match(r1.content[0].text, /runde_veraltet/);
  assert.equal(a1.gesehen.length, 1);
  const a2 = await verbinde(t, (e) => (e.pfad === '/proj/klang/zurueck' ? [200, PLAN] : [409, { fehler: 'rev_veraltet', text: 'the project moved on' }]));
  const r2 = await runde(a2.c, { aktion: 'zurueck', runde: 1 });
  assert.equal(r2.isError, true);
  assert.match(r2.content[0].text, /rev_veraltet/);
  const a3 = await verbinde(t, () => [404, { fehler: 'keine_runde', text: 'no round' }]);
  const r3 = await runde(a3.c, { aktion: 'lage' });
  assert.equal(r3.isError, true);
  assert.match(r3.content[0].text, /keine_runde/);
});

test('the schema and the description', async (t) => {
  const { c } = await verbinde(t, () => [200, {}]);
  const x = (await c.listTools()).tools.find((y) => y.name === 'klang_runde');
  assert.ok(x, 'klang_runde is listed');
  assert.deepEqual(x.inputSchema.required, ['aktion']);
  assert.deepEqual(x.inputSchema.properties.aktion.enum, ['start', 'lage', 'hoeren', 'waehlen', 'zurueck', 'ende']);
  assert.deepEqual(Object.keys(x.inputSchema.properties).sort(), ['aktion', 'knoten', 'platz', 'runde', 'schritt', 'spur_id', 'vergleich']);
  assert.equal(x.inputSchema.properties.vergleich.type, 'boolean', 'vergleich is a boolean');
  assert.deepEqual(x.inputSchema.properties.platz.enum, ['A', 'B', 'C', 'D']);
  assert.deepEqual(x.inputSchema.properties.schritt.enum, ['fein', 'normal', 'grob']);
  for (const wort of ['Baukasten', 'does not write the project', 'one undo step', 'measured', 'listen', 'places', 'runde_veraltet', 'keine_runde', 'subtle', 'clear', 'strong', 'COMPARE', 'vergleich_steht', '30 s']) {
    assert.ok(x.description.includes(wort), `the description names ${wort}`);
  }
});

test('the tool count is 99', async (t) => {
  const { c } = await verbinde(t, () => [200, {}]);
  assert.equal((await c.listTools()).tools.length, 99);
  assert.equal(fs.readFileSync(HAND, 'utf8').split('\n').filter((z) => z.startsWith("  { name: '")).length, 99);
});
