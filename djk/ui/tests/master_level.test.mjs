// Streaming master meter: synthetic signals pushed in chunks, like the page server pushes ring reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MasterPegel } from '../project/master_level.ts';

const db = (x) => 10 ** (x / 20);
function signal(f, n, ab = 0) { const d = new Float32Array(2 * n); for (let i = 0; i < n; i++) { const [l, r] = f(i + ab); d[2 * i] = l; d[2 * i + 1] = r; } return d; }
const sinus = (hz, amp, ph = 0) => (i) => { const v = amp * Math.sin(2 * Math.PI * hz * i / 48000 + ph); return [v, v]; };
const gegen = (hz, amp) => (i) => { const v = amp * Math.sin(2 * Math.PI * hz * i / 48000); return [v, -v]; };
function schiebeGleich(m, f, bloecke) { for (let b = 0; b < bloecke; b++) m.schiebe(signal(f, 4800, b * 4800)); }

test('pegel: 997 Hz at -20 dBFS reads -20 LUFS M and S, S null until 3 s are in', () => {
  const m = new MasterPegel();
  schiebeGleich(m, sinus(997, db(-20)), 10);
  let s = m.stand();
  assert.ok(Math.abs(s.lufs_m - -20) < 0.3, String(s.lufs_m));
  assert.equal(s.lufs_s, null);
  const f = sinus(997, db(-20));
  for (let b = 10; b < 40; b++) m.schiebe(signal(f, 4800, b * 4800));
  s = m.stand();
  assert.ok(Math.abs(s.lufs_m - -20) < 0.3, String(s.lufs_m));
  assert.ok(Math.abs(s.lufs_s - -20) < 0.3, String(s.lufs_s));
  assert.equal(s.stumm, false);
  assert.equal(s.dauer_s, 4);
});

test('pegel: uneven chunks give the same values as even chunks', () => {
  const f = sinus(997, db(-20));
  const a = new MasterPegel(); schiebeGleich(a, f, 40);
  const b = new MasterPegel();
  const teile = [1000, 7000, 333, 4801, 12, 20000, 9999];
  let pos = 0, i = 0;
  while (pos < 192000) { const n = Math.min(teile[i++ % teile.length], 192000 - pos); b.schiebe(signal(f, n, pos)); pos += n; }
  const x = a.stand(), y = b.stand();
  assert.ok(Math.abs(x.lufs_m - y.lufs_m) <= 0.1 && Math.abs(x.lufs_s - y.lufs_s) <= 0.1, JSON.stringify([x, y]));
  assert.ok(Math.abs(x.tp_max_dbtp - y.tp_max_dbtp) <= 0.1);
  assert.equal(x.dauer_s, y.dauer_s);
});

test('pegel: correlation -1, +1 and silence', () => {
  let m = new MasterPegel(); schiebeGleich(m, gegen(1000, db(-6)), 5);
  assert.ok(m.stand().korrelation <= -0.99);
  m = new MasterPegel(); schiebeGleich(m, sinus(1000, db(-6)), 5);
  assert.ok(m.stand().korrelation >= 0.99);
  m = new MasterPegel(); schiebeGleich(m, () => [0, 0], 5);
  const s = m.stand();
  assert.equal(s.korrelation, null); assert.equal(s.stumm, true); assert.equal(s.lufs_m, null);
});

test('pegel: 12 kHz full-scale sine at 45 degrees has a true peak near 0 dBTP, also across chunk borders', () => {
  const f = sinus(12000, 1, Math.PI / 4);
  const m = new MasterPegel();
  for (let pos = 0; pos < 4800 * 3; pos += 7) m.schiebe(signal(f, 7, pos));
  const s = m.stand();
  assert.ok(Math.abs(s.tp_max_dbtp) <= 0.5, String(s.tp_max_dbtp));
});

test('pegel: a gap restarts the windows but keeps held max; reset clears it', () => {
  const m = new MasterPegel();
  schiebeGleich(m, sinus(997, db(-20)), 40);
  assert.ok(m.stand().lufs_s !== null);
  m.schiebe(signal(sinus(997, db(-20)), 4800, 0), 9600);
  const s = m.stand();
  assert.equal(s.lufs_m, null); assert.equal(s.lufs_s, null);
  assert.ok(s.tp_max_dbtp > -30);
  m.zuruecksetzen();
  const z = m.stand();
  assert.equal(z.tp_max_dbtp, -200); assert.equal(z.dauer_s, 0);
});

test('pegel: integrated loudness gates, a gap is counted but keeps the blocks, reset clears', () => {
  let m = new MasterPegel();
  schiebeGleich(m, sinus(997, db(-20)), 200);
  schiebeGleich(m, sinus(997, db(-30)), 200);
  let s = m.stand();
  assert.ok(Math.abs(s.lufs_i - -22.6) <= 0.3, String(s.lufs_i));
  m = new MasterPegel();
  schiebeGleich(m, sinus(997, db(-20)), 200);
  schiebeGleich(m, () => [0, 0], 200);
  s = m.stand();
  assert.ok(Math.abs(s.lufs_i - -20) <= 0.2, String(s.lufs_i));
  assert.equal(s.luecke_s, 0);
  m.schiebe(signal(sinus(997, db(-20)), 4800, 0), 48000);
  s = m.stand();
  assert.equal(s.luecke_s, 1.0);
  assert.ok(Math.abs(s.lufs_i - -20) <= 0.2, String(s.lufs_i));
  m.zuruecksetzen();
  s = m.stand();
  assert.equal(s.lufs_i, null); assert.equal(s.luecke_s, 0);
});

test('pegel: silence does not grow the block list, a full list is reported', () => {
  const m = new MasterPegel();
  schiebeGleich(m, () => [0, 0], 200);
  assert.equal(m.nBloecke, 0);
  assert.equal(m.stand().lufs_i_voll, false);
  schiebeGleich(m, sinus(997, db(-20)), 20);
  assert.ok(m.nBloecke > 0);
  m.voll = true;
  assert.equal(m.stand().lufs_i_voll, true);
});
