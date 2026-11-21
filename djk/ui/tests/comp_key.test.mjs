// Container core U-W2: the sidechain keys of the page stay inside the contract range komp/sc, gate/sc 0..4 (0 own signal, 1..4 the containers A..D).
// "Kick Sidechain" keys on the container that plays the Kick (the strudel module's place), resolved when the preset is applied.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { KOMP_PRESETS, SC_KICK, kickSchluessel, kompPresetFelder, KOMP_SCHLUESSEL } from '../public/effects.js';
import { REGLER } from '../../conductor/src/controls_info.ts';

const T = (typ) => ({ typ });
const LEER = T('leer'), STRUDEL = T('strudel'), TRACK = T('track');

test('the contract range of komp/sc and gate/sc is 0..4', () => {
  assert.deepEqual([REGLER.get('deck/1/komp/sc').min, REGLER.get('deck/1/komp/sc').max], [0, 4]);
  assert.deepEqual([REGLER.get('deck/1/gate/sc').min, REGLER.get('deck/1/gate/sc').max], [0, 4]);
});

test('no preset key and no key menu entry leaves 0..4, and the gate key regler of the page takes 0..4', () => {
  for (const [n, p] of Object.entries(KOMP_PRESETS)) assert.ok(p.sc === SC_KICK || (Number.isInteger(p.sc) && p.sc >= 0 && p.sc <= 4), `${n}: sc ${p.sc}`);
  for (const [w] of KOMP_SCHLUESSEL) assert.ok(w >= 0 && w <= 4, `menu key ${w}`);
  const q = fs.readFileSync(new URL('../public/effects.js', import.meta.url), 'utf8');
  assert.match(q, /'gate\/sc': \{ min: 0, max: 4,/);
  assert.doesNotMatch(q, /sc: 5|max: 14/);
});

test('Kick Sidechain keys on the container of the strudel place: place N is key N, none placed is 0', () => {
  assert.equal(KOMP_PRESETS['Kick Sidechain'].sc, SC_KICK);
  assert.equal(kickSchluessel([STRUDEL, LEER, LEER, LEER]), 1);
  assert.equal(kickSchluessel([TRACK, LEER, STRUDEL, LEER]), 3);
  assert.equal(kickSchluessel([LEER, LEER, LEER, STRUDEL]), 4);
  assert.equal(kickSchluessel([TRACK, TRACK, LEER, LEER]), 0, 'no strudel module: own signal');
  assert.equal(kickSchluessel(null), 0);
});

test('applying the preset writes a key that is valid for the channel: never above 4, never the channel itself', () => {
  const felder = (name, plaetze, kanal) => Object.fromEntries(kompPresetFelder(name, plaetze, kanal));
  const f = felder('Kick Sidechain', [TRACK, LEER, STRUDEL, LEER], 'deck/1');
  assert.equal(f.sc, 3);
  assert.equal(f.schwelle, -30); assert.equal(f.ratio, 8);
  assert.equal(felder('Kick Sidechain', [TRACK, LEER, STRUDEL, LEER], 'pad/1').sc, 0, 'the strip of the Kick container would key on itself: own signal');
  assert.equal(felder('Kick Sidechain', null, 'deck/2').sc, 0);
  assert.equal(felder('Drum Bus', [STRUDEL, LEER, LEER, LEER], 'deck/2').sc, 0, 'the other presets still reset the key');
  for (const k of ['deck/1', 'deck/2', 'pad/1', 'pad/2']) for (let i = 0; i < 4; i++) {
    const p = [LEER, LEER, LEER, LEER]; p[i] = STRUDEL;
    const sc = felder('Kick Sidechain', p, k).sc;
    assert.ok(Number.isInteger(sc) && sc >= 0 && sc <= 4, `${k} with strudel at ${i + 1}: ${sc}`);
  }
});
