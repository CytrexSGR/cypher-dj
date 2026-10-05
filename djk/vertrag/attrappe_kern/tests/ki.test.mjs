// node --test tests/ki.test.mjs: KI-Stopp, KI-Freigabe, LEDs und übrige Sofort-Befehle
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahre } from '../folgen_schnell.mjs';
import { S, ID, inhalt, arbeitsbestand, sende, erwarte, wert, hand, teil, q, deckRein } from './hilfe.mjs';

const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));
const AB = arbeitsbestand({ materialien: [{ beats: 400 }] });
const cfg = { arbeitsbestand: AB };

test('ki_stopp: alle cypher-Teile ab (ki_stopp), KI-Spur über 4 Beats stumm, danach ki_gestoppt; frei nur von andreas', () => {
  const r = fahre([
    ...deckRein(3, { id0: 10, ab: 8, mid: ID, quelle: 'cypher' }),
    sende(1000, ['/k/ki/spur', 'hss', 1, 'leitstand', 'deck/3,erz/1']),
    sende(S(9), teil(2, 'cypher', 'p1', 0, 'deck/1/eq/mitte', 16, 16, -10)),
    sende(S(9), teil(3, 'cypher', 'p1', 1, 'deck/1/eq/hoch', 40, 0, -10)),
    sende(S(20), ['/k/ki/stopp', 'hs', 4, 'leitstand']),
    erwarte(S(20) + 512, q(2, 'cypher', 7, null, 'ki_stopp')),
    erwarte(S(20) + 512, q(3, 'cypher', 7, null, 'ki_stopp')),
    erwarte(S(20) + 512, ['/e/ki', 'ish', 1, 'ki_stopp', null]),
    wert(S(22) + 256, 'deck/3/fader', -30, 0.5),
    wert(S(24) + 512, 'deck/3/fader', -200),
    sende(S(26), teil(5, 'cypher', 'p2', 0, 'deck/1/eq/tief', 30, 0, -3)),
    erwarte(S(26) + 512, q(5, 'cypher', 6, null, 'ki_gestoppt')),
    sende(S(27), ['/k/ki/frei', 'hs', 6, 'leitstand']),
    erwarte(S(27) + 512, q(6, 'leitstand', 6, null, 'nur_hand')),
    sende(S(28), ['/k/ki/frei', 'hs', 7, 'andreas']),
    erwarte(S(28) + 512, ['/e/ki', 'ish', 0, 'frei', null]),
    sende(S(30), teil(8, 'cypher', 'p3', 0, 'deck/1/eq/tief', 34, 0, -3)),
    erwarte(S(34), q(8, 'cypher', 3, S(34))),
  ], { cfg });
  gruen(r);
});

test('Stopp-Taste am Controller wirkt wie /k/ki/stopp; Freigabe plus Stopp wie /k/ki/frei', () => {
  const r = fahre([
    sende(1000, teil(1, 'cypher', 'p1', 0, 'deck/1/eq/mitte', 16, 16, -10)),
    hand(S(20), 'taste/stopp', 1),
    erwarte(S(20), q(1, 'cypher', 7, S(20), 'ki_stopp')),
    erwarte(S(20), ['/e/taste', 'sihd', 'stopp', 127, S(20), null]),
    hand(S(22), 'taste/freigabe', 1), hand(S(22) + 100, 'taste/stopp', 1),
    erwarte(S(23), ['/e/ki', 'ish', 0, 'freigabe', null]),
  ], { cfg });
  gruen(r);
});

test('LED, Kiste, Mapping, Latenz, Stufe, Vorschlagskanal: angenommen; falsche Namen abgelehnt', () => {
  const r = fahre([
    sende(1000, ['/k/led', 'hssi', 1, 'leitstand', 'vorschlag', 2]),
    sende(1000, ['/k/led', 'hssi', 2, 'leitstand', 'gibtsnicht', 1]),
    sende(1000, ['/k/kiste', 'hs', 3, 'leitstand']),
    sende(1000, ['/k/mapping', 'hss', 4, 'leitstand', 'beispiel']),
    sende(1000, ['/k/latenz', 'hssi', 5, 'leitstand', 'erz/2', 512]),
    sende(1000, ['/k/ki/stufe', 'hsi', 6, 'leitstand', 4]),
    sende(1000, ['/k/vorschlag_kanal', 'hss', 7, 'leitstand', 'deck/2']),
    erwarte(1600, q(1, 'leitstand', 3)), erwarte(1600, q(2, 'leitstand', 6, null, 'ausserhalb_bereich')),
    erwarte(1600, q(3, 'leitstand', 3)), erwarte(1600, q(4, 'leitstand', 3)), erwarte(1600, q(5, 'leitstand', 3)),
    erwarte(1600, q(6, 'leitstand', 6, null, 'ausserhalb_bereich')), erwarte(1600, q(7, 'leitstand', 3)),
  ], { cfg });
  gruen(r);
});
