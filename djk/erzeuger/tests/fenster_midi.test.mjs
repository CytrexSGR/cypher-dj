// Studio S5.1 T4: MIDI-Ziel. note("c2 eb2 g2") → MIDI 36 39 43 mit Dauer; n().scale() mit @strudel/tonal; Velocity =
// velocity (Vorgabe 0,9) × gain wie Strudels MIDI-Ausgabe; Kit-Ziel unverändert (Negativ-Kontrolle).
import test from 'node:test';
import assert from 'node:assert/strict';
import { kompiliere } from '../src/kompiliere.mjs';
import { ereignisse, midiNote } from '../src/fenster.mjs';

const MIDI = { midi: true };
const plan = (text) => [{ ab: 0, nr: 1, muster: kompiliere(text).muster }];

test('note("c2 eb2 g2 bb1") → 36 39 43 34, Dauer 1 Beat, Velocity 0,9', () => {
  const { evs, unbekannt } = ereignisse(plan('note("c2 eb2 g2 bb1")'), MIDI, 0, 4);
  assert.deepEqual(evs.map((e) => [e.beat, e.note, e.dauer]), [[0, 36, 1], [1, 39, 1], [2, 43, 1], [3, 34, 1]]);
  assert.ok(evs.every((e) => Math.abs(e.velocity - 0.9) < 1e-9));
  assert.equal(unbekannt.size, 0);
});

test('n("0 2 4").scale("C2:minor") → 36 39 43; gain 0.5 → Velocity 0,45', () => {
  const { evs } = ereignisse(plan('n("0 2 4").scale("C2:minor").gain(0.5)'), MIDI, 0, 4);
  assert.deepEqual(evs.map((e) => e.note), [36, 39, 43]);
  assert.ok(Math.abs(evs[0].velocity - 0.45) < 1e-9);
});

test('midiNote: Zahl, Name, freq, außerhalb → null', () => {
  assert.equal(midiNote({ note: 60 }), 60);
  assert.equal(midiNote({ note: 'a4' }), 69);
  assert.equal(midiNote({ freq: 440 }), 69);
  assert.equal(midiNote({ note: 200 }), null);
  assert.equal(midiNote({ s: 'bd' }), null);
});

test('Negativ-Kontrolle: Kit-Ziel wie bisher (note ohne s → unbekannt)', () => {
  const kit = { note: new Map([['bd:0', 0]]), bank: new Map([['bd', 1]]) };
  const { evs } = ereignisse(plan('note("c2")'), kit, 0, 4);
  assert.equal(evs.length, 0);
});
