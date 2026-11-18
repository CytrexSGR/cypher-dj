// A poll timer that fires late because the event loop was blocked (a synchronous request handler, e.g. the sampler shelf search
// with SUCHE_MS = 3000) must not be read as a stalled core clock. The core keeps playing; its /uhr packets are only read after the late timer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fahreRampe } from '../areas/live/ramp.ts';

test('fahreRampe: one late poll (blocked loop, telemetry not yet read) does not end the fade as "still"', async () => {
  let jetzt = 0, poll = 0;
  const beatBei = (ms) => 100 + ms / 500;           // 120 bpm, the core clock keeps running during the block
  let sichtbar = beatBei(0);                        // what /uhr last delivered to the page server
  const geschrieben = [];
  const ende = await fahreRampe({
    kern: { uhr: () => ({ beat: sichtbar, bpm: 120 }), laeuft: () => true },
    von: 0, nach: -200, beats: 16,                   // a 4-bar fade, 8 s
    schreibe: (db) => geschrieben.push({ beat: sichtbar, db }),
    jetzt: () => jetzt,
    warte: async (ms) => {
      poll++;
      if (poll === 50) { jetzt += 3000; return; }   // the timer fires 3 s late; the /uhr packets of those 3 s are still queued
      jetzt += ms; sichtbar = beatBei(jetzt);
    },
  });
  const erstesEnde = geschrieben.find((w) => w.db === -200);
  assert.equal(ende, 'erreicht', `the fade must run to its end on the clock, got '${ende}'`);
  assert.ok(erstesEnde.beat >= 116, `-200 dB written at beat ${erstesEnde.beat}, before the planned end at beat 116`);
});

test('fahreRampe: a clock that really stalls (polls keep coming, no beat progress) still ends as "still" after the stall limit', async () => {
  let jetzt = 0;
  const geschrieben = [];
  const ende = await fahreRampe({
    kern: { uhr: () => ({ beat: 100 + Math.min(jetzt, 2000) / 500, bpm: 120 }), laeuft: () => true },   // the clock stops at 2 s
    von: 0, nach: -200, beats: 16,
    schreibe: (db) => geschrieben.push({ ms: jetzt, db }),
    jetzt: () => jetzt,
    warte: async (ms) => { jetzt += ms; },
  });
  assert.equal(ende, 'still');
  assert.equal(geschrieben.at(-1).db, -200);
  assert.ok(geschrieben.at(-1).ms >= 3000 && geschrieben.at(-1).ms < 3100, `stall limit 1000 ms after the last beat advance: ${geschrieben.at(-1).ms} ms`);
});
