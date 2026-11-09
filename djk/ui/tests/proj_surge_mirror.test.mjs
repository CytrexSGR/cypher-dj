// Package 1.9 U5 (O28 on Surge), T5.2: the mirror of the project's Surge parameter map into the host of the slot (`fahre`, dauer 0, wirt-arr<slot>.sock).
// A fake host (tests/support/surge_host.mjs) records what arrives. Spec E7: on open, on every change, on undo and redo; a missing host is not an error here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sitzung, warteBis } from './support/proj_context.mjs';
import { falscherWirt, wirtOrdner } from './support/surge_host.mjs';

const SURGE = (parameter) => ({ art: 'wirt', name: 'surge', ...(parameter ? { parameter } : {}) });
const neueSpur = (parameter) => [{ befehl: 'spur_neu', art: 'instrument', geraet: SURGE(parameter) }];
const aufbau = async (t, werte = { a_filter1_cutoff: 3, a_env1_release: -1 }) => {
  const ordner = wirtOrdner(t);
  const h = falscherWirt(t, ordner, 1, werte);
  const e = sitzung(t, { wirtOrdner: () => ordner });
  return { ...e, h, ordner };
};

test('T5.2 change: a command that sets the map sends one fahre (dauer 0) per entry to the host of the slot, and the freeze path can wait for it', async (t) => {
  const { s, h } = await aufbau(t);
  await s.neu('W', 'andreas');
  await s.aendern({ rev: 0, label: 'Lead', befehle: neueSpur({ a_filter1_cutoff: 20, a_env1_release: -3 }) }, 'andreas');
  assert.ok(await warteBis(() => h.fahrten().length >= 2), 'the command alone brings both entries to the host');
  assert.deepEqual(h.fahrten().sort(), [['a_env1_release', -3, 0], ['a_filter1_cutoff', 20, 0]]);
  await s.wirtSpiegel();                                   // the freeze path: nothing is left to send
  assert.equal(h.fahrten().length, 2);
  // nothing else is sent when nothing changed
  h.befehle.length = 0;
  await s.aendern({ rev: 1, label: 'Name', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', name: 'Lead' }] }, 'andreas');
  await s.wirtSpiegel();
  assert.deepEqual(h.fahrten(), [], 'unchanged map: no fahre');
});

test('T5.2 undo and redo: undo sends the values that were in the host before, redo the new ones (AK-O3 on the host side)', async (t) => {
  const { s, h } = await aufbau(t);
  await s.neu('W', 'andreas');
  await s.aendern({ rev: 0, label: 'Lead', befehle: neueSpur({ a_filter1_cutoff: 20 }) }, 'andreas');
  assert.ok(await warteBis(() => h.werte.a_filter1_cutoff === 20));
  h.befehle.length = 0;
  await s.aendern({ rev: 1, label: 'Cutoff', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', geraet: SURGE({ a_filter1_cutoff: 30, a_env1_release: -4 }) }] }, 'andreas');
  assert.ok(await warteBis(() => h.werte.a_filter1_cutoff === 30 && h.werte.a_env1_release === -4));
  assert.deepEqual(h.fahrten().sort(), [['a_env1_release', -4, 0], ['a_filter1_cutoff', 30, 0]]);
  h.befehle.length = 0;
  await s.umkehr('undo', { rev: 2 }, 'andreas');
  assert.ok(await warteBis(() => h.werte.a_filter1_cutoff === 20 && h.werte.a_env1_release === -1), 'undo alone brings the host back');
  // the map is back to {cutoff 20}: cutoff goes to 20, release (no longer in the map) goes back to the value the host had before the first send (-1)
  assert.deepEqual(h.fahrten().sort(), [['a_env1_release', -1, 0], ['a_filter1_cutoff', 20, 0]]);
  assert.equal(h.werte.a_filter1_cutoff, 20); assert.equal(h.werte.a_env1_release, -1);
  h.befehle.length = 0;
  await s.umkehr('redo', { rev: 3 }, 'andreas');
  assert.ok(await warteBis(() => h.werte.a_filter1_cutoff === 30 && h.werte.a_env1_release === -4), 'redo alone');
  assert.deepEqual(h.fahrten().sort(), [['a_env1_release', -4, 0], ['a_filter1_cutoff', 30, 0]]);
});

test('T5.2 open: a project that holds a map sends ALL entries again (also those the mirror sent before), and the old project is taken back', async (t) => {
  const { s, h } = await aufbau(t);
  const a = await s.neu('A', 'andreas');
  await s.aendern({ rev: 0, label: 'Lead', befehle: neueSpur({ a_filter1_cutoff: 20, a_env1_release: -3 }) }, 'andreas');
  assert.ok(await warteBis(() => h.werte.a_filter1_cutoff === 20 && h.werte.a_env1_release === -3));
  const b = await s.neu('B', 'andreas');                 // the project B holds no map: A's entries go back to the host's own values
  assert.ok(await warteBis(() => h.werte.a_filter1_cutoff === 3 && h.werte.a_env1_release === -1), 'closing A took its entries back');
  h.befehle.length = 0;
  await s.oeffnen(a.j.slug, 'andreas');
  assert.ok(await warteBis(() => h.fahrten().length >= 2));
  assert.deepEqual(h.fahrten().sort(), [['a_env1_release', -3, 0], ['a_filter1_cutoff', 20, 0]], 'open sends all entries');
  void b;
});

test('T5.2 a missing host is not an error: the command succeeds, nothing throws, the next sync (the freeze path) retries', async (t) => {
  const ordner = wirtOrdner(t);
  const { s } = sitzung(t, { wirtOrdner: () => ordner });          // no host listens
  await s.neu('W', 'andreas');
  const r = await s.aendern({ rev: 0, label: 'Lead', befehle: neueSpur({ a_filter1_cutoff: 20 }) }, 'andreas');
  assert.equal(r.code, 200);
  await s.wirtSpiegel();                                           // resolves, does not throw
  // the host comes up later: the next sync sends the entry
  const h = falscherWirt(t, ordner, 1, { a_filter1_cutoff: 3 });
  await s.wirtSpiegel();
  assert.deepEqual(h.fahrten(), [['a_filter1_cutoff', 20, 0]], 'retried on the next sync');
});

test('T5.2 a host that answers an error leaves the command done; the entry stays pending and is retried', async (t) => {
  const { s, h } = await aufbau(t);
  h.antwort = (b) => (b.befehl === 'fahre' ? { ok: false, fehler: 'ValueError: nope' } : undefined);
  await s.neu('W', 'andreas');
  const r = await s.aendern({ rev: 0, label: 'Lead', befehle: neueSpur({ a_filter1_cutoff: 20 }) }, 'andreas');
  assert.equal(r.code, 200);
  await s.wirtSpiegel();
  const n = h.fahrten().length;
  assert.ok(n >= 1);
  h.antwort = null;
  await s.wirtSpiegel();
  assert.equal(h.werte.a_filter1_cutoff, 20, 'the retry reached the host');
});

test('T5.2 without a wirtOrdner option the mirror is off: no socket is ever touched (tests and tools never reach a live host)', async (t) => {
  const { s } = sitzung(t);
  await s.neu('W', 'andreas');
  const r = await s.aendern({ rev: 0, label: 'Lead', befehle: neueSpur({ a_filter1_cutoff: 20 }) }, 'andreas');
  assert.equal(r.code, 200);
  await s.wirtSpiegel();
});

test('T5.2 slot 2: the entries of a track on slot 2 go to wirt-arr2.sock, not to slot 1', async (t) => {
  const ordner = wirtOrdner(t);
  const h1 = falscherWirt(t, ordner, 1, { a_filter1_cutoff: 3 });
  const h2 = falscherWirt(t, ordner, 2, { a_filter1_cutoff: 3 });
  const { s } = sitzung(t, { wirtOrdner: () => ordner });
  await s.neu('W', 'andreas');
  await s.aendern({ rev: 0, label: 'Two', befehle: [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge', slot: 2, parameter: { a_filter1_cutoff: 9 } } }] }, 'andreas');
  assert.ok(await warteBis(() => h2.fahrten().length >= 1));
  assert.deepEqual(h2.fahrten(), [['a_filter1_cutoff', 9, 0]]);
  assert.deepEqual(h1.fahrten(), []);
});
