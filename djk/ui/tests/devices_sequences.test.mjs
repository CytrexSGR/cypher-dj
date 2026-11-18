// Controller follow flag in geraete.json: place 1 as midi.folgen, places 2..8 as controller[].folgen; set through setzeController {platz, folgen}.
import test from 'node:test';
import assert from 'node:assert/strict';
import { standard, pruefeKonfig, folgenVon, GeraeteFehler } from '../areas/devices/store.ts';
import { setzeController, setzeMidi } from '../areas/devices/change.ts';
import { LEER } from '../areas/devices/pwdump.ts';

const mit = (o = {}) => ({ ...standard(), midi: { profil: null, port: 'Midi-Bridge:LPD8: MIDI 1 (capture)', frei_fuer_cypher: false }, controller: [{ platz: 2, port: 'Midi-Bridge:LC3: MIDI 1 (capture)' }], ...o });
const grund = (f) => { try { f(); } catch (e) { return e instanceof GeraeteFehler ? `${e.grund}/${e.code}` : String(e); } return null; };

test('folgen: stored on the controller entry of a place 2..8, default false, and false removes the key again', () => {
  const k = setzeController(mit(), 'andreas', { platz: 2, folgen: true });
  assert.equal(k.controller[0].folgen, true);
  assert.equal(folgenVon(k, 2), true);
  assert.equal(folgenVon(mit(), 2), false);
  const aus = setzeController(k, 'andreas', { platz: 2, folgen: false });
  assert.equal('folgen' in aus.controller[0], false);
  assert.doesNotThrow(() => pruefeKonfig(k));
});

test('folgen: place 1 follows through midi.folgen of the MIDI input; without a device on it the flag is refused (eingang_leer 409)', () => {
  const k = setzeController(mit(), 'andreas', { platz: 1, folgen: true });
  assert.equal(k.midi.folgen, true);
  assert.equal(folgenVon(k, 1), true);
  assert.equal('folgen' in setzeController(k, 'andreas', { platz: 1, folgen: false }).midi, false);
  assert.equal(grund(() => setzeController(standard(), 'andreas', { platz: 1, folgen: true })), 'eingang_leer/409');
  assert.doesNotThrow(() => pruefeKonfig(k));
});

test('folgen: Cypher may set it too; a value that is no boolean, a missing place or a place without device are refused', () => {
  assert.equal(setzeController(mit(), 'cypher', { platz: 2, folgen: true }).controller[0].folgen, true);
  assert.match(grund(() => setzeController(mit(), 'andreas', { platz: 2, folgen: 'yes' })), /^argument_ungueltig\/400/);
  assert.match(grund(() => setzeController(mit(), 'andreas', { folgen: true })), /^argument_ungueltig\/400/);
  assert.match(grund(() => setzeController(mit(), 'andreas', { platz: 9, folgen: true })), /^argument_ungueltig\/400/);
  assert.equal(grund(() => setzeController(mit(), 'andreas', { platz: 3, folgen: true })), 'eingang_leer/409');
  assert.match(grund(() => setzeController(mit(), 'andreas', { platz: 2, folgen: true, port: 'x:y: z' })), /^argument_ungueltig\/400/);
});

test('folgen: the flag stays with a place when it is renamed or the same device is set again; freeing the place or another device takes it away', () => {
  let k = setzeController(mit(), 'andreas', { platz: 2, folgen: true });
  assert.equal(setzeController(k, 'andreas', { platz: 2, name: 'Pad' }).controller[0].folgen, true);
  assert.equal(setzeController(k, 'andreas', { platz: 2, port: 'Midi-Bridge:LC3: MIDI 1 (capture)' }).controller[0].folgen, true);
  assert.equal('folgen' in setzeController(k, 'andreas', { platz: 2, port: 'Midi-Bridge:Other: MIDI 1 (capture)' }).controller[0], false);
  assert.equal(setzeController(k, 'andreas', { platz: 2, port: null }).controller, undefined);
});

test('folgen: place 1 keeps its flag when the MIDI profile is set again on the same port, and loses it when the device is removed', () => {
  const k = mit({ midi: { profil: 'midi-controller', port: 'Midi-Bridge:LPD8: MIDI 1 (capture)', frei_fuer_cypher: false, folgen: true } });
  const erk = { ...LEER, midi: [{ port: 'Midi-Bridge:LPD8: MIDI 1 (capture)', alias: 'LPD8' }] };
  const wieder = (() => { try { return setzeMidi(k, 'andreas', { profil: 'midi-controller', port: 'Midi-Bridge:LPD8: MIDI 1 (capture)' }, erk); } catch (e) { return e; } })();
  if (wieder instanceof Error) assert.fail(`setzeMidi threw ${wieder.message}`);
  assert.equal(wieder.midi.folgen, true);
  assert.equal('folgen' in setzeMidi(k, 'andreas', { profil: null }, erk).midi, false);
});

test('folgen: pruefeKonfig refuses a flag that is no boolean', () => {
  assert.throws(() => pruefeKonfig({ ...mit(), controller: [{ platz: 2, port: 'a:b: c', folgen: 'yes' }] }), GeraeteFehler);
  assert.throws(() => pruefeKonfig({ ...mit(), midi: { profil: null, port: 'a:b: c', frei_fuer_cypher: false, folgen: 1 } }), GeraeteFehler);
});
