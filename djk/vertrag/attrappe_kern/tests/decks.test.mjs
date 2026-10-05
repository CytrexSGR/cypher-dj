// node --test tests/decks.test.mjs: Decks: Laden aus dem Arbeitsbestand, Start auf Quell-Beat, Loop, Roll, Sprung, Hotcue
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahre } from '../folgen_schnell.mjs';
import { S, ID, ID2, inhalt, arbeitsbestand, legeMaterial, sende, erwarte, wert, laden, start, hoerschein, q } from './hilfe.mjs';

const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));
const AB = arbeitsbestand({ materialien: [{ hotcues: [[1, 64]], lufs: -9.4 }, { id: ID2, stems: true }] });
legeMaterial(AB, { id: 'badbadbadbadbad0', nan: true });
const cfg = { arbeitsbestand: AB };
const deckTeil = (adr, typen, id, deck, ab, ...rest) => [adr, typen, id, 'cypher', '', '', '', deck, ab, ...rest];

test('laden: 1 dann 2/3 und /e/geladen; Fader −200, Trim = ziel_lufs − lufs (−16 − −9,4 = −6,6)', () => {
  const r = fahre([
    sende(1000, laden(1, 1)),
    erwarte(1100, q(1, 'leitstand', 1)),
    erwarte(1300, q(1, 'leitstand', 3, 1024)),
    erwarte(1300, ['/e/geladen', 'isdiih', 1, ID, 128, 1, 0, 1024]),
    wert(2000, 'deck/1/trim', -6.6, 1e-4),
    wert(2000, 'deck/1/fader', -200),
    wert(2000, 'deck/1/status', 1),
  ], { cfg });
  gruen(r);
});

test('laden Fehlerfälle: material_fehlt, pruefung (Stems passen nicht, NaN in der Stichprobe)', () => {
  const r = fahre([
    sende(1000, laden(1, 1, { mid: '0000000000000000' })),
    sende(1000, laden(2, 1, { mid: ID, stems: 1 })),
    sende(1000, laden(3, 1, { mid: 'badbadbadbadbad0' })),
    sende(1000, laden(4, 2, { mid: ID2, stems: 1 })),
    erwarte(1100, q(1, 'leitstand', 6, null, 'material_fehlt')),
    erwarte(1100, q(2, 'leitstand', 6, null, 'pruefung')),
    erwarte(1100, q(3, 'leitstand', 6, null, 'pruefung')),
    erwarte(1300, q(4, 'leitstand', 3)),
  ], { cfg });
  gruen(r);
});

test('start_quell_beat: bei ab_beat erklingt genau quell_beat, danach 1:1 mit dem Master', () => {
  const r = fahre([
    sende(1000, laden(1, 1)),
    sende(2000, start(2, 'leitstand', 1, 16, 8)),
    erwarte(S(16), q(2, 'leitstand', 2, S(16))),
    wert(S(16), 'deck/1/quell_beat', 8),
    wert(S(16) - 1, 'deck/1/status', 1),
    wert(S(16), 'deck/1/status', 2),
    wert(S(20), 'deck/1/quell_beat', 12),
  ], { cfg });
  gruen(r);
});

test('Materialende: Deck bleibt bei Q stehen (Status 1)', () => {
  const r = fahre([sende(1000, laden(1, 1)), sende(2000, start(2, 'leitstand', 1, 4, 0)), wert(S(99.99), 'deck/1/status', 2), wert(S(100), 'deck/1/status', 1), wert(S(101), 'deck/1/quell_beat', 96)], { cfg });
  gruen(r);
});

test('loop: ab Quellposition bei ab_beat, Wiederholung, Status 3, Sprung im Loop verschiebt den Loop', () => {
  const r = fahre([
    sende(1000, laden(1, 1)),
    sende(2000, start(2, 'leitstand', 1, 16, 0)),
    sende(3000, deckTeil('/k/deck/loop', 'hssssiddid', 3, 1, 32, 4, 0, 0)),
    wert(S(32), 'deck/1/quell_beat', 16),
    wert(S(37), 'deck/1/quell_beat', 17),
    wert(S(37), 'deck/1/status', 3),
    sende(S(38), deckTeil('/k/deck/sprung', 'hssssiddid', 4, 1, 40, 8, 0, 0)),
    wert(S(40), 'deck/1/quell_beat', 24),
    wert(S(43), 'deck/1/quell_beat', 27),
    wert(S(44), 'deck/1/quell_beat', 24),
  ], { cfg });
  gruen(r);
  const z = r.log.filter((m) => m.adresse === '/zustand/deck' && m.s > S(33) && m.s < S(38));
  assert.ok(z.length > 0 && z.every((m) => m.werte[6] === Infinity && m.werte[1] === 3));
});

test('roll: Band mit Schatten, beim Aus zurück zur Schattenposition', () => {
  const r = fahre([
    sende(1000, laden(1, 1)),
    sende(2000, start(2, 'leitstand', 1, 16, 0)),
    sende(3000, deckTeil('/k/deck/roll', 'hssssiddiid', 3, 1, 32, 1, 0, 0, 0)),
    sende(S(33), deckTeil('/k/deck/roll', 'hssssiddiid', 4, 1, 36, 0, 0, 0, 0)),
    wert(S(34.5), 'deck/1/quell_beat', 16.5),
    wert(S(34.5), 'deck/1/status', 4),
    wert(S(36), 'deck/1/quell_beat', 20),
  ], { cfg });
  gruen(r);
});

test('hotcue_phase: Deck bei 37,30, Hotcue 64,00 -> Ziel 64,30', () => {
  const r = fahre([
    sende(1000, laden(1, 1)),
    sende(2000, start(2, 'leitstand', 1, 16, 21.3)),
    sende(3000, deckTeil('/k/deck/hotcue', 'hssssidiid', 3, 1, 32, 1, 0, 0)),
    wert(S(32) - 1, 'deck/1/quell_beat', 37.3, 1e-3),
    wert(S(32), 'deck/1/quell_beat', 64.3, 1e-9),
  ], { cfg });
  gruen(r);
});

test('politik_raster: zu spät mit Politik 2 -> nächster erreichbarer Rasterpunkt, Quittung 5', () => {
  const r = fahre([
    sende(1000, laden(1, 1)),
    sende(2000, start(2, 'leitstand', 1, 4, 0)),
    sende(S(21.5), deckTeil('/k/deck/sprung', 'hssssiddid', 3, 1, 20, 4, 2, 4)),
    erwarte(S(24), q(3, 'cypher', 5, S(24))),
    wert(S(24), 'deck/1/quell_beat', 24),
  ], { cfg });
  gruen(r);
});

test('hotcue_setzen meldet /e/hotcue; entladen und laden bei laufendem offenem Deck -> deck_hoerbar', () => {
  const r = fahre([
    sende(1000, laden(1, 1)),
    sende(2000, ['/k/deck/hotcue_setzen', 'hsiid', 2, 'andreas', 1, 3, 12.5]),
    erwarte(3000, ['/e/hotcue', 'isidh', 1, ID, 3, 12.5, null]),
    sende(3000, hoerschein(3, 'h1', 'deck/1', inhalt())),
    sende(4000, ['/k/teil', 'hssisddfiiss', 4, 'andreas', '', 0, 'deck/1/fader', 2, 0, 0, 0, 0, '', 'h1']),
    erwarte(S(2), q(4, 'andreas', 3, S(2))),
    sende(S(2), start(7, 'andreas', 1, 3, 0)),   // §4.4 (2026-09-27): gesperrt nur laufend und offen
    sende(S(4), ['/k/deck/entladen', 'hsi', 5, 'leitstand', 1]),
    sende(S(4), laden(6, 1)),
    erwarte(S(5), q(5, 'leitstand', 6, null, 'deck_hoerbar')),
    erwarte(S(5), q(6, 'leitstand', 6, null, 'deck_hoerbar')),
  ], { cfg });
  gruen(r);
});

test('laden auf stehendem Deck mit offenem Fader: erlaubt (§4.4, 2026-09-27)', () => {
  const r = fahre([
    sende(1000, laden(1, 1)),
    sende(3000, hoerschein(3, 'h1', 'deck/1', inhalt())),
    sende(4000, ['/k/teil', 'hssisddfiiss', 4, 'andreas', '', 0, 'deck/1/fader', 2, 0, 0, 0, 0, '', 'h1']),
    erwarte(S(2), q(4, 'andreas', 3, S(2))),
    sende(S(3), laden(6, 1)),
    erwarte(S(4), q(6, 'leitstand', 3, null)),
  ], { cfg });
  gruen(r);
});

test('Tempo-Rampe bei laufendem Deck: abgelehnt kein_stretcher', () => {
  const r = fahre([
    sende(1000, laden(1, 1)),
    sende(2000, start(2, 'leitstand', 1, 4, 0)),
    sende(S(5), ['/k/tempo/rampe', 'hsddd', 3, 'leitstand', 16, 130, 8]),
    erwarte(S(6), q(3, 'leitstand', 6, null, 'kein_stretcher')),
  ], { cfg });
  gruen(r);
});

test('Deck-Befehl auf leerem Deck -> nicht_geladen; unbekanntes Deck -> unbekanntes_deck', () => {
  const r = fahre([
    sende(1000, start(1, 'leitstand', 3, 4, 0)),
    sende(1000, start(2, 'leitstand', 7, 4, 0)),
    erwarte(1200, q(2, 'leitstand', 6, null, 'unbekanntes_deck')),
    erwarte(S(4), q(1, 'leitstand', 6, S(4), 'nicht_geladen')),
  ], { cfg });
  gruen(r);
});
