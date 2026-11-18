// The APC20 in PRODUCTION, server side (areas/controller/pult_production.ts): tracks in order, banks of eight.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pultSpuren, bankenVon, klemmeBank } from '../areas/controller/pult_production.ts';

test('pultSpuren: track order, rows 1..32 only, mute/solo/arm', () => {
  const p = { spuren: [{ id: 'b', nr: 2, name: 'B', mute: true }, { id: 'a', nr: 1, name: 'A', solo: true, aufnahme: { scharf: true } }, { id: 'z', nr: 33, name: 'Z' }] };
  assert.deepEqual(pultSpuren(p), [{ nr: 1, id: 'a', name: 'A', mute: false, solo: true, arm: true }, { nr: 2, id: 'b', name: 'B', mute: true, solo: false, arm: false }]);
  assert.deepEqual(pultSpuren(null), []);
});

test('banks of eight', () => {
  assert.equal(bankenVon(0), 1);
  assert.equal(bankenVon(8), 1);
  assert.equal(bankenVon(9), 2);
  assert.equal(klemmeBank(5, 9), 1);
  assert.equal(klemmeBank(-1, 9), 0);
});
