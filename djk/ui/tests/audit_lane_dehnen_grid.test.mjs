// Audit U13: auto_dehnen on ordinary quarter-beat grid values must not leave the stretched end point one ulp beside neuBis (the list is then no longer
// rising and the command is refused). The page copy (public/production/lanes_tools.js) has the same code and the same fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as server from '../project/lane_tools.ts';
import * as seite from '../public/production/lanes_tools.js';
import { punktePruefung } from '../project/model.ts';

const lane = [{ beat: 0, wert: -12 }, { beat: 4, wert: 0 }];

for (const [name, m] of [['server', server], ['page copy', seite]]) {
  test(`dehne (${name}): 0..1.75 stretched to 7.25 (the finding's case) stays a valid rising list and the end lands exactly on neuBis`, () => {
    const neu = m.dehne(lane, 0, 1.75, 7.25, 'fader');
    assert.equal(punktePruefung(neu, 'fader'), null, JSON.stringify(neu));
    assert.ok(neu.some((q) => q.beat === 7.25), 'a point sits exactly at neuBis');
  });

  test(`dehne (${name}): every quarter-beat von/bis/neuBis of a sample grid gives a valid list`, () => {
    let schlecht = 0, n = 0;
    const erste = [];
    for (let von = 0; von <= 2; von += 0.25) {
      for (let bis = von + 0.25; bis <= 6; bis += 0.25) {
        for (let neuBis = von + 0.25; neuBis <= 12; neuBis += 0.25) {
          if (neuBis === bis) continue;
          const neu = m.dehne(lane, von, bis, neuBis, 'fader'); n++;
          if (punktePruefung(neu, 'fader') !== null) { schlecht++; if (erste.length < 3) erste.push([von, bis, neuBis]); }
        }
      }
    }
    assert.equal(schlecht, 0, `${schlecht} of ${n} refused, e.g. ${JSON.stringify(erste)}`);
  });
}

test('dehne: results for exact ratios are unchanged by the fix (negative control, recorded before the fix)', () => {
  const alt = [{ beat: 0, wert: 0 }, { beat: 4, wert: 1 }, { beat: 6, wert: 0.2 }, { beat: 12, wert: 0.4 }];
  for (const m of [server, seite]) {
    assert.deepEqual(m.dehne(alt, 2, 8, 14, 'pan'), [{ beat: 0, wert: 0 }, { beat: 2, wert: 0.5 }, { beat: 6, wert: 1 }, { beat: 10, wert: 0.2 },
      { beat: 14, wert: 0.26666666666666666 }, { beat: 14, wert: 0.4, form: 'sprung' }]);
    assert.deepEqual(m.dehne(alt, 2, 8, 5, 'pan'), [{ beat: 0, wert: 0 }, { beat: 2, wert: 0.5 }, { beat: 3, wert: 1 }, { beat: 4, wert: 0.2 },
      { beat: 5, wert: 0.26666666666666666 }, { beat: 8, wert: 0.26666666666666666 }, { beat: 12, wert: 0.4 }]);
  }
});
