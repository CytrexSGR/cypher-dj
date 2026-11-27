// Strand 11 (4.3): the page-level locks are open for Cypher, the ramp rule (nur_rampe) guards raises, the locks of 0.2 stay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { echterServer } from './support/echter_server.mjs';
import { belegeTestInstanz } from './support/instance.mjs';
import { fahre } from '../../contract/mock_core/sequences_fast.mjs';
import { arbeitsbestand, sende, erwarte, q, teil } from '../../contract/mock_core/tests/help.mjs';

belegeTestInstanz();
const CYPHER = { 'x-djk-quelle': 'cypher' };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const teile = (s, pfad) => s.log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil' && z.felder.pfad === pfad);
const ack = (o, f) => o.vomKern({ adresse: '/q', felder: { id: f.id, quelle: f.quelle, status: 2, ist_sample: 0, ist_beat: 0, grund: '' } });

// POST /regler as Cypher; acks the part the page sent so the call returns
async function regler(s, pfad, nach, takte) {
  const n0 = teile(s, pfad).length;
  const p = s.post('/regler', { pfad, nach, takte }, CYPHER);
  let fertig = false;
  void p.then(() => { fertig = true; });
  for (let i = 0; i < 250 && !fertig; i++) {
    if (teile(s, pfad).length > n0) { ack(s.o, teile(s, pfad).at(-1).felder); break; }
    await warte(20);
  }
  return p;
}

test('Cypher turns master/kleber, xfader and a bus fader ramp: one /k/teil each, no refusal', async (t) => {
  const s = await echterServer(t, 'ro', 0);
  for (const [pfad, nach, takte] of [['master/kleber', 0.4, 0], ['xfader', 0.5, 0], ['bus/1/fader', -30, 2]]) {
    s.o.stand.regler[pfad] = pfad === 'bus/1/fader' ? -60 : 0;
    const n0 = teile(s, pfad).length;
    const r = await regler(s, pfad, nach, takte);
    assert.equal(r.code, 200, `${pfad}: ${JSON.stringify(r.j)}`);
    assert.equal(teile(s, pfad).length, n0 + 1, `${pfad}: exactly one part`);
  }
});

test('ramp rule: a raise of master/pegel above 6 dB in one step is nur_rampe, as a 1-bar ramp or a small step it passes', async (t) => {
  const s = await echterServer(t, 'ro', 1);
  s.o.stand.regler['master/pegel'] = -20;
  const n0 = teile(s, 'master/pegel').length;
  const r = await s.post('/regler', { pfad: 'master/pegel', nach: 0, takte: 0 }, CYPHER);
  assert.deepEqual([r.code, r.j.fehler], [409, 'nur_rampe'], JSON.stringify(r.j));
  assert.ok(r.j.text.length > 0);
  assert.equal(teile(s, 'master/pegel').length, n0, 'nothing sent to the core');
  assert.equal((await regler(s, 'master/pegel', -15, 0)).code, 200, 'a 5 dB step is no ramp case');
  s.o.stand.regler['master/pegel'] = -20;
  assert.equal((await regler(s, 'master/pegel', 0, 1)).code, 200, 'the same raise as a 1-bar ramp');
  s.o.stand.regler['master/pegel'] = 0;
  assert.equal((await regler(s, 'master/pegel', -30, 0)).code, 200, 'lowering is never a ramp case');
  // bus fader: same rule; Andreas is never gated
  s.o.stand.regler['bus/2/fader'] = -40;
  const b = await s.post('/regler', { pfad: 'bus/2/fader', nach: -10, takte: 0 }, CYPHER);
  assert.deepEqual([b.code, b.j.fehler], [409, 'nur_rampe'], JSON.stringify(b.j));
  const n1 = teile(s, 'master/pegel').length;
  s.o.stand.regler['master/pegel'] = -20;
  const p = s.post('/regler', { pfad: 'master/pegel', nach: 0, takte: 0 });
  for (let i = 0; i < 100 && teile(s, 'master/pegel').length === n1; i++) await warte(20);
  assert.equal(teile(s, 'master/pegel').length, n1 + 1, 'Andreas: no ramp rule');
  ack(s.o, teile(s, 'master/pegel').at(-1).felder);
  assert.equal((await p).code, 200);
});

test('ramp rule on a loops container fader and on a track in POST /spur', async (t) => {
  const s = await echterServer(t, 'ro', 2);
  assert.equal((await s.post('/live/oeffnen', {})).code, 200);
  s.projekt().plaetze[1] = { typ: 'loops', gruppe: 'g-test' };
  s.o.stand.regler['deck/2/trim'] = -30;
  const r = await s.post('/regler', { pfad: 'deck/2/trim', nach: 0, takte: 0 }, CYPHER);
  assert.deepEqual([r.code, r.j.fehler], [409, 'nur_rampe'], JSON.stringify(r.j));
  s.o.stand.regler['master/pegel'] = -20;
  s.o.kern.uhr = { beat: 0, bpm: 128, mono_ns: 0 };
  const sp = await s.post('/spur', { spur: { name: 'anheben', fahrten: [{ ziel: 'master/pegel', ab_takt: 1, takte: 0, nach: 0 }] } }, CYPHER);
  assert.deepEqual([sp.code, sp.j.fehler], [409, 'nur_rampe'], JSON.stringify(sp.j));
});

test('locks of 0.2 stay: AUTO switch, taste, griff, kopplung are Cypher-refused; cue/pegel stays nur_hand in the mock core', async (t) => {
  const s = await echterServer(t, 'ro', 3);
  assert.equal((await s.post('/strudel/autonom', { an: true }, CYPHER)).code, 403);
  assert.equal((await s.post('/taste', { name: 'freigabe' }, CYPHER)).code, 403);
  assert.equal((await s.post('/griff', { pfad: 'master/pegel', u: 0.5 }, CYPHER)).code, 403);
  const r = fahre([
    sende(1000, teil(1, 'cypher', '', 0, 'cue/pegel', 16, 0, -12)),
    sende(1000, teil(2, 'cypher', '', 0, 'master/kleber', 16, 0, 0.4)),
    erwarte(3000, q(1, 'cypher', 6, null, 'nur_hand')),
    erwarte(3000, q(2, 'cypher', 1)),
  ], { cfg: { arbeitsbestand: arbeitsbestand() } });
  assert.ok(r.ok, r.fehler.join('\n'));
});

test('POST /deck/raster is open for Cypher: no 403, the old grid goes into the log line', async (t) => {
  const s = await echterServer(t, 'ro', 4);
  const r = await s.post('/deck/raster', { deck: 1, schritt_ms: 5 }, CYPHER);
  assert.notEqual(r.code, 403, JSON.stringify(r.j));
  assert.ok(s.log.some((z) => z.typ === 'raster_cypher' && z.deck === 1), 'raster_cypher line');
});
