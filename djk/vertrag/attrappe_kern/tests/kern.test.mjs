// node --test tests/kern.test.mjs: Maschine: Zeitachse, Tempo, Storno, Protokollfehler, Abonnenten
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahre } from '../folgen_schnell.mjs';
import { sende, erwarte, setNeu, q, S } from './hilfe.mjs';

const rampe = (id, ab, ziel, dauer) => ['/k/tempo/rampe', 'hsddd', id, 'leitstand', ab, ziel, dauer];
const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));

test('uhr_golden: Rampe 128 -> 132 startet bei 2 880 000, endet bei 3 588 923; Takte 37 und 49 auf den Golden-Samples', () => {
  const r = fahre([
    sende(0, setNeu(1)),
    erwarte(256, q(1, 'leitstand', 2, 0)),
    sende(1000, rampe(2, 128, 132, 32)),
    erwarte(2000, q(2, 'leitstand', 1)),
    erwarte(2880000, q(2, 'leitstand', 2, 2880000)),
    erwarte(3237188, ['/takt', 'iihdd', 37, 5, 3237188, 144, 130.015384]),
    erwarte(3588923, ['/takt', 'iihdd', 41, 6, 3588923, 160, 132]),
    erwarte(3588923, q(2, 'leitstand', 3, 3588923)),
    erwarte(4287105, ['/takt', 'iihdd', 49, 7, 4287105, 192, 132]),
  ]);
  gruen(r);
});

test('Fehlerfall: Mutation "Rampe in Samples statt Beats" verschiebt das Ende (Instrument sieht es)', () => {
  // gleiche Rampe, aber das Ende wird bei 128 BPM in Samples umgerechnet erwartet: das muss rot sein
  const r = fahre([sende(1000, rampe(2, 128, 132, 32)), erwarte(3600000, q(2, 'leitstand', 3, 2880000 + 32 * 22500))]);
  assert.equal(r.ok, false);
});

// Storno selbst quittiert [1, 2] ohne fertig, wie der Kern von 08 (Andreas 2026-09-25, review-08.json).
// Liefert K.sofort für /k/storno ein fertig (3), bekommt der Handler hier eine Ausnahme.
test('storno: wartende Rampe storniert (8), Storno selbst 1-2; Storno einer gestarteten -> abgelehnt zu_spaet', () => {
  const r = fahre([
    sende(1000, rampe(10, 64, 130, 8)),
    sende(2000, ['/k/storno', 'hsh', 11, 'leitstand', 10]),
    erwarte(3000, q(10, 'leitstand', 8)),
    erwarte(3000, q(11, 'leitstand', 2)),
    // und kein q(11, 'leitstand', 3): prüfen, dass bis S4() keines kommt
    sende(4000, rampe(12, 4, 130, 8)),
    sende(S4() + 5000, ['/k/storno', 'hsh', 13, 'leitstand', 12]),
    erwarte(S4() + 6000, q(13, 'leitstand', 6, null, 'zu_spaet')),
  ]);
  gruen(r);
});
function S4() { return 90000; }

test('protokollfehler: unbekannte Adresse und falsche Typen; Negativ-Kontrolle: gültiger Befehl ohne Fehler', () => {
  const r = fahre([
    sende(1000, ['/k/gibtsnicht', 'i', 1]),
    erwarte(2000, ['/e/protokollfehler', 'ss', '/k/gibtsnicht', 'unbekannte_adresse']),
    sende(3000, ['/k/tempo/rampe', 'hsdd', 5, 'leitstand', 64, 130]),
    erwarte(4000, ['/e/protokollfehler', 'ss', '/k/tempo/rampe', 'falsche_typen']),
    sende(5000, setNeu(6)),
    erwarte(6000, q(6, 'leitstand', 1)),
  ]);
  gruen(r);
  assert.equal(r.log.filter((m) => m.adresse === '/e/protokollfehler').length, 2);
});

test('Tempo-Rampe ohne laufendes Deck: angenommen (Gegenstück kein_stretcher steht in decks.test.mjs)', () => {
  const r = fahre([sende(1000, rampe(20, 64, 130, 8)), erwarte(2000, q(20, 'leitstand', 1))]);
  gruen(r);
});

test('Abonnenten: /k/willkommen mit Protokoll 1; falsches Protokoll -> /e/protokollfehler an diesen Port', () => {
  const r = fahre([sende(1000, ['/k/hallo', 'sii', 'zweiter', 1, 2]), erwarte(2000, ['/e/protokollfehler', 'ss', '/k/hallo', 'protokoll'])]);
  gruen(r);
  const w = r.log.find((m) => m.adresse === '/k/willkommen');
  assert.equal(w.werte[0], 1);
});

test('/uhr je Zyklus: 1 Sekunde Simulation liefert 187 oder 188 /uhr, Sample steigt um 256', () => {
  const r = fahre([erwarte(48000, ['/uhr', 'hhddd', null, null, null, 128, 0])]);
  gruen(r);
  const uhren = r.log.filter((m) => m.adresse === '/uhr' && m.s < 48000);
  assert.ok(uhren.length === 187 || uhren.length === 188, String(uhren.length));
  for (let i = 1; i < uhren.length; i++) assert.equal(Number(uhren[i].werte[0] - uhren[i - 1].werte[0]), 256);
});

// Nachtrag 13 (Vertrag §4.1 /k/storno, Andreas 2026-09-25): der Storno selbst bekommt kein fertig (3)
test('storno ohne fertig: /q 3 für den Storno kommt nicht (Negativ-Kontrolle: die stornierte Rampe bekommt ihre 8)', () => {
  const r = fahre([
    sende(1000, rampe(10, 64, 130, 8)),
    sende(2000, ['/k/storno', 'hsh', 11, 'leitstand', 10]),
    erwarte(3000, q(10, 'leitstand', 8)),
    erwarte(3000, q(11, 'leitstand', 2)),
    erwarte(20000, ['/uhr', 'hhddd', null, null, null, 128, 0]),
  ]);
  gruen(r);
  const st = r.log.filter((m) => m.adresse === '/q' && m.werte[0] === 11n).map((m) => m.werte[2]);
  assert.deepEqual(st, [1, 2]);
});

// Nachtrag Hauptinstanz 2026-09-25 (B6 c): /k/set/neu bricht offene Tempo-Rampen mit [7 abbruch] ab, wie Kern 08
test('set/neu bricht wartende Tempo-Rampe ab (7 abbruch); Negativ-Kontrolle: ohne set/neu startet sie', () => {
  const r = fahre([
    sende(1000, rampe(30, 8, 130, 8)),
    erwarte(2000, q(30, 'leitstand', 1)),
    sende(3000, setNeu(31)),
    erwarte(4000, q(31, 'leitstand', 2)),
    erwarte(4000, q(30, 'leitstand', 7, null, 'abbruch')),
  ]);
  gruen(r);
  const n = fahre([sende(1000, rampe(30, 8, 130, 8)), erwarte(S(8) + 1000, q(30, 'leitstand', 2, S(8)))]);
  gruen(n);
});
