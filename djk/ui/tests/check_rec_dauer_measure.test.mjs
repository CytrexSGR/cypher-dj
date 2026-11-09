// Calibration of check/rec_dauer_measure.mjs (the instrument of abnahme_rec_dauer, 1.8 T11): synthetic takes with a known answer; each negative control must
// turn the verdict red (a take with gaps, a take that is too short, a lost impulse, a drifting impulse train is not read as right).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ImpulsZaehler, urteilTake, urteilImpulse, erwartung, KANAL_MODI } from '../check/rec_dauer_measure.mjs';

// interleaved stereo float32 with impulses of the given amplitude at the given frame indices on L and R
function stereo(frames, lOrte, lAmp, rOrte, rAmp) {
  const x = new Float32Array(frames * 2);
  for (const i of lOrte) x[2 * i] = lAmp;
  for (const i of rOrte) x[2 * i + 1] = rAmp;
  return x;
}

test('ImpulsZaehler: finds each impulse once, per channel, with global frame indices across chunk borders', () => {
  const orte = [1000, 24808, 48616];
  const x = stereo(60000, orte, 1.0, [24808], 0.5);
  const z = new ImpulsZaehler();
  z.fuettere(x.subarray(0, 2 * 24808 - 6));   // the chunk border cuts through the second impulse region (frame 24805)
  z.fuettere(x.subarray(2 * 24808 - 6));
  assert.deepEqual(z.l, orte);
  assert.deepEqual(z.r, [24808]);
  assert.equal(z.frames, 60000);
  assert.ok(Math.abs(z.spitzeL - 1) < 1e-6 && Math.abs(z.spitzeR - 0.5) < 1e-6);
});

test('ImpulsZaehler: a ring-down after the impulse is not a second impulse; a second one after the quiet time is', () => {
  const x = new Float32Array(2 * 1000);
  x[2 * 100] = 1; x[2 * 101] = 0.9; x[2 * 130] = 0.6;   // one impulse with a tail
  x[2 * 500] = 1;
  const z = new ImpulsZaehler();
  z.fuettere(x);
  assert.deepEqual(z.l, [100, 500]);
});

test('urteilTake: gaps, a status other than 0 and a length off by more than one cycle are red; one cycle off is still green', () => {
  const gut = { frames: 28_800_000, luecken: 0, status: 0 };
  assert.equal(urteilTake(gut, { fenster: 28_800_000, zyklus: 256 }).ok, true);
  assert.equal(urteilTake({ ...gut, frames: 28_800_000 - 256 }, { fenster: 28_800_000, zyklus: 256 }).ok, true);
  assert.equal(urteilTake({ ...gut, frames: 28_800_000 + 256 }, { fenster: 28_800_000, zyklus: 256 }).ok, true);
  const kurz = urteilTake({ ...gut, frames: 28_800_000 - 257 }, { fenster: 28_800_000, zyklus: 256 });
  assert.equal(kurz.ok, false); assert.match(kurz.grund, /frames/);
  const luecke = urteilTake({ ...gut, luecken: 1, status: 1 }, { fenster: 28_800_000, zyklus: 256 });
  assert.equal(luecke.ok, false); assert.match(luecke.grund, /gaps/);
  assert.equal(urteilTake({ ...gut, status: 3 }, { fenster: 28_800_000, zyklus: 256 }).ok, false);
});

test('erwartung: a mono source on both channels gives the impulse at full height on L and R in every channel mode; an unknown mode throws', () => {
  for (const m of KANAL_MODI) assert.deepEqual(erwartung(m, 10), { l: 10, r: 10, ampL: 1, ampR: 1 });
  assert.deepEqual(KANAL_MODI, ['stereo', 'links', 'rechts', 'summe']);
  assert.throws(() => erwartung('mitte', 10));
});

test('urteilImpulse: the right count with a constant spacing is green; a lost impulse, an extra one and a drifting spacing are red', () => {
  const rein = Array.from({ length: 10 }, (_, i) => 1000 + i * 23808);
  assert.equal(urteilImpulse(rein, 10).ok, true);
  assert.equal(urteilImpulse([], 0).ok, true);
  const verloren = rein.filter((_, i) => i !== 4);
  const v = urteilImpulse(verloren, 10);
  assert.equal(v.ok, false); assert.match(v.grund, /9 impulses, expected 10/);
  assert.equal(urteilImpulse([...rein, 300000], 10).ok, false);
  const drift = rein.map((o, i) => (i >= 5 ? o + 3 : o));   // three samples lost in the middle (one writer gap that was not marked)
  const d = urteilImpulse(drift, 10);
  assert.equal(d.ok, false); assert.match(d.grund, /spacing/);
  const eins = urteilImpulse(rein.map((o, i) => (i >= 5 ? o + 1 : o)), 10);   // one sample of rounding is tolerated
  assert.equal(eins.ok, true);
});
