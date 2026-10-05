// node --test tests/invarianten.test.mjs: I1 Sub nie doppelt, I2 Master nie leer (Angriffe a1 und a2 aus
// proben/09-ki-steuerung/nachpruefung/angriff.mjs in Vertragsform), hand_stoppt_a_raus
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahre } from '../folgen_schnell.mjs';
import { S, ID, ID2, inhalt, arbeitsbestand, sende, erwarte, wert, hand, teil, laden, start, stopp, hoerschein, q, deckRein } from './hilfe.mjs';

const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));
const AB = arbeitsbestand({ materialien: [{ beats: 1000 }, { id: ID2, beats: 1000 }] });
const cfg = { arbeitsbestand: AB };

// A = deck/1 läuft offen mit Bass; B = deck/2 läuft hinter dem Fader, Bass zu, wird ab Beat 256 eingeblendet
const aUndB = [
  ...deckRein(1, { id0: 100, ab: 16, mid: ID }),
  sende(S(200), laden(200, 2, { mid: ID2 })),
  sende(S(201), hoerschein(201, 'hb', 'deck/2', inhalt(ID2))),
  sende(S(202), start(202, 'leitstand', 2, 240, 0)),
  sende(S(202), teil(203, 'cypher', 'llm0', 0, 'deck/2/eq/tief', 240, 0, -30)),
  sende(S(250), teil(204, 'cypher', 'llm0', 1, 'deck/2/fader', 256, 0, -15, { hs: 'hb' })),
  sende(S(250), teil(205, 'cypher', 'llm0', 2, 'deck/2/fader', 256, 64, 0, { hs: 'hb' })),
];
const basstausch = (gruppe) => [
  sende(S(300), teil(206, 'cypher', 'llm0', 3, 'deck/1/eq/tief', 320, 0, -30, { gruppe })),
  sende(S(300), teil(207, 'cypher', 'llm0', 4, 'deck/2/eq/tief', 320, 0, 0, { gruppe })),
];
const handAnABass = [hand(S(315), 'deck/1/eq/tief', 0.97), hand(S(316), 'deck/1/eq/tief', 1.0)];

test('sub_doppelt (a1): Plan ohne Kopplung, Hand hält A-Bass -> B-Bass-Teil fällt am Start mit invariante_sub_doppelt', () => {
  const r = fahre([...aUndB, ...basstausch(''), ...handAnABass,
    erwarte(S(316), q(206, 'cypher', 7, S(316), 'hand')),
    erwarte(S(320), q(207, 'cypher', 7, S(320), 'invariante_sub_doppelt')),
    erwarte(S(320), ['/e/invariante', 'ssihd', 'sub_doppelt', 'llm0', 4, S(320), 320]),
    wert(S(321), 'deck/2/eq/tief', -30),
  ], { cfg });
  gruen(r);
  assert.equal(r.log.filter((m) => m.adresse === '/q' && Number(m.werte[0]) === 207 && m.werte[2] === 2).length, 0);
});

// Lesart n (Andreas 2026-09-25, §17 I1 "hart"): I1 prüft über die Schaltrampe eines Setzens (192 Samples). Der
// Basstausch am selben Sample hätte 192 Samples lang zwei Bässe offen: B's Bass-Setzen fällt. Ersetzt die
// Negativ-Kontrolle a1 des Plans, die das Paar am selben Sample laufen ließ (Lesart "nur das Ziel").
test('Lesart n: Basstausch am selben Sample -> B-Bass fällt mit invariante_sub_doppelt (Schaltrampe)', () => {
  const r = fahre([...aUndB, ...basstausch(''), erwarte(S(320), q(206, 'cypher', 3, S(320))), erwarte(S(320), q(207, 'cypher', 7, S(320), 'invariante_sub_doppelt')), wert(S(321), 'deck/2/eq/tief', -30)], { cfg });
  gruen(r);
});

test('Negativ-Kontrolle a1 (Lesart n): A-Bass einen Beat vor B-Bass gesetzt, Paar läuft, keine Invariante', () => {
  const r = fahre([...aUndB,
    sende(S(300), teil(206, 'cypher', 'llm0', 3, 'deck/1/eq/tief', 319, 0, -30)),
    sende(S(300), teil(207, 'cypher', 'llm0', 4, 'deck/2/eq/tief', 320, 0, 0)),
    erwarte(S(319), q(206, 'cypher', 3, S(319))), erwarte(S(320), q(207, 'cypher', 3, S(320))), wert(S(321), 'deck/2/eq/tief', 0)], { cfg });
  gruen(r);
  assert.equal(r.log.filter((m) => m.adresse === '/e/invariante').length, 0);
});

test('Lesart n Rand: B-Bass 191 Samples nach A-Bass fällt, 192 Samples danach läuft', () => {
  const mit = (d) => fahre([...aUndB,
    sende(S(300), teil(206, 'cypher', 'llm0', 3, 'deck/1/eq/tief', 319, 0, -30)),
    sende(S(300), teil(207, 'cypher', 'llm0', 4, 'deck/2/eq/tief', (S(319) + d) / 22500, 0, 0)),
    erwarte(S(320), ['/uhr', 'hhddd', null, null, null, 128, 0])], { cfg });
  const st = (r) => r.log.filter((m) => m.adresse === '/q' && Number(m.werte[0]) === 207).map((m) => m.werte[2]);
  assert.deepEqual(st(mit(191)), [1, 7]);
  assert.deepEqual(st(mit(192)), [1, 2, 3]);
});

test('Gegenprobe a1 mit Gruppe basstausch: die Hand nimmt beide Teile mit, keine Invariante', () => {
  const r = fahre([...aUndB, ...basstausch('basstausch'), ...handAnABass, erwarte(S(316), q(207, 'cypher', 7, S(316), 'hand'))], { cfg });
  gruen(r);
  assert.equal(r.log.filter((m) => m.adresse === '/e/invariante').length, 0);
});

test('Rampe öffnet einen zweiten Tief-Kanal: I1 bricht sie im Zyklus des Übertritts am Ist-Wert ab', () => {
  const r = fahre([...aUndB,
    sende(S(300), teil(210, 'cypher', 'p5', 0, 'deck/2/eq/tief', 320, 16, 0)),
    erwarte(S(336), q(210, 'cypher', 7, null, 'invariante_sub_doppelt')),
  ], { cfg });
  gruen(r);
  const ab = r.log.find((m) => m.adresse === '/q' && Number(m.werte[0]) === 210 && m.werte[2] === 7);
  const s = Number(ab.werte[3]);
  const beat = s / 22500;
  const wertBeimAbbruch = -30 + 30 * ((beat - 320) / 16);
  assert.ok(wertBeimAbbruch <= -12 && wertBeimAbbruch > -12 - 30 * (256 / 22500) / 16 - 1e-9, `Abbruch bei ${s}, Wert ${wertBeimAbbruch}`);
});

// master_leer (a2): B wird am Start verriegelt (Hörschein zurückgezogen), A blendet trotzdem aus
const aRaus = [
  sende(S(300), teil(220, 'cypher', 'p17', 8, 'deck/1/fader', 320, 16, -40, { gruppe: 'a_raus' })),
  sende(S(300), teil(221, 'cypher', 'p17', 9, 'deck/1/fader', 336, 4, -200, { gruppe: 'a_raus' })),
  sende(S(300), stopp(222, 'cypher', 1, 344, { plan: 'p17', gruppe: 'a_raus' })),
];

test('master_leer (a2): I2 hält A am Ist-Wert über der Hörbar-Schwelle, der Stopp wartet, /e/invariante master_leer', () => {
  const r = fahre([...aUndB.slice(0, -2), sende(S(249), ['/k/hoerschein/weg', 'hss', 230, 'leitstand', 'hb']),
    sende(S(250), teil(204, 'cypher', 'llm0', 1, 'deck/2/fader', 256, 0, -15, { hs: 'hb' })),
    ...aRaus,
    erwarte(S(256), q(204, 'cypher', 6, S(256), 'kein_hoerschein')),
    erwarte(S(336), ['/e/invariante', 'ssihd', 'master_leer', 'p17', 8, null, null]),
    wert(S(350), 'deck/1/status', 2),
  ], { cfg });
  gruen(r);
  const halt = r.kern.r.get('deck/1/fader');
  assert.ok(halt.spur?.halt > -26 && halt.spur.halt < -25, `gehalten bei ${halt.spur?.halt}`);
  assert.ok(r.kern.teile.some((t) => t.b.key === 'cypher:222' && t.status === 'wartet'));
});

test('Negativ-Kontrolle a2: B kommt rein, A blendet ganz aus und stoppt bei 344', () => {
  const r = fahre([...aUndB, ...aRaus, erwarte(S(344), q(222, 'cypher', 3, S(344))), wert(S(345), 'deck/1/fader', -200), wert(S(345), 'deck/1/status', 1)], { cfg });
  gruen(r);
  assert.equal(r.log.filter((m) => m.adresse === '/e/invariante').length, 0);
});

test('I2 gibt frei: wird B später hörbar, läuft A mit unverändertem Ende-Beat weiter und der Stopp wird ausgeführt', () => {
  const r = fahre([...aUndB.slice(0, -2), sende(S(249), ['/k/hoerschein/weg', 'hss', 230, 'leitstand', 'hb']),
    ...aRaus,
    sende(S(338), hoerschein(240, 'hb2', 'deck/2', inhalt(ID2))),
    sende(S(339), teil(241, 'andreas', '', 0, 'deck/2/fader', 340, 0, 0, { hs: 'hb2' })),
    erwarte(S(344), q(222, 'cypher', 3, null)),
    wert(S(345), 'deck/1/fader', -200),
  ], { cfg });
  gruen(r);
});

test('hand_stoppt_a_raus: Griff an A-Fader während A raus -> Gruppe a_raus samt Deck-Stopp fällt, A läuft', () => {
  const r = fahre([...aUndB, ...aRaus,
    hand(S(324), 'deck/1/fader', 0.9), hand(S(326), 'deck/1/fader', 0.95),
    erwarte(S(326), q(220, 'cypher', 7, S(326), 'hand')),
    erwarte(S(326), q(221, 'cypher', 7, S(326), 'hand')),
    erwarte(S(326), q(222, 'cypher', 7, S(326), 'hand')),
    wert(S(350), 'deck/1/status', 2),
  ], { cfg });
  gruen(r);
});

// Lesart b (Andreas 2026-09-25, SCHNITTSTELLEN §4.3 Feld 11): eine Ablehnung am Start reißt die wartenden Teile der
// Gruppe mit, Quittung 7 mit dem Grund des abgelehnten Teils. Negativ-Kontrolle: ein Teil ohne Gruppe läuft weiter.
test('Lesart b: Ablehnung am Start (regler_beim_menschen) bricht die wartenden Gruppenteile ab', async () => {
  const { fahre } = await import('../folgen_schnell.mjs');
  const { sende, erwarte, hand, teil, q, S } = await import('./hilfe.mjs');
  const r = fahre([
    hand(S(60), 'deck/1/eq/mitte', 0.5),
    hand(S(60) + 10000, 'deck/1/eq/mitte', 0.5 + 4 / 128),
    sende(S(60) + 20000, teil(40, 'cypher', 'pb', 0, 'deck/1/eq/mitte', 64, 0, -6, { gruppe: 'g' })),
    sende(S(60) + 20000, teil(41, 'cypher', 'pb', 1, 'deck/1/eq/hoch', 72, 0, -6, { gruppe: 'g' })),
    sende(S(60) + 20000, teil(42, 'cypher', 'pb', 2, 'deck/1/eq/tief', 72, 0, -6)),
    erwarte(S(64) + 1000, q(40, 'cypher', 6, S(64), 'regler_beim_menschen')),
    erwarte(S(64) + 1000, q(41, 'cypher', 7, S(64), 'regler_beim_menschen')),
    erwarte(S(72) + 1000, q(42, 'cypher', 3, S(72))),
  ]);
  assert.ok(r.ok, r.fehler.join('\n'));
  assert.equal(r.log.filter((m) => m.adresse === '/q' && Number(m.werte[0]) === 41 && m.werte[2] === 2).length, 0);
});
