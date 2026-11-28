// UI polish minors: RELATED shows file names, the STUDIO undo tooltip goes through labelText, the search placeholder has contrast.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { itemText, verwandtZeilen } from '../public/browser/verwandt.js';
import { handQuelle } from '../../hand/tests/support/hand_source.mjs';

const SHA = '1639f39a0000000000000000000000000000000000000000000000000000abcd';

test('itemText: a file shows its name from the resolver, the short sha only without one', () => {
  assert.equal(itemText(`datei:${SHA}`), 'file 1639f39a');
  assert.equal(itemText(`datei:${SHA}`, new Map([[SHA, 'Kick 01.wav']])), 'Kick 01.wav');
  assert.equal(itemText(`datei:${SHA}`, (s) => (s === SHA ? 'Snare.wav' : null)), 'Snare.wav');
  assert.equal(itemText(`datei:${SHA}`, new Map()), 'file 1639f39a');
  assert.equal(itemText('take:p/aufnahme 1.wav'), 'aufnahme 1.wav');
});

test('verwandtZeilen passes the names on and keeps the item id for the tooltip', () => {
  const z = verwandtZeilen({ passt_zu: [`datei:${SHA}`, 'preset:surge:Lead'] }, new Map([[SHA, 'Kick 01.wav']]));
  assert.deepEqual(z.map((x) => x.text), ['Kick 01.wav', 'Lead']);
  assert.equal(z[0].item, `datei:${SHA}`);
});

test('the STUDIO undo and redo tooltips show the label through labelText', () => {
  const kopf = fs.readFileSync(new URL('../public/werkbank/kopf.js', import.meta.url), 'utf8');
  assert.match(kopf, /import \{ undoStand, labelText \} from '\.\.\/production\/verlauf\.js'/);
  assert.match(kopf, /`Undo: \$\{labelText\(u\.undo\.label\)\} \(Ctrl\+Z\)`/);
  assert.match(kopf, /`Redo: \$\{labelText\(u\.redo\.label\)\} \(Ctrl\+Shift\+Z\)`/);
});

test('the hand text names the undo step "Cypher Modular: save sound"', () => {
  const hand = handQuelle();
  assert.ok(hand.includes('one undo step "Cypher Modular: save sound"'));
  assert.ok(!hand.includes('"Baukasten: save sound"'));
});
