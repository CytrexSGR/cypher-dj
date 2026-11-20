// Mixer controls on group and return cards (public/dock/mischer.js): pure commands and the level state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mischerBefehl, levelZustand, mischerKopf, mischerZeile, untertitelEl, levelStand } from '../public/dock/mischer.js';
import { laneWert } from '../public/production/lanes.js';

const grp = { art: 'grp', id: 'g1', name: 'Drums' };
const ret = { art: 'ret', id: 'r1', name: 'Echo' };

test('mischerBefehl: group mute, solo and pan', () => {
  assert.deepEqual(mischerBefehl(grp, 'mute', true), { label: 'Mute group Drums', befehle: [{ befehl: 'gruppenspur_aendern', gruppe_id: 'g1', mute: true }] });
  assert.deepEqual(mischerBefehl(grp, 'mute', false), { label: 'Unmute group Drums', befehle: [{ befehl: 'gruppenspur_aendern', gruppe_id: 'g1', mute: false }] });
  assert.deepEqual(mischerBefehl(grp, 'solo', true), { label: 'Solo group Drums', befehle: [{ befehl: 'gruppenspur_aendern', gruppe_id: 'g1', solo: true }] });
  assert.deepEqual(mischerBefehl(grp, 'solo', false), { label: 'Unsolo group Drums', befehle: [{ befehl: 'gruppenspur_aendern', gruppe_id: 'g1', solo: false }] });
  assert.deepEqual(mischerBefehl(grp, 'pan', 0.25), { label: 'Balance group Drums', befehle: [{ befehl: 'gruppenspur_aendern', gruppe_id: 'g1', pan: 0.25 }] });
});

test('mischerBefehl: return mute, solo and pan', () => {
  assert.deepEqual(mischerBefehl(ret, 'mute', true), { label: 'Mute return Echo', befehle: [{ befehl: 'return_aendern', return_id: 'r1', mute: true }] });
  assert.deepEqual(mischerBefehl(ret, 'mute', false), { label: 'Unmute return Echo', befehle: [{ befehl: 'return_aendern', return_id: 'r1', mute: false }] });
  assert.deepEqual(mischerBefehl(ret, 'solo', true), { label: 'Solo return Echo', befehle: [{ befehl: 'return_aendern', return_id: 'r1', solo: true }] });
  assert.deepEqual(mischerBefehl(ret, 'solo', false), { label: 'Unsolo return Echo', befehle: [{ befehl: 'return_aendern', return_id: 'r1', solo: false }] });
  assert.deepEqual(mischerBefehl(ret, 'pan', -0.5), { label: 'Balance return Echo', befehle: [{ befehl: 'return_aendern', return_id: 'r1', pan: -0.5 }] });
});

const punkte = [{ beat: 0, wert: -20, form: 'linear' }, { beat: 8, wert: 0, form: 'linear' }];
test('levelZustand: no lane, a lane without a beat, a lane at a beat', () => {
  assert.deepEqual(levelZustand({ fader_db: -3 }, 4), { db: -3, auto: false, treibt: false });
  const g = { fader_db: -3, automation: [{ ziel: 'fader', punkte }] };
  assert.deepEqual(levelZustand(g, null), { db: -3, auto: true, treibt: false });
  const z = levelZustand(g, 4);
  assert.equal(z.auto, true); assert.equal(z.treibt, true);
  assert.equal(z.db, laneWert(punkte, 4, 'fader'));
  assert.deepEqual(levelZustand(null, 4), { db: undefined, auto: false, treibt: false });
});

test('the four parts return nothing while the mixer switch is off', () => {
  const host = { schalter: { mischer: false }, projekt: () => ({ gruppen: [], returns: [] }), kopfBeat: () => null, beimBild: () => {} };
  assert.deepEqual(mischerKopf(host, grp, []), []);
  assert.deepEqual(mischerZeile(host, grp, []), []);
  assert.equal(untertitelEl(host, grp), null);
  assert.deepEqual(levelStand(host, { ...grp, fader_db: -5 }), { db: -5, auto: false });
});

test('levelStand reads the strip of the project at the playhead', () => {
  const g = { id: 'g1', fader_db: -3, automation: [{ ziel: 'fader', punkte }] };
  const host = { schalter: { mischer: true }, projekt: () => ({ gruppen: [g], returns: [] }), kopfBeat: () => 8 };
  assert.deepEqual(levelStand(host, grp), { db: laneWert(punkte, 8, 'fader'), auto: true });
});
