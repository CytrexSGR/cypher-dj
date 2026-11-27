// Slice 6 task 6.1: `lage`/`warte` with kurz and felder, `pegel` with nur_hoerbar, against a fake page server.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');

async function verbinde(t, stand) {
  const s = http.createServer((q, a) => {
    q.resume();
    let j = { ok: true };
    if (q.url === '/lage') { stand.lage.uhr.beat += stand.schritt ?? 0; j = stand.lage; }
    else if (q.url.startsWith('/pegel')) j = stand.pegel;
    a.writeHead(200, { 'content-type': 'application/json' }); a.end(JSON.stringify(j));
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  return c;
}
const rufe = async (c, name, args = {}) => JSON.parse((await c.callTool({ name, arguments: args })).content[0].text);
const neueLage = () => ({ uhr: { beat: 10, takt: 3, schlag: 3, bpm: 124 }, ki: { gestoppt: false }, regler: { 'deck/1/fader': -6, 'erz/2/fader': -3 }, fx: { a: 1 }, quittungen: [{ id: 1 }] });

test('two lage kurz calls: the second carries only the changed fader', async (t) => {
  const stand = { lage: neueLage() };
  const c = await verbinde(t, stand);
  const erste = await rufe(c, 'lage', { kurz: true });
  assert.ok(erste.regler && erste.fx, 'first kurz call returns everything');
  stand.lage.regler['deck/1/fader'] = -12;
  stand.lage.quittungen.push({ id: 2 });
  const zweite = await rufe(c, 'lage', { kurz: true });
  assert.deepEqual(zweite.geaendert, { 'regler.deck/1/fader': -12 });
  assert.deepEqual(zweite.entfernt, []);
  assert.deepEqual(zweite.spuren, ['deck/1']);
  assert.deepEqual(zweite.quittungen_neu, [{ id: 2 }]);
  assert.equal(zweite.uhr.bpm, 124);
  delete stand.lage.regler['erz/2/fader'];
  const dritte = await rufe(c, 'lage', { kurz: true });
  assert.deepEqual(dritte.entfernt, ['regler.erz/2/fader']);
  assert.deepEqual(dritte.quittungen_neu, []);
});

test('felder keeps uhr and the named keys only; default stays whole', async (t) => {
  const c = await verbinde(t, { lage: neueLage() });
  const f = await rufe(c, 'lage', { felder: ['regler'] });
  assert.deepEqual(Object.keys(f).sort(), ['regler', 'uhr']);
  assert.deepEqual(Object.keys(await rufe(c, 'lage')).sort(), ['fx', 'ki', 'quittungen', 'regler', 'uhr']);
});

test('warte kurz diffs against the last answer of the hand, not against its inner polls', async (t) => {
  const stand = { lage: neueLage(), schritt: 8 };
  const c = await verbinde(t, stand);
  await rufe(c, 'lage', { kurz: true });
  stand.lage.regler['deck/1/fader'] = -20;
  const w = await rufe(c, 'warte', { takte: 1, kurz: true });
  assert.deepEqual(w.geaendert, { 'regler.deck/1/fader': -20 });
  assert.ok(w.uhr.beat >= 14);
});

test('pegel nur_hoerbar drops a -200 channel', async (t) => {
  const pegel = { sek: 3, kanaele: { master: { n: 5, max_db: -12, median_db: -14 }, 'erz/3': { n: 5, max_db: -200, median_db: null } } };
  const c = await verbinde(t, { lage: neueLage(), pegel });
  assert.deepEqual(Object.keys((await rufe(c, 'pegel')).kanaele), ['master', 'erz/3']);
  assert.deepEqual(Object.keys((await rufe(c, 'pegel', { nur_hoerbar: true })).kanaele), ['master']);
});
