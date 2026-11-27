// Strand 11, task 7.5: POST /bogen and the arc plan in GET /spur. Real in-process page server, the core is a log, the clock is set by hand
// (128 BPM, 4 beats per bar; at beat 16 the next bar start is beat 20 = bar 6).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { echterServer } from './support/echter_server.mjs';
import { belegeTestInstanz } from './support/instance.mjs';
import { leseMusterStand } from '../../generator/src/pattern_state.mjs';

belegeTestInstanz();
const CYPHER = { 'x-djk-quelle': 'cypher' };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const bis = async (f, ms = 4000) => { for (let i = 0; i < ms / 20 && !(await f()); i++) await warte(20); return f(); };
const HATS = 's("hh*8")', CLAP = 's("~ cp")';

async function aufbau(t, versatz) {
  const s = await echterServer(t, 'br', versatz);
  s.o.kern.uhr = { beat: 16, bpm: 128, mono_ns: 0 };
  return s;
}
const bogen = (extra = {}) => ({ name: 'b1', takte: 8, schichten: [{ strom: 1, muster: HATS, ab_takt: 1, name: 'hats' }, { strom: 1, muster: CLAP, ab_takt: 3, name: 'clap' }],
  bruch: { ab_takt: 5, takte: 2 }, ...extra });
const liste = async (s) => (await fetch(`${s.url}/spur`)).json();

test('probe answers anchor, compiled sections and plan, and sends nothing', async (t) => {
  const s = await aufbau(t, 0);
  s.log.length = 0;
  const r = await s.post('/bogen', bogen({ anker_takt: 10, probe: true }), CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual([r.j.probe, r.j.anker_beat, r.j.anker_takt, r.j.ende_beat], [true, 36, 10, 36 + 8 * 4]);
  assert.equal(r.j.kompiliert.name, 'b1');
  assert.ok(r.j.kompiliert.fahrten.length >= 3);
  assert.deepEqual(r.j.plan.find((z) => z.text === 'break'), { takt: 5, strom: null, text: 'break' });
  assert.equal(s.log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil').length, 0);
  assert.deepEqual(await liste(s), [], 'nothing entered');
});

test('a real start writes the stream 1 pattern two beats before the anchor; GET /spur shows the break as next change', async (t) => {
  const s = await aufbau(t, 1);
  assert.equal((await s.post('/live/oeffnen', {})).code, 200);
  fs.mkdirSync(`${s.muster}1`, { recursive: true });
  const r = await s.post('/bogen', bogen({ anker_takt: 10 }), CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  s.o.kern.uhr = { beat: 34, bpm: 128, mono_ns: 0 };   // anchor 36 - 2
  assert.ok(await bis(() => s.log.some((z) => z.typ === 'spur_muster')), 'timer fired');
  const z = s.log.find((x) => x.typ === 'spur_muster');
  assert.deepEqual([z.strom, z.ziel_beat, z.code], [1, 36, 200], JSON.stringify(z));
  const text = async () => (await (await fetch(`${s.url}/strudel?strom=1`)).json()).text;
  assert.equal(await text(), `(\n${HATS}\n)`, 'the first section is the stream 1 pattern');
  s.o.kern.uhr = { beat: 42, bpm: 128, mono_ns: 0 };   // bar 3 starts at beat 44, written two beats before
  assert.ok(await bis(async () => (await text()) === `stack(\n(\n${HATS}\n),\n(\n${CLAP}\n)\n)`), 'the stack text of bar 3 is written');
  s.o.kern.uhr = { beat: 40, bpm: 128, mono_ns: 0 };   // bar 2 of the arc
  const [l] = await liste(s);
  assert.deepEqual([l.name, l.bogen.name, l.bogen.takte, l.bogen.takt_im_bogen], ['b1', 'b1', 8, 2]);
  assert.deepEqual(l.bogen.naechste.in_takten, 1);
  assert.match(l.bogen.naechste.text, /clap/);
  s.o.kern.uhr = { beat: 48, bpm: 128, mono_ns: 0 };   // bar 4
  const [m] = await liste(s);
  assert.deepEqual([m.bogen.takt_im_bogen, m.bogen.naechste.in_takten, m.bogen.naechste.text], [4, 1, 'break']);
});

test('the spur ends with the arc even when the last layer has no bis_takt', async (t) => {
  const s = await aufbau(t, 2);
  fs.mkdirSync(`${s.muster}1`, { recursive: true });
  const r = await s.post('/bogen', { name: 'ende', takte: 8, schichten: [{ strom: 1, muster: HATS, ab_takt: 1 }], anker_takt: 10 }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.ende_beat, 36 + 8 * 4);
  s.o.kern.uhr = { beat: 36, bpm: 128, mono_ns: 0 };
  const [l] = await liste(s);
  assert.equal(l.ende_beat, 68);
  assert.equal(l.bogen.naechste, null, 'no entry without bis_takt after the last entry');
});

test('errors: invalid arc is 400 bogen with the compiler text, schleife is 400 bogen_schleife, AUTO off on a layer stream is auto_aus', async (t) => {
  const s = await aufbau(t, 3);
  let r = await s.post('/bogen', { name: 'x', takte: 0, schichten: [] }, CYPHER);
  assert.deepEqual([r.code, r.j.fehler], [400, 'bogen']);
  assert.match(r.j.text, /^takte: /);
  r = await s.post('/bogen', bogen({ schleife_takte: 4 }), CYPHER);
  assert.deepEqual([r.code, r.j.fehler], [400, 'bogen_schleife']);
  assert.ok(r.j.text.length > 0);
  fs.mkdirSync(`${s.muster}1`, { recursive: true });
  assert.equal((await s.post('/strudel/autonom', { an: false, strom: 1 })).code, 200);
  r = await s.post('/bogen', bogen(), CYPHER);
  assert.deepEqual([r.code, r.j.fehler, r.j.strom], [409, 'auto_aus', 1], JSON.stringify(r.j));
});
