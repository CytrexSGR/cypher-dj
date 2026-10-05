// node --test tests/frist.test.mjs: Frist-Wächter (Rückfall-Loop), /e/frist, b_verriegelt_a_laeuft_aus
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahre } from '../folgen_schnell.mjs';
import { S, ID, ID2, inhalt, arbeitsbestand, sende, erwarte, wert, hand, teil, laden, start, stopp, hoerschein, q, deckRein } from './hilfe.mjs';

const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));
const AB = arbeitsbestand({ materialien: [{ beats: 96 }, { id: ID2, beats: 512 }] });
const cfg = { arbeitsbestand: AB };

// rueckfall (§19.3): Deck als einziger hörbarer Kanal, 96 Beats Material, erste Eins 0, kein Plan -> Loop [80, 96)
const allein = [...deckRein(1, { id0: 10, ab: 4, mid: ID })];     // läuft ab Beat 4 bei Quell-Beat 0, Ende bei Beat 100

test('rueckfall: Loop [80, 96) gesetzt, sobald beats_bis_ende < 32; Deck bleibt hörbar', () => {
  const r = fahre([...allein,
    erwarte(S(68) + 512, ['/e/rueckfall', 'iidddh', 1, 1, 80, 16, null, null]),
    wert(S(110), 'deck/1/status', 5),
    wert(S(110), 'deck/1/quell_beat', 90),
    wert(S(300), 'deck/1/status', 5),
  ], { cfg });
  gruen(r);
  const e = r.log.find((m) => m.adresse === '/e/rueckfall');
  const s = Number(e.werte[5]);
  assert.ok(s > S(68) && s <= S(68) + 256, `gesetzt bei ${s}`);          // erster Blockanfang nach dem Übertritt
});

test('/e/frist bei 64, 32, 16 Beats vor dem Ende (128 liegt vor dem Start)', () => {
  const r = fahre([...allein, erwarte(S(37), ['/e/frist', 'iddh', 1, 64, 36, S(36)]), erwarte(S(69), ['/e/frist', 'iddh', 1, 32, 68, S(68)])], { cfg });
  gruen(r);
});

test('Negativ-Kontrolle: ein zweiter hörbarer Kanal -> kein Rückfall, Deck endet', () => {
  const r = fahre([...allein, ...deckRein(2, { id0: 30, ab: 8, mid: ID2, eqTief: -30 }), wert(S(101), 'deck/1/status', 1)], { cfg });
  gruen(r);
  assert.equal(r.log.filter((m) => m.adresse === '/e/rueckfall').length, 0);
});

test('Negativ-Kontrolle: ausgeführter Stopp von Andreas unterbindet den Wächter für dieses Material', () => {
  const r = fahre([...allein,
    sende(S(40), stopp(40, 'andreas', 1, 44)),
    sende(S(40), start(41, 'andreas', 1, 48, 40)),
    wert(S(105), 'deck/1/status', 1),
  ], { cfg });
  gruen(r);
  assert.equal(r.log.filter((m) => m.adresse === '/e/rueckfall').length, 0);
});

test('Griff an das Deck löst den Rückfall (an = 0), der Loop bleibt als gewöhnlicher Loop (Status 3)', () => {
  const r = fahre([...allein,
    hand(S(84), 'deck/1/eq/hoch', 0.5), hand(S(85), 'deck/1/eq/hoch', 0.6),
    erwarte(S(85), ['/e/rueckfall', 'iidddh', 1, 1, 80, 16, null, null]),
    erwarte(S(85), ['/e/rueckfall', 'iidddh', 1, 0, 80, 16, null, S(84)]),
    wert(S(120), 'deck/1/status', 3),
  ], { cfg });
  gruen(r);
});

// b_verriegelt_a_laeuft_aus (§19.3): B am Start verriegelt (kein Hörschein), A läuft aus -> I2 hält "A raus",
// der Frist-Wächter setzt die Rückfall-Schleife auf A, keine Stille
test('b_verriegelt_a_laeuft_aus: I2 hält A raus, Wächter setzt Loop [496, 512) auf A, A bleibt hörbar', () => {
  const r = fahre([
    ...deckRein(1, { id0: 10, ab: 16, qb: 16, mid: ID2 }),          // A = deck/1, Material 512 Beats, Ende bei Beat 512
    sende(S(400), laden(20, 2, { mid: ID })),
    sende(S(440), start(21, 'cypher', 2, 448, 0, { plan: 'p17', gruppe: 'b_rein' })),
    sende(S(440), teil(22, 'cypher', 'p17', 1, 'deck/2/eq/tief', 448, 0, -30, { gruppe: 'b_rein' })),
    sende(S(440), teil(23, 'cypher', 'p17', 2, 'deck/2/fader', 448, 0, -15, { gruppe: 'b_rein', hs: 'h12' })),
    sende(S(440), teil(24, 'cypher', 'p17', 8, 'deck/1/fader', 492, 16, -40, { gruppe: 'a_raus' })),
    sende(S(440), teil(25, 'cypher', 'p17', 9, 'deck/1/fader', 508, 4, -200, { gruppe: 'a_raus' })),
    sende(S(440), stopp(26, 'cypher', 1, 512, { plan: 'p17', gruppe: 'a_raus' })),
    erwarte(S(448), q(23, 'cypher', 6, S(448), 'kein_hoerschein')),
    erwarte(S(481), ['/e/rueckfall', 'iidddh', 1, 1, 496, 16, null, null]),
    erwarte(S(510), ['/e/invariante', 'ssihd', 'master_leer', 'p17', 8, null, null]),
    wert(S(540), 'deck/1/status', 5),
    wert(S(540), 'deck/1/quell_beat', 508),
  ], { cfg });
  gruen(r);
  const halt = r.kern.r.get('deck/1/fader').spur?.halt;
  assert.ok(halt > -26, `A-Fader gehalten bei ${halt}`);
});
