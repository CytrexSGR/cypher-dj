// Return fader lane on the page, T1 (pure): the "+ Lane" targets of a return start with the fader (Volume); the master and a group never get it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freieZieleReturn, freieZieleStrang, freieZieleGruppe, zielLabel } from '../public/production/lanes.js';

const EQ = [{ id: 'i1', art: 'eq' }];
const faderLane = { id: 'a1', ziel: 'fader', punkte: [{ beat: 0, wert: 0 }] };

test('freieZieleReturn: the fader comes first, then the chain targets of the return', () => {
  const r = { id: 'r1', inserts: EQ, automation: [] };
  const z = freieZieleReturn(r);
  assert.equal(z[0], 'fader');
  assert.ok(z.length > 1);
  assert.deepEqual(z.slice(1), freieZieleGruppe(r));
  assert.equal(zielLabel('fader'), 'Volume');
});

test('freieZieleReturn: with a fader lane the fader is no longer offered (no target twice)', () => {
  const r = { id: 'r1', inserts: EQ, automation: [faderLane] };
  assert.deepEqual(freieZieleReturn(r), freieZieleGruppe(r));
  assert.ok(!freieZieleReturn(r).includes('fader'));
});

test('freieZieleReturn: a return without insert and rack still offers Volume; no return gives nothing', () => {
  assert.deepEqual(freieZieleReturn({ id: 'r2', inserts: [], automation: [] }), ['fader']);
  assert.deepEqual(freieZieleReturn({ id: 'r2' }), ['fader']);
  assert.deepEqual(freieZieleReturn(null), []);
  assert.deepEqual(freieZieleReturn(undefined), []);
});

test('master_und_gruppe_ohne_volume: the model refuses a fader lane there, so the menu never offers it', () => {
  const m = { fader_db: 0, inserts: EQ, automation: [] }, g = { id: 'g1', nr: 1, name: 'G1', inserts: EQ, automation: [] };
  for (const strang of [m, { ...m, inserts: [] }]) assert.ok(!freieZieleStrang(strang).includes('fader'));
  for (const strang of [g, { ...g, inserts: [] }]) assert.ok(!freieZieleGruppe(strang).includes('fader'));
  assert.ok(freieZieleStrang(m).length > 0, 'the chain targets of the master are untouched');
});
