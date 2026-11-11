// arr-bk: a bk stage whose graph file is gone. The core plays such a stage dry instead of refusing the whole playback (test_render_bk_insert case 4);
// the server says which stages are affected: bkGraphenFehlen lists them, and the answer of a project open carries them as kern.bk_graph_fehlt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bkGraphenFehlen } from '../areas/proj/session.ts';
import { neuesProjekt } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';

const effekt = (name) => (name === 'da' ? 'effekt' : null);

test('arr-bk: bkGraphenFehlen lists exactly the bk stages whose graph is not in the folder, on tracks, returns and the master', () => {
  const ctx = { quelle: 'andreas', graphArt: effekt };
  const p = fuehreListeAus(neuesProjekt('N'), [
    { befehl: 'spur_neu', art: 'audio', name: 'A' },
    { befehl: 'return_neu', name: 'R' },
    { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'bk', graph: 'da' },
    { befehl: 'insert_setzen', strang_id: 'r1', pos: 0, art: 'bk', graph: 'da' },
    { befehl: 'insert_setzen', strang_id: 'master', pos: 0, art: 'bk', graph: 'da' },
  ], ctx).projekt;
  assert.deepEqual(bkGraphenFehlen(p, effekt), [], 'every graph is there: nothing is listed (negative control)');
  const weg = bkGraphenFehlen(p, () => null);
  assert.equal(weg.length, 3);
  assert.deepEqual(weg.map((x) => x.strang_id).sort(), ['master', 'r1', 's1']);
  assert.ok(weg.every((x) => x.graph === 'da' && /^i\d+$/.test(x.stufe)), JSON.stringify(weg));
  assert.deepEqual(bkGraphenFehlen(p, (n) => (n === 'da' ? null : 'effekt')), weg, 'the lookup decides, not the name');
  const nur = bkGraphenFehlen(p, (n) => 'effekt');
  assert.deepEqual(nur, []);
});
