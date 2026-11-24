// Browser plan 5, task 3: kit names inside a project (pure functions).
import test from 'node:test';
import assert from 'node:assert/strict';
import { kitNamenImProjekt, schreibeKitBezuege, zaehleKitBezuege } from '../project/kit_bezug.ts';

const projekt = () => ({
  format: 'cypherdj-project/2', name: 'p', kit: 'not-a-device',
  spuren: [
    { id: 's1', art: 'instrument', geraet: { art: 'intern', name: 'kit', kit: 'drums' } },
    { id: 's2', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} } },
    { id: 's3', art: 'instrument', geraet: { art: 'rack', kette: 0, glieder: [
      { id: 'g1', geraet: { art: 'intern', name: 'kit', kit: 'drums' } },
      { id: 'g2', geraet: { art: 'intern', name: 'kit', kit: 'perc' } },
      { id: 'g3', geraet: { art: 'wirt', name: 'surge', slot: 1 } },
    ] } },
  ],
});

test('finds a kit on a kit track and in a rack member', () => {
  assert.deepEqual(kitNamenImProjekt(projekt()), ['drums', 'perc']);
  assert.deepEqual(kitNamenImProjekt({ spuren: [] }), []);
});

test('count only the named kit', () => {
  assert.equal(zaehleKitBezuege(projekt(), 'drums'), 2);
  assert.equal(zaehleKitBezuege(projekt(), 'perc'), 1);
  assert.equal(zaehleKitBezuege(projekt(), 'nix'), 0);
});

test('rewrite changes every reference once and returns the count', () => {
  const p = projekt();
  assert.equal(schreibeKitBezuege(p, 'drums', 'drums-ab12cd34'), 2);
  assert.deepEqual(kitNamenImProjekt(p), ['drums-ab12cd34', 'perc']);
  assert.equal(schreibeKitBezuege(p, 'drums', 'x'), 0, 'a second rewrite finds nothing');
});

test('rewrite leaves other fields untouched', () => {
  const p = projekt();
  const vorher = JSON.parse(JSON.stringify(p));
  schreibeKitBezuege(p, 'drums', 'neu');
  vorher.spuren[0].geraet.kit = 'neu'; vorher.spuren[2].geraet.glieder[0].geraet.kit = 'neu';
  assert.deepEqual(p, vorher);
  assert.equal(p.kit, 'not-a-device');
});
