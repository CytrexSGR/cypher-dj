// FIND SOUND part 1, task 4: the six routes of the round in the real server (area proj-ausgabe beside proj): listed with their guards, unreadable body 400,
// no round 404, no project kein_projekt, Stop Cypher only for cypher, English texts. Core double; nothing is rendered, nothing reaches the core.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel, post } from './support/media_library.mjs';
import { innen } from './support/inside.mjs';

const kopfJson = { 'content-type': 'application/json' };
const PFADE = ['/proj/klang/runde', '/proj/klang/hoeren', '/proj/klang/waehlen', '/proj/klang/zurueck', '/proj/klang/ende'];

test('proj/klang: six routes in proj-ausgabe with their guards', async (t) => {
  const { o } = await stapel(t);
  const routen = o.routen().filter((r) => r.pfad.startsWith('/proj/klang/')).map((r) => [r.bereich, r.methode, r.pfad, r.schutz]);
  assert.deepEqual(routen.sort(), [
    ['proj-ausgabe', 'GET', '/proj/klang/runde', 'offen'],
    ['proj-ausgabe', 'POST', '/proj/klang/ende', 'fremdePost'],
    ['proj-ausgabe', 'POST', '/proj/klang/hoeren', 'fremdePost'],
    ['proj-ausgabe', 'POST', '/proj/klang/runde', 'fremdePost'],
    ['proj-ausgabe', 'POST', '/proj/klang/waehlen', 'fremdePost'],
    ['proj-ausgabe', 'POST', '/proj/klang/zurueck', 'fremdePost'],
  ]);
});

test('proj/klang: guards, unreadable body, no round, no project, Stop Cypher only for cypher', async (t) => {
  const { o, url } = await stapel(t);
  const i = innen(o);
  const n0 = i.gesendet;
  for (const pfad of PFADE) {
    const roh = await fetch(`${url}${pfad}`, { method: 'POST', body: '{}' });
    assert.deepEqual([pfad, roh.status, (await roh.json()).fehler], [pfad, 415, 'nur_json']);
    const fremd = await fetch(`${url}${pfad}`, { method: 'POST', headers: { ...kopfJson, origin: 'https://boese.example' }, body: '{}' });
    assert.deepEqual([pfad, fremd.status, (await fremd.json()).fehler], [pfad, 403, 'fremde_herkunft']);
    const kaputt = await fetch(`${url}${pfad}`, { method: 'POST', headers: kopfJson, body: '{"platz":' });
    const kj = await kaputt.json();
    assert.deepEqual([pfad, kaputt.status, kj.fehler], [pfad, 400, 'argument_ungueltig']);
    assert.match(kj.text, /^unreadable request body/);
  }
  const lage = await fetch(`${url}/proj/klang/runde`);
  const lj = await lage.json();
  assert.deepEqual([lage.status, lj.fehler, lj.text], [404, 'keine_runde', 'no round is running; start one first']);
  for (const [pfad, d] of [['/proj/klang/hoeren', { platz: 'B' }], ['/proj/klang/waehlen', { platz: 'B' }], ['/proj/klang/zurueck', {}]]) {
    const r = await post(url, pfad, d);
    assert.deepEqual([pfad, r.code, r.j.fehler], [pfad, 404, 'keine_runde']);
  }
  const vg = await post(url, '/proj/klang/hoeren', { platz: 'B', vergleich: true });
  assert.deepEqual([vg.code, vg.j.fehler], [404, 'keine_runde'], 'the field vergleich is known to the route (no round yet)');
  const falsch = await post(url, '/proj/klang/hoeren', { platz: 'Z' });
  assert.deepEqual([falsch.code, falsch.j.fehler], [400, 'argument_ungueltig']);
  const ohneSpur = await post(url, '/proj/klang/runde', {});
  assert.deepEqual([ohneSpur.code, ohneSpur.j.fehler], [400, 'argument_ungueltig']);
  const ohne = await post(url, '/proj/klang/runde', { spur_id: 's1' });
  assert.deepEqual([ohne.code, ohne.j.fehler, ohne.j.text], [409, 'kein_projekt', 'no project is open']);
  const ende = await post(url, '/proj/klang/ende', {});
  assert.deepEqual([ende.code, ende.j], [200, { ok: true }]);
  const ende2 = await post(url, '/proj/klang/ende', {});
  assert.deepEqual([ende2.code, ende2.j], [200, { ok: true }], 'ending is idempotent');
  await i.kiStopp(true);
  const ki = await post(url, '/proj/klang/runde', { spur_id: 's1' }, { 'x-djk-quelle': 'cypher' });
  assert.deepEqual([ki.code, ki.j.fehler], [409, 'ki_gestoppt']);
  const hand = await post(url, '/proj/klang/runde', { spur_id: 's1' });
  assert.deepEqual([hand.code, hand.j.fehler], [409, 'kein_projekt'], 'negative control: Stop Cypher does not lock Andreas out');
  await i.kiStopp(false);
  assert.equal(i.gesendet, n0, 'nothing sent to the core');
});
