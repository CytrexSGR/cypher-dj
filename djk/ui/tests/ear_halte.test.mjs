// Regression (audit C02): the ear reader as the server builds it (default halte) must be able to answer /hoeren for the
// takte range the route accepts (1..16). At 128 BPM, 10 bars are 18750 records at 1 kHz; the default holds 16384.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { K, OhrLeser, hoerAntwort } from '../ear.ts';
import { schreibeRing } from './support/ring.mjs';

test('hoerAntwort with takte=10 at 128 BPM succeeds after a long, continuously read play', () => {
  const pfad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ohr-audit-')), 'huellen');
  const bpm = 128, takte = 10;
  const beatJeSatz = bpm / 60000;  // 1 record per ms
  const satz = (i) => ({ sample: i * 48, beat: i * beatJeSatz, quell: NaN, band: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1], k: 1e-3, spitze: 0.2 });
  // same channels and default halte as server.ts:619
  const l = new OhrLeser(pfad, [K.deck1, K.deck2, K.deck3, K.deck4, K.master]);
  const N = 20000, stueck = 5000;
  let w = 0;
  for (let ab = 0; ab < N; ab += stueck) {
    const d = Array.from({ length: stueck }, (_, j) => satz(ab + j));
    w = schreibeRing(pfad, { [K.deck1]: d, [K.master]: d }, { rAb: ab, neu: ab === 0 });
    l.lies();  // the server reads every 100 ms, so nothing is lost to the ring
  }
  const uhrBeat = w * beatJeSatz;
  const r = hoerAntwort(l, { deck: 1, geladen: true, laeuft: true, offen: false }, uhrBeat, bpm, takte);
  assert.equal(r.code, 200, `got ${JSON.stringify(r.j)}`);
});
