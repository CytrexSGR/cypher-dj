// node --test tests/fx_routing.test.mjs: /k/fx/routing und /e/fx/routing (SCHNITTSTELLEN §4.10, §5.12, Ohr Task 15)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahre } from '../folgen_schnell.mjs';
import { arbeitsbestand, sende, erwarte, q } from './hilfe.mjs';

const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));
const cfg = { arbeitsbestand: arbeitsbestand() };
const routing = (id, quelle, w) => ['/k/fx/routing', 'hsi', id, quelle, w];

test('fx_routing: Quelle cypher bekommt 6 nur_hand, der Zustand bleibt Post Fader', () => {
  const r = fahre([
    sende(1000, routing(1, 'cypher', 1)),
    erwarte(3000, q(1, 'cypher', 6, null, 'nur_hand')),
  ], { cfg });
  gruen(r);
  assert.equal(r.log.filter((m) => m.adresse === '/e/fx/routing').length, 0);
});

test('fx_routing: andreas schaltet, Quittungen 1/2/3 und /e/fx/routing folgt', () => {
  const r = fahre([
    sende(1000, routing(2, 'andreas', 1)),
    erwarte(3000, q(2, 'andreas', 1)),
    erwarte(3000, q(2, 'andreas', 2)),
    erwarte(3000, q(2, 'andreas', 3)),
    erwarte(3000, ['/e/fx/routing', 'i', 1]),
  ], { cfg });
  gruen(r);
});

test('fx_routing: Wert 2 ist ausserhalb_bereich (Quittung 6)', () => {
  const r = fahre([
    sende(1000, routing(3, 'andreas', 2)),
    erwarte(3000, q(3, 'andreas', 6, null, 'ausserhalb_bereich')),
  ], { cfg });
  gruen(r);
  assert.equal(r.log.filter((m) => m.adresse === '/e/fx/routing').length, 0);
});

test('fx_routing: nach dem Neustart meldet der Kern die Vorgabe 0 (er behält den Wunsch nicht)', () => {
  const r = fahre([
    sende(1000, routing(4, 'andreas', 1)),
    erwarte(3000, ['/e/fx/routing', 'i', 1]),
    { t: 'neustart', sample: 200000, pause_samples: 9600 },
    erwarte(220000, ['/e/neustart', 'ih', 1, null]),
    erwarte(220000, ['/e/fx/routing', 'i', 0]),
  ], { cfg });
  gruen(r);
  const namen = r.log.map((m) => m.adresse);
  assert.ok(namen.indexOf('/e/fx/routing', namen.indexOf('/e/neustart')) > namen.indexOf('/e/neustart'));
});
