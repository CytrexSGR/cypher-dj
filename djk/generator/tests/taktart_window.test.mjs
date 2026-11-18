// Plan studio-taktart T1: one Strudel cycle is proTakt beats. The 4/4 golden lives in taktart_window_4.test.mjs (fixtures from the old code).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { kompiliere } from '../src/compile.mjs';
import { ereignisse } from '../src/window.mjs';
import { KIT, MIDI } from './fixtures/taktart_4_korpus.mjs';

const m = (t) => kompiliere(t).muster;
const evs = (text, kit, a, b, pt) => ereignisse([{ ab: 0, muster: m(text) }], kit, a, b, pt).evs;
const golden = JSON.parse(fs.readFileSync(fileURLToPath(new URL('fixtures/taktart_4_fenster.json', import.meta.url)), 'utf8'));

test('proTakt 3: s("bd*3") over [3, 9) hits on 3,4,5,6,7,8', () => {
  assert.deepEqual(evs('s("bd*3")', KIT, 3, 9, 3).map((e) => e.beat), [3, 4, 5, 6, 7, 8]);
});

test('proTakt 3: note("c3 e3 g3") puts the notes on 3,4,5 and 6,7,8 with dauer 1', () => {
  const e = evs('note("c3 e3 g3")', MIDI, 3, 9, 3);
  assert.deepEqual(e.map((x) => x.beat), [3, 4, 5, 6, 7, 8]);
  assert.deepEqual(e.map((x) => x.note), [48, 52, 55, 48, 52, 55]);
  assert.ok(e.every((x) => Math.abs(x.dauer - 1) < 1e-9));   // fractions of a cycle carry float noise
});

test('proTakt 3: a slow(2) pattern has events at 0, 6 and 12 only (a cycle is 3 beats, the pattern spans 6)', () => {
  assert.deepEqual(evs('s("bd").slow(2)', KIT, 0, 13, 3).map((e) => e.beat), [0, 6, 12]);
  assert.deepEqual(evs('s("bd").slow(2)', KIT, 3, 6, 3).map((e) => e.beat), []);
});

test('proTakt 3: a half-cycle note lasts 1.5 beats', () => {
  assert.deepEqual(evs('note("c3 e3")', MIDI, 3, 6, 3).map((e) => [e.beat, e.dauer]), [[3, 1.5], [4.5, 1.5]]);
});

test('a plan entry keeps its own proTakt next to the default of the call', () => {
  const plan = [{ ab: 0, muster: m('s("bd*3")'), proTakt: 3 }];
  assert.deepEqual(ereignisse(plan, KIT, 0, 6, 4).evs.map((e) => e.beat), [0, 1, 2, 3, 4, 5]);
});

test('explicit proTakt 4 and the default argument equal the 4/4 golden', () => {
  const korpus = [['s("bd*4")', KIT], ['note("[c3,e3,g3]")', MIDI], ['note("c3 e3").slow(3)', MIDI]];
  for (const [text, kit] of korpus) {
    const g = golden.find((x) => x.text === text);
    for (const arg of [[], [4]]) {
      const ist = g.fenster.map((f) => ereignisse([{ ab: 0, muster: m(text), nr: 1 }], kit, f.a, f.b, ...arg).evs);
      assert.deepEqual(JSON.parse(JSON.stringify(ist)), g.fenster.map((f) => f.evs), `${text} ${arg}`);
    }
  }
});
