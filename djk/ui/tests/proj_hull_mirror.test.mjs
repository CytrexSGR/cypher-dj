// S1b K2: the kern mirrors a cell envelope as /e/regler with halter `huelle` (display only, never a hand). The page server must neither store it in the
// project (rueckweg, undoable "his" change) nor treat it as a release (aufAuto.reglerFrei, basisWartend). A `mensch` event on the same path still is a hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { warteBis } from './support/proj_context.mjs';
import { liveAufbau } from './support/live_module.mjs';

const schlaf = (ms) => new Promise((ok) => setTimeout(ok, ms));
const regler = (s, pfad, wert, halter) => s.ereignis('/e/regler', { pfad, wert, halter, sample: 0n, beat: 0 });

test('K2: /e/regler halter huelle on spur/1/filter: not stored, no reglerFrei; the mensch event on the same path is stored', async (t) => {
  const z = await liveAufbau(t);   // the live container: only a loop deck track has a filter row
  const s = z.s;
  await z.aendern([{ befehl: 'loopdeck_neu', platz: 1 }]);
  const filter = () => s.aktuell().j.projekt.spuren.find((x) => x.nr === 1).filter ?? 0;
  const frei = [];
  const orig = s.aufAuto.reglerFrei.bind(s.aufAuto);
  s.aufAuto.reglerFrei = (pfad) => { frei.push(pfad); return orig(pfad); };
  const rev0 = s.aktuell().j.projekt.rev;
  for (let i = 0; i < 5; i++) { regler(s, 'spur/1/filter', 0.1 * i, 'huelle'); await schlaf(10); }
  await schlaf(400);
  assert.equal(s.aktuell().j.projekt.rev, rev0, 'the envelope mirror does not change the project');
  assert.equal(filter(), 0);
  assert.deepEqual(frei, [], 'the mirror is no release');
  regler(s, 'spur/1/filter', 0.5, 'mensch');
  assert.ok(await warteBis(() => filter() === 0.5, 1500), 'a hand grip is stored');
  assert.deepEqual(frei, [], 'a mensch event is no release either');
  regler(s, 'spur/1/filter', 0.5, 'frei');
  assert.deepEqual(frei, ['spur/1/filter'], 'positive control: halter frei still releases');
});
