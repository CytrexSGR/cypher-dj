// Front panel scaling (public/panel_skala.js): the page, the page server and later the agent layer share ONE normalised <-> plain
// conversion. It must equal the engine's regler node (instruments/modular_dsp/src/programm.rs, Schritt::Regler):
//   linear: min + (max - min) * k      log: min * (max / min)^k
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { skaliere, entskaliere, diskretWert, diskretIndex, formatiereWert, klemme01, FORMATE } from '../public/panel_skala.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('scaling: linear and log match the engine formula, ends and middle', () => {
  const lin = { min: 0, max: 3000, log: false }, log = { min: 450, max: 7200, log: true };
  assert.equal(skaliere(0, lin), 0);
  assert.equal(skaliere(1, lin), 3000);
  assert.equal(skaliere(0.5, lin), 1500);
  close(skaliere(0, log), 450);
  close(skaliere(1, log), 7200);
  close(skaliere(0.5, log), 1800);                       // 450 * 16^0.5: the geometric middle, not the arithmetic one (3825)
  close(skaliere(0.25, log), 450 * (7200 / 450) ** 0.25);
  assert.equal(skaliere(2, lin), 3000, 'out of range is clamped like programm.rs setze_regler (0..1)');
  assert.equal(skaliere(-1, lin), 0);
  assert.equal(skaliere(NaN, lin), 0);
});

test('scaling matches the engine source: the formula text is still in programm.rs', () => {
  const rs = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'instruments', 'modular_dsp', 'src', 'programm.rs'), 'utf8');
  assert.match(rs, /if \*log \{ \*min \* \(\*max \/ \*min\)\.powf\(k\) \} else \{ \*min \+ \(\*max - \*min\) \* k \}/, 'the engine formula changed: update panel_skala.js and this test');
});

test('scaling: entskaliere is the inverse, clamped; degenerate ranges map to 0', () => {
  for (const b of [{ min: 0, max: 3000, log: false }, { min: 200, max: 8000, log: true }, { min: -24, max: 6, log: false }]) {
    for (const k of [0, 0.1, 0.5, 0.9, 1]) close(entskaliere(skaliere(k, b), b), k, 1e-12);
  }
  assert.equal(entskaliere(99999, { min: 0, max: 10, log: false }), 1);
  assert.equal(entskaliere(-5, { min: 0, max: 10, log: false }), 0);
  assert.equal(entskaliere(5, { min: 3, max: 3, log: false }), 0);
  assert.equal(entskaliere(5, { min: 0, max: 3, log: true }), 0, 'log with min 0 is refused by the engine; never NaN here');
  assert.equal(entskaliere(NaN, { min: 0, max: 1, log: false }), 0);
  assert.equal(klemme01(Infinity), 0);
});

test('discrete controls: position i of n is stored as i/(n-1) and read back by rounding', () => {
  assert.deepEqual([0, 1, 2, 3].map((i) => diskretWert(i, 4)), [0, 1 / 3, 2 / 3, 1]);
  for (const n of [2, 3, 4, 8]) for (let i = 0; i < n; i++) assert.equal(diskretIndex(diskretWert(i, n), n), i);
  assert.equal(diskretIndex(0.49, 2), 0);
  assert.equal(diskretIndex(0.5, 2), 1);
  assert.equal(diskretWert(0, 1), 0, 'a single option has no travel');
  assert.equal(diskretIndex(5, 3), 2, 'clamped');
});

test('value text: units, ranges and the fixed precision that keeps the readout from jittering', () => {
  assert.equal(formatiereWert(1800, 'hz'), '1.80 kHz');
  assert.equal(formatiereWert(999.4, 'hz'), '999 Hz');
  assert.equal(formatiereWert(450, 'hz'), '450 Hz');
  assert.equal(formatiereWert(45.04, 'hz'), '45.0 Hz');
  assert.equal(formatiereWert(7.5, 'hz'), '7.50 Hz');
  assert.equal(formatiereWert(12000, 'hz'), '12.0 kHz');
  assert.equal(formatiereWert(-6.04, 'db'), '-6.0 dB');
  assert.equal(formatiereWert(-0.04, 'db'), '0.0 dB', 'no "-0.0"');
  assert.equal(formatiereWert(375, 'ms'), '375 ms');
  assert.equal(formatiereWert(1500, 'ms'), '1.50 s');
  assert.equal(formatiereWert(0.5, 'percent'), '50 %');
  assert.equal(formatiereWert(0.3, 'raw'), '0.30');
  assert.equal(formatiereWert(0.3, undefined, 'x'), '0.30 x');
  assert.equal(formatiereWert(NaN, 'hz'), '-');
  assert.deepEqual(FORMATE, ['hz', 'db', 'ms', 'percent', 'raw']);
});
