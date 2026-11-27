// Container core M8: the open-strip rule of the hand tools on the container mapping of D3 (strips deck/1, deck/2, pad/1, pad/2 = places 1..4).
// Replaces the DJ view places version (slots A/B, the eigenePad exception): a module (stems) in a container refuses Cypher's opening for good,
// and a planned or running ramp of Cypher on a container strip counts as open for the place gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { echterServer } from './support/echter_server.mjs';
import { belegeTestInstanz } from './support/instance.mjs';
import { kanalOffen } from '../hand_operation.ts';

belegeTestInstanz();
const CYPHER = { 'x-djk-quelle': 'cypher' };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const bis = async (f, ms = 3000) => { for (let i = 0; i < ms / 20 && !(await f()); i++) await warte(20); return f(); };
const teile = (s, pfad) => s.log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil' && z.felder.pfad === pfad);
const ack = (o, f) => o.vomKern({ adresse: '/q', felder: { id: f.id, quelle: f.quelle, status: 2, ist_sample: 0, ist_beat: 0, grund: '' } });

test('pure rule: PFL is not part of kanalOffen; only trim + fader above -26 dB opens a channel', () => {
  assert.equal(kanalOffen({ 'pad/1/trim': 0, 'pad/1/fader': -200, 'pad/1/pfl': 1 }, 'pad/1'), false);
  assert.equal(kanalOffen({ 'pad/1/trim': 0, 'pad/1/fader': -26 }, 'pad/1'), false);
  assert.equal(kanalOffen({ 'pad/1/trim': 0, 'pad/1/fader': -25.9 }, 'pad/1'), true);
});

test('a module (stems) in container D opens pad/2/fader for Cypher (strand 11); container C with a strudel module still opens', async (t) => {
  const s = await echterServer(t, 'ko', 0);
  assert.equal((await s.post('/live/oeffnen', {})).code, 200);
  assert.equal(s.projekt().plaetze[2].typ, 'strudel');
  s.projekt().plaetze[3] = { typ: 'stems', gruppe: 'g-test' };
  const n0 = teile(s, 'pad/2/fader').length;
  const r = s.post('/regler', { pfad: 'pad/2/fader', nach: -6, takte: 1 }, CYPHER);
  assert.ok(await bis(() => teile(s, 'pad/2/fader').length === n0 + 1), 'the stems strip is free');
  assert.equal(teile(s, 'pad/2/fader').length, n0 + 1, 'the stems strip is free: the part went to the core');
  ack(s.o, teile(s, 'pad/2/fader').at(-1).felder);
  assert.equal((await r).code, 200);
  const p = s.post('/regler', { pfad: 'pad/1/fader', nach: -6, takte: 0 }, CYPHER);
  assert.ok(await bis(() => teile(s, 'pad/1/fader').length === 1), 'container C (strudel) opens for Cypher');
  ack(s.o, teile(s, 'pad/1/fader')[0].felder);
  assert.equal((await p).code, 200);
});

// a planned or running ramp of Cypher on a container strip counts as open for the place gate (platz_setzen is kanal_offen), the other place is not affected
test('a planned ramp of Cypher on pad/2 makes container D open for the place gate; place 3 has no ramp and changes', async (t) => {
  const s = await echterServer(t, 'ko', 1);
  assert.equal((await s.post('/live/oeffnen', {})).code, 200);
  const setze = (platz, typ) => s.post('/proj/aendern', { rev: s.projekt().rev, label: 'place', befehle: [{ befehl: 'platz_setzen', platz, typ }] }, CYPHER);
  assert.equal(s.o.kanalGeoeffnet('pad/2'), false, 'nothing planned: closed');
  // a move that stays closed (-40 dB), planned for the next phrase
  const p = s.post('/regler', { pfad: 'pad/2/fader', nach: -40, takte: 8, ab: 'phrase' }, CYPHER);
  assert.ok(await bis(() => teile(s, 'pad/2/fader').length === 1), 'the ramp reaches the core');
  assert.equal(s.o.kanalGeoeffnet('pad/2'), true, 'a planned or running ramp counts as open');
  assert.equal(s.o.kanalGeoeffnet('deck/1'), false);
  const e = await setze(4, 'seq');
  assert.deepEqual([e.code, e.j.fehler], [409, 'kanal_offen'], JSON.stringify(e.j));
  assert.equal((await setze(1, 'seq')).code, 200, 'container A has no ramp: accepted');
  ack(s.o, teile(s, 'pad/2/fader')[0].felder);
  await p;
});
