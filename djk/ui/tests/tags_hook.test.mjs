// Plan 7 task 12: the tags hook starts one niced child at a time (fake start seam, no real process).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { tagsHook } from '../tags/hook.ts';

const fake = () => { const k = new EventEmitter(); k.unref = () => {}; return k; };
const opt = (start) => ({ python: '/py/python', cwd: '/repo/djk', katalog: '/k/katalog.sqlite', tags: '/k/tags.sqlite', start });

test('the argv is ionice, nice, python -m bibliothek.tags_measure with both paths', () => {
  const gesehen = [];
  const h = tagsHook(opt((argv, o) => { gesehen.push({ argv, o }); return fake(); }));
  h();
  assert.deepEqual(gesehen[0].argv, ['ionice', '-c3', 'nice', '-n', '19', '/py/python', '-m', 'bibliothek.tags_measure', '--katalog', '/k/katalog.sqlite', '--tags', '/k/tags.sqlite']);
  assert.equal(gesehen[0].o.cwd, '/repo/djk');
});

test('a call while a child runs is dropped; after it exits the next call starts one', () => {
  const kinder = [];
  const h = tagsHook(opt(() => { const k = fake(); kinder.push(k); return k; }));
  h(); h();
  assert.equal(kinder.length, 1);
  kinder[0].emit('exit', 0);
  h();
  assert.equal(kinder.length, 2);
});

test('a throwing start or an error event does not throw and frees the slot', () => {
  let n = 0; const logs = [];
  const h = tagsHook({ ...opt(() => { n++; throw new Error('no ionice'); }), log: (z) => logs.push(z) });
  assert.doesNotThrow(() => h());
  h();
  assert.equal(n, 2);
  assert.ok(logs.length >= 1);
  const k = fake(); let m = 0;
  const h2 = tagsHook(opt(() => { m++; return k; }));
  h2(); k.emit('error', new Error('x')); h2();
  assert.equal(m, 2);
});
