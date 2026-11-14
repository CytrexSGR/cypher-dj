// node --test tests/fx_zuweisung.test.mjs: /k/fx/zuweisung and /e/fx/zuweisung (INTERFACES §4.10, §5.12), units 1 to 3
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahre } from '../sequences_fast.mjs';
import { arbeitsbestand, sende, erwarte, q } from './help.mjs';

const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));
const cfg = { arbeitsbestand: arbeitsbestand() };
const zuw = (id, quelle, einheit, kanal, an) => ['/k/fx/zuweisung', 'hsisi', id, quelle, einheit, kanal, an];
const meldungen = (r) => r.log.filter((m) => m.adresse === '/e/fx/zuweisung');

test('fx_zuweisung: unit 3 takes any source channel, receipts 1/2/3, /e/fx/zuweisung reports it', () => {
  const r = fahre([
    sende(1000, zuw(1, 'andreas', 3, 'erz/6', 1)),
    erwarte(3000, q(1, 'andreas', 1)),
    erwarte(3000, q(1, 'andreas', 3)),
    erwarte(3000, ['/e/fx/zuweisung', 'isi', 3, 'erz/6', 1]),
    sende(4000, zuw(2, 'andreas', 3, 'deck/4', 1)),
    erwarte(6000, ['/e/fx/zuweisung', 'isi', 3, 'deck/4', 1]),
    sende(7000, zuw(3, 'andreas', 3, 'erz/6', 0)),
    erwarte(9000, ['/e/fx/zuweisung', 'isi', 3, 'erz/6', 0]),
  ], { cfg });
  gruen(r);
});

test('fx_zuweisung: unit 3 never takes master, units 1 and 2 take deck/3 and deck/4 but not erz/5', () => {
  const r = fahre([
    sende(1000, zuw(4, 'andreas', 3, 'master', 1)),
    erwarte(3000, q(4, 'andreas', 6, null, 'ausserhalb_bereich')),
    sende(3500, zuw(5, 'andreas', 2, 'erz/5', 1)),
    erwarte(5000, q(5, 'andreas', 6, null, 'ausserhalb_bereich')),
    sende(5500, zuw(6, 'andreas', 4, 'deck/1', 1)),
    erwarte(7000, q(6, 'andreas', 6, null, 'ausserhalb_bereich')),
    sende(7500, zuw(7, 'andreas', 2, 'deck/3', 1)),
    erwarte(9000, ['/e/fx/zuweisung', 'isi', 2, 'deck/3', 1]),
    sende(9500, zuw(8, 'andreas', 1, 'master', 1)),
    erwarte(11000, ['/e/fx/zuweisung', 'isi', 1, 'master', 1]),
  ], { cfg });
  gruen(r);
  assert.equal(meldungen(r).length, 2, 'the rejected commands report nothing');
});
