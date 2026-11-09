// Package 1.9 U5 (T5.2): "Freeze waits until the mirror answered". The freeze path asks the session to bring the hosts to the project's Surge map and
// waits for the answer before the lock, the tempo alignment and the core freeze. A stand-in for the zugang records the order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aufbau } from './support/output_setup.mjs';

test('T5.2 freeze: wirtSpiegel runs and is awaited before the lock and the core freeze; a refused freeze (no host) never reaches it', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  let fertig = false;
  a.zugang.wirtSpiegel = async () => {
    a.protokoll.reihenfolge.push('spiegel');
    await new Promise((r) => setTimeout(r, 120));
    fertig = true;
    a.protokoll.reihenfolge.push('spiegel-fertig');
  };
  const orig = a.ctx.sende;
  a.ctx.sende = (adresse, felder) => { if (adresse === '/k/arr/freeze') a.protokoll.reihenfolge.push(`kern-freeze(spiegel fertig: ${fertig})`); return orig(adresse, felder); };
  await a.ausgabe.freeze({ spur_id: 's3', an: true });
  const o = a.protokoll.reihenfolge;
  assert.deepEqual(o.slice(0, 3), ['spiegel', 'spiegel-fertig', 'sperre'], JSON.stringify(o));
  assert.ok(o.includes('kern-freeze(spiegel fertig: true)'), JSON.stringify(o));
});

test('T5.2 freeze: no host -> wirt_fehlt first, the mirror is not asked (nothing to mirror into)', async (t) => {
  const a = await aufbau(t, { tempo: 120, mitWirt: false });
  let gefragt = 0;
  a.zugang.wirtSpiegel = async () => { gefragt += 1; };
  await assert.rejects(() => a.ausgabe.freeze({ spur_id: 's3', an: true }), (e) => e.grund === 'wirt_fehlt');
  assert.equal(gefragt, 0);
});

test('T5.2 freeze: a zugang without wirtSpiegel (older stand-ins) freezes as before', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  delete a.zugang.wirtSpiegel;
  const r = await a.ausgabe.freeze({ spur_id: 's3', an: true });
  assert.ok(r.projekt.spuren.find((s) => s.id === 's3').freeze);
});

// Review fix (U5): a host that answered the mirror with an error must not freeze a sound that differs from the project's map
test('T5.2 freeze: a mirror that reports errors refuses the freeze (wirt_spiegel_fehler, 409) before the lock and the core freeze', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  a.zugang.wirtSpiegel = async () => ['1:a_filter1_cutoff: ValueError: nope'];
  const orig = a.ctx.sende;
  let kern = 0;
  a.ctx.sende = (adresse, felder) => { if (adresse === '/k/arr/freeze') kern += 1; return orig(adresse, felder); };
  await assert.rejects(() => a.ausgabe.freeze({ spur_id: 's3', an: true }),
    (e) => e.grund === 'wirt_spiegel_fehler' && /ValueError: nope/.test(e.message));
  assert.equal(kern, 0, 'the core did not freeze');
  assert.ok(!a.protokoll.reihenfolge.includes('sperre'), 'the lock was not taken');
});

test('T5.2 freeze negative control: a mirror without errors (empty list) freezes as before', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  a.zugang.wirtSpiegel = async () => [];
  const r = await a.ausgabe.freeze({ spur_id: 's3', an: true });
  assert.ok(r.projekt.spuren.find((s) => s.id === 's3').freeze);
});
