// S17 task 3: after a kern restart (new generation) the sound snapshot is sent again, with source andreas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pruefKontext, sitzung, warteBis } from './hilfen/proj_kontext.mjs';
import { Projekte } from '../projekt/ablage.ts';

const HASH = 'b'.repeat(64);
const K9 = [0.1, 0.2, 0.9, 0.4, 0.5, 0.6, 0.7, 0.8];
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

async function offen(t) {
  const k = pruefKontext({ baukasten: true });
  const e = sitzung(t, { arrFristMs: 30 }, k);
  const pr = new Projekte(e.wurzel);
  const { slug, projekt } = pr.lege('Neu');
  projekt.baukasten = [{ id: 'erz3', graph: 'sampler-fairlight', regler: [...K9], sha256: HASH }];
  pr.speichere(slug, projekt);
  k.bk.hash['sampler-fairlight'] = HASH;
  e.s.ereignis('/k/willkommen', { generation: 1 });
  await e.s.oeffnen(slug, 'cypher');
  return { ...e, k, slug };
}

test('S17 T3.18 a kern restart re-sends the knobs and the graph with source andreas; the same generation again sends nothing', async (t) => {
  const { s, k } = await offen(t);
  assert.equal(k.bk.aufrufe.length, 1, 'opened once');
  k.bk.geladen = {};   // the page server clears its map on a new kern
  k.leere(); k.bk.aufrufe.length = 0;
  s.ereignis('/e/neustart', { generation: 2 });
  assert.ok(await warteBis(() => k.bk.aufrufe.length > 0, 2000), 'the graph is sent again');
  await schlaf(30);
  assert.deepEqual(k.bk.aufrufe.map(({ kanal, name, quelle }) => ({ kanal, name, quelle })), [{ kanal: 'erz/3', name: 'sampler-fairlight', quelle: 'andreas' }]);
  const teile = k.teile(/^erz\/3\/bk\//);
  assert.deepEqual(teile.map((x) => [x.felder.pfad, x.felder.nach]), K9.map((w, i) => [`erz/3/bk/${i + 1}`, w]));
  assert.ok(teile.every((x) => x.felder.quelle === 'andreas'));
  assert.ok(k.protokoll.some((z) => z.typ === 'proj_neustart' && Array.isArray(z.baukasten) && z.baukasten[0].kanal === 'erz/3'), 'the log line carries baukasten');
  // negative control: the same generation again is no restart
  k.leere(); k.bk.aufrufe.length = 0;
  s.ereignis('/e/neustart', { generation: 2 });
  await schlaf(150);
  assert.equal(k.bk.aufrufe.length, 0); assert.equal(k.teile(/\/bk\//).length, 0);
});

test('S17 T3.19 a project without a snapshot sends nothing after a kern restart', async (t) => {
  const k = pruefKontext({ baukasten: true });
  const e = sitzung(t, { arrFristMs: 30 }, k);
  e.s.ereignis('/k/willkommen', { generation: 1 });
  await e.s.neu('Leer', 'andreas');
  k.leere();
  e.s.ereignis('/e/neustart', { generation: 2 });
  assert.ok(await warteBis(() => k.an('/k/arr/loop').length > 0, 2000), 'the restart handler ran');
  await schlaf(50);
  assert.equal(k.bk.aufrufe.length, 0); assert.equal(k.teile(/\/bk\//).length, 0);
});
