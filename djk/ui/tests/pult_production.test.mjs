// The APC20 in PRODUCTION, server side (areas/controller/pult_production.ts): tracks in order, banks of eight.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pultSpuren, bankenVon, klemmeBank, SPUR_ZEILEN } from '../areas/controller/pult_production.ts';
import { MAX_SPUREN } from '../project/model.ts';

test('pultSpuren: track order, rows 1..MAX_SPUREN only, mute/solo/arm', () => {
  const p = { spuren: [{ id: 'b', nr: 2, name: 'B', mute: true }, { id: 'a', nr: 1, name: 'A', solo: true, aufnahme: { scharf: true } }, { id: 'z', nr: MAX_SPUREN + 1, name: 'Z' }] };
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

test('the APC reaches every track the project may hold', () => {
  assert.equal(SPUR_ZEILEN, MAX_SPUREN);
});

test('a project with 40 tracks has 5 banks, bank 4 holds tracks 33..40', () => {
  assert.equal(bankenVon(40), 5);
  assert.equal(klemmeBank(9, 40), 4);
  // through pultSpuren: tracks 33..40 only exist for the APC once MAX_SPUREN is 128 (task 6.4)
  const p = { spuren: Array.from({ length: 40 }, (_, i) => ({ id: `s${i + 1}`, nr: i + 1, name: `T${i + 1}` })) };
  const spuren = pultSpuren(p);
  assert.equal(spuren.length, Math.min(40, MAX_SPUREN));
  const bank4 = spuren.slice(4 * 8, 5 * 8).map((s) => s.nr);
  assert.deepEqual(bank4, MAX_SPUREN >= 40 ? [33, 34, 35, 36, 37, 38, 39, 40] : []);
});
