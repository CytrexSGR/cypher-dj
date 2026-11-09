// node --test tests/track_pool.test.mjs: mehrkern slice 3.2 Task 8. The dummy has no pool, so like the kern without one it says /zustand/spur_pool with an 0
// (all nine values 0): the contract tests and the page see the address, and /lage.spur_pool reads an: false, modus 'aus'. Every 24 000 samples (2 Hz).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahre } from '../sequences_fast.mjs';
import { S, sende } from './help.mjs';

test('dummy: /zustand/spur_pool ,iiiiiiiii with an 0 and nothing else, repeatedly', () => {
  const r = fahre([sende(S(1), ['/k/ki/frei', 'hs', 2, 'andreas']), sende(S(9), ['/k/ki/frei', 'hs', 3, 'andreas'])]);
  const m = r.log.filter((x) => x.adresse === '/zustand/spur_pool');
  assert.ok(m.length >= 2, `at least twice, got ${m.length}`);
  for (const x of m) {
    assert.equal(x.typen, 'iiiiiiiii');
    assert.deepEqual(x.werte, [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  }
});
