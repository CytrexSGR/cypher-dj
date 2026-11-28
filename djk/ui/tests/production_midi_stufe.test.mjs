// Strand 7 task 1.5: the MIDI FX strip, pure part (values from a track, command body per control).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stufeVonSpur, koerper, arpKopfText, kannMidiStufe, kettenVonSpur, intervalleLesen, neueSaat, AKKORD_VORGABEN, SKALA_WAHL,
} from '../public/production/midi_stufe.js';
import { midiStufeFehler } from '../project/model.ts';

const ARP = { muster: 'updown', sync: true, rate: '1/8t', oktaven: 2, gate: 0.25 };
const spur = (midi) => ({ id: 's1', art: 'instrument', ...(midi ? { midi } : {}) });

test('values from a track without a stage: chain on, arp off, defaults', () => {
  assert.deepEqual(stufeVonSpur(spur()), { aus: false, arpAn: false, muster: 'up', rate: '1/16', hz: 8, oktaven: 1, gate: 50 });
});
test('values from a track with a synced arp', () => {
  assert.deepEqual(stufeVonSpur(spur({ arp: ARP })), { aus: false, arpAn: true, muster: 'updown', rate: '1/8t', hz: 8, oktaven: 2, gate: 25 });
});
test('values from a free arp and a bypassed chain', () => {
  const w = stufeVonSpur(spur({ aus: true, arp: { muster: 'random', sync: false, hz: 12.5, oktaven: 4, gate: 1 } }));
  assert.deepEqual(w, { aus: true, arpAn: true, muster: 'random', rate: 'frei', hz: 12.5, oktaven: 4, gate: 100 });
});
test('only instrument tracks get the strip', () => {
  assert.equal(kannMidiStufe(spur()), true);
  assert.equal(kannMidiStufe({ art: 'audio' }), false);
});
test('arp on from nothing: body with the default arp, accepted by the project check', () => {
  const b = koerper('s1', { ...stufeVonSpur(spur()), arpAn: true }, null);
  assert.equal(b.befehl, 'midi_stufe_setzen'); assert.equal(b.spur_id, 's1');
  assert.deepEqual(b.midi, { arp: { muster: 'up', sync: true, rate: '1/16', oktaven: 1, gate: 0.5 } });
  assert.equal(midiStufeFehler(b.midi), null);
});
test('each control produces its field', () => {
  const s = spur({ arp: ARP }), w = stufeVonSpur(s);
  assert.equal(koerper('s1', { ...w, muster: 'chord' }, s.midi).midi.arp.muster, 'chord');
  assert.equal(koerper('s1', { ...w, rate: '1/32' }, s.midi).midi.arp.rate, '1/32');
  assert.equal(koerper('s1', { ...w, oktaven: 4 }, s.midi).midi.arp.oktaven, 4);
  assert.equal(koerper('s1', { ...w, gate: 80 }, s.midi).midi.arp.gate, 0.8);
  const frei = koerper('s1', { ...w, rate: 'frei', hz: 6 }, s.midi).midi.arp;
  assert.deepEqual(frei, { muster: 'updown', sync: false, hz: 6, oktaven: 2, gate: 0.25 });
  assert.equal('rate' in frei, false);
  for (const b of [koerper('s1', { ...w, rate: 'frei', hz: 6 }, s.midi), koerper('s1', { ...w, gate: 80 }, s.midi)]) assert.equal(midiStufeFehler(b.midi), null);
});
test('hz and gate are clamped to the allowed range', () => {
  const w = { ...stufeVonSpur(spur()), arpAn: true, rate: 'frei' };
  assert.equal(koerper('s1', { ...w, hz: 100 }).midi.arp.hz, 40);
  assert.equal(koerper('s1', { ...w, hz: 0 }).midi.arp.hz, 0.5);
  assert.equal(koerper('s1', { ...w, gate: 0 }).midi.arp.gate, 0.05);
});
test('Off sends aus: true and keeps the settings; On drops it again', () => {
  const s = spur({ arp: ARP }), w = stufeVonSpur(s);
  const aus = koerper('s1', { ...w, aus: true }, s.midi);
  assert.deepEqual(aus.midi, { arp: ARP, aus: true });
  assert.equal(midiStufeFehler(aus.midi), null);
  const an = koerper('s1', { ...stufeVonSpur(spur(aus.midi)), aus: false }, aus.midi);
  assert.deepEqual(an.midi, { arp: ARP });
});
test('removing the arp drops arp and keeps the other stages', () => {
  const s = spur({ arp: ARP, chance: 70, akkord: { intervalle: [4, 7] }, aus: true }), w = stufeVonSpur(s);
  const b = koerper('s1', { ...w, arpAn: false, aus: false }, s.midi);
  assert.deepEqual(b.midi, { chance: 70, akkord: { intervalle: [4, 7] } });
  assert.equal(midiStufeFehler(b.midi), null);
});
test('removing the last stage removes the object (midi: null); Off without a stage sends nothing but null', () => {
  const s = spur({ arp: ARP }), w = stufeVonSpur(s);
  assert.equal(koerper('s1', { ...w, arpAn: false }, s.midi).midi, null);
  assert.equal(koerper('s1', { ...stufeVonSpur(spur()), aus: true }, null).midi, null);
});
test('head label suffix', () => {
  assert.equal(arpKopfText(spur({ arp: ARP })), ' · ARP');
  assert.equal(arpKopfText(spur({ arp: ARP, aus: true })), '');
  assert.equal(arpKopfText(spur({ chance: 50 })), '');
  assert.equal(arpKopfText(spur()), '');
});

// --- task 3.2: Chord, Scale, Velocity, Chance, Seed ---
const ketteW = (s, extra) => ({ ...stufeVonSpur(s), ...kettenVonSpur(s), ...extra });
const gehe = (b) => { assert.equal(midiStufeFehler(b.midi), null); return b.midi; };

test('chain values of a track without a stage: all sections off', () => {
  assert.deepEqual(kettenVonSpur(spur()), {
    akkord: 'aus', akkordText: '', skalaAn: false, skalaQuelle: 'eigene', grundton: 0, skala: 'minor',
    velAn: false, kurve: 0, zufall: 0, fest: 0, chanceAn: false, chance: 100, saat: 0,
  });
});
test('every chord preset gives its intervals and is accepted by the project check', () => {
  const erwartet = { major: [4, 7], minor: [3, 7], sus2: [2, 7], sus4: [5, 7], 7: [4, 7, 10], m7: [3, 7, 10], maj7: [4, 7, 11], power: [7], oktave: [12] };
  assert.equal(AKKORD_VORGABEN.length, Object.keys(erwartet).length);
  for (const [key] of AKKORD_VORGABEN) {
    const m = gehe(koerper('s1', ketteW(spur(), { akkord: key }), null));
    assert.deepEqual(m, { akkord: { intervalle: erwartet[key] } });
    assert.equal(kettenVonSpur(spur(m)).akkord, key);
  }
});
test('chord Off removes the chord and keeps the other stages; custom intervals are read from text', () => {
  const s = spur({ akkord: { intervalle: [4, 7] }, chance: 60 });
  assert.deepEqual(koerper('s1', ketteW(s, { akkord: 'aus' }), s.midi).midi, { chance: 60 });
  const frei = gehe(koerper('s1', ketteW(spur(), { akkord: 'frei', akkordText: '3, 7 -12' }), null));
  assert.deepEqual(frei, { akkord: { intervalle: [3, 7, -12] } });
  assert.equal(kettenVonSpur(spur(frei)).akkord, 'frei');
  assert.equal(kettenVonSpur(spur(frei)).akkordText, '3 7 -12');
});
test('custom interval text: invalid text is refused and the old chord stays', () => {
  for (const t of ['', '0 4', '4 4', '25', '1.5', 'a', '1 2 3 4 5 6 7']) assert.equal(intervalleLesen(t), null, t);
  assert.deepEqual(intervalleLesen('-24 24 7'), [-24, 24, 7]);
  const s = spur({ akkord: { intervalle: [4, 7] } });
  assert.deepEqual(koerper('s1', ketteW(s, { akkord: 'frei', akkordText: '0' }), s.midi).midi, { akkord: { intervalle: [4, 7] } });
});
test('scale: Off, Project key and root + scale', () => {
  const s = spur({ skala: { grundton: 2, skala: 'dorian' } });
  assert.deepEqual(kettenVonSpur(s), { ...kettenVonSpur(spur()), skalaAn: true, grundton: 2, skala: 'dorian' });
  assert.equal(koerper('s1', ketteW(s, { skalaAn: false }), s.midi).midi, null);
  const p = gehe(koerper('s1', ketteW(spur(), { skalaAn: true, skalaQuelle: 'projekt' }), null));
  assert.deepEqual(p, { skala: { quelle: 'projekt' } });
  assert.equal(kettenVonSpur(spur(p)).skalaQuelle, 'projekt');
  const e = gehe(koerper('s1', ketteW(spur(), { skalaAn: true, skalaQuelle: 'eigene', grundton: 9, skala: 'blues' }), null));
  assert.deepEqual(e, { skala: { grundton: 9, skala: 'blues' } });
  for (const [k] of SKALA_WAHL) gehe(koerper('s1', ketteW(spur(), { skalaAn: true, skalaQuelle: 'eigene', skala: k }), null));
});
test('velocity: on writes curve and random, fixed only from 1; off removes it', () => {
  const v = gehe(koerper('s1', ketteW(spur(), { velAn: true, kurve: -0.5, zufall: 12 }), null));
  assert.deepEqual(v, { velocity: { kurve: -0.5, zufall: 12 } });
  const f = gehe(koerper('s1', ketteW(spur(), { velAn: true, kurve: 1, zufall: 64, fest: 100 }), null));
  assert.deepEqual(f, { velocity: { kurve: 1, zufall: 64, fest: 100 } });
  assert.equal(kettenVonSpur(spur(f)).fest, 100);
  assert.deepEqual(gehe(koerper('s1', ketteW(spur(), { velAn: true, kurve: 7, zufall: 99, fest: 500 }), null)), { velocity: { kurve: 1, zufall: 64, fest: 127 } });
  assert.equal(koerper('s1', ketteW(spur(f), { velAn: false }), f).midi, null);
});
test('chance: writes 0..100 only while on', () => {
  assert.deepEqual(gehe(koerper('s1', ketteW(spur(), { chanceAn: true, chance: 0 }), null)), { chance: 0 });
  assert.deepEqual(gehe(koerper('s1', ketteW(spur(), { chanceAn: true, chance: 55 }), null)), { chance: 55 });
  assert.equal(kettenVonSpur(spur({ chance: 0 })).chanceAn, true);
  assert.equal(koerper('s1', ketteW(spur(), { chanceAn: false, chance: 55 }), null).midi, null);
});
test('seed: a new seed is an integer in range, kept with a stage, never a stage by itself', () => {
  assert.equal(neueSaat(() => 0), 0); assert.equal(neueSaat(() => 0.999999999999), 4294967295);
  const s = spur({ chance: 70 });
  const m = gehe(koerper('s1', ketteW(s, { saat: 4242 }), s.midi));
  assert.deepEqual(m, { chance: 70, saat: 4242 });
  assert.equal(kettenVonSpur(spur(m)).saat, 4242);
  assert.equal(koerper('s1', ketteW(spur(), { saat: 4242 }), null).midi, null);
});
test('a gesture on one section keeps the stages of the others (all sections at once)', () => {
  const alle = { arp: ARP, akkord: { intervalle: [4, 7] }, skala: { quelle: 'projekt' }, velocity: { kurve: 0.2, zufall: 4 }, chance: 80, saat: 9 };
  const s = spur(alle);
  const m = koerper('s1', ketteW(s, { chance: 50 }), s.midi).midi;
  assert.deepEqual(m, { ...alle, chance: 50 });
  assert.equal(midiStufeFehler(m), null);
  assert.deepEqual(koerper('s1', stufeVonSpur(s), s.midi).midi, alle);   // arp-only values leave the chain stages as they are
});
