// node --test tests/container_source.test.mjs: /k/container/quelle and /e/container/quelle (INTERFACES §4.10, §5.12)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahre } from '../sequences_fast.mjs';
import { hoerbar, sicht } from '../level.mjs';
import { S, ID, arbeitsbestand, sende, erwarte, wert, teil, laden, start, hoerschein, inhalt, q } from './help.mjs';

const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));
const cfg = { arbeitsbestand: arbeitsbestand() };
const quelle = (id, q_, container, art) => ['/k/container/quelle', 'hsii', id, q_, container, art];
// the runner's own /k/hallo at sample 0 already yields the four default messages; `ab` skips them
const meldungen = (r, ab = 1) => r.log.filter((m) => m.adresse === '/e/container/quelle' && m.s >= ab).map((m) => m.werte);

test('container_quelle: art 2 on container 3 is accepted 1 then 3 and /e/container/quelle carries [3, 2]', () => {
  const r = fahre([
    sende(1000, quelle(1, 'andreas', 3, 2)),
    erwarte(3000, q(1, 'andreas', 1)),
    erwarte(3000, q(1, 'andreas', 3)),
    erwarte(3000, ['/e/container/quelle', 'ii', 3, 2]),
  ], { cfg });
  gruen(r);
  assert.deepEqual(meldungen(r), [[3, 2]]);
});

test('container_quelle: container 0, 5 and art -1, 3 are ausserhalb_bereich; cypher under the KI stop gets ki_gestoppt first', () => {
  const r = fahre([
    sende(1000, quelle(1, 'andreas', 0, 1)),
    erwarte(3000, q(1, 'andreas', 6, null, 'ausserhalb_bereich')),
    sende(3500, quelle(2, 'andreas', 5, 1)),
    erwarte(5000, q(2, 'andreas', 6, null, 'ausserhalb_bereich')),
    sende(5500, quelle(3, 'andreas', 1, -1)),
    erwarte(7000, q(3, 'andreas', 6, null, 'ausserhalb_bereich')),
    sende(7500, quelle(4, 'andreas', 1, 3)),
    erwarte(9000, q(4, 'andreas', 6, null, 'ausserhalb_bereich')),
    sende(9500, ['/k/ki/stopp', 'hs', 5, 'andreas']),
    sende(12000, quelle(6, 'cypher', 9, 9)),
    erwarte(14000, q(6, 'cypher', 6, null, 'ki_gestoppt')),
  ], { cfg });
  gruen(r);
  assert.equal(meldungen(r).length, 0, 'nothing is reported for refused commands');
});

test('container_quelle: after /k/hallo of a second subscriber four /e/container/quelle messages arrive, all art 1', () => {
  const r = fahre([
    sende(S(6), ['/k/hallo', 'sii', 'zweiter', 1, 1]),
    sende(S(8), ['/k/ki/frei', 'hs', 2, 'andreas']),
  ], { cfg });
  assert.deepEqual(meldungen(r, 0).slice(0, 4), [[1, 1], [2, 1], [3, 1], [4, 1]], 'the first hallo of the runner');
  assert.deepEqual(meldungen(r, S(6)), [[1, 1], [2, 1], [3, 1], [4, 1]]);
});

test('container_quelle: container 2 with art 0 is not hoerbar, with art 1 only while its player runs, with art 2 always', () => {
  const geladen = (extra) => fahre([
    sende(1000, laden(1, 2)),
    sende(1500, hoerschein(2, 'h2', 'deck/2', inhalt())),
    ...extra,
    sende(2000, teil(3, 'andreas', '', 0, 'deck/2/fader', 4, 0, 0)),
    wert(S(8), 'deck/2/fader', 0),
  ], { cfg: { arbeitsbestand: arbeitsbestand({ materialien: [{ beats: 400 }] }) } });
  const hoerbarJetzt = (r) => hoerbar(r.kern, sicht(r.kern, r.kern.jetzt), 'deck/2');
  const aus = geladen([sende(1800, quelle(9, 'andreas', 2, 0))]);
  gruen(aus);
  assert.equal(hoerbarJetzt(aus), false, 'art 0 is never hoerbar');
  const player = geladen([]);
  assert.equal(hoerbarJetzt(player), false, 'art 1 with the player stopped');
  const laeuft = fahre([
    sende(1000, laden(1, 2)),
    sende(1500, start(2, 'andreas', 2, 1, 0)),
    sende(2000, teil(3, 'andreas', '', 0, 'deck/2/fader', 4, 0, 0)),
    wert(S(8), 'deck/2/fader', 0),
  ], { cfg: { arbeitsbestand: arbeitsbestand({ materialien: [{ beats: 400 }] }) } });
  assert.equal(hoerbarJetzt(laeuft), true, 'art 1 with the player running');
  const modul = geladen([sende(1800, quelle(9, 'andreas', 2, 2))]);
  assert.equal(hoerbarJetzt(modul), true, 'art 2 is hoerbar without a running player');
});
