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

test('analyse/referenz: the four routes are in proj-ausgabe with their guards; reads and refusals work in the real server; the tablet may not post', async (t) => {
  const { o, url } = await stapel(t);
  const paare = o.routen().filter((r) => r.pfad.startsWith('/analyse/referenz')).map((r) => [r.bereich, r.methode, r.pfad, r.schutz]);
  assert.deepEqual(paare.sort(), [
    ['proj-ausgabe', 'GET', '/analyse/referenzen', 'offen'],
    ['proj-ausgabe', 'POST', '/analyse/referenz/loeschen', 'fremdePost'],
    ['proj-ausgabe', 'POST', '/analyse/referenz/merken', 'fremdePost'],
    ['proj-ausgabe', 'POST', '/analyse/referenz/messen', 'fremdePost'],
  ]);
  const fremd = await fetch(`${url}/analyse/referenz/messen`, { method: 'POST', headers: { ...kopfJson, origin: 'https://boese.example' }, body: '{}' });
  assert.deepEqual([fremd.status, (await fremd.json()).fehler], [403, 'fremde_herkunft']);
  const roh = await fetch(`${url}/analyse/referenz/loeschen`, { method: 'POST', body: '{}' });
  assert.deepEqual([roh.status, (await roh.json()).fehler], [415, 'nur_json']);
  const liste = await (await fetch(`${url}/analyse/referenzen`)).json();
  assert.ok(Array.isArray(liste.referenzen) && liste.rollen.includes('master'));
  const rel = await post(url, '/analyse/referenz/messen', { quelle: { art: 'datei', pfad: 'relativ.wav' } });
  assert.deepEqual([rel.code, rel.j.fehler], [400, 'argument_ungueltig']);
  const weg = await post(url, '/analyse/referenz/messen', { quelle: { art: 'datei', sha: 'c'.repeat(64) } });
  assert.deepEqual([weg.code, weg.j.fehler], [404, 'quelle_unbekannt']);
  const unbekannt = await post(url, '/analyse/referenz/loeschen', { id: 'nicht-da-123456' });
  assert.deepEqual([unbekannt.code, unbekannt.j.fehler], [404, 'referenz_unbekannt']);
  const ref = await post(url, '/proj/analyse', { quelle: { art: 'datei', pfad: '/x/a.wav' } });
  assert.deepEqual([ref.code, ref.j.fehler], [400, 'argument_ungueltig'], 'a reference is never the source');
});
