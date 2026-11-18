// SEQ scenes T2: KernWeg.szenenTeile and KernWeg.abbruchPlan against the recording test context.
import test from 'node:test';
import assert from 'node:assert/strict';
import { KernWeg } from '../areas/proj/core_path.ts';
import { KernLage } from '../areas/proj/state.ts';
import { pruefKontext } from './support/proj_context.mjs';

const zeilen = [{ pfad: 'spur/1/mute', wert: 0 }, { pfad: 'spur/2/mute', wert: 1 }, { pfad: 'spur/3/mute', wert: 0 }];

test('szenenTeile sends one /k/teil per row with the same ab_beat, plan szene, gruppe empty and politik 1', async () => {
  const k = pruefKontext();
  const w = new KernWeg(k, new KernLage());
  await w.szenenTeile('szene', 'cypher', 123.5, zeilen);
  const t = k.an('/k/teil');
  assert.equal(t.length, 3);
  for (const [i, g] of t.entries()) {
    assert.equal(g.felder.ab_beat, 123.5); assert.equal(g.felder.plan, 'szene'); assert.equal(g.felder.gruppe, '');
    assert.equal(g.felder.politik, 1); assert.equal(g.felder.quelle, 'cypher'); assert.equal(g.felder.dauer_beats, 0);
    assert.equal(g.felder.pfad, zeilen[i].pfad); assert.equal(g.felder.nach, zeilen[i].wert);
  }
});

test('szenenTeile matches receipts by message id', async () => {
  const k = pruefKontext({ quittung: (_a, f) => (f.pfad === 'spur/2/mute' ? { status: 6, grund: 'x' } : f.pfad === 'spur/3/mute' ? null : { status: 5, grund: '' }) });
  const r = await new KernWeg(k, new KernLage()).szenenTeile('szene', 'andreas', 50, zeilen);
  const ids = k.an('/k/teil').map((g) => g.id);
  assert.deepEqual(r, [{ id: ids[0], status: 5 }, { id: ids[1], status: 6 }, { id: ids[2], status: 0 }]);
});

test('abbruchPlan sends /k/abbruch with plan szene and teile *', async () => {
  const k = pruefKontext();
  const q = await new KernWeg(k, new KernLage()).abbruchPlan('szene', 'andreas');
  const a = k.an('/k/abbruch');
  assert.equal(a.length, 1);
  assert.deepEqual(a[0].felder, { quelle: 'andreas', plan: 'szene', teile: '*' });
  assert.equal(q.status, 3);
});
