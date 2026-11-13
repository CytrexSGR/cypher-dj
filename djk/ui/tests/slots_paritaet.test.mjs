// DJ view places, task 13: the page copy of the silence rule agrees with kanalOffen of hand_operation.ts over one table of values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kanalOffen as hand } from '../hand_operation.ts';
import { kanalOffen as seite, KANAL_OFFEN_DB } from '../public/slots.js';

const FADER = [-200, -60, -30, -26.1, -26, -25.9, -20, 0, 6, undefined];
const TRIM = [-12, -6, 0, 6, undefined];

test('the page copy of kanalOffen equals the hand rule for every trim and fader value', () => {
  for (const f of FADER) for (const t of TRIM) {
    const r = {};
    if (f !== undefined) r['deck/1/fader'] = f;
    if (t !== undefined) r['deck/1/trim'] = t;
    assert.equal(seite(r, 'deck/1'), hand(r, 'deck/1'), `fader ${f} trim ${t}`);
  }
});

test('the boundary: -26 dB is closed, -26.1 dB is closed, -25.9 dB is open (trim 0)', () => {
  assert.equal(KANAL_OFFEN_DB, -26);
  for (const [f, offen] of [[-26, false], [-26.1, false], [-25.9, true]]) {
    assert.equal(seite({ 'pad/1/fader': f, 'pad/1/trim': 0 }, 'pad/1'), offen, `${f}`);
    assert.equal(hand({ 'pad/1/fader': f, 'pad/1/trim': 0 }, 'pad/1'), offen, `${f} (hand)`);
  }
});
