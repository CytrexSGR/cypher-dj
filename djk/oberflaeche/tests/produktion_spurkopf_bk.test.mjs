// Baukasten S20 task 6: the track head of the production page shows a Baukasten device as "BK · <graph>". The graph name is set with
// textContent (spurkoepfe.js), so a name that looks like HTML is never parsed as HTML; the model also limits it to [a-z0-9_-].
import test from 'node:test';
import assert from 'node:assert/strict';
import { geraetText } from '../oeffentlich/produktion/spurkoepfe.js';

const bk = (graph) => ({ art: 'instrument', geraet: { art: 'intern', name: 'bk', graph, parameter: {} } });

test('S20 track head: a bk device reads BK · <graph>', () => {
  assert.equal(geraetText(bk('juno-pad')), 'BK · juno-pad');
  assert.equal(geraetText(bk('sampler-fairlight')), 'BK · sampler-fairlight');
});

test('S20 track head: the other devices are unchanged (negative control)', () => {
  assert.equal(geraetText({ art: 'audio' }), 'AUDIO');
  assert.equal(geraetText({ art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} } }), 'RB-338');
  assert.equal(geraetText({ art: 'instrument', geraet: { art: 'wirt', name: 'surge', slot: 1 } }), 'SURGE · 1');
  // an unknown intern device keeps the old fallback, it is not shown as a bk track
  assert.equal(geraetText({ art: 'instrument', geraet: { art: 'intern', name: 'xyz' } }), 'XYZ');
});
