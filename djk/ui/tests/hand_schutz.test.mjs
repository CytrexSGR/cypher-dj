// Agent brake rule and the rule runner: pure, no server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bremsRegel, pruefeHand } from '../http/hand_schutz.ts';

const anfrage = (o = {}) => ({ methode: 'POST', pfad: '/regler', quelle: 'cypher', wer: null, werkzeug: null, aktion: null, aufruf: null, ...o });

test('bremsRegel: braked, an agent write is refused with ki_gestoppt 409', () => {
  const u = bremsRegel(() => true)(anfrage());
  assert.equal(u.ok, false);
  assert.deepEqual([u.code, u.fehler], [409, 'ki_gestoppt']);
  assert.match(u.text, /Stop Cypher/);
});

test('bremsRegel: reads, /abbruch, the person and an unbraked state pass', () => {
  const b = bremsRegel(() => true);
  assert.equal(b(anfrage({ methode: 'GET' })), null);
  assert.equal(b(anfrage({ methode: 'HEAD' })), null);
  assert.equal(b(anfrage({ pfad: '/abbruch' })), null);
  assert.equal(b(anfrage({ quelle: 'andreas' })), null);
  assert.equal(bremsRegel(() => false)(anfrage()), null);
});

test('pruefeHand: the first objection wins, else ok', () => {
  const nein = (fehler) => () => ({ ok: false, code: 400, fehler, text: fehler });
  assert.deepEqual(pruefeHand([() => null, nein('a'), nein('b')], anfrage()).fehler, 'a');
  assert.deepEqual(pruefeHand([() => null], anfrage()), { ok: true });
  assert.deepEqual(pruefeHand([], anfrage()), { ok: true });
});
