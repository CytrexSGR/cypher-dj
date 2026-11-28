// Strand 6 task 2.2: the page formula against the reference vectors, the marker helpers and the frame loop (no DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  modVersatz, modWert, modAufnehmen, modAusgang, modVergessen, modsFuer, hatMod, summeVersatz, lebendWert, markenWinkel, markenPos, liveText, neueSchleife,
  MOD_FRIST_MS, MOD_STAND,
} from '../public/mod_display.js';
import { KNOB_START, KNOB_BOGEN, knobWinkel } from '../public/panel.js';

const ref = JSON.parse(readFileSync(new URL('../../contract/mod_ref.json', import.meta.url), 'utf8'));
const proj = (...mods) => ({ modulatoren: mods });
const m1 = { id: 'm1', nr: 1, art: 'lfo', ziele: [{ strang_id: 's1', ziel: 'fader', tiefe: -6 }, { strang_id: 's1', ziel: 'geraet.k3', tiefe: 0.25 }] };
const m2 = { id: 'm2', nr: 2, art: 'lfo', ziele: [{ strang_id: 's1', ziel: 'fader', tiefe: 3, polaritaet: 'uni' }] };

test('modVersatz against the versatz rows of mod_ref.json', () => {
  assert.ok(ref.versatz.length >= 6);
  for (const [out, tiefe, uni, erwartet] of ref.versatz) assert.ok(Math.abs(modVersatz(out, tiefe, uni) - erwartet) < 1e-9, `${out} ${tiefe} ${uni}`);
});
test('modWert clamps once to the range', () => {
  assert.equal(modWert(5, 3, [-60, 6]), 6); assert.equal(modWert(-59, -3, [-60, 6]), -60); assert.equal(modWert(0.5, 0.25, [0, 1]), 0.75);
});
test('the angle helper: both ends clamped and sorted, knob constants match panel.js', () => {
  assert.equal(KNOB_START, 135); assert.equal(KNOB_BOGEN, 270);
  assert.deepEqual(markenWinkel(0.5, 0.75), [knobWinkel(0.5), knobWinkel(0.75)]);
  assert.deepEqual(markenWinkel(0.75, 0.5), [270, 337.5]);
  assert.deepEqual(markenWinkel(0.9, 1.7), [knobWinkel(0.9), 405]); assert.deepEqual(markenWinkel(-1, 0.1), [135, knobWinkel(0.1)]);
});
test('marker position: pan -1..1 to 0..1, fader through the curve, null stays null', () => {
  assert.equal(markenPos('pan', -1), 0); assert.equal(markenPos('pan', 0), 0.5); assert.equal(markenPos('pan', 3), 1);
  assert.equal(markenPos('fader', 6, (db) => db / 12), 0.5); assert.equal(markenPos('fader', null), null);
});
test('events feed MOD_STAND; silent after 500 ms; never reported is null', () => {
  modVergessen();
  assert.equal(modAufnehmen('/zustand/mix', [1, 0.5], 0), false);
  assert.equal(modAufnehmen('/zustand/mod', [1, 0.5], 1000), true);
  assert.equal(modAufnehmen('/zustand/mod', { nr: 2, wert: -3 }, 1000), true);   // clamped to -1..1
  assert.equal(modAufnehmen('/zustand/mod', [0.5, 1], 1000), false);
  assert.equal(modAusgang(1, 1000 + MOD_FRIST_MS), 0.5); assert.equal(modAusgang(1, 1000 + MOD_FRIST_MS + 1), null);
  assert.equal(modAusgang(2, 1100), -1); assert.equal(modAusgang(9, 1100), null);
  modVergessen(); assert.equal(MOD_STAND.size, 0);
});
test('several modulators on a target are summed, silent ones left out, an=false skipped', () => {
  const stand = new Map([[1, { out: 0.5, t: 0 }], [2, { out: 1, t: 0 }]]);
  const p = proj(m1, m2);
  assert.equal(modsFuer(p, 's1', 'fader').length, 2); assert.ok(hatMod(p, 's1', 'geraet.k3')); assert.ok(!hatMod(p, 's2', 'fader'));
  assert.equal(summeVersatz(p, 's1', 'fader', 100, stand), -3 + 3);
  assert.equal(lebendWert(p, 's1', 'fader', 0, [-60, 6], 100, stand), 0);
  assert.equal(summeVersatz(p, 's1', 'fader', 100, new Map([[1, { out: 0.5, t: 0 }], [2, { out: 1, t: -1000 }]])), -3);   // m2 silent
  assert.equal(summeVersatz(p, 's1', 'fader', 100, new Map()), null);
  assert.ok(!hatMod(proj({ ...m1, an: false }), 's1', 'fader'));
  assert.equal(lebendWert(proj({ ...m1, ziele: [{ strang_id: 's1', ziel: 'fader', tiefe: 24 }] }), 's1', 'fader', 5, [-60, 6], 0, new Map([[1, { out: 1, t: 0 }]])), 6);
});
test('live readout "base → value"', () => {
  assert.equal(liveText(-6, -9.5, 'dB'), '−6.0 dB → −9.5 dB'); assert.equal(liveText(0.5, 0.75, '', 2), '0.50 → 0.75'); assert.equal(liveText(0, null), '');
});
test('frame loop: runs while schritt says so, stops itself, no frames while hidden', () => {
  let sicht = true, naechster = null, ids = 0, n = 0, weiter = true;
  const l = neueSchleife(() => { n++; return weiter; }, { rahmen: (f) => { naechster = f; return ++ids; }, abbrechen: () => { naechster = null; }, sichtbar: () => sicht, jetzt: () => 0 });
  l.an(); l.an(); assert.ok(l.laeuft());
  naechster(); assert.equal(n, 1); assert.ok(l.laeuft());
  sicht = false; naechster(); assert.equal(n, 1); assert.ok(!l.laeuft());   // hidden: the frame draws nothing and requests no next one
  l.an(); assert.ok(!l.laeuft());
  sicht = true; weiter = false; l.an(); naechster(); assert.equal(n, 2); assert.ok(!l.laeuft());
  l.an(); l.aus(); assert.ok(!l.laeuft());
});
test('a follower target is unipolar whatever the target polaritaet says (the core reports 2*out-1)', () => {
  const mf = (pol) => ({ id: 'm3', nr: 3, art: 'folger', ziele: [{ strang_id: 's1', ziel: 'fader', tiefe: -12, ...(pol ? { polaritaet: pol } : {}) }] });
  for (const pol of [undefined, 'bi', 'uni']) {
    assert.equal(summeVersatz(proj(mf(pol)), 's1', 'fader', 0, new Map([[3, { out: -1, t: 0 }]])), 0, 'silence');
    assert.equal(summeVersatz(proj(mf(pol)), 's1', 'fader', 0, new Map([[3, { out: 0, t: 0 }]])), -6, 'envelope 0.5');
    assert.equal(summeVersatz(proj(mf(pol)), 's1', 'fader', 0, new Map([[3, { out: 1, t: 0 }]])), -12, 'full');
  }
});
