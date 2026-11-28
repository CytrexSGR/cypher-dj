// Strand 6 task 1.2: the translator writes the top-level `mod` list of the playback; proj_lage lists the modulators.
// Pure calculation: no server, no core.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uebersetze, modSaat } from '../project/playback.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { modulatorenLage } from '../areas/proj/state.ts';
import { grundCode } from '../areas/proj/mapping.ts';
import { basisProjekt } from './support/inserts_scenario.mjs';

const lauf = (p, b) => fuehreListeAus(p, Array.isArray(b) ? b : [b], { quelle: 'andreas' }).projekt;
const spiel = (p, extra = {}) => uebersetze(p, { nr: 1, audioOrdner: '@A@', frames: () => 400000, ...extra });
// s1..s3 audio, s4 bk (device cutoff etc. is k<n>), return r1
const szene = () => {
  let p = basisProjekt();
  p = lauf(p, { befehl: 'spur_neu', art: 'instrument', name: 'Mod', geraet: { art: 'intern', name: 'bk', graph: 'synth-neuro' } });
  return lauf(p, { befehl: 'return_neu', name: 'Hall' });
};
const mitMods = () => {
  let p = szene();
  p = lauf(p, { befehl: 'mod_neu', form: 'sinus', takt: 4, ziele: [{ strang_id: 's1', ziel: 'fader', tiefe: -6 }, { strang_id: 'r1', ziel: 'fader', tiefe: 3, polaritaet: 'uni' }] });
  return lauf(p, { befehl: 'mod_neu', form: 'zufall', hz: 2.5, phase: 0.25, glatt_ms: 3, ziele: [{ strang_id: 's4', ziel: 'geraet.k3', tiefe: 0.25 }] });
};

test('seed: FNV-1a 32 of the id, unsigned', () => {
  assert.equal(modSaat(''), 2166136261);
  assert.equal(modSaat('a'), 0xe40c292c);        // FNV-1a 32 test vector
  assert.equal(modSaat('m1'), 2486071275);       // fixed: the core test and the page agree on this seed
});

test('exact JSON for an LFO on a fader and a return fader, and one on geraet.k3 with a free rate', () => {
  const w = spiel(mitMods());
  assert.equal(w.format, 'cypherdj-arr/3');
  assert.deepEqual(w.mod, [
    { nr: 1, art: 'lfo', form: 0, takt: 4, phase: 0, glatt_ms: 1, saat: modSaat('m1'),
      ziele: [{ spur: 1, ziel: 'fader', tiefe: -6, uni: false }, { ret: 1, ziel: 'fader', tiefe: 3, uni: true }] },
    { nr: 2, art: 'lfo', form: 4, hz: 2.5, phase: 0.25, glatt_ms: 3, saat: modSaat('m2'),
      ziele: [{ spur: 4, ziel: 'geraet.k3', tiefe: 0.25, uni: false }] },
  ]);
  assert.deepEqual(Object.keys(w.mod[0]), ['nr', 'art', 'form', 'takt', 'phase', 'glatt_ms', 'saat', 'ziele']);
});

test('no modulator: no key and the same format as before; an LFO alone forces /3', () => {
  const p = szene();
  assert.equal('mod' in spiel(p), false);
  const q = lauf(basisProjekt(), { befehl: 'mod_neu', ziele: [{ strang_id: 's1', ziel: 'pan', tiefe: 0.5 }] });
  assert.equal(spiel(basisProjekt()).format, 'cypherdj-arr/1');
  const w = spiel(q);
  assert.equal(w.format, 'cypherdj-arr/3');
  assert.deepEqual(w.mod[0].ziele, [{ spur: 1, ziel: 'pan', tiefe: 0.5, uni: false }]);
});

test('an: false is left out; a modulator whose strip is not in the playback is left out', () => {
  let p = mitMods();
  p = lauf(p, { befehl: 'mod_aendern', mod_id: 'm1', an: false });
  assert.deepEqual(spiel(p).mod.map((m) => m.nr), [2]);
  p = lauf(p, { befehl: 'mod_aendern', mod_id: 'm2', an: false });
  const w = spiel(p);
  assert.equal('mod' in w, false);
  // a track that the playback does not have (parked in a live project): its target drops, the modulator with it
  const g = lauf(szene(), [{ befehl: 'mod_neu', ziele: [{ strang_id: 's1', ziel: 'fader', tiefe: -3 }, { strang_id: 's2', ziel: 'fader', tiefe: -3 }] }]);
  const w2 = spiel(g);
  assert.deepEqual(w2.mod[0].ziele.map((z) => z.spur), [1, 2]);
  const w3 = uebersetze({ ...g, spuren: g.spuren.filter((s) => s.id !== 's2') }, { nr: 1, audioOrdner: '@A@', frames: () => 400000 });
  assert.deepEqual(w3.mod[0].ziele.map((z) => z.spur), [1]);
});

test('proj_lage listing shape, absent when none, mod_unbekannt is a 404', () => {
  assert.equal(modulatorenLage(szene()), undefined);
  assert.deepEqual(modulatorenLage(mitMods()), [
    { mod_id: 'm1', nr: 1, art: 'lfo', form: 'sinus', takt: 4, phase: 0, glatt_ms: 1, an: true, ausgang: null,
      ziele: [{ strang_id: 's1', ziel: 'fader', tiefe: -6, polaritaet: 'bi', einheit: 'dB' },
        { strang_id: 'r1', ziel: 'fader', tiefe: 3, polaritaet: 'uni', einheit: 'dB' }] },
    { mod_id: 'm2', nr: 2, art: 'lfo', form: 'zufall', hz: 2.5, phase: 0.25, glatt_ms: 3, an: true, ausgang: null,
      ziele: [{ strang_id: 's4', ziel: 'geraet.k3', tiefe: 0.25, polaritaet: 'bi', einheit: '0..1' }] },
  ]);
  assert.equal(grundCode('mod_unbekannt'), 404);
});
