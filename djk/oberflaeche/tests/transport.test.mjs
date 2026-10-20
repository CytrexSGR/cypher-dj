// http/transport.ts (Plan 2026-10-15-d1-s1, Task 8): die Bausteine, die server.ts an 20 Stellen kopiert hatte, als Funktionen.
// Ohne Netz: Anfrage und Antwort sind kleine Attrappen mit genau den Feldern, die transport.ts liest bzw. schreibt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { fremdePost, postAbgewiesen, json, koerper, quelleAusKopf } from '../http/transport.ts';

const PORT = 50300;
const anfrage = (headers = {}, body = '') => Object.assign(Readable.from(body === '' ? [] : [Buffer.from(body)]), { headers });
function antwort() {
  const a = { code: null, kopf: null, text: null };
  return Object.assign(a, { writeHead(c, k) { a.code = c; a.kopf = k; }, end(t) { a.text = t; } });
}

test('fremdePost: nur JSON (415), nur eigene Herkunft oder keine (403), Rangfolge Content-Type vor Herkunft', () => {
  const j = { 'content-type': 'application/json' };
  assert.equal(fremdePost(anfrage(j), PORT), null);
  assert.equal(fremdePost(anfrage({ 'content-type': 'APPLICATION/JSON; charset=utf-8' }), PORT), null, 'Groß/Klein und Zusatz egal');
  assert.equal(fremdePost(anfrage({}), PORT), 415);
  assert.equal(fremdePost(anfrage({ 'content-type': 'text/plain' }), PORT), 415);
  assert.equal(fremdePost(anfrage({ 'content-type': 'application/x-www-form-urlencoded' }), PORT), 415);
  assert.equal(fremdePost(anfrage({ ...j, origin: `http://127.0.0.1:${PORT}` }), PORT), null);
  assert.equal(fremdePost(anfrage({ ...j, origin: `http://localhost:${PORT}` }), PORT), null);
  assert.equal(fremdePost(anfrage({ ...j, origin: 'https://boese.example' }), PORT), 403);
  assert.equal(fremdePost(anfrage({ ...j, origin: 'http://127.0.0.1:1' }), PORT), 403, 'gleicher Host, anderer Port ist fremd');
  assert.equal(fremdePost(anfrage({ origin: 'https://boese.example' }), PORT), 415, 'beides falsch: 415 zuerst');
});

test('postAbgewiesen schreibt 415 nur_json bzw. 403 fremde_herkunft (mit englischem text, Spec 6.34) und meldet true; durchgelassen schreibt nichts', () => {
  const a1 = antwort();
  assert.equal(postAbgewiesen(anfrage({}), a1, PORT), true);
  assert.deepEqual([a1.code, JSON.parse(a1.text)], [415, { fehler: 'nur_json', text: 'this server only takes JSON requests (content-type application/json)' }]);
  const a2 = antwort();
  assert.equal(postAbgewiesen(anfrage({ 'content-type': 'application/json', origin: 'https://boese.example' }), a2, PORT), true);
  assert.deepEqual([a2.code, JSON.parse(a2.text)], [403, { fehler: 'fremde_herkunft', text: 'request from another origin refused' }]);
  const a3 = antwort();
  assert.equal(postAbgewiesen(anfrage({ 'content-type': 'application/json' }), a3, PORT), false);
  assert.deepEqual([a3.code, a3.text], [null, null], 'Negativ-Kontrolle: nichts geschrieben');
});

test('json: Content-Type mit charset, no-store, Text ist JSON.stringify', () => {
  const a = antwort();
  json(a, 201, { b: 1, a: [null] });
  assert.deepEqual([a.code, a.kopf, a.text], [201, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, '{"b":1,"a":[null]}']);
});

test('koerper: leer ist {}, nur Objekte, höchstens 32768 Zeichen', async () => {
  assert.deepEqual(await koerper(anfrage({}, '')), {});
  assert.deepEqual(await koerper(anfrage({}, '{"x":1}')), { x: 1 });
  await assert.rejects(koerper(anfrage({}, '[1]')), { message: 'kein Objekt' });
  await assert.rejects(koerper(anfrage({}, 'null')), { message: 'kein Objekt' });
  await assert.rejects(koerper(anfrage({}, `{"x":"${'a'.repeat(32800)}"}`)), { message: 'zu groß' });
  await assert.rejects(koerper(anfrage({}, '{kaputt')), SyntaxError);
});

test('quelleAusKopf: nur x-djk-quelle cypher ist cypher, alles andere andreas', () => {
  assert.equal(quelleAusKopf(anfrage({ 'x-djk-quelle': 'cypher' })), 'cypher');
  assert.equal(quelleAusKopf(anfrage({ 'x-djk-quelle': 'Cypher' })), 'andreas');
  assert.equal(quelleAusKopf(anfrage({})), 'andreas');
});
