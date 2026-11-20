// Drum and percussion panels: every `wirkt` rule names controls of its panel and has a text, and every knob of the graph is bound by a control.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { steuerungen } from '../public/panel.js';
import { ruhendeSteuerungen } from '../public/panel_wirkung.js';

const PANEELE = new URL('../../instruments/modular_dsp/paneele/', import.meta.url);
const GERAETE = path.join(os.homedir(), 'cypherdj/werke/geraete');
const lade = (name) => JSON.parse(fs.readFileSync(new URL(`${name}.json`, PANEELE), 'utf8'));
const panel = (name) => steuerungen(lade(name));

const GRAPHEN = ['drums-clap', 'drums-cymbal', 'drums-hihat', 'drums-kick', 'drums-snare', 'percussion-conga', 'percussion-metallic',
  'percussion-rim', 'percussion-shaker', 'percussion-tom', 'drums-808', 'drums-909', 'gated-hall-snare', 'kick-synth', 'metall-crash',
  'metall-hihat', 'metall-ride', 'resonator-conga'];

const namen = (b) => (!b ? [] : b.alle ? b.alle.flatMap(namen) : b.eine ? b.eine.flatMap(namen) : [Object.values(b)[0][0]]);

for (const g of GRAPHEN) {
  test(`${g}: every rule names controls of the panel and has a text`, () => {
    const sts = panel(g);
    const ids = new Set(sts.map((c) => c.id));
    for (const c of sts.filter((x) => x.wirkt)) {
      assert.equal(typeof c.wirkt_text, 'string', `${c.id}: text`);
      assert.ok(c.wirkt_text.length > 0, `${c.id}: text`);
      for (const n of namen(c.wirkt)) assert.ok(ids.has(n), `${c.id}: ${n}`);
    }
  });

  test(`${g}: every knob of the graph is bound by a control`, (t) => {
    const datei = path.join(GERAETE, `${g}.json`);
    if (!fs.existsSync(datei)) return t.skip('graph not installed');
    const graph = JSON.parse(fs.readFileSync(datei, 'utf8'));
    const nummern = new Set((graph.knoten ?? []).filter((n) => n.art === 'regler').map((n) => n.nr));
    const gebunden = new Set(panel(g).map((c) => c.bind?.param).filter(Boolean));
    for (const nr of nummern) assert.ok(gebunden.has(`k${nr}`), `knob k${nr} is not bound`);
  });
}

test('Kick: pitch decay is greyed while the pitch drop is off', () => {
  const p = panel('drums-kick');
  assert.ok(ruhendeSteuerungen(p, { k2: 0 }).pdec);
  assert.equal(ruhendeSteuerungen(p, { k2: 0.5 }).pdec, null);
});

test('Drum kits: kick pitch time follows kick punch, resonance follows the DJ filter', () => {
  for (const g of ['drums-808', 'drums-909']) {
    const p = panel(g);
    const r = ruhendeSteuerungen(p, { k3: 0, k8: 0.5 });   // k3 kick punch, k8 DJ filter (centre = off) in both kits
    assert.ok(r['kick-pdecay'], `${g} pitch time`);
    assert.ok(r.reso, `${g} resonance`);
    const an = ruhendeSteuerungen(p, { k3: 0.5, k8: 0.2 });
    assert.equal(an['kick-pdecay'], null);
    assert.equal(an.reso, null);
  }
});
