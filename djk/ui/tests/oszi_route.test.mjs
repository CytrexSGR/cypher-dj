// GET /oszi?kanal=<name>&sek=<1..15>: the oscilloscope route on the envelope ring (real server on the stand-in, ring file filled by the test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './support/media_library.mjs';
import { schreibeRing } from './support/ring.mjs';
import { OSZI_KANAELE } from '../ear.ts';

function reihe(n, amp, low = (i) => amp(i) * 0.5) {
  return Array.from({ length: n }, (_, i) => ({ sample: i * 48, beat: i / 500, quell: NaN, band: [low(i), 0, 0, 0, 0, 0], k: 0, spitze: amp(i) }));
}
const hol = async (url, q) => { const r = await fetch(`${url}/oszi${q}`); return { code: r.status, j: await r.json() }; };

test('oszi route: the channel list is exactly what the kern writes into the ring', () => {
  assert.deepEqual(Object.keys(OSZI_KANAELE), ['deck/1', 'deck/2', 'deck/3', 'deck/4', 'erz/1', 'erz/2', 'erz/3', 'erz/4', 'pad/1', 'pad/2', 'master', 'cue']);
  assert.deepEqual(Object.values(OSZI_KANAELE), [0, 1, 2, 3, 4, 5, 6, 7, 12, 13, 14, 15]);
});

test('oszi route: errors are clear (unknown channel, sek out of range, ring without data) and a channel answers with its measurements', async (t) => {
  const { url, optionen } = await stapel(t);
  assert.deepEqual(await hol(url, '?kanal=gibts/nicht&sek=2'), { code: 400, j: { fehler: 'kanal' } });
  assert.deepEqual(await hol(url, '?sek=2'), { code: 400, j: { fehler: 'kanal' } });
  for (const sek of ['0', '16', 'x', '2.5']) assert.deepEqual(await hol(url, `?kanal=master&sek=${sek}`), { code: 400, j: { fehler: 'sek' } }, sek);
  // ring exists but nothing was written: the kern is off
  assert.deepEqual(await hol(url, '?kanal=master&sek=2'), { code: 409, j: { fehler: 'kein_ring' } });

  // fill the ring: master loud from ms 1000, erz/4 with one click, pad/2 pumping at the tempo the server knows
  const n = 3000;
  schreibeRing(optionen.huellen, {
    14: reihe(n, (i) => (i < 1000 ? 0.001 : 0.5)),
    7: reihe(n, (i) => (i === 2500 ? 0.9 : 0.05)),
  }, {});
  // the other channels stay zero (the file is zero-filled)

  const m = await hol(url, '?kanal=master&sek=2');
  assert.equal(m.code, 200);
  assert.equal(m.j.kanal, 'master');
  assert.equal(m.j.n, 2000);
  assert.equal(m.j.einsaetze.length, 0, 'the step lies before the 2 s window: no onset inside');
  assert.ok(Math.abs(m.j.spitze_db - -6.0) < 0.2);
  assert.equal(typeof m.j.bpm, 'number', 'the stand-in kern reports a clock, so the tempo is known');
  assert.equal(typeof m.j.pumptiefe_db, 'number');
  const m3 = await hol(url, '?kanal=master&sek=3');
  assert.equal(m3.j.einsaetze.length, 1);
  assert.ok(Math.abs(m3.j.einsaetze[0].t_ms - -2000) <= 20);

  const e = await hol(url, '?kanal=erz/4&sek=1');
  assert.deepEqual(e.j.klick_verdacht, [-499]);

  // pad/2 ducks 6 dB for 100 ms on every beat of the tempo the server reports
  const takt = 60000 / m.j.bpm;
  schreibeRing(optionen.huellen, { 13: reihe(n, (i) => ((i % takt) < 100 ? 0.25 : 0.5)) }, { rAb: n, neu: false });
  const p = await hol(url, '?kanal=pad/2&sek=3');
  assert.ok(Math.abs(p.j.pumptiefe_db - 6.02) < 0.7, String(p.j.pumptiefe_db));
  assert.equal(p.j.bpm, m.j.bpm);

  // a silent channel is clean zero
  const s = await hol(url, '?kanal=cue&sek=1');
  assert.equal(s.code, 200);
  assert.equal(s.j.spitze_db, -200);
  assert.equal(s.j.pumptiefe_db, 0);
  // sek defaults to 5
  assert.equal((await hol(url, '?kanal=master')).j.angefragt_ms, 5000);
});

test('oszi route: reading extra channels does not widen the 100 ms reader (only deck/1, deck/2, master are kept live)', async (t) => {
  const { o } = await stapel(t);
  assert.deepEqual([...o.ohr.puffer.keys()], [0, 1, 14]);
});
