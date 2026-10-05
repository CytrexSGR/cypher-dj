// node --test tests/teil_rampe.test.mjs: Planteil als Rampe in Beats an einem mit Hörschein geöffneten Deck-Kanal
// (SCHNITTSTELLEN §4.3, §19.3 teil_rampe): Start 1 440 000, Ende 2 160 000, Wert bei Beat 80 = −7,5 dB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahre } from '../folgen_schnell.mjs';
import { S, inhalt, arbeitsbestand, sende, erwarte, wert, teil, laden, hoerschein, q } from './hilfe.mjs';

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

test('teil_rampe: −15 -> 0 dB ab Beat 64 über 32 Beats: Start 1 440 000, Ende 2 160 000, Beat 80 = −7,5 dB', () => {
  const r = fahre([
    ...vorbereitung,
    sende(1000000, teil(10, 'cypher', 'p1', 0, 'deck/2/fader', 64, 32, 0)),
    erwarte(1001000, q(10, 'cypher', 1)),
    erwarte(1440000, q(10, 'cypher', 2, 1440000)),
    wert(1440000, 'deck/2/fader', -15),
    wert(1800000, 'deck/2/fader', -7.5),
    wert(2159999, 'deck/2/fader', 0, 1e-3),
    erwarte(2160000, q(10, 'cypher', 3, 2160000)),
    wert(2160000, 'deck/2/fader', 0),
  ], { cfg });
  gruen(r);
});

test('Fehlerfall: dieselbe Folge mit falschem Erwartungswert (−7,4 dB) wird rot', () => {
  const r = fahre([...vorbereitung, sende(1000000, teil(10, 'cypher', 'p1', 0, 'deck/2/fader', 64, 32, 0)), wert(1800000, 'deck/2/fader', -7.4, 0.01)], { cfg });
  assert.equal(r.ok, false);
});
