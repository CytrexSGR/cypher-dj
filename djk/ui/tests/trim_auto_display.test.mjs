// Pegel-fixe: the automatic gain of the player branch is shown read-only as "AUTO +x.x dB" next to the GAIN knob, and it counts for "open".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatiere } from '../public/curves.js';
import { kanalOffen as hand } from '../hand_operation.ts';
import { kanalOffen as seite } from '../public/slots.js';
import { kanalAnsicht, istKanalZustand } from '../public/live_module.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');

test('the label text: AUTO with sign and one decimal', () => {
  assert.equal(formatiere('deck/1/trim_auto', 18.5), 'AUTO +18.5 dB');
  assert.equal(formatiere('pad/2/trim_auto', -6.6), 'AUTO −6.6 dB');
  assert.equal(formatiere('deck/2/trim_auto', 0), '');   // unloaded deck or no auto part: no label
  assert.equal(formatiere('deck/1/trim_auto', undefined), '');
});

test('the hand knob keeps its own text (trim is the hand part)', () => {
  assert.equal(formatiere('deck/1/trim', 1), '+1.0 dB');
});

test('the strip template carries a read-only output for trim_auto beside the GAIN knob, hidden until the core reported it', () => {
  const zug = /<template id="zug-vorlage">[\s\S]*?<\/template>/.exec(html)[0];
  const gain = /<label>GAIN<\/label>[^\n]*/.exec(zug)[0];
  assert.match(gain, /<output class="auto-trim vorgabe" data-wert-teil="trim_auto"/);
  assert.ok(!/data-teil="trim_auto"/.test(zug), 'no control may write trim_auto');
  assert.match(css, /\.zug \.beschrift output\.auto-trim\.vorgabe, \.zug \.beschrift output\.auto-trim:empty\s*\{\s*display: none/);
});

test('open = hand trim + auto trim + fader above -26 dB, in all three copies', () => {
  const r = { 'deck/1/trim': 0, 'deck/1/trim_auto': -30, 'deck/1/fader': 0 };
  assert.equal(hand(r, 'deck/1'), false);
  assert.equal(seite(r, 'deck/1'), false);
  assert.equal(kanalAnsicht('A', { 'deck/1/trim': 0, 'deck/1/trim_auto': -30, 'deck/1/fader': 0 }).offen, false);
  const o = { 'deck/1/trim': 1, 'deck/1/trim_auto': 18.5, 'deck/1/fader': -40 };
  assert.equal(hand(o, 'deck/1'), true);
  assert.equal(seite(o, 'deck/1'), true);
  assert.equal(kanalAnsicht('A', o).offen, true);
});

test('a change of trim_auto redraws the live view', () => {
  assert.equal(istKanalZustand('deck/1/trim_auto'), true);
});
