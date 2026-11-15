// GET /hoeren on a place that carries a SEQ deck (ADR 038): the deck player of that place is empty, but a group of the live container plays into
// the channel strip deck/N, so the ear must read that channel instead of answering 409 kein_kernstand.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { K, OhrLeser, hoerAntwort, hoerLage } from '../ear.ts';
import { schreibeRing } from './support/ring.mjs';

const tmpPfad = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ohr-seq-')), name);
const satz = (sample, beat, band, k, spitze) => ({ sample, beat, quell: NaN, band, k, spitze });
// one record per millisecond over `bars` bars at 120 bpm, a steady level on every band
function ringSaetze(bis, bars, pegel) {
  const n = Math.round(bars * 4 * 0.5 * 1000);   // 120 bpm: 0.5 s per beat
  return Array.from({ length: n }, (_, i) => satz(i * 48, bis - bars * 4 + (i / n) * bars * 4, [pegel, pegel, pegel, pegel, pegel, pegel], pegel * pegel, pegel));
}
const KEIN = { geladen: false, laeuft: false, seqDeck: false, seqLaeuft: false, offen: false };

test('a place without a loaded track and without a SEQ deck stays "not loaded" (409 kein_kernstand)', () => {
  const lage = hoerLage(2, KEIN);
  assert.deepEqual(lage, { deck: 2, geladen: false, laeuft: false, offen: false });
  const pfad = tmpPfad('huellen');
  schreibeRing(pfad, { [K.deck2]: ringSaetze(16, 1, 0.1), [K.master]: ringSaetze(16, 1, 0.1) });
  const l = new OhrLeser(pfad, [K.deck2, K.master]);
  l.lies();
  assert.deepEqual(hoerAntwort(l, lage, 16, 120, 1), { code: 409, j: { fehler: 'kein_kernstand' } });
});

test('a place with a SEQ deck and no loaded track counts as loaded, and runs while the project transport runs', () => {
  assert.deepEqual(hoerLage(2, { ...KEIN, seqDeck: true }), { deck: 2, geladen: true, laeuft: false, offen: false });
  assert.deepEqual(hoerLage(2, { ...KEIN, seqDeck: true, seqLaeuft: true, offen: true }), { deck: 2, geladen: true, laeuft: true, offen: true });
  // the transport alone says nothing about a place without a SEQ deck
  assert.equal(hoerLage(2, { ...KEIN, seqLaeuft: true }).geladen, false);
});

test('/hoeren on a SEQ deck place measures the ring channel deck/N against the master', () => {
  const pfad = tmpPfad('huellen');
  schreibeRing(pfad, { [K.deck2]: ringSaetze(16, 1, 0.2), [K.master]: ringSaetze(16, 1, 0.1) });
  const l = new OhrLeser(pfad, [K.deck2, K.master]);
  l.lies();
  const r = hoerAntwort(l, hoerLage(2, { ...KEIN, seqDeck: true, seqLaeuft: true }), 16, 120, 1);
  assert.equal(r.code, 200, JSON.stringify(r));
  assert.equal(r.j.deck, 2);
  assert.ok(r.j.vergleich.neu.lufs > r.j.vergleich.laufend.lufs + 3, `deck/2 is the louder channel: ${JSON.stringify(r.j.vergleich.neu.lufs)} vs ${r.j.vergleich.laufend.lufs}`);
});
