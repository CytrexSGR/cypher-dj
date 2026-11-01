// node --test tests/graph.test.mjs: /k/graph/frage and /e/graph (INTERFACES section 4.10 and 5.12, Baukasten S16).
// The fake kern holds no graphs, so it reports every graph-capable slot as empty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fahre } from '../folgen_schnell.mjs';
import { arbeitsbestand, sende, erwarte, q } from './hilfe.mjs';
import { SLOTS } from '../graph.mjs';

const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));
const cfg = { arbeitsbestand: arbeitsbestand() };
const osc = JSON.parse(fs.readFileSync(new URL('../../osc.json', import.meta.url).pathname, 'utf8'));
const frage = (id, quelle) => ['/k/graph/frage', 'hs', id, quelle];

test('graph: /k/graph/frage from andreas answers one /e/graph per slot, all empty, then quittung 1 and 3', () => {
  const r = fahre([
    sende(1000, frage(7, 'andreas')),
    erwarte(3000, q(7, 'andreas', 1)),
    erwarte(3000, q(7, 'andreas', 3)),
  ], { cfg });
  gruen(r);
  const g = r.log.filter((m) => m.adresse === '/e/graph');
  assert.equal(g.length, 14);
  assert.deepEqual(g.map((m) => m.werte[0]), osc.werte.graph_platz.liste);
  assert.ok(g.every((m) => m.werte[1] === ''));
});

test('graph: a bad quelle gets 6 ausserhalb_bereich and no /e/graph', () => {
  const r = fahre([
    sende(1000, frage(8, 'x')),
    erwarte(3000, q(8, 'x', 6, null, 'ausserhalb_bereich')),
  ], { cfg });
  gruen(r);
  assert.equal(r.log.filter((m) => m.adresse === '/e/graph').length, 0);
});

test('graph: the slot list equals osc.json graph_platz', () => {
  assert.deepEqual(SLOTS, osc.werte.graph_platz.liste);
  assert.equal(SLOTS.length, 14);
});
