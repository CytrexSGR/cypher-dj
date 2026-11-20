// Panels of the analog role instruments (group analog_rollen_a): every rule names controls of its panel, every graph knob is bound.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { steuerungen } from '../public/panel.js';
import { ruhendeSteuerungen } from '../public/panel_wirkung.js';
import { werksgraphPfad } from './werksgraph_path.mjs';

const GERAETE = ['bass-acid', 'bass-analog', 'bass-sub', 'lead-acid', 'lead-arp', 'lead-poly', 'lead-sync', 'fx-downlifter', 'fx-impact', 'fx-noise', 'fx-riser'];
const MIN_REGELN = { 'fx-noise': 1 };
const panel = (name) => steuerungen(JSON.parse(fs.readFileSync(new URL(`../../instruments/modular_dsp/paneele/${name}.json`, import.meta.url), 'utf8')));
const graph = (name) => JSON.parse(fs.readFileSync(werksgraphPfad(name), 'utf8'));

const regelnPruefen = (name, mindestens) => test(`${name}: every rule names controls of the panel`, () => {
  const sts = panel(name);
  const ids = new Set(sts.map((c) => c.id));
  const namen = (b) => (!b ? [] : b.alle ? b.alle.flatMap(namen) : b.eine ? b.eine.flatMap(namen) : [Object.values(b)[0][0]]);
  const mit = sts.filter((x) => x.wirkt);
  assert.ok(mit.length >= mindestens, `${mit.length} rules`);
  for (const c of mit) {
    assert.equal(typeof c.wirkt_text, 'string', `${c.id}: text`);
    for (const n of namen(c.wirkt)) assert.ok(ids.has(n), `${c.id}: ${n}`);
  }
});

for (const g of GERAETE) {
  regelnPruefen(g, MIN_REGELN[g] ?? 0);
  test(`${g}: every knob number of the graph is bound by a control`, () => {
    const nrn = new Set(graph(g).knoten.filter((n) => n.art === 'regler').map((n) => `k${n.nr}`));
    const gebunden = new Set(panel(g).map((c) => c.bind?.param).filter(Boolean));
    for (const k of nrn) assert.ok(gebunden.has(k), `${g}: ${k} is not bound`);
  });
}

test('Noise Wash: swell rate is greyed without swell depth, heard with it', () => {
  const p = panel('fx-noise');
  assert.ok(ruhendeSteuerungen(p, { k2: 0 }).rate);
  assert.equal(ruhendeSteuerungen(p, { k2: 0.5 }).rate, null);
});
