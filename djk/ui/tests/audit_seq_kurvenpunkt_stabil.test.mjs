// Audit U25: a curve point grabbed in the SEQ deck is named by its beat at write time, not by the index it had when it was pressed: a write
// that is still out can re-sort the list (kurveBefehle sorts by beat), and the old index then names another point.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { kurveVerschiebe, kurveWeg, kurvePunktBei } from '../public/seq_field.js';

const lane = (beats) => ({ id: 'z1', art: 'kurve', ziel: 'geraet.k3', punkte: beats.map((beat) => ({ beat, wert: 0.5 })) });

test('audit U25: after another point was dragged past it, the pressed point is found by its beat', () => {
  const z = lane([1, 1.5, 2]);                 // A(0) was dragged to 1.5 and the list re-sorted: B(1), A(1.5), C(2); B was pressed as index 1
  const i = kurvePunktBei(z, 1, 1);
  assert.equal(i, 0, 'B is index 0 now');
  assert.deepEqual(kurveVerschiebe(z, i, 3, 0.9).map((p) => p.beat), [3, 1.5, 2]);
  assert.deepEqual(kurveWeg(z, i).map((p) => p.beat), [1.5, 2], 'a removal takes B, not A');
});

test('audit U25: unchanged list keeps the pressed index; a point that is gone gives -1', () => {
  assert.equal(kurvePunktBei(lane([0, 1, 2]), 1, 1), 1);
  assert.equal(kurvePunktBei(lane([0, 1, 1, 2]), 1, 2), 2, 'two points on one beat (a jump): the pressed one stays');
  assert.equal(kurvePunktBei(lane([0, 2]), 1, 1), -1);
});

test('audit U25: the deck resolves the pressed point through kurvePunktBei when the write is its turn', () => {
  const q = fs.readFileSync(new URL('../public/seq_view.js', import.meta.url), 'utf8');
  assert.doesNotMatch(q, /kurveVerschiebe\(z, g\.i,/);
  assert.equal(q.match(/kurvePunktBei\(z, g\.beat0, g\.i\)/g)?.length, 2, 'move and removal both resolve by beat');
});
