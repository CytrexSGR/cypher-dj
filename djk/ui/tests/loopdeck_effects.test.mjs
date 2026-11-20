// Loop deck channel strip MZ3: which effect graphs qualify for the per-track effect slot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loopFxGraphen, LOOP_FX_LATENZ_MAX, LOOP_FX_NUR_NASS, LOOP_FX_ZUERST } from '../areas/live/loopdeck_effects.ts';

const e = (name, art, latenz) => ({ name, art, regler_namen: {}, latenz });

test('constants', () => {
  assert.equal(LOOP_FX_LATENZ_MAX, 64);
  assert.deepEqual([...LOOP_FX_NUR_NASS], ['fx-delay-sync']);
  assert.deepEqual([...LOOP_FX_ZUERST], ['fx-remix', 'fx-crunch']);
});

test('loopFxGraphen keeps low-latency effects, drops instruments, wet-only and slow graphs, and orders remix, crunch, then by name', () => {
  const liste = [e('fx-zzz', 'effekt', 0), e('inst-a', 'instrument', 0), e('fx-slow', 'effekt', 69), e('fx-delay-sync', 'effekt', 0),
    e('fx-crunch', 'effekt', 46), e('fx-remix', 'effekt', 0), e('fx-edge', 'effekt', 64), e('fx-over', 'effekt', 65)];
  assert.deepEqual(loopFxGraphen(liste), [
    { name: 'fx-remix', kurz: 'REMIX', latenz: 0 }, { name: 'fx-crunch', kurz: 'CRUNCH', latenz: 46 },
    { name: 'fx-edge', kurz: 'EDGE', latenz: 64 }, { name: 'fx-zzz', kurz: 'ZZZ', latenz: 0 }]);
});

test('kurz is the name without a leading fx-, cut to 6 characters, upper case', () => {
  assert.deepEqual(loopFxGraphen([e('fx-flanger-long', 'effekt', 0), e('chorus', 'effekt', 0)]).map((g) => g.kurz), ['CHORUS', 'FLANGE']);
});
