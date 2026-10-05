// node --test tests/erzeuger.test.mjs: I3b (Schuss auf offenes Pad) und I3c (Muster auf offenem Erzeuger-Kanal),
// Fenster ersetzen mit Zählern in /erz/quittung (SCHNITTSTELLEN §4.6, §4.8, §17)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahre } from '../folgen_schnell.mjs';
import { kodiereBundle } from '../osc.mjs';
import { S, ID, inhalt, arbeitsbestand, sende, erwarte, teil, hoerschein, q } from './hilfe.mjs';

const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));
const AB = arbeitsbestand({ materialien: [{ beats: 400, schuesse: [3] }] });
const cfg = { arbeitsbestand: AB };

test('pad_ungehoert (I3b): Schuss auf offenes Pad nur mit Hörschein genau dieses Schusses; Andreas frei', () => {
  const schuss = (id, quelle, ab) => ['/k/schuss', 'hsdsiiifi', id, quelle, ab, ID, 1, 3, 1, 0, 0];
  const padOffen = [
    sende(1000, hoerschein(1, 'hp', 'pad/1', 'muster/0')),
    sende(1000, teil(2, 'cypher', 'p1', 0, 'pad/1/fader', 4, 0, 0, { hs: 'hp' })),
  ];
  const ohne = fahre([
    ...padOffen,
    sende(2000, schuss(3, 'cypher', 8)),
    sende(2000, schuss(4, 'andreas', 9)),
    erwarte(S(8), q(3, 'cypher', 6, S(8), 'kein_hoerschein')),
    erwarte(S(9), q(4, 'andreas', 3, S(9))),
  ], { cfg });
  gruen(ohne);
  const mit = fahre([
    ...padOffen,
    sende(2000, hoerschein(5, 'hs3', 'pad/1', `${inhalt()}/s3`)),
    sende(2000, schuss(6, 'cypher', 10)),
    erwarte(S(10), q(6, 'cypher', 3, S(10))),
  ], { cfg });
  gruen(mit);
});

test('muster_ungehoert (I3c): Ereignisse eines Musters ohne Hörschein auf offenem Erzeuger-Kanal zählen als ungehoert', () => {
  const r = fahre([
    sende(1000, hoerschein(1, 'hm5', 'erz/1', 'muster/5')),
    sende(1000, ['/erz/strom', 'hsiss', 2, 'erzeuger', 1, 'midi:1:1', 'erz/1']),
    sende(1000, teil(3, 'erzeuger', 'p1', 0, 'erz/1/fader', 2, 0, 0, { hs: 'hm5' })),
    erwarte(S(2), q(3, 'erzeuger', 3, S(2))),
  ], { cfg });
  gruen(r);
  const K = r.kern;
  const erg = [];
  K.sendeFn = (m) => { if (m.adresse === '/erz/quittung') erg.push(m.werte); };
  const ev = (muster, i, beat) => ['/erz/ev', 'iiiiddf', [1, muster, i, 60, beat, 0.25, 0.8]];
  K.empfange(kodiereBundle([['/erz/fenster', 'iiiiddh', [1, 1, 66, 0, 8, 12, 0n]], ev(7, 1, 8), ev(7, 2, 9), ev(5, 3, 10), ev(5, 4, 0.5)]));
  assert.deepEqual(erg[0], [1, 1, 0, 0, 1, 1, 2]);            // eingefuegt 1 (Muster 5), zu_spaet 1, ungehoert 2 (Muster 7)
  K.empfange(kodiereBundle([['/erz/fenster', 'iiiiddh', [1, 2, 66, 0, 8, 12, 0n]], ev(5, 5, 11)]));
  assert.deepEqual(erg[1], [1, 2, 1, 0, 1, 0, 0]);            // das alte Ereignis von Muster 5 ersetzt
});
