// Audit U11: insert_setzen art host with a path whose last segment is empty ('/', '.lv2' is handled by the replace, '/x/.vst3') fell back to the undeclared
// variable `pl` (ReferenceError instead of a stage). The display name falls back to the path itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus } from '../project/commands.ts';
import { alleInserts } from '../project/model.ts';
import { basisProjekt } from './support/inserts_scenario.mjs';

const stufe = (pfad) => ({ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'host', plugin: { format: 'lv2', pfad, uid: 'urn:x' } });

for (const pfad of ['/', '/x/.vst3', '.lv2']) {
  test(`insert_setzen host with path ${JSON.stringify(pfad)} makes a stage with a name, no ReferenceError`, () => {
    const r = fuehreAus(basisProjekt(), stufe(pfad));
    const [x] = alleInserts(r.projekt).filter((y) => y.insert.art === 'host');
    assert.equal(x.insert.plugin.pfad, pfad);
    assert.ok(x.insert.plugin.name.length > 0);
  });
}

test('negative control: a normal path keeps the name derived from the last segment', () => {
  const r = fuehreAus(basisProjekt(), stufe('/opt/Fake EQ.lv2'));
  assert.equal(alleInserts(r.projekt).find((y) => y.insert.art === 'host').insert.plugin.name, 'Fake EQ');
});
