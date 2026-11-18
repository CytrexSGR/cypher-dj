// Audit U23: Ctrl+D in the slice grid copies the upbeat hit of cell 0 (last half cell of the pattern) in front of the target cell, not behind the pattern end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dupliziereBefehle } from '../public/werkbank/grid_seq.js';
import { imSchritt } from '../public/werkbank/grid.js';

const klip = (noten) => ({ id: 'c1', art: 'midi', start_beat: 0, laenge_beats: 16, loop_beats: 4, noten });

test('audit U23: the upbeat hit of step 0 is copied to just before the target cell and stays inside the pattern', () => {
  const c = klip([{ id: 'n1', beat: 3.95, laenge: 0.05, ton: 0, vel: 100 }]);
  const auswahl = [0, 1, 2, 3].map((quelle) => ({ ton: 0, quelle }));
  const r = dupliziereBefehle(c, 'slice', auswahl, 16);
  assert.equal(r.befehle.length, 1, 'one copy');
  const beat = r.befehle[0].noten[0].beat;
  assert.ok(beat < 4, `the copy lies inside the pattern, got ${beat}`);
  assert.equal(Math.round(beat * 1e6) / 1e6, 0.95);
  const kopie = klip([{ id: 'n1', beat: 3.95, laenge: 0.05, ton: 0, vel: 100 }, { id: 'n2', ...r.befehle[0].noten[0] }]);
  assert.equal(imSchritt(kopie, 0, 4, 'slice', 16).length, 1, 'the grid shows the copy on cell 4');
});

test('audit U23 control: an ordinary hit is shifted by the width of the selection', () => {
  const c = klip([{ id: 'n1', beat: 0.5, laenge: 0.25, ton: 0, vel: 100 }]);
  const r = dupliziereBefehle(c, 'slice', [0, 1, 2, 3].map((quelle) => ({ ton: 0, quelle })), 16);
  assert.equal(r.befehle[0].noten[0].beat, 1.5);
});
