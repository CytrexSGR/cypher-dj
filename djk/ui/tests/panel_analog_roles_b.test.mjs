// Role instrument panels (group analog_rollen_b): every rule names controls of its panel and has a text, every knob of the graph is bound.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { steuerungen } from '../public/panel.js';

const GERAETE = ['keys-bell', 'keys-electric-piano', 'keys-mallet', 'keys-organ', 'keys-piano', 'pad-analog', 'pad-atmosphere', 'pad-drone', 'pluck-mallet', 'pluck-stab', 'pluck-string', 'pluck-synth'];
const panel = (name) => steuerungen(JSON.parse(fs.readFileSync(new URL(`../../instruments/modular_dsp/paneele/${name}.json`, import.meta.url), 'utf8')));
const graph = (name) => JSON.parse(fs.readFileSync(path.join(os.homedir(), 'cypherdj/werke/geraete', `${name}.json`), 'utf8'));

const regelnPruefen = (titel, name, mindestens) => test(`${titel}: every rule names controls of the panel`, () => {
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

for (const name of GERAETE) {
  regelnPruefen(name, name, 0);
  test(`${name}: every knob of the graph is bound by a control`, () => {
    const nrn = new Set(graph(name).knoten.filter((k) => k.art === 'regler').map((k) => k.nr));
    const gebunden = new Set(panel(name).flatMap((c) => (c.bind?.param ? [c.bind.param] : [])));
    for (const nr of nrn) assert.ok(gebunden.has(`k${nr}`), `k${nr} unbound`);
  });
}
