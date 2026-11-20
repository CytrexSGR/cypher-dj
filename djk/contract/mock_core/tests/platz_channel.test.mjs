// node --test tests/platz_channel.test.mjs: /k/platz/kanal and /e/platz/kanal (INTERFACES §4.10, §5.12)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahre } from '../sequences_fast.mjs';
import { arbeitsbestand, sende, erwarte, q } from './help.mjs';

const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));
const cfg = { arbeitsbestand: arbeitsbestand() };
const platz = (id, pad, inhalt) => ['/k/platz/kanal', 'hsii', id, 'andreas', pad, inhalt];

test('platz_kanal: the content of a pad is taken, receipts 1/2/3 and /e/platz/kanal follow', () => {
  const r = fahre([
    sende(1000, platz(1, 1, 1)),
    erwarte(3000, q(1, 'andreas', 1)),
    erwarte(3000, q(1, 'andreas', 2)),
    erwarte(3000, q(1, 'andreas', 3)),
    erwarte(3000, ['/e/platz/kanal', 'ii', 1, 1]),
    sende(4000, platz(2, 2, 3)),
    erwarte(6000, ['/e/platz/kanal', 'ii', 2, 3]),
  ], { cfg });
  gruen(r);
});

test('platz_kanal: pad 3 and content 4 are ausserhalb_bereich (receipt 6), nothing is reported', () => {
  const r = fahre([
    sende(1000, platz(3, 3, 1)),
    erwarte(3000, q(3, 'andreas', 6, null, 'ausserhalb_bereich')),
    sende(4000, platz(4, 1, 4)),
    erwarte(6000, q(4, 'andreas', 6, null, 'ausserhalb_bereich')),
  ], { cfg });
  gruen(r);
  assert.equal(r.log.filter((m) => m.adresse === '/e/platz/kanal').length, 0);
});
