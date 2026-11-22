// Session view S1b, B4: the TS twin of the core read map against the shared reference (djk/contract/zell_karte_referenz.json), and the renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zellLesen, zellRendern, zellEinblende, ZELL_NAHT } from '../project/zell_map.ts';

const ref = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../contract/zell_karte_referenz.json'), 'utf8'));
const karte = (c) => ({ g: c.g, s: c.s, rueck: c.rueck, blende: c.blende, kreis: c.kreis, frames: c.frames });

// NaN-safe: `Math.abs(x - y) > eps` is false for NaN, so a NaN result would pass a "greater than" gate; both sides must be finite and within eps
const nah = (x, y, eps) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= eps;

test('the reference names the same seam fade as the twin', () => assert.equal(ref.naht, ZELL_NAHT));

test('zellLesen equals every point of every case of zell_karte_referenz.json (a to 1e-9, b to 1e-9, wb to 1e-6)', () => {
  let n = 0;
  const fehler = [];
  for (const c of ref.faelle) {
    for (const [pos, a, b, wb] of c.punkte) {
      const r = zellLesen(karte(c), typeof pos === 'string' ? NaN : pos);
      n++;
      if (!(nah(r.a, a, 1e-9) && nah(r.b, b, 1e-9) && nah(r.wb, wb, 1e-6))) fehler.push(`${c.name} f=${pos}: got ${r.a},${r.b},${r.wb} want ${a},${b},${wb}`);
    }
  }
  assert.equal(n, 240);
  assert.deepEqual(fehler, []);
});

test('zellEinblende: 0 up to the onset, linear over 96 frames, 1 after', () => {
  assert.deepEqual([zellEinblende(-5), zellEinblende(0), zellEinblende(48), zellEinblende(96), zellEinblende(1e6)], [0, 0, 0.5, 1, 1]);
});

const quelle = (frames) => Float32Array.from({ length: frames * 2 }, (_, i) => Math.fround(Math.sin(i * 0.37) * 0.5 + (i % 2) * 0.1));

test('zellRendern of the identity table returns the input bit-equal (loop and one-shot)', () => {
  const d = quelle(1000);
  for (const kreis of [true, false]) {
    const aus = zellRendern(d, { g: [], s: [], rueck: false, blende: false, kreis, frames: 1000 }, 1);
    assert.deepEqual(Buffer.from(aus.buffer), Buffer.from(d.buffer));
  }
});

test('a reversed render equals the input read backwards; gain scales it', () => {
  const d = quelle(1000);
  const aus = zellRendern(d, { g: [], s: [], rueck: true, blende: false, kreis: false, frames: 1000 }, 0.5);
  for (const f of [0, 1, 500, 999]) {
    assert.equal(aus[2 * f], Math.fround(d[2 * (999 - f)] * 0.5));
    assert.equal(aus[2 * f + 1], Math.fround(d[2 * (999 - f) + 1] * 0.5));
  }
});

test('a shuffled render equals the slot-by-slot copies, with a 96-sample fade at each discontinuous seam', () => {
  const frames = 1000, d = quelle(frames);
  const g = [0, 300, 600, 1000], s = [1, 0, 2];
  const aus = zellRendern(d, { g, s, rueck: false, blende: false, kreis: true, frames }, 1);
  const kopie = (f) => { const k = g[s[g.findIndex((x, i) => i < 3 && f >= x && f < g[i + 1])]] ; return k; };
  // played slot 0 (0..300) is source slot 1 (300..600); away from every seam it is a plain copy
  for (const f of [100, 250, 290]) assert.equal(aus[2 * f], d[2 * (f + 300)], `slot 0 frame ${f}`);
  // played slot 1 (300..600) is source slot 0: a copy once the 96 frames after the seam are past
  for (const f of [400, 500, 599]) assert.equal(aus[2 * f], d[2 * (f - 300)], `slot 1 frame ${f}`);
  // played slot 2 (600..1000) is source slot 2: identity
  for (const f of [700, 900, 999]) assert.equal(aus[2 * f], d[2 * f], `slot 2 frame ${f}`);
  // at the seam 300 the old read (source 600 on) and the new read (source 0 on) cross over 96 frames, equal-gain linear
  for (const i of [0, 10, 50, 95]) {
    const w = 1 - i / ZELL_NAHT, f = 300 + i;
    const erwartet = d[2 * (600 + i)] * w + d[2 * i] * (1 - w);
    assert.ok(Math.abs(aus[2 * f] - erwartet) < 1e-6, `seam frame ${f}: ${aus[2 * f]} vs ${erwartet}`);
  }
  assert.equal(aus[2 * 396], d[2 * 96], 'the fade is over after 96 frames');
  void kopie;
});

test('a ranged render equals the same range of the full turn, bit for bit', () => {
  const frames = 1000, d = quelle(frames);
  const k = { g: [0, 300, 600, 1000], s: [1, 0, 2], rueck: true, blende: true, kreis: true, frames };
  const voll = zellRendern(d, k, 0.7);
  for (const [von, bis] of [[0, 300], [300, 600], [600, 1000], [250, 420]]) {
    assert.deepEqual(Buffer.from(zellRendern(d, k, 0.7, von, bis).buffer), Buffer.from(voll.buffer.slice(8 * von, 8 * bis)), `${von}..${bis}`);
  }
});
