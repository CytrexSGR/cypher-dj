// UI polish T7 (Nr. 4): a Surge host that does not answer is a plain note, not a red error, and the knobs stay as they are.
import test from 'node:test';
import assert from 'node:assert/strict';
import { surgeIstEinlesen, GERAET_TEXT } from '../public/production/device_view.js';

const TABELLE = [{ name: 'a_filter1_cutoff', min: -60, max: 70, log: false, vorgabe: 0.5 }];
const spur = { id: 's1', nr: 1, name: 'Lead', art: 'instrument', geraet: { art: 'wirt', name: 'surge', slot: 1, parameter: {} }, clips: [] };

test('the Surge text says the host does not answer yet and that knobs show default values', () => {
  assert.equal(GERAET_TEXT.istFehlt, 'The Surge host does not answer yet. Knobs show default values until it does.');
});

test('surgeIstEinlesen with a 409 answer leaves the parameters unchanged and calls melde with the new text and false (a note, not red)', async () => {
  const gemeldet = [];
  const tab = await surgeIstEinlesen({ holeGet: async () => ({ status: 409, j: { fehler: 'wirt_antwortet_nicht' } }), melde: (t, f) => gemeldet.push([t, f]) }, spur, TABELLE, ['a_filter1_cutoff']);
  assert.deepEqual(tab, TABELLE);
  assert.deepEqual(gemeldet, [['The Surge host does not answer yet. Knobs show default values until it does.', false]]);
});

test('a thrown request gives the same note; an answering host gives no note', async () => {
  const gemeldet = [];
  await surgeIstEinlesen({ holeGet: async () => { throw new Error('down'); }, melde: (t, f) => gemeldet.push(f) }, spur, TABELLE, ['a_filter1_cutoff']);
  assert.deepEqual(gemeldet, [false]);
  const still = [];
  await surgeIstEinlesen({ holeGet: async () => ({ status: 200, j: { werte: { a_filter1_cutoff: 5 } } }), melde: (t, f) => still.push(f) }, spur, TABELLE, ['a_filter1_cutoff']);
  assert.deepEqual(still, []);
});
