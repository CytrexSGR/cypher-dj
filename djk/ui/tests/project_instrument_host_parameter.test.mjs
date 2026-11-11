// Package 1.9 U5 (O28 on Surge), T5.1: the sparse parameter map of a Surge device (`WirtGeraet.parameter`), spec E7.
// Model: names [a-z][a-z0-9_]{0,47}, at most 32 entries, finite numbers, /2 files only, never written when absent.
// Command layer: the range of a name comes from the context (`surgeBereich`, fed from hosts/carla/surge_bereiche.json by the server).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { kanonisch, neuesProjekt, pruefeProjekt, pruefeFehler, SURGE_PARAMETER_MAX } from '../project/model.ts';
import { surgeBereich } from '../areas/proj/surge.ts';
import { REPO_PFADE } from '../paths.ts';

const SURGE = { art: 'wirt', name: 'surge', slot: 1 };
const mitSurge = (parameter) => {
  let p = neuesProjekt('S');
  p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge' } }]).projekt;
  if (parameter !== undefined) p.spuren[0].geraet.parameter = parameter;
  return p;
};
const BEREICH = { a_filter1_cutoff: [-60, 70], a_filter1_resonance: [0, 1], a_env1_release: [-8, 5] };
const bereich = (n) => BEREICH[n] ?? null;
const lehntAb = (fn, grund) => assert.throws(fn, (e) => e instanceof BefehlFehler && e.grund === grund, `expected ${grund}`);

test('T5.1 model: a map of names with finite numbers is accepted and survives a save/load round trip byte-equal', () => {
  const p = mitSurge({ a_filter1_cutoff: 12.5, a_env1_release: -3 });
  assert.equal(pruefeFehler(p), null);
  const r = pruefeProjekt(JSON.parse(kanonisch(p)));
  assert.ok('projekt' in r, JSON.stringify(r));
  assert.equal(kanonisch(r.projekt), kanonisch(p), 'byte-equal');
  assert.deepEqual(r.projekt.spuren[0].geraet.parameter, { a_filter1_cutoff: 12.5, a_env1_release: -3 });
});

test('T5.1 model: an absent map is never written (the saved device is exactly art, name, slot)', () => {
  const p = mitSurge();
  assert.deepEqual(p.spuren[0].geraet, SURGE);
  assert.ok(!kanonisch(p).includes('parameter'), 'no parameter key anywhere in a project with a Surge track and no map');
  const r = fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: 's1', name: 'Lead' }]);
  assert.deepEqual(r.projekt.spuren[0].geraet, SURGE, 'a command that does not touch the device does not add a map');
});

test('T5.1 model: refusals (bad name, too many entries, non-finite value, wrong type, /1 file)', () => {
  const schlecht = (parameter) => pruefeFehler(mitSurge(parameter));
  assert.match(schlecht({ 'A_Filter': 1 }), /parameter/);
  assert.match(schlecht({ '1abc': 1 }), /parameter/);
  assert.match(schlecht({ ['a'.repeat(49)]: 1 }), /parameter/);
  assert.match(schlecht({ a_x: Infinity }), /parameter/);
  assert.match(schlecht({ a_x: 'laut' }), /parameter/);
  assert.match(schlecht([1, 2]), /parameter/);
  const viele = Object.fromEntries(Array.from({ length: SURGE_PARAMETER_MAX + 1 }, (_, i) => [`p_${i}`, i]));
  assert.match(schlecht(viele), /32|parameter/);
  // negative control: exactly 32 entries and the longest legal name are fine
  const genau = Object.fromEntries(Array.from({ length: SURGE_PARAMETER_MAX }, (_, i) => [`p_${i}`, i]));
  assert.equal(schlecht(genau), null);
  assert.equal(schlecht({ ['a'.repeat(48)]: 1 }), null);
  // a /1 file may not carry the map (new fields are /2 only, spec E14)
  const alt = JSON.parse(kanonisch(mitSurge({ a_filter1_cutoff: 1 })));
  alt.format = 'cypherdj-projekt/1';
  assert.ok('fehler' in pruefeProjekt(alt), 'the /1 file with a Surge map is refused');
});

test('T5.1 command: spur_neu and spur_aendern take a map; with the context a name outside surge_bereiche.json and a value outside its range are refused', () => {
  const o = { surgeBereich: bereich };
  const neu = fuehreListeAus(neuesProjekt('S'), [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge', parameter: { a_filter1_cutoff: 20 } } }], o);
  assert.deepEqual(neu.projekt.spuren[0].geraet, { art: 'wirt', name: 'surge', slot: 1, parameter: { a_filter1_cutoff: 20 } });
  const p = mitSurge();
  const aend = fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: 's1', geraet: { art: 'wirt', name: 'surge', parameter: { a_env1_release: -2 } } }], o);
  assert.deepEqual(aend.projekt.spuren[0].geraet.parameter, { a_env1_release: -2 });
  // refusals
  const b = (parameter) => [{ befehl: 'spur_aendern', spur_id: 's1', geraet: { art: 'wirt', name: 'surge', parameter } }];
  lehntAb(() => fuehreListeAus(p, b({ a_gibt_es_nicht: 1 }), o), 'argument_unbekannt');
  lehntAb(() => fuehreListeAus(p, b({ a_filter1_cutoff: 71 }), o), 'argument_ungueltig');
  lehntAb(() => fuehreListeAus(p, b({ a_filter1_cutoff: -60.5 }), o), 'argument_ungueltig');
  lehntAb(() => fuehreListeAus(p, b({ a_filter1_cutoff: Number.NaN }), o), 'argument_ungueltig');
  lehntAb(() => fuehreListeAus(p, b({ a_filter1_cutoff: '5' }), o), 'argument_ungueltig');
  lehntAb(() => fuehreListeAus(p, b([1]), o), 'argument_ungueltig');
  // negative control: the bounds themselves are inside the range
  const rand = fuehreListeAus(p, b({ a_filter1_cutoff: 70, a_env1_release: -8 }), o);
  assert.deepEqual(rand.projekt.spuren[0].geraet.parameter, { a_filter1_cutoff: 70, a_env1_release: -8 });
  // without the context only the shape is checked (the name rule of the model)
  const ohne = fuehreListeAus(p, b({ a_gibt_es_nicht: 1 }));
  assert.deepEqual(ohne.projekt.spuren[0].geraet.parameter, { a_gibt_es_nicht: 1 });
  lehntAb(() => fuehreListeAus(p, b({ 'Gross': 1 })), 'argument_ungueltig');
});

test('T5.1 command: the map is part of the device, so a change discards a freeze and reloads the playback view', () => {
  const p = mitSurge();
  p.spuren[0].freeze = { datei: 'freeze-1-1.wav', frames: 10, kennung: 1, sha256: 'a'.repeat(64) };
  const r = fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: 's1', geraet: { art: 'wirt', name: 'surge', parameter: { a_filter1_cutoff: 3 } } }]);
  assert.equal(r.projekt.spuren[0].freeze, null, 'the frozen sound no longer matches the device');
  assert.equal(r.betrifft_wiedergabe, true);
});

test('T5.1 surgeBereich reads surge_bereiche.json: first and last point of `punkte`; unknown name is null', () => {
  const d = JSON.parse(fs.readFileSync(REPO_PFADE.surgeBereiche, 'utf8')).parameter;
  const p = d.a_filter1_cutoff.punkte;
  assert.deepEqual(surgeBereich('a_filter1_cutoff'), [p[0], p[p.length - 1]]);
  assert.deepEqual(surgeBereich('a_filter1_cutoff'), [-60, 70]);
  assert.deepEqual(surgeBereich('a_filter1_resonance'), [0, 1]);
  assert.equal(surgeBereich('a_gibt_es_nicht'), null);
  assert.equal(surgeBereich('constructor'), null, 'no prototype keys');
});
