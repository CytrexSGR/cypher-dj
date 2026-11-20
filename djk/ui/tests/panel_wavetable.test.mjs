// Panels of the wavetable group: the role instruments (bass, lead, pad, keys, texture) and the reviewed Band Drive Bass and Greif.
// Every rule names controls of its panel and carries a text; every knob of the installed graph is bound by a control.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ruhendeSteuerungen } from '../public/panel_wirkung.js';
import { steuerungen } from '../public/panel.js';

const panel = (name) => steuerungen(JSON.parse(fs.readFileSync(new URL(`../../instruments/modular_dsp/paneele/${name}.json`, import.meta.url), 'utf8')));
const regelnPruefen = (titel, name, mindestens) => test(`${titel}: every rule names controls of the panel`, () => {
  const sts = panel(name);
  const ids = new Set(sts.map((c) => c.id));
  const namen = (b) => (!b ? [] : b.alle ? b.alle.flatMap(namen) : b.eine ? b.eine.flatMap(namen) : [Object.values(b)[0][0]]);
  const mit = sts.filter((x) => x.wirkt);
  assert.ok(mit.length >= mindestens, `${mit.length} rules`);
  for (const c of mit) {
    assert.equal(typeof c.wirkt_text, 'string', `${c.id}: text`);
    assert.ok(c.wirkt_text.length > 0, `${c.id}: text`);
    for (const n of namen(c.wirkt)) assert.ok(ids.has(n), `${c.id}: ${n}`);
  }
});

const graphKnoepfe = (name) => {
  const g = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'cypherdj/werke/geraete', `${name}.json`), 'utf8'));
  return [...new Set(g.knoten.filter((k) => k.art === 'regler').map((k) => k.nr))];
};
const knoepfeGebunden = (name) => test(`${name}: every knob of the graph is bound by a control`, () => {
  const gebunden = new Set(panel(name).filter((c) => c.bind?.param).map((c) => c.bind.param));
  for (const nr of graphKnoepfe(name)) assert.ok(gebunden.has(`k${nr}`), `k${nr} is not bound`);
});

// [graph, minimum number of rules]
const GERAETE = [
  ['bass-pluck', 0], ['bass-reese', 0], ['bass-rolling', 0], ['bass-wobble', 0], ['fx-texture', 0], ['keys-chord', 0],
  ['lead-mono', 0], ['lead-supersaw', 0], ['pad-choir', 1], ['pad-granular', 0], ['pad-strings', 1],
  ['bass-banddrive', 2], ['synth-greif', 30],
];
for (const [name, n] of GERAETE) { regelnPruefen(name, name, n); knoepfeGebunden(name); }

test('Choir Pad: a full Vowel mix greys the cutoff', () => {
  const p = panel('pad-choir');
  assert.ok(ruhendeSteuerungen(p, { k2: 1 }).cutoff);
  assert.equal(ruhendeSteuerungen(p, { k2: 0.5 }).cutoff, null);
});

test('String Pad: no envelope amount greys the filter attack', () => {
  const p = panel('pad-strings');
  assert.ok(ruhendeSteuerungen(p, { k3: 0 }).fattack);
  assert.equal(ruhendeSteuerungen(p, { k3: 0.5 }).fattack, null);
});

test('Band Drive Bass: no Air greys High drive, no envelope amount greys Env decay', () => {
  const p = panel('bass-banddrive');
  const still = ruhendeSteuerungen(p, { k20: 0, k12: 0 });
  assert.ok(still.c19); assert.ok(still.c13);
  const laut = ruhendeSteuerungen(p, { k20: 0.67, k12: 0.43 });
  assert.equal(laut.c19, null); assert.equal(laut.c13, null);
});

test('Greif: silent oscillators, sub, off warp and a centred envelope amount grey their controls', () => {
  const p = panel('synth-greif');
  // A level 0, B level 0, PM B>A 0, C level 0, PM C>x 0, sub 0, all warps Off, filter env amount and Env3 >Position centred, mods and effects at 0
  const k = { k6: 0, k12: 0, k17: 0, k18: 0, k19: 0, k20: 0, k26: 0, k2: 0, k8: 0, k14: 0, k31: 0.5, k47: 0.5, k49: 0, k50: 0, k52: 0, k53: 0, k55: 0, k56: 0, k58: 0, k61: 0 };
  const r = ruhendeSteuerungen(p, k);
  for (const id of ['c1', 'c3', 'c7', 'c9', 'c13', 'c15', 'c18', 'c19', 'c21', 'c24', 'c25', 'c37', 'c45', 'c48', 'c51', 'c53', 'c54', 'c57', 'c60']) assert.ok(r[id], id);
  // A on a Bend warp: depth is heard; B heard through PM B>A; the sub, the filter envelope and the shifter come back
  const an = ruhendeSteuerungen(p, { ...k, k6: 0.7, k2: 1 / 3, k18: 0.3, k26: 0.3, k31: 0.8, k58: 0.3 });
  for (const id of ['c1', 'c3', 'c7', 'c21', 'c24', 'c37', 'c57']) assert.equal(an[id], null, id);
  assert.ok(an.c9);   // B has no warp mode
});
