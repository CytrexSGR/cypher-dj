// Paket 1.18, E-b: POST /proj/lautheit im echten Server (Bereich proj-ausgabe neben proj): Route gemeldet, Schutz fremdePost, Körper unlesbar 400,
// ohne Projekt kein_projekt, KI-Stopp nur für cypher. Kern-Attrappe, Test-Instanz aus CYPHERDJ_TEST_INSTANZ. Kein Ton.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel, post } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';

const kopfJson = { 'content-type': 'application/json' };

test('proj/lautheit: Route im Bereich proj-ausgabe, Schutz fremdePost, Körper unlesbar 400, ohne Projekt kein_projekt, KI-Stopp nur für cypher', async (t) => {
  const { o, url } = await stapel(t);
  const i = innen(o);
  const routen = o.routen().filter((r) => r.pfad === '/proj/lautheit');
  assert.deepEqual(routen.map((r) => [r.bereich, r.methode, r.schutz]), [['proj-ausgabe', 'POST', 'fremdePost']]);
  const n0 = i.gesendet;
  const roh = await fetch(`${url}/proj/lautheit`, { method: 'POST', body: '{}' });
  assert.deepEqual([roh.status, (await roh.json()).fehler], [415, 'nur_json']);
  const fremd = await fetch(`${url}/proj/lautheit`, { method: 'POST', headers: { ...kopfJson, origin: 'https://boese.example' }, body: '{}' });
  assert.deepEqual([fremd.status, (await fremd.json()).fehler], [403, 'fremde_herkunft']);
  const kaputt = await fetch(`${url}/proj/lautheit`, { method: 'POST', headers: kopfJson, body: '{"von_beat":' });
  const kj = await kaputt.json();
  assert.deepEqual([kaputt.status, kj.fehler], [400, 'argument_ungueltig']);
  assert.match(kj.text, /^unreadable request body/);
  const ohne = await post(url, '/proj/lautheit', {});
  assert.deepEqual([ohne.code, ohne.j.fehler, ohne.j.text], [409, 'kein_projekt', 'no project is open']);
  i.vomKern('/e/ki', { gestoppt: 1, grund: 'hand', sample: 0 });
  const ki = await post(url, '/proj/lautheit', {}, { 'x-djk-quelle': 'cypher' });
  assert.deepEqual([ki.code, ki.j.fehler], [409, 'ki_gestoppt']);
  const hand = await post(url, '/proj/lautheit', {});
  assert.deepEqual([hand.code, hand.j.fehler], [409, 'kein_projekt'], 'Negativ-Kontrolle: Andreas sperrt der KI-Stopp nicht');
  i.vomKern('/e/ki', { gestoppt: 0, grund: '', sample: 0 });
  assert.equal(i.gesendet, n0, 'nichts an den Kern');
});
