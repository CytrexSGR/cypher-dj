// The stems run pins itself only when djk-start handed over a mask (CYPHERDJ_STEMS_CPUS): no host-specific fallback list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stemsBefehl } from '../areas/proj/stems_run.ts';

const REST = ['nice', '-n', '19', 'ionice', '-c3', 'python3', '-m', 'werkstatt.stems'];

test('with a mask the run goes through taskset', () => {
  const b = stemsBefehl('4-7,12-15', REST);
  assert.equal(b.cmd, 'taskset');
  assert.deepEqual(b.args, ['-c', '4-7,12-15', ...REST]);
});

test('without a mask (empty or blanks) there is no taskset at all', () => {
  for (const leer of ['', '  ']) {
    const b = stemsBefehl(leer, REST);
    assert.equal(b.cmd, 'nice');
    assert.deepEqual(b.args, REST.slice(1));
  }
});
