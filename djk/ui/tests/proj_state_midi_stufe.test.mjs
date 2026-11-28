// Strand 7 task 1.6: the MIDI stage of a track in proj_lage in real units (pure function on a project object).
import test from 'node:test';
import assert from 'node:assert/strict';
import { midiLage } from '../areas/proj/session.ts';

test('sync arp 1/16 at 128 BPM: step 117.2 ms, gate 58.6 ms, 16 steps per 4/4 bar', () => {
  const m = midiLage({ akkord: { intervalle: [4, 7] }, arp: { muster: 'up', sync: true, rate: '1/16', oktaven: 2, gate: 0.5 }, chance: 80 }, 128, [4, 4]);
  assert.deepEqual(m, { kette: ['akkord', 'arp', 'chance'],
    arp: { muster: 'up', rate: '1/16', schritt_ms: 117.2, schritte_je_takt: 16, oktaven: 2, gate_ms: 58.6 } });
});

test('free arp 8 Hz: step 125 ms, steps per bar null; aus is shown', () => {
  const m = midiLage({ aus: true, arp: { muster: 'random', sync: false, hz: 8, oktaven: 1, gate: 0.5 } }, 120, [4, 4]);
  assert.deepEqual(m, { aus: true, kette: ['arp'], arp: { muster: 'random', rate: '8 Hz', schritt_ms: 125, schritte_je_takt: null, oktaven: 1, gate_ms: 62.5 } });
});

test('chain without arp has no arp member; order is fixed', () => {
  const m = midiLage({ chance: 50, velocity: { kurve: 0, zufall: 0 }, skala: { quelle: 'projekt' } }, 120, [3, 4]);
  assert.deepEqual(m, { kette: ['skala', 'velocity', 'chance'] });
});

// Strand 7 task 3.3: the core's stage counters (/zustand/arr/midi) appear as midi.zaehler; the lage keeps the latest per track
test('counters: /zustand/arr/midi is kept per track and shown as zaehler; null before the core reported, gone after a new core', async () => {
  const { KernLage } = await import('../areas/proj/state.ts');
  const lage = new KernLage();
  assert.equal(lage.midiZaehler(2), null);
  lage.nimm('/zustand/arr/midi', { spur: 2, gehalten: 3, ein: 9, aus: 40, verloren: 0 });
  lage.nimm('/zustand/arr/midi', { spur: 5, gehalten: 0, ein: 1, aus: 1, verloren: 0 });
  lage.nimm('/zustand/arr/midi', { spur: 2, gehalten: 0, ein: 12, aus: 48, verloren: 1 });
  assert.deepEqual(lage.midiZaehler(2), { gehalten: 0, ein: 12, aus: 48, verloren: 1 });
  const m = midiLage({ chance: 50 }, 120, [4, 4], lage.midiZaehler(2));
  assert.deepEqual(m, { kette: ['chance'], zaehler: { gehalten: 0, ein: 12, aus: 48, verloren: 1 } });
  assert.deepEqual(midiLage({ chance: 50 }, 120, [4, 4], lage.midiZaehler(7)), { kette: ['chance'], zaehler: null });
  lage.nimm('/k/willkommen', { generation: 1 });
  lage.nimm('/e/neustart', { generation: 2 });
  assert.equal(lage.midiZaehler(5), null);
});
