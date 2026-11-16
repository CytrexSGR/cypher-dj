// Sampler C task 2: YIN root detection on a region of a cut and the root proposal. Signals are built here (48 kHz stereo, deterministic).
import test from 'node:test';
import assert from 'node:assert/strict';
import { TON_SCHWELLE, erkenneGrundton, grundVorschlag } from '../sampler/tone_hoehe.ts';

const FR = 24000;
const stereo = (frames, f) => { const d = new Float32Array(frames * 2); for (let i = 0; i < frames; i++) { d[2 * i] = f(i); d[2 * i + 1] = f(i); } return d; };
const saege = (hz, frames = FR) => stereo(frames, (i) => 0.5 * (2 * ((i * hz / 48000) % 1) - 1));
const sinus = (hz, frames = FR) => stereo(frames, (i) => 0.5 * Math.sin(2 * Math.PI * hz * i / 48000));
// 32-bit LCG: deterministic white noise in -0.5..0.5
function rauschen(seed, frames = FR) {
  let s = seed >>> 0;
  return stereo(frames, () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 - 0.5; });
}

test('a 220 Hz sawtooth is note 57 with high confidence', () => {
  const e = erkenneGrundton(saege(220), 0, FR);
  assert.equal(e.note, 57); assert.ok(e.konfidenz >= 0.9); assert.ok(Math.abs(e.hz - 220) < 1);
});

test('sines at both ends of the range', () => {
  assert.equal(erkenneGrundton(sinus(82.41), 0, FR).note, 40);
  assert.equal(erkenneGrundton(sinus(1500), 0, FR).note, 90);
});

test('white noise stays below the threshold', () => {
  const k = erkenneGrundton(rauschen(12345), 0, FR).konfidenz;
  console.log(`noise confidence (seed 12345): ${k.toFixed(3)}`);
  assert.ok(k < TON_SCHWELLE);
});

test('silence and a short region give no note (review focus 5)', () => {
  assert.deepEqual(erkenneGrundton(new Float32Array(48000), 0, FR), { note: null, hz: null, konfidenz: 0 });
  assert.equal(erkenneGrundton(saege(220), 0, 3000).konfidenz, 0);
  assert.deepEqual(erkenneGrundton(saege(220), 0, 3000), { note: null, hz: null, konfidenz: 0 });
  assert.deepEqual(erkenneGrundton(saege(220), 5000, 5000), { note: null, hz: null, konfidenz: 0 });   // empty region
  assert.deepEqual(erkenneGrundton(saege(220), 22000, 40000), { note: null, hz: null, konfidenz: 0 });   // region beyond the data: only 2000 frames are there
});

test('a region inside the data is read from a, not from 0', () => {
  const r = rauschen(7, 12000), s = saege(330), d = new Float32Array((12000 + FR) * 2);
  d.set(r, 0); d.set(s, 24000);
  const e = erkenneGrundton(d, 12000, 12000 + FR);
  assert.equal(e.note, 64);
  assert.ok(erkenneGrundton(d, 0, 12000).konfidenz < TON_SCHWELLE);
});

test('grundVorschlag', () => {
  assert.deepEqual(grundVorschlag({ note: 57, hz: 220, konfidenz: 0.9 }), { note: 57, quelle: 'erkannt' });
  assert.deepEqual(grundVorschlag({ note: 57, hz: 220, konfidenz: 0.3 }, '8A'), { note: 69, quelle: 'tonart' });
  assert.deepEqual(grundVorschlag({ note: null, hz: null, konfidenz: 0 }, '8B'), { note: 60, quelle: 'tonart' });
  assert.deepEqual(grundVorschlag({ note: null, hz: null, konfidenz: 0 }, 'Am'), { note: 60, quelle: 'vorgabe' });
  assert.deepEqual(grundVorschlag({ note: 57, hz: 220, konfidenz: TON_SCHWELLE }), { note: 57, quelle: 'erkannt' });
  assert.deepEqual(grundVorschlag({ note: null, hz: null, konfidenz: 0 }), { note: 60, quelle: 'vorgabe' });
  assert.deepEqual(grundVorschlag({ note: null, hz: null, konfidenz: 0 }, '5A'), { note: 60 + ((((5 - 8) * 7) % 12 + 12) % 12 + 9) % 12, quelle: 'tonart' });
});
