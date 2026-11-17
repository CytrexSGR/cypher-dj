// Live measurement of the master output: synthetic signals through messeLive, ring reader on ring files written by the test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { leseBusRing, messeLive } from '../project/sound_live.ts';
import { LIVE_FRAMES, LIVE_LAUTHEIT_FRAMES, LIVE_VORLAUF_FRAMES } from '../project/sound_contract.ts';

const N = LIVE_VORLAUF_FRAMES + LIVE_LAUTHEIT_FRAMES;
const db = (x) => 10 ** (x / 20);
function signal(f, n = N) { const d = new Float32Array(2 * n); for (let i = 0; i < n; i++) { const [l, r] = f(i); d[2 * i] = l; d[2 * i + 1] = r; } return d; }
const sinus = (hz, amp, ph = 0) => (i) => { const v = amp * Math.sin(2 * Math.PI * hz * i / 48000 + ph); return [v, v]; };

test('live: a 997 Hz sine at -20 dBFS reads -20 LUFS', () => {
  const m = messeLive(signal(sinus(997, db(-20))));
  assert.ok(Math.abs(m.lufs_m - -20) < 0.2, String(m.lufs_m));
  assert.equal(m.stumm, false);
});

test('live: a 1 kHz sine at -6 dBFS reads -6 dB in its band and correlation 1', () => {
  const m = messeLive(signal(sinus(1000, db(-6))));
  assert.ok(Math.abs(m.spitze_db - -6) < 0.1);
  const j = m.spektrum.hz.reduce((b, h, i) => (Math.abs(h - 1000) < Math.abs(m.spektrum.hz[b] - 1000) ? i : b), 0);
  assert.ok(Math.abs(m.spektrum.db[j] - -6) < 0.5, String(m.spektrum.db[j]));
  assert.ok(m.stereo.korrelation > 0.999);
  assert.equal(m.spektrum.hz.length, m.spektrum.db.length);
});

test('live: L = -R reads correlation -1', () => {
  const m = messeLive(signal((i) => { const v = db(-6) * Math.sin(2 * Math.PI * 1000 * i / 48000); return [v, -v]; }));
  assert.ok(m.stereo.korrelation < -0.999);
});

test('live: a sine at a quarter of the sample rate with 45 degrees reads a true peak near 0 dBTP above the sample peak', () => {
  const m = messeLive(signal(sinus(12000, 1, Math.PI / 4)));
  assert.ok(Math.abs(m.spitze_db - -3.01) < 0.05, String(m.spitze_db));
  assert.ok(Math.abs(m.true_peak_dbtp) < 0.3, String(m.true_peak_dbtp));
  assert.ok(m.true_peak_dbtp >= m.spitze_db);
});

test('live: silence is stumm, lufs null, bands at the floor, true peak -200', () => {
  const m = messeLive(new Float32Array(2 * N));
  assert.equal(m.stumm, true);
  assert.equal(m.lufs_m, null);
  assert.equal(m.true_peak_dbtp, -200);
  assert.ok(m.spektrum.db.every((v) => v === -200));
});

// ---- ring reader ----
const KOPF = 64, CAP = 65536;
function ring(w, { magic = 'CDJB', groesse = KOPF + CAP * 16, wert = (f) => [f, -f, 0, 0] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klang-live-'));
  const pfad = path.join(dir, 'bus');
  const b = Buffer.alloc(groesse);
  b.write(magic, 0, 'ascii'); b.writeUInt32LE(1, 4); b.writeUInt32LE(48000, 8); b.writeUInt32LE(4, 12); b.writeUInt32LE(CAP, 16);
  b.writeBigUInt64LE(BigInt(w), 32);
  if (groesse === KOPF + CAP * 16) for (let f = 0; f < Math.min(w, CAP * 2); f++) { const fr = w > CAP ? w - CAP + (f < CAP ? f : 0) : f; if (f >= CAP) break; const v = wert(fr); const o = KOPF + (fr % CAP) * 16; for (let c = 0; c < 4; c++) b.writeFloatLE(v[c], o + c * 4); }
  fs.writeFileSync(pfad, b);
  return { pfad, weg: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('ring reader: plain case gives the last frames of L and R, oldest first', (t) => {
  const r = ring(1000); t.after(r.weg);
  const x = leseBusRing(r.pfad, 100);
  assert.equal(x.w, 1000);
  assert.equal(x.daten.length, 200);
  assert.equal(x.daten[0], 900); assert.equal(x.daten[1], -900);
  assert.equal(x.daten[198], 999); assert.equal(x.daten[199], -999);
});

test('ring reader: a read across the ring end is continuous', (t) => {
  const w = CAP + 50;
  const r = ring(w); t.after(r.weg);
  const x = leseBusRing(r.pfad, 200);
  assert.equal(x.w, w);
  for (let i = 0; i < 200; i++) assert.equal(x.daten[2 * i], w - 200 + i, `frame ${i}`);
});

test('ring reader: fewer frames written than asked for gives null', (t) => {
  const r = ring(100); t.after(r.weg);
  assert.equal(leseBusRing(r.pfad, 101), null);
  assert.notEqual(leseBusRing(r.pfad, 100), null);
});

test('ring reader: wrong magic, wrong size and missing file give null, never a throw', (t) => {
  const a = ring(1000, { magic: 'XXXX' }); t.after(a.weg);
  const b = ring(1000, { groesse: KOPF + 1000 }); t.after(b.weg);
  assert.equal(leseBusRing(a.pfad, 100), null);
  assert.equal(leseBusRing(b.pfad, 100), null);
  assert.equal(leseBusRing('/nonexistent/dir/bus', 100), null);
});

test('live: wall time of one ring read plus measurement stays under 15 ms (median of 50)', (t) => {
  const r = ring(CAP * 3 + 777, { wert: (f) => { const v = 0.3 * Math.sin(2 * Math.PI * 440 * f / 48000); return [v, v, 0, 0]; } }); t.after(r.weg);
  const zeiten = [];
  for (let i = 0; i < 53; i++) {
    const t0 = process.hrtime.bigint();
    const x = leseBusRing(r.pfad, N);
    messeLive(x.daten);
    zeiten.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  const med = zeiten.slice(3).sort((p, q) => p - q)[25];
  console.log(`live wall time median ${med.toFixed(2)} ms`);
  assert.ok(med < 15, `${med} ms`);
});
