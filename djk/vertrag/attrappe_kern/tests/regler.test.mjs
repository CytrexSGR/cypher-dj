// node --test tests/regler.test.mjs: Planteile an Reglern ohne Decks: Rampenformen, Verspätung, I4, Bereiche, Abbruch
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahre } from '../folgen_schnell.mjs';
import { S, sende, erwarte, wert, teil, q } from './hilfe.mjs';

const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));
const cfg = {};

test('S-Kurve (form 1) und Rampe nach stumm (bis −60, dann −200)', () => {
  const r = fahre([
    sende(1000, teil(1, 'cypher', 'p1', 0, 'deck/1/eq/mitte', 8, 8, -10, { form: 1 })),
    sende(1000, teil(2, 'cypher', 'p1', 1, 'deck/1/send/1', 4, 0, -20)),
    sende(S(5), teil(3, 'cypher', 'p1', 2, 'deck/1/send/1', 8, 4, -200)),
    wert(S(10), 'deck/1/eq/mitte', -10 * (3 * 0.25 ** 2 - 2 * 0.25 ** 3)),
    wert(S(10), 'deck/1/send/1', -40),
    wert(S(12) - 1, 'deck/1/send/1', -60, 0.01),
    wert(S(12), 'deck/1/send/1', -200),
  ], { cfg });
  gruen(r);
});

test('zu_spaet: Politik 0 -> Quittung 4; Politik 1 -> Quittung 5 am nächsten Blockanfang', () => {
  const r = fahre([
    sende(500000, teil(1, 'cypher', 'p1', 0, 'deck/1/eq/mitte', 10, 0, -6, { politik: 0 })),
    sende(500000, teil(2, 'cypher', 'p1', 1, 'deck/1/eq/hoch', 10, 0, -6, { politik: 1 })),
    erwarte(500300, q(1, 'cypher', 4, 500224, 'zu_spaet')),
    erwarte(500300, q(2, 'cypher', 5, 500224)),
    wert(500224, 'deck/1/eq/hoch', -6),
    wert(500224, 'deck/1/eq/mitte', 0),
  ], { cfg });
  gruen(r);
});

test('Politik 1 mit Rampe: Restrampe bis zum unveränderten Ende-Beat', () => {
  const r = fahre([
    sende(S(20), teil(1, 'cypher', 'p1', 0, 'deck/1/eq/hoch', 16, 8, -24, { politik: 1 })),
    erwarte(S(24), q(1, 'cypher', 3, S(24))),
  ], { cfg });
  gruen(r);
});

test('i4_ueberlappung: zweite Rampe im selben Zeitraum abgelehnt; nacheinander und Setzen am Rampenanfang angenommen', () => {
  const r = fahre([
    sende(1000, teil(1, 'cypher', 'p1', 0, 'deck/1/eq/mitte', 16, 8, -10)),
    sende(2000, teil(2, 'cypher', 'p1', 1, 'deck/1/eq/mitte', 20, 8, 0)),
    erwarte(3000, q(2, 'cypher', 6, null, 'ueberlappung')),
    sende(4000, teil(3, 'cypher', 'p2', 0, 'deck/1/eq/mitte', 24, 8, 0)),
    erwarte(5000, q(3, 'cypher', 1)),
    sende(6000, teil(4, 'cypher', 'p3', 0, 'deck/1/eq/hoch', 16, 0, -3)),
    sende(7000, teil(5, 'cypher', 'p3', 1, 'deck/1/eq/hoch', 16, 8, -10)),
    erwarte(8000, q(5, 'cypher', 1)),
    sende(9000, teil(6, 'cypher', 'p3', 2, 'deck/1/eq/hoch', 18, 0, 0)),
    erwarte(10000, q(6, 'cypher', 6, null, 'ueberlappung')),
  ], { cfg });
  gruen(r);
});

test('nur_hand, unbekannter_regler, ausserhalb_bereich beim Einsortieren', () => {
  const r = fahre([
    sende(1000, teil(1, 'cypher', '', 0, 'xfader', 16, 0, 0.5)),
    sende(1000, teil(2, 'andreas', '', 0, 'xfader', 16, 0, 0.5)),
    sende(1000, teil(3, 'cypher', '', 0, 'deck/9/fader', 16, 0, 0)),
    sende(1000, teil(4, 'cypher', '', 0, 'deck/1/eq/tief', 16, 0, 7)),
    sende(1000, teil(5, 'cypher', '', 0, 'deck/1/kill/tief', 16, 4, 1)),
    erwarte(2000, q(1, 'cypher', 6, null, 'nur_hand')),
    erwarte(2000, q(2, 'andreas', 1)),
    erwarte(2000, q(3, 'cypher', 6, null, 'unbekannter_regler')),
    erwarte(2000, q(4, 'cypher', 6, null, 'ausserhalb_bereich')),
    erwarte(2000, q(5, 'cypher', 6, null, 'ausserhalb_bereich')),
  ], { cfg });
  gruen(r);
});

test('/k/abbruch: laufender Teil hält am Ist-Wert, wartender entfällt, Quittung 7 abbruch', () => {
  const r = fahre([
    sende(1000, teil(1, 'cypher', 'p9', 0, 'deck/1/eq/mitte', 16, 16, -16)),
    sende(1000, teil(2, 'cypher', 'p9', 1, 'deck/1/eq/hoch', 40, 0, -6)),
    sende(S(24), ['/k/abbruch', 'hsss', 3, 'cypher', 'p9', '*']),
    erwarte(S(25), q(1, 'cypher', 7, null, 'abbruch')),
    erwarte(S(25), q(2, 'cypher', 7, null, 'abbruch')),
    wert(S(30), 'deck/1/eq/mitte', -8, 0.01),
    wert(S(41), 'deck/1/eq/hoch', 0),
  ], { cfg });
  gruen(r);
});

// Lesart i (docs/architektur/entwuerfe/2026-09-25-lesarten-09.md): Grund bei Status 5 ist "", wie Kern 08
test('Lesart i: Quittung 5 trägt Grund ""; Negativ-Kontrolle: Quittung 4 behält zu_spaet', () => {
  const r = fahre([
    sende(500000, teil(1, 'cypher', 'p1', 0, 'deck/1/eq/mitte', 10, 0, -6, { politik: 0 })),
    sende(500000, teil(2, 'cypher', 'p1', 1, 'deck/1/eq/hoch', 10, 0, -6, { politik: 1 })),
    erwarte(500300, q(1, 'cypher', 4, 500224, 'zu_spaet')),
    erwarte(500300, q(2, 'cypher', 5, 500224, '')),
  ], { cfg });
  gruen(r);
});
