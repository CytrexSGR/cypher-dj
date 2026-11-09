// 1.10 slice 4b T13: the latency read-out of the PRODUCTION page (public/production/pdc.js) against the core's model.
// The latencies are bound to the generated contract table (project/insert_key.ts); the cases are those of core/tests/test_arr_pdc.cpp
// (case 1: the same four topologies, the same largest path latency), so the page says what the core does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LATENZ, pdcRechnen, msText, latenzZeile, streifenText } from '../public/production/pdc.js';

const ts = fs.readFileSync(new URL('../project/insert_key.ts', import.meta.url), 'utf8');
const vertragLatenz = (art) => Number(new RegExp(`  ${art}: \\{ praefix: '[^']+', instanzen: \\d+, latenz: (\\d+),`).exec(ts)?.[1]);

const I = (art) => ({ id: `i-${art}`, art, slot: 1, an: true, werte: {} });
const spur = (id, extra = {}) => ({ id, name: id, inserts: [], ...extra });
// the topologies of test_arr_pdc case 1: 1 plain or with stages, 2 plain, 3 in group g1, 4 plain with sends to return r1
const projekt = (f) => {
  const p = { spuren: [spur('s1'), spur('s2'), spur('s3', { ausgang: { art: 'gruppe', id: 'g1' } }), spur('s4')],
    gruppen: [{ id: 'g1', nr: 1, name: 'G', inserts: [] }], returns: [{ id: 'r1', nr: 1, name: 'R', inserts: [] }], master: { fader_db: 0, inserts: [] } };
  if (f === 'A') { p.spuren[0].inserts = [I('eq')]; p.gruppen[0].inserts = [I('saett')]; }
  if (f === 'B') { p.gruppen[0].inserts = [I('saett')]; p.returns[0].inserts = [I('eq')]; }
  if (f === 'C') p.spuren[0].inserts = [I('eq'), I('saett')];
  if (f === 'D') p.master.inserts = [I('eq')];
  return p;
};

test('pdc: the page latencies are the ones of the contract table (generated from insert_module.json, pinned to cypher_*_latenz() in test_arr_pdc)', () => {
  for (const art of Object.keys(LATENZ)) assert.equal(LATENZ[art], vertragLatenz(art), art);
  assert.ok(LATENZ.eq > 0 && LATENZ.saett > 0 && LATENZ.lim > 0, 'positive control: the three kinds have a latency to compensate');
});

test('pdc: the largest path latency of the four topologies equals the core (A and B and C: eq + saett, D: eq on the PM)', () => {
  const e = LATENZ.eq, s = LATENZ.saett;
  assert.equal(pdcRechnen(projekt('0')).gesamt, 0);
  assert.equal(pdcRechnen(projekt('A')).gesamt, e + s);
  assert.equal(pdcRechnen(projekt('B')).gesamt, s + e);
  assert.equal(pdcRechnen(projekt('C')).gesamt, e + s);
  assert.equal(pdcRechnen(projekt('D')).gesamt, e);
});

test('pdc: the delay each strip carries - plain tracks wait for the longest chain, the group of A needs none', () => {
  const r = pdcRechnen(projekt('A')).streifen;
  assert.equal(r.s1.versatz, 0);
  for (const id of ['s2', 's3', 's4']) assert.equal(r[id].versatz, LATENZ.eq, id);
  assert.equal(r.g1.kette, LATENZ.saett);
  assert.equal(r.g1.versatz, 0);
  const c = pdcRechnen(projekt('C')).streifen;
  assert.equal(c.s2.versatz, LATENZ.eq + LATENZ.saett);
});

test('pdc: no latency stage, no ring (a project with komp only or one track with the eq alone); the read-out is empty then', () => {
  const k = projekt('0');
  k.spuren[0].inserts = [I('komp')];
  assert.equal(pdcRechnen(k).ringe, 0);
  assert.equal(latenzZeile(k), '');
  const ein = { spuren: [spur('s1', { inserts: [I('eq')] })], master: { fader_db: 0, inserts: [] } };
  assert.equal(pdcRechnen(ein).ringe, 0, 'every strip has the same latency');
  assert.equal(pdcRechnen(ein).gesamt, LATENZ.eq);
  assert.ok(pdcRechnen(projekt('A')).ringe > 0, 'positive control');
});

test('pdc: texts - milliseconds at 48 kHz, the strip row and the header line', () => {
  assert.equal(msText(69), '1.4 ms');
  assert.equal(msText(138), '2.9 ms');
  assert.match(latenzZeile(projekt('C')), /^Latency 2\.9 ms \(138 samples\)/);
  const r = pdcRechnen(projekt('A')).streifen;
  assert.equal(streifenText(r.s1), 'chain 1.4 ms');
  assert.equal(streifenText(r.s2), 'delayed 1.4 ms to match');
  assert.equal(streifenText({ kette: 0, versatz: 0 }), '');
});
