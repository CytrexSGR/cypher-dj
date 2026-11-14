// SOUND column of the Strudel place (strudel_sound.js, 2026-11-14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knopfNamen } from '../public/effects.js';

test('the four knobs are the first four named knobs of the loaded instrument', () => {
  const graphen = [{ name: 'juno-pad', regler_namen: { 1: 'Cutoff', 2: 'Resonance', 3: 'Env amount', 4: 'Attack', 5: 'Release' } }, { name: 'saite', regler_namen: { 1: 'Helligkeit', 2: 'Ausklang' } }];
  assert.deepEqual(knopfNamen(graphen, 'juno-pad'), [[1, 'Cutoff'], [2, 'Resonance'], [3, 'Env amount'], [4, 'Attack']]);
  assert.deepEqual(knopfNamen(graphen, 'saite'), [[1, 'Helligkeit'], [2, 'Ausklang']]);
  assert.equal(knopfNamen(graphen, ''), null);   // the host plays: no knobs here
});
