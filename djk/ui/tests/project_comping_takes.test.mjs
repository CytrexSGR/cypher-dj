// 1.14 comping, slice 1, task 3: the server copy rule istTakeKopie (project/takes.ts) on the fixtures shared with the page (tests/helpers/take_fixtures.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { istTakeKopie } from '../project/takes.ts';
import { TAKE_KOPIE_FIXTURES, audio } from './helpers/take_fixtures.mjs';

test('istTakeKopie: every shared fixture gives the verdict the page expects', () => {
  assert.ok(TAKE_KOPIE_FIXTURES.length >= 16, `fixtures found: ${TAKE_KOPIE_FIXTURES.length}`);
  assert.ok(TAKE_KOPIE_FIXTURES.some((f) => f.erwartet) && TAKE_KOPIE_FIXTURES.some((f) => !f.erwartet), 'both verdicts are covered');
  const abweichend = TAKE_KOPIE_FIXTURES.filter((f) => istTakeKopie(f.haupt, f.take, f.bpm) !== f.erwartet).map((f) => f.name);
  assert.deepEqual(abweichend, [], 'fixtures where the server disagrees with the page');
});

test('istTakeKopie: a midi clip is never a copy, and the inputs are not changed', () => {
  const t = audio('c1', 'A', 0, 8, 0), m = audio('m1', 'A', 0, 8, 0), vorher = JSON.stringify([t, m]);
  assert.equal(istTakeKopie({ ...m, art: 'midi' }, t, 120), false);
  assert.equal(istTakeKopie(m, t, 120), true);
  assert.equal(JSON.stringify([t, m]), vorher);
});
