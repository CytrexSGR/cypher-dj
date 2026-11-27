// Strand 11, task 8.1: the per-stream label `bezeichnung` (pattern write, silence clears, spur move, arc, 61 characters = 400).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { echterServer } from './support/echter_server.mjs';
import { belegeTestInstanz } from './support/instance.mjs';
import { pruefeSpur } from '../track.ts';
import { schreibeMuster } from '../../generator/src/pattern_storage.mjs';
import { leseMusterStand } from '../../generator/src/pattern_state.mjs';

belegeTestInstanz();
const T = { timeout: 60000 };
const CYPHER = { 'x-djk-quelle': 'cypher' };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const bis = async (f, ms = 4000) => { for (let i = 0; i < ms / 20 && !(await f()); i++) await warte(20); return f(); };
const get = async (s, p) => (await fetch(`${s.url}${p}`)).json();
const bezLage = async (s, strom) => (await get(s, '/lage')).studio.stroeme.find((x) => x.strom === strom)?.bezeichnung;

async function aufbau(t, n) {
  const s = await echterServer(t, 'bz', n);
  assert.equal((await s.post('/live/oeffnen', {})).code, 200);
  s.o.kern.uhr = { beat: 16, bpm: 128, mono_ns: 0 };
  return s;
}

test('POST /strudel with bezeichnung shows in /lage and GET /strudel; silence clears it', T, async (t) => {
  const s = await aufbau(t, 20);
  let r = await s.post('/strudel', { strom: 1, text: 's("bd*4")', bezeichnung: 'kick + hats' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(await bezLage(s, 1), 'kick + hats');
  assert.equal((await get(s, '/strudel?strom=1')).bezeichnung, 'kick + hats');
  r = await s.post('/strudel', { strom: 1, text: 's("bd*2")' });   // no label: clears
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(await bezLage(s, 1), null);
  await s.post('/strudel', { strom: 1, text: 's("bd*4")', bezeichnung: 'again' });
  assert.equal((await s.post('/strudel', { strom: 1, text: 'silence' })).code, 200);
  assert.equal((await get(s, '/strudel?strom=1')).bezeichnung, null);
});

test('61 characters or a non-string is 400 and writes nothing', T, async (t) => {
  const s = await aufbau(t, 21);
  await s.post('/strudel', { strom: 1, text: 's("bd*4")', bezeichnung: 'keep' });
  for (const bezeichnung of ['x'.repeat(61), '', 5]) {
    const r = await s.post('/strudel', { strom: 1, text: 's("bd*8")', bezeichnung });
    assert.equal(r.code, 400, JSON.stringify([bezeichnung, r.j]));
  }
  assert.equal((await get(s, '/strudel?strom=1')).text, 's("bd*4")');
  assert.equal((await s.post('/strudel', { strom: 1, text: 's("bd*8")', bezeichnung: 'x'.repeat(60) })).code, 200);
});

test('a spur strom move with bezeichnung labels the stream when its pattern is written', T, async (t) => {
  const s = await aufbau(t, 22);
  fs.mkdirSync(`${s.muster}2`, { recursive: true });
  const r = await s.post('/spur', { spur: { name: 'bz1', fahrten: [{ ziel: 'strom:2', ab_takt: 2, muster: 'note("c2")', bezeichnung: 'sub bass' }] }, anker_takt: 10 }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  s.o.kern.uhr = { beat: 38, bpm: 128, mono_ns: 0 };   // anchor bar 10 = beat 36, move at bar 11 = beat 40, written from beat 38
  assert.ok(await bis(() => s.log.some((z) => z.typ === 'spur_muster')), 'timer fired');
  assert.equal(await bezLage(s, 2), 'sub bass');
});

test('pruefeSpur: label only on strom entries, string 1..60', () => {
  const sp = (f) => pruefeSpur({ name: 'x', fahrten: [f] }, new Set());
  assert.ok(!('fehler' in sp({ ziel: 'strom:1', ab_takt: 1, muster: 's("bd")', bezeichnung: 'ok' })));
  for (const b of ['', 'x'.repeat(61), 3]) assert.ok('fehler' in sp({ ziel: 'strom:1', ab_takt: 1, muster: 's("bd")', bezeichnung: b }), String(b));
  assert.ok('fehler' in sp({ ziel: 'spur/1/fader', ab_takt: 1, nach: 0, bezeichnung: 'no' }));
});

test('generator: schreibeMuster writes the label next to versatz, none clears it', () => {
  const dir = fs.mkdtempSync('/tmp/bz-');
  try {
    assert.deepEqual(schreibeMuster(dir, 's("bd")', 'cypher', 1, () => true, 2, 'kick'), { ok: true });
    let st = leseMusterStand(dir);
    assert.equal(st.bezeichnung, 'kick');
    assert.deepEqual(JSON.parse(fs.readFileSync(`${dir}/strom1.von.json`, 'utf8')), { von: 'cypher', zeit: 1, versatz: 2, bezeichnung: 'kick' });
    schreibeMuster(dir, 's("bd")', 'cypher', 2);
    assert.equal(leseMusterStand(dir).bezeichnung, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an arc start labels the stream with the compiled layer names', T, async (t) => {
  const s = await aufbau(t, 23);
  fs.mkdirSync(`${s.muster}1`, { recursive: true });
  const r = await s.post('/bogen', { name: 'b1', takte: 8, anker_takt: 10, schichten: [{ strom: 1, muster: 's("hh*8")', ab_takt: 1, name: 'hats' }, { strom: 1, muster: 's("~ cp")', ab_takt: 3, name: 'clap' }] }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  s.o.kern.uhr = { beat: 34, bpm: 128, mono_ns: 0 };
  assert.ok(await bis(async () => (await bezLage(s, 1)) === 'hats'), 'first section label');
  s.o.kern.uhr = { beat: 42, bpm: 128, mono_ns: 0 };
  assert.ok(await bis(async () => (await bezLage(s, 1)) === 'hats + clap'), 'second section label');
});

test('A2: a control character in bezeichnung is 400 and the server still answers afterwards', T, async (t) => {
  const s = await aufbau(t, 23);
  for (const bezeichnung of ['a\u0000b', 'a\nb', 'x\u007f']) {
    const r = await s.post('/strudel', { strom: 1, text: 's("bd*4")', bezeichnung });
    assert.equal(r.code, 400, JSON.stringify([bezeichnung, r.j]));
  }
  const sp = await s.post('/spur', { spur: { name: 'bz2', fahrten: [{ ziel: 'strom:2', ab_takt: 2, muster: 'note("c2")', bezeichnung: 'a\u0000b' }] }, anker_takt: 10 }, CYPHER);
  assert.equal(sp.code, 400, JSON.stringify(sp.j));
  assert.equal((await s.post('/strudel', { strom: 1, text: 's("bd*4")', bezeichnung: 'fine' })).code, 200);
  assert.equal(await bezLage(s, 1), 'fine');
});
