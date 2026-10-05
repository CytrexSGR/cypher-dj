// node --test tests/neustart.test.mjs: Neustart auf dem Anker: /e/neustart, /q/stand, Rampe endet am unveränderten Ende-Beat
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahre } from '../folgen_schnell.mjs';
import { S, inhalt, arbeitsbestand, sende, erwarte, wert, teil, laden, hoerschein, q } from './hilfe.mjs';

const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));
const AB = arbeitsbestand();
const cfg = { arbeitsbestand: AB };

test('neustart: Abschuss zwischen Teilstart und Teilende der teil_rampe', () => {
  const r = fahre([
    sende(10000, laden(1, 2)),
    sende(20000, hoerschein(2, 'h2', 'deck/2', inhalt())),
    sende(30000, teil(3, 'cypher', 'p0', 0, 'deck/2/fader', 32, 0, -15, { hs: 'h2' })),
    sende(1000000, teil(10, 'cypher', 'p1', 0, 'deck/2/fader', 64, 32, 0)),
    erwarte(1440000, q(10, 'cypher', 2, 1440000)),
    { t: 'neustart', sample: 1700000, pause_samples: 9600 },
    erwarte(1712000, ['/e/neustart', 'ih', 1, null]),
    erwarte(1712000, ['/k/willkommen', 'iihdds', 1, 1, null, null, 128, null]),
    erwarte(1712000, ['/q/stand', 'hsihds', 10, 'cypher', 2, 1440000, 64, '']),
    wert(1800000, 'deck/2/fader', -7.5),
    erwarte(2160000, q(10, 'cypher', 3, 2160000)),
  ], { cfg });
  gruen(r);
  const ns = r.log.filter((m) => m.adresse === '/e/neustart');
  assert.equal(ns.length, 2);                    // einmal sofort an den gespeicherten Abonnenten, einmal nach /k/hallo
  assert.ok(Number(ns[0].werte[1]) >= 1700000 + 9600 && Number(ns[0].werte[1]) % 256 === 0);
});

test('Negativ-Kontrolle: ohne Neustart kein /e/neustart und kein /q/stand', () => {
  const r = fahre([sende(1000000, teil(10, 'cypher', 'p1', 0, 'deck/1/eq/mitte', 64, 32, -6)), erwarte(2160000, q(10, 'cypher', 3, 2160000))], { cfg });
  gruen(r);
  assert.equal(r.log.filter((m) => m.adresse === '/e/neustart' || m.adresse === '/q/stand').length, 0);
});
