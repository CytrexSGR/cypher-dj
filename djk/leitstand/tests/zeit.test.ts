import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { beatBeiSample, jetztNs, monoBeiSample, phraseVonBeat, schlagVonBeat, taktVonBeat } from '../src/zeit.ts';

test('Golden-Werte §1.3: Takt.Schlag und Phrase', () => {
  const soll: [number, string][] = [[0, '1.1 P1'], [3.5, '1.4 P1'], [64, '17.1 P3'], [127.99, '32.4 P4'], [128, '33.1 P5']];
  for (const [b, s] of soll) assert.equal(`${taktVonBeat(b)}.${schlagVonBeat(b)} P${phraseVonBeat(b)}`, s, `Beat ${b}`);
});

test('Golden-Werte §1.3: beat(1 440 000) = 64 bei konstant 128', () => {
  const u = { sample: 0, mono_ns: 0, beat: 0, bpm: 128, bpm_pro_s: 0 };
  assert.ok(Math.abs(beatBeiSample(u, 1440000) - 64) < 1e-9);
});

test('Golden-Werte §1.3: Rampe 128 → 132 ab Beat 128, sample 3 237 188,004 ist Beat 144', () => {
  const T = (32 * 60) / ((128 + 132) / 2); // 14,769231 s
  const u = { sample: 2880000, mono_ns: 0, beat: 128, bpm: 128, bpm_pro_s: 4 / T };
  assert.ok(Math.abs(beatBeiSample(u, 3237188.004) - 144) < 1e-6);
  // Fehlerfall: ohne k (als wäre das Tempo konstant) läge der Beat deutlich daneben
  assert.ok(Math.abs(beatBeiSample({ ...u, bpm_pro_s: 0 }, 3237188.004) - 144) > 0.1);
});

test('monoBeiSample rechnet vom Blockanfang: 256 Samples sind 5,333 ms', () => {
  const u = { sample: 1000, mono_ns: 5e9, beat: 0, bpm: 128, bpm_pro_s: 0 };
  assert.equal(monoBeiSample(u, 1256), 5e9 + 5333333);
});

test('jetztNs ist CLOCK_MONOTONIC (Vergleich mit python3 time.monotonic_ns, ±50 ms)', () => {
  const vor = jetztNs();
  const py = Number(execFileSync('python3', ['-c', 'import time; print(time.monotonic_ns())']).toString().trim());
  const nach = jetztNs();
  assert.ok(py >= vor - 50e6 && py <= nach + 50e6, `node ${vor}..${nach}, python ${py}`);
});
