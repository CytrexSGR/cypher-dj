// While-music-plays rule: pure, no server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spielRegel } from '../http/hand_spielregel.ts';

const q = (o = {}) => ({ methode: 'POST', pfad: '/x', quelle: 'cypher', wer: { id: 'k', name: 'k', stufe: 'zerstoerend' }, werkzeug: null, aktion: null, aufruf: null, ...o });

test('music plays: deletes, exports and a DELETE without a tool refused', () => {
  const r = spielRegel(() => true);
  const e = r(q({ werkzeug: 'proj_export' }));
  assert.deepEqual([e.code, e.fehler, e.mehr], [409, 'musik_laeuft', { art: 'exportiert' }]);
  assert.equal(r(q({ werkzeug: 'kits', aktion: 'loeschen' })).fehler, 'musik_laeuft');
  assert.equal(r(q({ methode: 'DELETE' })).fehler, 'musik_laeuft');
  assert.equal(r(q()), null, 'a raw POST of a live script passes');
});

test('music plays: stop tools, writes, GET and the person pass', () => {
  const r = spielRegel(() => true);
  assert.equal(r(q({ werkzeug: 'deck_stopp' })), null);
  assert.equal(r(q({ werkzeug: 'stille' })), null);
  assert.equal(r(q({ werkzeug: 'regler' })), null);
  assert.equal(r(q({ werkzeug: 'proj_export', methode: 'GET' })), null);
  assert.equal(r(q({ werkzeug: 'proj_export', wer: null })), null);
});

test('nothing plays: everything passes', () => {
  const r = spielRegel(() => false);
  for (const w of ['proj_export', 'deck_stopp', 'regler', null]) assert.equal(r(q({ werkzeug: w })), null);
  assert.equal(r(q({ werkzeug: 'kits', aktion: 'loeschen' })), null);
});
