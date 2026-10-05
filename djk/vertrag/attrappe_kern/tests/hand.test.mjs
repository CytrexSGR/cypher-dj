// node --test tests/hand.test.mjs: /test/hand an der teil_rampe: erster Wert nur Stellung, Totzone 3/128, Gruppe,
// Rückgabe nach 32 Beats (SCHNITTSTELLEN §7.3, §19.3 hand_gewinnt). Die Rampe selbst prüft tests/teil_rampe.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahre } from '../folgen_schnell.mjs';
import { S, inhalt, arbeitsbestand, sende, erwarte, wert, hand, teil, laden, hoerschein, q } from './hilfe.mjs';

const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));
const AB = arbeitsbestand();
const cfg = { arbeitsbestand: AB };

// deck/2 geladen, Hörschein h2, Fader bei Beat 32 auf −15 dB (öffnet den Kanal mit Hörschein, I3a)
const vorbereitung = [
  sende(10000, laden(1, 2)),
  sende(20000, hoerschein(2, 'h2', 'deck/2', inhalt())),
  sende(30000, teil(3, 'cypher', 'p0', 0, 'deck/2/fader', 32, 0, -15, { hs: 'h2' })),
  erwarte(S(32), q(3, 'cypher', 3, S(32))),
];

// hand_gewinnt (§19.3): dieselbe Rampe; /test/hand 0,5 bei 1 500 000 nur Stellung, 0,5 + 4/128 bei 1 620 000 über der Totzone
const handPlan = [
  ...vorbereitung,
  sende(1000000, teil(10, 'cypher', 'p1', 0, 'deck/2/fader', 64, 32, 0, { gruppe: 'b_rein' })),
  sende(1000000, teil(11, 'cypher', 'p1', 1, 'deck/2/eq/hoch', 64, 32, -6, { gruppe: 'b_rein' })),
  sende(1000000, teil(12, 'cypher', 'p1', 2, 'deck/2/eq/mitte', 64, 32, -6, { gruppe: 'anders' })),
];

test('hand_gewinnt: Abbruch 7 hand bei 1 620 000, Halter mensch, Gruppe b_rein fällt, andere Gruppe läuft weiter', () => {
  const r = fahre([
    ...handPlan,
    hand(1500000, 'deck/2/fader', 0.5),
    hand(1620000, 'deck/2/fader', 0.5 + 4 / 128),
    erwarte(1620000, q(10, 'cypher', 7, 1620000, 'hand')),
    erwarte(1620000, q(11, 'cypher', 7, 1620000, 'hand')),
    erwarte(1620000, ['/e/halter', 'sshd', 'deck/2/fader', 'mensch', 1620000, null]),
    wert(1619999, 'deck/2/fader', -15 + 15 * ((1619999 / 22500 - 64) / 32), 1e-6),
    erwarte(2160000, q(12, 'cypher', 3, 2160000)),
  ], { cfg });
  gruen(r);
  assert.equal(r.log.filter((m) => m.adresse === '/q' && Number(m.werte[0]) === 10 && m.werte[2] === 7).length, 1);
});

test('Negativ-Kontrolle hand_gewinnt: Rauschschritt 2/128 unter der Totzone bricht nichts ab', () => {
  const r = fahre([
    ...handPlan,
    hand(1500000, 'deck/2/fader', 0.5),
    hand(1620000, 'deck/2/fader', 0.5 + 2 / 128),
    erwarte(2160000, q(10, 'cypher', 3, 2160000)),
    erwarte(2160000, q(11, 'cypher', 3, 2160000)),
  ], { cfg });
  gruen(r);
});

test('Rückgabe: 32 Beats ohne Handbewegung -> Halter frei; danach nimmt der Regler wieder Teile an', () => {
  const b0 = 1620000 / 22500;                          // Beat 72
  const r = fahre([
    ...handPlan,
    hand(1500000, 'deck/2/fader', 0.5),
    hand(1620000, 'deck/2/fader', 0.5 + 4 / 128),
    sende(1700000, teil(20, 'cypher', 'p2', 0, 'deck/2/fader', 80, 4, -20)),
    erwarte(S(80), q(20, 'cypher', 6, S(80), 'regler_beim_menschen')),
    erwarte(S(b0 + 32), ['/e/halter', 'sshd', 'deck/2/fader', 'frei', S(b0 + 32), null]),
    sende(S(b0 + 33), teil(21, 'cypher', 'p3', 0, 'deck/2/fader', b0 + 36, 4, -20)),
    erwarte(S(b0 + 40), q(21, 'cypher', 3, S(b0 + 40))),
  ], { cfg });
  gruen(r);
});

// Lesart e (Andreas 2026-09-25, SCHNITTSTELLEN §4.3): ein Griff bricht auch WARTENDE Teile des Reglers sofort ab (7 hand)
test('Lesart e: wartender Teil fällt beim Griff mit 7 hand, nicht erst am Start; Negativ-Kontrolle: anderer Regler wartet weiter', () => {
  const r = fahre([
    ...vorbereitung,
    sende(1000000, teil(20, 'cypher', 'p2', 0, 'deck/2/fader', 96, 8, 0)),
    sende(1000000, teil(21, 'cypher', 'p2', 1, 'deck/2/eq/hoch', 96, 8, -6)),
    hand(1500000, 'deck/2/fader', 0.5),
    hand(1620000, 'deck/2/fader', 0.5 + 4 / 128),
    erwarte(1621000, q(20, 'cypher', 7, 1620000, 'hand')),
    erwarte(S(96) + 1000, q(21, 'cypher', 2, S(96))),
  ], { cfg });
  gruen(r);
});
