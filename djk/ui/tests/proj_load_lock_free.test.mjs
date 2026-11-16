// The playback load that the sampler routes ask for after they rewrote a graph (ladeLiveNeuFrei) respects the load lock like every other loader of the
// session: while a freeze, export, recording or resample holds it, only the wish is kept (merk.laden) and the load follows when the lock is released.
// ladeLiveNeu (no lock check) stays for the real-time export, which holds the lock itself and needs the live view back at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { projBereich } from '../areas/proj/area.ts';
import { pruefKontext, warteBis } from './support/proj_context.mjs';
import { tmpOrdner } from './support/project.mjs';

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));
async function aufbau(t) {
  const k = pruefKontext({ quittung: () => ({ status: 3, grund: '' }) });
  const d = tmpOrdner(t, 'djk-lfrei-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  await b.sitzung.neu('R', 'andreas');
  return { k, b, s: b.sitzung };
}
const laden = (e) => e.k.an('/k/arr/laden').length;

test('ladeLiveNeuFrei: without a lock it loads at once', async (t) => {
  const e = await aufbau(t);
  e.k.leere();
  assert.equal(await e.s.ladeLiveNeuFrei(), true);
  assert.equal(laden(e), 1);
  assert.equal(e.s.offen.merk.laden, false);
});

test('ladeLiveNeuFrei: with the lock held it only remembers; the release loads', async (t) => {
  const e = await aufbau(t);
  e.k.leere();
  const frei = e.b.zugang.sperreLaden();
  assert.equal(await e.s.ladeLiveNeuFrei(), false, 'deferred');
  assert.equal(laden(e), 0, 'nothing reached the core during the lock');
  assert.equal(e.s.offen.merk.laden, true);
  frei();
  assert.ok(await warteBis(() => laden(e) === 1, 1000), 'the release loads');
  await schlaf(30);
  assert.equal(laden(e), 1, 'once');
  assert.equal(e.s.offen.merk.laden, false);
});

test('ladeLiveNeu (the export) still loads at once under the lock it holds itself', async (t) => {
  const e = await aufbau(t);
  e.k.leere();
  const frei = e.b.zugang.sperreLaden();
  await e.s.ladeLiveNeu();
  assert.equal(laden(e), 1);
  frei();
  await schlaf(30);
  assert.equal(laden(e), 1, 'the release has nothing left to load');
});

test('ladeLiveNeuFrei without an open project loads nothing', async (t) => {
  const k = pruefKontext({ quittung: () => ({ status: 3, grund: '' }) });
  const d = tmpOrdner(t, 'djk-lfrei-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  assert.equal(await b.sitzung.ladeLiveNeuFrei(), true);
  assert.equal(k.an('/k/arr/laden').length, 0);
});
