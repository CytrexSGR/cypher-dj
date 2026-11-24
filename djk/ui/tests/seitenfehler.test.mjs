// R7: the rotating page error file and the POST /seite/fehler route.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Seitenfehler } from '../seitenfehler.ts';
import { echterServer, hol } from './support/echter_server.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sf-'));
const zeilen = (o) => fs.readFileSync(path.join(o, 'seitenfehler.jsonl'), 'utf8').trim().split('\n').map((z) => JSON.parse(z));
const eintrag = (m = 'boom') => ({ meldung: m, datei: 'app.js', zeile: 3, spalte: 4, ansicht: 'dj', zeit: '2026-01-01T00:00:00Z' });

test('a valid entry lands as one line with server_zeit', () => {
  const o = tmp(); const s = new Seitenfehler(o);
  assert.deepEqual(s.schreibe(eintrag()), { ok: true });
  const z = zeilen(o);
  assert.equal(z.length, 1);
  assert.equal(z[0].meldung, 'boom'); assert.equal(z[0].zeile, 3); assert.ok(z[0].server_zeit);
});

test('the 51st entry in a minute is refused and writes nothing; accepted again after the minute', () => {
  const o = tmp(); let t = 1_000_000; const s = new Seitenfehler(o, { jetzt: () => t });
  for (let i = 0; i < 50; i++) assert.equal(s.schreibe(eintrag()).ok, true);
  assert.deepEqual(s.schreibe(eintrag('x')), { ok: false, grund: 'zu_viele' });
  assert.equal(zeilen(o).length, 50);
  t += 60_001;
  assert.equal(s.schreibe(eintrag()).ok, true);
  assert.equal(zeilen(o).length, 51);
});

test('rotation keeps at most two files', () => {
  const o = tmp(); const s = new Seitenfehler(o, { maxBytes: 600, proMinute: 1000 });
  for (let i = 0; i < 40; i++) s.schreibe(eintrag('m' + i));
  const dateien = fs.readdirSync(o).filter((f) => f.startsWith('seitenfehler')).sort();
  assert.deepEqual(dateien, ['seitenfehler.jsonl', 'seitenfehler.jsonl.1']);
  assert.ok(fs.statSync(path.join(o, 'seitenfehler.jsonl')).size <= 600);
});

test('invalid bodies are refused and write nothing', () => {
  const o = tmp(); const s = new Seitenfehler(o);
  for (const v of ['text', null, [1], 5, { meldung: 5 }, {}]) assert.deepEqual(s.schreibe(v), { ok: false, grund: 'ungueltig' });
  assert.equal(fs.existsSync(path.join(o, 'seitenfehler.jsonl')), false);
});

test('a 1 MB message is stored truncated to 500', () => {
  const o = tmp(); const s = new Seitenfehler(o);
  s.schreibe(eintrag('a'.repeat(1 << 20)));
  assert.equal(zeilen(o)[0].meldung.length, 500);
});

test('an unwritable folder drops the entry without throwing', () => {
  const o = tmp(); const datei = path.join(o, 'frei'); fs.writeFileSync(datei, 'x');
  const s = new Seitenfehler(path.join(datei, 'unter'));
  assert.doesNotThrow(() => s.schreibe(eintrag()));
});

test('over HTTP: text/plain 415, foreign origin 403, page origin 200, bad body 400', async (t) => {
  const { url, o } = await echterServer(t, 'sf');
  const post = (kopf, body) => hol(`${url}/seite/fehler`, { method: 'POST', headers: kopf, body });
  assert.equal((await post({ 'content-type': 'text/plain' }, '{}')).status, 415);
  assert.equal((await post({ 'content-type': 'application/json', origin: 'http://evil.example' }, JSON.stringify(eintrag()))).status, 403);
  assert.equal((await post({ 'content-type': 'application/json', origin: url }, JSON.stringify(eintrag()))).status, 200);
  assert.equal((await post({ 'content-type': 'application/json', origin: url }, 'not json')).status, 400);
  assert.equal((await post({ 'content-type': 'application/json', origin: url }, JSON.stringify({ meldung: 'x'.repeat(200000) }))).status, 400);
  const datei = path.join(o.opt.hotcueOrdner, 'seitenfehler.jsonl');
  assert.equal(fs.readFileSync(datei, 'utf8').trim().split('\n').length, 1);
});

test('rotation counts bytes: multibyte entries rotate at the byte limit, not the character limit', () => {
  const o = tmp(); const s = new Seitenfehler(o, { maxBytes: 1200 });
  const m = '\u00fc'.repeat(250);   // 500 bytes per entry in the message alone
  for (let i = 0; i < 6; i++) s.schreibe(eintrag(m));
  const groesse = fs.statSync(path.join(o, 'seitenfehler.jsonl')).size;
  assert.ok(groesse <= 1200, `current file is ${groesse} bytes`);
  assert.ok(fs.existsSync(path.join(o, 'seitenfehler.jsonl.1')));
});
