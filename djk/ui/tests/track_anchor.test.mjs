// 1.1 live hand: POST /spur on every stream of the table and a predictable anchor (anker_takt, probe, uhr.naechster_takt).
// Real in-process page server, the core is a log; the clock is set by hand (128 BPM, 4 beats per bar).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { echterServer } from './support/echter_server.mjs';
import { belegeTestInstanz } from './support/instance.mjs';
import { schreibeLebt } from '../../generator/src/pattern_state.mjs';

belegeTestInstanz();
const CYPHER = { 'x-djk-quelle': 'cypher' };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const bis = async (f, ms = 4000) => { for (let i = 0; i < ms / 20 && !(await f()); i++) await warte(20); return f(); };
const teile = (s) => s.log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil');
const lebt = (muster, strom) => { fs.mkdirSync(`${muster}${strom}`, { recursive: true }); schreibeLebt(`${muster}${strom}`, { strom, ziel: 'x' }, Date.now()); };

async function aufbau(t, versatz) {
  const s = await echterServer(t, 'sa', versatz);
  s.o.kern.uhr = { beat: 16, bpm: 128, mono_ns: 0 };   // next bar start is beat 20 = bar 6
  return s;
}
const spur = (fahrten, extra = {}) => ({ spur: { name: 'anker', fahrten }, ...extra });

test('probe answers the anchor and the absolute bars, sends no /k/teil and enters nothing in the table', async (t) => {
  const s = await aufbau(t, 0);
  lebt(s.muster, 6);
  const r = await s.post('/spur', spur([{ ziel: 'strom:6', ab_takt: 3, muster: 'silence' }, { ziel: 'deck/1/filter', ab_takt: 1, takte: 1, nach: -0.5 }], { anker_takt: 10, probe: true }), CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual([r.j.probe, r.j.anker_beat, r.j.anker_takt], [true, 36, 10]);
  assert.deepEqual(r.j.muster, [{ strom: 6, ab_takt_absolut: 12 }]);
  assert.equal(teile(s).length, 0);
  const liste = await (await fetch(`${s.url}/spur`)).json();
  assert.ok(!JSON.stringify(liste).includes('anker'), JSON.stringify(liste));
});

test('anker_takt in the past is anker_vorbei with the earliest bar; ab and anker_takt together are 400; too far ahead is 400', async (t) => {
  const s = await aufbau(t, 1);
  const f = [{ ziel: 'strom:2', ab_takt: 1, muster: 'silence' }];
  let r = await s.post('/spur', spur(f, { anker_takt: 5, probe: true }), CYPHER);
  assert.deepEqual([r.code, r.j.fehler, r.j.fruehester_takt], [409, 'anker_vorbei', 6], JSON.stringify(r.j));
  r = await s.post('/spur', spur(f, { anker_takt: 6, probe: true }), CYPHER);
  assert.equal(r.code, 200, 'the earliest bar itself is allowed');
  r = await s.post('/spur', spur(f, { anker_takt: 8, ab: 'takt', probe: true }), CYPHER);
  assert.deepEqual([r.code, r.j.fehler], [400, 'ab_und_anker']);
  r = await s.post('/spur', spur(f, { anker_takt: 6 + 257, probe: true }), CYPHER);
  assert.deepEqual([r.code, r.j.fehler], [400, 'anker_takt']);
});

test('strom:6 without its erzeuger is strom_ohne_erzeuger (probe too); strom:2 never needs one', async (t) => {
  const s = await aufbau(t, 2);
  let r = await s.post('/spur', spur([{ ziel: 'strom:6', ab_takt: 1, muster: 'silence' }], { probe: true }), CYPHER);
  assert.deepEqual([r.code, r.j.fehler, r.j.strom], [409, 'strom_ohne_erzeuger', 6], JSON.stringify(r.j));
  r = await s.post('/spur', spur([{ ziel: 'strom:2', ab_takt: 1, muster: 'silence' }], { probe: true }), CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
});

test('/lage names the next bar and the next phrase bar (phrase grid: bar 1 mod 8)', async (t) => {
  const s = await aufbau(t, 3);
  const u = (await s.lage()).uhr;
  assert.deepEqual([u.naechster_takt, u.naechste_phrase_takt], [6, 9]);
});

test('a strom:6 move is written by the pattern timer two beats before its bar into the stream 6 folder', async (t) => {
  const s = await aufbau(t, 4);
  assert.equal((await s.post('/live/oeffnen', {})).code, 200);   // the strudel module must sit in the live container
  lebt(s.muster, 6);
  s.log.length = 0;
  const r = await s.post('/spur', spur([{ ziel: 'strom:6', ab_takt: 1, muster: 'note("c3")' }], { anker_takt: 10 }), CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.anker_takt, 10);
  await warte(200);
  assert.equal(s.log.filter((z) => z.typ === 'spur_muster').length, 0, 'beat 16 is before anchor 36 - 2');
  s.o.kern.uhr = { beat: 33.9, bpm: 128, mono_ns: 0 };
  await warte(200);
  assert.equal(s.log.filter((z) => z.typ === 'spur_muster').length, 0, 'not yet at beat 34');
  s.o.kern.uhr = { beat: 34, bpm: 128, mono_ns: 0 };
  assert.ok(await bis(() => s.log.some((z) => z.typ === 'spur_muster')), 'timer fired');
  const z = s.log.find((x) => x.typ === 'spur_muster');
  assert.deepEqual([z.strom, z.ziel_beat, z.code], [6, 36, 200], JSON.stringify(z));
  assert.ok(fs.readdirSync(`${s.muster}6`).some((n) => n !== 'lebt.json'), 'pattern file in the stream 6 folder');
});
