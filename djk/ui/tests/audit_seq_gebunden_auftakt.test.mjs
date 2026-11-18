// Audit U24: a wrapped upbeat hit on a cut track (placed in cell 0) must not tie the whole bar in the pitched lane.
import test from 'node:test';
import assert from 'node:assert/strict';
import { folgeSicht } from '../public/seq_logic.js';

const INFO = { art: 'bk', regler: [], klaenge: [] };
const spur = (graph) => ({ id: 's1', name: 'Bass', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph, parameter: {} } });
const clip = (noten) => ({ id: 'c1', art: 'midi', name: 'Bass', start_beat: 0, laenge_beats: 64, loop_beats: 4, noten });
const zellen = (s, c) => folgeSicht(s, c, INFO).zeilen.find((z) => z.id === 'noten').zellen;

test('audit U24: a 0.1 beat hit at 3.9 on a cut track is cell 0, nothing is tied', () => {
  const z = zellen(spur('smp-x'), clip([{ id: 'n1', beat: 3.9, laenge: 0.1, ton: 60, vel: 100 }]));
  assert.equal(z[0].an, true);
  assert.equal(z.filter((c) => c.gebunden).length, 0, 'a 0.1 beat note ties no cell');
});

test('audit U24: a wrapped hit that is long enough ties the cells it sounds into after the wrap', () => {
  const z = zellen(spur('smp-x'), clip([{ id: 'n1', beat: 3.9, laenge: 0.6, ton: 60, vel: 100 }]));   // 0.1 before the pass, 0.5 into it
  assert.deepEqual(z.map((c, i) => (c.gebunden ? i : null)).filter((i) => i !== null), [1]);
});

test('audit U24 control: a normal long note on a baukasten track still ties', () => {
  const z = zellen(spur('bass'), clip([{ id: 'n1', beat: 0, laenge: 1, ton: 60, vel: 100 }]));
  assert.deepEqual(z.map((c, i) => (c.gebunden ? i : null)).filter((i) => i !== null), [1, 2, 3]);
});
