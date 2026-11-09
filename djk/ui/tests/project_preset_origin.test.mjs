// Package 1.16 rest U2 (F8): the preset origin `preset` (a register id) on intern devices (rb338, bk) of instrument tracks, through the file
// check and the command path. Pure calculation: no server, no core. Insert stages and insert_werte_setzen are in tests/projekt_inserts.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, BefehlFehler } from '../project/commands.ts';
import { pruefeProjekt, kanonisch, neuesProjekt, spurSicht } from '../project/model.ts';
import { mergePlan, baueMergeProjekt } from '../project/merge.ts';
import { specProjekt, kopie } from './support/project.mjs';

const ok = (p, b) => fuehreAus(p, b);
const lehntAb = (p, b, grund) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === grund,
  `expected ${grund} for ${JSON.stringify(b).slice(0, 120)}`);
const RB = (preset, parameter = { cutoff: 0.2 }) => ({ art: 'intern', name: 'rb338', parameter, ...(preset !== undefined ? { preset } : {}) });
const BK = (preset, graph = 'juno-pad') => ({ art: 'intern', name: 'bk', graph, parameter: { k1: 0.3 }, ...(preset !== undefined ? { preset } : {}) });
const mitRb = () => ok(neuesProjekt('T'), { befehl: 'spur_neu', art: 'instrument', name: 'Bass', geraet: RB() }).projekt;

test('file check: geraet.preset on rb338 and bk devices loads; malformed id, a preset on a host device refused; old files byte-identical', () => {
  const p = specProjekt();
  p.spuren[1].geraet = RB('werk:rb338/dark-dub');
  const r = pruefeProjekt(p);
  assert.ok('projekt' in r, JSON.stringify(r));
  assert.equal(r.projekt.spuren[1].geraet.preset, 'werk:rb338/dark-dub');
  const b = specProjekt(); b.spuren[1].geraet = BK('nutzer:baukasten/my-pad');
  assert.ok('projekt' in pruefeProjekt(b), JSON.stringify(pruefeProjekt(b)));
  for (const falsch of ['werk:rb338', 'x:rb338/a', '', 5, null]) {
    const q = specProjekt(); q.spuren[1].geraet = RB(falsch);
    assert.ok('fehler' in pruefeProjekt(q), `refused: ${JSON.stringify(falsch)}`);
  }
  const w = specProjekt(); w.spuren[2].geraet = { ...w.spuren[2].geraet, preset: 'werk:rb338/dark-dub' };
  assert.ok('fehler' in pruefeProjekt(w), 'a host device carries no preset');
  // negative control: a file of the current format (/2, no preset) loads and saves byte-identical
  const alt = pruefeProjekt(specProjekt()).projekt;
  assert.equal(alt.format, 'cypherdj-projekt/2');
  assert.equal(kanonisch(pruefeProjekt(JSON.parse(kanonisch(alt))).projekt), kanonisch(alt));
  assert.ok(!kanonisch(alt).includes('preset'));
});

test('commands: spur_neu and spur_aendern carry geraet.preset into the stored rb338 device; malformed → argument_ungueltig; absent → no key', () => {
  const n = ok(neuesProjekt('T'), { befehl: 'spur_neu', art: 'instrument', geraet: RB('werk:rb338/dark-dub') });
  assert.deepEqual(n.projekt.spuren[0].geraet, RB('werk:rb338/dark-dub'));
  const p = mitRb();
  const r = ok(p, { befehl: 'spur_aendern', spur_id: 's1', geraet: RB('werk:rb338/dark-dub', { cutoff: 0.6 }) });
  assert.equal(r.projekt.spuren[0].geraet.preset, 'werk:rb338/dark-dub');
  lehntAb(p, { befehl: 'spur_aendern', spur_id: 's1', geraet: RB('werk:rb338') }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'spur_neu', art: 'instrument', geraet: RB('nope') }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge', preset: 'werk:rb338/dark-dub' } }, 'argument_unbekannt');
  const ohne = ok(p, { befehl: 'spur_aendern', spur_id: 's1', geraet: RB(undefined, { cutoff: 0.7 }) });
  assert.equal('preset' in ohne.projekt.spuren[0].geraet, false);
});

test('device view: spurSicht strips geraet.preset; adding only preset is no playback change, a value change still is', () => {
  const p = mitRb();
  const nur = ok(p, { befehl: 'spur_aendern', spur_id: 's1', geraet: RB('werk:rb338/dark-dub') });
  assert.equal(nur.betrifft_wiedergabe, false);
  assert.equal('preset' in spurSicht(nur.projekt.spuren[0]).geraet, false);
  const wert = ok(p, { befehl: 'spur_aendern', spur_id: 's1', geraet: RB('werk:rb338/dark-dub', { cutoff: 0.9 }) });
  assert.equal(wert.betrifft_wiedergabe, true, 'negative control: the sound changes');
});

test('freeze: the model allows a freeze only on host tracks, so a preset target (rb338, bk) never carries one', () => {
  const p = specProjekt(); p.spuren[1].geraet = RB('werk:rb338/dark-dub'); p.spuren[1].freeze = null;
  assert.ok('fehler' in pruefeProjekt(p), 'freeze on an intern device is refused by the model');
  // switching a frozen host track to rb338 with a preset drops the freeze key, as for any intern device
  const q = specProjekt(); q.spuren[2].freeze = { datei: 'freeze-3-1.f32', frames: 240000, kennung: 1, sha256: 'c'.repeat(64) };
  const r = ok(pruefeProjekt(q).projekt, { befehl: 'spur_aendern', spur_id: 's3', geraet: RB('werk:rb338/dark-dub') });
  assert.equal('freeze' in r.projekt.spuren[2], false);
});

test('merge: an rb338 source with geraet.preset merges without error; the merged track carries no device and no preset', () => {
  let p = neuesProjekt('T');
  p = ok(p, { befehl: 'spur_neu', art: 'instrument', geraet: RB('werk:rb338/dark-dub') }).projekt;
  p = ok(p, { befehl: 'spur_neu', art: 'audio' }).projekt;
  const plan = mergePlan(p, { spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 4 }, 'andreas');
  const m = baueMergeProjekt(p, plan, { sha256: 'd'.repeat(64), pfad: '/x/merge.wav' }, 'andreas');
  const neu = m.projekt.spuren.find((s) => s.id === m.spurId);
  assert.equal(neu.geraet, undefined);
  assert.ok(!JSON.stringify(neu).includes('preset'));
});
