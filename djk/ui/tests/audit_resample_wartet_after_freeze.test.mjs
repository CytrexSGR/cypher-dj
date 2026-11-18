// Audit U06: proj_resample right after a freeze of this server must wait for the core's stop report (1.9 T12), like freeze, export and bounce.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aufbau } from './support/output_setup.mjs';
import { warteBis } from './support/proj_context.mjs';
import { alsAntwort } from '../areas/proj/output.ts';

const ruf = async (f) => { try { return { code: 200, body: await f() }; } catch (e) { return alsAntwort(e); } };

test('resample: a stale "freeze running" report right after our own freeze is waited out, not refused as transport_laeuft', async (t) => {
  const a = await aufbau(t, { tempo: 120, abgriff: { art: 'ok', ms: 50 } });
  // a freeze of this server has just ended; the core still reports status 3 and answers "stopped" a moment later
  a.ausgabe.eigenFreezeEnde = Date.now();
  a.zustand.kernStatus = 3; a.arrMeldung();
  assert.ok(await warteBis(() => a.ausgabe.arr?.status === 3), 'the stale report arrived');
  setTimeout(() => { a.zustand.kernStatus = 0; a.arrMeldung(); }, 150);
  const r = await ruf(() => a.ausgabe.resample({ strang_id: 's2', von_beat: 0, bis_beat: 8 }));
  assert.equal(r.code, 200, JSON.stringify(r.body));
});

test('resample: a transport nobody froze for is still refused at once', async (t) => {
  const a = await aufbau(t, { tempo: 120, abgriff: { art: 'ok', ms: 50 } });
  a.zustand.kernStatus = 2; a.arrMeldung();
  assert.ok(await warteBis(() => a.ausgabe.arr?.status === 2));
  const t0 = Date.now();
  const r = await ruf(() => a.ausgabe.resample({ strang_id: 's2', von_beat: 0, bis_beat: 8 }));
  assert.deepEqual([r.code, r.body.fehler], [409, 'transport_laeuft']);
  assert.ok(Date.now() - t0 < 500, `refused at once (${Date.now() - t0} ms)`);
});
