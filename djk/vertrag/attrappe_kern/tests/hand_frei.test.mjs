// node --test tests/hand_frei.test.mjs: /k/hand/frei (INTERFACES 4.3), the stand-in side of "a project switch releases the human holder"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahre } from '../folgen_schnell.mjs';
import { S, sende, erwarte, hand, teil, q } from './hilfe.mjs';

const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));

test('/k/hand/frei: from andreas it ends the hold of the listed regulators; cypher is refused; another path stays held; no grip means a no-op', () => {
  const r = fahre([
    hand(S(2), 'deck/3/fader', 0), hand(S(3), 'deck/3/fader', 127),     // the first value is only the position, the second one grips
    hand(S(2), 'deck/1/fader', 0), hand(S(3), 'deck/1/fader', 127),
    sende(S(5), teil(1, 'andreas', '', 0, 'deck/3/fader', 6, 0, -6)),
    erwarte(S(6) + 1000, q(1, 'andreas', 6, S(6), 'regler_beim_menschen')),   // control: refused while held
    sende(S(8), ['/k/hand/frei', 'hss', 2, 'cypher', 'deck/3/']),
    erwarte(S(8) + 1000, q(2, 'cypher', 6, null, 'nur_andreas')),
    sende(S(9), ['/k/hand/frei', 'hss', 3, 'andreas', 'deck/3/']),
    erwarte(S(9) + 1000, q(3, 'andreas', 3, null)),
    erwarte(S(9) + 1000, ['/e/halter', 'sshd', 'deck/3/fader', 'frei', null, null]),
    sende(S(10), teil(4, 'andreas', '', 0, 'deck/3/fader', 11, 0, -9)),
    erwarte(S(11) + 1000, q(4, 'andreas', 3, S(11))),                       // within the old 32 beats: now accepted
    sende(S(12), teil(5, 'andreas', '', 0, 'deck/1/fader', 13, 0, -9)),
    erwarte(S(13) + 1000, q(5, 'andreas', 6, S(13), 'regler_beim_menschen')),   // a grip on a path not in the list stays
    sende(S(14), ['/k/hand/frei', 'hss', 6, 'andreas', 'deck/2/']),             // no grip there: acknowledged, nothing happens
    erwarte(S(14) + 1000, q(6, 'andreas', 3, null)),
  ]);
  gruen(r);
});

test('/k/hand/frei with the prefix erz/4/: erz/4 is released, erz/1 (instrument) stays held', () => {
  const r = fahre([
    hand(S(2), 'erz/1/fader', 0), hand(S(3), 'erz/1/fader', 127),
    hand(S(2), 'erz/4/fader', 0), hand(S(3), 'erz/4/fader', 127),
    sende(S(9), ['/k/hand/frei', 'hss', 1, 'andreas', 'erz/4/']),
    erwarte(S(9) + 1000, ['/e/halter', 'sshd', 'erz/4/fader', 'frei', null, null]),
    sende(S(10), teil(2, 'andreas', '', 0, 'erz/4/fader', 11, 0, -9)),
    erwarte(S(11) + 1000, q(2, 'andreas', 3, S(11))),
    sende(S(12), teil(3, 'andreas', '', 0, 'erz/1/fader', 13, 0, -9)),
    erwarte(S(13) + 1000, q(3, 'andreas', 6, S(13), 'regler_beim_menschen')),
  ]);
  gruen(r);
});
