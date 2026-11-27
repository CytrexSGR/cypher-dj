// Slice 7 task 7.2: `mischung` pure functions and one run against a fake page server.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mittle, zielAufTerz, gegenZiel, chroma, tonartPasst, parseTonart, urteil } from '../mischung.ts';
import { TERZ_HZ, ZWOELFTEL_HZ, terzVon } from '../../ui/project/sound_contract.ts';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HAND = path.join(DIR, 'hand.ts');
const ZIELE = JSON.parse(fs.readFileSync(path.join(DIR, 'mischung_ziele.json'), 'utf8'));
const flach = (d = -40) => new Array(120).fill(d);

test('target file is marked rough and has the six genres', () => {
  assert.equal(ZIELE.grob, true);
  assert.deepEqual(Object.keys(ZIELE.ziele).sort(), ['deep_house', 'dub', 'house', 'minimal', 'techno', 'techstep']);
  for (const w of Object.values(ZIELE.ziele)) assert.equal(w.length, ZIELE.anker_hz.length);
});

test('a 440 Hz peak gives the chroma maximum at A', () => {
  const db = flach(-120);
  db[53] = -6;   // band 53 = A4 = 440 Hz
  assert.ok(Math.abs(ZWOELFTEL_HZ[53] - 440) < 1e-9);
  const c = chroma(db);
  assert.equal(c.indexOf(Math.max(...c)), 9);
  assert.ok(Math.abs(c.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('a flat spectrum against techno reports bass under', () => {
  const terz = terzVon(flach(-40));
  const g = gegenZiel(terz, zielAufTerz(ZIELE.anker_hz, ZIELE.ziele.techno));
  assert.ok(g.regionen.bass < -3, `bass ${g.regionen.bass}`);
  assert.ok(g.regionen.luft > 3, `luft ${g.regionen.luft}`);
  assert.match(urteil({ peak_db: -6, regionen: g.regionen, ziel: 'techno' }), /bass under by/);
});

test('urteil names a hot peak, and a weak key', () => {
  assert.match(urteil({ peak_db: -0.2, regionen: {} }), /peak too hot/);
  assert.equal(urteil({ peak_db: -3, regionen: { bass: 1 } }), 'ok');
  assert.match(urteil({ peak_db: -3, regionen: {}, tonart: { name: 'Am', passt: 0.3 } }), /key Am does not show/);
});

test('key names parse and the key match tells A minor from F# major', () => {
  assert.deepEqual(parseTonart('8A'), { tonika: 9, moll: true });
  assert.deepEqual(parseTonart('C# minor'), { tonika: 1, moll: true });
  assert.deepEqual(parseTonart('F#'), { tonika: 6, moll: false });
  assert.equal(parseTonart('nonsense'), null);
  const c = new Array(12).fill(0.01);
  for (const pc of [9, 0, 4]) c[pc] = 0.3;   // A C E
  assert.ok(tonartPasst(c, 'Am').passt > 0.7);
  assert.ok(tonartPasst(c, 'F#').passt < 0.5);
  assert.deepEqual(tonartPasst(c, '8A').staerkste.sort(), ['A', 'C', 'E']);
});

test('mittle is a power mean', () => {
  const m = mittle([[-10, -200], [-10, -20]]);
  assert.ok(Math.abs(m[0] + 10) < 1e-9);
  assert.ok(Math.abs(m[1] - (10 * Math.log10(0.5 * 0.01))) < 1e-9);
});

test('fake server: 8 samples, 2 steht, averages 6', async (t) => {
  let k = 0;
  const s = http.createServer((q, a) => {
    q.resume();
    let j = { ok: true };
    if (q.url === '/lage') j = { uhr: { beat: 1, bpm: 240 }, decks: [{ deck: 1, status: 2, camelot: '8A' }] };
    else if (q.url === '/analyse/pegel') j = { leer: false, lufs_s: -12, tp_max_dbtp: -0.5 };
    else if (q.url === '/analyse/live') {
      const i = k++;
      const steht = i === 2 || i === 5;
      const db = flach(-120); db[53] = -6;
      j = { leer: false, w: i, steht, stumm: false, spektrum: { hz: [...ZWOELFTEL_HZ], db }, stereo: { korrelation: 0.8 }, true_peak_dbtp: -3, lufs_m: -14 };
    }
    a.writeHead(200, { 'content-type': 'application/json' }); a.end(JSON.stringify(j));
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  const r = JSON.parse((await c.callTool({ name: 'mischung', arguments: { takte: 4, ziel: 'techno' } })).content[0].text);
  assert.equal(r.proben, 6);
  assert.equal(r.ziel_grob, true);
  assert.equal(r.terz.hz.length, TERZ_HZ.length);
  assert.equal(Object.keys(r.chroma).length, 12);
  assert.ok(r.chroma.A > 0.99);
  assert.equal(r.tonart.name, 'Am');
  assert.equal(r.lufs_m_mittel, -14);
  // B3: only the peaks measured inside the window count; the -0.5 of /analyse/pegel (since its last reset) is ignored
  assert.equal(r.peak_db, -3);
  assert.equal(r.tp_max_dbtp, undefined);
  assert.doesNotMatch(r.urteil, /peak too hot/);
});

// A fake server with a fixed live peak and an optional meter in /lage; returns the answer of mischung takte 2
async function mischungMit(t, lage, peak) {
  let k = 0;
  const s = http.createServer((q, a) => {
    q.resume();
    let j = { ok: true };
    if (q.url === '/lage') j = lage;
    else if (q.url === '/analyse/pegel') j = { leer: false, lufs_s: -12, tp_max_dbtp: -20 };
    else if (q.url === '/analyse/live') {
      const db = flach(-120); db[53] = -6;
      j = { leer: false, w: k++, steht: false, stumm: false, spektrum: { hz: [...ZWOELFTEL_HZ], db }, stereo: { korrelation: 0.8 }, true_peak_dbtp: peak, lufs_m: -14 };
    }
    a.writeHead(200, { 'content-type': 'application/json' }); a.end(JSON.stringify(j));
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  return JSON.parse((await c.callTool({ name: 'mischung', arguments: { takte: 2 } })).content[0].text);
}

test('B2: the sample count follows the meter of lage (3/4: 3 beats per bar), 4 when absent', async (t) => {
  // 2 bars at 240 BPM: 4/4 is 8 beats = 2 s = 4 samples; 3/4 is 6 beats = 1.5 s = 3 samples
  assert.equal((await mischungMit(t, { uhr: { beat: 1, bpm: 240 }, decks: [] }, -3)).proben, 4);
  assert.equal((await mischungMit(t, { uhr: { beat: 1, bpm: 240 }, taktart: [3, 4], decks: [] }, -3)).proben, 3);
});

test('B3: a hot peak inside the window is named in the verdict as peak_db', async (t) => {
  const r = await mischungMit(t, { uhr: { beat: 1, bpm: 240 }, decks: [] }, -0.2);
  assert.equal(r.peak_db, -0.2);
  assert.match(r.urteil, /peak too hot \(-0\.2 dB\)/);
});
