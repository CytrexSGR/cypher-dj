// `regler` node with a centre value (`mitte`) and a start position (`vorgabe`) on the page side: skaliere/entskaliere honour `mitte`,
// reglerBereiche carries `mitte` and `vorgabe`, vorgabenVon lists the start positions of a graph. The golden table is written by the
// engine's test (instruments/modular_dsp/tests/regler_vorgabe_mitte.rs) and read here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { skaliere, entskaliere } from '../public/panel_skala.js';
import { reglerBereiche, vorgabenVon } from '../graphs.ts';
import { anzeigeWert } from '../public/panel_display.js';
import { anzeigeWert as serverAnzeige } from '../devices_parameter.ts';
import { reglerBereiche as ansichtBereiche } from '../public/production/device_view.js';
import { BK_REGLER_ZAHL } from '../project/modular.ts';

const DSP = path.join(import.meta.dirname, '..', '..', 'instruments', 'modular_dsp');
const TAFEL = JSON.parse(fs.readFileSync(path.join(DSP, 'tests', 'regler_mitte_tafel.json'), 'utf8'));

// 1e-6 relative, with a floor of 1e-3 of the range so values near a zero crossing (float32 absolute error) do not blow up the relative error
const nah = (a, b, b0) => Math.abs(a - b) <= 1e-6 * Math.max(Math.abs(b), 1e-3 * Math.abs(b0.max - b0.min));

test('golden table: skaliere agrees with the engine, entskaliere inverts it', () => {
  assert.equal(TAFEL.saetze.length, 12);
  let n = 0;
  for (const s of TAFEL.saetze) {
    const b = { min: s.min, max: s.max, log: s.log, mitte: s.mitte };
    for (const p of s.punkte) {
      n++;
      assert.ok(nah(skaliere(p.k, b), p.wert, b), `skaliere(${p.k}) of ${JSON.stringify(b)}: ${skaliere(p.k, b)} vs engine ${p.wert}`);
      assert.ok(Math.abs(entskaliere(skaliere(p.k, b), b) - p.k) <= 1e-12, `round trip k ${p.k} of ${JSON.stringify(b)}: ${entskaliere(skaliere(p.k, b), b)}`);
      assert.ok(Math.abs(entskaliere(p.wert, b) - p.k) <= 1e-6, `entskaliere of the engine value k ${p.k} of ${JSON.stringify(b)}: ${entskaliere(p.wert, b)}`);
    }
    assert.equal(skaliere(0.5, b), s.mitte, 'knob 0.5 is exactly mitte');
    assert.equal(entskaliere(s.mitte, b), 0.5);
    assert.equal(skaliere(0, b), s.min);
    assert.equal(skaliere(1, b), s.max);
  }
  assert.equal(n, 156);
  assert.ok(TAFEL.saetze.some((s) => s.max < s.mitte && s.mitte < s.min && !s.log) && TAFEL.saetze.some((s) => s.max < s.mitte && s.mitte < s.min && s.log), 'inverted ranges, linear and log, are in the table');
});

test('mitte: ends clamp, out of range values clamp, no mitte is the old formula', () => {
  const b = { min: 0.001, max: 2, log: true, mitte: 0.002 };
  assert.equal(entskaliere(1e-9, b), 0);
  assert.equal(entskaliere(1e9, b), 1);
  assert.equal(entskaliere(NaN, b), 0);
  assert.equal(skaliere(NaN, b), b.min);
  const lin = { min: 0, max: 3000, log: false };
  assert.equal(skaliere(0.5, lin), 1500);
  assert.equal(skaliere(0.3, { ...lin, mitte: undefined }), 900, 'an explicit undefined is "absent"');
});

test('reglerBereiche returns mitte and vorgabe; nodes the engine would refuse are left out', () => {
  const g = { knoten: [
    { art: 'regler', nr: 1, min: 0, max: 1 },
    { art: 'regler', nr: 2, min: 0, max: 1, vorgabe: 0.25 },
    { art: 'regler', nr: 3, min: 0.001, max: 2, log: 1, mitte: 0.002 },
    { art: 'regler', nr: 3, min: 5, max: 6, vorgabe: 0.9 },
    { art: 'regler', nr: 4, min: 0, max: 1, vorgabe: 1.5 },
    { art: 'regler', nr: 5, min: 0, max: 1, mitte: 1 },
    { art: 'regler', nr: 6, min: 0, max: 10, log: 1, mitte: 1 },
    { art: 'regler', nr: 7, min: 0, max: 1, mitte: 0.5, vorgabe: 0.25 },
    { art: 'regler', nr: 8, min: -1, max: 1, mitte: 0 },
  ] };
  assert.deepEqual(reglerBereiche(g), {
    1: { min: 0, max: 1, log: false, vorgabe: 0.5 },
    2: { min: 0, max: 1, log: false, vorgabe: 0.25 },
    3: { min: 0.001, max: 2, log: true, mitte: 0.002, vorgabe: 0.5 },
    8: { min: -1, max: 1, log: false, mitte: 0, vorgabe: 0.5 },
  });
});

test('vorgabenVon: BK_REGLER_ZAHL entries, the first node of a number wins, null for an unknown graph', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vorgaben-'));
  try {
    const g = { format: 'baukasten/2', name: 'fix', stimmen: 1, knoten: [
      { id: 'a', art: 'regler', nr: 3, min: 0, max: 1, vorgabe: 0.25 },
      { id: 'b', art: 'regler', nr: 3, min: 0, max: 1, vorgabe: 0.75 },
      { id: 'c', art: 'regler', nr: 5, min: 0, max: 1 },
      { id: 'd', art: 'regler', nr: 6, min: 0, max: 1, vorgabe: 0 },
    ], kanten: [] };
    fs.writeFileSync(path.join(dir, 'fix.json'), JSON.stringify(g));
    const v = vorgabenVon('fix', dir);
    assert.equal(v.length, BK_REGLER_ZAHL);
    assert.equal(v[2], 0.25);
    assert.equal(v[4], 0.5);
    assert.equal(v[5], 0);
    assert.equal(v[0], 0.5);
    assert.equal(vorgabenVon('gibt-es-nicht', dir), null);
    assert.equal(vorgabenVon('../fix', dir), null, 'a name that is no graph name is unknown');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("vorgabenVon('synth-poly') has BK_REGLER_ZAHL entries, all 0.5 except Drift (knob 28, 0.25) and the build-out's free parameters and gates at their off positions", () => {
  const v = vorgabenVon('synth-poly', path.join(DSP, 'demos'));
  assert.equal(v.length, BK_REGLER_ZAHL);
  assert.equal(v[27], 0.25, 'Drift');
  // Mod env A, D, R (31, 32, 34), LFO 2 rate, shape, sync, target (39..42), Osc 2 level, wave, sync (46, 47, 51), Glide (54): the values the graph's regler nodes carry
  const weg = v.map((x, i) => [i + 1, x]).filter(([, x]) => x !== 0.5).map(([nr]) => nr);
  assert.deepEqual(weg, [28, 31, 32, 34, 39, 40, 41, 42, 46, 47, 51, 54]);
  for (const nr of [40, 41, 42, 46, 47, 51, 54]) assert.equal(v[nr - 1], 0, `knob ${nr} starts at its off position`);
});

test('the readout copy panel_display.js equals the server anzeigeWert and the engine table for knobs with a mitte', () => {
  for (const s of TAFEL.saetze) {
    const p = { name: 'k1', min: s.min, max: s.max, log: s.log, mitte: s.mitte, vorgabe: 0.5 };
    for (const pt of s.punkte) {
      assert.equal(anzeigeWert(p, pt.k), serverAnzeige(p, pt.k), `copy vs server ${JSON.stringify(p)} k ${pt.k}`);
      assert.ok(nah(anzeigeWert(p, pt.k), pt.wert, p), `readout vs engine ${JSON.stringify(p)} k ${pt.k}`);
    }
    assert.equal(anzeigeWert(p, 0.5), s.mitte);
  }
  const m = { min: 0.001, max: 2, log: true, mitte: 0.002 };
  assert.equal(anzeigeWert(m, 0.5), 0.002, 'the measured case: 0.002, not the geometric middle 0.0447');
});

test('the device view keeps mitte and vorgabe of a bk table entry', () => {
  const t = [{ name: 'k3', min: 0.001, max: 2, log: true, mitte: 0.002, vorgabe: 0.5 }, { name: 'k4', min: 0, max: 1, log: false, vorgabe: 0.25 }, { name: 'volume', min: 0, max: 1 }];
  assert.deepEqual(ansichtBereiche(t), { 3: { min: 0.001, max: 2, log: true, mitte: 0.002, vorgabe: 0.5 }, 4: { min: 0, max: 1, log: false, vorgabe: 0.25 } });
});
