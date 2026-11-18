// Audit U04: holeNach must keep the deferred "after the load" rows (louder / unmute, live container) back when the playback could not be written,
// like uebernimm does (the old playback stays, so do its rows). A translator refusal answers {nr: null, fehler} without a receipt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveAufbau } from './support/live_module.mjs';
import { warteBis } from './support/proj_context.mjs';
import { WiedergabeFehler } from '../project/playback.ts';

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));
const reihe = { pfad: 'spur/1/fader', wert: 0 };
const faderZeilen = (z) => z.protokoll.gesendet.filter((g) => g.adresse === '/k/teil' && g.felder.pfad === reihe.pfad);

async function aufschub(t, refuse) {
  const z = await liveAufbau(t);
  await z.exportiere('A');
  const o = z.s.offen;
  const frei = z.zugang.sperreLaden();                              // a freeze holds the lock
  o.merk.laden = true; o.merk.reglerNach = [{ ...reihe }];          // what ladeOderMerke + uebernimm leave behind for a deferred change
  if (refuse) z.s.uebersetzeFuer = () => { throw new WiedergabeFehler('zu_gross', 'test'); };
  z.protokoll.gesendet.length = 0;
  frei();                                                           // holeNach
  return { z, o };
}

test('U04 translator refusal on the deferred load: the rows that wait for the load are not sent to the old playback', async (t) => {
  const { z, o } = await aufschub(t, true);
  assert.ok(await warteBis(() => o.merk.laden === false, 2000), 'holeNach ran');
  await schlaf(100);
  assert.equal(z.protokoll.gesendet.filter((g) => g.adresse === '/k/arr/laden').length, 0, 'nothing was loaded');
  assert.deepEqual(faderZeilen(z), [], 'the fader-up row must not reach the old playback');
  assert.deepEqual(o.merk.reglerNach, [], 'the rows are dropped like in uebernimm');
});

test('U04 negative control: a load that succeeds sends the rows after the receipt', async (t) => {
  const { z, o } = await aufschub(t, false);
  assert.ok(await warteBis(() => faderZeilen(z).length > 0, 2000), 'the row follows the load');
  const laden = z.protokoll.gesendet.findIndex((g) => g.adresse === '/k/arr/laden');
  const zeile = z.protokoll.gesendet.findIndex((g) => g.adresse === '/k/teil' && g.felder.pfad === reihe.pfad);
  assert.ok(laden >= 0 && zeile > laden, 'LADEN before the row');
  assert.deepEqual(o.merk.reglerNach, []);
});
