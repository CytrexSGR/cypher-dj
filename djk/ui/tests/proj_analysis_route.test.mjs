// ANALYZE slice 1: POST /proj/analyse in the real server (area proj-ausgabe beside proj): route listed, guard fremdePost, unreadable body 400,
// no project kein_projekt, Stop Cypher only for cypher. Core double, test instance from CYPHERDJ_TEST_INSTANZ. No sound.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel, post } from './support/media_library.mjs';
import { innen } from './support/inside.mjs';

const M = { quelle: { art: 'master' } };
const kopfJson = { 'content-type': 'application/json' };

test('proj/analyse: route in proj-ausgabe with fremdePost; unreadable body 400; without a project kein_projekt; Stop Cypher only for cypher', async (t) => {
  const { o, url } = await stapel(t);
  const i = innen(o);
  const routen = o.routen().filter((r) => r.pfad === '/proj/analyse');
  assert.deepEqual(routen.map((r) => [r.bereich, r.methode, r.schutz]), [['proj-ausgabe', 'POST', 'fremdePost']]);
  const n0 = i.gesendet;
  const roh = await fetch(`${url}/proj/analyse`, { method: 'POST', body: JSON.stringify(M) });
  assert.deepEqual([roh.status, (await roh.json()).fehler], [415, 'nur_json']);
  const fremd = await fetch(`${url}/proj/analyse`, { method: 'POST', headers: { ...kopfJson, origin: 'https://boese.example' }, body: JSON.stringify(M) });
  assert.deepEqual([fremd.status, (await fremd.json()).fehler], [403, 'fremde_herkunft']);
  const kaputt = await fetch(`${url}/proj/analyse`, { method: 'POST', headers: kopfJson, body: '{"quelle":' });
  const kj = await kaputt.json();
  assert.deepEqual([kaputt.status, kj.fehler], [400, 'argument_ungueltig']);
  const ohneQuelle = await post(url, '/proj/analyse', {});
  assert.deepEqual([ohneQuelle.code, ohneQuelle.j.fehler], [400, 'argument_ungueltig']);
  assert.match(kj.text, /^unreadable request body/);
  const ohne = await post(url, '/proj/analyse', M);
  assert.deepEqual([ohne.code, ohne.j.fehler, ohne.j.text], [409, 'kein_projekt', 'no project is open']);
  i.vomKern('/e/ki', { gestoppt: 1, grund: 'hand', sample: 0 });
  const ki = await post(url, '/proj/analyse', M, { 'x-djk-quelle': 'cypher' });
  assert.deepEqual([ki.code, ki.j.fehler], [409, 'ki_gestoppt']);
  const hand = await post(url, '/proj/analyse', M);
  assert.deepEqual([hand.code, hand.j.fehler], [409, 'kein_projekt'], 'negative control: Stop Cypher does not lock Andreas out');
  i.vomKern('/e/ki', { gestoppt: 0, grund: '', sample: 0 });
  assert.equal(i.gesendet, n0, 'nothing sent to the core');
});
