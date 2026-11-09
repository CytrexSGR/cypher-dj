// Package 1.9 U4 (O28, T4.3): the mapping between the project's RB-338 values (0..1) and the display units of the presets, and the preset
// command. The golden table is the one of djk/instruments/rb_dsp/tests/abbildung_golden.rs (Def::wert, f32, 11 points per parameter).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normZuWert, wertZuNorm, presetZuParameter, RB_VORGABE_NORM7 } from '../project/rb_mapping.ts';
import { RB_VORGABE_NORM, RB_PARAMETER } from '../project/model.ts';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { PresetSpeicher } from '../presets/store.ts';
import { specProjekt } from './support/project.mjs';

// Pinned copy of GOLD in rb_dsp/tests/abbildung_golden.rs (the next test compares both texts)
const GOLD = {
  lautstaerke: [0.003981071, 0.0040649557, 0.005394437, 0.011355927, 0.02779478, 0.063095726, 0.12823954, 0.23684719, 0.40521672, 0.65235376, 1.0],
  wellenform: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0],
  cutoff: [40.0, 40.496, 47.936, 80.17601, 166.97601, 350.0, 682.8161, 1230.8959, 2071.6162, 3294.2556, 5000.0],
  resonanz: [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
  env_mod: [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
  decay: [0.2, 0.21800001, 0.272, 0.362, 0.48800004, 0.65, 0.848, 1.082, 1.3520001, 1.6579999, 2.0],
  accent: [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
};
const naeher = (a, b, rel) => Math.abs(a - b) <= rel * Math.max(Math.abs(b), 1e-12);

test('T4.3 golden: the TS table is the table of the Rust test, number for number', () => {
  const rs = fs.readFileSync(new URL('../../instruments/rb_dsp/tests/abbildung_golden.rs', import.meta.url), 'utf8');
  const kopf = /const GOLD: \[\(&str, \[f32; 11\]\); 7\] = \[([\s\S]*?)\n\];/.exec(rs);
  assert.ok(kopf, 'GOLD table not found in abbildung_golden.rs');
  const zeilen = [...kopf[1].matchAll(/\("([a-z_]+)", \[([^\]]*)\]\)/g)].map((m) => [m[1], m[2].split(',').map((x) => parseFloat(x))]);
  assert.equal(zeilen.length, 7);
  for (const [id, werte] of zeilen) assert.deepEqual(werte, GOLD[id], id);
  assert.deepEqual(zeilen.map((z) => z[0]), RB_PARAMETER, 'same parameters in the same order as the project model');
});

test('T4.3 forward: normZuWert at the 11 golden points (1e-5 relative; the Rust side computes in f32)', () => {
  for (const id of RB_PARAMETER) {
    GOLD[id].forEach((soll, i) => {
      const ist = normZuWert(id, i / 10);
      assert.ok(naeher(ist, soll, 1e-5), `${id} at ${i}/10: ${ist} vs ${soll}`);
    });
  }
});

test('T4.3 inverse: round-trip within 1e-6 on a fine grid, and the golden values map back to the golden points', () => {
  for (const id of RB_PARAMETER.filter((x) => x !== 'wellenform')) {
    for (let i = 0; i <= 100; i += 1) {
      const n = i / 100;
      const zurueck = wertZuNorm(id, normZuWert(id, n));
      assert.ok(Math.abs(zurueck - n) <= 1e-6, `${id} ${n}: ${zurueck}`);
    }
    GOLD[id].forEach((w, i) => assert.ok(Math.abs(wertZuNorm(id, w) - i / 10) <= 2e-4, `${id} golden ${i}: ${wertZuNorm(id, w)}`));
  }
  assert.equal(wertZuNorm('wellenform', true), 1);
  assert.equal(wertZuNorm('wellenform', false), 0);
  assert.equal(normZuWert('wellenform', 0.5), 0, 'the switch is on above 0.5 only, like BoolParam');
  assert.equal(normZuWert('wellenform', 0.51), 1);
});

test('T4.3 inverse: values outside the range are clamped, not extrapolated', () => {
  assert.equal(wertZuNorm('cutoff', 20), 0);
  assert.equal(wertZuNorm('cutoff', 9000), 1);
  assert.equal(wertZuNorm('decay', 5), 1);
  assert.equal(wertZuNorm('lautstaerke', 0), 0);
});

test('T4.3 defaults: the seven plugin defaults agree with RB_VORGABE_NORM of the model where both exist', () => {
  for (const k of Object.keys(RB_VORGABE_NORM)) assert.ok(naeher(RB_VORGABE_NORM7[k], RB_VORGABE_NORM[k], 1e-9), `${k}: ${RB_VORGABE_NORM7[k]} vs ${RB_VORGABE_NORM[k]}`);
  assert.ok(naeher(normZuWert('cutoff', RB_VORGABE_NORM7.cutoff), 800, 1e-9));
  assert.ok(naeher(normZuWert('decay', RB_VORGABE_NORM7.decay), 0.6, 1e-9));
  assert.equal(RB_VORGABE_NORM7.wellenform, 0);
  assert.equal(RB_VORGABE_NORM7.accent, 0.6);
});

test('T4.3 AK-O6 mapping: the factory preset dark-dub (cutoff 200 Hz) becomes a normalised value that maps forward to 200 Hz within 0.5 %', () => {
  const speicher = new PresetSpeicher();
  const p = speicher.lies('werk', 'rb338', 'dark-dub');
  assert.equal(p.werte.cutoff, 200);
  const parameter = presetZuParameter(p.werte);
  assert.deepEqual(Object.keys(parameter).sort(), [...RB_PARAMETER].sort());
  assert.ok(naeher(normZuWert('cutoff', parameter.cutoff), 200, 0.005), String(normZuWert('cutoff', parameter.cutoff)));
  assert.equal(parameter.wellenform, 1, 'the square wave switch of the preset (true)');
  assert.ok(naeher(normZuWert('lautstaerke', parameter.lautstaerke), 0.2511886432, 1e-4));
  for (const v of Object.values(parameter)) assert.ok(v >= 0 && v <= 1);
});

test('T4.3 presetZuParameter: a preset with a subset writes only that subset; an unknown parameter is refused', () => {
  assert.deepEqual(presetZuParameter({ cutoff: 800 }), { cutoff: wertZuNorm('cutoff', 800) });
  assert.throws(() => presetZuParameter({ cutoff: 800, knob1: 0.5 }), /knob1/);
  assert.throws(() => presetZuParameter({ cutoff: 'hoch' }), /cutoff/);
});

// --- the command ----------------------------------------------------------------------------------------------------
const lehntAb = (fn, grund) => assert.throws(fn, (e) => e instanceof BefehlFehler && e.grund === grund, `expected ${grund}`);
const rbSpur = (p) => p.spuren.find((s) => s.geraet?.name === 'rb338');
const presetLies = (id) => {
  const m = /^(werk|nutzer):([a-z0-9]+)\/([a-z0-9-]+)$/.exec(id);
  if (!m) return null;
  try { return new PresetSpeicher().lies(m[1], m[2], m[3]); } catch { return null; }
};

test('T4.3 preset_anwenden: sets the whole parameter object from the preset, one undo step restores it deep-equal (AK-O3 at model level)', () => {
  const p = specProjekt();
  const spur = rbSpur(p) ?? p.spuren.find((s) => s.art === 'instrument');
  spur.geraet = { art: 'intern', name: 'rb338', parameter: { cutoff: 0.9, resonanz: 0.9 } };
  const vorher = structuredClone(p);
  const r = fuehreListeAus(p, [{ befehl: 'preset_anwenden', spur_id: spur.id, preset: 'werk:rb338/dark-dub' }], { presetLies });
  const neu = r.projekt.spuren.find((s) => s.id === spur.id);
  assert.ok(naeher(normZuWert('cutoff', neu.geraet.parameter.cutoff), 200, 0.005));
  assert.equal(neu.geraet.parameter.wellenform, 1);
  assert.equal('resonanz' in neu.geraet.parameter, true);
  assert.equal(r.betrifft_wiedergabe, true);
  assert.deepEqual(p, vorher, 'the input project is not changed');
  assert.ok(r.zurueck.length > 0);
});

test('T4.3 preset_anwenden: refusals leave the project alone', () => {
  const p = specProjekt();
  const spur = p.spuren.find((s) => s.art === 'instrument');
  spur.geraet = { art: 'intern', name: 'rb338', parameter: {} };
  const befehl = (extra) => [{ befehl: 'preset_anwenden', spur_id: spur.id, preset: 'werk:rb338/dark-dub', ...extra }];
  lehntAb(() => fuehreListeAus(p, befehl({ preset: 'werk:rb338/gibt-es-nicht' }), { presetLies }), 'preset_unbekannt');
  lehntAb(() => fuehreListeAus(p, befehl({ preset: '../etc/passwd' }), { presetLies }), 'argument_ungueltig');
  lehntAb(() => fuehreListeAus(p, befehl({ preset: 'werk:hall/dark-dub' }), { presetLies }), 'argument_ungueltig');   // a Hall preset on an RB-338 track
  lehntAb(() => fuehreListeAus(p, befehl({ spur_id: 'gibt-es-nicht' }), { presetLies }), 'spur_unbekannt');
  lehntAb(() => fuehreListeAus(p, befehl({ extra: 1 }), { presetLies }), 'argument_unbekannt');
  lehntAb(() => fuehreListeAus(p, befehl({}), {}), 'preset_unbekannt');                      // no lookup injected: nothing can be applied
  spur.geraet = { art: 'wirt', name: 'surge', slot: 1 };
  lehntAb(() => fuehreListeAus(p, befehl({}), { presetLies }), 'argument_ungueltig');       // not an RB-338 track
  // negative control: the same command on the RB-338 track passes
  spur.geraet = { art: 'intern', name: 'rb338', parameter: {} };
  assert.ok(fuehreListeAus(p, befehl({}), { presetLies }).projekt);
});
