// node --test tests/listening_slip_key.test.mjs: the Hörschein is keyed on deck/<player> (container core C7), not on the container path.
// Container C (pad/1) carries player 3, so its ticket names deck/3; the core resolves container -> player.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahre } from '../sequences_fast.mjs';
import { S, ID, inhalt, arbeitsbestand, sende, erwarte, teil, laden, start, hoerschein, q } from './help.mjs';

const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));
const cfg = { arbeitsbestand: arbeitsbestand() };

test('hoerschein key: a ticket on pad/3 is refused, deck/1 to deck/4 are accepted', () => {
  const r = fahre([
    sende(1000, hoerschein(1, 'h_a', 'pad/3', inhalt())),
    erwarte(3000, q(1, 'leitstand', 6, null, 'unbekannter_regler')),
    sende(3500, hoerschein(2, 'h_b', 'deck/3', inhalt())),
    erwarte(5000, q(2, 'leitstand', 3)),
    sende(5500, hoerschein(3, 'h_c', 'deck/4', inhalt())),
    erwarte(7000, q(3, 'leitstand', 3)),
  ], { cfg });
  gruen(r);
});

test('hoerschein key: player 3 loaded, the ticket on deck/3 opens pad/1/fader, a late beat gives hoerschein_abgelaufen', () => {
  const r = fahre([
    sende(S(2), laden(1, 3)),
    sende(S(3), hoerschein(2, 'h3', 'deck/3', inhalt(), { bis: 10 })),
    sende(S(3) + 100, teil(3, 'cypher', 'p1', 0, 'pad/1/fader', 12, 0, 0, { hs: 'h3' })),
    erwarte(S(12), q(3, 'cypher', 6, S(12), 'hoerschein_abgelaufen')),
  ], { cfg });
  gruen(r);
});
