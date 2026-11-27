// Level rule: pure, no server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stufenRegel, kopfWert } from '../http/hand_stufe.ts';

const wer = (stufe) => ({ id: 'k', name: 'k', stufe });
const q = (stufe, o = {}) => ({ methode: 'POST', pfad: '/regler', quelle: 'cypher', wer: wer(stufe), werkzeug: null, aktion: null, aufruf: null, ...o });
const regel = stufenRegel();

test('read-only key: GET ok, write and unknown tool refused', () => {
  assert.equal(regel(q('lesen', { methode: 'GET' })), null);
  const u = regel(q('lesen', { werkzeug: 'regler' }));
  assert.deepEqual([u.code, u.fehler, u.mehr], [403, 'stufe_zu_niedrig', { braucht: 'schreiben', hat: 'lesen' }]);
  assert.equal(regel(q('lesen')).mehr.braucht, 'zerstoerend');
});

test('read-only key: a reading POST passes only on its own path', () => {
  assert.equal(regel(q('lesen', { werkzeug: 'proj_analyse', pfad: '/proj/analyse' })), null);
  assert.equal(regel(q('lesen', { werkzeug: 'proj_analyse', pfad: '/regler' })).fehler, 'stufe_zu_niedrig');
});

test('write key: destructive refused, GET ok, unknown tool refused', () => {
  const u = regel(q('schreiben', { werkzeug: 'kits', aktion: 'loeschen', pfad: '/kits/loeschen' }));
  assert.deepEqual([u.code, u.mehr], [403, { braucht: 'zerstoerend', hat: 'schreiben' }]);
  assert.equal(regel(q('schreiben', { methode: 'GET', werkzeug: 'kits', aktion: 'liste', pfad: '/kits/liste' })), null);
  assert.equal(regel(q('schreiben', { werkzeug: 'regler' })), null);
  assert.equal(regel(q('schreiben', { werkzeug: 'gibt_es_nicht' })).fehler, 'stufe_zu_niedrig');
});

test('full key and the person pass everything', () => {
  assert.equal(regel(q('zerstoerend', { werkzeug: 'kits', aktion: 'loeschen' })), null);
  assert.equal(regel(q('zerstoerend')), null);
  assert.equal(regel(q('lesen', { wer: null, quelle: 'andreas' })), null);
});

test('kopfWert: trims, limits length and alphabet', () => {
  assert.equal(kopfWert(' regler '), 'regler');
  assert.equal(kopfWert('a'.repeat(65)), null);
  assert.equal(kopfWert('Regler!'), null);
  assert.equal(kopfWert(undefined), null);
  assert.equal(kopfWert('h-12', true), 'h-12');
});
