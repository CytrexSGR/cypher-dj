// Rate limit: pure, injected clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { eimerRegel } from '../http/hand_eimer.ts';

const wer = (id = 'k') => ({ id, name: id, stufe: 'zerstoerend' });
const schreib = (o = {}) => ({ methode: 'POST', pfad: '/regler', quelle: 'cypher', wer: wer(), werkzeug: 'regler', aktion: null, aufruf: null, ...o });
const zerstoer = (o = {}) => schreib({ werkzeug: 'kits', aktion: 'loeschen', pfad: '/kits/loeschen', ...o });
const neu = () => { const uhr = { t: 1_000_000 }; return { uhr, regel: eimerRegel(() => uhr.t) }; };

test('20 writes pass, the 21st is 429 with about 500 ms', () => {
  const { regel } = neu();
  for (let i = 0; i < 20; i++) assert.equal(regel(schreib({ aufruf: `a${i}` })), null);
  const u = regel(schreib({ aufruf: 'a20' }));
  assert.deepEqual([u.ok, u.code, u.fehler], [false, 429, 'zu_schnell']);
  assert.equal(u.mehr.wieder_in_ms, 500);
});

test('requests with the same aufruf cost one; without aufruf each costs', () => {
  const { regel } = neu();
  for (let i = 0; i < 50; i++) assert.equal(regel(schreib({ aufruf: 'x' })), null);
  for (let i = 0; i < 19; i++) assert.equal(regel(schreib({ aufruf: `a${i}` })), null);
  assert.equal(regel(schreib({ aufruf: 'z' })).code, 429);
  const { regel: r2 } = neu();
  for (let i = 0; i < 20; i++) assert.equal(r2(schreib()), null);
  assert.equal(r2(schreib()).code, 429);
});

test('after 1 s two more pass', () => {
  const { uhr, regel } = neu();
  for (let i = 0; i < 20; i++) regel(schreib({ aufruf: `a${i}` }));
  uhr.t += 1000;
  assert.equal(regel(schreib({ aufruf: 'b1' })), null);
  assert.equal(regel(schreib({ aufruf: 'b2' })), null);
  assert.equal(regel(schreib({ aufruf: 'b3' })).code, 429);
});

test('destructive bucket is separate: 3 pass, 4th refused after 20 s retry', () => {
  const { uhr, regel } = neu();
  for (let i = 0; i < 3; i++) assert.equal(regel(zerstoer({ aufruf: `d${i}` })), null);
  const u = regel(zerstoer({ aufruf: 'd3' }));
  assert.deepEqual([u.code, u.mehr.wieder_in_ms], [429, 20000]);
  assert.equal(regel(schreib({ aufruf: 'w' })), null);
  uhr.t += 20000;
  assert.equal(regel(zerstoer({ aufruf: 'd4' })), null);
});

test('keys are separate; GET, /abbruch, the person and reading POST are never charged', () => {
  const { regel } = neu();
  for (let i = 0; i < 20; i++) regel(schreib({ aufruf: `a${i}` }));
  assert.equal(regel(schreib({ wer: wer('anderer'), aufruf: 'n' })), null);
  for (let i = 0; i < 30; i++) {
    assert.equal(regel(schreib({ methode: 'GET', aufruf: `g${i}` })), null);
    assert.equal(regel(schreib({ pfad: '/abbruch' })), null);
    assert.equal(regel(schreib({ wer: null, quelle: 'andreas' })), null);
    assert.equal(regel(schreib({ werkzeug: 'proj_analyse', pfad: '/proj/analyse', aufruf: `r${i}` })), null);
  }
});

test('at most 100 keys are kept: the oldest is forgotten', () => {
  const { regel } = neu();
  for (let i = 0; i < 20; i++) regel(schreib({ aufruf: `a${i}` }));
  assert.equal(regel(schreib({ aufruf: 'a20' })).code, 429);
  for (let i = 0; i < 100; i++) regel(schreib({ wer: wer(`k${i}`), aufruf: 'p' }));
  assert.equal(regel(schreib({ aufruf: 'a21' })), null);
});
