// Browser section shell (browser plan 2, task 3): the honest states of a read, and the per-section open state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { holeAbschnitt, abschnittSchluessel, liesAbschnittOffen, merkeAbschnittOffen } from '../public/browser/abschnitt.js';

const host = (r) => ({ holeGet: async () => r });

test('holeAbschnitt: 404 is nicht_da', async () => {
  assert.deepEqual(await holeAbschnitt(host({ status: 404, j: null }), '/x'), { zustand: 'nicht_da' });
});
test('holeAbschnitt: 409 kein_projekt (fehler or grund)', async () => {
  assert.equal((await holeAbschnitt(host({ status: 409, j: { fehler: 'kein_projekt' } }), '/x')).zustand, 'kein_projekt');
  assert.equal((await holeAbschnitt(host({ status: 409, j: { grund: 'kein_projekt' } }), '/x')).zustand, 'kein_projekt');
});
test('holeAbschnitt: other refusals are fehler with the server text', async () => {
  const r = await holeAbschnitt(host({ status: 500, j: { text: 'disk is full' } }), '/x');
  assert.deepEqual([r.zustand, r.text], ['fehler', 'disk is full']);
  assert.equal((await holeAbschnitt(host({ status: 409, j: { fehler: 'anderes' } }), '/x')).zustand, 'fehler');
  const netz = await holeAbschnitt(host({ status: 0, j: { fehler: 'netz', text: 'offline' } }), '/x');
  assert.deepEqual([netz.zustand, netz.text], ['fehler', 'offline']);
  assert.equal((await holeAbschnitt(host({ status: 500, j: null }), '/x')).text.length > 0, true, 'a text exists without a body');
});
test('holeAbschnitt: 200 is inhalt with the body', async () => {
  const r = await holeAbschnitt(host({ status: 200, j: { audio: [] } }), '/x');
  assert.deepEqual([r.zustand, r.j], ['inhalt', { audio: [] }]);
});
test('section open state: per id, default kept without storage', () => {
  assert.equal(abschnittSchluessel('projekt'), 'djk-browser-abschnitt-projekt');
  const m = new Map();
  const s = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
  assert.equal(liesAbschnittOffen(s, 'projekt', true), true);
  merkeAbschnittOffen(s, 'projekt', false);
  assert.equal(liesAbschnittOffen(s, 'projekt', true), false);
  const kaputt = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
  assert.equal(liesAbschnittOffen(kaputt, 'projekt', false), false);
  merkeAbschnittOffen(kaputt, 'projekt', true);
});
