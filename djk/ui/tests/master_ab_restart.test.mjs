// A restart of the page server while the master A/B is on: the rows A/B touched go back to the project's values, the project never takes the fader
// offset from the core, and the marker file is removed. Same fixture as tests/proj_fix_a4_restart.test.mjs (a project that the core still plays).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { neustart, arrNr, ist } from './support/proj_context.mjs';
import { Projekte } from '../project/storage.ts';
import { insertVorgabe } from '../project/model.ts';

const utility = { id: 'u1', art: 'utility', slot: 1, an: true, werte: insertVorgabe('utility') };
const PFADE = ['ins/utility/1/an', 'pm/fader'];

function aufbau(t, marke) {
  const n = neustart(t);
  const pr = new Projekte(n.e.wurzel);
  const p = pr.lies('wa');
  p.master = { fader_db: -2, inserts: [utility] };
  pr.speichere('wa', p);
  const datei = path.join(n.e.arr, 'master_ab.json');
  if (marke) fs.writeFileSync(datei, JSON.stringify(marke));
  return { ...n, datei, rev: p.rev };
}

test('restart with a marker: the core reports the A/B rows, the project keeps its fader, no undo entry, the project values are sent, marker gone', async (t) => {
  const { z, nr, datei, rev } = aufbau(t, { slug: 'wa', pfade: PFADE });
  z.s.ereignis('/zustand/arr', arrNr(nr));
  ist(z.s, 'pm/fader', -6.8);              // A/B turned side A down
  ist(z.s, 'ins/utility/1/an', 0);         // or has the stage bypassed (side B)
  const r = await z.s.oeffnen('wa', 'andreas');
  assert.equal(r.j.kern.wiederanlauf, true);
  assert.equal(r.j.projekt.master.fader_db, -2, 'the A/B offset is not taken into the project');
  assert.equal(r.j.projekt.rev, rev, 'no change, so no undo entry');
  assert.deepEqual(z.k.teile(/^(pm\/fader|ins\/utility\/1\/an)$/).map((x) => [x.felder.pfad, x.felder.nach]),
    [['ins/utility/1/an', 1], ['pm/fader', -2]], 'the project values of exactly the marked rows go to the core, the switch first');
  assert.equal(fs.existsSync(datei), false, 'marker removed');
});

test('negative control: restart without a marker takes a moved master fader from the core, as before', async (t) => {
  const { z, nr } = aufbau(t, null);
  z.s.ereignis('/zustand/arr', arrNr(nr));
  ist(z.s, 'pm/fader', -6.8);
  const r = await z.s.oeffnen('wa', 'andreas');
  assert.equal(r.j.projekt.master.fader_db, -6.8);
});

test('leftover marker on a normal open (the core restarted too): marker removed, every row sent from the project', async (t) => {
  const { z, nr, datei } = aufbau(t, { slug: 'wa', pfade: PFADE });
  z.s.ereignis('/zustand/arr', arrNr(nr + 1));
  const r = await z.s.oeffnen('wa', 'andreas');
  assert.equal(r.j.kern.wiederanlauf, undefined);
  assert.equal(fs.existsSync(datei), false);
  assert.deepEqual(z.k.teile(/^pm\/fader$/).map((x) => x.felder.nach), [-2]);
});

test('a marker of another project is no restart protection and is removed', async (t) => {
  const { z, nr, datei } = aufbau(t, { slug: 'anderes', pfade: PFADE });
  z.s.ereignis('/zustand/arr', arrNr(nr));
  await z.s.oeffnen('wa', 'andreas');
  assert.equal(fs.existsSync(datei), false);
});
