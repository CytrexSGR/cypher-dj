// GET /analyse/live: live picture of the master output from the audio ring (real server on the stand-in, ring file written by the test).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './support/media_library.mjs';

const KOPF = 64, CAP = 65536;
function schreibe(pfad, w, f) {
  const b = Buffer.alloc(KOPF + CAP * 16);
  b.write('CDJB', 0, 'ascii'); b.writeUInt32LE(1, 4); b.writeUInt32LE(48000, 8); b.writeUInt32LE(4, 12); b.writeUInt32LE(CAP, 16);
  b.writeBigUInt64LE(BigInt(w), 32);
  for (let i = w - CAP; i < w; i++) { if (i < 0) continue; const v = f(i); b.writeFloatLE(v, KOPF + (i % CAP) * 16); b.writeFloatLE(v, KOPF + (i % CAP) * 16 + 4); }
  fs.writeFileSync(pfad, b);
}
const hol = async (url) => { const r = await fetch(`${url}/analyse/live`); return { code: r.status, j: await r.json() }; };
const wartet = (ms) => new Promise((r) => setTimeout(r, ms));

test('analyse live route: no ring gives leer, a ring with a sine gives the values, a ring that does not move reads steht', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyse-live-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bus = path.join(dir, 'bus');
  const { url, o } = await stapel(t);
  o.opt.busRing = bus;

  assert.deepEqual(await hol(url), { code: 200, j: { leer: true, grund: 'kein_ring' } });

  const w = 100000;
  schreibe(bus, w, (i) => 0.5 * Math.sin(2 * Math.PI * 1000 * i / 48000));
  const a = await hol(url);
  assert.equal(a.code, 200);
  assert.equal(a.j.leer, false);
  assert.equal(a.j.w, w);
  assert.equal(a.j.steht, false, 'first call: no previous w');
  assert.equal(a.j.stumm, false);
  assert.ok(Math.abs(a.j.spitze_db - -6.02) < 0.1, String(a.j.spitze_db));
  assert.ok(Math.abs(a.j.true_peak_dbtp - -6.02) < 0.3);
  assert.ok(a.j.stereo.korrelation > 0.999);
  assert.equal(typeof a.j.lufs_m, 'number');
  assert.equal(a.j.spektrum.hz.length, a.j.spektrum.db.length);

  await wartet(200);
  const b = await hol(url);
  assert.equal(b.j.steht, true, 'same w 200 ms later');
  schreibe(bus, w + 4800, (i) => 0.5 * Math.sin(2 * Math.PI * 1000 * i / 48000));
  const c = await hol(url);
  assert.equal(c.j.steht, false);
  assert.equal(c.j.w, w + 4800);
});
