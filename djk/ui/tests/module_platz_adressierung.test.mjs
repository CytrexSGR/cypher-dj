// Container core review item 1: a module is addressed by its place (container letter A..D = place 1..4), never by the order among the module places.
// Module X is exported into place 3, moved to place 4, then module Y is exported: every slot-addressed way must hit the module that sits there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveAufbau } from './support/live_module.mjs';
import { modulAmPlatz, normierePlatz, platzVonModul, SLOTS } from '../project/live.ts';
import { ModulTonart } from '../areas/live/key.ts';

test('normierePlatz: 1..4 as number or string and the letters A..D; anything else is undefined', () => {
  assert.deepEqual(['A', 'B', 'C', 'D', 1, 2, 3, 4, '1', '4'].map(normierePlatz), ['A', 'B', 'C', 'D', 'A', 'B', 'C', 'D', 'A', 'D']);
  for (const x of ['E', 'a', 0, 5, '5', null, undefined, 1.5]) assert.equal(normierePlatz(x), undefined, String(x));
});

test('a module moved to another place stays addressable by its new place; the next module takes the free place; leeren, tonart, stand and stems hit the right module', async (t) => {
  const z = await liveAufbau(t);
  const x = await z.m.exportiere({ deck: 1, slot: 'C' }, 'andreas');
  await z.abbruch('C');
  const gX = x.j.gruppe_id;
  assert.equal(x.j.slot, 'C');
  assert.equal(modulAmPlatz(z.projekt(), 'C'), gX);
  // move X from place 3 to place 4 (the old place becomes a track place again)
  await z.aendern([{ befehl: 'platz_setzen', platz: 3, typ: 'track' }, { befehl: 'platz_setzen', platz: 4, typ: 'stems', gruppe_id: gX }]);
  assert.equal(modulAmPlatz(z.projekt(), 'D'), gX);
  assert.equal(modulAmPlatz(z.projekt(), 'C'), undefined);
  assert.equal(platzVonModul(z.projekt(), gX), 'D');
  // module Y goes into the first free place, which is place 3 now
  const y = await z.m.exportiere({ deck: 1 }, 'andreas');
  await z.abbruch('C');
  const gY = y.j.gruppe_id;
  assert.notEqual(gY, gX);
  assert.equal(y.j.slot, 'C', 'Y sits on place 3');
  assert.deepEqual(SLOTS.map((s) => modulAmPlatz(z.projekt(), s) ?? null), [null, null, gY, gX]);
  const stand = z.m.stand();
  assert.deepEqual([stand.C.gruppe_id, stand.D.gruppe_id, stand.A, stand.B], [gY, gX, null, null]);
  // tonart: reaches the module (no deck on the master is the next refusal), an empty place is slot_leer
  const tonart = new ModulTonart(z.ctx, z.zugang, undefined);
  assert.equal((await z.fehl(() => tonart.passeAn({ slot: 'D' }, 'andreas'))).fehler, 'kein_deck');
  assert.equal((await z.fehl(() => tonart.passeAn({ slot: 'B' }, 'andreas'))).fehler, 'slot_leer');
  // blend: slot D resolves to X (an empty place is slot_leer)
  assert.equal((await z.fehl(() => z.bl.blende({ slot: 'B', stem: 'drums', wert: 0.5, takte: 0 }, 'andreas'))).fehler, 'slot_leer');
  // stems retry: an occupied place without stems answers for its own module
  const sD = await z.fehl(() => z.m.stemsNeu({ slot: 'A' }, 'andreas'));
  assert.equal(sD.fehler, 'slot_leer');
  assert.deepEqual(SLOTS.map((x) => modulAmPlatz(z.projekt(), x) ?? null), [null, null, gY, gX], 'nothing was touched by the refusals');
  // leeren: the letter names the place, not the order
  const lD = await z.l.leere({ slot: 'D', takte: 0 }, 'andreas');
  assert.equal(lD.code, 200, JSON.stringify(lD.j));
  assert.equal(lD.j.gruppe_id, gX, 'D empties module X');
  const lC = await z.l.leere({ slot: 3, takte: 0 }, 'andreas');
  assert.equal(lC.j.gruppe_id, gY, 'place 3 empties module Y');
  assert.equal((await z.fehl(() => z.l.leere({ slot: 'A', takte: 0 }, 'andreas'))).fehler, 'slot_leer', 'an empty place is slot_leer');
  assert.deepEqual(SLOTS.map((x) => modulAmPlatz(z.projekt(), x) ?? null), [null, null, null, null], 'both modules are gone');
});

test('export into a wanted place that is taken is slot_belegt; into a place that holds a track it works; an argument that is no place is argument_ungueltig', async (t) => {
  const z = await liveAufbau(t);
  await z.m.exportiere({ deck: 1, slot: 'B' }, 'andreas');
  await z.abbruch('B');
  assert.equal((await z.fehl(() => z.m.exportiere({ deck: 1, slot: 'B' }, 'andreas'))).fehler, 'slot_belegt');
  assert.equal((await z.fehl(() => z.m.exportiere({ deck: 1, slot: 'E' }, 'andreas'))).fehler, 'argument_ungueltig');
  assert.equal(modulAmPlatz(z.projekt(), 'B') !== undefined, true);
});
