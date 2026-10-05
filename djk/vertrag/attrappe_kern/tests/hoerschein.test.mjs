// node --test tests/hoerschein.test.mjs: I3: neuer Inhalt nur mit Hörschein (I3a Öffnen, I3d Sprung; I3b und I3c in erzeuger.test.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahre } from '../folgen_schnell.mjs';
import { S, ID, ID2, inhalt, arbeitsbestand, sende, erwarte, wert, teil, laden, start, hoerschein, q } from './hilfe.mjs';

const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));
const AB = arbeitsbestand({ materialien: [{ beats: 400 }, { id: ID2 }] });
const cfg = { arbeitsbestand: AB };
const oeffne = (id, hs, ab = 32, quelle = 'cypher') => teil(id, quelle, 'p1', 0, 'deck/2/fader', ab, 0, -15, { hs });
const basis = [sende(1000, laden(1, 2))];

const faelle = [
  ['kein_hoerschein', null],
  ['hoerschein_anderer_kanal', { kanal: 'deck/3' }],
  ['hoerschein_anderer_inhalt', { inh: inhalt(ID2) }],
  ['hoerschein_anderes_tempo', { bpm: 126 }],
  ['hoerschein_abgelaufen', { bis: 31 }],
  ['hoerschein_anderer_abschnitt', { von: 100, qbis: 120 }],
];
for (const [grund, hs] of faelle) {
  test(`i3_gruende: ${grund}`, () => {
    const schritte = [...basis];
    if (hs) schritte.push(sende(2000, hoerschein(2, 'hx', hs.kanal ?? 'deck/2', hs.inh ?? inhalt(), { bpm: hs.bpm, bis: hs.bis, von: hs.von, qbis: hs.qbis })));
    schritte.push(sende(3000, oeffne(3, hs ? 'hx' : '')), erwarte(S(32), q(3, 'cypher', 6, S(32), grund)), wert(S(32), 'deck/2/fader', -200));
    schritte.push(erwarte(S(32), ['/e/invariante', 'ssihd', 'hoerschein', 'p1', 0, S(32), 32]));
    gruen(fahre(schritte, { cfg }));
  });
}

test('Negativ-Kontrolle i3: gültiger Hörschein öffnet (fertig), nur leiser machen braucht keinen', () => {
  const r = fahre([
    ...basis,
    sende(2000, hoerschein(2, 'hx', 'deck/2', inhalt())),
    sende(3000, oeffne(3, 'hx')),
    erwarte(S(32), q(3, 'cypher', 3, S(32))),
    sende(S(33), teil(4, 'cypher', 'p2', 0, 'deck/2/fader', 36, 0, -30)),
    erwarte(S(36), q(4, 'cypher', 3, S(36))),
  ], { cfg });
  gruen(r);
});

test('hoerschein_rand: Start genau bei gueltig_bis_beat angenommen, einen Beat danach abgelaufen', () => {
  const r = fahre([
    ...basis,
    sende(2000, hoerschein(2, 'hx', 'deck/2', inhalt(), { bis: 32 })),
    sende(3000, oeffne(3, 'hx', 32)),
    sende(3000, teil(4, 'cypher', 'p9', 0, 'deck/3/fader', 1, 0, -200)),
    erwarte(S(32), q(3, 'cypher', 3, S(32))),
    sende(S(33), teil(5, 'cypher', 'p2', 0, 'deck/2/fader', 34, 0, -200)),
    sende(S(35), oeffne(6, 'hx', 36)),
    erwarte(S(34), q(5, 'cypher', 3, S(34))),
    erwarte(S(36), q(6, 'cypher', 6, S(36), 'hoerschein_abgelaufen')),
  ], { cfg });
  gruen(r);
});

test('andreas_nie_blockiert: Quelle andreas öffnet ohne Hörschein (§17, Ohr T14 Befund Slice 2)', () => {
  const r = fahre([
    ...basis,
    sende(3000, oeffne(3, '', 32, 'andreas')),
    erwarte(S(32), q(3, 'andreas', 3, S(32))),
    wert(S(32), 'deck/2/fader', -15),
  ], { cfg });
  gruen(r);
});

test('crossfader_luecke: Fader hinter geschlossenem Crossfader ohne Hörschein -> abgelehnt (offen hängt nicht am Crossfader)', () => {
  const r = fahre([
    ...basis,
    sende(2000, teil(2, 'andreas', '', 0, 'deck/2/xseite', 4, 0, 0)),
    sende(2000, teil(3, 'andreas', '', 0, 'xfader', 4, 0, 1)),
    sende(3000, oeffne(4, '')),
    erwarte(S(32), q(4, 'cypher', 6, S(32), 'kein_hoerschein')),
  ], { cfg });
  gruen(r);
});

test('einstieg: Vorhören ab Einstieg, Plan startet B an S neu am Einstieg -> I3a sieht die Quellposition im Hörschein', () => {
  const plan = (mitStart) => [
    sende(1000, laden(1, 2)),
    sende(2000, start(2, 'leitstand', 2, 300, 64)),
    sende(S(430), hoerschein(3, 'h12', 'deck/2', inhalt(), { von: 64, qbis: 136, bis: 508 })),
    ...(mitStart ? [sende(S(440), start(10, 'cypher', 2, 448, 64, { plan: 'p17', gruppe: 'b_rein' }))] : []),
    sende(S(440), teil(11, 'cypher', 'p17', 1, 'deck/2/eq/tief', 448, 0, -30, { gruppe: 'b_rein' })),
    sende(S(440), teil(12, 'cypher', 'p17', 2, 'deck/2/fader', 448, 0, -15, { gruppe: 'b_rein', hs: 'h12' })),
  ];
  const mit = fahre([...plan(true), erwarte(S(448), q(12, 'cypher', 3, S(448))), wert(S(448), 'deck/2/quell_beat', 64)], { cfg });
  gruen(mit);
  const ohne = fahre([...plan(false), erwarte(S(448), q(12, 'cypher', 6, S(448), 'hoerschein_anderer_abschnitt'))], { cfg });
  gruen(ohne);
});

test('ziel_ungehoert (I3d): Cyphers Sprung auf offenem Deck außerhalb des Hörscheins abgelehnt; innerhalb und mit annahme: angenommen', () => {
  const sprung = (id, ab, delta, hs = '') => ['/k/deck/sprung', 'hssssiddid', id, 'cypher', 'p3', '', hs, 2, ab, delta, 0, 0];
  const r = fahre([
    ...basis,
    sende(2000, hoerschein(2, 'hx', 'deck/2', inhalt(), { von: 0, qbis: 10 })),
    sende(3000, start(3, 'leitstand', 2, 16, 0)),
    sende(3000, oeffne(4, 'hx', 16)),
    sende(S(18), sprung(5, 20, 80)),
    sende(S(18), sprung(6, 21, 40)),
    sende(S(18), sprung(7, 22, 200, 'annahme:v5')),
    erwarte(S(20), q(5, 'cypher', 6, S(20), 'ziel_ungehoert')),
    erwarte(S(21), q(6, 'cypher', 3, S(21))),
    erwarte(S(22), q(7, 'cypher', 3, S(22))),
    wert(S(22), 'deck/2/quell_beat', 45 + 1 + 200),
  ], { cfg });
  gruen(r);
});
