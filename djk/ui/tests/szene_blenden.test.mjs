// Strand 11 slice 5 (5.2, fix A2): fades continue on a live scene restore. blendenFortsetzen rewrites .rein/.raus with the bars already elapsed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { blendenFortsetzen, planeLaden } from '../szene.ts';

test('rein half way: .rein(n, elapsed); an earlier schon adds up', () => {
  assert.equal(blendenFortsetzen('s("hh*4").rein(8)', 3), 's("hh*4").rein(8, 3)');
  assert.equal(blendenFortsetzen('s("hh*4").rein(8, 2)', 3), 's("hh*4").rein(8, 5)');
});

test('rein done: the call goes, the layer is at full level', () => {
  assert.equal(blendenFortsetzen('s("hh*4").rein(8)', 8), 's("hh*4")');
  assert.equal(blendenFortsetzen('s("hh*4").rein(4, 1).gain(0.5)', 5), 's("hh*4").gain(0.5)');
});

test('raus half way: .raus(n, elapsed)', () => {
  assert.equal(blendenFortsetzen('s("bd*4").raus(4)', 1), 's("bd*4").raus(4, 1)');
});

test('raus done: the top-level pattern of one expression becomes silence', () => {
  assert.equal(blendenFortsetzen('s("bd*4").raus(4)', 4), 'silence');
  assert.equal(blendenFortsetzen('stack(s("bd"), s("hh")).raus(2, 1)', 1), 'silence');
});

test('nested in stack: rein and raus rewritten in place, a finished raus becomes .raus(n, n - 0.001) (a scaling, a later gain cannot lift it), the rest stays', () => {
  const t = 'stack(s("bd*4").raus(2), s("hh*8").rein(8), note("c2").s("sawtooth"))';
  assert.equal(blendenFortsetzen(t, 2), 'stack(s("bd*4").raus(2, 1.999), s("hh*8").rein(8, 2), note("c2").s("sawtooth"))');
  assert.equal(blendenFortsetzen(t, 1), 'stack(s("bd*4").raus(2, 1), s("hh*8").rein(8, 1), note("c2").s("sawtooth"))');
});

test('unknown anchor, non-numeric arguments and calls inside strings stay as they are', () => {
  const t = 's("hh*4").rein(8)';
  assert.equal(blendenFortsetzen(t, -1), t);
  assert.equal(blendenFortsetzen('s("x").rein(n)', 3), 's("x").rein(n)');
  assert.equal(blendenFortsetzen('s(".rein(2)")', 3), 's(".rein(2)")');
});

test('planeLaden: fades continue from the stored switch bar; equal text with a new phase is sent again; a playing stream without text gets silence', () => {
  const s = { v: 1, takt: 10, muster: { 2: 's("a").rein(8)', 3: 'note("c")' }, anker: { 2: 7 }, regler: {}, graphen: {} };
  const p = planeLaden(s, { muster: { 3: 'note("c")', 5: 'note("e")' }, regler: {}, graphen: {} }, 0, () => false, 14);
  assert.deepEqual(p.muster, [{ strom: 2, text: 's("a").rein(8, 3)', versatz: 4 }, { strom: 3, text: 'note("c")', versatz: 4 }, { strom: 5, text: 'silence', versatz: 0 }]);
  // same phase: nothing to send for stream 3
  const q = planeLaden(s, { muster: { 3: 'note("c")' }, regler: {}, graphen: {}, versatz: { 3: 4 } }, 0, () => false, 14);
  assert.deepEqual(q.muster.map((m) => m.strom), [2]);
});
